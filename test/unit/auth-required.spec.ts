import assert from "node:assert/strict";
import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import { describe, it } from "node:test";
import { validateEnv, type Env } from "../../src/config/env.js";
import {
  JwtAuthGuard,
  type Principal,
} from "../../src/modules/auth/auth.module.js";

const validEnvironment = {
  NODE_ENV: "test",
  DATABASE_URL: "postgresql://wrg:wrg@localhost:5432/wrg",
  REDIS_URL: "redis://localhost:6379",
  JWT_ACCESS_SECRET: "test-access-secret-that-is-at-least-32-characters",
  JWT_REFRESH_SECRET: "test-refresh-secret-that-is-at-least-32-characters",
  STRIPE_SECRET_KEY: "sk_test_mock",
  STRIPE_WEBHOOK_SECRET: "whsec_test_mock",
  ZOHO_BASE_URL: "http://localhost:3000/mock/zoho",
  ZOHO_CLIENT_ID: "local-mock",
  ZOHO_CLIENT_SECRET: "local-mock",
  ZOHO_WEBHOOK_SECRET: "change-me-zoho-webhook",
  CHECKMARKET_BASE_URL: "http://localhost:3000/mock/checkmarket",
  CHECKMARKET_API_KEY: "local-mock",
  CHECKMARKET_WEBHOOK_SECRET: "change-me-checkmarket-webhook",
};

describe("login authentication configuration", () => {
  it("defaults the bypass off and accepts it outside production", () => {
    assert.equal(validateEnv(validEnvironment).BYPASS_LOGIN_AUTH, false);
    const environment = validateEnv({
      ...validEnvironment,
      BYPASS_LOGIN_AUTH: "true",
    });
    assert.equal(environment.BYPASS_LOGIN_AUTH, true);
  });

  it("rejects the bypass in production", () => {
    assert.throws(
      () =>
        validateEnv({
          ...validEnvironment,
          NODE_ENV: "production",
          BYPASS_LOGIN_AUTH: "true",
        }),
      /BYPASS_LOGIN_AUTH cannot be enabled in production/,
    );
  });

  it("uses a synthetic administrator principal when enabled", () => {
    const request: { user?: Principal; params: Record<string, string> } = {
      params: { organizationId: "organization-1" },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    const config = {
      get: () => true,
    } as unknown as ConfigService<Env, true>;

    assert.equal(new JwtAuthGuard(config).canActivate(context), true);
    assert.deepEqual(request.user, {
      sub: "bypass-login-auth",
      organizationId: "organization-1",
      roles: ["admin"],
      permissions: ["ops.manage"],
      localAuthBypass: true,
    });
  });
});
