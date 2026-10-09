import assert from "node:assert/strict";
import { it } from "node:test";
import type { PrismaService } from "../../src/database/prisma.service.js";
import { CompatibilityAdminService } from "../../src/modules/management/compatibility-admin.module.js";

it("shows the downloader's username and organization on existing download events", async () => {
  const event = {
    action: "report.downloaded",
    after: { report: "Employee Verbatims Report" },
    actor: { username: "client-user" },
    organization: { name: "Client Organization" },
  };
  const prisma = {
    auditLog: {
      findMany: () => Promise.resolve([event]),
      count: () => Promise.resolve(1),
    },
    $transaction: (queries: Promise<unknown>[]) => Promise.all(queries),
  } as unknown as PrismaService;
  const service = new CompatibilityAdminService(
    prisma,
    {} as ConstructorParameters<typeof CompatibilityAdminService>[1],
    {} as ConstructorParameters<typeof CompatibilityAdminService>[2],
  );
  const result = await service.systemLogs(
    { sub: "admin", organizationId: null, roles: ["admin"], permissions: [] },
    1,
    10,
  );
  assert.deepEqual(result.data[0]?.after, {
    report: "Employee Verbatims Report",
    username: "client-user",
    organizationName: "Client Organization",
  });
});
