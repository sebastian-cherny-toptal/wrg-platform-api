import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, afterEach, before, beforeEach, describe, it } from "node:test";
import { PrismaService } from "../../src/database/prisma.service.js";
import { ProgramZohoResyncService } from "../../src/modules/management/compatibility-management.module.js";
import { OrganizationReconciliationService } from "../../src/modules/management/organization-reconciliation.service.js";
import type { ProgramOrganization } from "../../src/modules/crm-sync/compatibility-zoho.module.js";

// Opt in with an isolated database with the schema already applied; never use the app's DATABASE_URL.
const testUrl = process.env.RECONCILIATION_TEST_DATABASE_URL;
if (testUrl && !new URL(testUrl).pathname.endsWith("_test"))
  throw new Error(
    "Reconciliation integration tests require a dedicated database ending in _test",
  );

describe("organization reconciliation (PostgreSQL)", { skip: !testUrl }, () => {
  let prisma: PrismaService;
  let service: OrganizationReconciliationService;
  let resync: ProgramZohoResyncService;
  let ids: Record<
    | "project"
    | "current"
    | "historical"
    | "source"
    | "target"
    | "admin"
    | "client"
    | "enrollment"
    | "respondent"
    | "response"
    | "order"
    | "asset"
    | "grant"
    | "survey"
    | "question"
    | "upload",
    string
  >;
  let crmRows: ProgramOrganization[];
  let extraOrganizationIds: string[];
  const principal = () => ({
    sub: ids.admin,
    roles: ["admin"],
    permissions: [],
    organizationId: null,
  });
  before(async () => {
    process.env.DATABASE_URL = testUrl;
    prisma = new PrismaService();
    await prisma.$connect();
  });
  after(async () => {
    await prisma.$disconnect();
  });
  beforeEach(async () => {
    extraOrganizationIds = [];
    ids = Object.fromEntries(
      [
        "project",
        "current",
        "historical",
        "source",
        "target",
        "admin",
        "client",
        "enrollment",
        "respondent",
        "response",
        "order",
        "asset",
        "grant",
        "survey",
        "question",
        "upload",
      ].map((key) => [key, randomUUID()]),
    ) as typeof ids;
    await prisma.project.create({
      data: { id: ids.project, name: "Reconciliation QA", slug: ids.project },
    });
    await prisma.program.createMany({
      data: [
        {
          id: ids.current,
          projectId: ids.project,
          name: "Healthcare 2026",
          year: 2026,
          externalId: ids.current,
        },
        {
          id: ids.historical,
          projectId: ids.project,
          name: "Healthcare 2025",
          year: 2025,
        },
      ],
    });
    await prisma.organization.createMany({
      data: [
        {
          id: ids.source,
          name: "Rio Grande Regional Hospital",
          slug: ids.source,
          stripeCustomerId: `stripe-${ids.source}`,
          legacyId: `legacy-${ids.source}`,
          metadata: { historicalDetail: "preserve me" },
        },
        {
          id: ids.target,
          name: "Rio Grande Regional Hospital",
          slug: ids.target,
          zohoAccountId: `zoho-${ids.target}`,
        },
      ],
    });
    await prisma.organizationProgram.createMany({
      data: [
        {
          id: ids.enrollment,
          organizationId: ids.source,
          programId: ids.current,
          projectId: ids.project,
          metrics: {
            Source_Organization_ID: "243",
            Source_Organization_Name: "Rio Grande Regional Hospital",
          },
          reportAccess: { RD_Access: "yes" },
          paymentDetails: { paid: true },
        },
        {
          organizationId: ids.target,
          programId: ids.historical,
          projectId: ids.project,
        },
      ],
    });
    await prisma.user.createMany({
      data: [
        {
          id: ids.admin,
          email: `${ids.admin}@test.invalid`,
          fullName: "Administrator",
          passwordHash: "unused",
        },
        {
          id: ids.client,
          email: `${ids.client}@test.invalid`,
          fullName: "Client",
          passwordHash: "unused",
          organizationId: ids.source,
          organizationProgramId: ids.enrollment,
        },
      ],
    });
    await prisma.survey.create({
      data: {
        id: ids.survey,
        programId: ids.current,
        title: "Employee feedback",
      },
    });
    await prisma.question.create({
      data: {
        id: ids.question,
        surveyId: ids.survey,
        dataLabel: "Q1",
        caption: "Question",
        type: "number",
        position: 1,
      },
    });
    await prisma.respondent.create({
      data: {
        id: ids.respondent,
        organizationId: ids.source,
        surveyId: ids.survey,
        status: "complete",
        responses: {
          create: { id: ids.response, questionId: ids.question, value: 5 },
        },
      },
    });
    await prisma.order.create({
      data: {
        id: ids.order,
        organizationId: ids.source,
        organizationProgramId: ids.enrollment,
        status: "PAID",
        amountMinor: 100,
        currency: "USD",
        items: [],
      },
    });
    await prisma.asset.create({
      data: {
        id: ids.asset,
        organizationId: ids.source,
        key: ids.asset,
        bucket: "test",
        contentType: "text/plain",
        sizeBytes: 3,
      },
    });
    await prisma.customReportUpload.create({
      data: {
        id: ids.upload,
        organizationProgramId: ids.enrollment,
        reportName: "Report",
        description: "Preserved",
        sourceFileName: "report.pdf",
        contentType: "application/pdf",
        sizeBytes: 3,
        contents: Buffer.from("pdf"),
      },
    });
    await prisma.keyImpactAnalysisRow.create({
      data: {
        organizationProgramId: ids.enrollment,
        position: 1,
        label: "Label",
        key: "key",
        value: "7",
      },
    });
    await prisma.keyImpactAnalysisUpload.create({
      data: { organizationProgramId: ids.enrollment, rows: [{ value: "7" }] },
    });
    await prisma.auditLog.create({
      data: {
        organizationId: ids.source,
        action: "historical",
        resourceType: "Organization",
      },
    });
    await prisma.impersonationGrant.create({
      data: {
        id: ids.grant,
        organizationId: ids.source,
        programId: ids.current,
        actorUserId: ids.admin,
        targetUserId: ids.client,
        tokenHash: "unused",
        expiresAt: new Date(Date.now() + 60000),
      },
    });
    crmRows = [
      {
        organizationId: "243",
        zohoAccountId: `zoho-${ids.target}`,
        organizationName: "Rio Grande Regional Hospital",
        isWinner: "Y",
        surveysSent: 100,
        stage: "Closed",
        companySize: 100,
        employeesCount: 100,
        currentZohoCategory: "Small",
        reportCategory: "100-199",
        overallRank: "1",
        categoryRank: "1",
        purchasedEvSortingFilter: null,
        rdPaymentType: null,
        kiaPaymentType: null,
      },
    ];
    resync = new ProgramZohoResyncService(prisma, {
      listOrganizationsForProgram: () => Promise.resolve(crmRows),
    } as never);
    service = new OrganizationReconciliationService(prisma, resync);
  });
  afterEach(async () => {
    // All IDs originate from this fixture; never clean up unrelated application data.
    await prisma.impersonationGrant.deleteMany({
      where: { actorUserId: ids.admin },
    });
    await prisma.auditLog.deleteMany({
      where: {
        OR: [
          { actorUserId: ids.admin },
          { organizationId: { in: [ids.source, ids.target] } },
        ],
      },
    });
    await prisma.asset.deleteMany({ where: { id: ids.asset } });
    await prisma.order.deleteMany({ where: { id: ids.order } });
    await prisma.user.deleteMany({
      where: { id: { in: [ids.admin, ids.client] } },
    });
    await prisma.project.delete({ where: { id: ids.project } });
    await prisma.organization.deleteMany({
      where: { id: { in: [ids.source, ids.target, ...extraOrganizationIds] } },
    });
  });

  it("reports the exact resync conflict read-only, merges related data, and unblocks resync", async () => {
    await assert.rejects(
      resync.preview(principal(), ids.current),
      /Cannot resync: 1 organization account mapping conflict/,
    );
    const before = await prisma.organizationProgram.findUniqueOrThrow({
      where: { id: ids.enrollment },
    });
    const report = await service.report(principal(), ids.current);
    assert.equal(report.conflicts.length, 1);
    const conflict = report.conflicts[0];
    assert.ok(conflict?.source);
    assert.ok(conflict.target);
    assert.equal(conflict.matchedBy, "sourceId");
    assert.equal(conflict.source.counts.respondents, 1);
    assert.equal(conflict.source.counts.responses, 1);
    assert.equal(conflict.source.counts.customReportUploads, 1);
    assert.equal(conflict.target.programs[0]?.year, 2025);
    const preview = await service.preview(principal(), ids.current, {
      conflictIds: [ids.enrollment],
    });
    assert.deepEqual(
      await prisma.organizationProgram.findUniqueOrThrow({
        where: { id: ids.enrollment },
      }),
      before,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: { action: "organization.reconcile", actorUserId: ids.admin },
      }),
      0,
    );
    assert.deepEqual(await service.apply(principal(), ids.current, preview), {
      programId: ids.current,
      appliedCount: 1,
    });
    const after = await prisma.organizationProgram.findUniqueOrThrow({
      where: { id: ids.enrollment },
    });
    assert.equal(after.organizationId, ids.target);
    assert.deepEqual(after.metrics, before.metrics);
    assert.deepEqual(after.reportAccess, before.reportAccess);
    assert.deepEqual(after.paymentDetails, before.paymentDetails);
    assert.equal(
      (await prisma.user.findUniqueOrThrow({ where: { id: ids.client } }))
        .organizationId,
      ids.target,
    );
    assert.equal(
      (
        await prisma.respondent.findUniqueOrThrow({
          where: { id: ids.respondent },
        })
      ).organizationId,
      ids.target,
    );
    assert.equal(
      (await prisma.response.findUniqueOrThrow({ where: { id: ids.response } }))
        .value,
      5,
    );
    assert.equal(
      (await prisma.order.findUniqueOrThrow({ where: { id: ids.order } }))
        .organizationId,
      ids.target,
    );
    assert.equal(
      (await prisma.asset.findUniqueOrThrow({ where: { id: ids.asset } }))
        .organizationId,
      ids.target,
    );
    assert.equal(
      (
        await prisma.customReportUpload.findUniqueOrThrow({
          where: { id: ids.upload },
        })
      ).organizationProgramId,
      ids.enrollment,
    );
    assert.equal(
      await prisma.keyImpactAnalysisRow.count({
        where: { organizationProgramId: ids.enrollment },
      }),
      1,
    );
    assert.equal(
      await prisma.keyImpactAnalysisUpload.count({
        where: { organizationProgramId: ids.enrollment },
      }),
      1,
    );
    const grant = await prisma.impersonationGrant.findUniqueOrThrow({
      where: { id: ids.grant },
    });
    assert.equal(grant.organizationId, ids.target);
    assert.ok(grant.revokedAt);
    assert.equal(
      await prisma.organization.findUnique({ where: { id: ids.source } }),
      null,
    );
    const target = await prisma.organization.findUniqueOrThrow({
      where: { id: ids.target },
    });
    assert.equal(target.stripeCustomerId, `stripe-${ids.source}`);
    assert.equal(target.legacyId, `legacy-${ids.source}`);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { actorUserId: ids.admin, action: "organization.reconcile" },
    });
    assert.ok(JSON.stringify(audit.before).includes("preserve me"));
    assert.equal(
      (await service.report(principal(), ids.current)).conflicts.length,
      0,
    );
    assert.equal(
      (await resync.preview(principal(), ids.current)).changedRows.length,
      1,
    );
    await assert.rejects(
      service.apply(principal(), ids.current, preview),
      /no longer exists/,
    );
  });

  it("blocks same-program duplicates and differing verified account links", async () => {
    await prisma.organizationProgram.create({
      data: {
        organizationId: ids.target,
        programId: ids.current,
        projectId: ids.project,
      },
    });
    // by-account matching would select the owner; use a second CRM deal to reach the duplicate.
    crmRows = [{ ...firstCrmRow(), organizationId: "owner" }, ...crmRows];
    const report = await service.report(principal(), ids.current);
    assert.equal(report.conflicts[0]?.eligible, false);
    assert.match(
      report.conflicts[0].blockers.join(" "),
      /Both organizations are enrolled/,
    );
    await assert.rejects(
      service.preview(principal(), ids.current, {
        conflictIds: [ids.enrollment],
      }),
      /Both organizations/,
    );
    await prisma.organization.update({
      where: { id: ids.source },
      data: { zohoAccountId: `wrong-${ids.source}` },
    });
    assert.match(
      (
        await service.report(principal(), ids.current)
      ).conflicts[0]?.blockers.join(" ") ?? "",
      /already has a Zoho account/,
    );
  });

  it("rejects stale previews including new related data and changed CRM matches", async () => {
    let preview = await service.preview(principal(), ids.current, {
      conflictIds: [ids.enrollment],
    });
    await prisma.auditLog.create({
      data: {
        organizationId: ids.source,
        resourceType: "Organization",
        action: "new-related-row",
      },
    });
    await assert.rejects(
      service.apply(principal(), ids.current, preview),
      /data changed/,
    );
    assert.ok(
      await prisma.organization.findUnique({ where: { id: ids.source } }),
    );
    preview = await service.preview(principal(), ids.current, {
      conflictIds: [ids.enrollment],
    });
    firstCrmRow().organizationName = "A different incoming company";
    await assert.rejects(
      service.apply(principal(), ids.current, preview),
      /data changed/,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: { action: "organization.reconcile", actorUserId: ids.admin },
      }),
      0,
    );
  });

  it("rolls the entire repair back if writing the audit record fails", async () => {
    const preview = await service.preview(principal(), ids.current, {
      conflictIds: [ids.enrollment],
    });
    // Missing actor FK makes the final audit insert fail after data was reassigned.
    await assert.rejects(
      service.apply(
        { ...principal(), sub: randomUUID() },
        ids.current,
        preview,
      ),
      /data changed/,
    );
    assert.ok(
      await prisma.organization.findUnique({ where: { id: ids.source } }),
    );
    assert.equal(
      (
        await prisma.organizationProgram.findUniqueOrThrow({
          where: { id: ids.enrollment },
        })
      ).organizationId,
      ids.source,
    );
    assert.equal(
      (
        await prisma.respondent.findUniqueOrThrow({
          where: { id: ids.respondent },
        })
      ).organizationId,
      ids.source,
    );
    assert.equal(
      (
        await prisma.impersonationGrant.findUniqueOrThrow({
          where: { id: ids.grant },
        })
      ).revokedAt,
      null,
    );
  });

  function firstCrmRow() {
    const row = crmRows[0];
    assert.ok(row);
    return row;
  }

  async function addPair(useExistingTarget = false) {
    const source = randomUUID();
    const target = useExistingTarget ? ids.target : randomUUID();
    const enrollment = randomUUID();
    extraOrganizationIds.push(source);
    await prisma.organization.create({
      data: { id: source, name: "West Valley Medical Center", slug: source },
    });
    if (!useExistingTarget) {
      extraOrganizationIds.push(target);
      await prisma.organization.create({
        data: {
          id: target,
          name: "West Valley Medical Center",
          slug: target,
          zohoAccountId: `zoho-${target}`,
        },
      });
    }
    await prisma.organizationProgram.create({
      data: {
        id: enrollment,
        organizationId: source,
        projectId: ids.project,
        programId: ids.current,
        metrics: { Source_Organization_ID: "309" },
      },
    });
    crmRows.push({
      ...firstCrmRow(),
      organizationId: "309",
      zohoAccountId: `zoho-${target}`,
      organizationName: "West Valley Medical Center",
    });
    return { source, target, enrollment };
  }

  it("applies multiple selected conflicts atomically and tolerates CRM response reordering", async () => {
    const second = await addPair();
    const preview = await service.preview(principal(), ids.current, {
      conflictIds: [ids.enrollment, second.enrollment],
    });
    crmRows.reverse();
    assert.equal(
      (await service.apply(principal(), ids.current, preview)).appliedCount,
      2,
    );
    assert.equal(
      (
        await prisma.organizationProgram.findUniqueOrThrow({
          where: { id: second.enrollment },
        })
      ).organizationId,
      second.target,
    );
    assert.equal(
      await prisma.organization.count({
        where: { id: { in: [ids.source, second.source] } },
      }),
      0,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: { action: "organization.reconcile", actorUserId: ids.admin },
      }),
      2,
    );
  });

  it("blocks selected duplicates that would collide at the same destination", async () => {
    const second = await addPair(true);
    const report = await service.report(principal(), ids.current);
    assert.ok(report.conflicts.every((row) => row.eligible));
    await assert.rejects(
      service.preview(principal(), ids.current, {
        conflictIds: [ids.enrollment, second.enrollment],
      }),
      /Selected duplicates overlap/,
    );
    assert.equal(
      (
        await prisma.organizationProgram.findUniqueOrThrow({
          where: { id: ids.enrollment },
        })
      ).organizationId,
      ids.source,
    );
  });

  it("reports ambiguous matches as blocked rows without hiding the report", async () => {
    const second = await addPair();
    await prisma.organizationProgram.update({
      where: { id: second.enrollment },
      data: { metrics: { Source_Organization_ID: "243" } },
    });
    crmRows = [firstCrmRow()];
    await assert.rejects(
      resync.preview(principal(), ids.current),
      /Ambiguous organization match/,
    );
    const report = await service.report(principal(), ids.current);
    assert.equal(report.conflicts.length, 2);
    assert.ok(
      report.conflicts.every(
        (row) =>
          !row.eligible &&
          row.blockers.some((message) =>
            message.includes("Ambiguous organization match"),
          ),
      ),
    );
  });

  it("previews and applies a full batch of 131 conflicts", async () => {
    const pairs = Array.from({ length: 130 }, (_, index) => ({
      source: randomUUID(),
      target: randomUUID(),
      enrollment: randomUUID(),
      sourceId: String(1000 + index),
      name: `Bulk organization ${index}`,
    }));
    extraOrganizationIds.push(
      ...pairs.flatMap((pair) => [pair.source, pair.target]),
    );
    await prisma.organization.createMany({
      data: pairs.flatMap((pair) => [
        {
          id: pair.source,
          name: pair.name,
          slug: pair.source,
          zohoAccountId: null,
        },
        {
          id: pair.target,
          name: pair.name,
          slug: pair.target,
          zohoAccountId: `zoho-${pair.target}`,
        },
      ]),
    });
    await prisma.organizationProgram.createMany({
      data: pairs.map((pair) => ({
        id: pair.enrollment,
        organizationId: pair.source,
        projectId: ids.project,
        programId: ids.current,
        metrics: { Source_Organization_ID: pair.sourceId },
      })),
    });
    crmRows.push(
      ...pairs.map((pair) => ({
        ...firstCrmRow(),
        organizationId: pair.sourceId,
        zohoAccountId: `zoho-${pair.target}`,
        organizationName: pair.name,
      })),
    );
    const report = await service.report(principal(), ids.current);
    assert.equal(report.conflicts.length, 131);
    assert.ok(report.conflicts.every((row) => row.eligible));
    const preview = await service.preview(principal(), ids.current, {
      conflictIds: report.conflicts.map((row) => row.id),
    });
    assert.equal(preview.merges.length, 131);
    assert.equal(
      (await service.apply(principal(), ids.current, preview)).appliedCount,
      131,
    );
    assert.equal(
      (await service.report(principal(), ids.current)).conflicts.length,
      0,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: { action: "organization.reconcile", actorUserId: ids.admin },
      }),
      131,
    );
  });

  it("blocks incompatible billing identities", async () => {
    await prisma.organization.update({
      where: { id: ids.target },
      data: { stripeCustomerId: `other-${ids.target}` },
    });
    assert.match(
      (
        await service.report(principal(), ids.current)
      ).conflicts[0]?.blockers.join(" ") ?? "",
      /different Stripe customers/,
    );
    await assert.rejects(
      service.preview(principal(), ids.current, {
        conflictIds: [ids.enrollment],
      }),
      /different Stripe customers/,
    );
  });

  it("allows only one of two concurrent applications of the same preview", async () => {
    const preview = await service.preview(principal(), ids.current, {
      conflictIds: [ids.enrollment],
    });
    const outcomes = await Promise.allSettled([
      service.apply(principal(), ids.current, preview),
      service.apply(principal(), ids.current, preview),
    ]);
    assert.equal(
      outcomes.filter((result) => result.status === "fulfilled").length,
      1,
    );
    assert.equal(
      outcomes.filter((result) => result.status === "rejected").length,
      1,
    );
    assert.equal(
      await prisma.auditLog.count({
        where: { action: "organization.reconcile", actorUserId: ids.admin },
      }),
      1,
    );
  });

  it("records the existing local administrator bypass without requiring a synthetic user", async () => {
    const actor = {
      ...principal(),
      sub: "bypass-login-auth",
      localAuthBypass: true,
    };
    const preview = await service.preview(actor, ids.current, {
      conflictIds: [ids.enrollment],
    });
    assert.equal(
      (await service.apply(actor, ids.current, preview)).appliedCount,
      1,
    );
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { resourceId: ids.source, action: "organization.reconcile" },
    });
    assert.equal(audit.actorUserId, null);
    assert.ok(JSON.stringify(audit.after).includes("bypass-login-auth"));
  });

  it("rejects non-admins, malformed selections and arbitrary destinations", async () => {
    const client = {
      ...principal(),
      roles: ["client"],
      permissions: ["syncCheckmartketAndZohoAccess"],
    };
    await assert.rejects(service.report(client, ids.current), /Administrator/);
    await assert.rejects(
      service.preview(client, ids.current, { conflictIds: [ids.enrollment] }),
      /Administrator/,
    );
    await assert.rejects(
      service.apply(client, ids.current, {
        conflictIds: [ids.enrollment],
        revision: "a".repeat(64),
      }),
      /Administrator/,
    );
    for (const body of [
      null,
      {},
      { conflictIds: [] },
      { conflictIds: [ids.enrollment, ids.enrollment] },
      { conflictIds: [42] },
    ]) {
      await assert.rejects(
        service.preview(principal(), ids.current, body),
        /distinct conflict IDs/,
      );
    }
    await assert.rejects(
      service.preview(principal(), ids.current, { conflictIds: [ids.target] }),
      /no longer exists/,
    );
    await assert.rejects(
      service.apply(principal(), ids.current, {
        conflictIds: [ids.enrollment],
        revision: "invalid",
      }),
      /valid reconciliation preview/,
    );
  });
});
