import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ProgramEfsJobs,
  ProgramEfsWorker,
} from "../../src/modules/imports/program-efs-jobs.js";

const principal = {
  sub: "admin",
  roles: ["admin"],
  permissions: [],
  organizationId: null,
};
function fixture() {
  let record = {
    id: "job-id",
    status: "PENDING",
    provider: "program-efs-reupload",
    externalId: "program",
    input: {} as Record<string, unknown>,
    output: {} as Record<string, unknown>,
    error: null as string | null,
    startedAt: null as Date | null,
    finishedAt: null as Date | null,
    updatedAt: new Date(),
    attempts: 0 as number | { increment: number },
  };
  let published = false;
  const queued: Array<unknown> = [];
  const prisma = {
    program: { findUnique: () => ({ id: "program" }) },
    syncJob: {
      create: ({ data }: { data: Partial<typeof record> }) => {
        record = { ...record, ...data };
        return record;
      },
      findFirst: ({ where }: { where: { id: string; externalId: string } }) =>
        (!where.id || where.id === record.id) &&
        where.externalId === record.externalId
          ? record
          : null,
      findUnique: () => (published ? { status: "SUCCEEDED" } : null),
      findUniqueOrThrow: () => record,
      updateMany: ({ data }: { data: Partial<typeof record> }) => {
        record = { ...record, ...data };
        return { count: 1 };
      },
      update: ({ data }: { data: Partial<typeof record> }) => {
        record = { ...record, ...data };
        return record;
      },
    },
  };
  let queueState: string | undefined = "active";
  const queue = {
    getJob: () =>
      queueState
        ? {
            getState: () => queueState,
            failedReason: "job stalled more than allowable limit",
          }
        : undefined,
    add: (name: string, data: unknown, options: unknown) => {
      queued.push({ name, data, options });
      return Promise.resolve();
    },
  };
  return {
    jobs: new ProgramEfsJobs(queue as never, prisma as never),
    prisma,
    queued,
    queue,
    setQueueState: (state: string | undefined) => {
      queueState = state;
    },
    record: () => record,
    markPublished: () => {
      published = true;
    },
  };
}

test("save enqueues a durable upload and returns pending without starting the import in the HTTP request", async () => {
  const { jobs, queued, record } = fixture();
  const result = await jobs.enqueue(
    principal,
    "program",
    { filename: "efs.xlsx", buffer: Buffer.from("workbook") },
    "review",
  );
  assert.equal(result.status, "PENDING");
  assert.equal(result.saved, false);
  assert.equal(
    record().input.contents,
    Buffer.from("workbook").toString("base64"),
  );
  assert.equal(queued.length, 1);
  assert.deepEqual((queued[0] as { data: unknown }).data, { jobId: "job-id" });
  assert.ok(!("contents" in result));
});

test("worker reports progress and removes uploaded contents after successful publication", async () => {
  const { jobs, prisma, record } = fixture();
  await jobs.enqueue(
    principal,
    "program",
    { filename: "efs.xlsx", buffer: Buffer.from("workbook") },
    "review",
  );
  const imports = {
    reuploadProgramEfs: async (
      _principal: unknown,
      programId: string,
      file: { buffer: Buffer },
      revision: string,
      options: {
        importId: string;
        onProgress: (progress: unknown) => Promise<void>;
      },
    ) => {
      assert.equal(programId, "program");
      assert.equal(revision, "review");
      assert.equal(file.buffer.toString(), "workbook");
      assert.equal(options.importId, "job-id");
      await options.onProgress({
        phase: "Importing responses",
        respondents: 82,
        responses: 7000,
      });
      assert.equal(record().status, "RUNNING");
      return { saved: true };
    },
  };
  const worker = new ProgramEfsWorker(prisma as never, imports as never);
  await worker.runImport("job-id");
  const status = await jobs.status(principal, "program", "job-id");
  assert.equal(status.status, "SUCCEEDED");
  assert.equal(status.respondents, 82);
  assert.equal(status.saved, true);
  assert.ok(!("contents" in record().input));
});

test("failed imports report the error and discard the stored workbook", async () => {
  const { jobs, prisma, record } = fixture();
  await jobs.enqueue(
    principal,
    "program",
    { filename: "efs.xlsx", buffer: Buffer.from("workbook") },
    "review",
  );
  const worker = new ProgramEfsWorker(
    prisma as never,
    {
      reuploadProgramEfs: () => Promise.reject(new Error("insert failed")),
    } as never,
  );
  await assert.rejects(worker.runImport("job-id"), /insert failed/u);
  assert.equal(record().status, "FAILED");
  assert.equal(record().error, "insert failed");
  assert.ok(!("contents" in record().input));
});

test("a restarted worker recognizes an already committed save without importing again", async () => {
  const { jobs, prisma, markPublished, record } = fixture();
  await jobs.enqueue(
    principal,
    "program",
    { filename: "efs.xlsx", buffer: Buffer.from("workbook") },
    "review",
  );
  markPublished();
  const worker = new ProgramEfsWorker(
    prisma as never,
    {
      reuploadProgramEfs: () => {
        throw new Error("must not import again");
      },
    } as never,
  );
  await worker.runImport("job-id");
  assert.equal(record().status, "SUCCEEDED");
  assert.ok(!("contents" in record().input));
});

test("job status is scoped to its program and requires admin access", async () => {
  const { jobs } = fixture();
  await jobs.enqueue(
    principal,
    "program",
    { filename: "efs.xlsx", buffer: Buffer.from("workbook") },
    "review",
  );
  await assert.rejects(
    jobs.status(principal, "other-program", "job-id"),
    /not found/u,
  );
  await assert.rejects(
    jobs.status({ ...principal, roles: [] }, "program", "job-id"),
    /Access denied/u,
  );
});

test("polling recovers a successful publication if the worker has not updated the job yet", async () => {
  const { jobs, prisma, markPublished, record } = fixture();
  await jobs.enqueue(
    principal,
    "program",
    { filename: "efs.xlsx", buffer: Buffer.from("workbook") },
    "review",
  );
  prisma.syncJob.update({ data: { status: "RUNNING" } });
  markPublished();
  assert.equal((await jobs.status(principal, "program", "job-id")).saved, true);
  assert.ok(!("contents" in record().input));
});

test("latest job is recovered without a browser job ID and exposes worker timestamps", async () => {
  const { jobs, prisma } = fixture();
  assert.equal(await jobs.latest(principal, "other-program"), null);
  const startedAt = new Date("2026-10-10T17:00:00Z");
  const finishedAt = new Date("2026-10-10T17:08:00Z");
  prisma.syncJob.update({
    data: { status: "SUCCEEDED", startedAt, finishedAt },
  });
  const result = await jobs.latest(principal, "program");
  assert.equal(result?.saved, true);
  assert.equal(result.startedAt, startedAt);
  assert.equal(result.finishedAt, finishedAt);
  await assert.rejects(
    jobs.latest({ ...principal, roles: [] }, "program"),
    /Access denied/u,
  );
});

test("a queue-level failure cannot leave the database job reporting RUNNING", async () => {
  const { jobs, prisma, setQueueState } = fixture();
  prisma.syncJob.update({ data: { status: "RUNNING" } });
  setQueueState("failed");
  const result = await jobs.status(principal, "program", "job-id");
  assert.equal(result.status, "FAILED");
  assert.match(result.error ?? "", /stalled/u);
});
test("an abandoned RUNNING record with no queue job reports interruption", async () => {
  const { jobs, prisma, setQueueState } = fixture();
  prisma.syncJob.update({
    data: { status: "RUNNING", updatedAt: new Date(Date.now() - 600_000) },
  });
  setQueueState(undefined);
  const result = await jobs.status(principal, "program", "job-id");
  assert.equal(result.status, "FAILED");
  assert.match(result.error ?? "", /no longer in the worker queue/u);
});
test("slow active work is not failed just because progress has stopped changing", async () => {
  const { jobs, prisma } = fixture();
  prisma.syncJob.update({
    data: { status: "RUNNING", updatedAt: new Date(Date.now() - 600_000) },
  });
  const result = await jobs.status(principal, "program", "job-id");
  assert.equal(result.status, "RUNNING");
});

test("a Redis inspection failure does not falsely mark an active import failed", async () => {
  const { jobs, prisma, queue } = fixture();
  prisma.syncJob.update({ data: { status: "RUNNING" } });
  queue.getJob = () => {
    throw new Error("Redis unavailable");
  };
  const result = await jobs.status(principal, "program", "job-id");
  assert.equal(result.status, "RUNNING");
  assert.equal(result.queueState, "unavailable");
});
test("a newly created job is not considered interrupted before queue.add completes", async () => {
  const { jobs, setQueueState } = fixture();
  setQueueState(undefined);
  assert.equal(
    (await jobs.status(principal, "program", "job-id")).status,
    "PENDING",
  );
});

test("a fatal import child exit marks the job failed while the API parent stays alive", async () => {
  const { prisma, record } = fixture();
  prisma.syncJob.update({ data: { status: "RUNNING" } });
  class CrashedWorker extends ProgramEfsWorker {
    protected override importProcess() {
      return Promise.reject(new Error("EFS import process stopped (SIGABRT)"));
    }
  }
  const worker = new CrashedWorker(prisma as never, {} as never);
  await assert.rejects(
    worker.process({ data: { jobId: "job-id" } } as never),
    /SIGABRT/u,
  );
  assert.equal(record().status, "FAILED");
  assert.deepEqual(record().input, {});
});
test("child failure after publication cannot mark successfully saved data failed", async () => {
  const { prisma, record, markPublished } = fixture();
  prisma.syncJob.update({ data: { status: "SUCCEEDED" } });
  markPublished();
  class CrashedWorker extends ProgramEfsWorker {
    protected override importProcess() {
      return Promise.reject(new Error("child stopped"));
    }
  }
  await new CrashedWorker(prisma as never, {} as never).process({
    data: { jobId: "job-id" },
  } as never);
  assert.equal(record().status, "SUCCEEDED");
});
test("a stalled attempt waiting for recovery is not presented as actively importing", async () => {
  const { jobs, prisma, setQueueState } = fixture();
  prisma.syncJob.update({ data: { status: "RUNNING" } });
  setQueueState("waiting");
  const result = await jobs.status(principal, "program", "job-id");
  assert.equal(result.status, "PENDING");
  assert.equal(result.phase, "Waiting for worker recovery");
});
