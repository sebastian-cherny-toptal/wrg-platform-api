import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Post,
  Query,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import Stripe from "stripe";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";
import {
  AuthModule,
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import {
  IntegrationsModule,
  ZohoAdapter,
} from "../integrations/integrations.module.js";

type JsonRecord = Record<string, unknown>;

interface CheckoutItem {
  title: string;
  amount: number;
  keys: JsonRecord;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function referenceWhere(reference: string) {
  return isUuid(reference)
    ? { id: reference }
    : { OR: [{ legacyId: reference }, { externalId: reference }] };
}

function objectBody(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Request body must be an object");
  }
  return value as JsonRecord;
}

function jsonObject(value: Prisma.JsonValue): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function money(value: unknown, field: string): number {
  const amount =
    typeof value === "number" || typeof value === "string"
      ? Number(value)
      : Number.NaN;
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new BadRequestException(`${field} must be a positive amount`);
  }
  return amount;
}

function currency(value: unknown): "USD" | "CAD" | "GBP" {
  const normalized = optionalString(value)?.toUpperCase() ?? "USD";
  if (!["USD", "CAD", "GBP"].includes(normalized)) {
    throw new BadRequestException("Invalid currency");
  }
  return normalized as "USD" | "CAD" | "GBP";
}

function checkoutItems(value: unknown): CheckoutItem[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new BadRequestException("items must be a non-empty array");
  }
  return value.map((entry, index) => {
    const item = objectBody(entry);
    const title = optionalString(item.title);
    if (!title)
      throw new BadRequestException(`items[${index}].title is required`);
    const keys =
      item.keys && typeof item.keys === "object" && !Array.isArray(item.keys)
        ? (item.keys as JsonRecord)
        : {};
    return {
      title,
      amount: money(item.amount, `items[${index}].amount`),
      keys,
    };
  });
}

function paymentKeys(keys: JsonRecord) {
  return Object.fromEntries(
    Object.entries(keys).map(([key, value]) => [
      key,
      value === "Invoice"
        ? "Needs Invoiced"
        : value === "Stripe"
          ? "Paid via Credit Card"
          : value,
    ]),
  ) as JsonRecord;
}

@Injectable()
export class CompatibilityPaymentService {
  private readonly stripe: Stripe;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
    @Inject(ZohoAdapter) private readonly zoho: ZohoAdapter,
  ) {
    this.stripe = new Stripe(config.get("STRIPE_SECRET_KEY", { infer: true }));
  }

  async paymentIntent(
    principal: Principal,
    rawBody: unknown,
    programReference?: string,
    organizationReference?: string,
  ) {
    const body = objectBody(rawBody);
    const amountMinor = Math.round(money(body.amount, "amount") * 100);
    const selectedCurrency = currency(body.currency);
    const context = await this.context(
      principal,
      programReference,
      organizationReference,
      false,
    );
    const intent = await this.createIntent(
      context.organization,
      amountMinor,
      selectedCurrency,
    );
    await this.prisma.order.create({
      data: {
        organizationId: context.organization.id,
        projectId: context.enrollment?.projectId ?? null,
        programId: context.enrollment?.programId ?? null,
        organizationProgramId: context.enrollment?.id ?? null,
        paymentIntentId: intent.id,
        status: "REQUIRES_PAYMENT",
        currency: selectedCurrency,
        amountMinor,
        items: inputJson(
          Array.isArray(body.items) ? body.items : [{ amount: body.amount }],
        ),
        paymentMethod: "Paid via Credit Card",
      },
    });
    return intent;
  }

  async checkout(
    principal: Principal,
    rawBody: unknown,
    useStripe: boolean,
    programReference?: string,
    organizationReference?: string,
  ) {
    const body = objectBody(rawBody);
    const items = checkoutItems(body.items);
    const context = await this.context(
      principal,
      programReference,
      organizationReference,
      true,
    );
    if (!context.enrollment) {
      throw new NotFoundException("Organization program not found");
    }
    const enrollment = context.enrollment;
    const selectedCurrency = currency(
      body.currency ?? context.program.currency,
    );
    const normalizedItems = items.map((item) => {
      const suffix = optionalString(item.keys.EV_Sorting_Filter);
      return {
        ...item,
        title: suffix ? `${item.title} ${suffix}` : item.title,
        keys: paymentKeys(item.keys),
      };
    });
    const totalMinor = Math.round(
      money(
        body.total ??
          normalizedItems.reduce((sum, item) => sum + item.amount, 0),
        "total",
      ) * 100,
    );

    if (useStripe) {
      const intent = await this.createIntent(
        context.organization,
        totalMinor,
        selectedCurrency,
      );
      await this.prisma.order.create({
        data: {
          organizationId: context.organization.id,
          projectId: enrollment.projectId,
          programId: enrollment.programId,
          organizationProgramId: enrollment.id,
          paymentIntentId: intent.id,
          status: "REQUIRES_PAYMENT",
          currency: selectedCurrency,
          amountMinor: totalMinor,
          items: inputJson(normalizedItems),
          paymentMethod: "Paid via Credit Card",
        },
      });
      return intent;
    }

    await this.prisma.$transaction(
      normalizedItems.map((item) =>
        this.prisma.order.create({
          data: {
            organizationId: context.organization.id,
            projectId: enrollment.projectId,
            programId: enrollment.programId,
            organizationProgramId: enrollment.id,
            status: "INVOICED",
            currency: selectedCurrency,
            amountMinor: Math.round(item.amount * 100),
            items: inputJson(item),
            paymentMethod: "Needs Invoiced",
          },
        }),
      ),
    );
    const mergedKeys = Object.assign(
      {},
      ...normalizedItems.map(({ keys }) => keys),
    ) as JsonRecord;
    await this.applyEnrollmentKeys(enrollment, mergedKeys);
    if (enrollment.dealExternalId) {
      await this.zoho.updateRecord(
        "Deals",
        enrollment.dealExternalId,
        mergedKeys,
      );
    }
    return "ok";
  }

  private async createIntent(
    organization: {
      id: string;
      stripeCustomerId: string | null;
      name: string;
    },
    amountMinor: number,
    selectedCurrency: "USD" | "CAD" | "GBP",
  ) {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) {
      const id = `pi_mock_${crypto.randomUUID()}`;
      return {
        id,
        object: "payment_intent",
        amount: amountMinor,
        currency: selectedCurrency.toLowerCase(),
        client_secret: `${id}_secret_mock`,
        status: "requires_payment_method",
      };
    }
    let customerId = organization.stripeCustomerId;
    if (!customerId) {
      const contact = await this.prisma.user.findFirst({
        where: { organizationId: organization.id, status: "ACTIVE" },
        orderBy: { createdAt: "asc" },
        select: { email: true },
      });
      const customer = await this.stripe.customers.create({
        name: organization.name,
        ...(contact?.email ? { email: contact.email } : {}),
        metadata: { organizationId: organization.id },
      });
      customerId = customer.id;
      await this.prisma.organization.update({
        where: { id: organization.id },
        data: { stripeCustomerId: customerId },
      });
    }
    return this.stripe.paymentIntents.create(
      {
        amount: amountMinor,
        currency: selectedCurrency.toLowerCase(),
        customer: customerId,
        metadata: { organizationId: organization.id },
      },
      {
        idempotencyKey: `compatibility-checkout:${organization.id}:${crypto.randomUUID()}`,
      },
    );
  }

  private async context(
    principal: Principal,
    programReference: string | undefined,
    organizationReference: string | undefined,
    requireProgram: boolean,
  ) {
    const requestedOrganization =
      organizationReference ?? principal.organizationId ?? undefined;
    if (!requestedOrganization) {
      throw new BadRequestException("organizationId is required");
    }
    if (
      principal.organizationId &&
      requestedOrganization !== principal.organizationId &&
      !principal.roles.includes("admin") &&
      !principal.roles.includes("super_admin") &&
      !principal.permissions.includes("ops.manage")
    ) {
      throw new ForbiddenException("Organization access denied");
    }
    const organization = await this.prisma.organization.findFirst({
      where: referenceWhere(requestedOrganization),
    });
    if (!organization) throw new NotFoundException("Organization not found");
    if (!programReference) {
      if (requireProgram) {
        throw new BadRequestException("selectedProgramId is required");
      }
      return { organization, enrollment: null, program: null };
    }
    const program = await this.prisma.program.findFirst({
      where: referenceWhere(programReference),
    });
    if (!program) throw new NotFoundException("Program not found");
    const enrollment = await this.prisma.organizationProgram.findUnique({
      where: {
        organizationId_programId: {
          organizationId: organization.id,
          programId: program.id,
        },
      },
    });
    if (!enrollment) {
      throw new ForbiddenException(
        "You are not authorized to access this program",
      );
    }
    return { organization, enrollment, program };
  }

  private async applyEnrollmentKeys(
    enrollment: {
      id: string;
      reportAccess: Prisma.JsonValue;
      paymentDetails: Prisma.JsonValue;
      metrics: Prisma.JsonValue;
    },
    keys: JsonRecord,
  ) {
    const reportAccess = { ...jsonObject(enrollment.reportAccess) };
    const paymentDetails = { ...jsonObject(enrollment.paymentDetails) };
    const metrics = { ...jsonObject(enrollment.metrics) };
    for (const [key, value] of Object.entries(keys)) {
      if (key.endsWith("_Access")) reportAccess[key] = value;
      else if (key.includes("Payment")) paymentDetails[key] = value;
      else metrics[key] = value;
    }
    await this.prisma.organizationProgram.update({
      where: { id: enrollment.id },
      data: {
        reportAccess: inputJson(reportAccess),
        paymentDetails: inputJson(paymentDetails),
        metrics: inputJson(metrics),
      },
    });
  }
}

@ApiTags("payment compatibility")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "payment", version: VERSION_NEUTRAL })
export class CompatibilityPaymentController {
  constructor(
    @Inject(CompatibilityPaymentService)
    private readonly payment: CompatibilityPaymentService,
  ) {}

  @Post("stripePaymentIntent")
  @HttpCode(200)
  paymentIntent(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
    @Query("selectedProgramId") programId: string | undefined,
    @Query("organizationId") organizationId: string | undefined,
  ) {
    return this.payment.paymentIntent(
      principal,
      body,
      programId,
      organizationId,
    );
  }

  @Post("checkout")
  @HttpCode(200)
  checkout(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
    @Query("stripe") stripe: string | undefined,
    @Query("selectedProgramId") programId: string | undefined,
    @Query("organizationId") organizationId: string | undefined,
  ) {
    return this.payment.checkout(
      principal,
      body,
      stripe !== undefined && stripe !== "false" && stripe !== "0",
      programId,
      organizationId,
    );
  }
}

@Module({
  imports: [AuthModule, IntegrationsModule],
  providers: [CompatibilityPaymentService],
  controllers: [CompatibilityPaymentController],
})
export class CompatibilityPaymentModule {}
