import {
  ArrayMaxSize,
  ArrayUnique,
  IsArray,
  IsEmail,
  IsIn,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import {
  BadRequestException,
  CanActivate,
  ConflictException,
  Controller,
  Delete,
  ExecutionContext,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Put,
  Query,
  ServiceUnavailableException,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiParam,
  ApiProperty,
  ApiPropertyOptional,
  ApiQuery,
  ApiTags,
} from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import sendGrid from "@sendgrid/mail";
import { hash } from "argon2";
import { randomBytes } from "node:crypto";
import { BodyDto } from "../../common/http/body-dto.js";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";
import {
  AuthModule,
  AuthService,
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import { hasPublishedBenefitsBestPractices } from "../reports/benefits-best-practices-workbook.js";

class ClientLoginDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  username!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsEmail()
  userEmail?: string;
}

class CreateUserDto {
  @ApiProperty({ type: String, example: "person@example.com" })
  @IsEmail()
  email!: string;

  @ApiProperty({ type: String, example: "Example Person" })
  @IsString()
  @MinLength(1)
  fullName!: string;

  @ApiPropertyOptional({ type: String, minLength: 8 })
  @IsOptional()
  @IsString()
  @MinLength(8)
  password?: string;

  @ApiProperty({ type: String, example: "example.person" })
  @IsString()
  @MinLength(1)
  username!: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  mobile?: string;

  @ApiPropertyOptional({ type: String, enum: ["mobile", "email"] })
  @IsOptional()
  @IsIn(["mobile", "email"])
  mfa?: "mobile" | "email";

  @ApiProperty({
    type: String,
    description: "A native, migrated, or keyed role reference.",
  })
  @IsString()
  @MinLength(1)
  roleId!: string;

  @ApiPropertyOptional({
    type: [String],
    description: "Native project IDs or migrated legacy project IDs.",
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  projects?: string[];

  @ApiPropertyOptional({
    type: String,
    description:
      "Required for client users. A native or migrated organization ID.",
  })
  @IsOptional()
  @IsString()
  organizationId?: string;

  @ApiPropertyOptional({
    type: [String],
    description:
      "Required for client users. Programs enrolled to the selected organization.",
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  programs?: string[];
}

class UpdateUserDto {
  @ApiPropertyOptional({ type: String, example: "person@example.com" })
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ type: String, example: "Example Person" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  username?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  mobile?: string;

  @ApiPropertyOptional({ type: String, enum: ["mobile", "email"] })
  @IsOptional()
  @IsIn(["mobile", "email"])
  mfa?: "mobile" | "email";

  @ApiPropertyOptional({
    type: String,
    description: "A native role ID or a migrated legacy role ID.",
  })
  @IsOptional()
  @IsString()
  roleId?: string;

  @ApiPropertyOptional({
    type: [String],
    description: "Native project IDs or migrated legacy project IDs.",
  })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @ArrayMaxSize(100)
  @IsString({ each: true })
  projects?: string[];
}

interface UserMutationResponse {
  success: true;
  message: "User created successfully" | "User updated successfully";
  data: {
    id: string;
    email: string;
    username: string | null;
    fullName: string;
    mobile: string | null;
    mfa: "mobile" | "email";
    status: "INVITED" | "ACTIVE" | "DISABLED";
    role: { id: string; key: string; name: string } | null;
    projects: Array<{ id: string; name: string }>;
    createdAt: Date;
  };
}

type CreateUserResponse = UserMutationResponse & {
  message: "User created successfully";
};

type UpdateUserResponse = UserMutationResponse & {
  message: "User updated successfully";
};

interface ListUsersResponse {
  success: true;
  message: "success";
  data: Array<Record<string, unknown>>;
}

interface DeleteUserResponse {
  success: true;
  message: "User deleted successfully";
}

interface ClientLoginResponse {
  success: true;
  message: "true";
  data: {
    userData: Record<string, unknown>;
    accessToken: string;
    refreshToken: string;
    salesUser: Record<string, unknown> | [];
  };
}

const listUserFields = new Set([
  "_id",
  "id",
  "fullName",
  "email",
  "mobile",
  "username",
  "role",
  "roleId",
  "projects",
  "createAt",
  "updatedAt",
  "isActive",
  "mfa",
  "status",
  "organization",
  "lastLogin",
]);

const administratorRoleKeys = ["admin", "super_admin"] as const;

function isAdministrator(roles: readonly string[]): boolean {
  return administratorRoleKeys.some((role) => roles.includes(role));
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function basicClientReportAccess(
  value: Prisma.JsonValue,
): Prisma.InputJsonObject {
  return {
    ...jsonObject(value),
    WFR_Access: "yes",
    EV_Access: "yes",
    WBC_Access: "yes",
    BBP_Access: "yes",
  };
}

@Injectable()
export class AdminRoleGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const principal = context
      .switchToHttp()
      .getRequest<{ user?: Principal }>().user;
    if (!principal || !isAdministrator(principal.roles)) {
      throw new ForbiddenException("Administrator access required");
    }
    return true;
  }
}

@Injectable()
export class ClientLoginService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly auth: AuthService,
  ) {}

  async login(
    dto: ClientLoginDto,
    skipLastLogin?: string | string[],
  ): Promise<ClientLoginResponse> {
    if (Array.isArray(skipLastLogin)) {
      throw new BadRequestException("Query parameters must not be repeated");
    }
    if (
      skipLastLogin !== undefined &&
      skipLastLogin !== "true" &&
      skipLastLogin !== "false"
    ) {
      throw new BadRequestException("skipLastLogin must be true or false");
    }

    const username = dto.username.trim();
    if (!username) throw new BadRequestException("Username is required");
    const user = await this.prisma.user.findFirst({
      where: {
        username,
        status: "ACTIVE",
        roles: { some: { role: { key: { in: ["client", "promotional"] } } } },
      },
      select: {
        id: true,
        legacyId: true,
        email: true,
        username: true,
        fullName: true,
        metadata: true,
        organizationProgramId: true,
        organization: {
          select: {
            id: true,
            legacyId: true,
            externalId: true,
            name: true,
            metadata: true,
          },
        },
        organizationProgram: {
          select: {
            id: true,
            legacyId: true,
            dealExternalId: true,
            project: {
              select: { id: true, legacyId: true, name: true },
            },
          },
        },
        roles: {
          select: {
            role: {
              select: {
                id: true,
                legacyId: true,
                key: true,
                permissions: {
                  select: { permission: { select: { key: true } } },
                },
              },
            },
          },
        },
        projects: {
          select: {
            project: {
              select: { id: true, legacyId: true, name: true },
            },
          },
        },
        programs: {
          select: {
            program: {
              select: {
                id: true,
                legacyId: true,
                externalId: true,
                name: true,
                year: true,
                currency: true,
                fees: true,
              },
            },
          },
        },
      },
    });
    if (!user) {
      throw new NotFoundException("username is incorrect");
    }
    if (!user.organization) {
      throw new ConflictException("User organization is not configured");
    }

    const primaryProject =
      user.organizationProgram?.project ?? user.projects[0]?.project;
    const organizationPrograms = await this.prisma.organizationProgram.findMany(
      {
        where: {
          organizationId: user.organization.id,
          ...(primaryProject ? { projectId: primaryProject.id } : {}),
          programId: {
            in: user.programs.map(({ program }) => program.id),
          },
        },
        orderBy: [{ program: { year: "asc" } }, { program: { name: "asc" } }],
        select: {
          id: true,
          legacyId: true,
          dealExternalId: true,
          stage: true,
          reportAccess: true,
          paymentDetails: true,
          metadata: true,
          project: {
            select: { id: true, legacyId: true, name: true },
          },
          program: {
            select: {
              id: true,
              legacyId: true,
              externalId: true,
              name: true,
              year: true,
              currency: true,
              fees: true,
            },
          },
        },
      },
    );

    const salesUser = primaryProject
      ? await this.prisma.user.findFirst({
          where: {
            status: "ACTIVE",
            roles: { some: { role: { key: "sales" } } },
            projects: { some: { projectId: primaryProject.id } },
          },
          select: {
            id: true,
            legacyId: true,
            email: true,
            fullName: true,
          },
        })
      : null;
    const principal: Principal = {
      sub: user.id,
      organizationId: user.organization.id,
      roles: user.roles.map(({ role }) => role.key),
      permissions: [
        ...new Set(
          user.roles.flatMap(({ role }) =>
            role.permissions.map(({ permission }) => permission.key),
          ),
        ),
      ],
    };
    const tokens = await this.auth.issueTokens(principal);

    if (skipLastLogin !== "true") {
      const timestamp = new Date().toISOString();
      await this.prisma.organization.update({
        where: { id: user.organization.id },
        data: {
          metadata: {
            ...jsonObject(user.organization.metadata),
            lastLogin: timestamp,
          },
        },
      });
      await this.prisma.auditLog.create({
        data: {
          organizationId: user.organization.id,
          actorUserId: user.id,
          action: "user.client_login",
          resourceType: "User",
          resourceId: user.id,
          after: {
            username,
            email: dto.userEmail ?? user.email,
            loginTime: timestamp,
          },
        },
      });
    }

    const metadata = jsonObject(user.metadata);
    const projectData = (project: {
      id: string;
      legacyId: string | null;
      name: string;
    }) => ({
      _id: project.legacyId ?? project.id,
      id: project.id,
      Name: project.name,
      name: project.name,
    });
    const programData = (program: {
      id: string;
      legacyId: string | null;
      externalId: string | null;
      name: string;
      year: number | null;
      currency: string;
      fees: Prisma.JsonValue;
    }) => ({
      _id: program.legacyId ?? program.id,
      id: program.id,
      externalId: program.externalId,
      Name: program.name,
      name: program.name,
      Program_Year: program.year === null ? null : String(program.year),
      year: program.year,
      Currency: program.currency,
      currency: program.currency,
      fees: program.fees,
    });
    const role = user.roles[0]?.role;
    const userData: Record<string, unknown> = {
      _id: user.legacyId ?? user.id,
      id: user.id,
      email: user.email,
      username: user.username,
      fullName: user.fullName,
      mobile: typeof metadata.mobile === "string" ? metadata.mobile : null,
      role: role?.key ?? "client",
      roleId: role ? (role.legacyId ?? role.id) : null,
      isActive: true,
      organizationId: {
        _id: user.organization.legacyId ?? user.organization.id,
        id: user.organization.id,
        Account_Name: user.organization.name,
        name: user.organization.name,
        externalId: user.organization.externalId,
      },
      projectId: primaryProject ? projectData(primaryProject) : null,
      projects: user.projects.map(({ project }) => projectData(project)),
      programs: user.programs.map(({ program }) => programData(program)),
      organizationprogramId: user.organizationProgram
        ? (user.organizationProgram.legacyId ?? user.organizationProgram.id)
        : user.organizationProgramId,
      dealId: user.organizationProgram?.dealExternalId ?? null,
      organizationProgram: organizationPrograms.map((item) => {
        const reportAccess = jsonObject(item.reportAccess);
        const benefitsAccess =
          reportAccess.BBP_Access === "yes" ||
          reportAccess.benefitsBestPractices === "yes";
        return {
          _id: item.legacyId ?? item.id,
          id: item.id,
          DealId: item.dealExternalId,
          stage: item.stage,
          reportAccess: {
            ...reportAccess,
            BBP_Access:
              benefitsAccess && hasPublishedBenefitsBestPractices(item.metadata)
                ? "yes"
                : "no",
          },
          paymentDetails: item.paymentDetails,
          projectId: projectData(item.project),
          programId: programData(item.program),
        };
      }),
    };
    return {
      success: true,
      message: "true",
      data: {
        userData,
        ...tokens,
        salesUser: salesUser
          ? {
              _id: salesUser.legacyId ?? salesUser.id,
              id: salesUser.id,
              email: salesUser.email,
              fullName: salesUser.fullName,
            }
          : [],
      },
    };
  }
}

@Injectable()
export class UserInvitationMailer {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  assertConfigured(): void {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) return;
    if (
      !this.config.get("SENDGRID_KEY", { infer: true }) ||
      !this.config.get("SENDGRID_DOMAIN", { infer: true })
    ) {
      throw new ServiceUnavailableException(
        "User invitation email is not configured",
      );
    }
  }

  async sendWelcome(email: string, password: string): Promise<void> {
    await this.send(
      email,
      "Welcome to the application",
      `Your password is ${password}`,
    );
  }

  async send(email: string, subject: string, text: string): Promise<void> {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) return;
    const apiKey = this.config.get("SENDGRID_KEY", { infer: true });
    const sender = this.config.get("SENDGRID_DOMAIN", { infer: true });
    if (!apiKey || !sender) {
      throw new ServiceUnavailableException(
        "User invitation email is not configured",
      );
    }
    sendGrid.setApiKey(apiKey);
    await sendGrid.send({
      to: email,
      from: { name: "Workforce Research Group", email: sender },
      subject,
      text,
    });
  }
}

@Injectable()
export class UsersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(UserInvitationMailer) private readonly mailer: UserInvitationMailer,
  ) {}

  async create(dto: CreateUserDto): Promise<CreateUserResponse> {
    const email = dto.email.trim().toLowerCase();
    const fullName = dto.fullName.trim();
    const username = dto.username.trim();
    if (!fullName) throw new BadRequestException("Full name is required");
    if (!username) throw new BadRequestException("Username is required");
    // this.mailer.assertConfigured();

    if (
      await this.prisma.user.findUnique({
        where: { email },
        select: { id: true },
      })
    ) {
      throw new ConflictException("User already exists");
    }

    const role = await this.prisma.role.findFirst({
      where: isUuid(dto.roleId)
        ? { id: dto.roleId }
        : {
            OR: [
              { legacyId: dto.roleId },
              { externalId: dto.roleId },
              { key: dto.roleId },
            ],
          },
      select: { id: true, key: true, name: true },
    });
    if (!role) throw new NotFoundException("Role not found");

    if (
      role.key === "super_admin" &&
      (await this.prisma.userRole.findFirst({
        where: { roleId: role.id },
        select: { userId: true },
      }))
    ) {
      throw new ForbiddenException("Super Admin user already exists");
    }

    const isClient = role.key === "client" || role.key === "promotional";
    const projectReferences = dto.projects ?? [];
    const programReferences = dto.programs ?? [];
    if (isClient && !dto.organizationId) {
      throw new BadRequestException(
        "Organization is required for client users",
      );
    }
    if (isClient && programReferences.length === 0) {
      throw new BadRequestException(
        "At least one program is required for client users",
      );
    }
    if (!isClient && (dto.organizationId || programReferences.length > 0)) {
      throw new BadRequestException(
        "Organization and programs can only be assigned to client users",
      );
    }

    const organization = dto.organizationId
      ? await this.prisma.organization.findFirst({
          where: isUuid(dto.organizationId)
            ? { id: dto.organizationId }
            : {
                OR: [
                  { legacyId: dto.organizationId },
                  { externalId: dto.organizationId },
                ],
              },
          select: { id: true },
        })
      : null;
    if (dto.organizationId && !organization) {
      throw new NotFoundException("Organization not found");
    }

    const selectedPrograms =
      programReferences.length === 0
        ? []
        : await this.prisma.program.findMany({
            where: {
              OR: programReferences.map((reference) =>
                isUuid(reference)
                  ? { id: reference }
                  : {
                      OR: [{ legacyId: reference }, { externalId: reference }],
                    },
              ),
            },
            select: { id: true, name: true, projectId: true },
          });
    if (selectedPrograms.length !== programReferences.length) {
      throw new NotFoundException("One or more programs were not found");
    }

    const enrollments = organization
      ? await this.prisma.organizationProgram.findMany({
          where: {
            organizationId: organization.id,
            programId: { in: selectedPrograms.map(({ id }) => id) },
          },
          select: {
            id: true,
            programId: true,
            projectId: true,
            reportAccess: true,
            project: { select: { id: true, name: true } },
          },
        })
      : [];
    if (isClient && enrollments.length !== selectedPrograms.length) {
      throw new BadRequestException(
        "One or more programs are not available to the selected organization",
      );
    }
    if (new Set(enrollments.map(({ projectId }) => projectId)).size > 1) {
      throw new BadRequestException(
        "Client programs must belong to the same project",
      );
    }

    const managementProjects =
      projectReferences.length === 0
        ? []
        : await this.prisma.project.findMany({
            where: {
              OR: projectReferences.map((reference) =>
                isUuid(reference)
                  ? { id: reference }
                  : {
                      OR: [{ legacyId: reference }, { externalId: reference }],
                    },
              ),
            },
            select: { id: true, name: true },
          });
    if (managementProjects.length !== projectReferences.length) {
      throw new NotFoundException("One or more projects were not found");
    }
    const projects = isClient
      ? [
          ...new Map(
            enrollments.map(({ project }) => [project.id, project]),
          ).values(),
        ]
      : managementProjects;
    const primaryEnrollment = enrollments[0] ?? null;

    const password = dto.password ?? randomBytes(18).toString("base64url");
    const mfa = dto.mfa ?? "email";
    const metadata: Prisma.InputJsonObject = {
      ...(dto.mobile ? { mobile: dto.mobile } : {}),
      mfa,
    };

    try {
      const createUser = async (
        database: Pick<Prisma.TransactionClient, "user">,
      ) => {
        const created = await database.user.create({
          data: {
            email,
            username,
            fullName,
            ...(organization ? { organizationId: organization.id } : {}),
            ...(primaryEnrollment
              ? { organizationProgramId: primaryEnrollment.id }
              : {}),
            passwordHash: await hash(password),
            status: "INVITED",
            mfaEnabled: false,
            metadata,
            roles: { create: [{ roleId: role.id }] },
            ...(projects.length > 0
              ? {
                  projects: {
                    create: projects.map((project) => ({
                      projectId: project.id,
                    })),
                  },
                }
              : {}),
            ...(selectedPrograms.length > 0
              ? {
                  programs: {
                    create: selectedPrograms.map((program) => ({
                      programId: program.id,
                    })),
                  },
                }
              : {}),
          },
          select: { id: true },
        });
        // await this.mailer.sendWelcome(email, password);
        return database.user.update({
          where: { id: created.id },
          data: { status: "ACTIVE" },
          select: {
            id: true,
            email: true,
            username: true,
            fullName: true,
            createdAt: true,
          },
        });
      };
      const user = role.key === "client"
        ? await this.prisma.$transaction(async (transaction) => {
            await Promise.all(
              enrollments.map((enrollment) =>
                transaction.organizationProgram.update({
                  where: { id: enrollment.id },
                  data: {
                    reportAccess: basicClientReportAccess(
                      enrollment.reportAccess,
                    ),
                  },
                }),
              ),
            );
            return createUser(transaction);
          })
        : await createUser(this.prisma);
      return {
        success: true,
        message: "User created successfully",
        data: {
          ...user,
          mobile: dto.mobile ?? null,
          mfa,
          status: "ACTIVE",
          role,
          projects,
        },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("User already exists");
      }
      throw error;
    }
  }

  async update(
    reference: string,
    dto: UpdateUserDto,
    principal: Principal,
  ): Promise<UpdateUserResponse> {
    if (Object.keys(dto).length === 0) {
      throw new BadRequestException("At least one field is required");
    }

    const target = await this.prisma.user.findFirst({
      where: isUuid(reference) ? { id: reference } : { legacyId: reference },
      select: {
        id: true,
        metadata: true,
        roles: { select: { role: { select: { id: true, key: true } } } },
      },
    });
    if (!target) throw new NotFoundException("User not found");

    const isAdmin = isAdministrator(principal.roles);
    if (!isAdmin && target.id !== principal.sub) {
      throw new ForbiddenException("You can only update your own user");
    }
    if (!isAdmin && (dto.roleId !== undefined || dto.projects !== undefined)) {
      throw new ForbiddenException("Only administrators can assign access");
    }

    const email = dto.email?.trim().toLowerCase();
    if (email) {
      const existing = await this.prisma.user.findFirst({
        where: { email, id: { not: target.id } },
        select: { id: true },
      });
      if (existing) throw new ConflictException("User already exists");
    }

    const fullName = dto.fullName?.trim();
    if (fullName === "") throw new BadRequestException("Full name is required");
    const normalizedUsername = dto.username?.trim();

    const role =
      dto.roleId === undefined
        ? undefined
        : await this.prisma.role.findFirst({
            where: isUuid(dto.roleId)
              ? { id: dto.roleId }
              : {
                  OR: [
                    { legacyId: dto.roleId },
                    { externalId: dto.roleId },
                    { key: dto.roleId },
                  ],
                },
            select: { id: true, key: true, name: true },
          });
    if (dto.roleId !== undefined && !role) {
      throw new NotFoundException("Role not found");
    }
    const currentSuperAdminRole = target.roles.find(
      ({ role: current }) => current.key === "super_admin",
    )?.role;
    if (
      role &&
      (role.key === "super_admin" || currentSuperAdminRole) &&
      role.id !== currentSuperAdminRole?.id
    ) {
      throw new ForbiddenException("The Super Admin role cannot be reassigned");
    }

    const projectReferences = dto.projects;
    const projects =
      projectReferences === undefined
        ? undefined
        : projectReferences.length === 0
          ? []
          : await this.prisma.project.findMany({
              where: {
                OR: projectReferences.map((projectReference) =>
                  isUuid(projectReference)
                    ? { id: projectReference }
                    : { legacyId: projectReference },
                ),
              },
              select: { id: true, name: true },
            });
    if (
      projectReferences !== undefined &&
      projects !== undefined &&
      projects.length !== projectReferences.length
    ) {
      throw new NotFoundException("One or more projects were not found");
    }

    const currentMetadata = jsonObject(target.metadata);
    const metadata: Prisma.InputJsonObject = {
      ...currentMetadata,
      ...(dto.mobile !== undefined ? { mobile: dto.mobile } : {}),
      ...(dto.mfa !== undefined ? { mfa: dto.mfa } : {}),
    };

    try {
      const user = await this.prisma.user.update({
        where: { id: target.id },
        data: {
          ...(email !== undefined ? { email } : {}),
          ...(fullName !== undefined ? { fullName } : {}),
          ...(dto.username !== undefined
            ? {
                username:
                  normalizedUsername === ""
                    ? null
                    : (normalizedUsername ?? null),
              }
            : {}),
          ...(dto.mobile !== undefined || dto.mfa !== undefined
            ? { metadata }
            : {}),
          ...(role
            ? {
                roles: {
                  deleteMany: {},
                  create: [{ roleId: role.id }],
                },
              }
            : {}),
          ...(projects !== undefined
            ? {
                projects: {
                  deleteMany: {},
                  create: projects.map((project) => ({
                    projectId: project.id,
                  })),
                },
              }
            : {}),
        },
        select: {
          id: true,
          email: true,
          username: true,
          fullName: true,
          status: true,
          metadata: true,
          createdAt: true,
          roles: {
            select: {
              role: { select: { id: true, key: true, name: true } },
            },
          },
          projects: {
            select: {
              project: { select: { id: true, name: true } },
            },
          },
        },
      });
      const updatedMetadata = jsonObject(user.metadata);
      const mfa = updatedMetadata.mfa === "mobile" ? "mobile" : "email";
      return {
        success: true,
        message: "User updated successfully",
        data: {
          id: user.id,
          email: user.email,
          username: user.username,
          fullName: user.fullName,
          mobile:
            typeof updatedMetadata.mobile === "string"
              ? updatedMetadata.mobile
              : null,
          mfa,
          status: user.status,
          role: user.roles[0]?.role ?? null,
          projects: user.projects.map(({ project }) => project),
          createdAt: user.createdAt,
        },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new ConflictException("User already exists");
      }
      throw error;
    }
  }

  async list(
    expand?: string | string[],
    select?: string | string[],
  ): Promise<ListUsersResponse> {
    if (Array.isArray(expand) || Array.isArray(select)) {
      throw new BadRequestException("Query parameters must not be repeated");
    }
    if (expand !== undefined && expand !== "projects") {
      throw new BadRequestException(
        "If expand is provided, it must be projects",
      );
    }
    const selectedFields =
      select === undefined
        ? undefined
        : select
            .split(",")
            .map((field) => field.trim())
            .filter(Boolean);
    if (
      selectedFields !== undefined &&
      (selectedFields.length === 0 ||
        selectedFields.some((field) => !listUserFields.has(field)))
    ) {
      throw new BadRequestException(
        "Select contains an unsupported user field",
      );
    }

    const users = await this.prisma.user.findMany({
      where: {
        status: { not: "DISABLED" },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        legacyId: true,
        email: true,
        username: true,
        fullName: true,
        status: true,
        metadata: true,
        createdAt: true,
        updatedAt: true,
        organization: { select: { id: true, name: true } },
        sessions: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
        roles: {
          select: {
            role: {
              select: {
                id: true,
                legacyId: true,
                key: true,
              },
            },
          },
        },
        projects: {
          select: {
            project: {
              select: {
                id: true,
                legacyId: true,
                name: true,
              },
            },
          },
        },
      },
    });

    return {
      success: true,
      message: "success",
      data: users.map((user) => {
        const metadata = jsonObject(user.metadata);
        const role = user.roles[0]?.role;
        const item: Record<string, unknown> = {
          _id: user.legacyId ?? user.id,
          id: user.id,
          fullName: user.fullName,
          email: user.email,
          mobile: typeof metadata.mobile === "string" ? metadata.mobile : null,
          username: user.username,
          role: role?.key ?? null,
          roleId: role ? (role.legacyId ?? role.id) : null,
          projects:
            expand === "projects"
              ? user.projects.map(({ project }) => ({
                  _id: project.legacyId ?? project.id,
                  id: project.id,
                  Name: project.name,
                  name: project.name,
                }))
              : user.projects.map(
                  ({ project }) => project.legacyId ?? project.id,
                ),
          createAt: user.createdAt,
          updatedAt: user.updatedAt,
          isActive: user.status === "ACTIVE",
          mfa: metadata.mfa === "mobile" ? "mobile" : "email",
          status: user.status,
          organization: user.organization
            ? { id: user.organization.id, name: user.organization.name }
            : null,
          lastLogin: user.sessions[0]?.createdAt ?? null,
        };
        if (selectedFields === undefined) return item;
        const projected: Record<string, unknown> = { _id: item._id };
        for (const field of selectedFields) projected[field] = item[field];
        return projected;
      }),
    };
  }

  async delete(
    reference: string,
    principal?: Principal,
  ): Promise<DeleteUserResponse> {
    const target = await this.prisma.user.findFirst({
      where: isUuid(reference) ? { id: reference } : { legacyId: reference },
      select: {
        id: true,
        roles: { select: { role: { select: { key: true } } } },
      },
    });
    if (!target) throw new NotFoundException("User not found");
    if (target.id === principal?.sub) {
      throw new ForbiddenException("You cannot delete your own user");
    }
    if (target.roles.some(({ role }) => role.key === "super_admin")) {
      throw new ForbiddenException("The Super Admin user cannot be deleted");
    }

    await this.prisma.$transaction(async (transaction) => {
      await transaction.session.updateMany({
        where: { userId: target.id, revokedAt: null },
        data: { revokedAt: new Date() },
      });
      await transaction.user.update({
        where: { id: target.id },
        data: { status: "DISABLED" },
      });
    });
    return {
      success: true,
      message: "User deleted successfully",
    };
  }
}

@ApiTags("auth")
@Controller({ path: "user", version: VERSION_NEUTRAL })
export class ClientLoginController {
  constructor(
    @Inject(ClientLoginService)
    private readonly clientLogin: ClientLoginService,
  ) {}

  @Post("login")
  @HttpCode(200)
  @ApiQuery({ name: "skipLastLogin", required: false, type: Boolean })
  @ApiOkResponse({ description: "The client user was authenticated." })
  login(
    @BodyDto(ClientLoginDto) body: ClientLoginDto,
    @Query("skipLastLogin") skipLastLogin?: string | string[],
  ): Promise<ClientLoginResponse> {
    return this.clientLogin.login(body, skipLastLogin);
  }
}

@ApiTags("users")
@ApiBearerAuth()
@Controller({ path: "user", version: VERSION_NEUTRAL })
export class UsersController {
  constructor(@Inject(UsersService) private readonly users: UsersService) {}

  @Post("create")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  @ApiOkResponse({ description: "The user was created and invited." })
  create(
    @BodyDto(CreateUserDto) body: CreateUserDto,
  ): Promise<CreateUserResponse> {
    return this.users.create(body);
  }

  @Put("update/:userId")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard)
  @ApiParam({ name: "userId", type: String })
  @ApiOkResponse({ description: "The user was updated." })
  update(
    @Param("userId") userId: string,
    @BodyDto(UpdateUserDto) body: UpdateUserDto,
    @CurrentUser() principal: Principal,
  ): Promise<UpdateUserResponse> {
    return this.users.update(userId, body, principal);
  }

  @Get("list")
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  @ApiQuery({ name: "expand", required: false, enum: ["projects"] })
  @ApiQuery({ name: "select", required: false, type: String })
  @ApiOkResponse({ description: "The non-client users were returned." })
  list(
    @Query("expand") expand?: string | string[],
    @Query("select") select?: string | string[],
  ): Promise<ListUsersResponse> {
    return this.users.list(expand, select);
  }

  @Delete("delete/:userId")
  @HttpCode(200)
  @UseGuards(JwtAuthGuard, AdminRoleGuard)
  @ApiParam({ name: "userId", type: String })
  @ApiOkResponse({ description: "The user was disabled and signed out." })
  delete(
    @Param("userId") userId: string,
    @CurrentUser() principal: Principal,
  ): Promise<DeleteUserResponse> {
    return this.users.delete(userId, principal);
  }
}

@Module({
  imports: [AuthModule],
  providers: [
    UsersService,
    ClientLoginService,
    UserInvitationMailer,
    AdminRoleGuard,
  ],
  controllers: [UsersController, ClientLoginController],
  exports: [UserInvitationMailer],
})
export class UsersModule {}
