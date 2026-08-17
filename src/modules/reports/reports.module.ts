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
import { jsonObject } from "./report-catalog.js";

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
      const enrollment = principal.organizationId
        ? await this.prisma.organizationProgram.findUnique({
            where: {
              organizationId_programId: {
                organizationId: principal.organizationId,
                programId: program.id,
              },
            },
            select: { fees: true, metadata: true },
          })
        : null;
      const overrideCatalog = jsonObject(enrollment?.metadata).reportCatalog;
      const catalog = Array.isArray(overrideCatalog) ? overrideCatalog : metadata.reportCatalog;
      if (!Array.isArray(catalog)) return [];
      const programFees = jsonObject(program.fees);
      const organizationFees = jsonObject(enrollment?.fees);
      const availableProducts: Array<Record<string, unknown>> = [];
      for (const entry of catalog) {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
        const product = entry as Record<string, unknown>;
        if (product.available === false) continue;
        const id = typeof product.id === "string" ? product.id : "";
        const configured = organizationFees[id] ?? programFees[id];
        availableProducts.push(typeof configured === "number" && Number.isInteger(configured) && configured >= 0
          ? { ...product, priceCents: configured }
          : product);
      }
      return availableProducts;
    }));
    return products.flat();
  }
}

@Module({ controllers: [ReportsController, ReportCatalogController] })
export class ReportsModule {}
