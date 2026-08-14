import "dotenv/config";

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, extname, join, resolve } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { hash } from "argon2";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";

const seedPrefix = "seed-br";
const defaultSource = resolve(process.cwd(), "..", "Baton Rouge 24-26.zip");
const responseBatchSize = 2_000;
const testUsername = "test.baton";
const testUserEmail = "test.baton@example.test";
const testUserPassword = "BatonRouge123!";
const targetOrganizationName = "Commerce Title & Abstract Company";

type SurveyKind = "EA" | "EFS";

interface SourceWorkbook {
  fileName: string;
  filePath: string;
  kind: SurveyKind;
  year: number;
}

interface LoadedSources {
  cleanup: () => void;
  directory: string;
  workbooks: SourceWorkbook[];
}

interface CliOptions {
  dryRun: boolean;
  reportSource: string;
  skipIfPresent: boolean;
  source: string;
}

interface ReportHeader {
  title: string;
  type: string;
}

interface WorkforceQuestionSnapshot {
  dataValues: Array<number | string>;
  text: string;
}

interface WorkforceCategorySnapshot {
  dataValues: Array<number | string>;
  questions: WorkforceQuestionSnapshot[];
  title: string;
}

interface WorkforceSnapshot {
  categories: WorkforceCategorySnapshot[];
  headers: ReportHeader[];
  sourceFile: string;
  surveyAverage: Array<number | string>;
}

interface BenefitsResponseSnapshot {
  dataValues: Array<number | string>;
  format: "number" | "percent";
  label: string;
}

interface BenefitsQuestionSnapshot {
  responses: BenefitsResponseSnapshot[];
  text: string;
}

interface BenefitsSectionSnapshot {
  questions: BenefitsQuestionSnapshot[];
  title: string;
}

interface BenefitsSnapshot {
  headers: ReportHeader[];
  sections: BenefitsSectionSnapshot[];
  sourceFile: string;
}

interface PublishedReports {
  benefitsBestPractices: BenefitsSnapshot;
  workforceBenchmark: WorkforceSnapshot;
}

interface ParsedQuestion {
  benchmarkValues?: Array<number | string>;
  categoryLabel?: string;
  column: number;
  dataLabel: string;
  caption: string;
  filterLabel?: string;
  id: string;
  type: string;
}

interface SurveyStats {
  organizations: number;
  questions: number;
  respondents: number;
  responses: number;
}

interface OrganizationSourceDetails {
  count: number;
  size?: number;
  sourceOrganizationId?: string;
  sourceOrganizationName?: string;
}

function parseOptions(argv: string[]): CliOptions {
  let source = process.env.BR_SEED_SOURCE
    ? resolve(process.env.BR_SEED_SOURCE)
    : defaultSource;
  let dryRun = false;
  let skipIfPresent = false;
  let reportSource = process.env.BR_REPORT_SOURCE
    ? resolve(process.env.BR_REPORT_SOURCE)
    : dirname(source);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--dry-run") {
      dryRun = true;
      continue;
    }
    if (argument === "--skip-if-present") {
      skipIfPresent = true;
      continue;
    }
    if (argument === "--source") {
      const value = argv[index + 1];
      if (!value) throw new Error("--source requires a file or directory path");
      source = resolve(value);
      reportSource = dirname(source);
      index += 1;
      continue;
    }
    if (argument === "--report-source") {
      const value = argv[index + 1];
      if (!value) throw new Error("--report-source requires a directory path");
      reportSource = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return { dryRun, reportSource, skipIfPresent, source };
}

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /(^|[\s-])([a-z])/gu,
      (_match, prefix: string, letter: string) =>
        `${prefix}${letter.toUpperCase()}`,
    );
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function reportHeaders(worksheet: ExcelJS.Worksheet): ReportHeader[] {
  const labels = worksheet.getRow(6);
  return Array.from({ length: worksheet.columnCount - 1 }, (_, index) => {
    const title = String(
      cellScalar(labels.getCell(index + 2).value) ?? "",
    ).trim();
    const winner = /non-winners?$/iu.test(title) ? "No" : "Yes";
    const size = title
      .replace(/\s+non-winners?$/iu, "")
      .replace(/\s+winners?$/iu, "")
      .trim();
    return {
      title: size === "All" ? "All Size Categories" : `${size} Employers`,
      type: `${size.replace(/\s+/gu, "")}_${winner}`,
    };
  });
}

function reportValues(
  row: ExcelJS.Row,
  count: number,
  format: "number" | "percent" = "number",
): Array<number | string> {
  return Array.from({ length: count }, (_, index) => {
    const value = cellScalar(row.getCell(index + 2).value);
    if (typeof value === "number") {
      return format === "percent" ? value * 100 : value;
    }
    return value === null ? "x" : String(value).trim();
  });
}

async function parseWorkforceSnapshot(
  filePath: string,
): Promise<WorkforceSnapshot> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet)
    throw new Error(`${basename(filePath)} contains no worksheet`);
  const headers = reportHeaders(worksheet);
  const categories: WorkforceCategorySnapshot[] = [];
  let current: WorkforceCategorySnapshot | undefined;
  let surveyAverage: Array<number | string> = [];
  for (let rowNumber = 8; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const label = String(cellScalar(row.getCell(1).value) ?? "").trim();
    if (!label) continue;
    const values = reportValues(row, headers.length);
    const numeric = values.some((value) => typeof value === "number");
    if (!numeric) {
      if (/^x\s*[–-]|^this report/iu.test(label)) break;
      current = { dataValues: [], questions: [], title: titleCase(label) };
      categories.push(current);
      continue;
    }
    if (/^survey average$/iu.test(label)) {
      surveyAverage = values;
      continue;
    }
    if (/\s+-\s+average$/iu.test(label)) {
      if (current) current.dataValues = values;
      continue;
    }
    if (!current)
      throw new Error(`${basename(filePath)} has a question before a section`);
    current.questions.push({ dataValues: values, text: label });
  }
  return { categories, headers, sourceFile: basename(filePath), surveyAverage };
}

async function parseBenefitsSnapshot(
  filePath: string,
): Promise<BenefitsSnapshot> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet)
    throw new Error(`${basename(filePath)} contains no worksheet`);
  const headers = reportHeaders(worksheet);
  const sections: BenefitsSectionSnapshot[] = [];
  let section: BenefitsSectionSnapshot | undefined;
  let question: BenefitsQuestionSnapshot | undefined;
  for (let rowNumber = 8; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const label = String(cellScalar(row.getCell(1).value) ?? "").trim();
    if (!label) continue;
    if (/^x\s*[–-]|^this report/iu.test(label)) break;
    const hasNumbers = Array.from({ length: headers.length }, (_, index) =>
      cellScalar(row.getCell(index + 2).value),
    ).some((value) => typeof value === "number");
    if (!hasNumbers) {
      const normalized = label.replace(/[^A-Za-z]+/gu, "");
      const isSection =
        normalized.length > 0 && normalized === normalized.toUpperCase();
      if (isSection) {
        section = { questions: [], title: titleCase(label) };
        sections.push(section);
        question = undefined;
      } else {
        if (!section)
          throw new Error(
            `${basename(filePath)} has a question before a section`,
          );
        question = { responses: [], text: label };
        section.questions.push(question);
      }
      continue;
    }
    if (!section)
      throw new Error(`${basename(filePath)} has values before a section`);
    if (!question) {
      question = { responses: [], text: label };
      section.questions.push(question);
    }
    const percent = row.getCell(2).numFmt.includes("%");
    question.responses.push({
      dataValues: reportValues(
        row,
        headers.length,
        percent ? "percent" : "number",
      ),
      format: percent ? "percent" : "number",
      label,
    });
  }
  return { headers, sections, sourceFile: basename(filePath) };
}

async function loadPublishedReports(
  reportSource: string,
  years: number[],
): Promise<Map<number, PublishedReports>> {
  if (!existsSync(reportSource)) {
    throw new Error(`Report source does not exist: ${reportSource}`);
  }
  const fileNames = readdirSync(reportSource).filter((fileName) =>
    /\.xlsx$/iu.test(fileName),
  );
  const reports = new Map<number, PublishedReports>();
  for (const year of years) {
    const workforceFile = fileNames.find(
      (fileName) =>
        fileName.includes(String(year)) &&
        /(?:workforce\s+benchmark|benchmark\s+comparisons)/iu.test(fileName),
    );
    const benefitsFile = fileNames.find(
      (fileName) =>
        fileName.includes(String(year)) &&
        /benefits\s*&\s*best\s*practices/iu.test(fileName),
    );
    if (!workforceFile || !benefitsFile) {
      throw new Error(
        `Published Baton Rouge report workbooks are missing for ${year} in ${reportSource}`,
      );
    }
    reports.set(year, {
      benefitsBestPractices: await parseBenefitsSnapshot(
        join(reportSource, benefitsFile),
      ),
      workforceBenchmark: await parseWorkforceSnapshot(
        join(reportSource, workforceFile),
      ),
    });
  }
  return reports;
}

function sourceIdentity(
  fileName: string,
): Pick<SourceWorkbook, "kind" | "year"> {
  const match = /^BR (20\d{2}) - (EA|EFS) ORD\.xlsx$/iu.exec(
    basename(fileName),
  );
  if (!match?.[1] || !match[2]) {
    throw new Error(`Unexpected Baton Rouge source filename: ${fileName}`);
  }
  return { year: Number(match[1]), kind: match[2].toUpperCase() as SurveyKind };
}

function loadSourceWorkbooks(source: string): LoadedSources {
  if (!existsSync(source)) throw new Error(`Source does not exist: ${source}`);
  const extension = extname(source).toLowerCase();
  const extractionDirectory =
    extension === ".zip" ? mkdtempSync(join(tmpdir(), "wrg-br-seed-")) : null;
  const sourceDirectory = extractionDirectory ?? source;
  const files =
    extension === ".zip"
      ? new AdmZip(source)
          .getEntries()
          .filter(
            (entry) => !entry.isDirectory && /\.xlsx$/iu.test(entry.entryName),
          )
          .map((entry) => {
            const fileName = basename(entry.entryName);
            const filePath = join(sourceDirectory, fileName);
            writeFileSync(filePath, entry.getData());
            return { fileName, filePath };
          })
      : readdirSync(source)
          .filter((fileName) => /\.xlsx$/iu.test(fileName))
          .map((fileName) => ({ fileName, filePath: join(source, fileName) }));
  const workbooks = files
    .filter(({ fileName }) =>
      /^BR 20\d{2} - (?:EA|EFS) ORD\.xlsx$/iu.test(fileName),
    )
    .map((file) => ({ ...file, ...sourceIdentity(file.fileName) }))
    .sort(
      (left, right) =>
        left.year - right.year || left.kind.localeCompare(right.kind),
    );
  if (workbooks.length === 0) {
    if (extractionDirectory) rmSync(extractionDirectory, { recursive: true });
    throw new Error(`No "BR YYYY - EA/EFS ORD.xlsx" files found in ${source}`);
  }
  return {
    workbooks,
    directory: sourceDirectory,
    cleanup: () => {
      if (extractionDirectory)
        rmSync(extractionDirectory, { recursive: true, force: true });
    },
  };
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

function cellScalar(
  value: ExcelJS.CellValue,
): string | number | boolean | Date | null {
  if (value === null || value === undefined) return null;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (value instanceof Date) return value;
  if ("result" in value) return cellScalar(value.result ?? null);
  if ("text" in value && typeof value.text === "string") return value.text;
  if ("richText" in value && Array.isArray(value.richText)) {
    return value.richText.map((part) => part.text).join("");
  }
  return String(value);
}

function headerValue(row: ExcelJS.Row, column: number): string {
  const value = cellScalar(row.getCell(column).value);
  return value === null ? "" : String(value).trim();
}

function organizationKey(
  value: ExcelJS.CellValue,
  year: number,
  row: number,
  fallbackId?: ExcelJS.CellValue,
): string {
  const scalar = cellScalar(value);
  const normalized =
    scalar === null
      ? ""
      : String(scalar)
          .normalize("NFKD")
          .toLowerCase()
          .replace(/[^a-z0-9]+/gu, " ")
          .trim();
  if (normalized) return normalized;
  const fallback = fallbackId === undefined ? null : cellScalar(fallbackId);
  return fallback === null || String(fallback).trim() === ""
    ? `unknown ${year} ${row}`
    : `organization id ${year} ${String(fallback).trim()}`;
}

function sourceOrganizationValue(value: ExcelJS.CellValue): string | undefined {
  const scalar = cellScalar(value);
  if (scalar === null) return undefined;
  const normalized = String(scalar).trim();
  return normalized || undefined;
}

function sourceOrganization(key: string, sourceName?: string) {
  const token = digest(`organization:${key}`, 12);
  return {
    id: deterministicUuid(`${seedPrefix}:organization:${key}`),
    externalId: `${seedPrefix}-org-${token}`,
    name: sourceName?.trim() ?? "Unknown Baton Rouge Organization",
    slug: `br-seed-${token}`,
  };
}

function humanizeDataLabel(dataLabel: string): string {
  return dataLabel
    .replace(/^[qf]_/u, "")
    .replace(/_ORGID.*$/iu, "")
    .replace(/_/gu, " / ")
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/\s+/gu, " ")
    .trim();
}

function demographicFilterLabel(dataLabel: string): string | undefined {
  const match = /^f_(?:Personal|Workplace)Demographics_([^_]+)/u.exec(
    dataLabel,
  );
  if (!match?.[1]) return undefined;
  return match[1]
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/^./u, (letter) => letter.toUpperCase());
}

function questionType(dataLabel: string): string {
  if (
    /^q_(?:CoreEmployeeExperience|YourJob|CommunicationWorkplaceCulture|RelationshipManager|TrainingTechnologyProfessionalDevelopment|DiversityInclusion|Leadership|EmployeeBenefits|WorkLifeBalance)_/u.test(
      dataLabel,
    )
  ) {
    return "likert";
  }
  if (/^f_|Company Size|Sample size/iu.test(dataLabel)) return "demographic";
  if (
    /OpenEnded|Describe|AnythingElse|WinnerProfile|ContactInfo|Email|Phone|Address|Photo|Logo/iu.test(
      dataLabel,
    )
  ) {
    return "open-text";
  }
  if (dataLabel.startsWith("q_")) return "choice";
  return "text";
}

function questionTypeId(type: string): number {
  if (type === "likert") return 5;
  if (type === "demographic") return 2;
  if (type === "open-text" || type === "text") return 9;
  return 1;
}

function sanitizedResponse(
  value: ExcelJS.CellValue,
  question: ParsedQuestion,
): Prisma.InputJsonValue | null {
  const scalar = cellScalar(value);
  if (scalar === null || scalar === "") return null;
  if (typeof scalar === "number")
    return Number.isFinite(scalar) ? scalar : null;
  if (typeof scalar === "boolean") return scalar;
  if (scalar instanceof Date)
    return `Synthetic date ${digest(question.dataLabel, 8)}`;
  const trimmed = scalar.trim();
  if (!trimmed) return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed);
  if (/^(?:yes|no|n\/a|not applicable|true|false)$/iu.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  const label =
    question.type === "choice" || question.type === "demographic"
      ? "Synthetic option"
      : "Synthetic text";
  return `${label} ${digest(`${question.dataLabel}:${trimmed}`, 10)}`;
}

function parsedDate(value: ExcelJS.CellValue): Date | null {
  const scalar = cellScalar(value);
  if (scalar instanceof Date) return scalar;
  if (typeof scalar !== "string" || !scalar.trim()) return null;
  const timestamp = Date.parse(
    scalar.includes("T") ? scalar : scalar.replace(" ", "T") + "Z",
  );
  return Number.isNaN(timestamp) ? null : new Date(timestamp);
}

function isCompleted(
  value: ExcelJS.CellValue,
  respondedAt: Date | null,
): boolean {
  const scalar = cellScalar(value);
  if (respondedAt) return true;
  if (typeof scalar === "number") return scalar > 0;
  if (typeof scalar === "boolean") return scalar;
  return (
    typeof scalar === "string" &&
    /^(?:1|yes|true|complete|completed)$/iu.test(scalar.trim())
  );
}

function categoryFromOrdinal(
  value: number | undefined,
  respondentCount: number,
): string {
  if (value === 1) return "Small";
  if (value === 2) return "Medium";
  if (value !== undefined && value >= 3) return "Large";
  if (respondentCount < 50) return "Small";
  if (respondentCount < 250) return "Medium";
  return "Large";
}

function metadataColumn(headers: ExcelJS.Row, name: string): number {
  for (let column = 1; column <= headers.cellCount; column += 1) {
    if (headerValue(headers, column).toLowerCase() === name.toLowerCase())
      return column;
  }
  return 0;
}

function firstNonEmptyCell(
  row: ExcelJS.Row,
  columns: number[],
): ExcelJS.CellValue {
  for (const column of columns) {
    if (!column) continue;
    const value = row.getCell(column).value;
    const scalar = cellScalar(value);
    if (scalar !== null && String(scalar).trim() !== "") return value;
  }
  return null;
}

function questionsForHeaders(
  headers: ExcelJS.Row,
  columnCount: number,
  surveyId: string,
): ParsedQuestion[] {
  const scorePercentColumn = metadataColumn(headers, "Score %");
  if (scorePercentColumn === 0) throw new Error('Missing "Score %" column');
  const questions: ParsedQuestion[] = [];
  const seen = new Set<string>();
  for (
    let column = scorePercentColumn + 1;
    column <= columnCount;
    column += 1
  ) {
    const original = headerValue(headers, column);
    if (
      !original ||
      /^(?:organization_ID|organization_name)$/iu.test(original) ||
      /_ORGID(?:_|$)/iu.test(original)
    )
      continue;
    const dataLabel = seen.has(original)
      ? `${original}__column_${column}`
      : original;
    const filterLabel = demographicFilterLabel(dataLabel);
    seen.add(dataLabel);
    questions.push({
      column,
      dataLabel,
      caption: humanizeDataLabel(dataLabel),
      ...(filterLabel ? { filterLabel } : {}),
      id: deterministicUuid(`${surveyId}:question:${dataLabel}`),
      type: questionType(dataLabel),
    });
  }
  return questions;
}

async function forEachSourceRow(
  source: SourceWorkbook,
  callback: (row: ExcelJS.Row) => Promise<void> | void,
): Promise<void> {
  const reader = new ExcelJS.stream.xlsx.WorkbookReader(source.filePath, {
    entries: "emit",
    hyperlinks: "ignore",
    sharedStrings: "cache",
    styles: "ignore",
    worksheets: "emit",
  });
  let found = false;
  for await (const worksheet of reader) {
    found = true;
    for await (const row of worksheet) await callback(row);
    break;
  }
  if (!found)
    throw new Error(`${source.fileName}: workbook contains no worksheets`);
}

async function clearPreviousSeed(prisma: PrismaClient): Promise<void> {
  await prisma.user.deleteMany({
    where: {
      OR: [
        { externalId: `${seedPrefix}-user-${testUsername}` },
        { username: testUsername },
        { email: testUserEmail },
      ],
    },
  });
  await prisma.project.deleteMany({
    where: { externalId: `${seedPrefix}-project` },
  });
  await prisma.organization.deleteMany({
    where: { externalId: { startsWith: `${seedPrefix}-org-` } },
  });
}

async function createReportUser(
  prisma: PrismaClient,
  projectId: string,
): Promise<void> {
  const programs = await prisma.program.findMany({
    where: { projectId },
    orderBy: { year: "desc" },
    select: { id: true, year: true },
  });
  const latestProgram = programs[0];
  if (!latestProgram) throw new Error("Could not find a Baton Rouge program");
  const enrollments = await prisma.organizationProgram.findMany({
    where: { projectId, programId: latestProgram.id },
    orderBy: { organization: { name: "asc" } },
    select: {
      id: true,
      organizationId: true,
      organization: {
        select: {
          name: true,
          programs: {
            where: { projectId },
            select: { program: { select: { year: true } } },
          },
        },
      },
    },
  });
  const enrollment =
    enrollments.find(
      ({ organization }) =>
        new Set(organization.programs.map(({ program }) => program.year))
          .size >= programs.length,
    ) ?? enrollments[0];
  if (!enrollment) throw new Error("Could not find a Baton Rouge enrollment");
  const organizationEnrollments = await prisma.organizationProgram.findMany({
    where: {
      organizationId: enrollment.organizationId,
      projectId,
      programId: { in: programs.map(({ id }) => id) },
    },
    select: { id: true, programId: true },
  });
  if (organizationEnrollments.length !== programs.length) {
    throw new Error(
      "Could not find an organization enrolled in every Baton Rouge program",
    );
  }
  const clientRole = await prisma.role.upsert({
    where: { key: "client" },
    update: {},
    create: { key: "client", name: "Client" },
  });
  const user = await prisma.user.create({
    data: {
      externalId: `${seedPrefix}-user-${testUsername}`,
      email: testUserEmail,
      username: testUsername,
      fullName: "Baton Rouge Report Tester",
      passwordHash: await hash(testUserPassword),
      status: "ACTIVE",
      organizationId: enrollment.organizationId,
      organizationProgramId: enrollment.id,
      metadata: { anonymized: true, seed: seedPrefix },
    },
  });
  await Promise.all([
    prisma.userRole.create({
      data: { userId: user.id, roleId: clientRole.id },
    }),
    prisma.userProject.create({
      data: { userId: user.id, projectId },
    }),
    ...programs.map((program) =>
      prisma.userProgram.create({
        data: { userId: user.id, programId: program.id },
      }),
    ),
  ]);
  console.log(
    `Created client report user ${testUserEmail} for ${enrollment.organization.name} ` +
      `with access to Baton Rouge ${programs.map(({ year }) => year).join(", ")}.`,
  );
}

async function verifyImportedData(
  prisma: PrismaClient,
  projectId: string,
  sources: SourceWorkbook[],
  expectedStats: Map<string, SurveyStats>,
  reportsByYear: Map<number, PublishedReports>,
): Promise<void> {
  for (const source of sources) {
    const key = `${source.year}-${source.kind}`;
    const expected = expectedStats.get(key);
    if (!expected) throw new Error(`Missing expected import totals for ${key}`);
    const survey = await prisma.survey.findFirstOrThrow({
      where: {
        program: { projectId },
        externalId: `${seedPrefix}-survey-${source.year}-${source.kind.toLowerCase()}`,
      },
      select: {
        id: true,
        _count: { select: { questions: true, respondents: true } },
      },
    });
    const responses = await prisma.response.count({
      where: { respondent: { surveyId: survey.id } },
    });
    if (
      survey._count.questions !== expected.questions ||
      survey._count.respondents !== expected.respondents ||
      responses !== expected.responses
    ) {
      throw new Error(
        `${key} database reconciliation failed: expected ` +
          `${expected.questions}/${expected.respondents}/${expected.responses}, received ` +
          `${survey._count.questions}/${survey._count.respondents}/${responses}`,
      );
    }
  }
  const programs = await prisma.program.findMany({
    where: { projectId },
    select: { year: true, metadata: true },
  });
  for (const program of programs) {
    if (program.year === null) continue;
    const expected = reportsByYear.get(program.year);
    const metadata = program.metadata;
    const stored =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata.publishedReports
        : undefined;
    if (!expected || canonicalJson(stored) !== canonicalJson(expected)) {
      throw new Error(
        `${program.year} published workbook snapshot did not round-trip through PostgreSQL`,
      );
    }
  }
  const [reportUser, programCount] = await Promise.all([
    prisma.user.findUniqueOrThrow({
      where: { email: testUserEmail },
      select: { _count: { select: { programs: true } } },
    }),
    prisma.program.count({ where: { projectId } }),
  ]);
  if (reportUser._count.programs !== programCount) {
    throw new Error(
      "Baton Rouge report user must have access to every imported program",
    );
  }
  console.log(
    "Verified all imported survey totals, published XLSX snapshots, and complete user program scope.",
  );
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

async function seedSurvey(
  prisma: PrismaClient | null,
  source: SourceWorkbook,
  projectId: string,
  reports: PublishedReports,
): Promise<SurveyStats> {
  const surveyId = deterministicUuid(
    `${seedPrefix}:survey:${source.year}:${source.kind}`,
  );
  const programId = deterministicUuid(`${seedPrefix}:program:${source.year}`);
  let questions: ParsedQuestion[] = [];
  let organizationColumns: number[] = [];
  let organizationIdColumns: number[] = [];
  let respondentColumn = 0;
  let languageColumn = 0;
  let dateRespondedColumn = 0;
  let reachedEndColumn = 0;
  let companySizeColumn = 0;
  let respondentCount = 0;
  const organizationRows = new Map<string, OrganizationSourceDetails>();
  await forEachSourceRow(source, (row) => {
    if (row.number === 1) {
      questions = questionsForHeaders(row, row.cellCount, surveyId);
      if (source.kind === "EFS") {
        const publishedQuestions =
          reports.workforceBenchmark.categories.flatMap((category) =>
            category.questions.map((question) => ({
              ...question,
              categoryLabel: category.title,
            })),
          );
        const likertQuestions = questions.filter(
          (question) => question.type === "likert",
        );
        if (likertQuestions.length !== publishedQuestions.length) {
          throw new Error(
            `${source.fileName}: ${likertQuestions.length} Likert questions do not match ` +
              `${publishedQuestions.length} questions in ${reports.workforceBenchmark.sourceFile}`,
          );
        }
        likertQuestions.forEach((question, index) => {
          const published = publishedQuestions[index];
          if (!published) return;
          question.caption = published.text;
          question.categoryLabel = published.categoryLabel;
          question.benchmarkValues = published.dataValues;
        });
      }
      organizationColumns = [
        metadataColumn(row, "organization name"),
        metadataColumn(row, "organization_name"),
      ];
      organizationIdColumns = [
        metadataColumn(row, "organization ID2"),
        metadataColumn(row, "organization ID"),
        metadataColumn(row, "organization_ID"),
      ];
      respondentColumn = metadataColumn(row, "Respondent");
      languageColumn = metadataColumn(row, "Language");
      dateRespondedColumn = metadataColumn(row, "Date responded");
      reachedEndColumn = metadataColumn(row, "Reached end");
      companySizeColumn =
        Array.from({ length: row.cellCount }, (_, index) => index + 1).find(
          (column) => /Company Size/iu.test(headerValue(row, column)),
        ) ?? 0;
      return;
    }
    const sourceOrganizationNameValue = firstNonEmptyCell(
      row,
      organizationColumns,
    );
    const sourceOrganizationName = sourceOrganizationValue(
      sourceOrganizationNameValue,
    );
    if (sourceOrganizationName !== targetOrganizationName) return;
    respondentCount += 1;
    const sourceOrganizationIdValue = firstNonEmptyCell(
      row,
      organizationIdColumns,
    );
    const key = organizationKey(
      sourceOrganizationNameValue,
      source.year,
      row.number,
      sourceOrganizationIdValue,
    );
    let existing = organizationRows.get(key);
    if (!existing) {
      existing = { count: 0 };
      const sourceOrganizationId = sourceOrganizationValue(
        sourceOrganizationIdValue,
      );
      if (sourceOrganizationId) {
        existing.sourceOrganizationId = sourceOrganizationId;
      }
    }
    existing.count += 1;
    const size = companySizeColumn
      ? cellScalar(row.getCell(companySizeColumn).value)
      : null;
    if (typeof size === "number") existing.size = size;
    organizationRows.set(key, existing);
  });
  if (!organizationColumns.some(Boolean) || !respondentColumn) {
    throw new Error(
      `${source.fileName}: required respondent/organization columns are missing`,
    );
  }
  if (organizationRows.size === 0) {
    throw new Error(
      `${source.fileName}: no rows found for organization "${targetOrganizationName}"`,
    );
  }

  if (prisma) {
    await prisma.program.upsert({
      where: { externalId: `${seedPrefix}-program-${source.year}` },
      update: {},
      create: {
        id: programId,
        externalId: `${seedPrefix}-program-${source.year}`,
        projectId,
        name: `Best Places to Work in Baton Rouge ${source.year}`,
        year: source.year,
        startsAt: new Date(`${source.year}-01-01T00:00:00.000Z`),
        endsAt: new Date(`${source.year}-12-31T23:59:59.999Z`),
        metadata: {
          anonymized: true,
          publishedReports: JSON.parse(
            JSON.stringify(reports),
          ) as Prisma.InputJsonValue,
          seed: seedPrefix,
        },
      },
    });
    await prisma.survey.create({
      data: {
        id: surveyId,
        externalId: `${seedPrefix}-survey-${source.year}-${source.kind.toLowerCase()}`,
        programId,
        title:
          source.kind === "EA"
            ? `Baton Rouge ${source.year} Employer Assessment`
            : `Baton Rouge ${source.year} Employee Feedback Survey`,
        status: "CLOSED",
        startsAt: new Date(`${source.year}-01-01T00:00:00.000Z`),
        endsAt: new Date(
          `${source.year}-${source.kind === "EA" ? "05-31" : "06-30"}T23:59:59.999Z`,
        ),
        metadata: {
          anonymized: true,
          kind: source.kind === "EA" ? "employer" : "employee",
          seed: seedPrefix,
          sourceFile: source.fileName,
        },
      },
    });
    for (const [key, details] of organizationRows) {
      const organization = sourceOrganization(
        key,
        details.sourceOrganizationName,
      );
      const metadata = {
        anonymized: true,
        seed: seedPrefix,
        ...(details.sourceOrganizationId
          ? { sourceOrganizationId: details.sourceOrganizationId }
          : {}),
        ...(details.sourceOrganizationName
          ? { sourceOrganizationName: details.sourceOrganizationName }
          : {}),
      };
      await prisma.organization.upsert({
        where: { id: organization.id },
        update: { name: organization.name, metadata },
        create: { ...organization, metadata },
      });
    }
    for (const [key, details] of organizationRows) {
      const organization = sourceOrganization(
        key,
        details.sourceOrganizationName,
      );
      const sourceIdentity = {
        ...(details.sourceOrganizationId
          ? { Source_Organization_ID: details.sourceOrganizationId }
          : {}),
        ...(details.sourceOrganizationName
          ? { Source_Organization_Name: details.sourceOrganizationName }
          : {}),
      };
      await prisma.organizationProgram.upsert({
        where: {
          organizationId_programId: {
            organizationId: organization.id,
            programId,
          },
        },
        update:
          source.kind === "EFS"
            ? {
                reportAccess: {
                  BBP_Access: "yes",
                  CR_Access: "no",
                  EV_Access: "yes",
                  KIA_Access: "no",
                  RD_Access: "yes",
                  WBC_Access: "yes",
                  WFR_Access: "yes",
                },
                metrics: {
                  Current_Year_Category: categoryFromOrdinal(
                    details.size,
                    details.count,
                  ),
                  Surveys_Sent: details.count,
                  ...sourceIdentity,
                },
              }
            : {},
        create: {
          organizationId: organization.id,
          projectId,
          programId,
          externalId: `${seedPrefix}-enrollment-${source.year}-${digest(key, 12)}`,
          stage: "Active",
          reportAccess: {
            BBP_Access: "yes",
            EV_Access: "yes",
            KIA_Access: "no",
            RD_Access: "yes",
            WBC_Access: "yes",
            WFR_Access: "yes",
            CR_Access: "no",
          },
          metrics: {
            Current_Year_Category: categoryFromOrdinal(
              details.size,
              details.count,
            ),
            Surveys_Sent: details.count,
            ...sourceIdentity,
          },
        },
      });
    }
    await prisma.question.createMany({
      data: questions.map((question, index) => ({
        id: question.id,
        externalId: `${seedPrefix}-question-${source.year}-${source.kind.toLowerCase()}-${digest(question.dataLabel, 12)}`,
        surveyId,
        dataLabel: question.dataLabel,
        caption: question.caption,
        type: question.type,
        position: index + 1,
        metadata: {
          QuestionTypeId: questionTypeId(question.type),
          anonymized: true,
          ...(question.categoryLabel
            ? { categoryLabel: question.categoryLabel }
            : {}),
          ...(question.filterLabel
            ? { filterLabel: question.filterLabel }
            : {}),
          ...(question.benchmarkValues
            ? { benchmarkValues: question.benchmarkValues }
            : {}),
          sourceColumn: question.column,
        },
      })),
    });
  }

  let responseCount = 0;
  const respondentBatch: Prisma.RespondentCreateManyInput[] = [];
  const responseBatch: Prisma.ResponseCreateManyInput[] = [];
  const flush = async (): Promise<void> => {
    if (!prisma) {
      respondentBatch.length = 0;
      responseBatch.length = 0;
      return;
    }
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

  await forEachSourceRow(source, async (row) => {
    if (row.number === 1) return;
    const sourceOrganizationNameValue = firstNonEmptyCell(
      row,
      organizationColumns,
    );
    const sourceOrganizationName = sourceOrganizationValue(
      sourceOrganizationNameValue,
    );
    if (sourceOrganizationName !== targetOrganizationName) return;
    const organization = sourceOrganization(
      organizationKey(
        sourceOrganizationNameValue,
        source.year,
        row.number,
        firstNonEmptyCell(row, organizationIdColumns),
      ),
      sourceOrganizationName,
    );
    const sourceRespondent = cellScalar(row.getCell(respondentColumn).value);
    const respondentToken = digest(
      `${source.year}:${source.kind}:${String(sourceRespondent ?? row.number)}`,
      32,
    );
    const respondentId = deterministicUuid(
      `${surveyId}:respondent:${respondentToken}`,
    );
    const respondedAt = dateRespondedColumn
      ? parsedDate(row.getCell(dateRespondedColumn).value)
      : null;
    const completed = isCompleted(
      reachedEndColumn ? row.getCell(reachedEndColumn).value : null,
      respondedAt,
    );
    respondentBatch.push({
      id: respondentId,
      externalId: `${seedPrefix}-respondent-${respondentToken}`,
      surveyId,
      organizationId: organization.id,
      status: completed ? "COMPLETED" : "INCOMPLETE",
      locale: languageColumn
        ? String(cellScalar(row.getCell(languageColumn).value) ?? "en").slice(
            0,
            12,
          )
        : "en",
      respondentHash: digest(`respondent:${respondentToken}`, 64),
      completedAt: completed
        ? (respondedAt ?? new Date(`${source.year}-06-30T12:00:00.000Z`))
        : null,
      metadata: {
        anonymized: true,
        seed: seedPrefix,
        sourceRow: row.number,
        surveyKind: source.kind,
      },
    });
    for (const question of questions) {
      const value = sanitizedResponse(
        row.getCell(question.column).value,
        question,
      );
      if (value === null) continue;
      const score =
        question.type === "likert" &&
        typeof value === "number" &&
        value >= 1 &&
        value <= 5
          ? value
          : null;
      responseBatch.push({
        id: deterministicUuid(`${respondentId}:response:${question.id}`),
        respondentId,
        questionId: question.id,
        value,
        score,
      });
      responseCount += 1;
    }
    if (
      respondentBatch.length >= 500 ||
      responseBatch.length >= responseBatchSize
    ) {
      await flush();
    }
  });
  await flush();
  return {
    organizations: organizationRows.size,
    questions: questions.length,
    respondents: respondentCount,
    responses: responseCount,
  };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!options.dryRun && !databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (options.skipIfPresent && !options.dryRun && databaseUrl) {
    const inspectionClient = new PrismaClient({
      adapter: new PrismaPg({ connectionString: databaseUrl }),
    });
    try {
      const existingProgramCount = await inspectionClient.program.count({
        where: { externalId: { startsWith: `${seedPrefix}-program-` } },
      });
      if (existingProgramCount > 0) {
        console.log(
          `Skipping Baton Rouge seed: found ${existingProgramCount} existing fixture program(s).`,
        );
        return;
      }
    } finally {
      await inspectionClient.$disconnect();
    }
  }
  const loadedSources = loadSourceWorkbooks(options.source);
  const sources = loadedSources.workbooks;
  const reportYears = [...new Set(sources.map(({ year }) => year))];
  const reportSource =
    extname(options.source).toLowerCase() === ".zip" &&
    options.reportSource === dirname(options.source)
      ? loadedSources.directory
      : options.reportSource;
  const publishedReports = await loadPublishedReports(
    reportSource,
    reportYears,
  );
  const actual = sources.map(
    ({ fileName, year, kind }) => `${year} ${kind} (${fileName})`,
  );
  console.log(`Baton Rouge source: ${options.source}`);
  console.log(`Published report source: ${reportSource}`);
  console.log(`Found ${sources.length} raw workbooks: ${actual.join(", ")}`);

  const prisma =
    options.dryRun || !databaseUrl
      ? null
      : new PrismaClient({
          adapter: new PrismaPg({ connectionString: databaseUrl }),
        });
  const projectId = deterministicUuid(`${seedPrefix}:project`);
  try {
    if (prisma) {
      console.log(
        "Replacing the previous Baton Rouge synthetic seed namespace...",
      );
      await clearPreviousSeed(prisma);
      await prisma.project.create({
        data: {
          id: projectId,
          externalId: `${seedPrefix}-project`,
          name: "Baton Rouge Best Places to Work",
          slug: "baton-rouge-best-places-to-work",
          metadata: { anonymized: true, seed: seedPrefix },
        },
      });
    }
    let totalRespondents = 0;
    let totalResponses = 0;
    const expectedStats = new Map<string, SurveyStats>();
    for (const source of sources) {
      const reports = publishedReports.get(source.year);
      if (!reports)
        throw new Error(`Published reports not loaded for ${source.year}`);
      const stats = await seedSurvey(prisma, source, projectId, reports);
      totalRespondents += stats.respondents;
      totalResponses += stats.responses;
      expectedStats.set(`${source.year}-${source.kind}`, stats);
      console.log(
        `${options.dryRun ? "Validated" : "Imported"} ${source.year} ${source.kind}: ` +
          `${stats.organizations} organizations, ${stats.questions} questions, ` +
          `${stats.respondents} respondents, ${stats.responses} responses`,
      );
    }
    if (prisma) {
      await createReportUser(prisma, projectId);
      await verifyImportedData(
        prisma,
        projectId,
        sources,
        expectedStats,
        publishedReports,
      );
    }
    console.log(
      `${options.dryRun ? "Dry run complete" : "Baton Rouge seed complete"}: ` +
        `${totalRespondents} respondents and ${totalResponses} responses.`,
    );
  } finally {
    await prisma?.$disconnect();
    loadedSources.cleanup();
  }
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
