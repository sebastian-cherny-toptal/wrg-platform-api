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
import {
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import { TenantGuard } from "../tenants/tenants.module.js";

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, TenantGuard)
@Controller("organizations/:organizationId/reports")
class ReportsController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

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

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller("reports")
class ReportCatalogController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("catalog")
  async catalog(
    @CurrentUser() principal: Principal,
    @Query("programId") programId?: string,
  ) {
    const programs = await this.prisma.userProgram.findMany({
      where: { userId: principal.sub, ...(programId ? { programId } : {}) },
      orderBy: { program: { year: "desc" } },
      select: {
        program: { select: { id: true, metadata: true, fees: true } },
      },
    });
    const products = await Promise.all(programs.map(async ({ program }) => {
      const metadata = program.metadata;
      if (
        !metadata ||
        typeof metadata !== "object" ||
        Array.isArray(metadata)
      ) {
        return [];
      }
      const catalog = metadata.reportCatalog;
      if (!Array.isArray(catalog)) return [];
      const enrollment = principal.organizationId
        ? await this.prisma.organizationProgram.findUnique({
            where: {
              organizationId_programId: {
                organizationId: principal.organizationId,
                programId: program.id,
              },
            },
            select: { fees: true },
          })
        : null;
      const programFees = jsonRecord(program.fees);
      const organizationFees = jsonRecord(enrollment?.fees);
      return catalog.map((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
        const product = entry as Record<string, unknown>;
        const id = typeof product.id === "string" ? product.id : "";
        const configured = organizationFees[id] ?? programFees[id];
        return typeof configured === "number" && Number.isInteger(configured) && configured >= 0
          ? { ...product, priceCents: configured }
          : product;
      });
    }));
    return products.flat();
  }
}

function jsonRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

@Module({ controllers: [ReportsController, ReportCatalogController] })
export class ReportsModule {}
