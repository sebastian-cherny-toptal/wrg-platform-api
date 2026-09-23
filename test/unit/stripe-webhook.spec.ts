import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { RawBodyRequest } from "@nestjs/common";
import type { ConfigService } from "@nestjs/config";
import type { FastifyRequest } from "fastify";
import type Stripe from "stripe";
import type { Env } from "../../src/config/env.js";
import type { PrismaService } from "../../src/database/prisma.service.js";
import type { CompatibilityPaymentService } from "../../src/modules/commerce/compatibility-payment.module.js";
import { StripeWebhookService } from "../../src/modules/commerce/stripe-webhooks.module.js";

function serviceFixture() {
  const calls: string[] = [];
  const config = {
    get: (key: keyof Env) =>
      key === "STRIPE_SECRET_KEY" ? "sk_test_mock" : "whsec_test_mock",
  } as unknown as ConfigService<Env, true>;
  const prisma = {
    webhookEvent: {
      upsert: () => Promise.resolve({ id: "webhook-1", processedAt: null }),
      update: () => Promise.resolve(calls.push("processed")),
    },
  } as unknown as PrismaService;
  const payments = {
    fulfillPaidOrder: (paymentIntentId: string) => {
      calls.push(`fulfilled:${paymentIntentId}`);
      return Promise.resolve({ success: true });
    },
  } as unknown as CompatibilityPaymentService;
  const service = new StripeWebhookService(config, prisma, payments);
  const event = {
    id: "evt_1",
    type: "payment_intent.succeeded",
    data: { object: { id: "pi_1" } },
  } as Stripe.Event;
  (
    service as unknown as {
      stripe: { webhooks: { constructEvent: () => Stripe.Event } };
    }
  ).stripe = { webhooks: { constructEvent: () => event } };
  return { calls, service };
}

describe("Stripe payment webhook", () => {
  it("requires the Stripe signature and raw request body", async () => {
    const { service } = serviceFixture();
    await assert.rejects(
      service.process({ rawBody: Buffer.from("{}") } as RawBodyRequest<FastifyRequest>, undefined),
      /Missing Stripe signature/u,
    );
  });

  it("fulfills a paid order and marks the event processed", async () => {
    const { calls, service } = serviceFixture();
    const result = await service.process(
      { rawBody: Buffer.from("{}") } as RawBodyRequest<FastifyRequest>,
      "test-signature",
    );
    assert.deepEqual(result, { received: true });
    assert.deepEqual(calls, ["fulfilled:pi_1", "processed"]);
  });
});
