import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Module,
  Param,
  Query,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { randomUUID } from "node:crypto";
import {
  AuthModule,
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import {
  IntegrationsModule,
  ZohoAdapter,
  type ZohoRecord,
} from "../integrations/integrations.module.js";
import { CrmSyncModule, SyncQueue } from "./crm-sync.module.js";

type ZohoSyncKind = "Projects" | "Programs" | "Accounts" | "Contacts";

const programFields = [
  "id",
  "Name",
  "Program_Year",
  "Project",
  "EFS_Launch_Date",
  "EFS_end_Date",
  "Boutique_EE_Size",
  "Category_15_24_Fee",
  "Small_EE_Size",
  "Category_25_99_Fee",
  "Medium_EE_Size",
  "Category_100_199_Fee",
  "Large_EE_Size",
  "Category_200_499_Fee",
  "Mega_EE_Size",
  "Category_500_999_Fee",
  "Major_EE_Size",
  "Category_1000_Fee",
];

const dealFields = [
  "id",
  "Deal_Name",
  "Current_Year_Winner",
  "Program",
  "Account_Name",
  "Deal_Organization_ID",
  "Current_Year_Category",
  "Surveys_Sent",
];

interface ProgramOrganization {
  organizationId: string;
  organizationName: string | null;
  isWinner: boolean;
  surveysSent: number;
  currentYearCategory: string | null;
}

@Injectable()
export class CompatibilityZohoService {
  constructor(
    @Inject(SyncQueue) private readonly syncQueue: SyncQueue,
    @Inject(ZohoAdapter) private readonly zoho: ZohoAdapter,
  ) { }

  private assertAccess(principal: Principal): void {
    if (
      !principal.roles.includes("admin") &&
      !principal.roles.includes("super_admin") &&
      !principal.permissions.includes("ops.manage") &&
      !principal.permissions.includes("clientsProjectsProgramsAccess") &&
      !principal.permissions.includes("syncCheckmartketAndZohoAccess")
    ) {
      throw new ForbiddenException("Access denied");
    }
  }

  async sync(principal: Principal, kind: ZohoSyncKind, requestedKey?: string) {
    this.assertAccess(principal);
    const normalizedKey = requestedKey?.trim();
    const idempotencyKey =
      normalizedKey === undefined || normalizedKey === ""
        ? `manual-zoho:${kind}:${randomUUID()}`
        : normalizedKey;
    const job = await this.syncQueue.enqueue(
      { provider: "zoho", kind },
      idempotencyKey,
    );
    return {
      success: true,
      message: `${kind} synchronization queued`,
      data: job,
    };
  }

  async listProjects(principal: Principal) {
    this.assertAccess(principal);
    const records = await this.zoho.listAllRecords("Main_Projects", ["id", "Name", "Project_Abbreviation", "Created_Time", "Modified_Time", "Created_By", "Modified_By", "Owner", "Record_Status__s", "Currency"]);
    return records.map((record) => ({
      id: record.id,
      name: record.Name,
      abbreviation: record.Project_Abbreviation,
      createdTime: record.Created_Time,
      modifiedTime: record.Modified_Time,
      createdBy: (record.Created_By as { name: string }).name,
      modifiedBy: (record.Modified_By as { name: string }).name,
      owner: (record.Owner as { name: string }).name,
      recordStatus: record.Record_Status__s,
      currency: record.Currency,
    }));
  }

  async listPrograms(principal: Principal) {
    this.assertAccess(principal);
    const records = await this.zoho.listAllRecords("Programs", programFields);
    return this.programOptions(records, []);
  }

  async listProgramsForProject(principal: Principal, projectId: string) {
    this.assertAccess(principal);
    const normalizedProjectId = projectId.trim();
    if (
      !normalizedProjectId ||
      !/^[A-Za-z0-9_-]+$/u.test(normalizedProjectId)
    ) {
      throw new BadRequestException("A valid Zoho project ID is required");
    }
    const records = await this.zoho.searchAllRecords(
      "Programs",
      `(Project:equals:${normalizedProjectId})`,
      programFields,
    );
    return this.programOptions(records, []);
  }

  async listOrganizationsForProgram(
    principal: Principal,
    programId: string,
  ): Promise<ProgramOrganization[]> {
    this.assertAccess(principal);
    const normalizedProgramId = programId.trim();
    if (
      !normalizedProgramId ||
      !/^[A-Za-z0-9_-]+$/u.test(normalizedProgramId)
    ) {
      throw new BadRequestException("A valid Zoho program ID is required");
    }
    // searchAllRecords appends `/search`, producing the Zoho `Deals/search` URL.
    const deals = await this.zoho.searchAllRecords(
      "Deals",
      `(Program:equals:${normalizedProgramId})`,
      dealFields,
    );
    return this.organizationsByProgram(deals).get(normalizedProgramId) ?? [];
  }

  private organizationsByProgram(
    deals: ZohoRecord[],
  ): Map<string, ProgramOrganization[]> {
    const text = (record: ZohoRecord, key: string): string | null => {
      const value = record[key];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };
    const lookup = (record: ZohoRecord, key: string) => {
      const value = record[key];
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
      }
      const entry = value as Record<string, unknown>;
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      return id ? { id, ...(name ? { name } : {}) } : undefined;
    };
    const organizationsByProgram = new Map<string, ProgramOrganization[]>();
    for (const deal of deals) {
      const program = lookup(deal, "Program");
      if (!program) continue;
      const account = lookup(deal, "Account_Name");
      const organizationId =
        text(deal, "Deal_Organization_ID") ?? account?.id ?? "";
      if (!organizationId) continue;
      const rawDealName = text(deal, "Deal_Name");
      const dealOrganizationName = rawDealName?.split(" - ")[0]?.trim();
      const organizationName =
        dealOrganizationName && dealOrganizationName.length > 0
          ? dealOrganizationName
          : (account?.name ?? null);
      const rawSurveysSent = Number(deal.Surveys_Sent);
      const organizations = organizationsByProgram.get(program.id) ?? [];
      if (!organizations.some((entry) => entry.organizationId === organizationId)) {
        organizations.push({
          organizationId,
          organizationName,
          isWinner:
            text(deal, "Current_Year_Winner")?.toLowerCase() === "yes",
          surveysSent:
            Number.isInteger(rawSurveysSent) && rawSurveysSent >= 0
              ? rawSurveysSent
              : 0,
          currentYearCategory: text(deal, "Current_Year_Category"),
        });
      }
      organizationsByProgram.set(program.id, organizations);
    }
    return organizationsByProgram;
  }

  private programOptions(records: ZohoRecord[], deals: ZohoRecord[]) {
    const text = (record: ZohoRecord, key: string): string | null => {
      const value = record[key];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    };
    const year = (record: ZohoRecord): number | null => {
      const raw = record.Program_Year;
      if (
        (typeof raw !== "string" && typeof raw !== "number") ||
        (typeof raw === "string" && !raw.trim())
      ) {
        return null;
      }
      const value = Number(raw);
      return Number.isInteger(value) ? value : null;
    };
    const categoryPricing = (record: ZohoRecord) => {
      const definitions = [
        ["Boutique", "Boutique_EE_Size", "Category_15_24_Fee"],
        ["Small", "Small_EE_Size", "Category_25_99_Fee"],
        ["Medium", "Medium_EE_Size", "Category_100_199_Fee"],
        ["Large", "Large_EE_Size", "Category_200_499_Fee"],
        ["Mega", "Mega_EE_Size", "Category_500_999_Fee"],
        ["Major", "Major_EE_Size", "Category_1000_Fee"],
      ] as const;
      const pricing = definitions.map(([tier, sizeKey, feeKey]) => {
        const employeeSize = text(record, sizeKey);
        const rawFee = record[feeKey];
        const amount = Number(
          String(rawFee ?? "")
            .replace(/[^0-9.-]+/gu, "")
            .trim(),
        );
        return employeeSize && Number.isFinite(amount)
          ? {
            tier,
            employeeSize,
            priceCents: Math.max(0, Math.round(amount * 100)),
          }
          : null;
      });
      const completed = pricing.filter(
        (entry): entry is NonNullable<typeof entry> => entry !== null,
      );
      return completed.length === definitions.length ? completed : undefined;
    };
    const lookup = (record: ZohoRecord, key: string) => {
      const value = record[key];
      if (value === null || typeof value !== "object" || Array.isArray(value)) {
        return undefined;
      }
      const entry = value as Record<string, unknown>;
      const id = typeof entry.id === "string" ? entry.id.trim() : "";
      const name = typeof entry.name === "string" ? entry.name.trim() : "";
      return id ? { id, ...(name ? { name } : {}) } : undefined;
    };
    const organizationsByProgram = this.organizationsByProgram(deals);
    return records
      .map((record) => {
        const pricing = categoryPricing(record);
        const projectLookup = lookup(record, "Project");
        return {
          id: record.id,
          name: text(record, "Name") ?? record.id,
          year: year(record),
          projectId: projectLookup?.id ?? null,
          projectName: projectLookup?.name ?? null,
          projectAbbreviation: null,
          efsLaunchDate: text(record, "EFS_Launch_Date"),
          efsDeadline: text(record, "EFS_end_Date"),
          organizations: organizationsByProgram.get(record.id) ?? [],
          winnerOrganizations: (organizationsByProgram.get(record.id) ?? [])
            .filter(({ isWinner }) => isWinner)
            .map(({ organizationId, organizationName, currentYearCategory }) => ({
              organizationId,
              organizationName,
              currentYearCategory,
            })),
          ...(pricing ? { categoryPricing: pricing } : {}),
        };
      })
      .sort(
        (left, right) =>
          (right.year ?? 0) - (left.year ?? 0) ||
          left.name.localeCompare(right.name),
      );
  }
}

@ApiTags("Zoho compatibility")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "zoho", version: VERSION_NEUTRAL })
export class CompatibilityZohoController {
  constructor(
    @Inject(CompatibilityZohoService)
    private readonly zoho: CompatibilityZohoService,
  ) { }

  @Get("projects")
  async listProjects(@CurrentUser() principal: Principal) {
    const data = await this.zoho.listProjects(principal);
    return {
      success: true,
      message: "Zoho projects",
      data,
    };
  }

  @Get("programs")
  async listPrograms(@CurrentUser() principal: Principal) {
    const data = await this.zoho.listPrograms(principal);
    return {
      success: true,
      message: "Zoho programs",
      data,
    };
  }

  @Get("projects/:projectId/programs")
  async listProgramsForProject(
    @CurrentUser() principal: Principal,
    @Param("projectId") projectId: string,
  ) {
    const data = await this.zoho.listProgramsForProject(principal, projectId);
    return {
      success: true,
      message: "Zoho programs for project",
      data,
    };
  }

  @Get("programs/:programId/organizations")
  async listOrganizationsForProgram(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
  ) {
    const data = await this.zoho.listOrganizationsForProgram(
      principal,
      programId,
    );
    return {
      success: true,
      message: "Zoho organizations for program",
      data,
    };
  }

  @Get("syncProjects")
  projects(
    @CurrentUser() principal: Principal,
    @Query("idempotencyKey") idempotencyKey: string | undefined,
  ) {
    return this.zoho.sync(principal, "Projects", idempotencyKey);
  }

  @Get("syncPrograms")
  programs(
    @CurrentUser() principal: Principal,
    @Query("idempotencyKey") idempotencyKey: string | undefined,
  ) {
    return this.zoho.sync(principal, "Programs", idempotencyKey);
  }

  @Get("syncOrganizations")
  organizations(
    @CurrentUser() principal: Principal,
    @Query("idempotencyKey") idempotencyKey: string | undefined,
  ) {
    return this.zoho.sync(principal, "Accounts", idempotencyKey);
  }

  @Get("syncClients")
  clients(
    @CurrentUser() principal: Principal,
    @Query("idempotencyKey") idempotencyKey: string | undefined,
  ) {
    return this.zoho.sync(principal, "Contacts", idempotencyKey);
  }
}

@Module({
  imports: [AuthModule, CrmSyncModule, IntegrationsModule],
  providers: [CompatibilityZohoService],
  controllers: [CompatibilityZohoController],
})
export class CompatibilityZohoModule { }
