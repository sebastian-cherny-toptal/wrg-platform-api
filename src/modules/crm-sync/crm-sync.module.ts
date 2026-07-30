import { BullModule, InjectQueue, Processor, WorkerHost } from "@nestjs/bullmq";
import { Inject, Injectable, Module } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { Job, Queue } from "bullmq";
import { PrismaService } from "../../database/prisma.service.js";
import {
  CheckMarketAdapter,
  IntegrationsModule,
  ZohoAdapter,
} from "../integrations/integrations.module.js";

export interface SyncPayload {
  provider: "zoho" | "checkmarket";
  kind: string;
  externalId?: string;
  cursor?: string;
  idempotencyKey?: string;
}

@Injectable()
export class SyncQueue {
  constructor(
    @InjectQueue("integrations") private readonly queue: Queue<SyncPayload>,
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  async enqueue(payload: SyncPayload, idempotencyKey: string) {
    const existing = await this.prisma.syncJob.findUnique({
      where: { idempotencyKey },
    });
    if (existing) return existing;
    const record = await this.prisma.syncJob.create({
      data: {
        provider: payload.provider,
        kind: payload.kind,
        idempotencyKey,
        input: payload as unknown as Prisma.InputJsonValue,
      },
    });
    const jobId = createHash("sha256").update(idempotencyKey).digest("hex");
    await this.queue.add(
      payload.kind,
      { ...payload, idempotencyKey },
      {
        jobId,
        attempts: 5,
        backoff: { type: "exponential", delay: 1_000 },
        removeOnComplete: 1_000,
        removeOnFail: 5_000,
      },
    );
    return record;
  }
}

@Processor("integrations")
class SyncProcessor extends WorkerHost {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ZohoAdapter) private readonly zoho: ZohoAdapter,
    @Inject(CheckMarketAdapter) private readonly checkMarket: CheckMarketAdapter,
  ) {
    super();
  }

  override async process(job: Job<SyncPayload>): Promise<unknown> {
    const idempotencyKey = job.data.idempotencyKey;
    if (!idempotencyKey)
      throw new Error("Sync job is missing its idempotency key");
    await this.prisma.syncJob.updateMany({
      where: { idempotencyKey },
      data: {
        status: "RUNNING",
        startedAt: new Date(),
        attempts: { increment: 1 },
      },
    });
    try {
      const output =
        job.data.provider === "zoho"
          ? await this.zoho.listRecords(job.data.kind)
          : await this.checkMarket.getSurvey(Number(job.data.externalId));
      await this.prisma.syncJob.updateMany({
        where: { idempotencyKey },
        data: {
          status: "SUCCEEDED",
          output: output as never,
          finishedAt: new Date(),
          error: null,
        },
      });
      return output;
    } catch (error) {
      await this.prisma.syncJob.updateMany({
        where: { idempotencyKey },
        data: {
          status: "FAILED",
          error: error instanceof Error ? error.message : "Unknown error",
          finishedAt: new Date(),
        },
      });
      throw error;
    }
  }
}

@Module({
  imports: [
    IntegrationsModule,
    BullModule.registerQueue({ name: "integrations" }),
  ],
  providers: [SyncQueue, SyncProcessor],
  exports: [SyncQueue],
})
export class CrmSyncModule {}
