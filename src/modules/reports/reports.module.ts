import {
  Controller,
  Get,
  Inject,
  Module,
  Param,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiQuery, ApiTags } from "@nestjs/swagger";
import { PrismaService } from "../../database/prisma.service.js";
import { JwtAuthGuard } from "../auth/auth.module.js";
import { TenantGuard } from "../tenants/tenants.module.js";

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller("organizations/:organizationId/reports")
class ReportsController {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
  ) {}

  @Get("wfr")
  @ApiQuery({ name: "surveyId", required: true })
  async workforceReport(
    @Param("organizationId") organizationId: string,
    @Query("surveyId") surveyId: string,
  ): Promise<{
    surveyId: string;
    respondentCount: number;
    completionRate: number;
    questionScores: Array<{
      dataLabel: string;
      caption: string;
      responseCount: number;
      averageScore: number | null;
    }>;
  }> {
    await this.prisma.organizationProgram.findFirstOrThrow({
      where: {
        organizationId,
        program: { surveys: { some: { id: surveyId } } },
      },
      select: { id: true },
    });
    const [total, completed, questions] = await Promise.all([
      this.prisma.respondent.count({ where: { surveyId, organizationId } }),
      this.prisma.respondent.count({
        where: { surveyId, organizationId, completedAt: { not: null } },
      }),
      this.prisma.question.findMany({
        where: { surveyId },
        orderBy: { position: "asc" },
        include: {
          responses: {
            where: { respondent: { organizationId } },
            select: { score: true },
          },
        },
      }),
    ]);
    return {
      surveyId,
      respondentCount: total,
      completionRate: total === 0 ? 0 : completed / total,
      questionScores: questions.map((question) => {
        const scores = question.responses.flatMap(({ score }) =>
          score === null ? [] : [Number(score)],
        );
        return {
          dataLabel: question.dataLabel,
          caption: question.caption,
          responseCount: question.responses.length,
          averageScore:
            scores.length === 0
              ? null
              : scores.reduce((sum, score) => sum + score, 0) / scores.length,
        };
      }),
    };
  }
}

@Module({ controllers: [ReportsController] })
export class ReportsModule {}
