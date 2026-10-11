import assert from "node:assert/strict";
import { it } from "node:test";
import { ProgramZohoResyncService } from "../../src/modules/management/compatibility-management.module.js";

const principal = {
  sub: "admin",
  roles: ["admin"],
  organizationId: null,
  permissions: [],
};
function setup(owner: string | null = null) {
  const organization = {
    id: "canonical",
    name: "Old Company",
    zohoAccountId: null,
  };
  const enrollment = {
    id: "enrollment",
    updatedAt: new Date("2026-01-01"),
    organization,
    stage: null,
    isWinner: null,
    employeesCount: null,
    overallRank: null,
    categoryRank: null,
    currentZohoCategory: null,
    purchasedEvSortingFilter: null,
    rdPaymentType: null,
    kiaPaymentType: null,
    reportAccess: {},
    paymentDetails: {},
    metrics: {
      Source_Organization_ID: "49",
      Source_Organization_Name: "Historical Company",
    },
  };
  const writes: Array<Record<string, unknown>> = [];
  const transaction = {
    program: { update: () => Promise.resolve({}) },
    organization: {
      updateMany: ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { count: 1 };
      },
    },
    organizationProgram: {
      updateMany: ({ data }: { data: Record<string, unknown> }) => {
        writes.push(data);
        return { count: 1 };
      },
    },
  };
  const prisma = {
    organization: { findUnique: () => (owner ? { id: owner } : null) },
    program: {
      findFirst: () => ({
        id: "program",
        externalId: "crm-program",
        metadata: {},
        project: { name: "Workforce" },
        organizations: [enrollment],
      }),
    },
    $transaction: (work: (client: typeof transaction) => Promise<unknown>) =>
      work(transaction),
  };
  const crm = {
    organizationId: "49",
    zohoAccountId: "account-42",
    organizationName: "Renamed Company",
    stage: null,
    isWinner: null,
    employeesCount: null,
    surveysSent: 0,
    overallRank: null,
    categoryRank: null,
    currentZohoCategory: null,
    purchasedEvSortingFilter: null,
    rdPaymentType: null,
    kiaPaymentType: null,
    reportCategory: null,
  };
  const service = new ProgramZohoResyncService(
    prisma as never,
    { listOrganizationsForProgram: () => Promise.resolve([crm]) } as never,
  );
  return { service, writes, organization };
}

it("previews and binds a verified CRM account while syncing its canonical name", async () => {
  const { service, writes } = setup();
  const preview = await service.preview(principal, "program");
  assert.equal(writes.length, 0);
  assert.ok(
    preview.changedRows[0]?.changes.some(
      ({ field, next }) => field === "zohoAccountId" && next === "account-42",
    ),
  );
  await service.apply(principal, "program", preview.revision);
  assert.deepEqual(writes.slice(0, 2), [
    { zohoAccountId: "account-42" },
    { name: "Renamed Company" },
  ]);
});

it("rejects another organization's CRM account without writing", async () => {
  const { service, writes } = setup("other-company");
  await assert.rejects(
    service.preview(principal, "program"),
    /different organization/,
  );
  assert.equal(writes.length, 0);
});

it("rejects an outdated preview when canonical identity changes", async () => {
  const { service, writes, organization } = setup();
  const preview = await service.preview(principal, "program");
  organization.name = "Changed after preview";
  await assert.rejects(
    service.apply(principal, "program", preview.revision),
    /refresh the preview/,
  );
  assert.equal(writes.length, 0);
});
