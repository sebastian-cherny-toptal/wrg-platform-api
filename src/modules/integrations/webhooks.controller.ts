import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Headers,
  Inject,
  Injectable,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import Stripe from "stripe";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";
import { SyncQueue } from "../crm-sync/crm-sync.module.js";

export function verifySharedSignature(
  raw: Buffer,
  signature: string | undefined,
  timestamp: string | undefined,
  secret: string,
): boolean {
  if (
    !signature ||
    !timestamp ||
    Math.abs(Date.now() - Number(timestamp) * 1_000) > 300_000
  )
    return false;
  const expected = `sha256=${createHmac("sha256", secret).update(timestamp).update(".").update(raw).digest("hex")}`;
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  return (
    actualBuffer.length === expectedBuffer.length &&
    timingSafeEqual(actualBuffer, expectedBuffer)
  );
}

abstract class SharedSignatureGuard implements CanActivate {
  protected abstract readonly secretKey:
    "ZOHO_WEBHOOK_SECRET" | "CHECKMARKET_WEBHOOK_SECRET";
  constructor(
    @Inject(ConfigService) protected readonly config: ConfigService<Env, true>,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context
      .switchToHttp()
      .getRequest<RawBodyRequest<FastifyRequest>>();
    const signature = request.headers["x-wrg-signature"];
    const timestamp = request.headers["x-wrg-timestamp"];
    const valid = verifySharedSignature(
      request.rawBody ?? Buffer.alloc(0),
      Array.isArray(signature) ? signature[0] : signature,
      Array.isArray(timestamp) ? timestamp[0] : timestamp,
      this.config.get(this.secretKey, { infer: true }),
    );
    if (!valid)
      throw new BadRequestException("Invalid or expired webhook signature");
    return true;
  }
}

@Injectable()
export class ZohoSignatureGuard extends SharedSignatureGuard {
  protected readonly secretKey = "ZOHO_WEBHOOK_SECRET" as const;
}

@Injectable()
export class CheckMarketSignatureGuard extends SharedSignatureGuard {
  protected readonly secretKey = "CHECKMARKET_WEBHOOK_SECRET" as const;
}

@ApiTags("webhooks")
@Controller("webhooks")
export class WebhooksController {
  private readonly stripe: Stripe;

  constructor(
    @Inject(ConfigService) config: ConfigService<Env, true>,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SyncQueue) private readonly syncQueue: SyncQueue,
  ) {
    this.stripe = new Stripe(config.get("STRIPE_SECRET_KEY", { infer: true }));
    this.stripeSecret = config.get("STRIPE_WEBHOOK_SECRET", { infer: true });
  }

  private readonly stripeSecret: string;

  @Post("stripe")
  async stripeWebhook(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers("stripe-signature") signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!signature || !request.rawBody)
      throw new BadRequestException("Missing Stripe signature");
    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        this.stripeSecret,
      );
    } catch {
      throw new BadRequestException("Invalid Stripe signature");
    }
    const stored = await this.prisma.webhookEvent.upsert({
      where: {
        provider_externalId: { provider: "stripe", externalId: event.id },
      },
      update: {},
      create: {
        provider: "stripe",
        externalId: event.id,
        eventType: event.type,
        payload: event as never,
        signatureValid: true,
      },
    });
    if (!stored.processedAt && event.type === "payment_intent.succeeded") {
      const intent = event.data.object;
      await this.prisma.$transaction([
        this.prisma.order.updateMany({
          where: { paymentIntentId: intent.id, status: "REQUIRES_PAYMENT" },
          data: { status: "PAID" },
        }),
        this.prisma.webhookEvent.update({
          where: { id: stored.id },
          data: { processedAt: new Date() },
        }),
      ]);
    }
    return { received: true };
  }

  @Post("zoho")
  @UseGuards(ZohoSignatureGuard)
  async zoho(@Body() body: Record<string, unknown>): Promise<{ queued: true }> {
    const externalId = String(body.id ?? body.event_id ?? crypto.randomUUID());
    await this.prisma.webhookEvent.upsert({
      where: { provider_externalId: { provider: "zoho", externalId } },
      update: {},
      create: {
        provider: "zoho",
        externalId,
        eventType: String(body.type ?? "record.changed"),
        payload: body as Prisma.InputJsonValue,
        signatureValid: true,
      },
    });
    await this.syncQueue.enqueue(
      { provider: "zoho", kind: String(body.module ?? "Deals"), externalId },
      `zoho:${externalId}`,
    );
    return { queued: true };
  }

  @Post("checkmarket")
  @UseGuards(CheckMarketSignatureGuard)
  async checkMarket(
    @Body() body: Record<string, unknown>,
  ): Promise<{ queued: true }> {
    const externalId = String(
      body.eventId ?? body.RespondentId ?? crypto.randomUUID(),
    );
    await this.prisma.webhookEvent.upsert({
      where: { provider_externalId: { provider: "checkmarket", externalId } },
      update: {},
      create: {
        provider: "checkmarket",
        externalId,
        eventType: String(body.type ?? "respondent.changed"),
        payload: body as Prisma.InputJsonValue,
        signatureValid: true,
      },
    });
    await this.syncQueue.enqueue(
      {
        provider: "checkmarket",
        kind: "survey",
        externalId: String(body.SurveyId ?? ""),
      },
      `checkmarket:${externalId}`,
    );
    return { queued: true };
  }
}
