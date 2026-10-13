import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { CompatibilityAdminService } from "../../src/modules/management/compatibility-admin.module.js";
import { CompatibilityPaymentService } from "../../src/modules/commerce/compatibility-payment.module.js";
const principal = {
  sub: "admin",
  organizationId: null,
  roles: ["admin"],
  permissions: [],
};
const id = "11111111-1111-4111-8111-111111111111";
function setup(programs = 0, users = 0, found = true) {
  let deleted = false;
  const transaction = {
    organization: {
      findUnique: () =>
        Promise.resolve(found ? { _count: { programs, users } } : null),
      delete: () => {
        deleted = true;
        return Promise.resolve();
      },
    },
  };
  const service = new CompatibilityAdminService(
    {
      $transaction: (
        callback: (value: typeof transaction) => Promise<unknown>,
      ) => callback(transaction),
    } as never,
    {} as never,
    {} as never,
  );
  return { service, deleted: () => deleted };
}
describe("organization directory", () => {
  it("bulk deletes only organizations with neither programs nor users in a serializable transaction", async () => {
    let called = false;
    const transaction = {
      organization: {
        deleteMany: (args: unknown) => {
          called = true;
          assert.deepEqual(args, {
            where: { programs: { none: {} }, users: { none: {} } },
          });
          return Promise.resolve({ count: 3 });
        },
      },
    };
    const service = new CompatibilityAdminService(
      {
        $transaction: async (
          callback: (value: typeof transaction) => Promise<unknown>,
          options: unknown,
        ) => {
          assert.deepEqual(options, { isolationLevel: "Serializable" });
          return callback(transaction);
        },
      } as never,
      {} as never,
      {} as never,
    );
    await assert.rejects(
      service.deleteEmptyOrganizations({ ...principal, roles: ["client"] }),
      /Administrator access required/,
    );
    assert.equal(called, false);
    assert.deepEqual(await service.deleteEmptyOrganizations(principal), {
      success: true,
      data: { deletedCount: 3 },
    });
    assert.equal(called, true);
  });
  it("deletes an organization with no programs or users", async () => {
    const context = setup();
    assert.deepEqual(await context.service.deleteOrganization(principal, id), {
      success: true,
    });
    assert.equal(context.deleted(), true);
  });
  for (const [programs, users] of [
    [1, 0],
    [0, 1],
    [1, 1],
  ]) {
    it(`rejects deletion with ${programs} programs and ${users} users`, async () => {
      const context = setup(programs, users);
      await assert.rejects(
        context.service.deleteOrganization(principal, id),
        /Remove this organization/,
      );
      assert.equal(context.deleted(), false);
    });
  }
  it("rejects non-admins", async () => {
    const context = setup();
    await assert.rejects(
      context.service.deleteOrganization(
        { ...principal, roles: ["client"] },
        id,
      ),
      /Administrator access required/,
    );
    await assert.rejects(
      context.service.organizationDirectory({
        ...principal,
        roles: ["client"],
      }),
      /Administrator access required/,
    );
  });
  it("denies clients access to historical orders without an organization", async () => {
    const service = new CompatibilityPaymentService(
      {
        order: {
          findUnique: () =>
            Promise.resolve({ organizationId: null, status: "PAID" }),
        },
      } as never,
      { get: () => "sk_test_example" } as never,
      {} as never,
    );
    await assert.rejects(
      service.confirmPaidOrder(
        { ...principal, roles: ["client"] },
        { paymentIntentId: "pi_history" },
      ),
      /Order access denied/,
    );
  });
  it("rejects missing organizations", async () => {
    await assert.rejects(
      setup(0, 0, false).service.deleteOrganization(principal, id),
      /Organization not found/,
    );
  });
  it("lists all programs and users and deduplicates projects", async () => {
    const project = { id: "project", name: "Project" };
    const service = new CompatibilityAdminService(
      {
        organization: {
          findMany: () =>
            Promise.resolve([
              {
                id,
                externalId: "external",
                name: "Organization",
                users: [
                  { id: "user", fullName: "User", email: "user@test.com" },
                ],
                programs: [
                  { project, program: { id: "a", name: "A" } },
                  { project, program: { id: "b", name: "B" } },
                ],
              },
            ]),
        },
      } as never,
      {} as never,
      {} as never,
    );
    const response = await service.organizationDirectory(principal);
    assert.ok(response.data[0]);
    assert.equal(response.data[0].displayId, "external");
    assert.deepEqual(response.data[0].projects, [project]);
    assert.equal(response.data[0].programs.length, 2);
    assert.equal(response.data[0].users.length, 1);
  });
});
