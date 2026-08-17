import { Body, Controller, ForbiddenException, Get, Inject, Module, Param, Put, UseGuards, VERSION_NEUTRAL } from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import { CurrentUser, JwtAuthGuard, type Principal } from "../auth/auth.module.js";
import { jsonObject, parseReportCatalog, reportProductTemplates } from "./report-catalog.js";

function assertAdmin(principal: Principal): void {
  if (!principal.roles.includes("admin") && !principal.roles.includes("super_admin") && !principal.permissions.includes("ops.manage")) {
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

function catalogFees(current: unknown, catalog: ReturnType<typeof parseReportCatalog>): Record<string, unknown> {
  const fees = { ...jsonObject(current) };
  for (const product of catalog) fees[product.id] = product.priceCents;
  return fees;
}

@ApiTags("administration report catalog")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "admin", version: VERSION_NEUTRAL })
class ReportCatalogAdminController {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  @Get("report-product-templates")
  templates(@CurrentUser() principal: Principal) {
    assertAdmin(principal);
    return { success: true, data: reportProductTemplates };
  }

  @Get("programs/:programId/report-catalog")
  async programCatalog(@CurrentUser() principal: Principal, @Param("programId") programId: string) {
    assertAdmin(principal);
    const program = await this.prisma.program.findUniqueOrThrow({ where: { id: programId }, select: { metadata: true } });
    const catalog = jsonObject(program.metadata).reportCatalog;
    return { success: true, data: Array.isArray(catalog) ? catalog : [] };
  }

  @Put("programs/:programId/report-catalog")
  async updateProgramCatalog(@CurrentUser() principal: Principal, @Param("programId") programId: string, @Body() body: unknown) {
    assertAdmin(principal);
    const catalog = products(body);
    const program = await this.prisma.program.findUniqueOrThrow({ where: { id: programId }, select: { metadata: true, fees: true } });
    await this.prisma.program.update({ where: { id: programId }, data: {
      metadata: inputJson({ ...jsonObject(program.metadata), reportCatalog: catalog }),
      fees: inputJson(catalogFees(program.fees, catalog)),
    } });
    return { success: true, message: "Program catalog saved", data: catalog };
  }

  @Get("organization-programs/:organizationProgramId/report-catalog")
  async organizationCatalog(@CurrentUser() principal: Principal, @Param("organizationProgramId") id: string) {
    assertAdmin(principal);
    const enrollment = await this.prisma.organizationProgram.findUniqueOrThrow({ where: { id }, select: { metadata: true, fees: true, program: { select: { metadata: true } } } });
    const override = jsonObject(enrollment.metadata).reportCatalog;
    const inherited = jsonObject(enrollment.program.metadata).reportCatalog;
    return { success: true, data: { inherited: !Array.isArray(override), products: Array.isArray(override) ? override : Array.isArray(inherited) ? inherited : [] } };
  }

  @Put("organization-programs/:organizationProgramId/report-catalog")
  async updateOrganizationCatalog(@CurrentUser() principal: Principal, @Param("organizationProgramId") id: string, @Body() body: unknown) {
    assertAdmin(principal);
    const value = jsonObject(body);
    const enrollment = await this.prisma.organizationProgram.findUniqueOrThrow({ where: { id }, select: { metadata: true, fees: true, program: { select: { metadata: true } } } });
    const metadata = jsonObject(enrollment.metadata);
    let fees = { ...jsonObject(enrollment.fees) };
    if (value.inherit === true) {
      delete metadata.reportCatalog;
      const productIds = new Set(reportProductTemplates.map(({ id: productId }) => productId));
      fees = Object.fromEntries(Object.entries(fees).filter(([key]) => !productIds.has(key)));
    } else {
      const catalog = products(body);
      metadata.reportCatalog = catalog;
      Object.assign(fees, catalogFees(fees, catalog));
    }
    await this.prisma.organizationProgram.update({ where: { id }, data: { metadata: inputJson(metadata), fees: inputJson(fees) } });
    const effective = metadata.reportCatalog ?? jsonObject(enrollment.program.metadata).reportCatalog ?? [];
    return { success: true, message: "Organization catalog saved", data: { inherited: value.inherit === true, products: effective } };
  }
}

@Module({ controllers: [ReportCatalogAdminController] })
export class ReportCatalogAdminModule {}
