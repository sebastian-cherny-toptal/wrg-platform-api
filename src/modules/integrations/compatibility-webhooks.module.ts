import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Module,
  Post,
  Put,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import type { RawBodyRequest } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { PrismaService } from "../../database/prisma.service.js";
import {
  AuthModule,
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import { CrmSyncModule, SyncQueue } from "../crm-sync/crm-sync.module.js";
import { WebhookIngestionService } from "./webhooks.controller.js";
import { WebhooksModule } from "./webhooks.module.js";

type JsonRecord = Record<string, unknown>;

function objectBody(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Request body must be an object");
  }
  return value as JsonRecord;
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return undefined;
}

function stringList(value: unknown): string[] {
  const values = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  return values.flatMap((entry) => {
    const normalized = optionalString(entry);
    return normalized ? [normalized] : [];
  });
}

@Injectable()
export class CompatibilityWebhookOperationsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SyncQueue) private readonly syncQueue: SyncQueue,
  ) {}

  assertAllowed(principal: Principal): void {
    const allowed =
      principal.roles.includes("admin") ||
      principal.roles.includes("super_admin") ||
      principal.permissions.some((permission) =>
        [
          "ops.manage",
          "clientsProjectsProgramsAccess",
          "syncCheckmartketAndZohoAccess",
        ].includes(permission),
      );
    if (!allowed) throw new ForbiddenException("Access denied");
  }

  async dealsCount() {
    const deals = await this.prisma.organizationProgram.findMany({
      where: { dealExternalId: { not: null } },
      select: { dealExternalId: true },
    });
    const dealIds = deals.flatMap(({ dealExternalId }) =>
      dealExternalId ? [dealExternalId] : [],
    );
    return { count: dealIds.length, dealIds };
  }

  async queue(principal: Principal, operation: string, rawBody: unknown) {
    this.assertAllowed(principal);
    const body = objectBody(rawBody ?? {});
    const requestedKey = optionalString(body.idempotencyKey);
    const externalId =
      optionalString(body.dealid) ??
      optionalString(body.dealId) ??
      optionalString(body.programId) ??
      optionalString(body.projectId) ??
      optionalString(body.accountId);
    const checkMarketIds = [
      ...stringList(body.employeeSurveyIds),
      ...stringList(body.employerSurveyIds),
      ...stringList(body.surveyIds),
      ...stringList(body.surveyId),
    ];
    const checkMarketOperation = new Set([
      "syncSurveys",
      "syncAllRespondents",
      "syncCheckmarketDataWithids",
      "responseRateStage",
    ]).has(operation);
    const jobs = [];
    if (checkMarketOperation) {
      const ids = checkMarketIds.length > 0 ? checkMarketIds : [undefined];
      for (const [index, surveyId] of ids.entries()) {
        const idempotencyKey =
          requestedKey && ids.length === 1
            ? requestedKey
            : `${operation}:${surveyId ?? "all"}:${randomUUID()}:${index}`;
        jobs.push(
          await this.syncQueue.enqueue(
            {
              provider: "checkmarket",
              kind: surveyId ? "survey" : "surveys",
              ...(surveyId ? { externalId: surveyId } : {}),
            },
            idempotencyKey,
          ),
        );
      }
    } else {
      const zohoKind: Record<string, string> = {
        syncContacts: "Contacts",
        dealsWebhook: "Deals",
        sendCrmEmails: "Contacts",
        reSyncDataWithCrm: "Deals",
        reSyncDataWithCrmV2: "Deals",
        deleteDealWithData: "Deals",
        syncDealsWithCrm: "Deals",
        dealCreatedAll: "Deals",
        syncProgram: "Programs",
        syncProject: "Projects",
        syncOrg: "Accounts",
        sendEmailToAllUsers: "Contacts",
        rankingAnalysisTrigger: "Programs",
        createProduct: "Products",
        massResync: "Deals",
        massResyncByProgram: "Deals",
      };
      const kind = zohoKind[operation];
      if (!kind) throw new BadRequestException("Unsupported sync operation");
      jobs.push(
        await this.syncQueue.enqueue(
          { provider: "zoho", kind, ...(externalId ? { externalId } : {}) },
          requestedKey ?? `${operation}:${externalId ?? "all"}:${randomUUID()}`,
        ),
      );
    }
    return {
      success: true,
      message: `${operation} queued`,
      data: jobs.length === 1 ? jobs[0] : jobs,
    };
  }
}

@ApiTags("legacy webhook compatibility")
@Controller({ path: "webhook", version: VERSION_NEUTRAL })
export class CompatibilityWebhookReceiverController {
  constructor(
    @Inject(WebhookIngestionService)
    private readonly ingestion: WebhookIngestionService,
  ) {}

  @Get()
  status(): string {
    return "cool";
  }

  @Post("surveycreated")
  surveyCreated(@Body() body: JsonRecord) {
    return this.ingestion.checkMarket(body, "survey.created", false);
  }

  @Post("submittedPage")
  submittedPage(@Body() body: JsonRecord) {
    return this.ingestion.checkMarket(body, "respondent.page-submitted", false);
  }

  @Post("pageSubmitted")
  pageSubmitted(@Body() body: JsonRecord) {
    return this.ingestion.checkMarket(body, "respondent.page-submitted", false);
  }

  @Post("pageComplete")
  pageComplete(@Body() body: JsonRecord) {
    return this.ingestion.checkMarket(body, "respondent.complete", false);
  }

  @Post("dealsWebhook")
  dealCreated(@Body() body: JsonRecord) {
    return this.ingestion.zoho(body, "deal.created", false);
  }

  @Post("dealUpdate")
  dealUpdated(@Body() body: JsonRecord) {
    return this.ingestion.zoho(body, "deal.updated", false);
  }

  @Put("dealUpdate")
  dealUpdatedPut(@Body() body: JsonRecord) {
    return this.ingestion.zoho(body, "deal.updated", false);
  }

  @Post("stripe/payment")
  stripe(
    @Req() request: RawBodyRequest<FastifyRequest>,
  ): Promise<{ received: true }> {
    const signature = request.headers["stripe-signature"];
    return this.ingestion.processStripe(
      request,
      Array.isArray(signature) ? signature[0] : signature,
    );
  }
}

@ApiTags("legacy webhook operations compatibility")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "webhook", version: VERSION_NEUTRAL })
export class CompatibilityWebhookOperationsController {
  constructor(
    @Inject(CompatibilityWebhookOperationsService)
    private readonly operations: CompatibilityWebhookOperationsService,
  ) {}

  private queue(principal: Principal, operation: string, body: unknown) {
    return this.operations.queue(principal, operation, body);
  }

  @Get("getDealsCount")
  getDealsCount(@CurrentUser() principal: Principal) {
    this.operations.assertAllowed(principal);
    return this.operations.dealsCount();
  }

  @Post("syncSurveys")
  syncSurveys(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.queue(principal, "syncSurveys", body);
  }

  @Post("syncContacts")
  syncContacts(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.queue(principal, "syncContacts", body);
  }

  @Post("sendCrmEmails")
  sendCrmEmails(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.queue(principal, "sendCrmEmails", body);
  }

  @Post("reSyncDataWithCrm")
  reSyncDataWithCrm(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.queue(principal, "reSyncDataWithCrm", body);
  }

  @Post("v2/reSyncDataWithCrm")
  reSyncDataWithCrmV2(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.queue(principal, "reSyncDataWithCrmV2", body);
  }

  @Post("syncAllRespondents")
  syncAllRespondents(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.queue(principal, "syncAllRespondents", body);
  }

  @Delete("deleteDealWithData")
  deleteDealWithData(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.queue(principal, "deleteDealWithData", body);
  }

  @Delete("syncDealsWithCrm")
  syncDealsWithCrm(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.queue(principal, "syncDealsWithCrm", body);
  }

  @Post("dealCreatedAll")
  dealCreatedAll(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.queue(principal, "dealCreatedAll", body);
  }

  @Post("syncProgram")
  syncProgram(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.queue(principal, "syncProgram", body);
  }

  @Post("syncProject")
  syncProject(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.queue(principal, "syncProject", body);
  }

  @Post("syncOrg")
  syncOrg(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.queue(principal, "syncOrg", body);
  }

  @Post("sendEmailToAllUsers")
  sendEmailToAllUsers(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.queue(principal, "sendEmailToAllUsers", body);
  }

  @Post("rankingAnalysisTrigger")
  rankingAnalysisTrigger(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.queue(principal, "rankingAnalysisTrigger", body);
  }

  @Post("createProduct")
  createProduct(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.queue(principal, "createProduct", body);
  }

  @Post("massResync")
  massResync(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.queue(principal, "massResync", body);
  }

  @Post("massResyncByProgram")
  massResyncByProgram(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.queue(principal, "massResyncByProgram", body);
  }

  @Post("syncCheckmarketDataWithids")
  syncCheckMarketDataWithIds(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.queue(principal, "syncCheckmarketDataWithids", body);
  }

  @Post("responseRateStage")
  responseRateStage(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.queue(principal, "responseRateStage", body);
  }
}

@Module({
  imports: [AuthModule, CrmSyncModule, WebhooksModule],
  providers: [CompatibilityWebhookOperationsService],
  controllers: [
    CompatibilityWebhookReceiverController,
    CompatibilityWebhookOperationsController,
  ],
})
export class CompatibilityWebhooksModule {}
