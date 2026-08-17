import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import type { PrismaClient } from "@prisma/client";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { basename, extname, join } from "node:path";
import { PrismaService } from "../../database/prisma.service.js";
import type { Principal } from "../auth/auth.module.js";
import {
  forEachXlsxSurveyRow,
  readXlsxSurveyDefinition,
  type XlsxQuestionDefinition,
  type XlsxSurveyRow,
} from "./xlsx-survey-importer.js";

const MAX_FILE_BYTES = 25 * 1024 * 1024;
const MAX_LISTED_VALIDATION_ISSUES = 100;
const MAX_PERSISTED_VALIDATION_ISSUES = 200;
const XLSX_SIGNATURE = Buffer.from([0x50, 0x4b, 0x03, 0x04]);
const responseBatchSize = 2_000;

function stagingRoot(): string {
  return join(process.cwd(), "var", "historical-imports");
}
const standardOpenQuestionCaptions: Record<string, string> = {
  q_OpenEnded_1:
    "What are the top two or three reasons people like working for this organization?",
  q_OpenEnded_2:
    "What two or three things can this organization add or change to improve employee engagement and success?",
};

export type HistoricalSurveyKind = "EA" | "EFS";

export interface HistoricalImportMetadata {
  projectName: string;
  programName: string;
  programYear: number;
  projectAbbreviation?: string;
  employeeSurveyId?: string;
  employerSurveyId?: string;
}

interface StoredWorkbook {
  fileName: string;
  filePath: string;
  kind: HistoricalSurveyKind;
  sha256: string;
  sizeBytes: number;
}

interface OrganizationSummary {
  key: string;
  displayName: string;
  workbookOrganizationId?: string;
  eaRespondents: number;
  efsRespondents: number;
  warnings: string[];
}

interface HistoricalImportDraft extends HistoricalImportMetadata {
  importId: string;
  stagingDir: string;
  createdByUserId?: string;
  eaFile?: StoredWorkbook;
  efsFile?: StoredWorkbook;
  status: "draft" | "validated" | "committing" | "succeeded" | "failed";
  projectId?: string;
  commitIdempotencyKey?: string;
}

export interface HistoricalImportValidationIssue {
  level: "error" | "warning";
  message: string;
}

export interface HistoricalImportWorkbookSummary {
  kind: HistoricalSurveyKind;
  fileName: string;
  sha256: string;
  questions: number;
  organizations: number;
  respondents: number;
  responses: number;
}

export interface HistoricalImportValidationSummary {
  issues: HistoricalImportValidationIssue[];
  workbooks: HistoricalImportWorkbookSummary[];
  organizations: OrganizationSummary[];
  blockingErrorCount: number;
  warningCount: number;
}

export interface HistoricalImportStatus {
  importId: string;
  status: HistoricalImportDraft["status"];
  metadata: HistoricalImportMetadata;
  validation?: HistoricalImportValidationSummary;
  projectId?: string;
  projectName?: string;
  programId?: string;
  error?: string;
}

interface UploadedWorkbookFile {
  filename: string;
  buffer: Buffer;
}

function objectBody(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function requiredString(body: Record<string, unknown>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new BadRequestException(`${key} is required`);
  }
  return value.trim();
}

function optionalString(
  body: Record<string, unknown>,
  key: string,
): string | undefined {
  const value = body[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function digest(value: string, length = 16): string {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha256").update(value).digest().subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function importPrefixFor(importId: string): string {
  return `historical-import:${importId}`;
}

function stagingDirectory(importId: string): string {
  return join(stagingRoot(), importId);
}

function ensureStagingDirectory(importId: string): string {
  const directory = stagingDirectory(importId);
  mkdirSync(directory, { recursive: true });
  return directory;
}

function assertStoredWorkbooksReady(
  draft: HistoricalImportDraft,
): asserts draft is HistoricalImportDraft & {
  eaFile: StoredWorkbook;
  efsFile: StoredWorkbook;
} {
  if (!draft.eaFile || !draft.efsFile) {
    throw new BadRequestException(
      "Upload both EA and EFS workbooks before continuing",
    );
  }
  for (const workbook of [draft.eaFile, draft.efsFile]) {
    if (!existsSync(workbook.filePath)) {
      throw new BadRequestException(
        `Workbook "${workbook.fileName}" is no longer available. Upload both files again before committing.`,
      );
    }
  }
}

function isWorkbookValidationError(error: Error): boolean {
  return (
    /ENOENT.*\.xlsx|workbook|xlsx|worksheet|column|respondent|organization|Score %/iu.test(
      error.message,
    ) || error.message.includes(": required")
  );
}

function toHttpException(error: unknown): Error {
  if (
    error instanceof BadRequestException ||
    error instanceof ConflictException ||
    error instanceof ForbiddenException ||
    error instanceof NotFoundException
  ) {
    return error;
  }
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return new InternalServerErrorException(
      `Historical import failed while writing ${error.meta?.modelName ?? "data"} (${error.code}).`,
      { cause: error },
    );
  }
  if (error instanceof Error) {
    if (isWorkbookValidationError(error)) {
      return new BadRequestException(error.message);
    }
    return new InternalServerErrorException(error.message, { cause: error });
  }
  return new InternalServerErrorException("Historical import failed");
}

function appendValidationIssue(
  issues: HistoricalImportValidationIssue[],
  counters: {
    listed: number;
    suppressed: number;
    errors: number;
    warnings: number;
  },
  issue: HistoricalImportValidationIssue,
): void {
  if (issue.level === "error") counters.errors += 1;
  else counters.warnings += 1;
  if (counters.listed < MAX_LISTED_VALIDATION_ISSUES) {
    issues.push(issue);
    counters.listed += 1;
    return;
  }
  counters.suppressed += 1;
}

function finalizeValidationIssues(
  issues: HistoricalImportValidationIssue[],
  counters: {
    listed: number;
    suppressed: number;
    errors: number;
    warnings: number;
  },
): HistoricalImportValidationIssue[] {
  if (counters.suppressed === 0) return issues;
  return [
    ...issues,
    {
      level: "warning",
      message: `${counters.suppressed} additional validation messages were omitted from this preview`,
    },
  ];
}

function trimValidationSummary(
  summary: HistoricalImportValidationSummary,
): HistoricalImportValidationSummary {
  if (summary.issues.length <= MAX_PERSISTED_VALIDATION_ISSUES) return summary;
  const omitted = summary.issues.length - MAX_PERSISTED_VALIDATION_ISSUES;
  return {
    ...summary,
    issues: [
      ...summary.issues.slice(0, MAX_PERSISTED_VALIDATION_ISSUES),
      {
        level: "warning",
        message: `${omitted} additional validation messages were omitted from the saved preview`,
      },
    ],
    warningCount: summary.warningCount + 1,
  };
}

function slugify(value: string): string {
  const slug = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return slug || "historical-project";
}

function normalizeOrganizationName(value: string | undefined): string {
  return (value ?? "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function organizationKey(row: XlsxSurveyRow): string {
  const normalizedName = normalizeOrganizationName(row.organizationName);
  if (normalizedName) return `name:${normalizedName}`;
  const sourceId = row.organizationId?.trim();
  if (sourceId) return `id:${sourceId}`;
  return `row:${row.rowNumber}`;
}

function validateMetadata(body: unknown): HistoricalImportMetadata {
  const value = objectBody(body);
  const projectName = requiredString(value, "projectName");
  const programName = requiredString(value, "programName");
  const yearValue = value.programYear;
  const programYear = Number(yearValue);
  const currentYear = new Date().getFullYear();
  if (
    !Number.isInteger(programYear) ||
    programYear < 1900 ||
    programYear > currentYear
  ) {
    throw new BadRequestException(
      `programYear must be an integer between 1900 and ${currentYear}`,
    );
  }
  if (projectName.length < 2 || projectName.length > 120) {
    throw new BadRequestException("projectName must be 2 to 120 characters");
  }
  if (programName.length < 2 || programName.length > 160) {
    throw new BadRequestException("programName must be 2 to 160 characters");
  }
  const employeeSurveyId = optionalString(value, "employeeSurveyId");
  const employerSurveyId = optionalString(value, "employerSurveyId");
  if (
    employeeSurveyId &&
    employerSurveyId &&
    employeeSurveyId === employerSurveyId
  ) {
    throw new BadRequestException(
      "employeeSurveyId and employerSurveyId must be different when both are supplied",
    );
  }
  const projectAbbreviation = optionalString(value, "projectAbbreviation");
  return {
    projectName,
    programName,
    programYear,
    ...(projectAbbreviation ? { projectAbbreviation } : {}),
    ...(employeeSurveyId ? { employeeSurveyId } : {}),
    ...(employerSurveyId ? { employerSurveyId } : {}),
  };
}

function assertXlsxFile(file: UploadedWorkbookFile): void {
  if (extname(file.filename).toLowerCase() !== ".xlsx") {
    throw new BadRequestException(`${file.filename} must be an .xlsx workbook`);
  }
  if (file.buffer.length === 0) {
    throw new BadRequestException(`${file.filename} is empty`);
  }
  if (file.buffer.length > MAX_FILE_BYTES) {
    throw new BadRequestException(
      `${file.filename} exceeds the ${MAX_FILE_BYTES / (1024 * 1024)} MiB limit`,
    );
  }
  if (!file.buffer.subarray(0, 4).equals(XLSX_SIGNATURE)) {
    throw new BadRequestException(`${file.filename} is not a valid XLSX file`);
  }
}

function draftFromInput(input: unknown): HistoricalImportDraft {
  const value = objectBody(input);
  const importId = requiredString(value, "importId");
  const stagingDir = requiredString(value, "stagingDir");
  const metadata = validateMetadata(value);
  const statusValue = value.status;
  const status =
    statusValue === "validated" ||
    statusValue === "committing" ||
    statusValue === "succeeded" ||
    statusValue === "failed"
      ? statusValue
      : "draft";
  return {
    ...metadata,
    importId,
    stagingDir,
    ...(typeof value.createdByUserId === "string"
      ? { createdByUserId: value.createdByUserId }
      : {}),
    status,
    ...(typeof value.projectId === "string"
      ? { projectId: value.projectId }
      : {}),
    ...(typeof value.commitIdempotencyKey === "string"
      ? { commitIdempotencyKey: value.commitIdempotencyKey }
      : {}),
    ...(value.eaFile ? { eaFile: value.eaFile as StoredWorkbook } : {}),
    ...(value.efsFile ? { efsFile: value.efsFile as StoredWorkbook } : {}),
  };
}

function likertQuestionResponses() {
  return [
    { Id: 1, Caption: "Strongly Disagree" },
    { Id: 2, Caption: "Disagree" },
    { Id: 3, Caption: "Neutral" },
    { Id: 4, Caption: "Agree" },
    { Id: 5, Caption: "Strongly Agree" },
    { Id: 6, Caption: "N/A" },
  ];
}

function questionTypeId(type: string): number {
  if (type === "likert") return 5;
  if (type === "demographic") return 2;
  if (type === "open-text" || type === "text") return 9;
  return 1;
}

function questionReportRole(type: string): string {
  if (type === "likert") return "core";
  if (type === "demographic") return "demographic";
  if (type === "open-text") return "verbatim";
  return "other";
}

interface HistoricalQuestionTemplate {
  dataLabel: string;
  caption: string;
  type: string;
  metadata: Prisma.JsonValue;
}

function jsonMetadata(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

export function mergeHistoricalQuestionTemplate(
  question: XlsxQuestionDefinition,
  template?: HistoricalQuestionTemplate,
): XlsxQuestionDefinition {
  return {
    ...question,
    caption:
      standardOpenQuestionCaptions[question.dataLabel] ??
      template?.caption ??
      question.caption,
    type: template?.type ?? question.type,
  };
}

export function missingQuestionTemplateLabels(
  questions: XlsxQuestionDefinition[],
  templateLabels: ReadonlySet<string>,
): string[] {
  return questions
    .filter(
      ({ dataLabel, type }) =>
        type === "likert" && !templateLabels.has(dataLabel),
    )
    .map(({ dataLabel }) => dataLabel);
}

export function historicalQuestionMetadata(
  question: XlsxQuestionDefinition,
  templateMetadata: Prisma.JsonValue | undefined,
  importId: string,
): Prisma.InputJsonObject {
  const template = jsonMetadata(templateMetadata);
  return {
    ...template,
    QuestionTypeId: template.QuestionTypeId ?? questionTypeId(question.type),
    reportRole: template.reportRole ?? questionReportRole(question.type),
    ...(question.type === "likert" && !template.QuestionResponses
      ? { QuestionResponses: likertQuestionResponses() }
      : {}),
    ...(question.filterLabel ? { filterLabel: question.filterLabel } : {}),
    sourceColumn: question.column,
    historicalImportId: importId,
  };
}

async function insertBatches<T>(
  values: T[],
  insert: (batch: T[]) => Promise<unknown>,
  batchSize = responseBatchSize,
): Promise<void> {
  for (let index = 0; index < values.length; index += batchSize) {
    await insert(values.slice(index, index + batchSize));
  }
}

@Injectable()
export class HistoricalImportService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private assertAccess(principal: Principal): void {
    if (
      !principal.roles.includes("admin") &&
      !principal.roles.includes("super_admin") &&
      !principal.permissions.includes("ops.manage") &&
      !principal.permissions.includes("clientsProjectsProgramsAccess")
    ) {
      throw new ForbiddenException("Access denied");
    }
  }

  private normalizeDraft(draft: HistoricalImportDraft): HistoricalImportDraft {
    const stagingDir = ensureStagingDirectory(draft.importId);
    const normalizeWorkbook = (
      workbook: StoredWorkbook | undefined,
    ): StoredWorkbook | undefined => {
      if (!workbook) return undefined;
      const storedName = basename(workbook.filePath);
      const expectedPrefix = `${workbook.kind.toLowerCase()}-`;
      const normalizedName = storedName.startsWith(expectedPrefix)
        ? storedName
        : `${workbook.kind.toLowerCase()}-${workbook.fileName}`;
      return {
        ...workbook,
        filePath: join(stagingDir, normalizedName),
      };
    };
    const eaFile = normalizeWorkbook(draft.eaFile);
    const efsFile = normalizeWorkbook(draft.efsFile);
    return {
      ...draft,
      stagingDir,
      ...(eaFile ? { eaFile } : {}),
      ...(efsFile ? { efsFile } : {}),
    };
  }

  private async loadDraft(importId: string): Promise<HistoricalImportDraft> {
    const record = await this.prisma.syncJob.findFirst({
      where: {
        provider: "historical-import",
        externalId: importId,
      },
    });
    if (!record) throw new NotFoundException("Historical import not found");
    return this.normalizeDraft(draftFromInput(record.input));
  }

  private async saveDraft(
    draft: HistoricalImportDraft,
    extra: {
      status?: HistoricalImportDraft["status"];
      output?: Prisma.InputJsonValue;
      error?: string | null;
    } = {},
  ): Promise<void> {
    await this.prisma.syncJob.updateMany({
      where: { idempotencyKey: `historical-import:${draft.importId}` },
      data: {
        status:
          extra.status === "succeeded"
            ? "SUCCEEDED"
            : extra.status === "failed"
              ? "FAILED"
              : extra.status === "committing"
                ? "RUNNING"
                : "PENDING",
        input: draft as unknown as Prisma.InputJsonValue,
        ...(extra.output !== undefined ? { output: extra.output } : {}),
        ...(extra.error !== undefined ? { error: extra.error } : {}),
      },
    });
  }

  private storeWorkbook(
    draft: HistoricalImportDraft,
    kind: HistoricalSurveyKind,
    file: UploadedWorkbookFile,
  ): StoredWorkbook {
    assertXlsxFile(file);
    const stagingDir = ensureStagingDirectory(draft.importId);
    const fileName = basename(file.filename);
    const filePath = join(stagingDir, `${kind.toLowerCase()}-${fileName}`);
    writeFileSync(filePath, file.buffer);
    return {
      kind,
      fileName,
      filePath,
      sha256: createHash("sha256").update(file.buffer).digest("hex"),
      sizeBytes: file.buffer.length,
    };
  }

  private async analyzeWorkbook(
    draft: HistoricalImportDraft,
    workbook: StoredWorkbook,
  ): Promise<{
    summary: HistoricalImportWorkbookSummary;
    organizations: Map<
      string,
      {
        displayName: string;
        workbookOrganizationId?: string;
        respondents: number;
      }
    >;
    issues: HistoricalImportValidationIssue[];
    errorCount: number;
    warningCount: number;
  }> {
    const importPrefix = `historical-import:${draft.importId}`;
    const surveyId = deterministicUuid(
      `${importPrefix}:survey:${workbook.kind}`,
    );
    const definition = await readXlsxSurveyDefinition({
      fileName: workbook.fileName,
      filePath: workbook.filePath,
      questionId: (dataLabel) =>
        deterministicUuid(`${surveyId}:question:${dataLabel}`),
    });
    const issues: HistoricalImportValidationIssue[] = [];
    const issueCounters = { listed: 0, suppressed: 0, errors: 0, warnings: 0 };
    if (definition.questions.length === 0) {
      appendValidationIssue(issues, issueCounters, {
        level: "error",
        message: `${workbook.fileName} does not contain any question columns`,
      });
    }
    const organizations = new Map<
      string,
      {
        displayName: string;
        workbookOrganizationId?: string;
        respondents: number;
      }
    >();
    const seenRespondents = new Set<string>();
    let respondents = 0;
    let responses = 0;
    await forEachXlsxSurveyRow(definition, {}, (row) => {
      const displayName = row.organizationName?.trim();
      if (!displayName) {
        appendValidationIssue(issues, issueCounters, {
          level: "error",
          message: `${workbook.fileName} row ${row.rowNumber} is missing an organization name`,
        });
        return;
      }
      const respondentKey = String(row.respondent ?? row.rowNumber);
      if (seenRespondents.has(respondentKey)) {
        appendValidationIssue(issues, issueCounters, {
          level: "error",
          message: `${workbook.fileName} has duplicate respondent "${respondentKey}"`,
        });
        return;
      }
      seenRespondents.add(respondentKey);
      respondents += 1;
      responses += row.responses.length;
      const key = organizationKey(row);
      const existing = organizations.get(key);
      if (!existing) {
        organizations.set(key, {
          displayName,
          respondents: 1,
          ...(row.organizationId
            ? { workbookOrganizationId: row.organizationId }
            : {}),
        });
        return;
      }
      existing.respondents += 1;
      if (
        row.organizationId &&
        existing.workbookOrganizationId &&
        existing.workbookOrganizationId !== row.organizationId
      ) {
        appendValidationIssue(issues, issueCounters, {
          level: "error",
          message: `${workbook.fileName} organization "${displayName}" uses conflicting workbook IDs`,
        });
      } else if (row.organizationId && !existing.workbookOrganizationId) {
        existing.workbookOrganizationId = row.organizationId;
      }
    });
    if (respondents === 0) {
      appendValidationIssue(issues, issueCounters, {
        level: "error",
        message: `${workbook.fileName} does not contain any importable respondent rows`,
      });
    }
    const finalizedIssues = finalizeValidationIssues(issues, issueCounters);
    return {
      summary: {
        kind: workbook.kind,
        fileName: workbook.fileName,
        sha256: workbook.sha256,
        questions: definition.questions.length,
        organizations: organizations.size,
        respondents,
        responses,
      },
      organizations,
      issues: finalizedIssues,
      errorCount: issueCounters.errors,
      warningCount:
        issueCounters.warnings + (issueCounters.suppressed > 0 ? 1 : 0),
    };
  }

  private buildOrganizationSummary(
    eaOrganizations: Map<
      string,
      {
        displayName: string;
        workbookOrganizationId?: string;
        respondents: number;
      }
    >,
    efsOrganizations: Map<
      string,
      {
        displayName: string;
        workbookOrganizationId?: string;
        respondents: number;
      }
    >,
  ): OrganizationSummary[] {
    const keys = new Set([
      ...eaOrganizations.keys(),
      ...efsOrganizations.keys(),
    ]);
    return [...keys]
      .map((key) => {
        const ea = eaOrganizations.get(key);
        const efs = efsOrganizations.get(key);
        const warnings: string[] = [];
        if (ea && !efs) warnings.push("Present in EA only");
        if (efs && !ea) warnings.push("Present in EFS only");
        if (
          ea?.workbookOrganizationId &&
          efs?.workbookOrganizationId &&
          ea.workbookOrganizationId !== efs.workbookOrganizationId
        ) {
          warnings.push("Workbook organization ID differs between EA and EFS");
        }
        const workbookOrganizationId =
          ea?.workbookOrganizationId ?? efs?.workbookOrganizationId;
        return {
          key,
          displayName: ea?.displayName ?? efs?.displayName ?? key,
          eaRespondents: ea?.respondents ?? 0,
          efsRespondents: efs?.respondents ?? 0,
          warnings,
          ...(workbookOrganizationId ? { workbookOrganizationId } : {}),
        };
      })
      .sort((left, right) => left.displayName.localeCompare(right.displayName));
  }

  async createDraft(
    principal: Principal,
    body: unknown,
  ): Promise<{ importId: string; metadata: HistoricalImportMetadata }> {
    this.assertAccess(principal);
    const metadata = validateMetadata(body);
    const importId = randomUUID();
    const stagingDir = ensureStagingDirectory(importId);
    const draft: HistoricalImportDraft = {
      ...metadata,
      importId,
      stagingDir,
      createdByUserId: principal.sub,
      status: "draft",
    };
    await this.prisma.syncJob.create({
      data: {
        provider: "historical-import",
        kind: "draft",
        externalId: importId,
        idempotencyKey: `historical-import:${importId}`,
        input: draft as unknown as Prisma.InputJsonValue,
      },
    });
    return { importId, metadata };
  }

  async updateMetadata(
    principal: Principal,
    importId: string,
    body: unknown,
  ): Promise<{ importId: string; metadata: HistoricalImportMetadata }> {
    this.assertAccess(principal);
    const draft = await this.loadDraft(importId);
    if (draft.status === "committing" || draft.status === "succeeded") {
      throw new ConflictException(
        "This historical import can no longer be edited",
      );
    }
    const metadata = validateMetadata({ ...draft, ...objectBody(body) });
    const nextDraft = { ...draft, ...metadata, status: "draft" as const };
    await this.saveDraft(nextDraft);
    return { importId, metadata };
  }

  async uploadWorkbooks(
    principal: Principal,
    importId: string,
    eaFile: UploadedWorkbookFile,
    efsFile: UploadedWorkbookFile,
  ): Promise<{ importId: string; eaFileName: string; efsFileName: string }> {
    this.assertAccess(principal);
    const draft = await this.loadDraft(importId);
    if (draft.status === "committing" || draft.status === "succeeded") {
      throw new ConflictException(
        "This historical import can no longer be edited",
      );
    }
    if (eaFile.buffer.equals(efsFile.buffer)) {
      throw new BadRequestException(
        "EA and EFS workbooks must be different files",
      );
    }
    const stagingDir = ensureStagingDirectory(importId);
    const nextDraft: HistoricalImportDraft = {
      ...draft,
      stagingDir,
      eaFile: this.storeWorkbook({ ...draft, stagingDir }, "EA", eaFile),
      efsFile: this.storeWorkbook({ ...draft, stagingDir }, "EFS", efsFile),
      status: "draft",
    };
    await this.saveDraft(nextDraft);
    const storedEa = nextDraft.eaFile;
    const storedEfs = nextDraft.efsFile;
    if (!storedEa || !storedEfs) {
      throw new BadRequestException("Uploaded workbooks could not be stored");
    }
    return {
      importId,
      eaFileName: storedEa.fileName,
      efsFileName: storedEfs.fileName,
    };
  }

  async validate(
    principal: Principal,
    importId: string,
  ): Promise<HistoricalImportValidationSummary> {
    this.assertAccess(principal);
    const draft = await this.loadDraft(importId);
    assertStoredWorkbooksReady(draft);
    try {
      const eaAnalysis = await this.analyzeWorkbook(draft, draft.eaFile);
      const efsAnalysis = await this.analyzeWorkbook(draft, draft.efsFile);
      const organizations = this.buildOrganizationSummary(
        eaAnalysis.organizations,
        efsAnalysis.organizations,
      );
      const issues = [...eaAnalysis.issues, ...efsAnalysis.issues];
      let warningCount = eaAnalysis.warningCount + efsAnalysis.warningCount;
      if (
        organizations.some((organization) => organization.warnings.length > 0)
      ) {
        for (const organization of organizations) {
          for (const warning of organization.warnings) {
            warningCount += 1;
            issues.push({
              level: "warning",
              message: `${organization.displayName}: ${warning}`,
            });
          }
        }
      }
      warningCount += 1;
      issues.push({
        level: "warning",
        message:
          "Zoho commercial outcomes and report entitlements are not imported by this wizard",
      });
      const summary = trimValidationSummary({
        issues,
        workbooks: [eaAnalysis.summary, efsAnalysis.summary],
        organizations,
        blockingErrorCount: eaAnalysis.errorCount + efsAnalysis.errorCount,
        warningCount,
      });
      await this.saveDraft(
        {
          ...draft,
          status: summary.blockingErrorCount === 0 ? "validated" : "draft",
        },
        { output: summary as unknown as Prisma.InputJsonValue },
      );
      return summary;
    } catch (error) {
      throw toHttpException(error);
    }
  }

  async getStatus(
    principal: Principal,
    importId: string,
  ): Promise<HistoricalImportStatus> {
    this.assertAccess(principal);
    const record = await this.prisma.syncJob.findFirst({
      where: {
        provider: "historical-import",
        externalId: importId,
      },
    });
    if (!record) throw new NotFoundException("Historical import not found");
    const draft = draftFromInput(record.input);
    const validation =
      record.output && typeof record.output === "object"
        ? (record.output as unknown as HistoricalImportValidationSummary)
        : undefined;
    let projectName: string | undefined;
    if (draft.projectId) {
      const project = await this.prisma.project.findUnique({
        where: { id: draft.projectId },
        select: { name: true },
      });
      projectName = project?.name;
    }
    return {
      importId,
      status:
        record.status === "SUCCEEDED"
          ? "succeeded"
          : record.status === "FAILED"
            ? "failed"
            : record.status === "RUNNING"
              ? "committing"
              : draft.status,
      metadata: draft,
      ...(validation ? { validation } : {}),
      ...(draft.projectId ? { projectId: draft.projectId } : {}),
      ...(projectName ? { projectName } : {}),
      ...(record.error ? { error: record.error } : {}),
    };
  }

  private async cleanupFailedImport(
    importPrefix: string,
    projectId: string,
  ): Promise<void> {
    await this.prisma.project
      .deleteMany({ where: { id: projectId } })
      .catch(() => undefined);
    await this.prisma.organization
      .deleteMany({
        where: { externalId: { startsWith: `${importPrefix}:org:` } },
      })
      .catch(() => undefined);
  }

  async commit(
    principal: Principal,
    importId: string,
  ): Promise<HistoricalImportStatus> {
    this.assertAccess(principal);
    const draft = await this.loadDraft(importId);
    assertStoredWorkbooksReady(draft);
    const eaFile = draft.eaFile;
    const efsFile = draft.efsFile;

    let validation: HistoricalImportValidationSummary;
    const record = await this.prisma.syncJob.findFirst({
      where: { provider: "historical-import", externalId: importId },
      select: { output: true },
    });
    const cachedValidation =
      record?.output && typeof record.output === "object"
        ? (record.output as unknown as HistoricalImportValidationSummary)
        : undefined;
    if (
      draft.status === "validated" &&
      cachedValidation?.blockingErrorCount === 0
    ) {
      validation = cachedValidation;
    } else {
      validation = await this.validate(principal, importId);
    }
    if (validation.blockingErrorCount > 0) {
      throw new BadRequestException(
        "Resolve validation errors before committing",
      );
    }
    if (draft.status === "succeeded" && draft.projectId) {
      return this.getStatus(principal, importId);
    }

    const commitIdempotencyKey =
      draft.commitIdempotencyKey ?? `historical-import-commit:${importId}`;
    const importPrefix = importPrefixFor(importId);
    const projectId = deterministicUuid(`${importPrefix}:project`);
    const programId = deterministicUuid(`${importPrefix}:program`);
    const projectSlugBase = slugify(draft.projectName);
    let projectSlug = projectSlugBase;
    let slugSuffix = 1;
    while (
      await this.prisma.project.findUnique({
        where: { slug: projectSlug },
        select: { id: true },
      })
    ) {
      projectSlug = `${projectSlugBase}-${slugSuffix}`;
      slugSuffix += 1;
    }

    await this.saveDraft(
      {
        ...draft,
        status: "committing",
        commitIdempotencyKey,
        projectId,
      },
      { error: null },
    );

    try {
      await this.prisma.project.create({
        data: {
          id: projectId,
          externalId: `${importPrefix}:project`,
          name: draft.projectName,
          slug: projectSlug,
          metadata: {
            historicalImportId: importId,
            importStatus: "READY",
            projectAbbreviation: draft.projectAbbreviation ?? null,
          },
        },
      });
      await this.prisma.program.create({
        data: {
          id: programId,
          externalId: `${importPrefix}:program`,
          projectId,
          name: draft.programName,
          year: draft.programYear,
          currency: "USD",
          startsAt: new Date(`${draft.programYear}-01-01T00:00:00.000Z`),
          endsAt: new Date(`${draft.programYear}-12-31T23:59:59.999Z`),
          metadata: {
            historicalImportId: importId,
            employeeSurveyId: draft.employeeSurveyId ?? null,
            employerSurveyId: draft.employerSurveyId ?? null,
          },
        },
      });
      const organizationRows = await this.collectOrganizationRows(
        eaFile,
        efsFile,
      );
      await this.createOrganizationsAndEnrollments(
        this.prisma,
        draft,
        organizationRows,
        projectId,
        programId,
        projectSlug,
      );
      await this.importSurvey(this.prisma, draft, "EA", eaFile, programId);
      await this.importSurvey(this.prisma, draft, "EFS", efsFile, programId);
      const actor =
        principal.sub === "bypass-login-auth"
          ? null
          : await this.prisma.user.findUnique({
              where: { id: principal.sub },
              select: { id: true, username: true, email: true },
            });
      await this.prisma.auditLog.create({
        data: {
          ...(actor ? { actorUserId: actor.id } : {}),
          action: "project.created",
          resourceType: "Project",
          resourceId: projectId,
          after: {
            projectName: draft.projectName,
            actorUsername:
              actor?.username ?? actor?.email ?? "local administrator",
          },
        },
      });

      await this.saveDraft(
        {
          ...draft,
          status: "succeeded",
          commitIdempotencyKey,
          projectId,
        },
        {
          status: "succeeded",
          output: validation as unknown as Prisma.InputJsonValue,
          error: null,
        },
      );
      if (existsSync(draft.stagingDir)) {
        rmSync(draft.stagingDir, { recursive: true, force: true });
      }
      return await this.getStatus(principal, importId);
    } catch (error) {
      await this.cleanupFailedImport(importPrefix, projectId);
      await this.saveDraft(
        { ...draft, status: "failed", commitIdempotencyKey, projectId },
        {
          status: "failed",
          error:
            error instanceof Error ? error.message : "Historical import failed",
        },
      );
      throw toHttpException(error);
    }
  }

  private async collectOrganizationRows(
    eaFile: StoredWorkbook,
    efsFile: StoredWorkbook,
  ): Promise<
    Map<
      string,
      {
        displayName: string;
        workbookOrganizationId?: string;
        eaRespondents: number;
        efsRespondents: number;
        companySize?: number;
      }
    >
  > {
    const rows = new Map<
      string,
      {
        displayName: string;
        workbookOrganizationId?: string;
        eaRespondents: number;
        efsRespondents: number;
        companySize?: number;
      }
    >();
    const ingest = async (
      workbook: StoredWorkbook,
      kind: HistoricalSurveyKind,
    ): Promise<void> => {
      const definition = await readXlsxSurveyDefinition({
        fileName: workbook.fileName,
        filePath: workbook.filePath,
        questionId: (dataLabel) => dataLabel,
      });
      await forEachXlsxSurveyRow(definition, {}, (row) => {
        const displayName = row.organizationName?.trim();
        if (!displayName) return;
        const key = organizationKey(row);
        const existing = rows.get(key) ?? {
          displayName,
          eaRespondents: 0,
          efsRespondents: 0,
          ...(row.organizationId
            ? { workbookOrganizationId: row.organizationId }
            : {}),
        };
        if (kind === "EA") existing.eaRespondents += 1;
        else existing.efsRespondents += 1;
        if (row.organizationId && !existing.workbookOrganizationId) {
          existing.workbookOrganizationId = row.organizationId;
        }
        if (row.companySize !== undefined)
          existing.companySize = row.companySize;
        rows.set(key, existing);
      });
    };
    await ingest(eaFile, "EA");
    await ingest(efsFile, "EFS");
    return rows;
  }

  private async createOrganizationsAndEnrollments(
    prisma: PrismaClient,
    draft: HistoricalImportDraft,
    organizationRows: Map<
      string,
      {
        displayName: string;
        workbookOrganizationId?: string;
        eaRespondents: number;
        efsRespondents: number;
        companySize?: number;
      }
    >,
    projectId: string,
    programId: string,
    projectSlug: string,
  ): Promise<void> {
    const importPrefix = importPrefixFor(draft.importId);
    for (const [key, details] of organizationRows) {
      const organizationId = deterministicUuid(
        `${importPrefix}:organization:${key}`,
      );
      const token = digest(`${importPrefix}:organization:${key}`, 12);
      const organizationData = {
        name: details.displayName,
        slug: `${projectSlug}-${token}`,
        metadata: {
          historicalImportId: draft.importId,
          sourceOrganizationId: details.workbookOrganizationId ?? null,
          sourceOrganizationName: details.displayName,
        },
      };
      await prisma.organization.upsert({
        where: { id: organizationId },
        update: organizationData,
        create: {
          id: organizationId,
          externalId: `${importPrefix}:org:${token}`,
          ...organizationData,
        },
      });
      await prisma.organizationProgram.upsert({
        where: {
          organizationId_programId: {
            organizationId,
            programId,
          },
        },
        update: {
          stage: "Closed",
          reportAccess: {
            WFR_Access: "no",
            WBC_Access: "no",
            BBP_Access: "no",
            EV_Access: "no",
            RD_Access: "no",
            KIA_Access: "no",
            CR_Access: "no",
          },
          metrics: {
            Surveys_Sent: details.efsRespondents,
            Source_Organization_ID: details.workbookOrganizationId ?? null,
            Source_Organization_Name: details.displayName,
            ...(details.companySize !== undefined
              ? { Company_Size: details.companySize }
              : {}),
          },
        },
        create: {
          organizationId,
          projectId,
          programId,
          externalId: `${importPrefix}:enrollment:${token}`,
          stage: "Closed",
          reportAccess: {
            WFR_Access: "no",
            WBC_Access: "no",
            BBP_Access: "no",
            EV_Access: "no",
            RD_Access: "no",
            KIA_Access: "no",
            CR_Access: "no",
          },
          metrics: {
            Surveys_Sent: details.efsRespondents,
            Source_Organization_ID: details.workbookOrganizationId ?? null,
            Source_Organization_Name: details.displayName,
            ...(details.companySize !== undefined
              ? { Company_Size: details.companySize }
              : {}),
          },
        },
      });
    }
  }

  private async importSurvey(
    prisma: PrismaClient,
    draft: HistoricalImportDraft,
    kind: HistoricalSurveyKind,
    workbook: StoredWorkbook,
    programId: string,
  ): Promise<void> {
    const importPrefix = importPrefixFor(draft.importId);
    const surveyId = deterministicUuid(`${importPrefix}:survey:${kind}`);
    const definition = await readXlsxSurveyDefinition({
      fileName: workbook.fileName,
      filePath: workbook.filePath,
      questionId: (dataLabel) =>
        deterministicUuid(`${surveyId}:question:${dataLabel}`),
    });
    const storedTemplates = await prisma.question.findMany({
      where: {
        dataLabel: {
          in: definition.questions.map(({ dataLabel }) => dataLabel),
        },
        OR: [
          { externalId: null },
          {
            externalId: {
              not: { startsWith: "historical-import:" },
            },
          },
        ],
      },
      select: {
        dataLabel: true,
        caption: true,
        type: true,
        metadata: true,
      },
      orderBy: { survey: { createdAt: "desc" } },
    });
    const templatesByDataLabel = new Map<string, HistoricalQuestionTemplate>();
    for (const template of storedTemplates) {
      if (!templatesByDataLabel.has(template.dataLabel)) {
        templatesByDataLabel.set(template.dataLabel, template);
      }
    }
    const missingTemplates = missingQuestionTemplateLabels(
      definition.questions,
      new Set(templatesByDataLabel.keys()),
    );
    if (missingTemplates.length > 0) {
      throw new BadRequestException(
        `${workbook.fileName}: question text is unavailable for ${missingTemplates
          .slice(0, 5)
          .join(", ")}${missingTemplates.length > 5 ? " and more" : ""}`,
      );
    }
    const questions = definition.questions.map((question) =>
      mergeHistoricalQuestionTemplate(
        question,
        templatesByDataLabel.get(question.dataLabel),
      ),
    );
    await prisma.survey.create({
      data: {
        id: surveyId,
        externalId: `${importPrefix}:survey:${kind.toLowerCase()}`,
        programId,
        title:
          kind === "EA"
            ? `${draft.programName} Employer Assessment`
            : `${draft.programName} Employee Feedback Survey`,
        status: "CLOSED",
        startsAt: new Date(`${draft.programYear}-01-01T00:00:00.000Z`),
        endsAt: new Date(
          `${draft.programYear}-${kind === "EA" ? "05-31" : "06-30"}T23:59:59.999Z`,
        ),
        metadata: {
          historicalImportId: draft.importId,
          kind: kind === "EA" ? "employer" : "employee",
          sourceFile: workbook.fileName,
          sourceSha256: workbook.sha256,
        },
      },
    });
    await prisma.question.createMany({
      data: questions.map((question, index) => ({
        id: question.id,
        externalId: `${importPrefix}:question:${kind.toLowerCase()}:${digest(question.dataLabel, 12)}`,
        surveyId,
        dataLabel: question.dataLabel,
        caption: question.caption,
        type: question.type,
        position: index + 1,
        metadata: historicalQuestionMetadata(
          question,
          templatesByDataLabel.get(question.dataLabel)?.metadata,
          draft.importId,
        ),
      })),
    });
    const respondentBatch: Prisma.RespondentCreateManyInput[] = [];
    const responseBatch: Prisma.ResponseCreateManyInput[] = [];
    const flush = async (): Promise<void> => {
      if (respondentBatch.length > 0) {
        await prisma.respondent.createMany({ data: respondentBatch });
        respondentBatch.length = 0;
      }
      if (responseBatch.length > 0) {
        await insertBatches(responseBatch, (data) =>
          prisma.response.createMany({ data }),
        );
        responseBatch.length = 0;
      }
    };
    await forEachXlsxSurveyRow(definition, {}, async (row) => {
      const displayName = row.organizationName?.trim();
      if (!displayName) return;
      const organizationId = deterministicUuid(
        `${importPrefix}:organization:${organizationKey(row)}`,
      );
      const respondentToken = digest(
        `${kind}:${String(row.respondent ?? row.rowNumber)}:${workbook.sha256}`,
        32,
      );
      const respondentId = deterministicUuid(
        `${surveyId}:respondent:${respondentToken}`,
      );
      respondentBatch.push({
        id: respondentId,
        externalId: `${importPrefix}:respondent:${respondentToken}`,
        surveyId,
        organizationId,
        status: row.completed ? "COMPLETED" : "INCOMPLETE",
        locale: row.language,
        respondentHash: digest(`respondent:${respondentToken}`, 64),
        completedAt: row.completed
          ? (row.completedAt ??
            new Date(`${draft.programYear}-06-30T12:00:00.000Z`))
          : null,
        metadata: {
          historicalImportId: draft.importId,
          sourceRow: row.rowNumber,
          surveyKind: kind,
        },
      });
      for (const response of row.responses) {
        responseBatch.push({
          id: deterministicUuid(
            `${respondentId}:response:${response.question.id}`,
          ),
          respondentId,
          questionId: response.question.id,
          value: response.value,
          score: response.score,
        });
      }
      if (
        respondentBatch.length >= 500 ||
        responseBatch.length >= responseBatchSize
      ) {
        await flush();
      }
    });
    await flush();
  }
}
