import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Inject,
  Module,
  Param,
  Put,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import {
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import {
  jsonObject,
  parseReportCatalog,
  reportProductTemplates,
} from "./report-catalog.js";
import { pricingCategoryNameByTier } from "../programs/program-zoho-category.js";

function assertAdmin(principal: Principal): void {
  if (
    !principal.roles.includes("admin") &&
    !principal.roles.includes("super_admin") &&
    !principal.permissions.includes("ops.manage")
  ) {
    throw new ForbiddenException("Administrator access required");
  }
}

function products(body: unknown) {
  const value = jsonObject(body);
  return parseReportCatalog(value.products);
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export function parseCategoryPriceUpdates(
  body: unknown,
  configuredTiers: string[],
): Array<{ tier: string; priceCents: number }> {
  const value = jsonObject(body);
  if (!Array.isArray(value.prices)) {
    throw new BadRequestException("prices must be an array");
  }
  const allowed = new Set(configuredTiers);
  const seen = new Set<string>();
  const updates = value.prices.map((entry, index) => {
    const price = jsonObject(entry);
    const tier = typeof price.tier === "string" ? price.tier.trim() : "";
    if (!allowed.has(tier)) {
      throw new BadRequestException(
        `Unsupported category tier: ${tier || index}`,
      );
    }
    if (seen.has(tier)) {
      throw new BadRequestException(`Duplicate category tier: ${tier}`);
    }
    if (
      typeof price.priceCents !== "number" ||
      !Number.isInteger(price.priceCents) ||
      price.priceCents < 0
    ) {
      throw new BadRequestException(`${tier} category price is required`);
    }
    seen.add(tier);
    return { tier, priceCents: price.priceCents };
  });
  if (updates.length !== configuredTiers.length) {
    throw new BadRequestException("Every category price is required");
  }
  return updates;
}

function legacyCategoryPriceFields(
  prices: Array<{ tier: string; priceCents: number }>,
): Record<string, number> {
  const fieldByTier: Record<string, string> = {
    Boutique: "Category_15_24_Fee",
    Small: "Category_25_99_Fee",
    Medium: "Category_100_199_Fee",
    Large: "Category_200_499_Fee",
    Mega: "Category_500_999_Fee",
    Major: "Category_1000_Fee",
  };
  return Object.fromEntries(
    prices.flatMap(({ tier, priceCents }) => {
      const field = fieldByTier[tier];
      return field ? [[field, priceCents / 100]] : [];
    }),
  );
}

function catalogFees(
  current: unknown,
  catalog: ReturnType<typeof parseReportCatalog>,
): Record<string, unknown> {
  const fees = { ...jsonObject(current) };
  for (const product of catalog) fees[product.id] = product.priceCents;
  return fees;
}

@ApiTags("administration report catalog")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "admin", version: VERSION_NEUTRAL })
export class ReportCatalogAdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("report-product-templates")
  templates(@CurrentUser() principal: Principal) {
    assertAdmin(principal);
    return { success: true, data: reportProductTemplates };
  }

  @Get("programs/:programId/report-catalog")
  async programCatalog(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
  ) {
    assertAdmin(principal);
    const program = await this.prisma.program.findUniqueOrThrow({
      where: { id: programId },
      select: { metadata: true },
    });
    const catalog = jsonObject(program.metadata).reportCatalog;
    return { success: true, data: Array.isArray(catalog) ? catalog : [] };
  }

  @Put("programs/:programId/report-catalog")
  async updateProgramCatalog(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
    @Body() body: unknown,
  ) {
    assertAdmin(principal);
    const catalog = products(body);
    const program = await this.prisma.program.findUniqueOrThrow({
      where: { id: programId },
      select: { metadata: true, fees: true },
    });
    await this.prisma.program.update({
      where: { id: programId },
      data: {
        metadata: inputJson({
          ...jsonObject(program.metadata),
          reportCatalog: catalog,
        }),
        fees: inputJson(catalogFees(program.fees, catalog)),
      },
    });
    return { success: true, message: "Program catalog saved", data: catalog };
  }

  @Put("programs/:programId/category-prices")
  async updateProgramCategoryPrices(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
    @Body() body: unknown,
  ) {
    assertAdmin(principal);
    const program = await this.prisma.program.findUniqueOrThrow({
      where: { id: programId },
      select: {
        metadata: true,
        zohoCategories: { orderBy: { sortOrder: "asc" } },
      },
    });
    if (!program.zohoCategories.length) {
      throw new BadRequestException(
        "This program has no configured categories",
      );
    }
    const updates = parseCategoryPriceUpdates(
      body,
      program.zohoCategories.map(({ tier }) => tier),
    );
    const priceByTier = new Map(
      updates.map(({ tier, priceCents }) => [tier, priceCents]),
    );
    const categoryPricing = program.zohoCategories.map((category) => ({
      tier: category.tier,
      pricingCategoryName:
        pricingCategoryNameByTier[
          category.tier as keyof typeof pricingCategoryNameByTier
        ],
      priceCents: priceByTier.get(category.tier) ?? category.priceCents,
    }));
    await this.prisma.$transaction([
      ...updates.map(({ tier, priceCents }) =>
        this.prisma.programZohoCategory.update({
          where: { programId_tier: { programId, tier } },
          data: { priceCents },
        }),
      ),
      this.prisma.program.update({
        where: { id: programId },
        data: {
          metadata: inputJson({
            ...jsonObject(program.metadata),
            ...legacyCategoryPriceFields(updates),
            categoryPricing,
          }),
        },
      }),
    ]);
    return {
      success: true,
      message: "Program category prices saved",
      data: categoryPricing,
    };
  }

  @Get("organization-programs/:organizationProgramId/report-catalog")
  async organizationCatalog(
    @CurrentUser() principal: Principal,
    @Param("organizationProgramId") id: string,
  ) {
    assertAdmin(principal);
    const enrollment = await this.prisma.organizationProgram.findUniqueOrThrow({
      where: { id },
      select: {
        metadata: true,
        fees: true,
        program: { select: { metadata: true } },
      },
    });
    const override = jsonObject(enrollment.metadata).reportCatalog;
    const inherited = jsonObject(enrollment.program.metadata).reportCatalog;
    return {
      success: true,
      data: {
        inherited: !Array.isArray(override),
        products: Array.isArray(override)
          ? override
          : Array.isArray(inherited)
            ? inherited
            : [],
      },
    };
  }

  @Put("organization-programs/:organizationProgramId/report-catalog")
  async updateOrganizationCatalog(
    @CurrentUser() principal: Principal,
    @Param("organizationProgramId") id: string,
    @Body() body: unknown,
  ) {
    assertAdmin(principal);
    const value = jsonObject(body);
    const enrollment = await this.prisma.organizationProgram.findUniqueOrThrow({
      where: { id },
      select: {
        metadata: true,
        fees: true,
        program: { select: { metadata: true } },
      },
    });
    const metadata = jsonObject(enrollment.metadata);
    let fees = { ...jsonObject(enrollment.fees) };
    if (value.inherit === true) {
      delete metadata.reportCatalog;
      const productIds = new Set(
        reportProductTemplates.map(({ id: productId }) => productId),
      );
      fees = Object.fromEntries(
        Object.entries(fees).filter(([key]) => !productIds.has(key)),
      );
    } else {
      const catalog = products(body);
      metadata.reportCatalog = catalog;
      Object.assign(fees, catalogFees(fees, catalog));
    }
    await this.prisma.organizationProgram.update({
      where: { id },
      data: { metadata: inputJson(metadata), fees: inputJson(fees) },
    });
    const effective =
      metadata.reportCatalog ??
      jsonObject(enrollment.program.metadata).reportCatalog ??
      [];
    return {
      success: true,
      message: "Organization catalog saved",
      data: { inherited: value.inherit === true, products: effective },
    };
  }
}

@Module({ controllers: [ReportCatalogAdminController] })
export class ReportCatalogAdminModule {}
