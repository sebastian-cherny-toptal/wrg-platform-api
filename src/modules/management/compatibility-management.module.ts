import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Param,
  Post,
  Query,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiBearerAuth, ApiTags } from "@nestjs/swagger";
import ExcelJS from "exceljs";
import type { FastifyReply } from "fastify";
import { Prisma } from "@prisma/client";
import { createHash } from "node:crypto";
import { PrismaService } from "../../database/prisma.service.js";
import {
  AuthModule,
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import {
  KEY_IMPACT_ID,
  RESPONSE_DETAIL_ID,
  SORTED_VERBATIMS_ID,
} from "../reports/report-catalog.js";
import { normalizeZohoCategory } from "../programs/program-zoho-category.js";
import {
  CompatibilityZohoModule,
  CompatibilityZohoService,
  type ProgramOrganization,
} from "../crm-sync/compatibility-zoho.module.js";

const organizationsConnectionHeaders = [
  "Alias Name",
  "Organization ID",
  "Stage",
  "Surveys Sent",
  "Report Category",
  "FDD Payment Type",
  "Sorted EV Payment Type",
  "EV Sorting Filter",
  "RD Payment Type",
  "KIA Payment Type",
  "CY Winner",
  "CY Category",
  "CY Category Rank",
  "CY Overall Rank",
] as const;

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

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.replaceAll(",", "").trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function reportCategory(metricsValue: Prisma.JsonValue): string {
  const metrics = jsonObject(metricsValue);
  const configured = metadataString(
    metricsValue,
    "Report_Category",
    "reportCategory",
  );
  if (configured) return configured;
  const size = numeric(
    metrics.Company_Size ??
      metrics.Program_EE_Count ??
      metrics.Total_Number_of_Program_EEs ??
      metrics.Surveys_Sent,
  );
  if (size === null) return "";
  if (size < 15) return "";
  if (size <= 24) return "15-24";
  if (size <= 99) return "25-99";
  if (size <= 199) return "100-199";
  if (size <= 499) return "200-499";
  if (size <= 999) return "500-999";
  return "1,000+";
}

export type ProgramZohoResyncField =
  | "organizationName"
  | "stage"
  | "isWinner"
  | "surveysSent"
  | "employeesCount"
  | "overallRank"
  | "categoryRank"
  | "reportCategory"
  | "currentZohoCategory";

export type ProgramZohoResyncValue = string | number | boolean | null;

export interface ProgramZohoResyncChange {
  field: ProgramZohoResyncField;
  previous: ProgramZohoResyncValue;
  next: ProgramZohoResyncValue;
}

export interface ProgramZohoResyncRow {
  organizationProgramId: string;
  organizationId: string;
  organizationName: string;
  changes: ProgramZohoResyncChange[];
}

export interface ProgramZohoResyncPreview {
  programId: string;
  revision: string;
  changedRows: ProgramZohoResyncRow[];
  unmatchedZoho: Array<{
    organizationId: string;
    organizationName: string | null;
  }>;
  missingLocal: Array<{
    organizationProgramId: string;
    organizationName: string;
  }>;
}

interface ResyncEnrollment {
  id: string;
  updatedAt: Date;
  stage: string | null;
  isWinner: boolean;
  employeesCount: number | null;
  overallRank: string | null;
  categoryRank: string | null;
  currentZohoCategory: string | null;
  metrics: Prisma.JsonValue;
  organization: { name: string };
}

interface ResyncMatch {
  enrollment: ResyncEnrollment;
  zoho: ProgramOrganization;
}

const resyncFields: ProgramZohoResyncField[] = [
  "organizationName",
  "stage",
  "isWinner",
  "surveysSent",
  "employeesCount",
  "overallRank",
  "categoryRank",
  "reportCategory",
  "currentZohoCategory",
];

function normalizedOrganizationIdentity(value: unknown): string {
  return typeof value === "string"
    ? value
        .toLocaleLowerCase("en")
        .replace(/[^a-z0-9]+/gu, " ")
        .trim()
    : "";
}

function resyncValues(
  enrollment: ResyncEnrollment,
  zoho?: ProgramOrganization,
): Record<ProgramZohoResyncField, ProgramZohoResyncValue> {
  const metrics = jsonObject(enrollment.metrics);
  if (zoho) {
    return {
      organizationName: zoho.organizationName,
      stage: zoho.stage,
      isWinner: zoho.isWinner,
      surveysSent: zoho.surveysSent,
      employeesCount: zoho.employeesCount,
      overallRank: zoho.overallRank,
      categoryRank: zoho.categoryRank,
      reportCategory: zoho.reportCategory,
      currentZohoCategory: zoho.currentZohoCategory,
    };
  }
  return {
    organizationName:
      metadataString(enrollment.metrics, "Source_Organization_Name") ??
      enrollment.organization.name,
    stage: enrollment.stage,
    isWinner: enrollment.isWinner,
    surveysSent: numeric(metrics.Surveys_Sent),
    employeesCount: enrollment.employeesCount,
    overallRank: enrollment.overallRank,
    categoryRank: enrollment.categoryRank,
    reportCategory:
      metadataString(enrollment.metrics, "Report_Category", "reportCategory") ??
      null,
    currentZohoCategory: enrollment.currentZohoCategory,
  };
}

@Injectable()
export class ProgramZohoResyncService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CompatibilityZohoService)
    private readonly zoho: CompatibilityZohoService,
  ) {}

  async preview(
    principal: Principal,
    programReference: string,
  ): Promise<ProgramZohoResyncPreview> {
    const { preview } = await this.buildPreview(principal, programReference);
    return preview;
  }

  async apply(
    principal: Principal,
    programReference: string,
    revision: string,
  ): Promise<ProgramZohoResyncPreview & { appliedCount: number }> {
    const normalizedRevision = revision.trim();
    if (!/^[a-f0-9]{64}$/u.test(normalizedRevision)) {
      throw new BadRequestException(
        "A valid Zoho preview revision is required",
      );
    }
    const { preview, matches } = await this.buildPreview(
      principal,
      programReference,
    );
    if (preview.revision !== normalizedRevision) {
      throw new ConflictException(
        "Zoho preview changed; refresh the preview before applying",
      );
    }
    const syncedAt = new Date();
    await this.prisma.$transaction(async (transaction) => {
      for (const { enrollment, zoho } of matches) {
        const metrics = jsonObject(enrollment.metrics);
        const result = await transaction.organizationProgram.updateMany({
          where: {
            id: enrollment.id,
            programId: preview.programId,
            updatedAt: enrollment.updatedAt,
          },
          data: {
            stage: zoho.stage,
            isWinner: zoho.isWinner,
            employeesCount: zoho.employeesCount,
            overallRank: zoho.overallRank,
            categoryRank: zoho.categoryRank,
            currentZohoCategory: zoho.currentZohoCategory,
            metrics: {
              ...metrics,
              Source_Organization_Name: zoho.organizationName,
              Surveys_Sent: zoho.surveysSent,
              Report_Category: zoho.reportCategory,
              Current_Year_Category: zoho.currentZohoCategory,
            } as Prisma.InputJsonValue,
            updatedAt: syncedAt,
          },
        });
        if (result.count !== 1) {
          throw new ConflictException(
            "Zoho preview changed; refresh the preview before applying",
          );
        }
      }
      await transaction.program.update({
        where: { id: preview.programId },
        data: { latestZohoSync: syncedAt },
      });
    });
    return {
      ...preview,
      appliedCount: preview.changedRows.length,
    };
  }

  private async buildPreview(
    principal: Principal,
    programReference: string,
  ): Promise<{ preview: ProgramZohoResyncPreview; matches: ResyncMatch[] }> {
    const allowedProjectIds = await this.allowedProjectIds(principal);
    const program = await this.prisma.program.findFirst({
      where: {
        ...this.referenceWhere(programReference),
        ...(allowedProjectIds ? { projectId: { in: allowedProjectIds } } : {}),
      },
      select: {
        id: true,
        legacyId: true,
        externalId: true,
        organizations: {
          select: {
            id: true,
            updatedAt: true,
            stage: true,
            isWinner: true,
            employeesCount: true,
            overallRank: true,
            categoryRank: true,
            currentZohoCategory: true,
            metrics: true,
            organization: { select: { name: true } },
          },
        },
      },
    });
    if (!program) throw new NotFoundException("Program not found");
    const zohoProgramId = program.externalId ?? program.legacyId;
    if (!zohoProgramId) {
      throw new ConflictException("Program is not connected to a Zoho program");
    }
    const zohoOrganizations = await this.zoho.listOrganizationsForProgram(
      principal,
      zohoProgramId,
    );
    const remaining = new Set(program.organizations.map(({ id }) => id));
    const matches: ResyncMatch[] = [];
    const unmatchedZoho: ProgramZohoResyncPreview["unmatchedZoho"] = [];
    for (const zohoOrganization of zohoOrganizations) {
      const sourceId = zohoOrganization.organizationId.trim();
      const normalizedName = normalizedOrganizationIdentity(
        zohoOrganization.organizationName,
      );
      const enrollment = program.organizations.find((candidate) => {
        if (!remaining.has(candidate.id)) return false;
        const candidateSourceId =
          metadataString(candidate.metrics, "Source_Organization_ID") ?? "";
        if (sourceId && candidateSourceId.trim() === sourceId) return true;
        const candidateName =
          metadataString(candidate.metrics, "Source_Organization_Name") ??
          candidate.organization.name;
        return Boolean(
          normalizedName &&
          normalizedOrganizationIdentity(candidateName) === normalizedName,
        );
      });
      if (!enrollment) {
        unmatchedZoho.push({
          organizationId: zohoOrganization.organizationId,
          organizationName: zohoOrganization.organizationName,
        });
        continue;
      }
      remaining.delete(enrollment.id);
      matches.push({ enrollment, zoho: zohoOrganization });
    }
    matches.sort((left, right) =>
      left.enrollment.id.localeCompare(right.enrollment.id),
    );
    unmatchedZoho.sort((left, right) =>
      left.organizationId.localeCompare(right.organizationId),
    );
    const changedRows = matches.flatMap(({ enrollment, zoho }) => {
      const previousValues = resyncValues(enrollment);
      const nextValues = resyncValues(enrollment, zoho);
      const changes = resyncFields.flatMap((field) =>
        previousValues[field] === nextValues[field]
          ? []
          : [
              {
                field,
                previous: previousValues[field],
                next: nextValues[field],
              },
            ],
      );
      return changes.length
        ? [
            {
              organizationProgramId: enrollment.id,
              organizationId: zoho.organizationId,
              organizationName:
                String(nextValues.organizationName ?? "").trim() ||
                String(previousValues.organizationName ?? "Organization"),
              changes,
            },
          ]
        : [];
    });
    const missingLocal = program.organizations
      .filter(({ id }) => remaining.has(id))
      .map((enrollment) => ({
        organizationProgramId: enrollment.id,
        organizationName: String(resyncValues(enrollment).organizationName),
      }))
      .sort((left, right) =>
        left.organizationProgramId.localeCompare(right.organizationProgramId),
      );
    const revisionSource = {
      programId: program.id,
      changedRows,
      unmatchedZoho,
      missingLocal,
      matchedVersions: matches.map(({ enrollment }) => ({
        id: enrollment.id,
        updatedAt: enrollment.updatedAt.toISOString(),
      })),
    };
    return {
      preview: {
        programId: program.id,
        revision: createHash("sha256")
          .update(JSON.stringify(revisionSource))
          .digest("hex"),
        changedRows,
        unmatchedZoho,
        missingLocal,
      },
      matches,
    };
  }

  private async allowedProjectIds(
    principal: Principal,
  ): Promise<string[] | null> {
    if (
      principal.roles.includes("admin") ||
      principal.roles.includes("super_admin") ||
      principal.permissions.includes("ops.manage")
    ) {
      return null;
    }
    if (
      !principal.permissions.includes("clientsProjectsProgramsAccess") &&
      !principal.permissions.includes("syncCheckmartketAndZohoAccess")
    ) {
      throw new ForbiddenException("Project access denied");
    }
    const links = await this.prisma.userProject.findMany({
      where: { userId: principal.sub },
      select: { projectId: true },
    });
    if (!links.length) throw new ForbiddenException("Project access denied");
    return links.map(({ projectId }) => projectId);
  }

  private referenceWhere(reference: string) {
    return isUuid(reference)
      ? { id: reference }
      : { OR: [{ legacyId: reference }, { externalId: reference }] };
  }
}

function orderItems(value: Prisma.JsonValue): Prisma.JsonObject[] {
  const entries = Array.isArray(value) ? value : [value];
  return entries.flatMap((entry) => {
    const item = jsonObject(entry);
    return Object.keys(item).length ? [item] : [];
  });
}

function itemProductId(item: Prisma.JsonObject): string {
  const keys = jsonObject(item.keys ?? {});
  return String(item.productId ?? keys.productId ?? "").trim();
}

function paidPaymentType(value: unknown): string {
  const normalized = String(value ?? "")
    .trim()
    .toLowerCase();
  if (normalized === "paid via check" || normalized === "check") {
    return "Paid via Check";
  }
  if (
    normalized === "paid via credit card" ||
    normalized === "credit card" ||
    normalized === "card"
  ) {
    return "Paid via Credit Card";
  }
  if (normalized === "paid via ach" || normalized === "ach") {
    return "Paid via ACH";
  }
  return "";
}

function productPaymentType(
  productId: string,
  orders: Array<{ items: Prisma.JsonValue; paymentMethod: string | null }>,
  paymentDetailsValue: Prisma.JsonValue,
  legacyField: string,
): string {
  const order = orders.find((candidate) =>
    orderItems(candidate.items).some(
      (item) => itemProductId(item) === productId,
    ),
  );
  return (
    paidPaymentType(order?.paymentMethod) ||
    paidPaymentType(jsonObject(paymentDetailsValue)[legacyField])
  );
}

function sortedEmployeeVerbatimsFilter(
  orders: Array<{ items: Prisma.JsonValue }>,
  metricsValue: Prisma.JsonValue,
): string {
  for (const order of orders) {
    const item = orderItems(order.items).find(
      (candidate) => itemProductId(candidate) === SORTED_VERBATIMS_ID,
    );
    if (!item) continue;
    const filter = String(
      jsonObject(item.keys ?? {}).EV_Sorting_Filter ?? "",
    ).trim();
    if (filter) return filter;
  }
  return String(jsonObject(metricsValue).SEV_Filter ?? "").trim();
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
          include: {
            zohoCategories: { orderBy: { sortOrder: "asc" } },
            _count: {
              select: { organizations: { where: { isIncluded: true } } },
            },
          },
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
        zohoCategories: { orderBy: { sortOrder: "asc" } },
        organizations: {
          where: { isIncluded: true },
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
        zohoCategories: { orderBy: { sortOrder: "asc" } },
        organizations: { where: { isIncluded: true } },
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
      const winner = enrollment.isWinner ? "Yes" : "No";
      const category = normalizeZohoCategory(
        enrollment.currentZohoCategory ??
          metadataString(enrollment.metrics, "Current_Year_Category") ??
          enrollment.benchmarkCategory ??
          metadataString(enrollment.metrics, "Benchmark_Category"),
      );
      if (enrollment.isWinner) winnersCount += 1;
      else nonWinnersCount += 1;
      if (category) {
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

  async organizationsConnectionWorkbook(
    principal: Principal,
    programReference: string,
  ): Promise<Buffer> {
    const allowedProjectIds = await this.allowedProjectIds(principal);
    const program = await this.prisma.program.findFirst({
      where: {
        ...this.referenceWhere(programReference),
        ...(allowedProjectIds ? { projectId: { in: allowedProjectIds } } : {}),
      },
      select: {
        name: true,
        metadata: true,
        organizations: {
          orderBy: { organization: { name: "asc" } },
          select: {
            stage: true,
            isWinner: true,
            isIncluded: true,
            currentZohoCategory: true,
            benchmarkCategory: true,
            categoryRank: true,
            overallRank: true,
            metrics: true,
            paymentDetails: true,
            organization: {
              select: {
                id: true,
                legacyId: true,
                externalId: true,
                name: true,
              },
            },
            orders: {
              where: { status: "PAID" },
              orderBy: { createdAt: "desc" },
              select: { items: true, paymentMethod: true },
            },
          },
        },
      },
    });
    if (!program) throw new NotFoundException("Program not found");

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Workforce Research Group";
    workbook.created = new Date();
    const worksheet = workbook.addWorksheet("Organizations");
    worksheet.addRow([...organizationsConnectionHeaders]);
    for (const enrollment of program.organizations) {
      const metrics = jsonObject(enrollment.metrics);
      const sortedPayment = productPaymentType(
        SORTED_VERBATIMS_ID,
        enrollment.orders,
        enrollment.paymentDetails,
        "Sorted_EV_Payment",
      );
      worksheet.addRow([
        enrollment.organization.name,
        String(
          metrics.Source_Organization_ID ??
            enrollment.organization.legacyId ??
            enrollment.organization.externalId ??
            enrollment.organization.id,
        ),
        enrollment.stage ?? "",
        numeric(metrics.Surveys_Sent) ?? "",
        reportCategory(enrollment.metrics),
        "Given by default",
        sortedPayment,
        sortedPayment
          ? sortedEmployeeVerbatimsFilter(enrollment.orders, enrollment.metrics)
          : "",
        productPaymentType(
          RESPONSE_DETAIL_ID,
          enrollment.orders,
          enrollment.paymentDetails,
          "RDR_Payment",
        ),
        productPaymentType(
          KEY_IMPACT_ID,
          enrollment.orders,
          enrollment.paymentDetails,
          "KIA_Payment",
        ),
        !enrollment.isIncluded
          ? "Non-selected"
          : enrollment.isWinner
            ? "Winner"
            : "Non-Winner",
        enrollment.currentZohoCategory ??
          metadataString(enrollment.metrics, "Current_Year_Category") ??
          enrollment.benchmarkCategory ??
          metadataString(enrollment.metrics, "Benchmark_Category") ??
          "",
        enrollment.categoryRank ?? "",
        enrollment.overallRank ?? "",
      ]);
    }
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    worksheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: 1, column: organizationsConnectionHeaders.length },
    };
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF27272A" },
    };
    worksheet.columns.forEach((column, index) => {
      column.width = Math.min(
        42,
        Math.max(16, (organizationsConnectionHeaders[index]?.length ?? 14) + 2),
      );
    });
    const bytes = await workbook.xlsx.writeBuffer();
    return Buffer.from(bytes);
  }

  async deleteProject(principal: Principal, projectReference: string) {
    this.assertAdmin(principal);
    const project = await this.prisma.project.findFirst({
      where: this.referenceWhere(projectReference),
      select: {
        id: true,
        name: true,
        _count: { select: { programs: true } },
      },
    });
    if (!project) throw new NotFoundException("Project not found");
    // A large cascade can take long enough for a second request to resolve the
    // project before the first delete commits. deleteMany makes that race
    // idempotent instead of turning the second successful outcome into P2025.
    await this.prisma.project.deleteMany({ where: { id: project.id } });
    return {
      success: true,
      message: "Project deleted successfully",
      data: {
        id: project.id,
        name: project.name,
        deletedPrograms: project._count.programs,
      },
    };
  }

  async deleteProgram(principal: Principal, programReference: string) {
    this.assertAdmin(principal);
    const program = await this.prisma.program.findFirst({
      where: this.referenceWhere(programReference),
      select: {
        id: true,
        name: true,
        _count: { select: { organizations: true } },
      },
    });
    if (!program) throw new NotFoundException("Program not found");
    await this.prisma.program.deleteMany({ where: { id: program.id } });
    return {
      success: true,
      message: "Program deleted successfully",
      data: {
        id: program.id,
        name: program.name,
        deletedOrganizationPrograms: program._count.organizations,
      },
    };
  }

  private async allowedProjectIds(
    principal: Principal,
  ): Promise<string[] | null> {
    if (
      principal.roles.includes("admin") ||
      principal.roles.includes("super_admin") ||
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
      !principal.roles.includes("super_admin") &&
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
    latestZohoSync: Date;
    createdAt: Date;
    zohoCategories?: Array<{
      tier: string;
      zohoCategoryName: string;
      employeeSize: string;
      priceCents: number;
    }>;
  }) {
    const metadata = jsonObject(program.metadata);
    const categoryPricing = program.zohoCategories?.length
      ? program.zohoCategories.map(
          ({ tier, zohoCategoryName, employeeSize, priceCents }) => ({
            tier,
            zohoCategoryName,
            employeeSize,
            priceCents,
          }),
        )
      : metadata.categoryPricing;
    return {
      ...metadata,
      ...(Array.isArray(categoryPricing) ? { categoryPricing } : {}),
      _id: program.legacyId ?? program.id,
      id: program.externalId ?? program.id,
      databaseId: program.id,
      Name: program.name,
      Program_Year: program.year,
      Currency: program.currency,
      fees: program.fees,
      StartDate: program.startsAt,
      EndDate: program.endsAt,
      latestZohoSync: program.latestZohoSync,
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
    @Inject(ProgramZohoResyncService)
    private readonly programZohoResync: ProgramZohoResyncService,
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

  @Get("programs/:programId/organizations-connection-fields.xlsx")
  async organizationsConnectionWorkbook(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workbook = await this.management.organizationsConnectionWorkbook(
      principal,
      programId,
    );
    reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .header(
        "content-disposition",
        'attachment; filename="Organizations_Connection_Fields.xlsx"',
      )
      .header("access-control-expose-headers", "*")
      .send(workbook);
  }

  @Post("programs/:programId/zoho-resync/preview")
  @HttpCode(200)
  zohoResyncPreview(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
  ) {
    return this.programZohoResync.preview(principal, programId);
  }

  @Post("programs/:programId/zoho-resync/apply")
  @HttpCode(200)
  zohoResyncApply(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
    @Body() body: { revision?: unknown },
  ) {
    if (typeof body.revision !== "string") {
      throw new BadRequestException(
        "A valid Zoho preview revision is required",
      );
    }
    return this.programZohoResync.apply(principal, programId, body.revision);
  }

  @Delete("projects/:id")
  deleteProject(@CurrentUser() principal: Principal, @Param("id") id: string) {
    return this.management.deleteProject(principal, id);
  }

  @Delete("programs/:programId")
  deleteProgram(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
  ) {
    return this.management.deleteProgram(principal, programId);
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
  imports: [AuthModule, CompatibilityZohoModule],
  providers: [CompatibilityManagementService, ProgramZohoResyncService],
  controllers: [CompatibilityManagementController],
})
export class CompatibilityManagementModule {}
