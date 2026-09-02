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
  Put,
  Query,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import { Prisma, type OrderStatus } from "@prisma/client";
import type { FastifyRequest } from "fastify";
import AWS from "aws-sdk";
import ExcelJS from "exceljs";
import { createHash, randomUUID } from "node:crypto";
import type { Env } from "../../config/env.js";
import { PrismaService } from "../../database/prisma.service.js";
import {
  AuthModule,
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import { CrmSyncModule, SyncQueue } from "../crm-sync/crm-sync.module.js";
import { parseBenefitsBestPracticesWorkbook } from "../reports/benefits-best-practices-workbook.js";

type JsonRecord = Record<string, unknown>;
const benefitsWorkbookMaxBytes = 25 * 1024 * 1024;

interface UploadedPart {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

interface MultipartPayload {
  fields: Record<string, string>;
  files: UploadedPart[];
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function jsonObject(value: unknown): JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function inputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

function objectBody(value: unknown): JsonRecord {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new BadRequestException("Request body must be an object");
  }
  return value as JsonRecord;
}

function requiredString(
  source: JsonRecord | Record<string, string>,
  key: string,
): string {
  const value = source[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${key} is required`);
  }
  return value.trim();
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function stringArray(value: unknown, key: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) {
    throw new BadRequestException(`${key} must be an array of strings`);
  }
  const normalized: string[] = [];
  for (const item of value) {
    if (typeof item !== "string") continue;
    const permission = item.trim();
    if (permission) normalized.push(permission);
  }
  return [...new Set(normalized)];
}

function positiveInt(value: unknown, fallback: number, maximum = 100): number {
  const parsed =
    typeof value === "string" || typeof value === "number"
      ? Number.parseInt(String(value), 10)
      : Number.NaN;
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(parsed, maximum)
    : fallback;
}

function referenceWhere(reference: string) {
  return isUuid(reference)
    ? { id: reference }
    : { OR: [{ legacyId: reference }, { externalId: reference }] };
}

function roleReferenceWhere(reference: string): Prisma.RoleWhereInput {
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

function roleKey(name: string): string {
  const key = name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-|-$/gu, "");
  if (!key) throw new BadRequestException("roleName is invalid");
  return key;
}

function cellText(value: ExcelJS.CellValue): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("text" in value && typeof value.text === "string") return value.text;
    if ("result" in value) return String(value.result ?? "");
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText
        .map((part) =>
          typeof part === "object" && "text" in part ? part.text : "",
        )
        .join("");
    }
  }
  return String(value);
}

function responseCaption(value: Prisma.JsonValue): string | null {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean")
    return String(value);
  const object = jsonObject(value);
  for (const key of ["ResponseCaption", "caption", "label", "value"]) {
    const candidate = object[key];
    if (
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      typeof candidate === "boolean"
    ) {
      return String(candidate);
    }
  }
  return null;
}

async function multipartPayload(
  request: FastifyRequest,
): Promise<MultipartPayload> {
  if (!request.isMultipart()) {
    throw new BadRequestException("multipart/form-data is required");
  }
  const fields: Record<string, string> = {};
  const files: UploadedPart[] = [];
  for await (const part of request.parts()) {
    if (part.type === "file") {
      files.push({
        filename: part.filename,
        mimetype: part.mimetype,
        buffer: await part.toBuffer(),
      });
    } else {
      fields[part.fieldname] = String(part.value ?? "");
    }
  }
  return { fields, files };
}

@Injectable()
class CompatibilityAssetStorage {
  private readonly s3 = new AWS.S3();

  constructor(
    @Inject(ConfigService) private readonly config: ConfigService<Env, true>,
  ) {}

  async put(bucket: string, key: string, file: UploadedPart): Promise<void> {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) return;
    await this.s3
      .upload({
        Bucket: bucket,
        Key: key,
        Body: file.buffer,
        ContentType: file.mimetype,
      })
      .promise();
  }

  async remove(bucket: string, key: string): Promise<void> {
    if (this.config.get("INTEGRATIONS_MOCK", { infer: true })) return;
    await this.s3.deleteObject({ Bucket: bucket, Key: key }).promise();
  }

  url(bucket: string, key: string): string {
    return `https://${bucket}.s3.amazonaws.com/${key
      .split("/")
      .map(encodeURIComponent)
      .join("/")}`;
  }
}

@Injectable()
export class CompatibilityAdminService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(CompatibilityAssetStorage)
    private readonly storage: CompatibilityAssetStorage,
    @Inject(SyncQueue) private readonly syncQueue: SyncQueue,
  ) {}

  async createRole(principal: Principal, rawBody: unknown) {
    this.assertAdmin(principal);
    const body = objectBody(rawBody);
    const name = requiredString(body, "roleName");
    const permissions = stringArray(body.permissions, "permissions");
    const permissionRecords = await this.validPermissions(permissions);
    const key = roleKey(name);
    const exists = await this.prisma.role.findUnique({ where: { key } });
    if (exists) throw new ConflictException("Already exist");
    await this.prisma.role.create({
      data: {
        key,
        name,
        permissions: {
          create: permissionRecords.map((permission) => ({
            permissionId: permission.id,
          })),
        },
      },
    });
    return {
      success: true,
      message: "Role created",
      roleData: await this.roleProjection(),
    };
  }

  async updateRole(principal: Principal, rawBody: unknown) {
    this.assertAdmin(principal);
    const body = objectBody(rawBody);
    const roleId = requiredString(body, "roleId");
    const name = requiredString(body, "roleName");
    const permissions = stringArray(body.permissions, "permissions");
    const permissionRecords = await this.validPermissions(permissions);
    const role = await this.prisma.role.findFirst({
      where: roleReferenceWhere(roleId),
    });
    if (!role) throw new NotFoundException("Role not found");
    if (role.key === "admin" || role.key === "super_admin") {
      throw new ForbiddenException("Administrator roles can not be changed");
    }
    await this.prisma.$transaction([
      this.prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      this.prisma.role.update({
        where: { id: role.id },
        data: {
          key: roleKey(name),
          name,
          permissions: {
            create: permissionRecords.map((permission) => ({
              permissionId: permission.id,
            })),
          },
        },
      }),
    ]);
    return {
      success: true,
      message: "Role updated",
      roleData: await this.roleProjection(),
    };
  }

  async manageRole(
    principal: Principal,
    rawBody: unknown,
    mode: "add" | "remove",
  ) {
    this.assertAdmin(principal);
    const body = objectBody(rawBody);
    const roleId = requiredString(body, "roleId");
    const permissions = stringArray(body.permissions, "permissions");
    const permissionRecords = await this.validPermissions(permissions);
    const role = await this.prisma.role.findFirst({
      where: roleReferenceWhere(roleId),
    });
    if (!role) throw new NotFoundException("Role not found");
    if (
      (role.key === "admin" || role.key === "super_admin") &&
      mode === "remove"
    ) {
      throw new ForbiddenException(
        "Administrator permissions can not be removed",
      );
    }
    if (mode === "add") {
      await Promise.all(
        permissionRecords.map((permission) =>
          this.prisma.rolePermission.upsert({
            where: {
              roleId_permissionId: {
                roleId: role.id,
                permissionId: permission.id,
              },
            },
            update: {},
            create: { roleId: role.id, permissionId: permission.id },
          }),
        ),
      );
    } else {
      await this.prisma.rolePermission.deleteMany({
        where: {
          roleId: role.id,
          permissionId: { in: permissionRecords.map(({ id }) => id) },
        },
      });
    }
    return { success: true, message: "Role Updated" };
  }

  async deleteRole(principal: Principal, rawBody: unknown) {
    this.assertAdmin(principal);
    const body = objectBody(rawBody);
    const roleId = requiredString(body, "roleId");
    const role = await this.prisma.role.findFirst({
      where: roleReferenceWhere(roleId),
      include: { _count: { select: { users: true } } },
    });
    if (!role) throw new NotFoundException("Role not found");
    if (role.key === "admin" || role.key === "super_admin") {
      throw new ForbiddenException("Administrator roles can not be deleted");
    }
    if (role._count.users > 0) {
      return {
        success: false,
        message: "Role is in use",
        data: { userCount: role._count.users },
      };
    }
    await this.prisma.role.delete({ where: { id: role.id } });
    return { success: true, message: "Role deleted" };
  }

  async uploadCustomReport(principal: Principal, request: FastifyRequest) {
    this.assertPermission(principal, "uploadDownloadCustomReportAccess");
    const { fields, files } = await multipartPayload(request);
    if (files.length === 0) {
      throw new BadRequestException("no file uploaded");
    }
    const organization = await this.organization(
      requiredString(fields, "organizationId"),
    );
    const program = await this.program(requiredString(fields, "programId"));
    const project = await this.project(requiredString(fields, "projectId"));
    const enrollment = await this.enrollment(
      requiredString(fields, "orgProgramId"),
      organization.id,
      program.id,
    );
    if (
      enrollment.projectId !== project.id ||
      program.projectId !== project.id
    ) {
      throw new BadRequestException(
        "organization, project and program do not match",
      );
    }
    const bucket = "custom-reports-wrg";
    const reportId = optionalString(fields.reportId);
    const existingAssets = reportId
      ? await this.prisma.asset.findMany({
          where: { organizationId: organization.id },
        })
      : [];
    const existingReport = existingAssets.find((asset) => {
      const metadata = jsonObject(asset.metadata);
      return (
        metadata.kind === "customReport" &&
        (asset.id === reportId ||
          asset.legacyId === reportId ||
          metadata.reportId === reportId)
      );
    });
    const reportReference =
      reportId ??
      existingReport?.legacyId ??
      existingReport?.id ??
      randomUUID();
    const assets = [];
    for (const file of files) {
      const key = `${enrollment.id}/${randomUUID()}/${file.filename.replace(
        /[/\\]/gu,
        "_",
      )}`;
      await this.storage.put(bucket, key, file);
      const fileUrl = this.storage.url(bucket, key);
      assets.push(
        await this.prisma.asset.create({
          data: {
            ...(reportId && !existingReport && assets.length === 0
              ? { legacyId: reportId }
              : {}),
            organizationId: organization.id,
            key,
            bucket,
            contentType: file.mimetype || "application/octet-stream",
            sizeBytes: BigInt(file.buffer.length),
            checksum: createHash("sha256").update(file.buffer).digest("hex"),
            metadata: inputJson({
              kind: "customReport",
              reportId: reportReference,
              programId: program.id,
              projectId: project.id,
              organizationProgramId: enrollment.id,
              orgProgramId: enrollment.legacyId ?? enrollment.id,
              organizationId: organization.id,
              ReportTitle: optionalString(fields.reportTitle) ?? "",
              ReportDescription: optionalString(fields.reportDescription) ?? "",
              reportTitle: optionalString(fields.reportTitle) ?? "",
              reportDescription: optionalString(fields.reportDescription) ?? "",
              reportFormats: [
                {
                  fileName: file.filename,
                  key,
                  fileType: file.mimetype,
                  fileUrl,
                },
              ],
              fileName: file.filename,
              fileUrl,
            }),
          },
        }),
      );
    }
    return { success: true, message: "success", data: assets };
  }

  async uploadKeyImpactAnalysis(
    principal: Principal,
    request: FastifyRequest,
    query: Record<string, unknown>,
  ) {
    this.assertPermission(principal, "uploadKeyImpactAnalysisAccess");
    const { fields, files } = await multipartPayload(request);
    const input = { ...query, ...fields };
    const file = files[0];
    if (!file) throw new BadRequestException("file is missing");
    const organization = await this.organization(
      requiredString(input, "orgId"),
    );
    const program = await this.program(requiredString(input, "programId"));
    const project = await this.project(requiredString(input, "projectId"));
    const enrollment = await this.enrollment(
      requiredString(input, "orgProgramId"),
      organization.id,
      program.id,
    );
    if (
      enrollment.projectId !== project.id ||
      program.projectId !== project.id
    ) {
      throw new BadRequestException(
        "organization, project and program do not match",
      );
    }
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(Buffer.from(file.buffer) as never);
    const worksheet = workbook.worksheets[0];
    if (!worksheet) throw new BadRequestException("workbook has no worksheet");
    const report: Array<{ label: string; key: string; value: string }> = [];
    worksheet.eachRow((row, index) => {
      if (index === 1) return;
      const label = cellText(row.getCell(2).value).trim();
      const key = cellText(row.getCell(3).value).trim();
      const value = cellText(row.getCell(4).value).trim();
      if (label || key || value) report.push({ label, key, value });
    });
    const bucket = "key-impact-analysis-wrg";
    const extension = file.filename.includes(".")
      ? file.filename.split(".").pop()
      : "xlsx";
    const key = `${enrollment.id}.${extension}`;
    await this.storage.put(bucket, key, file);
    const previous = await this.prisma.asset.findMany({
      where: { organizationId: organization.id },
    });
    const existing = previous.find((asset) => {
      const metadata = jsonObject(asset.metadata);
      return (
        metadata.kind === "keyImpactAnalysis" &&
        metadata.organizationProgramId === enrollment.id
      );
    });
    const data = {
      organizationId: organization.id,
      key,
      bucket,
      contentType: file.mimetype || "application/octet-stream",
      sizeBytes: BigInt(file.buffer.length),
      checksum: createHash("sha256").update(file.buffer).digest("hex"),
      metadata: inputJson({
        kind: "keyImpactAnalysis",
        programId: program.id,
        projectId: project.id,
        organizationProgramId: enrollment.id,
        orgProgramId: enrollment.legacyId ?? enrollment.id,
        organizationId: organization.id,
        fileName: file.filename,
        fileExtension: extension,
        signedUrl: this.storage.url(bucket, key),
        report,
      }),
    };
    if (existing && existing.key !== key) {
      await this.storage.remove(existing.bucket, existing.key);
    }
    await this.prisma.asset.upsert({
      where: { key },
      update: data,
      create: data,
    });
    if (existing && existing.key !== key) {
      await this.prisma.asset.delete({ where: { id: existing.id } });
    }
    await this.prisma.organizationProgram.update({
      where: { id: enrollment.id },
      data: {
        reportAccess: inputJson({
          ...jsonObject(enrollment.reportAccess),
          KIA_Access: "yes",
        }),
        metrics: inputJson({
          ...jsonObject(enrollment.metrics),
          KIA_Order_Status: "Delivered",
        }),
      },
    });
    return { success: true, message: "uploaded successfully" };
  }

  async uploadBenefitsBestPractices(
    principal: Principal,
    enrollmentReference: string,
    request: FastifyRequest,
  ) {
    this.assertAdmin(principal);
    const { files } = await multipartPayload(request);
    if (files.length !== 1) {
      throw new BadRequestException("exactly one workbook is required");
    }
    const file = files[0];
    if (!file || !/\.xlsx$/iu.test(file.filename)) {
      throw new BadRequestException("an .xlsx workbook is required");
    }
    if (file.buffer.length === 0) {
      throw new BadRequestException("the workbook is empty");
    }
    if (file.buffer.length > benefitsWorkbookMaxBytes) {
      throw new BadRequestException("the workbook must be 25 MB or smaller");
    }
    const enrollment = await this.prisma.organizationProgram.findFirst({
      where: referenceWhere(enrollmentReference),
      include: { organization: true, program: true },
    });
    if (!enrollment) {
      throw new NotFoundException("Organization program not found");
    }
    const sourceFile = file.filename.replace(/[/\\]/gu, "_").slice(-255);
    let parsed;
    try {
      parsed = await parseBenefitsBestPracticesWorkbook(
        file.buffer,
        sourceFile,
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error
          ? error.message
          : "the workbook could not be parsed",
      );
    }
    const metadata = jsonObject(enrollment.metadata);
    const publishedReports = jsonObject(metadata.publishedReports);
    const snapshot = {
      ...parsed,
      uploadedAt: new Date().toISOString(),
    };
    await this.prisma.organizationProgram.update({
      where: { id: enrollment.id },
      data: {
        metadata: inputJson({
          ...metadata,
          publishedReports: {
            ...publishedReports,
            benefitsBestPractices: snapshot,
          },
        }),
      },
    });
    return {
      success: true,
      message: "Benefits & Best Practices workbook uploaded",
      data: {
        organizationId:
          enrollment.organization.legacyId ?? enrollment.organization.id,
        programId: enrollment.program.legacyId ?? enrollment.program.id,
        organizationProgramId: enrollment.legacyId ?? enrollment.id,
        sourceFile: snapshot.sourceFile,
        headerCount: snapshot.headers.length,
        sectionCount: snapshot.sections.length,
        uploadedAt: snapshot.uploadedAt,
      },
    };
  }

  async deleteAsset(
    principal: Principal,
    reference: string,
    kind: "customReport" | "keyImpactAnalysis",
  ) {
    this.assertPermission(
      principal,
      kind === "customReport"
        ? "uploadDownloadCustomReportAccess"
        : "uploadKeyImpactAnalysisAccess",
    );
    const candidates = await this.prisma.asset.findMany();
    const asset = candidates.find((candidate) => {
      const metadata = jsonObject(candidate.metadata);
      return (
        metadata.kind === kind &&
        (candidate.id === reference ||
          candidate.legacyId === reference ||
          metadata.reportId === reference)
      );
    });
    if (!asset) {
      return { success: false, message: "No data found to delete" };
    }
    const reportId = jsonObject(asset.metadata).reportId;
    const assets =
      typeof reportId === "string"
        ? candidates.filter((candidate) => {
            const metadata = jsonObject(candidate.metadata);
            return metadata.kind === kind && metadata.reportId === reportId;
          })
        : [asset];
    await Promise.all(
      assets.map((candidate) =>
        this.storage.remove(candidate.bucket, candidate.key),
      ),
    );
    await this.prisma.asset.deleteMany({
      where: { id: { in: assets.map(({ id }) => id) } },
    });
    return { success: true, data: { deletedCount: assets.length } };
  }

  async organizations(
    principal: Principal,
    reference?: string,
    programReference?: string,
  ) {
    this.assertPermission(principal, "previewClientsDashboardAccess");
    let programId: string | undefined;
    if (programReference) {
      programId = (await this.program(programReference)).id;
    }
    const organizations = await this.prisma.organization.findMany({
      where: {
        ...(reference ? referenceWhere(reference) : {}),
        ...(programId ? { programs: { some: { programId } } } : {}),
      },
      orderBy: { createdAt: "desc" },
      include: {
        programs: {
          ...(programId ? { where: { programId } } : {}),
          include: { program: true, project: true },
        },
        users: {
          select: {
            id: true,
            legacyId: true,
            externalId: true,
            email: true,
            username: true,
            fullName: true,
            status: true,
            organizationProgramId: true,
            createdAt: true,
          },
        },
      },
    });
    if (organizations.length === 0) {
      throw new NotFoundException({
        success: false,
        message: "data not found",
        data: [],
      });
    }
    return {
      success: true,
      message: "success",
      data: organizations.flatMap((organization) => {
        const metadata = jsonObject(organization.metadata);
        const enrollmentGroups = new Map<
          string,
          typeof organization.programs
        >();
        for (const enrollment of organization.programs) {
          const metrics = jsonObject(enrollment.metrics);
          const sourceName = String(
            metrics.Source_Organization_Name ?? organization.name,
          ).trim();
          const key = sourceName
            .toLocaleLowerCase()
            .replace(/[^a-z0-9]+/gu, " ")
            .trim();
          const group = enrollmentGroups.get(key) ?? [];
          group.push(enrollment);
          enrollmentGroups.set(key, group);
        }
        const groups = enrollmentGroups.size
          ? [...enrollmentGroups.values()]
          : [[]];
        return groups.map((enrollments) => {
          const selectedEnrollment = enrollments[0];
          const selectedMetrics = selectedEnrollment
            ? jsonObject(selectedEnrollment.metrics)
            : {};
          return {
            ...metadata,
            _id: organization.legacyId ?? organization.id,
            id: organization.externalId ?? organization.id,
            selectionId: selectedEnrollment?.id ?? organization.id,
            sourceOrganizationId:
              selectedMetrics.Source_Organization_ID ??
              metadata.sourceOrganizationId ??
              null,
            sourceOrganizationName:
              selectedMetrics.Source_Organization_Name ??
              metadata.sourceOrganizationName ??
              null,
            Account_Name: organization.name,
            stripeCustomerId: organization.stripeCustomerId,
            createAt: organization.createdAt,
            orgPrograms: enrollments.map((enrollment) => ({
              orgs: {
                ...jsonObject(enrollment.metrics),
                ...jsonObject(enrollment.reportAccess),
                ...jsonObject(enrollment.paymentDetails),
                ...jsonObject(enrollment.metadata),
                Stage: enrollment.stage,
                isWinner: enrollment.isWinner,
                isIncluded: enrollment.isIncluded,
                employees_count: enrollment.employeesCount,
                overall_rank: enrollment.overallRank,
                category_rank: enrollment.categoryRank,
                Created_Time: enrollment.createdAt,
                Last_time_deal_synced: enrollment.updatedAt,
                _id: enrollment.legacyId ?? enrollment.id,
                id: enrollment.externalId ?? enrollment.id,
                databaseId: enrollment.id,
                DealId: enrollment.dealExternalId,
                organizationId:
                  organization.legacyId ??
                  organization.externalId ??
                  organization.id,
                projectId:
                  enrollment.project.legacyId ??
                  enrollment.project.externalId ??
                  enrollment.project.id,
                programId: [
                  {
                    ...jsonObject(enrollment.program.metadata),
                    _id:
                      enrollment.program.legacyId ??
                      enrollment.program.externalId ??
                      enrollment.program.id,
                    id: enrollment.program.externalId ?? enrollment.program.id,
                    Name: enrollment.program.name,
                    Program_Year: enrollment.program.year,
                    Currency: enrollment.program.currency,
                  },
                ],
                projectName: enrollment.project.name,
              },
            })),
            users: organization.users.map((user) => ({
              ...user,
              _id: user.legacyId ?? user.id,
              id: user.externalId ?? user.id,
            })),
          };
        });
      }),
    };
  }

  async orderLogs(
    principal: Principal,
    pageValue: unknown,
    perPageValue: unknown,
    sortByValue: unknown,
  ) {
    this.assertPermission(principal, "orderLogAccess");
    const page = positiveInt(pageValue, 1, 100_000);
    const perPage = positiveInt(perPageValue, 10, 100);
    const [sortField, directionValue] =
      optionalString(sortByValue)?.split(":") ?? [];
    const direction = directionValue === "asc" ? "asc" : "desc";
    const orderBy: Prisma.OrderOrderByWithRelationInput =
      sortField === "amount" || sortField === "amountMinor"
        ? { amountMinor: direction }
        : sortField === "status"
          ? { status: direction }
          : { createdAt: direction };
    const statuses: OrderStatus[] = [
      "PENDING",
      "PAID",
      "INVOICED",
      "REQUIRES_PAYMENT",
    ];
    const where: Prisma.OrderWhereInput = { status: { in: statuses } };
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy,
        skip: (page - 1) * perPage,
        take: perPage,
        include: {
          organization: true,
          organizationProgram: { include: { program: true } },
          program: true,
          project: true,
        },
      }),
      this.prisma.order.count({ where }),
    ]);
    return {
      success: true,
      data: orders.map((order) => {
        const program = order.program ?? order.organizationProgram?.program;
        const rawItems = Array.isArray(order.items)
          ? order.items
          : [order.items];
        const productName = rawItems
          .map((item) => optionalString(jsonObject(item).title))
          .filter((title): title is string => Boolean(title))
          .join(", ");
        return {
          ...order,
          _id: order.legacyId ?? order.id,
          amount: order.amountMinor,
          itemTitle: jsonObject(order.items).title ?? null,
          productName: productName || null,
          client: order.organization.name,
          organizationName: order.organization.name,
          programName: program?.name ?? null,
          keys: jsonObject(order.items).keys ?? order.items,
          isPaid: order.status === "PAID",
          paymentId: order.paymentIntentId,
          createAt: order.createdAt,
          organizationId: {
            ...jsonObject(order.organization.metadata),
            _id: order.organization.legacyId ?? order.organization.id,
            Account_Name: order.organization.name,
          },
          organizationprogramId: order.organizationProgram
            ? {
                ...jsonObject(order.organizationProgram.metrics),
                _id:
                  order.organizationProgram.legacyId ??
                  order.organizationProgram.id,
                DealId: order.organizationProgram.dealExternalId,
              }
            : null,
          programId: program
            ? {
                ...jsonObject(program.metadata),
                _id: program.legacyId ?? program.id,
                Name: program.name,
              }
            : null,
          projectId: order.project
            ? {
                ...jsonObject(order.project.metadata),
                _id: order.project.legacyId ?? order.project.id,
                Name: order.project.name,
              }
            : null,
        };
      }),
      pagination: {
        total_documents: total,
        per_page: perPage,
        page,
        previous: Math.max(0, page - 1),
        hasMore: page * perPage < total,
      },
    };
  }

  async systemLogs(
    principal: Principal,
    pageValue: unknown,
    limitValue: unknown,
  ) {
    this.assertAdmin(principal);
    const page = positiveInt(pageValue, 1, 100_000);
    const limit = positiveInt(limitValue, 10, 100);
    const [data, totalCount] = await this.prisma.$transaction([
      this.prisma.auditLog.findMany({
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          actor: {
            select: { id: true, legacyId: true, email: true, fullName: true },
          },
          organization: true,
        },
      }),
      this.prisma.auditLog.count(),
    ]);
    return {
      data,
      totalPages: Math.ceil(totalCount / limit),
      totalCount,
      currentPage: page,
      limit,
    };
  }

  async loginSessions(principal: Principal, query: Record<string, unknown>) {
    this.assertAdmin(principal);
    const page = positiveInt(query.page, 1, 100_000);
    const limit = 50;
    const dateStart =
      optionalString(query.startTime) ?? optionalString(query.date);
    const dateEnd = optionalString(query.endTime) ?? optionalString(query.date);
    let createdAt: Prisma.DateTimeFilter | undefined;
    if (dateStart || dateEnd) {
      const start = dateStart ? new Date(dateStart) : undefined;
      const end = dateEnd ? new Date(dateEnd) : undefined;
      if (
        (start && Number.isNaN(start.valueOf())) ||
        (end && Number.isNaN(end.valueOf()))
      ) {
        throw new BadRequestException("Invalid session date filter");
      }
      if (start) start.setHours(0, 0, 0, 0);
      if (end) end.setHours(23, 59, 59, 999);
      createdAt = {
        ...(start ? { gte: start } : {}),
        ...(end ? { lte: end } : {}),
      };
    }
    const organization = optionalString(query.organization);
    const username = optionalString(query.username);
    const email = optionalString(query.email);
    const userWhere: Prisma.UserWhereInput = {
      ...(username
        ? { username: { contains: username, mode: "insensitive" } }
        : {}),
      ...(email ? { email: { contains: email, mode: "insensitive" } } : {}),
      ...(organization
        ? { organization: { is: referenceWhere(organization) } }
        : {}),
    };
    const where: Prisma.SessionWhereInput = {
      ...(createdAt ? { createdAt } : {}),
      user: userWhere,
    };
    const [sessions, totalCount] = await this.prisma.$transaction([
      this.prisma.session.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * limit,
        take: limit,
        include: {
          user: {
            select: {
              id: true,
              legacyId: true,
              username: true,
              email: true,
              fullName: true,
              organization: true,
            },
          },
        },
      }),
      this.prisma.session.count({ where }),
    ]);
    return {
      success: true,
      data: sessions.map((session) => ({
        _id: session.legacyId ?? session.id,
        loginTime: session.createdAt,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
        username: session.user.username,
        email: session.user.email,
        organizationId: session.user.organization
          ? {
              _id:
                session.user.organization.legacyId ??
                session.user.organization.id,
              Account_Name: session.user.organization.name,
            }
          : null,
      })),
      totalPages: Math.ceil(totalCount / limit),
      currentPage: page,
      totalCount,
    };
  }

  async resortOrganization(principal: Principal, rawBody: unknown) {
    this.assertPermission(principal, "orderLogAccess");
    const body = objectBody(rawBody);
    const dealId = requiredString(body, "dealid");
    const enrollment = await this.prisma.organizationProgram.findFirst({
      where: {
        OR: [
          { dealExternalId: dealId },
          { externalId: dealId },
          { legacyId: dealId },
          ...(isUuid(dealId) ? [{ id: dealId }] : []),
        ],
      },
      include: { program: true },
    });
    if (!enrollment)
      throw new NotFoundException("Organization program not found");
    const metadata = jsonObject(enrollment.program.metadata);
    const surveyIds = [
      metadata.Employee_Survey_ID,
      metadata.Employer_Survey_ID,
      metadata.employeeSurveyId,
      metadata.employerSurveyId,
    ]
      .map((value) =>
        typeof value === "string" || typeof value === "number"
          ? String(value)
          : null,
      )
      .filter((value): value is string => Boolean(value));
    const jobs = await Promise.all(
      [...new Set(surveyIds)].map((surveyId) =>
        this.syncQueue.enqueue(
          {
            provider: "checkmarket",
            kind: "survey",
            externalId: surveyId,
          },
          `admin-resort:${enrollment.id}:${surveyId}:${randomUUID()}`,
        ),
      ),
    );
    return {
      success: true,
      message: `updated id ${enrollment.legacyId ?? enrollment.id}`,
      data: { jobs },
    };
  }

  async surveyInformation(
    principal: Principal,
    organizationReference?: string,
  ) {
    this.assertAdmin(principal);
    let organizationId: string | undefined;
    if (organizationReference) {
      organizationId = (await this.organization(organizationReference)).id;
    }
    const respondents = await this.prisma.respondent.findMany({
      where: organizationId ? { organizationId } : {},
      include: {
        responses: true,
        survey: true,
      },
    });
    const captions = [
      "Strongly Disagree",
      "Disagree",
      "Neutral",
      "Agree",
      "Strongly Agree",
      "N/A",
    ];
    const counts = new Map(captions.map((caption) => [caption, 0]));
    let totalInformationResponses = 0;
    for (const respondent of respondents) {
      for (const response of respondent.responses) {
        const caption = responseCaption(response.value);
        if (caption && counts.has(caption)) {
          counts.set(caption, (counts.get(caption) ?? 0) + 1);
          totalInformationResponses += 1;
        }
      }
    }
    const surveys = respondents.map(({ survey }) => survey);
    const dates = surveys
      .flatMap((survey) => [survey.startsAt, survey.endsAt])
      .filter((date): date is Date => Boolean(date));
    const colorCodes: Record<string, string> = {
      "Strongly Disagree": "#EF4444",
      Disagree: "#F97316",
      Neutral: "#FACC15",
      Agree: "#84CC16",
      "Strongly Agree": "#22C55E",
      "N/A": "#94A3B8",
    };
    return {
      success: true,
      information: captions.map((Caption) => ({
        Caption,
        RespondentCount: counts.get(Caption) ?? 0,
        colorCode: colorCodes[Caption],
      })),
      totalInformationResponses,
      totalRespondents: respondents.length,
      totalContacts: respondents.length,
      startDate:
        dates.length > 0
          ? new Date(Math.min(...dates.map((date) => date.valueOf())))
          : null,
      EndDate:
        dates.length > 0
          ? new Date(Math.max(...dates.map((date) => date.valueOf())))
          : null,
    };
  }

  private async validPermissions(keys: string[]) {
    const accepted = await this.prisma.permission.findMany({
      orderBy: { key: "asc" },
    });
    const acceptedKeys = new Set(accepted.map(({ key }) => key));
    if (keys.some((key) => !acceptedKeys.has(key))) {
      throw new BadRequestException({
        success: false,
        message: "permission not found",
        data: { accpeatedValues: [...acceptedKeys] },
      });
    }
    return accepted.filter(({ key }) => keys.includes(key));
  }

  private async roleProjection() {
    const roles = await this.prisma.role.findMany({
      orderBy: { key: "asc" },
      include: { _count: { select: { users: true } } },
    });
    return roles.map((role) => ({
      _id: role.legacyId ?? role.id,
      role: role.key,
      userCount: role._count.users,
    }));
  }

  private async organization(reference: string) {
    const value = await this.prisma.organization.findFirst({
      where: referenceWhere(reference),
    });
    if (!value) throw new NotFoundException("Organization not found");
    return value;
  }

  private async project(reference: string) {
    const value = await this.prisma.project.findFirst({
      where: referenceWhere(reference),
    });
    if (!value) throw new NotFoundException("Project not found");
    return value;
  }

  private async program(reference: string) {
    const value = await this.prisma.program.findFirst({
      where: referenceWhere(reference),
    });
    if (!value) throw new NotFoundException("Program not found");
    return value;
  }

  private async enrollment(
    reference: string,
    organizationId: string,
    programId: string,
  ) {
    const value = await this.prisma.organizationProgram.findFirst({
      where: {
        ...referenceWhere(reference),
        organizationId,
        programId,
      },
    });
    if (!value) throw new NotFoundException("Organization program not found");
    return value;
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

  private assertPermission(principal: Principal, permission: string): void {
    if (
      !principal.roles.includes("admin") &&
      !principal.roles.includes("super_admin") &&
      !principal.permissions.includes("ops.manage") &&
      !principal.permissions.includes(permission)
    ) {
      throw new ForbiddenException("Access denied");
    }
  }
}

@ApiTags("administration compatibility")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "admin", version: VERSION_NEUTRAL })
export class CompatibilityAdminController {
  constructor(
    @Inject(CompatibilityAdminService)
    private readonly admin: CompatibilityAdminService,
  ) {}

  @Post("addrole")
  @HttpCode(200)
  addRole(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.admin.createRole(principal, body);
  }

  @Put("updaterole")
  updateRole(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.admin.updateRole(principal, body);
  }

  @Post("managerole")
  @HttpCode(200)
  addPermissions(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.admin.manageRole(principal, body, "add");
  }

  @Put("managerole")
  removePermissions(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.admin.manageRole(principal, body, "remove");
  }

  @Delete("deleterole")
  deleteRole(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.admin.deleteRole(principal, body);
  }

  @Post("uploadCustomReport")
  @HttpCode(200)
  @ApiConsumes("multipart/form-data")
  uploadCustomReport(
    @CurrentUser() principal: Principal,
    @Req() request: FastifyRequest,
  ) {
    return this.admin.uploadCustomReport(principal, request);
  }

  @Post("uploadKeyImpactAnalysis")
  @HttpCode(200)
  @ApiConsumes("multipart/form-data")
  uploadKeyImpactAnalysis(
    @CurrentUser() principal: Principal,
    @Req() request: FastifyRequest,
    @Query() query: Record<string, unknown>,
  ) {
    return this.admin.uploadKeyImpactAnalysis(principal, request, query);
  }

  @Post("organization-programs/:organizationProgramId/benefits-best-practices")
  @HttpCode(200)
  @ApiConsumes("multipart/form-data")
  uploadBenefitsBestPractices(
    @CurrentUser() principal: Principal,
    @Param("organizationProgramId") organizationProgramId: string,
    @Req() request: FastifyRequest,
  ) {
    return this.admin.uploadBenefitsBestPractices(
      principal,
      organizationProgramId,
      request,
    );
  }

  @Delete("keyImpactAnalysis/:id")
  deleteKeyImpactAnalysis(
    @CurrentUser() principal: Principal,
    @Param("id") id: string,
  ) {
    return this.admin.deleteAsset(principal, id, "keyImpactAnalysis");
  }

  @Delete("customReport/:id")
  deleteCustomReport(
    @CurrentUser() principal: Principal,
    @Param("id") id: string,
  ) {
    return this.admin.deleteAsset(principal, id, "customReport");
  }

  @Get("getOrganizations")
  organizations(
    @CurrentUser() principal: Principal,
    @Query("programId") programId: string | undefined,
  ) {
    return this.admin.organizations(principal, undefined, programId);
  }

  @Get("getOrganizations/:id")
  organization(
    @CurrentUser() principal: Principal,
    @Param("id") id: string,
    @Query("programId") programId: string | undefined,
  ) {
    return this.admin.organizations(principal, id, programId);
  }

  @Get("order/log")
  orderLogs(
    @CurrentUser() principal: Principal,
    @Query("page") page: string | undefined,
    @Query("per_page") perPage: string | undefined,
    @Query("sortBy") sortBy: string | undefined,
  ) {
    return this.admin.orderLogs(principal, page, perPage, sortBy);
  }

  @Get("system/log")
  systemLogs(
    @CurrentUser() principal: Principal,
    @Query("page") page: string | undefined,
    @Query("limit") limit: string | undefined,
  ) {
    return this.admin.systemLogs(principal, page, limit);
  }

  @Get("loginSession/log")
  loginSessions(
    @CurrentUser() principal: Principal,
    @Query() query: Record<string, unknown>,
  ) {
    return this.admin.loginSessions(principal, query);
  }

  @Post("resortOrg")
  @HttpCode(200)
  resortOrganization(
    @CurrentUser() principal: Principal,
    @Body() body: unknown,
  ) {
    return this.admin.resortOrganization(principal, body);
  }
}

@ApiTags("dashboard compatibility")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "dashboard", version: VERSION_NEUTRAL })
export class CompatibilityDashboardController {
  constructor(
    @Inject(CompatibilityAdminService)
    private readonly admin: CompatibilityAdminService,
  ) {}

  @Get("surveyinformation")
  surveyInformation(
    @CurrentUser() principal: Principal,
    @Query("org") organization: string | undefined,
  ) {
    return this.admin.surveyInformation(principal, organization);
  }
}

@Module({
  imports: [AuthModule, CrmSyncModule],
  providers: [CompatibilityAdminService, CompatibilityAssetStorage],
  controllers: [CompatibilityAdminController, CompatibilityDashboardController],
})
export class CompatibilityAdminModule {}
