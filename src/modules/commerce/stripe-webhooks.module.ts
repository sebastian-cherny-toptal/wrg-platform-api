import {
  BadRequestException,
  Controller,
  Headers,
  Inject,
  Injectable,
  Module,
  Post,
  Req,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import Stripe from "stripe";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";
import {
  CompatibilityPaymentModule,
  CompatibilityPaymentService,
} from "./compatibility-payment.module.js";

@Injectable()
export class StripeWebhookService {
  private readonly stripe: Stripe;
  private readonly webhookSecret: string;

  constructor(
    @Inject(ConfigService) config: ConfigService<Env, true>,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CompatibilityPaymentService)
    private readonly payments: CompatibilityPaymentService,
  ) {
    this.stripe = new Stripe(config.get("STRIPE_SECRET_KEY", { infer: true }));
    this.webhookSecret = config.get("STRIPE_WEBHOOK_SECRET", { infer: true });
  }

  async process(
    request: RawBodyRequest<FastifyRequest>,
    signature: string | undefined,
  ): Promise<{ received: true }> {
    if (!signature || !request.rawBody) {
      throw new BadRequestException("Missing Stripe signature");
    }

    let event: Stripe.Event;
    try {
      event = this.stripe.webhooks.constructEvent(
        request.rawBody,
        signature,
        this.webhookSecret,
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
      await this.payments.fulfillPaidOrder(event.data.object.id);
      await this.prisma.webhookEvent.update({
        where: { id: stored.id },
        data: { processedAt: new Date() },
      });
    }

    return { received: true };
  }
}

@ApiTags("payments")
@Controller("webhooks")
class StripeWebhookController {
  constructor(
    @Inject(StripeWebhookService)
    private readonly webhook: StripeWebhookService,
  ) {}

  @Post("stripe")
  receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers("stripe-signature") signature: string | undefined,
  ) {
    return this.webhook.process(request, signature);
  }
}

@ApiTags("payments")
@Controller({ path: "webhook", version: VERSION_NEUTRAL })
class StripeCompatibilityWebhookController {
  constructor(
    @Inject(StripeWebhookService)
    private readonly webhook: StripeWebhookService,
  ) {}

  @Post("stripe/payment")
  receive(
    @Req() request: RawBodyRequest<FastifyRequest>,
    @Headers("stripe-signature") signature: string | undefined,
  ) {
    return this.webhook.process(request, signature);
  }
}

@Module({
  imports: [CompatibilityPaymentModule],
  providers: [StripeWebhookService],
  controllers: [
    StripeWebhookController,
    StripeCompatibilityWebhookController,
  ],
})
export class StripeWebhooksModule {}
