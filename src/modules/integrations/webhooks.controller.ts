import {
  BadRequestException,
  Body,
  CanActivate,
  Controller,
  ExecutionContext,
  Headers,
  Inject,
  Injectable,
  Optional,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import type { Prisma } from "@prisma/client";
import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { FastifyRequest } from "fastify";
import Stripe from "stripe";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";
import { SyncQueue } from "../crm-sync/crm-sync.module.js";
import { CompatibilityPaymentService } from "../commerce/compatibility-payment.module.js";
import {
  KEY_IMPACT_ID,
  RESPONSE_DETAIL_ID,
  SORTED_VERBATIMS_ID,
  STANDARD_PACKAGE_ID,
  standardReportAccessKeys,
} from "../reports/report-catalog.js";

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

function payloadDigest(body: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify(body))
    .digest("hex")
    .slice(0, 24);
}

function optionalExternalId(value: unknown): string | null {
  return value === undefined || value === null || String(value) === ""
    ? null
    : String(value);
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

@Injectable()
export class WebhookIngestionService {
  private readonly stripeClient: Stripe;

  constructor(
    @Inject(ConfigService) config: ConfigService<Env, true>,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SyncQueue) private readonly syncQueue: SyncQueue,
    @Optional()
    @Inject(CompatibilityPaymentService)
    private readonly payments?: CompatibilityPaymentService,
  ) {
    this.stripeClient = new Stripe(
      config.get("STRIPE_SECRET_KEY", { infer: true }),
    );
    this.stripeSecret = config.get("STRIPE_WEBHOOK_SECRET", { infer: true });
  }

  private readonly stripeSecret: string;

  async processStripe(
    request: RawBodyRequest<FastifyRequest>,
    signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!signature || !request.rawBody)
      throw new BadRequestException("Missing Stripe signature");
    let event: Stripe.Event;
    try {
      event = this.stripeClient.webhooks.constructEvent(
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
      if (this.payments) {
        await this.payments.fulfillPaidOrder(intent.id);
      } else {
        await this.prisma.order.updateMany({
          where: { paymentIntentId: intent.id, status: "REQUIRES_PAYMENT" },
          data: { status: "PAID" },
        });
      }
      await this.prisma.webhookEvent.update({
        where: { id: stored.id },
        data: { processedAt: new Date() },
      });
    }
    return { received: true };
  }

  async zoho(
    body: Record<string, unknown>,
    eventType = String(body.type ?? "record.changed"),
    signatureValid = true,
  ): Promise<{ queued: true }> {
    await this.reconcileDealAccess(body);
    const recordId = body.id ?? body.dealid ?? "record";
    const externalId = String(
      body.event_id ??
        body.eventId ??
        `${eventType}:${String(recordId)}:${payloadDigest(body)}`,
    );
    await this.prisma.webhookEvent.upsert({
      where: { provider_externalId: { provider: "zoho", externalId } },
      update: {},
      create: {
        provider: "zoho",
        externalId,
        eventType,
        payload: body as Prisma.InputJsonValue,
        signatureValid,
      },
    });
    await this.syncQueue.enqueue(
      { provider: "zoho", kind: String(body.module ?? "Deals"), externalId },
      `zoho:${eventType}:${externalId}`,
    );
    return { queued: true };
  }

  private async reconcileDealAccess(body: Record<string, unknown>): Promise<void> {
    const data: unknown = body.data;
    const first: unknown = Array.isArray(data) ? data[0] : undefined;
    const deal = first && typeof first === "object" && !Array.isArray(first)
      ? first as Record<string, unknown>
      : body;
    const dealId = optionalExternalId(deal.id ?? deal.dealid ?? body.dealid);
    if (!dealId) return;
    const enrollment = await this.prisma.organizationProgram.findFirst({
      where: { dealExternalId: dealId },
    });
    if (!enrollment) return;
    const paidOptions = new Set([
      "paid via credit card",
      "paid via ach",
      "paid via check",
    ]);
    const paymentFields = Object.fromEntries(
      Object.entries(deal).filter(([key]) =>
        key.toLowerCase().includes("payment") || key.toLowerCase().includes("fee"),
      ),
    );
    const paid = (keyPattern: RegExp) => Object.entries(paymentFields).some(
      ([key, value]) => keyPattern.test(key) && paidOptions.has(String(value).trim().toLowerCase()),
    );
    const stage = typeof (deal.Stage ?? deal.stage) === "string"
      ? String(deal.Stage ?? deal.stage).trim()
      : enrollment.stage;
    const reportAccess = {
      ...(enrollment.reportAccess !== null &&
      typeof enrollment.reportAccess === "object" &&
      !Array.isArray(enrollment.reportAccess)
        ? enrollment.reportAccess as Record<string, unknown>
        : {}),
    };
    if (
      stage?.toLowerCase() === "full package" &&
      paid(/full.*package.*payment|payment/iu)
    ) {
      for (const key of standardReportAccessKeys) reportAccess[key] = "yes";
    }
    if (paid(/rdr.*payment|rd.*payment|response.*detail.*payment/iu)) {
      reportAccess.RD_Access = "yes";
    }
    if (paid(/sorted.*ev.*payment|ev.*sorting.*payment/iu)) {
      reportAccess.SEV_Access = "yes";
    }
    const pendingOrders = await this.prisma.order.findMany({
      where: {
        organizationProgramId: enrollment.id,
        status: { in: ["PENDING", "INVOICED"] },
      },
      select: { id: true, items: true },
    });
    const productIsPaid = (productId: string): boolean => {
      if (productId === STANDARD_PACKAGE_ID) {
        return stage?.toLowerCase() === "full package" &&
          paid(/full.*package.*payment|payment/iu);
      }
      if (productId === RESPONSE_DETAIL_ID) {
        return paid(/rdr.*payment|rd.*payment|response.*detail.*payment/iu);
      }
      if (productId === SORTED_VERBATIMS_ID) {
        return paid(/sorted.*ev.*payment|ev.*sorting.*payment/iu);
      }
      if (productId === KEY_IMPACT_ID) return paid(/kia.*payment/iu);
      return false;
    };
    const paidOrderIds = pendingOrders.flatMap((order) => {
      const rawItems = Array.isArray(order.items) ? order.items : [order.items];
      const productIds = rawItems.flatMap((item) => {
        if (!item || typeof item !== "object" || Array.isArray(item)) return [];
        const value = item as Record<string, unknown>;
        const keys = value.keys && typeof value.keys === "object" && !Array.isArray(value.keys)
          ? value.keys as Record<string, unknown>
          : {};
        const productId = value.productId ?? keys.productId;
        return typeof productId === "string" ? [productId] : [];
      });
      return productIds.length > 0 && productIds.every(productIsPaid)
        ? [order.id]
        : [];
    });
    await this.prisma.$transaction([
      this.prisma.organizationProgram.update({
        where: { id: enrollment.id },
        data: {
          stage,
          reportAccess: reportAccess as Prisma.InputJsonValue,
          paymentDetails: {
            ...(enrollment.paymentDetails !== null &&
            typeof enrollment.paymentDetails === "object" &&
            !Array.isArray(enrollment.paymentDetails)
              ? enrollment.paymentDetails as Record<string, unknown>
              : {}),
            ...paymentFields,
          } as Prisma.InputJsonValue,
        },
      }),
      ...(paidOrderIds.length
        ? [this.prisma.order.updateMany({
            where: { id: { in: paidOrderIds } },
            data: { status: "PAID" },
          })]
        : []),
    ]);
  }

  async checkMarket(
    body: Record<string, unknown>,
    eventType = String(body.type ?? "respondent.changed"),
    signatureValid = true,
  ): Promise<{ queued: true }> {
    const data =
      body.Data && typeof body.Data === "object" && !Array.isArray(body.Data)
        ? (body.Data as Record<string, unknown>)
        : {};
    const respondent =
      data.Respondent &&
      typeof data.Respondent === "object" &&
      !Array.isArray(data.Respondent)
        ? (data.Respondent as Record<string, unknown>)
        : {};
    const survey =
      data.Survey &&
      typeof data.Survey === "object" &&
      !Array.isArray(data.Survey)
        ? (data.Survey as Record<string, unknown>)
        : {};
    const surveyId = body.SurveyId ?? data.SurveyId ?? survey.Id;
    const recordId =
      body.RespondentId ??
      respondent.RespondentId ??
      data.WebhookId ??
      surveyId ??
      "event";
    const externalId = String(
      body.eventId ??
        body.event_id ??
        `${eventType}:${String(recordId)}:${payloadDigest(body)}`,
    );
    const stored = await this.prisma.webhookEvent.upsert({
      where: { provider_externalId: { provider: "checkmarket", externalId } },
      update: {},
      create: {
        provider: "checkmarket",
        externalId,
        eventType,
        payload: body as Prisma.InputJsonValue,
        signatureValid,
      },
    });
    if (data.ActivationRequired && data.WebhookId) {
      await this.syncQueue.enqueue(
        {
          provider: "checkmarket",
          kind: "activate",
          externalId: String(data.WebhookId),
        },
        `checkmarket:activate:${String(data.WebhookId)}`,
      );
      return { queued: true };
    }
    const processed = await this.applyCheckMarketRespondent(
      eventType,
      surveyId,
      respondent,
    );
    if (processed) {
      await this.prisma.webhookEvent.update({
        where: { id: stored.id },
        data: { processedAt: new Date() },
      });
    }
    if (surveyId !== undefined && surveyId !== null && String(surveyId)) {
      await this.syncQueue.enqueue(
        {
          provider: "checkmarket",
          kind: "survey",
          externalId: String(surveyId),
        },
        `checkmarket:${eventType}:${externalId}`,
      );
    }
    return { queued: true };
  }

  private async applyCheckMarketRespondent(
    eventType: string,
    surveyReference: unknown,
    payload: Record<string, unknown>,
  ): Promise<boolean> {
    const externalId = payload.RespondentId;
    if (
      surveyReference === undefined ||
      surveyReference === null ||
      externalId === undefined ||
      externalId === null
    ) {
      return false;
    }
    const survey = await this.prisma.survey.findFirst({
      where: {
        OR: [
          { externalId: String(surveyReference) },
          { legacyId: String(surveyReference) },
        ],
      },
      select: { id: true },
    });
    if (!survey) return false;
    const organizationReference = payload.OrgId;
    const organization =
      organizationReference === undefined || organizationReference === null
        ? null
        : await this.prisma.organization.findFirst({
            where: {
              OR: [
                { externalId: String(organizationReference) },
                { legacyId: String(organizationReference) },
              ],
            },
            select: { id: true },
          });
    const completed = eventType.includes("complete");
    const respondent = await this.prisma.respondent.upsert({
      where: {
        surveyId_externalId: {
          surveyId: survey.id,
          externalId: String(externalId),
        },
      },
      update: {
        status: String(payload.RespondentStatusId ?? (completed ? 1 : 0)),
        metadata: payload as Prisma.InputJsonValue,
        ...(organization ? { organizationId: organization.id } : {}),
        ...(completed ? { completedAt: new Date() } : {}),
      },
      create: {
        surveyId: survey.id,
        externalId: String(externalId),
        organizationId: organization?.id ?? null,
        status: String(payload.RespondentStatusId ?? (completed ? 1 : 0)),
        completedAt: completed ? new Date() : null,
        metadata: payload as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    const responses = Array.isArray(payload.Responses) ? payload.Responses : [];
    for (const entry of responses) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
      const response = entry as Record<string, unknown>;
      const questionReference = response.QuestionId;
      const dataLabel = response.DataLabel;
      const question = await this.prisma.question.findFirst({
        where: {
          surveyId: survey.id,
          OR: [
            ...(questionReference === undefined || questionReference === null
              ? []
              : [
                  { externalId: String(questionReference) },
                  { legacyId: String(questionReference) },
                ]),
            ...(typeof dataLabel === "string" && dataLabel
              ? [{ dataLabel }]
              : []),
          ],
        },
        select: { id: true },
      });
      if (!question) continue;
      await this.prisma.response.upsert({
        where: {
          respondentId_questionId: {
            respondentId: respondent.id,
            questionId: question.id,
          },
        },
        update: { value: response as Prisma.InputJsonValue },
        create: {
          respondentId: respondent.id,
          questionId: question.id,
          externalId: optionalExternalId(response.Id),
          value: response as Prisma.InputJsonValue,
        },
      });
    }
    return true;
  }
}

@ApiTags("webhooks")
@Controller("webhooks")
export class WebhooksController {
  constructor(
    @Inject(WebhookIngestionService)
    private readonly ingestion: WebhookIngestionService,
  ) {}

  @Post("stripe")
  stripeWebhook(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers("stripe-signature") signature: string | undefined,
  ): Promise<{ received: true }> {
    return this.ingestion.processStripe(request, signature);
  }

  @Post("zoho")
  @UseGuards(ZohoSignatureGuard)
  zoho(@Body() body: Record<string, unknown>): Promise<{ queued: true }> {
    return this.ingestion.zoho(body);
  }

  @Post("checkmarket")
  @UseGuards(CheckMarketSignatureGuard)
  checkMarket(
    @Body() body: Record<string, unknown>,
  ): Promise<{ queued: true }> {
    return this.ingestion.checkMarket(body);
  }
}
