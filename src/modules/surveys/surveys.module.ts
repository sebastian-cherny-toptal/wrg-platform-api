import {
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Module,
  Param,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../database/prisma.service.js";
import {
  CurrentUser,
  impersonationAllowsProgram,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import { portalAccessMode } from "../reports/report-catalog.js";

@ApiTags("surveys")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("surveys")
class SurveysController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async assertLiveAccess(id: string, principal: Principal) {
    if (
      principal.roles.includes("admin") ||
      principal.roles.includes("super_admin")
    )
      return;
    const enrollment = await this.prisma.organizationProgram.findFirst({
      where: {
        organizationId: principal.organizationId ?? "__none__",
        program: { surveys: { some: { id } } },
      },
      select: { metadata: true, programId: true },
    });
    if (
      !enrollment ||
      !impersonationAllowsProgram(principal, enrollment.programId) ||
      portalAccessMode(enrollment.metadata, principal.roles) === "promotional"
    ) {
      throw new ForbiddenException(
        "Promotional sessions may only access sample reports",
      );
    }
  }

  @Get(":id")
  async get(@Param("id") id: string, @CurrentUser() principal: Principal) {
    await this.assertLiveAccess(id, principal);
    return this.prisma.survey.findFirstOrThrow({
      where: {
        id,
        ...(principal.roles.includes("admin") ||
        principal.roles.includes("super_admin")
          ? {}
          : {
              program: {
                organizations: {
                  some: {
                    organizationId: principal.organizationId ?? "__none__",
                  },
                },
              },
            }),
      },
      include: { questions: { orderBy: { position: "asc" } } },
    });
  }

  @Get(":id/summary")
  async summary(@Param("id") id: string, @CurrentUser() principal: Principal) {
    await this.assertLiveAccess(id, principal);
    const [survey, total, completed] = await Promise.all([
      this.prisma.survey.findFirstOrThrow({
        where: {
          id,
          ...(principal.roles.includes("admin") ||
          principal.roles.includes("super_admin")
            ? {}
            : {
                program: {
                  organizations: {
                    some: {
                      isIncluded: true,
                      organizationId: principal.organizationId ?? "__none__",
                    },
                  },
                },
              }),
        },
      }),
      this.prisma.respondent.count({ where: { surveyId: id } }),
      this.prisma.respondent.count({
        where: { surveyId: id, completedAt: { not: null } },
      }),
    ]);
    return {
      id,
      title: survey.title,
      total,
      completed,
      completionRate: total ? completed / total : 0,
    };
  }
}

@Module({ controllers: [SurveysController] })
export class SurveysModule {}
