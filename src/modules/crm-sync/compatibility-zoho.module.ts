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
    const records = await this.zoho.listAllRecords("Programs");
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
    return records
      .map((record) => {
        const pricing = categoryPricing(record);
        return {
          id: record.id,
          name: text(record, "Name") ?? record.id,
          year: year(record),
          efsLaunchDate: text(record, "EFS_Launch_Date"),
          efsDeadline: text(record, "EFS_end_Date"),
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
