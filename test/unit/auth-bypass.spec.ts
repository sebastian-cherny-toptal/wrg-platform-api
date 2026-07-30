import type { ExecutionContext } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  JwtAuthGuard,
  type Principal,
} from "../../src/modules/auth/auth.module.js";
import { validateEnv, type Env } from "../../src/config/env.js";

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

describe("login authentication bypass", () => {
  it("defaults to disabled and parses the true value", () => {
    assert.equal(validateEnv(validEnvironment).BYPASS_LOGIN_AUTH, false);
    assert.equal(
      validateEnv({ ...validEnvironment, BYPASS_LOGIN_AUTH: "true" })
        .BYPASS_LOGIN_AUTH,
      true,
    );
  });

  it("allows requests through with a development principal when enabled", () => {
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
    });
  });
});
