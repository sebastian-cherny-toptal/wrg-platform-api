import {
  Injectable,
  Module,
  RequestMethod,
  VersioningType,
} from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { NestFactory } from "@nestjs/core";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExtractJwt, Strategy } from "passport-jwt";
import {
  JwtAuthGuard,
  type Principal,
} from "../../src/modules/auth/auth.module.js";
import {
  CompatibilityWebhookOperationsController,
  CompatibilityWebhookOperationsService,
  CompatibilityWebhookReceiverController,
} from "../../src/modules/integrations/compatibility-webhooks.module.js";
import { WebhookIngestionService } from "../../src/modules/integrations/webhooks.controller.js";

const testJwtSecret = "test-secret-that-is-at-least-32-characters";
const receiverCalls: string[] = [];
const operationCalls: string[] = [];

const ingestionStub = {
  checkMarket: (_body: unknown, eventType: string) => {
    receiverCalls.push(`checkmarket:${eventType}`);
    return { queued: true as const };
  },
  zoho: (_body: unknown, eventType: string) => {
    receiverCalls.push(`zoho:${eventType}`);
    return { queued: true as const };
  },
  processStripe: () => {
    receiverCalls.push("stripe");
    return { received: true as const };
  },
};

const operationsStub = {
  assertAllowed: () => undefined,
  dealsCount: () => ({ count: 1, dealIds: ["deal-1"] }),
  queue: (_principal: Principal, operation: string) => {
    operationCalls.push(operation);
    return { success: true, message: `${operation} queued`, data: {} };
  },
};

@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: testJwtSecret,
    });
  }

  validate(payload: Principal): Principal {
    return payload;
  }
}

@Module({
  imports: [PassportModule, JwtModule.register({ secret: testJwtSecret })],
  controllers: [
    CompatibilityWebhookReceiverController,
    CompatibilityWebhookOperationsController,
  ],
  providers: [
    { provide: WebhookIngestionService, useValue: ingestionStub },
    {
      provide: CompatibilityWebhookOperationsService,
      useValue: operationsStub,
    },
    TestJwtStrategy,
    JwtAuthGuard,
  ],
})
class CompatibilityWebhooksTestModule {}

async function createTestApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    CompatibilityWebhooksTestModule,
    new FastifyAdapter({ bodyLimit: 2 * 1024 * 1024 }),
    { logger: false, rawBody: true },
  );
  app.setGlobalPrefix("api", {
    exclude: [
      "webhook",
      "webhook/:one",
      "webhook/:one/:two",
      "webhook/:one/:two/:three",
    ].map((path) => ({ path, method: RequestMethod.ALL })),
  });
  app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
  await app.init();
  return app;
}

describe("native webhook compatibility endpoints", () => {
  it("accepts the seven legacy provider callback paths natively", async () => {
    const app = await createTestApp();
    receiverCalls.length = 0;
    try {
      const requests = [
        { method: "POST" as const, url: "/webhook/surveycreated" },
        { method: "POST" as const, url: "/webhook/submittedPage" },
        { method: "POST" as const, url: "/webhook/pageSubmitted" },
        { method: "POST" as const, url: "/webhook/pageComplete" },
        { method: "POST" as const, url: "/webhook/dealsWebhook" },
        { method: "POST" as const, url: "/webhook/dealUpdate" },
        { method: "PUT" as const, url: "/webhook/dealUpdate" },
        {
          method: "POST" as const,
          url: "/webhook/stripe/payment",
          headers: { "stripe-signature": "test-signature" },
        },
      ];
      const responses = await Promise.all(
        requests.map((request) =>
          app.inject({ ...request, payload: { id: "event-1" } }),
        ),
      );
      for (const response of responses) {
        assert.ok(
          response.statusCode >= 200 && response.statusCode < 300,
          response.body,
        );
      }
      const status = await app.inject({ method: "GET", url: "/webhook" });
      assert.equal(status.statusCode, 200);
      assert.equal(status.body, "cool");
      assert.equal(receiverCalls.length, 8);
    } finally {
      await app.close();
    }
  });

  it("protects and serves all former manual webhook operations", async () => {
    const app = await createTestApp();
    operationCalls.length = 0;
    const token = app.get(JwtService).sign({
      sub: "6c79998f-10bd-45af-bdd1-61e11b50297a",
      organizationId: "206ab572-1825-4327-81d7-a4c3524a938a",
      roles: ["admin"],
      permissions: ["ops.manage"],
    } satisfies Principal);
    const headers = { authorization: `Bearer ${token}` };
    const requests = [
      ["POST", "/webhook/syncSurveys"],
      ["POST", "/webhook/syncContacts"],
      ["POST", "/webhook/sendCrmEmails"],
      ["POST", "/webhook/reSyncDataWithCrm"],
      ["POST", "/webhook/v2/reSyncDataWithCrm"],
      ["POST", "/webhook/syncAllRespondents"],
      ["DELETE", "/webhook/deleteDealWithData"],
      ["DELETE", "/webhook/syncDealsWithCrm"],
      ["POST", "/webhook/dealCreatedAll"],
      ["POST", "/webhook/syncProgram"],
      ["POST", "/webhook/syncProject"],
      ["POST", "/webhook/syncOrg"],
      ["POST", "/webhook/sendEmailToAllUsers"],
      ["POST", "/webhook/rankingAnalysisTrigger"],
      ["POST", "/webhook/createProduct"],
      ["POST", "/webhook/massResync"],
      ["POST", "/webhook/massResyncByProgram"],
      ["POST", "/webhook/syncCheckmarketDataWithids"],
      ["POST", "/webhook/responseRateStage"],
    ] as const;
    try {
      const unauthenticated = await app.inject({
        method: "POST",
        url: "/webhook/syncContacts",
        payload: {},
      });
      assert.equal(unauthenticated.statusCode, 401);

      const responses = await Promise.all(
        requests.map(([method, url]) =>
          app.inject({ method, url, headers, payload: {} }),
        ),
      );
      for (const response of responses) {
        assert.ok(
          response.statusCode >= 200 && response.statusCode < 300,
          response.body,
        );
      }
      const deals = await app.inject({
        method: "GET",
        url: "/webhook/getDealsCount",
        headers,
      });
      assert.equal(deals.statusCode, 200, deals.body);
      assert.deepEqual(JSON.parse(deals.body), {
        count: 1,
        dealIds: ["deal-1"],
      });
      assert.equal(operationCalls.length, requests.length);
    } finally {
      await app.close();
    }
  });
});
