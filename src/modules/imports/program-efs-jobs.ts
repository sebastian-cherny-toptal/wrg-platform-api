import {
  InjectQueue,
  OnWorkerEvent,
  Processor,
  WorkerHost,
} from "@nestjs/bullmq";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from "@nestjs/common";
import { Prisma, type SyncJob } from "@prisma/client";
import { Job, Queue } from "bullmq";
import { basename } from "node:path";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../database/prisma.service.js";
import type { Principal } from "../auth/auth.module.js";
import { runEfsImportProcess } from "./efs-import-process.js";
import { HistoricalImportService } from "./historical-import.service.js";

const provider = "program-efs-reupload";
export const efsQueueName = "program-efs-reuploads";
const object = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
function assertAccess(principal: Principal) {
  if (
    !principal.roles.some(
      (role) => role === "admin" || role === "super_admin",
    ) &&
    !principal.permissions.includes("ops.manage")
  )
    throw new ForbiddenException("Access denied");
}
const statusSelect = {
  id: true,
  status: true,
  output: true,
  error: true,
  startedAt: true,
  finishedAt: true,
  updatedAt: true,
  attempts: true,
} as const;
function view(
  record: Pick<
    SyncJob,
    | "id"
    | "status"
    | "output"
    | "error"
    | "startedAt"
    | "finishedAt"
    | "updatedAt"
    | "attempts"
  >,
) {
  const output = object(record.output);
  return {
    jobId: record.id,
    attempts: record.attempts,
    startedAt: record.startedAt ?? null,
    finishedAt: record.finishedAt ?? null,
    lastProgressAt: record.updatedAt,
    status: record.status,
    phase: String(output.phase ?? "Queued"),
    respondents: Number(output.respondents ?? 0),
    responses: Number(output.responses ?? 0),
    error: record.error,
    saved: record.status === "SUCCEEDED",
  };
}

@Injectable()
export class ProgramEfsJobs {
  private readonly logger = new Logger(ProgramEfsJobs.name);
  constructor(
    @InjectQueue(efsQueueName) private readonly queue: Queue<{ jobId: string }>,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async enqueue(
    principal: Principal,
    programId: string,
    file: { filename: string; buffer: Buffer },
    revision: string,
  ) {
    assertAccess(principal);
    if (
      !revision ||
      !file.filename.toLowerCase().endsWith(".xlsx") ||
      !file.buffer.length ||
      file.buffer.length > 25 * 1024 * 1024
    )
      throw new BadRequestException(
        "Upload a reviewed EFS XLSX of up to 25 MB",
      );
    const program = await this.prisma.program.findUnique({
      where: { id: programId },
      select: { id: true },
    });
    if (!program) throw new NotFoundException("Program does not exist");
    // Redis holds only an ID. The database keeps the upload until the worker finishes,
    // so another worker or a restarted process can recover the pending job.
    const record = await this.prisma.syncJob.create({
      select: statusSelect,
      data: {
        provider,
        kind: "save",
        externalId: programId,
        idempotencyKey: `${provider}:${programId}:${randomUUID()}`,
        input: {
          programId,
          filename: basename(file.filename),
          revision,
          principal: principal as unknown as Prisma.InputJsonValue,
          contents: file.buffer.toString("base64"),
        },
        output: { phase: "Queued", respondents: 0, responses: 0 },
      },
    });
    try {
      await this.queue.add(
        "save",
        { jobId: record.id },
        {
          jobId: record.id,
          attempts: 1,
          removeOnComplete: true,
          removeOnFail: { count: 100 },
        },
      );
    } catch (error) {
      await this.prisma.syncJob.update({
        select: statusSelect,
        where: { id: record.id },
        data: {
          status: "FAILED",
          error: "The save could not be queued. Please retry.",
          input: { programId },
          finishedAt: new Date(),
        },
      });
      throw error;
    }
    return view(record);
  }

  async latest(principal: Principal, programId: string) {
    assertAccess(principal);
    const record = await this.prisma.syncJob.findFirst({
      select: { id: true },
      where: { externalId: programId, provider },
      orderBy: { createdAt: "desc" },
    });
    return record ? this.status(principal, programId, record.id) : null;
  }

  async status(principal: Principal, programId: string, jobId: string) {
    assertAccess(principal);
    let record = await this.prisma.syncJob.findFirst({
      select: statusSelect,
      where: { id: jobId, externalId: programId, provider },
    });
    if (!record) throw new NotFoundException("EFS save job not found");
    if (record.status === "RUNNING" || record.status === "FAILED") {
      const audit = await this.prisma.syncJob.findUnique({
        select: { status: true, finishedAt: true },
        where: { idempotencyKey: `efs-reupload:${record.id}` },
      });
      if (audit?.status === "SUCCEEDED") {
        record = await this.prisma.syncJob.update({
          select: statusSelect,
          where: { id: record.id },
          data: {
            status: "SUCCEEDED",
            error: null,
            finishedAt: audit.finishedAt ?? new Date(),
            input: { programId },
            output: { ...object(record.output), phase: "Saved" },
          },
        });
      }
    }
    let queueState = record.status === "SUCCEEDED" ? "completed" : "failed";
    if (record.status === "PENDING" || record.status === "RUNNING") {
      let queued: Job<{ jobId: string }> | undefined;
      try {
        queued = await this.queue.getJob(record.id);
        queueState = queued ? await queued.getState() : "missing";
      } catch (error) {
        // A Redis outage does not prove that the importer failed.
        this.logger.warn(
          `Could not inspect EFS queue job ${record.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
        );
        return { ...view(record), queueState: "unavailable" };
      }
      const missing =
        !queued && Date.now() - record.updatedAt.getTime() > 60_000;
      if (queueState === "failed" || missing) {
        const error = missing
          ? "The EFS save is no longer in the worker queue. The worker may have stopped or lost the job. Review the file before retrying."
          : (queued?.failedReason ??
            "The EFS worker failed before it could report completion.");
        await this.prisma.syncJob.updateMany({
          where: { id: record.id, status: { in: ["PENDING", "RUNNING"] } },
          data: { status: "FAILED", error, finishedAt: new Date() },
        });
        record = await this.prisma.syncJob.findUniqueOrThrow({
          select: statusSelect,
          where: { id: record.id },
        });
      }
    }
    const waiting =
      record.status === "RUNNING" &&
      ["waiting", "delayed", "waiting-children"].includes(queueState);
    return {
      ...view(record),
      queueState,
      ...(waiting
        ? { status: "PENDING" as const, phase: "Waiting for worker recovery" }
        : {}),
    };
  }
}

@Processor(efsQueueName, { concurrency: 1, lockDuration: 120_000 })
export class ProgramEfsWorker extends WorkerHost {
  private readonly logger = new Logger(ProgramEfsWorker.name);

  @OnWorkerEvent("error")
  onWorkerError(error: Error) {
    this.logger.error(`EFS worker error: ${error.message}`, error.stack);
  }

  @OnWorkerEvent("stalled")
  onStalled(jobId: string) {
    this.logger.warn(
      `EFS job ${jobId} stalled; BullMQ will recover it or fail it after its stall limit.`,
    );
  }

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(HistoricalImportService)
    private readonly imports: HistoricalImportService,
  ) {
    super();
  }

  override async process(job: Job<{ jobId: string }>) {
    try {
      await this.importProcess(job.data.jobId);
    } catch (error) {
      // A fatal child error cannot run its own catch handler. Record it here,
      // while preserving a save that committed before the child exited.
      const audit = await this.prisma.syncJob.findUnique({
        where: { idempotencyKey: `efs-reupload:${job.data.jobId}` },
        select: { status: true },
      });
      if (audit?.status === "SUCCEEDED") return;
      await this.prisma.syncJob.updateMany({
        where: { id: job.data.jobId, status: { in: ["PENDING", "RUNNING"] } },
        data: {
          status: "FAILED",
          error:
            error instanceof Error
              ? error.message
              : "EFS import process failed",
          finishedAt: new Date(),
          input: {},
        },
      });
      throw error;
    }
  }

  protected importProcess(jobId: string) {
    return runEfsImportProcess(jobId);
  }

  async runImport(jobId: string) {
    const record = await this.prisma.syncJob.findUniqueOrThrow({
      where: { id: jobId },
    });
    if (record.status === "SUCCEEDED") return;
    const input = object(record.input);
    const programId = String(input.programId ?? "");
    const sanitizedInput = {
      programId,
      filename: String(input.filename ?? ""),
      revision: String(input.revision ?? ""),
      createdByUserId: String(object(input.principal).sub ?? ""),
    };
    const audit = await this.prisma.syncJob.findUnique({
      where: { idempotencyKey: `efs-reupload:${record.id}` },
    });
    if (audit?.status === "SUCCEEDED") {
      await this.prisma.syncJob.update({
        select: statusSelect,
        where: { id: record.id },
        data: {
          status: "SUCCEEDED",
          input: sanitizedInput,
          output: { phase: "Saved" },
          error: null,
          finishedAt: new Date(),
        },
      });
      return;
    }
    await this.prisma.syncJob.update({
      select: statusSelect,
      where: { id: record.id },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        attempts: { increment: 1 },
        output: {
          phase: "Checking uploaded data",
          respondents: 0,
          responses: 0,
        },
      },
    });
    let lastProgress = 0;
    let lastMemoryLog = 0;
    let progress = {
      phase: "Checking uploaded data",
      respondents: 0,
      responses: 0,
    };
    try {
      const result = await this.imports.reuploadProgramEfs(
        input.principal as Principal,
        programId,
        {
          filename: String(input.filename),
          buffer: Buffer.from(String(input.contents), "base64"),
        },
        String(input.revision),
        {
          importId: record.id,
          onProgress: async (next) => {
            progress = next;
            if (Date.now() - lastProgress < 5_000) return;
            lastProgress = Date.now();
            if (Date.now() - lastMemoryLog >= 30_000) {
              lastMemoryLog = Date.now();
              this.logger.log(
                `EFS ${record.id}: ${next.respondents} respondents, ${next.responses} responses; heap ${Math.round(process.memoryUsage().heapUsed / 1048576)} MB`,
              );
            }
            await this.prisma.syncJob.update({
              select: statusSelect,
              where: { id: record.id },
              data: { output: next },
            });
          },
        },
      );
      if (!result.saved) throw new Error("The EFS was not saved");
      await this.prisma.syncJob.update({
        select: statusSelect,
        where: { id: record.id },
        data: {
          status: "SUCCEEDED",
          input: sanitizedInput,
          output: { ...progress, phase: "Saved" },
          error: null,
          finishedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.syncJob.update({
        select: statusSelect,
        where: { id: record.id },
        data: {
          status: "FAILED",
          input: sanitizedInput,
          error: error instanceof Error ? error.message : "EFS save failed",
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  }
}
