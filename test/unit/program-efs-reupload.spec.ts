import ExcelJS from "exceljs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { HistoricalImportService } from "../../src/modules/imports/historical-import.service.js";

const principal = {
  sub: "admin",
  roles: ["admin"],
  permissions: [],
  organizationId: null,
};
const label = "q_CoreEmployeeExperience_Test";

async function fixture() {
  const workbook = new ExcelJS.Workbook();
  workbook.addWorksheet("Survey").addRows([
    [
      "organization name",
      "Respondent",
      "Date responded",
      "Reached end",
      "Score %",
      label,
    ],
    ["YoloCares", 1, "2026-03-20", "Yes", null, 4],
    ["Unchanged", 2, "2026-03-20", "Yes", null, 4],
    ["Changed", 3, "2026-03-20", "Yes", null, 4],
  ]);
  const program = {
    id: "program",
    projectId: "project",
    name: "Healthcare 2026",
    year: 2026,
    startsAt: new Date("2026-03-13"),
    endsAt: new Date("2026-03-27"),
    updatedAt: new Date("2026-01-01"),
    metadata: {
      reportCatalog: [{ id: "report" }],
      categoryPricing: [{ tier: "Small" }],
      sentinel: "preserve",
    },
  };
  const completed = (name: string, score: number) => ({
    organizationId: name,
    completedAt: new Date("2026-03-20"),
    responses: [{ value: score, score, question: { dataLabel: label } }],
  });
  let existing = [
    completed("Unchanged", 4),
    completed("Changed", 3),
    completed("Missing", 4),
  ];
  const writes = {
    respondents: [] as Array<{
      organizationId: string;
      completedAt: Date | null;
    }>,
    responses: 0,
    deleted: false,
    metadata: null as unknown,
    audit: false,
  };
  let fail = false;
  let hasSurvey = true;
  let enrolledNames = ["YoloCares", "Unchanged", "Changed", "Missing"];
  const prisma = {
    program: {
      findUnique: () => program,
      findUniqueOrThrow: () => program,
      update: (input: { data: { metadata: unknown } }) => {
        writes.metadata = input.data.metadata;
        return program;
      },
    },
    organizationProgram: {
      findMany: () =>
        enrolledNames.map((name) => ({
          organizationId: name,
          metrics: { Source_Organization_Name: name, Surveys_Sent: 106 },
          organization: { name },
        })),
    },
    survey: {
      findFirst: () => (hasSurvey ? { id: "old" } : null),
      findMany: () => (hasSurvey ? [{ id: "old" }] : []),
      create: () => ({}),
      deleteMany: () => {
        writes.deleted = true;
      },
    },
    question: {
      findMany: () => [
        {
          dataLabel: label,
          caption: "I feel supported",
          type: "likert",
          metadata: {},
          survey: { programId: "program", program: { year: 2026 } },
        },
      ],
      createMany: () => ({}),
    },
    respondent: {
      findMany: ({ skip }: { skip: number }) => (skip ? [] : existing),
      createMany: ({ data }: { data: typeof writes.respondents }) => {
        if (fail) throw new Error("insert failed");
        writes.respondents.push(...data);
      },
    },
    response: {
      createMany: ({ data }: { data: unknown[] }) => {
        writes.responses += data.length;
      },
    },
    syncJob: {
      create: () => {
        writes.audit = true;
      },
    },
    $queryRaw: () => [],
    $transaction: (operation: (transaction: unknown) => Promise<void>) =>
      operation(prisma),
  };
  return {
    service: new HistoricalImportService(prisma as never),
    file: {
      filename: "efs.xlsx",
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    },
    writes,
    changeExisting: () => {
      existing = [
        completed("Unchanged", 4),
        completed("Changed", 2),
        completed("Missing", 4),
      ];
    },
    failImport: () => {
      fail = true;
    },
    noOrganizations: () => {
      enrolledNames = [];
    },
    noSurvey: () => {
      hasSurvey = false;
      existing = [];
    },
  };
}

test("previews missing responses, identical rows, changed answers at the same count, and organizations absent from EFS", async () => {
  const { service, file, writes } = await fixture();
  const result = await service.reuploadProgramEfs(principal, "program", file);
  assert.equal(result.validation.blockingErrorCount, 0);
  const byName = new Map(
    result.validation.organizations.map((organization) => [
      organization.displayName,
      organization,
    ]),
  );
  assert.deepEqual(byName.get("YoloCares")?.responseChanges, {
    changed: true,
    previousRespondents: 0,
    uploadedRespondents: 1,
    previousCompleted: 0,
    uploadedCompleted: 1,
  });
  assert.equal(byName.get("Unchanged")?.responseChanges?.changed, false);
  assert.equal(byName.get("Changed")?.responseChanges?.changed, true);
  assert.equal(byName.get("Missing")?.responseChanges?.uploadedRespondents, 0);
  assert.equal(writes.respondents.length, 0);
  assert.equal(writes.deleted, false);
});

test("blocks unknown organizations instead of creating or changing program enrollments", async () => {
  const { service, file, noOrganizations, writes } = await fixture();
  noOrganizations();
  const review = await service.reuploadProgramEfs(principal, "program", file);
  assert.equal(review.validation.blockingErrorCount, 3);
  await assert.rejects(
    service.reuploadProgramEfs(principal, "program", file, review.revision),
    /Resolve EFS validation errors/u,
  );
  assert.equal(writes.deleted, false);
  assert.equal(writes.respondents.length, 0);
});

test("confirmed replacement imports completed respondents with original organization IDs and preserves program settings", async () => {
  const { service, file, writes } = await fixture();
  const review = await service.reuploadProgramEfs(principal, "program", file);
  const result = await service.reuploadProgramEfs(
    principal,
    "program",
    file,
    review.revision,
  );
  assert.equal(result.saved, true);
  assert.deepEqual(
    writes.respondents.map(({ organizationId }) => organizationId),
    ["YoloCares", "Unchanged", "Changed"],
  );
  assert.ok(
    writes.respondents.every(({ completedAt }) => completedAt !== null),
  );
  assert.equal(writes.responses, 3);
  assert.equal(writes.deleted, true);
  assert.equal(writes.audit, true);
  assert.equal((writes.metadata as { sentinel: string }).sentinel, "preserve");
});

test("rejects a stale review even when changed respondent counts remain identical", async () => {
  const { service, file, changeExisting, writes } = await fixture();
  const review = await service.reuploadProgramEfs(principal, "program", file);
  changeExisting();
  await assert.rejects(
    service.reuploadProgramEfs(principal, "program", file, review.revision),
    /Review the EFS again/u,
  );
  assert.equal(writes.deleted, false);
});

test("a failed import does not delete the previous survey", async () => {
  const { service, file, failImport, writes } = await fixture();
  const review = await service.reuploadProgramEfs(principal, "program", file);
  failImport();
  await assert.rejects(
    service.reuploadProgramEfs(principal, "program", file, review.revision),
    /insert failed/u,
  );
  assert.equal(writes.deleted, false);
  assert.equal(writes.metadata, null);
});

test("can recover a program that has no existing EFS survey", async () => {
  const { service, file, noSurvey } = await fixture();
  noSurvey();
  const review = await service.reuploadProgramEfs(principal, "program", file);
  assert.equal(
    review.validation.organizations.find(
      ({ displayName }) => displayName === "YoloCares",
    )?.responseChanges?.uploadedCompleted,
    1,
  );
  assert.equal(
    (
      await service.reuploadProgramEfs(
        principal,
        "program",
        file,
        review.revision,
      )
    ).saved,
    true,
  );
});
