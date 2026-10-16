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
  const organization: {
    id: string;
    name: string;
    zohoAccountId: string | null;
  } = {
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
  const enrollments = [enrollment];
  const prisma = {
    organization: {
      findUnique: () => (owner ? { id: owner, name: "Other Company" } : null),
    },
    program: {
      findFirst: () => ({
        id: "program",
        externalId: "crm-program",
        metadata: {},
        project: { name: "Workforce" },
        organizations: enrollments,
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
  const crmOrganizations = [crm];
  const service = new ProgramZohoResyncService(
    prisma as never,
    {
      listOrganizationsForProgram: () => Promise.resolve(crmOrganizations),
    } as never,
  );
  return {
    service,
    writes,
    organization,
    enrollment,
    crm,
    enrollments,
    crmOrganizations,
  };
}

it("compares each program's saved name instead of the shared organization name", async () => {
  const { service, organization, enrollment, crm } = setup();
  organization.name = "Aris Solutions";
  crm.organizationName = "ARIS Solutions";
  enrollment.metrics.Source_Organization_Name = "Aris Solutions";

  const preview2025 = await service.preview(principal, "program");
  assert.deepEqual(
    preview2025.changedRows[0]?.changes.find(
      ({ field }) => field === "organizationName",
    ),
    {
      field: "organizationName",
      previous: "Aris Solutions",
      next: "ARIS Solutions",
    },
  );

  enrollment.metrics.Source_Organization_Name = "ARIS Solutions";
  const preview2026 = await service.preview(principal, "program");
  assert.equal(
    preview2026.changedRows
      .flatMap(({ changes }) => changes)
      .some(({ field }) => field === "organizationName"),
    false,
  );

  // Syncing another program's shared name must not hide this program's rename.
  organization.name = "ARIS Solutions";
  enrollment.metrics.Source_Organization_Name = "Aris Solutions";
  const historicalPreview = await service.preview(principal, "program");
  assert.deepEqual(
    historicalPreview.changedRows[0]?.changes.find(
      ({ field }) => field === "organizationName",
    ),
    {
      field: "organizationName",
      previous: "Aris Solutions",
      next: "ARIS Solutions",
    },
  );
});

it("falls back to the shared name when the program has no saved name", async () => {
  const { service, enrollment } = setup();
  enrollment.metrics.Source_Organization_Name = "";
  const preview = await service.preview(principal, "program");
  assert.deepEqual(
    preview.changedRows[0]?.changes.find(
      ({ field }) => field === "organizationName",
    ),
    {
      field: "organizationName",
      previous: "Old Company",
      next: "Renamed Company",
    },
  );
});

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
    (error: Error) => {
      assert.match(error.message, /Old Company.*canonical/);
      assert.match(error.message, /Renamed Company.*49/);
      assert.match(error.message, /account-42/);
      assert.match(error.message, /Other Company.*other-company/);
      return true;
    },
  );
  assert.equal(writes.length, 0);
});

it("identifies the saved and incoming accounts when a matched organization has a different account", async () => {
  const { service, writes, organization } = setup();
  organization.zohoAccountId = "saved-account";
  await assert.rejects(
    service.preview(principal, "program"),
    (error: Error) => {
      assert.match(error.message, /Old Company.*canonical/);
      assert.match(error.message, /saved-account/);
      assert.match(error.message, /account-42/);
      assert.match(error.message, /Renamed Company.*49/);
      return true;
    },
  );
  assert.equal(writes.length, 0);
});

it("reports all conflicting organizations together without writing", async () => {
  const { service, writes, enrollment, crm, enrollments, crmOrganizations } =
    setup("other-company");
  enrollments.push({
    ...enrollment,
    id: "second-enrollment",
    organization: { id: "second", name: "Second Company", zohoAccountId: null },
    metrics: {
      Source_Organization_ID: "50",
      Source_Organization_Name: "Second Company",
    },
  });
  crmOrganizations.push({
    ...crm,
    organizationId: "50",
    organizationName: "Second CRM Company",
    zohoAccountId: "account-43",
  });
  await assert.rejects(
    service.preview(principal, "program"),
    (error: Error) => {
      assert.match(error.message, /Old Company/);
      assert.match(error.message, /Second Company/);
      assert.match(error.message, /account-42/);
      assert.match(error.message, /account-43/);
      return true;
    },
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
