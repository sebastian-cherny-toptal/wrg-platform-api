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
        where.id === record.id && where.externalId === record.externalId
          ? record
          : null,
      findUnique: () => (published ? { status: "SUCCEEDED" } : null),
      findUniqueOrThrow: () => record,
      update: ({ data }: { data: Partial<typeof record> }) => {
        record = { ...record, ...data };
        return record;
      },
    },
  };
  const queue = {
    add: (name: string, data: unknown, options: unknown) => {
      queued.push({ name, data, options });
      return Promise.resolve();
    },
  };
  return {
    jobs: new ProgramEfsJobs(queue as never, prisma as never),
    prisma,
    queued,
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
  await worker.process({ data: { jobId: "job-id" } } as never);
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
  await assert.rejects(
    worker.process({ data: { jobId: "job-id" } } as never),
    /insert failed/u,
  );
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
  await worker.process({ data: { jobId: "job-id" } } as never);
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
