import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { HistoricalImportService } from "../../src/modules/imports/historical-import.service.js";

function setup(
  accounts: Array<{ id: string; name: string; zohoAccountId: string | null }>,
  crm: unknown[] = [],
  enrollments: unknown[] = [],
) {
  const writes: Array<{ kind: string; data: Record<string, unknown> }> = [];
  const prisma = {
    organization: {
      findMany: () => accounts,
      update: ({ data }: { data: Record<string, unknown> }) => {
        writes.push({ kind: "company-update", data });
      },
      upsert: ({ create }: { create: Record<string, unknown> }) => {
        writes.push({ kind: "company-create", data: create });
      },
    },
    organizationProgram: {
      findMany: () => enrollments,
      update: ({ data }: { data: Record<string, unknown> }) => {
        writes.push({ kind: "enrollment-update", data });
      },
      upsert: ({ create }: { create: Record<string, unknown> }) => {
        writes.push({ kind: "enrollment-create", data: create });
      },
    },
  };
  const service = new HistoricalImportService(
    prisma as never,
    { verifiedOrganizationsForProgram: () => crm } as never,
  ) as unknown as {
    createOrganizationsAndEnrollments: (
      ...args: unknown[]
    ) => Promise<Map<string, string>>;
  };
  const importRows = (
    identity: Record<string, unknown> = {},
    draft: Record<string, unknown> = {},
    rows = new Map([
      [
        "name:renamed company",
        {
          displayName: "Renamed Company",
          workbookOrganizationId: "49",
          eaRespondents: 2,
          efsRespondents: 3,
        },
      ],
    ]),
  ) =>
    service.createOrganizationsAndEnrollments(
      prisma,
      {
        importId: "import-2026",
        programName: "2026",
        zohoProgramId: "crm-program",
        organizationPrograms: [
          {
            organizationKey: "name:renamed company",
            surveysSent: 3,
            isWinner: "Y",
            isIncluded: true,
            ...identity,
          },
        ],
        ...draft,
      },
      rows,
      "project-1",
      "program-2026",
      "project",
    );
  return { writes, importRows };
}

describe("historical import company continuity", () => {
  it("reuses a renamed CRM account and preserves the workbook name on its enrollment", async () => {
    const { writes, importRows } = setup(
      [{ id: "canonical", name: "Old Company", zohoAccountId: "crm-account" }],
      [
        {
          organizationId: "49",
          organizationName: "Renamed Company",
          zohoAccountId: "crm-account",
        },
      ],
    );
    assert.equal((await importRows()).get("name:renamed company"), "canonical");
    assert.equal(
      writes.filter(({ kind }) => kind === "company-create").length,
      0,
    );
    assert.deepEqual(
      writes.find(({ kind }) => kind === "company-update")?.data,
      { name: "Renamed Company", zohoAccountId: "crm-account" },
    );
    const enrollmentWrite = writes.find(
      ({ kind }) => kind === "enrollment-create",
    );
    assert.ok(enrollmentWrite);
    const enrollment = enrollmentWrite.data;
    assert.equal(enrollment.organizationId, "canonical");
    assert.equal(
      (enrollment.metrics as Record<string, unknown>).Source_Organization_Name,
      "Renamed Company",
    );
  });
  it("does not reuse a matching name without explicit identity", async () => {
    const { writes, importRows } = setup([
      { id: "legacy", name: "Renamed Company", zohoAccountId: null },
    ]);
    assert.notEqual(
      (await importRows({ canonicalOrganizationId: "new" })).get(
        "name:renamed company",
      ),
      "legacy",
    );
    assert.equal(
      writes.filter(({ kind }) => kind === "company-create").length,
      1,
    );
  });
  it("supports explicit legacy mapping without altering other users or enrollments", async () => {
    const { writes, importRows } = setup([
      { id: "legacy", name: "Old Company", zohoAccountId: null },
    ]);
    assert.equal(
      (await importRows({ canonicalOrganizationId: "legacy" })).get(
        "name:renamed company",
      ),
      "legacy",
    );
    assert.deepEqual(
      writes.map(({ kind }) => kind),
      ["enrollment-create"],
    );
  });
  it("retains enrollment data when a reimport changes both the company name and workbook ID", async () => {
    const { writes, importRows } = setup(
      [{ id: "legacy", name: "Old Company", zohoAccountId: null }],
      [],
      [
        {
          id: "enrollment",
          organizationId: "legacy",
          metrics: {
            Source_Organization_ID: "old-id",
            Source_Organization_Name: "Old Company",
          },
          reportAccess: { CR_Access: "yes" },
          paymentDetails: {},
          rdPaymentType: "paid",
          kiaPaymentType: null,
        },
      ],
    );
    assert.equal(
      (
        await importRows(
          { canonicalOrganizationId: "legacy" },
          { programId: "program-2026" },
        )
      ).get("name:renamed company"),
      "legacy",
    );
    assert.deepEqual(
      writes.map(({ kind }) => kind),
      ["enrollment-update"],
    );
    assert.equal(
      (writes[0]?.data.reportAccess as Record<string, unknown>).CR_Access,
      "yes",
    );
  });

  it("rejects fabricated CRM identities and conflicts before writing", async () => {
    const { writes, importRows } = setup(
      [{ id: "canonical", name: "Old Company", zohoAccountId: "crm-account" }],
      [
        {
          organizationId: "49",
          organizationName: "Renamed Company",
          zohoAccountId: "crm-account",
        },
      ],
    );
    await assert.rejects(
      importRows({ zohoAccountId: "fabricated" }),
      /could not be verified/,
    );
    await assert.rejects(
      importRows({ canonicalOrganizationId: "new" }),
      /already linked/,
    );
    assert.equal(writes.length, 0);
  });
  it("retains an existing enrollment during reimport and rejects remapping", async () => {
    const { writes, importRows } = setup(
      [
        { id: "legacy", name: "Old Company", zohoAccountId: null },
        { id: "other", name: "Other", zohoAccountId: null },
      ],
      [],
      [
        {
          id: "enrollment",
          organizationId: "legacy",
          metrics: { Source_Organization_ID: "49" },
          reportAccess: {},
          paymentDetails: {},
          rdPaymentType: null,
          kiaPaymentType: null,
        },
      ],
    );
    await assert.rejects(
      importRows(
        { canonicalOrganizationId: "other" },
        { programId: "program-2026" },
      ),
      /retain the existing/,
    );
    assert.equal(writes.length, 0);
    assert.equal(
      (await importRows({}, { programId: "program-2026" })).get(
        "name:renamed company",
      ),
      "legacy",
    );
    assert.deepEqual(
      writes.map(({ kind }) => kind),
      ["enrollment-update"],
    );
  });
});
