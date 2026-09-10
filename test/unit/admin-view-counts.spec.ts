import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompatibilityAdminService } from "../../src/modules/management/compatibility-admin.module.js";

describe("admin view counts", () => {
  it("returns totals matching each countable sidebar view", async () => {
    const countCalls: Array<{ model: string; where: unknown }> = [];
    const count = (model: string, value: number) => (args?: unknown) => {
      countCalls.push({ model, where: args });
      return Promise.resolve(value);
    };
    const service = new CompatibilityAdminService(
      {
        project: { count: count("project", 4) },
        user: { count: count("user", 5) },
        order: { count: count("order", 8) },
        auditLog: { count: count("auditLog", 13) },
        role: { count: count("role", 3) },
      } as never,
      {} as never,
      {} as never,
    );
    service.pendingKeyImpactAnalyses = () =>
      Promise.resolve({
        success: true,
        data: [{}, {}] as never,
      });

    const response = await service.viewCounts({
      sub: "admin-id",
      organizationId: null,
      roles: ["admin"],
      permissions: [],
    });

    assert.deepEqual(response.data, {
      projects: 4,
      users: 5,
      keyImpactAnalyses: 2,
      orders: 8,
      activity: 13,
      roles: 3,
    });
    assert.deepEqual(countCalls.find(({ model }) => model === "user")?.where, {
      where: { status: { not: "DISABLED" } },
    });
    assert.deepEqual(countCalls.find(({ model }) => model === "order")?.where, {
      where: {
        status: {
          in: ["PENDING", "PAID", "INVOICED", "REQUIRES_PAYMENT"],
        },
      },
    });
  });
});
