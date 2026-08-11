import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Post,
  UnauthorizedException,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { hash, verify } from "argon2";
import { IsOptional, IsString, MinLength } from "class-validator";
import { randomBytes, randomUUID } from "node:crypto";
import { BodyDto } from "../../common/http/body-dto.js";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";
import {
  AuthModule,
  AuthService,
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "./auth.module.js";

const previewLifetimeMs = 15 * 60 * 1000;
const entitlementKeys = [
  "WFR_Access",
  "EV_Access",
  "WBC_Access",
  "BBP_Access",
  "RD_Access",
  "KIA_Access",
  "CR_Access",
] as const;

class StartImpersonationDto {
  @IsString()
  @MinLength(1)
  organizationId!: string;

  @IsString()
  @MinLength(1)
  programId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

class ExchangeImpersonationDto {
  @IsString()
  @MinLength(3)
  grant!: string;
}

function referenceWhere(reference: string) {
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(reference);
  return {
    OR: [
      ...(isUuid ? [{ id: reference }] : []),
      { legacyId: reference },
      { externalId: reference },
    ],
  };
}

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

@Injectable()
export class ImpersonationService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  async start(principal: Principal, input: StartImpersonationDto) {
    this.assertPreviewAccess(principal);
    const actorLookup =
      principal.sub === "bypass-login-auth"
        ? this.prisma.user.findFirst({
            where: {
              status: "ACTIVE",
              roles: { some: { role: { key: "admin" } } },
            },
            orderBy: { createdAt: "asc" },
            select: { id: true, fullName: true },
          })
        : this.prisma.user.findUnique({
            where: { id: principal.sub },
            select: { id: true, fullName: true },
          });
    const [actor, organization, program] = await Promise.all([
      actorLookup,
      this.prisma.organization.findFirst({
        where: referenceWhere(input.organizationId),
        select: { id: true, name: true },
      }),
      this.prisma.program.findFirst({
        where: referenceWhere(input.programId),
        select: { id: true, name: true },
      }),
    ]);
    if (!actor) throw new UnauthorizedException("Administrator not found");
    if (!organization) throw new NotFoundException("Organization not found");
    if (!program) throw new NotFoundException("Program not found");

    const enrollment = await this.prisma.organizationProgram.findUnique({
      where: {
        organizationId_programId: {
          organizationId: organization.id,
          programId: program.id,
        },
      },
      select: { id: true },
    });
    if (!enrollment) {
      throw new BadRequestException("Organization does not belong to this program");
    }

    const target = await this.prisma.user.findFirst({
      where: {
        status: "ACTIVE",
        organizationId: organization.id,
        roles: { some: { role: { key: "client" } } },
        OR: [
          { organizationProgramId: enrollment.id },
          { programs: { some: { programId: program.id } } },
        ],
      },
      orderBy: { createdAt: "asc" },
      select: { id: true, fullName: true },
    });
    if (!target) {
      throw new NotFoundException("No active portal user can preview this dashboard");
    }

    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + previewLifetimeMs);
    const reason = input.reason?.trim() ?? "Preview client dashboard";
    await this.prisma.$transaction([
      this.prisma.impersonationGrant.create({
        data: {
          id,
          actorUserId: actor.id,
          targetUserId: target.id,
          organizationId: organization.id,
          programId: program.id,
          tokenHash: await hash(secret),
          expiresAt,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: actor.id,
          organizationId: organization.id,
          action: "admin.impersonation.created",
          resourceType: "ImpersonationGrant",
          resourceId: id,
          after: {
            targetUserId: target.id,
            programId: program.id,
            reason,
            expiresAt: expiresAt.toISOString(),
          },
        },
      }),
    ]);

    const clientUrl = new URL(
      "/admin-preview",
      this.config.get("FRONTEND_URL", { infer: true }) ?? "http://localhost:5173",
    );
    clientUrl.searchParams.set("grant", `${id}.${secret}`);
    return {
      url: clientUrl.toString(),
      expiresAt: expiresAt.toISOString(),
      organizationName: organization.name,
      programName: program.name,
      targetDisplayName: target.fullName,
    };
  }

  async exchange(rawGrant: string) {
    const separator = rawGrant.indexOf(".");
    if (separator < 1) throw new UnauthorizedException("Invalid preview grant");
    const id = rawGrant.slice(0, separator);
    const secret = rawGrant.slice(separator + 1);
    const grant = await this.prisma.impersonationGrant.findUnique({
      where: { id },
      include: {
        actor: { select: { id: true, fullName: true } },
        organization: { select: { id: true, name: true } },
        program: { select: { id: true, name: true, year: true } },
        target: {
          include: {
            roles: {
              include: {
                role: {
                  include: { permissions: { include: { permission: true } } },
                },
              },
            },
            programs: { include: { program: true } },
          },
        },
      },
    });
    if (
      !grant ||
      grant.consumedAt ||
      grant.revokedAt ||
      grant.expiresAt <= new Date() ||
      !(await verify(grant.tokenHash, secret))
    ) {
      throw new UnauthorizedException("Preview grant is invalid or expired");
    }
    const consumed = await this.prisma.impersonationGrant.updateMany({
      where: {
        id: grant.id,
        consumedAt: null,
        revokedAt: null,
        expiresAt: { gt: new Date() },
      },
      data: { consumedAt: new Date() },
    });
    if (consumed.count !== 1) {
      throw new UnauthorizedException("Preview grant has already been used");
    }

    const basePrincipal = await this.auth.principalForUserId(grant.targetUserId);
    const startedAt = new Date().toISOString();
    const principal: Principal = {
      ...basePrincipal,
      ...(this.config.get("BYPASS_LOGIN_AUTH", { infer: true })
        ? { localAuthBypass: true }
        : {}),
      impersonation: {
        grantId: grant.id,
        actorUserId: grant.actor.id,
        actorDisplayName: grant.actor.fullName,
        organizationId: grant.organization.id,
        programId: grant.program.id,
        startedAt,
      },
    };
    const accessToken = await this.auth.issueAccessToken(principal, "15m");
    const enrollment = await this.prisma.organizationProgram.findUnique({
      where: {
        organizationId_programId: {
          organizationId: grant.organization.id,
          programId: grant.program.id,
        },
      },
      select: { reportAccess: true },
    });
    const reportAccess = jsonObject(enrollment?.reportAccess ?? {});
    const entitlements = Object.fromEntries(
      entitlementKeys.map((key) => [key, reportAccess[key] === "no" ? "no" : "yes"]),
    );
    const expiresAt = new Date(Date.now() + previewLifetimeMs).toISOString();
    return {
      accessToken,
      session: {
        user: {
          id: grant.target.id,
          displayName: grant.target.fullName,
          email: grant.target.email,
          role: "client" as const,
          permissions: basePrincipal.permissions,
          programs: [
            {
              id: grant.program.id,
              name: grant.program.name,
              year: grant.program.year ?? new Date().getUTCFullYear(),
              organizationName: grant.organization.name,
              entitlements,
            },
          ],
        },
        verifiedAt: startedAt,
        expiresAt,
        impersonation: {
          actorId: grant.actor.id,
          actorDisplayName: grant.actor.fullName,
          reason: "Preview client dashboard",
          startedAt,
        },
      },
    };
  }

  async revoke(principal: Principal) {
    const impersonation = principal.impersonation;
    if (!impersonation) throw new BadRequestException("No preview session is active");
    await this.prisma.$transaction([
      this.prisma.impersonationGrant.updateMany({
        where: { id: impersonation.grantId, targetUserId: principal.sub },
        data: { revokedAt: new Date() },
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: impersonation.actorUserId,
          organizationId: impersonation.organizationId,
          action: "admin.impersonation.ended",
          resourceType: "ImpersonationGrant",
          resourceId: impersonation.grantId,
        },
      }),
    ]);
    return { ok: true };
  }

  private assertPreviewAccess(principal: Principal): void {
    if (
      !principal.roles.includes("admin") &&
      !principal.permissions.includes("ops.manage") &&
      !principal.permissions.includes("previewClientsDashboardAccess")
    ) {
      throw new ForbiddenException("Dashboard preview permission is required");
    }
  }
}

@ApiTags("admin impersonation")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "admin/impersonations", version: VERSION_NEUTRAL })
export class AdminImpersonationController {
  constructor(@Inject(ImpersonationService) private readonly service: ImpersonationService) {}

  @Post()
  @HttpCode(201)
  start(
    @CurrentUser() principal: Principal,
    @BodyDto(StartImpersonationDto) body: StartImpersonationDto,
  ) {
    return this.service.start(principal, body);
  }
}

@ApiTags("auth impersonation")
@Controller({ path: "auth/impersonations", version: VERSION_NEUTRAL })
export class ImpersonationExchangeController {
  constructor(@Inject(ImpersonationService) private readonly service: ImpersonationService) {}

  @Post("exchange")
  @HttpCode(200)
  exchange(@BodyDto(ExchangeImpersonationDto) body: ExchangeImpersonationDto) {
    return this.service.exchange(body.grant);
  }

  @Delete("current")
  @ApiBearerAuth()
  @UseGuards(JwtAuthGuard)
  revoke(@CurrentUser() principal: Principal) {
    return this.service.revoke(principal);
  }
}

@Module({
  imports: [AuthModule],
  providers: [ImpersonationService],
  controllers: [AdminImpersonationController, ImpersonationExchangeController],
})
export class ImpersonationModule {}
