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
import {
  effectiveReportCatalog,
  hasStandardPackage,
  jsonObject as catalogJsonObject,
  KEY_IMPACT_ID,
  productIsOwned,
  RESPONSE_DETAIL_ID,
  SORTED_VERBATIMS_ID,
  STANDARD_PACKAGE_ID,
  standardPackagePriceCents,
  standardReportAccessKeys,
} from "../reports/report-catalog.js";

type JsonRecord = Record<string, unknown>;

interface CheckoutItem {
  title: string;
  amount: number;
  keys: JsonRecord;
}

interface CatalogCheckoutItem extends CheckoutItem {
  productId: string;
  amountMinor: number;
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
    const selectedCurrency = currency(body.currency);
    const context = await this.context(
      principal,
      programReference,
      organizationReference,
      false,
    );
    const catalogOrder = this.catalogOrder(body.items, context);
    const amountMinor = catalogOrder
      ? Math.round(catalogOrder.amountMinor * 1.03)
      : Math.round(money(body.amount, "amount") * 100);
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
          catalogOrder?.items ??
            (Array.isArray(body.items) ? body.items : [{ amount: body.amount }]),
        ),
        paymentMethod: "Paid via Credit Card",
      },
    });
    return intent;
  }

  private catalogOrder(
    rawItems: unknown,
    context: Awaited<ReturnType<CompatibilityPaymentService["context"]>>,
  ): { amountMinor: number; items: CatalogCheckoutItem[] } | null {
    if (!Array.isArray(rawItems) || !context.program) return null;
    const requested: Array<{ productId: string; keys: JsonRecord }> = [];
    for (const entry of rawItems) {
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        return null;
      }
      const keys = (entry as JsonRecord).keys;
      if (!keys || typeof keys !== "object" || Array.isArray(keys)) return null;
      const productId = optionalString((keys as JsonRecord).productId);
      if (!productId) return null;
      requested.push({ productId, keys: keys as JsonRecord });
    }
    const ids = requested.map(({ productId }) => productId);
    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException("Each report product can only be purchased once");
    }
    const metadata = jsonObject(context.program.metadata);
    const enrollmentMetadata = jsonObject(context.enrollment.metadata);
    const effectiveCatalog = enrollmentMetadata.reportCatalog ?? metadata.reportCatalog;
    const catalog = effectiveReportCatalog(effectiveCatalog);
    const programFees = jsonObject(context.program.fees);
    const organizationFees = jsonObject(context.enrollment.fees);
    const standardOwned = hasStandardPackage(
      context.enrollment.reportAccess,
      context.enrollment.stage,
    );
    const includesStandard = ids.includes(STANDARD_PACKAGE_ID);
    const items = requested.map(({ productId, keys }) => {
      const product = catalog.find((entry) => entry.id === productId && entry.available);
      if (!product) throw new BadRequestException(`Unknown report product: ${productId}`);
      if (product.purchaseMode !== "checkout") {
        throw new BadRequestException(`${product.name} must be ordered through a WRG contact`);
      }
      if (productIsOwned(productId, context.enrollment.reportAccess, context.enrollment.stage)) {
        throw new BadRequestException(`${product.name} is already available for this organization`);
      }
      if (product.requiresStandardPackage && !standardOwned && !includesStandard) {
        throw new BadRequestException(`${product.name} requires the Feedback Data Dashboard`);
      }
      const configured = productId === STANDARD_PACKAGE_ID
        ? standardPackagePriceCents(metadata, context.enrollment.metrics)
        : organizationFees[productId] ?? programFees[productId] ?? product.priceCents;
      if (typeof configured !== "number" || !Number.isInteger(configured) || configured <= 0) {
        throw new BadRequestException(`Report price is unavailable: ${productId}`);
      }
      const allowedKeys: JsonRecord = { productId };
      if (productId === SORTED_VERBATIMS_ID) {
        const filter = optionalString(keys.EV_Sorting_Filter);
        if (!filter) throw new BadRequestException("A demographic filter is required for Sorted Employee Verbatims");
        allowedKeys.EV_Sorting_Filter = filter;
      }
      return {
        productId,
        title: product.name,
        amount: configured / 100,
        amountMinor: configured,
        keys: allowedKeys,
      };
    });
    return {
      items,
      amountMinor: items.reduce((sum, item) => sum + item.amountMinor, 0),
    };
  }

  async checkout(
    principal: Principal,
    rawBody: unknown,
    useStripe: boolean,
    programReference?: string,
    organizationReference?: string,
  ) {
    const body = objectBody(rawBody);
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
    const catalogOrder = this.catalogOrder(body.items, context);
    const items = catalogOrder?.items ?? checkoutItems(body.items);
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
    const totalMinor = catalogOrder?.amountMinor ?? Math.round(
      money(
        body.total ?? normalizedItems.reduce((sum, item) => sum + item.amount, 0),
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

    await this.prisma.order.create({
      data: {
        organizationId: context.organization.id,
        projectId: enrollment.projectId,
        programId: enrollment.programId,
        organizationProgramId: enrollment.id,
        status: catalogOrder ? "PENDING" : "INVOICED",
        currency: selectedCurrency,
        amountMinor: totalMinor,
        items: inputJson(normalizedItems),
        paymentMethod: "Needs Invoiced",
      },
    });
    const mergedKeys = catalogOrder
      ? this.crmFields(catalogOrder.items, "Needs Invoiced")
      : Object.assign({}, ...normalizedItems.map(({ keys }) => keys)) as JsonRecord;
    const sortedFilter = catalogOrder?.items.find(
      ({ productId }) => productId === SORTED_VERBATIMS_ID,
    )?.keys.EV_Sorting_Filter;
    await this.applyEnrollmentKeys(enrollment, {
      ...mergedKeys,
      ...(typeof sortedFilter === "string" ? { SEV_Filter: sortedFilter } : {}),
    });
    if (enrollment.dealExternalId) {
      await this.zoho.updateRecord(
        "Deals",
        enrollment.dealExternalId,
        mergedKeys,
      );
    }
    return { success: true, status: "pending", message: "Invoice requested" };
  }

  private crmFields(
    items: CatalogCheckoutItem[],
    payment: "Needs Invoiced" | "Paid via Credit Card",
  ): JsonRecord {
    const fields: JsonRecord = {};
    const definitions: Record<string, [string, string]> = {
      [STANDARD_PACKAGE_ID]: ["Full_Package_Fee", "Full_Package_Payment"],
      [SORTED_VERBATIMS_ID]: ["Sorted_EV_Fee", "Sorted_EV_Payment"],
      [KEY_IMPACT_ID]: ["KIA_Fee", "KIA_Payment"],
      [RESPONSE_DETAIL_ID]: ["RDR_Fee", "RDR_Payment"],
    };
    for (const item of items) {
      const definition = definitions[item.productId];
      if (!definition) continue;
      fields[definition[0]] = item.amountMinor / 100;
      fields[definition[1]] = payment;
    }
    return fields;
  }

  async fulfillPaidOrder(paymentIntentId: string): Promise<void> {
    const order = await this.prisma.order.findUnique({
      where: { paymentIntentId },
      include: { organizationProgram: true },
    });
    if (!order) return;
    if (!order.organizationProgram) {
      await this.prisma.order.update({
        where: { id: order.id },
        data: { status: "PAID" },
      });
      return;
    }
    const rawItems = Array.isArray(order.items) ? order.items : [order.items];
    const items = rawItems.flatMap((entry): CatalogCheckoutItem[] => {
      const value = catalogJsonObject(entry);
      const keys = catalogJsonObject(value.keys);
      const productId = optionalString(value.productId ?? keys.productId);
      const amountMinor = Number(value.amountMinor ?? Number(value.amount) * 100);
      return productId && Number.isInteger(amountMinor) && amountMinor > 0
        ? [{
            productId,
            amountMinor,
            title: optionalString(value.title) ?? productId,
            amount: amountMinor / 100,
            keys,
          }]
        : [];
    });
    const enrollment = order.organizationProgram;
    const reportAccess = { ...jsonObject(enrollment.reportAccess) };
    const metrics = { ...jsonObject(enrollment.metrics) };
    let stage = enrollment.stage;
    for (const { productId } of items) {
      if (productId === STANDARD_PACKAGE_ID) {
        for (const key of standardReportAccessKeys) reportAccess[key] = "yes";
        stage = "Full Package";
      } else if (productId === SORTED_VERBATIMS_ID) {
        reportAccess.SEV_Access = "yes";
        const filter = optionalString(
          items.find((item) => item.productId === productId)?.keys.EV_Sorting_Filter,
        );
        if (filter) metrics.SEV_Filter = filter;
      } else if (productId === RESPONSE_DETAIL_ID) {
        reportAccess.RD_Access = "yes";
      } else if (productId === KEY_IMPACT_ID) {
        metrics.KIA_Order_Status = "Processing";
      }
    }
    const crmFields = this.crmFields(items, "Paid via Credit Card");
    const paymentDetails = {
      ...jsonObject(enrollment.paymentDetails),
      ...crmFields,
    };
    await this.prisma.$transaction([
      this.prisma.organizationProgram.update({
        where: { id: enrollment.id },
        data: {
          stage,
          reportAccess: inputJson(reportAccess),
          paymentDetails: inputJson(paymentDetails),
          metrics: inputJson(metrics),
        },
      }),
      this.prisma.order.update({
        where: { id: order.id },
        data: { status: "PAID", paymentMethod: "Paid via Credit Card" },
      }),
    ]);
    if (enrollment.dealExternalId) {
      await this.zoho.updateRecord("Deals", enrollment.dealExternalId, {
        ...crmFields,
        ...(stage === "Full Package" ? { Stage: "Full Package" } : {}),
      });
    }
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
  exports: [CompatibilityPaymentService],
})
export class CompatibilityPaymentModule {}
