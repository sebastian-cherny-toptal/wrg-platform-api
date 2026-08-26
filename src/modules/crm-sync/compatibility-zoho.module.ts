import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Module,
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

@Injectable()
export class CompatibilityZohoService {
  constructor(
    @Inject(SyncQueue) private readonly syncQueue: SyncQueue,
    @Inject(ZohoAdapter) private readonly zoho: ZohoAdapter,
  ) {}

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

  async listPrograms(principal: Principal) {
    this.assertAccess(principal);
    const records = await this.zoho.listAllRecords("Programs", [
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
    ]);
    const [projects, deals] = await Promise.all([
      this.zoho
        .listAllRecords("Main_Projects", ["id", "Name", "Project_Abbreviation"])
        .catch(() => []),
      this.zoho
        .listAllRecords("Deals", [
          "id",
          "Current_Year_Winner",
          "Program",
          "Account_Name",
          "Deal_Organization_ID",
          "Current_Year_Category",
        ])
        .catch(() => []),
    ]);
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
    const projectsById = new Map(
      projects.map((project) => [project.id, project]),
    );
    const winnerOrganizationsByProgram = new Map<
      string,
      Array<{
        organizationId: string;
        organizationName: string | null;
        currentYearCategory: string | null;
      }>
    >();
    for (const deal of deals) {
      if (text(deal, "Current_Year_Winner")?.toLowerCase() !== "yes") continue;
      const program = lookup(deal, "Program");
      if (!program) continue;
      const account = lookup(deal, "Account_Name");
      const organizationId =
        text(deal, "Deal_Organization_ID") ?? account?.id ?? "";
      if (!organizationId) continue;
      const winners = winnerOrganizationsByProgram.get(program.id) ?? [];
      if (!winners.some((winner) => winner.organizationId === organizationId)) {
        winners.push({
          organizationId,
          organizationName: account?.name ?? null,
          currentYearCategory: text(deal, "Current_Year_Category"),
        });
      }
      winnerOrganizationsByProgram.set(program.id, winners);
    }
    return records
      .map((record) => {
        const pricing = categoryPricing(record);
        const projectLookup = lookup(record, "Project");
        const project = projectLookup
          ? projectsById.get(projectLookup.id)
          : undefined;
        return {
          id: record.id,
          name: text(record, "Name") ?? record.id,
          year: year(record),
          projectId: projectLookup?.id ?? null,
          projectName:
            projectLookup?.name ?? (project ? text(project, "Name") : null),
          projectAbbreviation: project
            ? text(project, "Project_Abbreviation")
            : null,
          efsLaunchDate: text(record, "EFS_Launch_Date"),
          efsDeadline: text(record, "EFS_end_Date"),
          winnerOrganizations:
            winnerOrganizationsByProgram.get(record.id) ?? [],
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
  ) {}

  @Get("programs")
  async listPrograms(@CurrentUser() principal: Principal) {
    const data = await this.zoho.listPrograms(principal);
    return {
      success: true,
      message: "Zoho programs",
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
export class CompatibilityZohoModule {}
