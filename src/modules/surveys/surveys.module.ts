import { Controller, Get, Inject, Module, Param, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../database/prisma.service.js";
import {
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";

@ApiTags("surveys")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("surveys")
class SurveysController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get(":id")
  get(@Param("id") id: string, @CurrentUser() principal: Principal) {
    return this.prisma.survey.findFirstOrThrow({
      where: {
        id,
        ...(principal.roles.includes("admin")
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
    const [survey, total, completed] = await Promise.all([
      this.prisma.survey.findFirstOrThrow({
        where: {
          id,
          ...(principal.roles.includes("admin")
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
