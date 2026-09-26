import {
  BadRequestException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
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
import { portalAccessMode } from "../reports/report-catalog.js";

const previewLifetimeMs = 15 * 60 * 1000;
const previewRoleKeys = ["admin", "super_admin"] as const;
const previewPermissionKeys = [
  "ops.manage",
  "previewClientsDashboardAccess",
] as const;
const entitlementKeys = [
  "WFR_Access",
  "EV_Access",
  "WBC_Access",
  "BBP_Access",
  "RD_Access",
  "KIA_Access",
  "SEV_Access",
  "CR_Access",
] as const;

class StartImpersonationDto {
  @IsString()
  @MinLength(1)
  organizationId!: string;

  @IsString()
  @MinLength(1)
  programId!: string;

  @IsString()
  @MinLength(1)
  targetUserId!: string;

  @IsOptional()
  @IsString()
  reason?: string;
}

class EligibleImpersonationUsersQuery {
  @IsString()
  @MinLength(1)
  organizationId!: string;

  @IsString()
  @MinLength(1)
  programId!: string;
}

class ExchangeImpersonationDto {
  @IsString()
  @MinLength(3)
  grant!: string;
}

function referenceWhere(reference: string) {
  const isUuid =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
      reference,
    );
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

  async eligibleUsers(
    principal: Principal,
    organizationReference: string,
    programReference: string,
  ) {
    this.assertPreviewAccess(principal);
    const { organization, program, enrollment } = await this.previewContext(
      organizationReference,
      programReference,
    );
    const users = await this.prisma.user.findMany({
      where: this.eligibleUserWhere(organization.id, program.id, enrollment.id),
      orderBy: [{ fullName: "asc" }, { email: "asc" }],
      select: {
        id: true,
        fullName: true,
        email: true,
        username: true,
      },
    });
    return {
      organization: { id: organization.id, name: organization.name },
      program: { id: program.id, name: program.name },
      users,
    };
  }

  async start(principal: Principal, input: StartImpersonationDto) {
    this.assertPreviewAccess(principal);
    const [actor, context] = await Promise.all([
      this.impersonatingActor(principal),
      this.previewContext(input.organizationId, input.programId),
    ]);
    if (!actor) throw new UnauthorizedException("Administrator not found");
    const { organization, program, enrollment } = context;

    const target = await this.prisma.user.findFirst({
      where: {
        ...this.eligibleUserWhere(organization.id, program.id, enrollment.id),
        id: input.targetUserId,
      },
      select: { id: true, fullName: true, username: true, email: true },
    });
    if (!target) {
      throw new NotFoundException(
        "Selected portal user does not have access to this program",
      );
    }

    return this.createGrant({
      actor,
      target,
      organization,
      programId: program.id,
      programIds: [program.id],
      programName: program.name,
      scope: "PROGRAM",
      reason: input.reason?.trim() ?? "Preview client dashboard",
    });
  }

  async startUser(principal: Principal, targetUserId: string) {
    this.assertPreviewAccess(principal);
    const [actor, target] = await Promise.all([
      this.impersonatingActor(principal),
      this.prisma.user.findFirst({
        where: {
          id: targetUserId,
          status: "ACTIVE",
          organizationId: { not: null },
          roles: {
            some: { role: { key: { in: ["client", "promotional"] } } },
          },
          programs: { some: {} },
        },
        select: {
          id: true,
          fullName: true,
          username: true,
          email: true,
          organization: { select: { id: true, name: true } },
          programs: { select: { programId: true } },
        },
      }),
    ]);
    if (!actor) throw new UnauthorizedException("Administrator not found");
    if (!target?.organization) {
      throw new NotFoundException(
        "Selected user is not an active portal user with assigned programs",
      );
    }
    const enrollments = await this.prisma.organizationProgram.findMany({
      where: {
        organizationId: target.organization.id,
        isIncluded: true,
        programId: { in: target.programs.map(({ programId }) => programId) },
      },
      select: { programId: true },
    });
    const programIds = enrollments.map(({ programId }) => programId);
    if (programIds.length === 0) {
      throw new NotFoundException(
        "Selected user has no included program assignments",
      );
    }
    return this.createGrant({
      actor,
      target,
      organization: target.organization,
      programId: null,
      programIds,
      scope: "USER",
      reason: "Impersonate portal user from administration",
    });
  }

  async exchange(rawGrant: string) {
    const separator = rawGrant.indexOf(".");
    if (separator < 1) throw new UnauthorizedException("Invalid preview grant");
    const id = rawGrant.slice(0, separator);
    const secret = rawGrant.slice(separator + 1);
    const grant = await this.prisma.impersonationGrant.findUnique({
      where: { id },
      include: {
        actor: {
          select: {
            id: true,
            fullName: true,
            status: true,
            roles: {
              select: {
                role: {
                  select: {
                    key: true,
                    permissions: {
                      select: { permission: { select: { key: true } } },
                    },
                  },
                },
              },
            },
          },
        },
        organization: { select: { id: true, name: true } },
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

    const actorRoleKeys = grant.actor.roles.map(({ role }) => role.key);
    const actorPermissionKeys = grant.actor.roles.flatMap(({ role }) =>
      role.permissions.map(({ permission }) => permission.key),
    );
    if (
      grant.actor.status !== "ACTIVE" ||
      !this.hasPreviewAccess(actorRoleKeys, actorPermissionKeys)
    ) {
      throw new ForbiddenException(
        "Administrator is no longer allowed to preview dashboards",
      );
    }
    const targetProgramIds = grant.target.programs.map(
      ({ program }) => program.id,
    );
    const requestedProgramIds =
      grant.scope === "PROGRAM"
        ? grant.programId
          ? [grant.programId]
          : []
        : targetProgramIds;
    const enrollments = await this.prisma.organizationProgram.findMany({
      where: {
        organizationId: grant.organization.id,
        programId: { in: requestedProgramIds },
        isIncluded: true,
      },
      orderBy: [{ program: { year: "asc" } }, { program: { name: "asc" } }],
      select: {
        id: true,
        isWinner: true,
        reportAccess: true,
        metrics: true,
        metadata: true,
        program: {
          select: {
            id: true,
            name: true,
            year: true,
            currency: true,
          },
        },
      },
    });
    if (enrollments.length === 0) {
      throw new ForbiddenException(
        grant.scope === "USER"
          ? "Selected portal user has no included program assignments"
          : "Organization is not included in this program",
      );
    }
    const portalRoles = grant.target.roles
      .map(({ role }) => role.key)
      .filter((role) => role === "client" || role === "promotional");
    const targetIsEligible =
      grant.target.status === "ACTIVE" &&
      grant.target.organizationId === grant.organization.id &&
      portalRoles.length > 0 &&
      (grant.scope === "USER" ||
        grant.target.organizationProgramId === enrollments[0]?.id ||
        targetProgramIds.includes(enrollments[0]?.program.id ?? ""));
    if (!targetIsEligible) {
      throw new ForbiddenException(
        "Selected portal user no longer has access to this program",
      );
    }

    const basePrincipal = await this.auth.principalForUserId(
      grant.targetUserId,
    );
    if (basePrincipal.organizationId !== grant.organization.id) {
      throw new ForbiddenException(
        "Selected portal user no longer belongs to this organization",
      );
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

    const startedAt = new Date().toISOString();
    const programIds = enrollments.map(({ program }) => program.id);
    const principal: Principal = {
      ...basePrincipal,
      roles: portalRoles,
      permissions: [],
      ...(this.config.get("BYPASS_LOGIN_AUTH", { infer: true })
        ? { localAuthBypass: true }
        : {}),
      impersonation: {
        scope: grant.scope === "USER" ? "user" : "program",
        grantId: grant.id,
        actorUserId: grant.actor.id,
        actorDisplayName: grant.actor.fullName,
        organizationId: grant.organization.id,
        programIds,
        startedAt,
      },
    };
    const remainingSeconds = Math.max(
      1,
      Math.floor((grant.expiresAt.getTime() - Date.now()) / 1000),
    );
    const accessToken = await this.auth.issueAccessToken(
      principal,
      `${remainingSeconds}s`,
    );
    const programs = enrollments.map((enrollment) => {
      const reportAccess = jsonObject(enrollment.reportAccess);
      const metrics = jsonObject(enrollment.metrics);
      const entitlements = Object.fromEntries(
        entitlementKeys.map((key) => [
          key,
          key === "BBP_Access"
            ? reportAccess.BBP_Access === "yes" ||
              reportAccess.benefitsBestPractices === "yes"
              ? "yes"
              : "no"
            : key === "KIA_Access" &&
                typeof metrics.KIA_Order_Status === "string"
              ? "yes"
              : reportAccess[key] === "yes"
                ? "yes"
                : "no",
        ]),
      );
      return {
        id: enrollment.program.id,
        name: enrollment.program.name,
        year: enrollment.program.year ?? new Date().getUTCFullYear(),
        currency: enrollment.program.currency,
        organizationName:
          typeof metrics.Source_Organization_Name === "string"
            ? metrics.Source_Organization_Name
            : grant.organization.name,
        accessMode: portalAccessMode(enrollment.metadata, portalRoles),
        benchmarkReportsAvailable: enrollment.isWinner != null,
        entitlements,
        reportSelections: {
          ...(typeof metrics.SEV_Filter === "string"
            ? { SEV_Filter: metrics.SEV_Filter }
            : {}),
          ...(typeof metrics.KIA_Order_Status === "string"
            ? { KIA_Order_Status: metrics.KIA_Order_Status }
            : {}),
        },
      };
    });
    return {
      accessToken,
      session: {
        user: {
          id: grant.target.id,
          displayName: grant.target.fullName,
          email: grant.target.email,
          role: portalRoles.includes("client")
            ? ("client" as const)
            : ("promotional" as const),
          permissions: [],
          programs,
        },
        verifiedAt: startedAt,
        expiresAt: grant.expiresAt.toISOString(),
        impersonation: {
          actorId: grant.actor.id,
          actorDisplayName: grant.actor.fullName,
          reason:
            grant.scope === "USER"
              ? "Impersonating portal user"
              : "Preview client dashboard",
          startedAt,
        },
      },
    };
  }

  async revoke(principal: Principal) {
    const impersonation = principal.impersonation;
    if (!impersonation)
      throw new BadRequestException("No preview session is active");
    const [actor, target] = await Promise.all([
      this.prisma.user.findUnique({
        where: { id: impersonation.actorUserId },
        select: { username: true, email: true },
      }),
      this.prisma.user.findUnique({
        where: { id: principal.sub },
        select: { username: true, email: true },
      }),
    ]);
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
          after: {
            scope: impersonation.scope,
            programIds: impersonation.programIds,
            adminUsername:
              actor?.username ?? actor?.email ?? impersonation.actorDisplayName,
            impersonatedUsername:
              target?.username ?? target?.email ?? principal.sub,
          },
        },
      }),
    ]);
    return { ok: true };
  }

  private impersonatingActor(principal: Principal) {
    const actorWhere: Prisma.UserWhereInput = {
      status: "ACTIVE",
      OR: [
        { roles: { some: { role: { key: { in: [...previewRoleKeys] } } } } },
        {
          roles: {
            some: {
              role: {
                permissions: {
                  some: {
                    permission: { key: { in: [...previewPermissionKeys] } },
                  },
                },
              },
            },
          },
        },
      ],
    };
    return this.prisma.user.findFirst({
      where:
        principal.sub === "bypass-login-auth"
          ? actorWhere
          : { ...actorWhere, id: principal.sub },
      ...(principal.sub === "bypass-login-auth"
        ? { orderBy: { createdAt: "asc" as const } }
        : {}),
      select: { id: true, fullName: true, username: true, email: true },
    });
  }

  private async createGrant(input: {
    actor: {
      id: string;
      username: string | null;
      email: string;
    };
    target: {
      id: string;
      fullName: string;
      username: string | null;
      email: string;
    };
    organization: { id: string; name: string };
    programId: string | null;
    programIds: string[];
    programName?: string;
    scope: "PROGRAM" | "USER";
    reason: string;
  }) {
    const id = randomUUID();
    const secret = randomBytes(32).toString("base64url");
    const expiresAt = new Date(Date.now() + previewLifetimeMs);
    await this.prisma.$transaction([
      this.prisma.impersonationGrant.create({
        data: {
          id,
          actorUserId: input.actor.id,
          targetUserId: input.target.id,
          organizationId: input.organization.id,
          programId: input.programId,
          scope: input.scope,
          tokenHash: await hash(secret),
          expiresAt,
        },
      }),
      this.prisma.auditLog.create({
        data: {
          actorUserId: input.actor.id,
          organizationId: input.organization.id,
          action:
            input.scope === "USER"
              ? "admin.user_impersonation.started"
              : "admin.impersonation.started",
          resourceType: "ImpersonationGrant",
          resourceId: id,
          after: {
            scope: input.scope.toLowerCase(),
            targetUserId: input.target.id,
            adminUsername: input.actor.username ?? input.actor.email,
            impersonatedUsername: input.target.username ?? input.target.email,
            programIds: input.programIds,
            reason: input.reason,
            expiresAt: expiresAt.toISOString(),
          },
        },
      }),
    ]);

    const clientUrl = new URL(
      "/admin-preview",
      this.config.get("FRONTEND_URL", { infer: true }) ??
        "http://localhost:5173",
    );
    clientUrl.searchParams.set("grant", `${id}.${secret}`);
    return {
      url: clientUrl.toString(),
      expiresAt: expiresAt.toISOString(),
      organizationName: input.organization.name,
      ...(input.programName ? { programName: input.programName } : {}),
      targetDisplayName: input.target.fullName,
    };
  }

  private assertPreviewAccess(principal: Principal): void {
    if (!this.hasPreviewAccess(principal.roles, principal.permissions)) {
      throw new ForbiddenException("Dashboard preview permission is required");
    }
  }

  private hasPreviewAccess(roles: string[], permissions: string[]): boolean {
    return (
      previewRoleKeys.some((role) => roles.includes(role)) ||
      previewPermissionKeys.some((permission) =>
        permissions.includes(permission),
      )
    );
  }

  private eligibleUserWhere(
    organizationId: string,
    programId: string,
    organizationProgramId: string,
  ): Prisma.UserWhereInput {
    return {
      status: "ACTIVE",
      organizationId,
      roles: {
        some: { role: { key: { in: ["client", "promotional"] } } },
      },
      OR: [{ organizationProgramId }, { programs: { some: { programId } } }],
    };
  }

  private async previewContext(
    organizationReference: string,
    programReference: string,
  ) {
    const [organization, program] = await Promise.all([
      this.prisma.organization.findFirst({
        where: referenceWhere(organizationReference),
        select: { id: true, name: true },
      }),
      this.prisma.program.findFirst({
        where: referenceWhere(programReference),
        select: { id: true, name: true },
      }),
    ]);
    if (!organization) throw new NotFoundException("Organization not found");
    if (!program) throw new NotFoundException("Program not found");
    const enrollment = await this.prisma.organizationProgram.findUnique({
      where: {
        organizationId_programId: {
          organizationId: organization.id,
          programId: program.id,
        },
      },
      select: { id: true, isIncluded: true },
    });
    if (!enrollment?.isIncluded) {
      throw new BadRequestException(
        "Organization does not belong to this program",
      );
    }
    return { organization, program, enrollment };
  }
}

@ApiTags("admin impersonation")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "admin/impersonations", version: VERSION_NEUTRAL })
export class AdminImpersonationController {
  constructor(
    @Inject(ImpersonationService)
    private readonly service: ImpersonationService,
  ) {}

  @Get("eligible-users")
  eligibleUsers(
    @CurrentUser() principal: Principal,
    @Query() query: EligibleImpersonationUsersQuery,
  ) {
    return this.service.eligibleUsers(
      principal,
      query.organizationId,
      query.programId,
    );
  }

  @Post()
  @HttpCode(201)
  start(
    @CurrentUser() principal: Principal,
    @BodyDto(StartImpersonationDto) body: StartImpersonationDto,
  ) {
    return this.service.start(principal, body);
  }

  @Post("users/:targetUserId")
  @HttpCode(201)
  startUser(
    @CurrentUser() principal: Principal,
    @Param("targetUserId") targetUserId: string,
  ) {
    return this.service.startUser(principal, targetUserId);
  }
}

@ApiTags("auth impersonation")
@Controller({ path: "auth/impersonations", version: VERSION_NEUTRAL })
export class ImpersonationExchangeController {
  constructor(
    @Inject(ImpersonationService)
    private readonly service: ImpersonationService,
  ) {}

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
