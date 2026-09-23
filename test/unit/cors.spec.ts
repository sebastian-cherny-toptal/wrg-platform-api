import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  corsAllowedOrigins,
  isCorsOriginAllowed,
} from "../../src/config/cors.js";
import { validateEnv } from "../../src/config/env.js";

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
  CHECKMARKET_BASE_URL: "http://localhost:3000/mock/checkmarket",
  CHECKMARKET_API_KEY: "local-mock",
};

describe("CORS configuration", () => {
  it("allows only configured browser origins and requests without Origin", () => {
    const env = validateEnv({
      ...validEnvironment,
      CORS_ALLOWED_ORIGINS:
        "https://client-production.up.railway.app, https://admin-production.up.railway.app",
    });
    const origins = corsAllowedOrigins(env);

    assert.equal(
      isCorsOriginAllowed(
        "https://client-production.up.railway.app",
        origins,
      ),
      true,
    );
    assert.equal(isCorsOriginAllowed("https://attacker.example", origins), false);
    assert.equal(isCorsOriginAllowed(undefined, origins), true);
  });

  it("requires at least one configured browser origin in production", () => {
    assert.throws(
      () => validateEnv({ ...validEnvironment, NODE_ENV: "production" }),
      /Production requires FRONTEND_URL, ADMIN_FRONTEND_URL, or CORS_ALLOWED_ORIGINS/u,
    );
  });
});
