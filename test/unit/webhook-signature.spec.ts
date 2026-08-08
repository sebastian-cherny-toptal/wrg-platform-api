import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { describe, it } from "node:test";
import type { ConfigService } from "@nestjs/config";
import type { Env } from "../../src/config/env.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { SyncQueue } from "../../src/modules/crm-sync/crm-sync.module.js";
import {
  verifySharedSignature,
  WebhookIngestionService,
} from "../../src/modules/integrations/webhooks.controller.js";

describe("shared webhook signatures", () => {
  it("accepts a current valid signature and rejects tampering", () => {
    const secret = "a-long-shared-test-secret";
    const timestamp = String(Math.floor(Date.now() / 1_000));
    const body = Buffer.from('{"id":"event-1"}');
    const signature = `sha256=${createHmac("sha256", secret).update(timestamp).update(".").update(body).digest("hex")}`;

    assert.equal(
      verifySharedSignature(body, signature, timestamp, secret),
      true,
    );
    assert.equal(
      verifySharedSignature(
        Buffer.from("tampered"),
        signature,
        timestamp,
        secret,
      ),
      false,
    );
  });

  it("rejects stale signatures", () => {
    const timestamp = String(Math.floor(Date.now() / 1_000) - 301);
    assert.equal(
      verifySharedSignature(
        Buffer.from("{}"),
        "sha256=invalid",
        timestamp,
        "a-long-shared-test-secret",
      ),
      false,
    );
  });
});

describe("CheckMarket webhook ingestion", () => {
  it("upserts a completed respondent and its normalized responses", async () => {
    const calls: string[] = [];
    const prisma = {
      webhookEvent: {
        upsert: () => Promise.resolve({ id: "webhook-event-1" }),
        update: () => Promise.resolve(calls.push("event-processed")),
      },
      survey: {
        findFirst: () => Promise.resolve({ id: "survey-1" }),
      },
      organization: {
        findFirst: () => Promise.resolve({ id: "organization-1" }),
      },
      respondent: {
        upsert: (input: { create: { completedAt: Date | null } }) => {
          assert.ok(input.create.completedAt instanceof Date);
          calls.push("respondent-upserted");
          return Promise.resolve({ id: "respondent-1" });
        },
      },
      question: {
        findFirst: () => Promise.resolve({ id: "question-1" }),
      },
      response: {
        upsert: () => Promise.resolve(calls.push("response-upserted")),
      },
    } as unknown as PrismaService;
    const queue = {
      enqueue: (payload: { kind: string; externalId?: string }) => {
        calls.push(`queued:${payload.kind}:${payload.externalId ?? ""}`);
        return Promise.resolve({});
      },
    } as unknown as SyncQueue;
    const config = {
      get: (key: keyof Env) =>
        key === "STRIPE_SECRET_KEY" ? "sk_test_mock" : "whsec_test_mock",
    } as unknown as ConfigService<Env, true>;
    const service = new WebhookIngestionService(config, prisma, queue);

    await service.checkMarket(
      {
        Data: {
          SurveyId: 99,
          Respondent: {
            RespondentId: 42,
            OrgId: 58,
            RespondentStatusId: 1,
            Responses: [
              {
                Id: 7,
                QuestionId: 11,
                DataLabel: "q_YourJob1",
                ResponseCaption: "Agree",
              },
            ],
          },
        },
      },
      "respondent.complete",
      false,
    );

    assert.deepEqual(calls, [
      "respondent-upserted",
      "response-upserted",
      "event-processed",
      "queued:survey:99",
    ]);
  });

  it("queues CheckMarket activation challenges without respondent writes", async () => {
    const queued: Array<{ kind: string; externalId?: string }> = [];
    const prisma = {
      webhookEvent: { upsert: () => Promise.resolve({ id: "event-1" }) },
    } as unknown as PrismaService;
    const queue = {
      enqueue: (payload: { kind: string; externalId?: string }) => {
        queued.push(payload);
        return Promise.resolve({});
      },
    } as unknown as SyncQueue;
    const config = {
      get: (key: keyof Env) =>
        key === "STRIPE_SECRET_KEY" ? "sk_test_mock" : "whsec_test_mock",
    } as unknown as ConfigService<Env, true>;
    const service = new WebhookIngestionService(config, prisma, queue);

    await service.checkMarket(
      { Data: { ActivationRequired: true, WebhookId: "hook-1" } },
      "respondent.complete",
      false,
    );

    assert.deepEqual(queued, [{
      provider: "checkmarket",
      kind: "activate",
      externalId: "hook-1",
    }]);
  });
});
