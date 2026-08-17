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
import { hasPublishedBenefitsBestPractices } from "../reports/benefits-best-practices-workbook.js";

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
  @MinLength(1)
  targetUserId?: string;

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
    const actorLookup =
      principal.sub === "bypass-login-auth"
        ? this.prisma.user.findFirst({
            where: {
              status: "ACTIVE",
              roles: { some: { role: { key: "admin" } } },
            },
            orderBy: { createdAt: "asc" },
            select: { id: true, fullName: true, username: true, email: true },
          })
        : this.prisma.user.findUnique({
            where: { id: principal.sub },
            select: { id: true, fullName: true, username: true, email: true },
          });
    const [actor, context] = await Promise.all([
      actorLookup,
      this.previewContext(input.organizationId, input.programId),
    ]);
    if (!actor) throw new UnauthorizedException("Administrator not found");
    const { organization, program, enrollment } = context;

    const target = input.targetUserId
      ? await this.prisma.user.findFirst({
          where: {
            ...this.eligibleUserWhere(
              organization.id,
              program.id,
              enrollment.id,
            ),
            id: input.targetUserId,
          },
          select: { id: true, fullName: true, username: true, email: true },
        })
      : await this.genericPreviewUser(
          organization.id,
          program.id,
          program.projectId,
          enrollment.id,
        );
    if (!target) {
      throw new NotFoundException(
        "Selected portal user does not have access to this program",
      );
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
          action: "admin.impersonation.started",
          resourceType: "ImpersonationGrant",
          resourceId: id,
          after: {
            targetUserId: target.id,
            adminUsername: actor.username ?? actor.email,
            impersonatedUsername: target.username ?? target.email,
            programId: program.id,
            reason,
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
        program: {
          select: { id: true, name: true, year: true, metadata: true },
        },
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

    const basePrincipal = await this.auth.principalForUserId(
      grant.targetUserId,
    );
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
      entitlementKeys.map((key) => [
        key,
        key === "BBP_Access" &&
        !hasPublishedBenefitsBestPractices(grant.program.metadata)
          ? "no"
          : reportAccess[key] === "no"
            ? "no"
            : "yes",
      ]),
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

  private assertPreviewAccess(principal: Principal): void {
    if (
      !principal.roles.includes("admin") &&
      !principal.roles.includes("super_admin") &&
      !principal.permissions.includes("ops.manage") &&
      !principal.permissions.includes("previewClientsDashboardAccess")
    ) {
      throw new ForbiddenException("Dashboard preview permission is required");
    }
  }

  private eligibleUserWhere(
    organizationId: string,
    programId: string,
    organizationProgramId: string,
  ): Prisma.UserWhereInput {
    return {
      status: "ACTIVE",
      organizationId,
      roles: { some: { role: { key: "client" } } },
      OR: [{ organizationProgramId }, { programs: { some: { programId } } }],
    };
  }

  private async genericPreviewUser(
    organizationId: string,
    programId: string,
    projectId: string,
    organizationProgramId: string,
  ): Promise<{
    id: string;
    fullName: string;
    username: string | null;
    email: string;
  }> {
    const externalId = `generic-dashboard-preview-${organizationProgramId}`;
    const clientRole = await this.prisma.role.upsert({
      where: { key: "client" },
      update: {},
      create: { key: "client", name: "Client" },
    });
    const user = await this.prisma.user.upsert({
      where: { externalId },
      update: {
        organizationId,
        organizationProgramId,
        status: "ACTIVE",
      },
      create: {
        externalId,
        organizationId,
        organizationProgramId,
        email: `dashboard-preview+${organizationProgramId}@example.invalid`,
        username: `dashboard-preview-${organizationProgramId}`,
        fullName: "Generic Dashboard Preview",
        passwordHash: await hash(randomBytes(32).toString("base64url")),
        status: "ACTIVE",
        metadata: { genericDashboardPreview: true },
      },
      select: { id: true, fullName: true, username: true, email: true },
    });
    await Promise.all([
      this.prisma.userRole.upsert({
        where: {
          userId_roleId: { userId: user.id, roleId: clientRole.id },
        },
        update: {},
        create: { userId: user.id, roleId: clientRole.id },
      }),
      this.prisma.userProject.upsert({
        where: { userId_projectId: { userId: user.id, projectId } },
        update: {},
        create: { userId: user.id, projectId },
      }),
      this.prisma.userProgram.upsert({
        where: { userId_programId: { userId: user.id, programId } },
        update: {},
        create: { userId: user.id, programId },
      }),
    ]);
    return user;
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
        select: { id: true, name: true, projectId: true },
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
      select: { id: true },
    });
    if (!enrollment) {
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
