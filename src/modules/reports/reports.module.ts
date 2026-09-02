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
import {
  effectiveReportCatalog,
  hasStandardPackage,
  jsonObject,
  productIsOwned,
  STANDARD_PACKAGE_ID,
  standardPackagePriceCents,
} from "./report-catalog.js";

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
        isIncluded: true,
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
        program: {
          select: {
            id: true,
            metadata: true,
            fees: true,
            zohoCategories: {
              orderBy: { sortOrder: "asc" },
              select: {
                tier: true,
                zohoCategoryName: true,
                employeeSize: true,
                priceCents: true,
              },
            },
          },
        },
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
            select: {
              fees: true,
              metadata: true,
              metrics: true,
              currentZohoCategory: true,
              reportAccess: true,
              stage: true,
            },
          })
        : null;
      const overrideCatalog = jsonObject(enrollment?.metadata).reportCatalog;
      const catalog = effectiveReportCatalog(
        Array.isArray(overrideCatalog) ? overrideCatalog : metadata.reportCatalog,
      );
      const programFees = jsonObject(program.fees);
      const organizationFees = jsonObject(enrollment?.fees);
      const standardOwned = hasStandardPackage(
        enrollment?.reportAccess,
        enrollment?.stage,
      );
      const standardPrice = standardPackagePriceCents(
        {
          ...metadata,
          ...(program.zohoCategories.length
            ? { categoryPricing: program.zohoCategories }
            : {}),
        },
        {
          ...jsonObject(enrollment?.metrics),
          currentZohoCategory: enrollment?.currentZohoCategory,
        },
      );
      const availableProducts: Array<Record<string, unknown>> = [];
      for (const entry of catalog) {
        if (!entry.available) continue;
        const configured = organizationFees[entry.id] ?? programFees[entry.id];
        const priceCents = entry.id === STANDARD_PACKAGE_ID
          ? standardPrice
          : typeof configured === "number" && Number.isInteger(configured) && configured >= 0
            ? configured
            : entry.priceCents;
        const owned = productIsOwned(
          entry.id,
          enrollment?.reportAccess,
          enrollment?.stage,
        );
        availableProducts.push({
          ...entry,
          priceCents,
          priceAvailable: priceCents !== null && priceCents > 0,
          owned,
          standardPackageOwned: standardOwned,
          purchasable:
            entry.purchaseMode === "checkout" &&
            !owned &&
            (entry.id === STANDARD_PACKAGE_ID || standardOwned),
          deliveryMessage:
            entry.fulfillment === "manual"
              ? "Available in 7–10 business days"
              : "Instant access after successful credit card payment",
          ...(entry.id === "report-verbatims-sorted" &&
          typeof jsonObject(enrollment?.metrics).SEV_Filter === "string"
            ? { selection: jsonObject(enrollment?.metrics).SEV_Filter }
            : {}),
        });
      }
      return availableProducts;
    }));
    return products.flat();
  }
}

@Module({ controllers: [ReportsController, ReportCatalogController] })
export class ReportsModule {}
