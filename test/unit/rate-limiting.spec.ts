import { Controller, Get, Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { ThrottlerModule } from "@nestjs/throttler";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  globalRateLimit,
  rateLimitingProviders,
} from "../../src/common/http/rate-limiting.js";
import {
  AuthController,
  AuthService,
} from "../../src/modules/auth/auth.module.js";
import {
  AccountAccessController,
  AccountAccessService,
} from "../../src/modules/users/account-access.module.js";
import {
  ClientLoginController,
  ClientLoginService,
} from "../../src/modules/users/users.module.js";

@Controller("rate-limit-probe")
class RateLimitProbeController {
  @Get()
  probe() {
    return { ok: true };
  }
}

@Module({
  imports: [ThrottlerModule.forRoot([globalRateLimit])],
  controllers: [RateLimitProbeController],
  providers: [...rateLimitingProviders],
})
class RateLimitProbeModule {}

@Module({
  imports: [ThrottlerModule.forRoot([globalRateLimit])],
  controllers: [AuthController, AccountAccessController, ClientLoginController],
  providers: [
    ...rateLimitingProviders,
    { provide: AuthService, useValue: {} },
    { provide: AccountAccessService, useValue: {} },
    { provide: ClientLoginService, useValue: {} },
  ],
})
class AuthenticationRateLimitModule {}

async function createTestApp(module: new (...args: never[]) => unknown) {
  const app = await NestFactory.create<NestFastifyApplication>(
    module,
    new FastifyAdapter(),
    { logger: false, abortOnError: false },
  );
  await app.init();
  return app;
}

async function expectRateLimit(input: {
  app: NestFastifyApplication;
  method: "POST" | "PUT";
  url: string;
  allowedRequests: number;
}) {
  for (let request = 0; request < input.allowedRequests; request += 1) {
    const response = await input.app.inject({
      method: input.method,
      url: input.url,
      payload: {},
    });
    assert.notEqual(response.statusCode, 429, response.body);
  }

  const limited = await input.app.inject({
    method: input.method,
    url: input.url,
    payload: {},
  });
  assert.equal(limited.statusCode, 429, limited.body);
}

describe("application rate limiting", () => {
  it("rejects requests beyond the configured global limit", async () => {
    const app = await createTestApp(RateLimitProbeModule);

    try {
      for (let request = 0; request < 120; request += 1) {
        const response = await app.inject({
          method: "GET",
          url: "/rate-limit-probe",
        });
        assert.equal(response.statusCode, 200);
      }

      const limited = await app.inject({
        method: "GET",
        url: "/rate-limit-probe",
      });
      assert.equal(limited.statusCode, 429, limited.body);
    } finally {
      await app.close();
    }
  });

  it("applies tighter limits to login routes", async () => {
    const app = await createTestApp(AuthenticationRateLimitModule);

    try {
      await expectRateLimit({
        app,
        method: "POST",
        url: "/auth/login",
        allowedRequests: 10,
      });
      await expectRateLimit({
        app,
        method: "POST",
        url: "/user/login",
        allowedRequests: 10,
      });
      await expectRateLimit({
        app,
        method: "POST",
        url: "/user/management/login",
        allowedRequests: 10,
      });
    } finally {
      await app.close();
    }
  });

  it("applies tighter limits to OTP, recovery, and username discovery", async () => {
    const app = await createTestApp(AuthenticationRateLimitModule);

    try {
      await expectRateLimit({
        app,
        method: "PUT",
        url: "/user/management/login",
        allowedRequests: 5,
      });
      await expectRateLimit({
        app,
        method: "POST",
        url: "/user/forgot-password",
        allowedRequests: 5,
      });
      await expectRateLimit({
        app,
        method: "POST",
        url: "/user/forgot-username",
        allowedRequests: 5,
      });
    } finally {
      await app.close();
    }
  });
});
