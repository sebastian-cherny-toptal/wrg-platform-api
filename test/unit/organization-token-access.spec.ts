import assert from "node:assert/strict";
import { it } from "node:test";
import {
  JwtStrategy,
  type Principal,
} from "../../src/modules/auth/auth.module.js";

it("rejects existing tokens after organization reassignment or disabling an account", async () => {
  let current = { organizationId: "old", status: "ACTIVE" };
  const strategy = new JwtStrategy(
    {
      get: (key: string) =>
        key === "JWT_ACCESS_SECRET"
          ? "test-secret-that-is-at-least-32-characters"
          : false,
    } as never,
    { user: { findUnique: () => current } } as never,
  );
  const principal: Principal = {
    sub: "user-1",
    organizationId: "old",
    roles: ["client"],
    permissions: [],
  };
  assert.equal(await strategy.validate(principal), principal);
  current = { organizationId: "new", status: "ACTIVE" };
  await assert.rejects(strategy.validate(principal), /Account access changed/);
  assert.equal(
    (await strategy.validate({ ...principal, organizationId: "new" }))
      .organizationId,
    "new",
  );
  current.status = "DISABLED";
  await assert.rejects(
    strategy.validate({ ...principal, organizationId: "new" }),
    /Account access changed/,
  );
});
