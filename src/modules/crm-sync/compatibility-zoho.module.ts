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
import { CrmSyncModule, SyncQueue } from "./crm-sync.module.js";

type ZohoSyncKind = "Projects" | "Programs" | "Accounts" | "Contacts";

@Injectable()
export class CompatibilityZohoService {
  constructor(@Inject(SyncQueue) private readonly syncQueue: SyncQueue) {}

  async sync(principal: Principal, kind: ZohoSyncKind, requestedKey?: string) {
    if (
      !principal.roles.includes("admin") &&
      !principal.roles.includes("super_admin") &&
      !principal.permissions.includes("ops.manage") &&
      !principal.permissions.includes("clientsProjectsProgramsAccess") &&
      !principal.permissions.includes("syncCheckmartketAndZohoAccess")
    ) {
      throw new ForbiddenException("Access denied");
    }
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
  imports: [AuthModule, CrmSyncModule],
  providers: [CompatibilityZohoService],
  controllers: [CompatibilityZohoController],
})
export class CompatibilityZohoModule {}
