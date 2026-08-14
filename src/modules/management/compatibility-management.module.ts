import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Query,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import {
  AuthModule,
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function scalarQuery(
  name: string,
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    throw new ForbiddenException(`${name} must not be repeated`);
  }
  const normalized = value?.trim();
  return normalized === "" ? undefined : normalized;
}

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function metadataString(
  value: Prisma.JsonValue,
  ...keys: string[]
): string | null {
  const metadata = jsonObject(value);
  for (const key of keys) {
    const candidate = metadata[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

@Injectable()
export class CompatibilityManagementService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async roles(principal: Principal) {
    this.assertAdmin(principal);
    const roles = await this.prisma.role.findMany({
      orderBy: { name: "asc" },
      include: { _count: { select: { users: true } } },
    });
    return {
      success: true,
      roleData: roles.map((role) => ({
        _id: role.legacyId ?? role.id,
        role: role.key,
        name: role.name,
        userCount: role._count.users,
      })),
    };
  }

  async permissions(principal: Principal, roleReference: string) {
    this.assertAdmin(principal);
    const role = await this.prisma.role.findFirst({
      where: this.roleReferenceWhere(roleReference),
      include: {
        permissions: {
          include: { permission: true },
          orderBy: { permission: { key: "asc" } },
        },
      },
    });
    if (!role) throw new NotFoundException("Role not found");
    return {
      success: true,
      roleData: {
        _id: role.legacyId ?? role.id,
        role: role.key,
        permissions: role.permissions.map(({ permission }) => permission.key),
      },
    };
  }

  async projects(
    principal: Principal,
    projectReference?: string,
    expand?: string,
  ) {
    if (expand && expand !== "programs") {
      throw new ForbiddenException(
        "if expand is provided, it should be programs",
      );
    }
    const allowedProjectIds = await this.allowedProjectIds(principal);
    const projects = await this.prisma.project.findMany({
      where: {
        ...(projectReference ? this.referenceWhere(projectReference) : {}),
        ...(allowedProjectIds ? { id: { in: allowedProjectIds } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        programs: {
          include: { _count: { select: { organizations: true } } },
        },
      },
    });
    return {
      success: true,
      message: "success",
      data: projects.map((project) => ({
        ...jsonObject(project.metadata),
        _id: project.legacyId ?? project.id,
        id: project.externalId ?? project.id,
        Name: project.name,
        createAt: project.createdAt,
        ...(expand === "programs"
          ? {
              Programs: project.programs.map((program) => ({
                ...this.programCompatibility(program),
                Number_of_Organizations: program._count.organizations,
              })),
            }
          : {}),
      })),
    };
  }

  async programs(
    principal: Principal,
    projectReference?: string,
    expand?: string,
  ) {
    if (expand && expand !== "orgs") {
      throw new ForbiddenException("if expand is provided, it should be orgs");
    }
    const allowedProjectIds = await this.allowedProjectIds(principal);
    let projectId: string | undefined;
    if (projectReference) {
      const project = await this.prisma.project.findFirst({
        where: {
          ...this.referenceWhere(projectReference),
          ...(allowedProjectIds ? { id: { in: allowedProjectIds } } : {}),
        },
        select: { id: true },
      });
      if (!project) throw new NotFoundException("Project not found");
      projectId = project.id;
    }
    const programs = await this.prisma.program.findMany({
      where: {
        ...(projectId ? { projectId } : {}),
        ...(allowedProjectIds ? { projectId: { in: allowedProjectIds } } : {}),
      },
      orderBy: [{ year: "desc" }, { createdAt: "desc" }],
      include: {
        project: true,
        organizations: {
          include: { organization: true },
        },
      },
    });
    return {
      success: true,
      message: "success",
      data: programs.map((program) => ({
        ...this.programCompatibility(program),
        Number_of_Organizations: program.organizations.length,
        Project: {
          _id: program.project.legacyId ?? program.project.id,
          Name: program.project.name,
        },
        ...(expand === "orgs"
          ? {
              orgs: program.organizations.map((enrollment) => ({
                ...jsonObject(enrollment.organization.metadata),
                _id:
                  enrollment.organization.legacyId ??
                  enrollment.organization.id,
                id:
                  enrollment.organization.externalId ??
                  enrollment.organization.id,
                Account_Name: enrollment.organization.name,
              })),
            }
          : {}),
      })),
    };
  }

  async program(principal: Principal, programReference: string) {
    const allowedProjectIds = await this.allowedProjectIds(principal);
    const program = await this.prisma.program.findFirst({
      where: {
        ...this.referenceWhere(programReference),
        ...(allowedProjectIds ? { projectId: { in: allowedProjectIds } } : {}),
      },
      include: {
        project: true,
        organizations: true,
        surveys: {
          include: {
            _count: { select: { respondents: true } },
          },
        },
      },
    });
    if (!program) throw new NotFoundException("program not found");
    let winnersCount = 0;
    let nonWinnersCount = 0;
    const categoryCounts: Record<string, number> = {};
    for (const enrollment of program.organizations) {
      const metrics = jsonObject(enrollment.metrics);
      const winner = metadataString(metrics, "Current_Year_Winner", "winner");
      const category = metadataString(
        metrics,
        "Current_Year_Category",
        "category",
      );
      if (winner === "Yes") winnersCount += 1;
      if (winner === "No") nonWinnersCount += 1;
      if (winner && category) {
        const key = `${category} ${
          winner === "Yes" ? "Winners" : "Non-Winners"
        }`;
        categoryCounts[key] = (categoryCounts[key] ?? 0) + 1;
      }
    }
    const employerSurveys = program.surveys.filter((survey) => {
      const kind = metadataString(
        survey.metadata,
        "kind",
        "type",
        "surveyType",
      );
      return (
        Boolean(kind?.toLowerCase().includes("employer")) ||
        survey.title.toLowerCase().includes("employer")
      );
    });
    const employerSurveyIds = new Set(
      employerSurveys.map((survey) => survey.id),
    );
    return {
      success: true,
      message: "success",
      data: {
        program: {
          ...this.programCompatibility(program),
          Project: {
            _id: program.project.legacyId ?? program.project.id,
            Name: program.project.name,
          },
        },
        employeeSurveyCount: program.surveys
          .filter((survey) => !employerSurveyIds.has(survey.id))
          .reduce((sum, survey) => sum + survey._count.respondents, 0),
        employerSurveyCount: employerSurveys.reduce(
          (sum, survey) => sum + survey._count.respondents,
          0,
        ),
        numberOfOrgs: program.organizations.length,
        categoriesInfo: {
          winnersCount,
          nonWinnersCount,
          categoryCounts,
        },
      },
    };
  }

  private async allowedProjectIds(
    principal: Principal,
  ): Promise<string[] | null> {
    if (
      principal.roles.includes("admin") ||
      principal.permissions.includes("ops.manage")
    ) {
      return null;
    }
    const links = await this.prisma.userProject.findMany({
      where: { userId: principal.sub },
      select: { projectId: true },
    });
    if (links.length === 0) {
      throw new ForbiddenException("Project access denied");
    }
    return links.map(({ projectId }) => projectId);
  }

  private assertAdmin(principal: Principal): void {
    if (
      !principal.roles.includes("admin") &&
      !principal.permissions.includes("ops.manage")
    ) {
      throw new ForbiddenException("Administrator access required");
    }
  }

  private referenceWhere(reference: string) {
    return isUuid(reference)
      ? { id: reference }
      : { OR: [{ legacyId: reference }, { externalId: reference }] };
  }

  private roleReferenceWhere(reference: string): Prisma.RoleWhereInput {
    return isUuid(reference)
      ? { id: reference }
      : {
          OR: [
            { legacyId: reference },
            { externalId: reference },
            { key: reference },
          ],
        };
  }

  private programCompatibility(program: {
    id: string;
    legacyId: string | null;
    externalId: string | null;
    name: string;
    year: number | null;
    currency: string;
    fees: Prisma.JsonValue;
    metadata: Prisma.JsonValue;
    startsAt: Date | null;
    endsAt: Date | null;
    createdAt: Date;
  }) {
    return {
      ...jsonObject(program.metadata),
      _id: program.legacyId ?? program.id,
      id: program.externalId ?? program.id,
      Name: program.name,
      Program_Year: program.year,
      Currency: program.currency,
      fees: program.fees,
      StartDate: program.startsAt,
      EndDate: program.endsAt,
      createAt: program.createdAt,
    };
  }
}

@ApiTags("management compatibility")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "admin", version: VERSION_NEUTRAL })
export class CompatibilityManagementController {
  constructor(
    @Inject(CompatibilityManagementService)
    private readonly management: CompatibilityManagementService,
  ) {}

  @Get("getroles")
  roles(@CurrentUser() principal: Principal) {
    return this.management.roles(principal);
  }

  @Get("getprojects")
  projects(
    @CurrentUser() principal: Principal,
    @Query("expand") expand: string | string[] | undefined,
  ) {
    return this.management.projects(
      principal,
      undefined,
      scalarQuery("expand", expand),
    );
  }

  @Get("getprojects/:id")
  project(
    @CurrentUser() principal: Principal,
    @Param("id") id: string,
    @Query("expand") expand: string | string[] | undefined,
  ) {
    return this.management.projects(
      principal,
      id,
      scalarQuery("expand", expand),
    );
  }

  @Get("getProgramsByProjectId")
  programs(
    @CurrentUser() principal: Principal,
    @Query("projectId") projectId: string | string[] | undefined,
    @Query("expand") expand: string | string[] | undefined,
  ) {
    return this.management.programs(
      principal,
      scalarQuery("projectId", projectId),
      scalarQuery("expand", expand),
    );
  }

  @Get("getProgramById/:programId")
  program(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
  ) {
    return this.management.program(principal, programId);
  }

  @Get("getpermissions/:roleId")
  permissions(
    @CurrentUser() principal: Principal,
    @Param("roleId") roleId: string,
  ) {
    return this.management.permissions(principal, roleId);
  }
}

@Module({
  imports: [AuthModule],
  providers: [CompatibilityManagementService],
  controllers: [CompatibilityManagementController],
})
export class CompatibilityManagementModule {}
