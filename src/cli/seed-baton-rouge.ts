import "dotenv/config";

import { createHash } from "node:crypto";
import {
  existsSync,
  mkdtempSync,
  readFileSync,
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
import {
  cellScalar,
  forEachXlsxSurveyRow,
  readXlsxSurveyDefinition,
  type XlsxQuestionDefinition,
} from "../modules/imports/xlsx-survey-importer.js";
import {
  parseBenefitsBestPracticesWorkbook,
  parsePublishedReportHeaders,
  parsePublishedReportValues,
  type BenefitsBestPracticesSnapshot,
  type PublishedReportHeader,
} from "../modules/reports/benefits-best-practices-workbook.js";
import {
  batonRougeRankingYear,
  loadBatonRougeWinnerStatuses,
  normalizeRankingOrganizationName,
  rankingWinnerStatus,
} from "./baton-rouge-rankings.js";
import { clearPreviousBatonRougeSeed } from "./baton-rouge-seed-cleanup.js";

const seedPrefix = "seed-br";
const defaultSource = resolve(process.cwd(), "..", "Baton Rouge 24-26.zip");
const defaultRankingSource = resolve(
  process.cwd(),
  "BR 2026 Ranking Data Extract.xlsx",
);
const responseBatchSize = 2_000;
const testUsername = "test.baton";
const testUserEmail = "test.baton@example.test";
const testUserPassword = "BatonRouge123!";
const targetOrganizationName = "Commerce Title & Abstract Company";
const sanitizedTargetOrganizationName = "Synthetic 06f796de0c9331b9";
let currentSeedStage = "startup";

function seedLog(
  message: string,
  details?: Record<string, number | string | boolean>,
): void {
  const rssMiB = Math.round(process.memoryUsage().rss / 1024 / 1024);
  const suffix = details ? ` ${JSON.stringify(details)}` : "";
  console.log(
    `[BR seed ${new Date().toISOString()}] ${message} (rss=${rssMiB}MiB)${suffix}`,
  );
}

function setSeedStage(
  stage: string,
  details?: Record<string, number | string | boolean>,
): void {
  currentSeedStage = stage;
  seedLog(`STAGE ${stage}`, details);
}

function seedErrorDetails(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { thrownValue: String(error) };
  const prismaError = error as Error & {
    clientVersion?: string;
    code?: string;
    meta?: unknown;
  };
  return {
    name: error.name,
    message: error.message,
    code: prismaError.code,
    clientVersion: prismaError.clientVersion,
    meta: prismaError.meta,
    stack: error.stack,
    cause: error.cause ? seedErrorDetails(error.cause) : undefined,
  };
}

function safeErrorJson(error: unknown): string {
  const seen = new WeakSet<object>();
  try {
    return JSON.stringify(
      seedErrorDetails(error),
      (_key, value: unknown) => {
        if (typeof value === "bigint") return value.toString();
        if (value && typeof value === "object") {
          if (seen.has(value)) return "[Circular]";
          seen.add(value);
        }
        return value;
      },
      2,
    );
  } catch (serializationError) {
    return JSON.stringify({
      error: String(error),
      serializationError: String(serializationError),
    });
  }
}

process.once("SIGTERM", () => {
  seedLog(`PROCESS received SIGTERM during stage ${currentSeedStage}.`, {
    exitCode: 143,
  });
  process.exit(143);
});

process.once("SIGINT", () => {
  seedLog(`PROCESS received SIGINT during stage ${currentSeedStage}.`, {
    exitCode: 130,
  });
  process.exit(130);
});
const standardOpenQuestionCaptions: Record<string, string> = {
  q_OpenEnded_1:
    "What are the top two or three reasons people like working for this organization?",
  q_OpenEnded_2:
    "What two or three things can this organization add or change to improve employee engagement and success?",
};

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
  rankingSource: string;
  reportSourceExplicit: boolean;
  reportSource: string;
  skipIfPresent: boolean;
  source: string;
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
  headers: PublishedReportHeader[];
  sourceFile: string;
  surveyAverage: Array<number | string>;
}

interface PublishedReports {
  benefitsBestPractices: BenefitsBestPracticesSnapshot;
  workforceBenchmark: WorkforceSnapshot;
}

type ParsedQuestion = XlsxQuestionDefinition;

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
  let rankingSource = process.env.BR_RANKING_SOURCE
    ? resolve(process.env.BR_RANKING_SOURCE)
    : defaultRankingSource;
  let skipIfPresent = false;
  let reportSourceExplicit = Boolean(process.env.BR_REPORT_SOURCE);
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
      if (!reportSourceExplicit) reportSource = dirname(source);
      index += 1;
      continue;
    }
    if (argument === "--report-source") {
      const value = argv[index + 1];
      if (!value) throw new Error("--report-source requires a directory path");
      reportSource = resolve(value);
      reportSourceExplicit = true;
      index += 1;
      continue;
    }
    if (argument === "--ranking-source") {
      const value = argv[index + 1];
      if (!value) throw new Error("--ranking-source requires an XLSX path");
      rankingSource = resolve(value);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument: ${argument}`);
  }
  return {
    dryRun,
    rankingSource,
    reportSource,
    reportSourceExplicit,
    skipIfPresent,
    source,
  };
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

async function parseWorkforceSnapshot(
  filePath: string,
): Promise<WorkforceSnapshot> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet)
    throw new Error(`${basename(filePath)} contains no worksheet`);
  const headers = parsePublishedReportHeaders(worksheet);
  const categories: WorkforceCategorySnapshot[] = [];
  let current: WorkforceCategorySnapshot | undefined;
  let surveyAverage: Array<number | string> = [];
  for (let rowNumber = 8; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const label = String(cellScalar(row.getCell(1).value) ?? "").trim();
    if (!label) continue;
    const values = parsePublishedReportValues(row, headers.length);
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
      benefitsBestPractices: await parseBenefitsBestPracticesWorkbook(
        readFileSync(join(reportSource, benefitsFile)),
        benefitsFile,
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

function isTargetOrganization(sourceName: string | undefined): boolean {
  return (
    sourceName === targetOrganizationName ||
    sourceName === sanitizedTargetOrganizationName
  );
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

const likertQuestionResponses = [
  { Id: 1, Caption: "Strongly Disagree" },
  { Id: 2, Caption: "Disagree" },
  { Id: 3, Caption: "Neutral" },
  { Id: 4, Caption: "Agree" },
  { Id: 5, Caption: "Strongly Agree" },
  { Id: 6, Caption: "N/A" },
];

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
  winnerStatuses: Map<string, boolean>,
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
    select: { id: true, year: true, metadata: true },
  });
  for (const program of programs) {
    if (program.year === null) continue;
    const expected = reportsByYear.get(program.year);
    const metadata = program.metadata;
    const stored =
      metadata && typeof metadata === "object" && !Array.isArray(metadata)
        ? metadata.publishedReports
        : undefined;
    const expectedProgramReports = expected
      ? { workforceBenchmark: expected.workforceBenchmark }
      : undefined;
    if (
      !expected ||
      canonicalJson(stored) !== canonicalJson(expectedProgramReports)
    ) {
      throw new Error(
        `${program.year} workforce workbook snapshot did not round-trip through PostgreSQL`,
      );
    }
    const enrollments = await prisma.organizationProgram.findMany({
      where: { programId: program.id },
      select: {
        isWinner: true,
        metadata: true,
        organization: { select: { name: true } },
      },
    });
    const expectedEnrollmentReports = {
      benefitsBestPractices: expected.benefitsBestPractices,
    };
    if (
      enrollments.length === 0 ||
      enrollments.some((enrollment) => {
        const enrollmentMetadata = enrollment.metadata;
        const enrollmentReports =
          enrollmentMetadata &&
          typeof enrollmentMetadata === "object" &&
          !Array.isArray(enrollmentMetadata)
            ? enrollmentMetadata.publishedReports
            : undefined;
        return (
          canonicalJson(enrollmentReports) !==
          canonicalJson(expectedEnrollmentReports)
        );
      })
    ) {
      throw new Error(
        `${program.year} organization benefits workbook snapshots did not round-trip through PostgreSQL`,
      );
    }
    if (
      program.year === batonRougeRankingYear &&
      enrollments.some((enrollment) => {
        const expectedWinner = winnerStatuses.get(
          normalizeRankingOrganizationName(enrollment.organization.name),
        );
        return (
          expectedWinner !== undefined && enrollment.isWinner !== expectedWinner
        );
      })
    ) {
      throw new Error(
        `${program.year} organization winner assignments did not match the ranking workbook`,
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
  winnerStatuses: Map<string, boolean>,
): Promise<SurveyStats> {
  const surveyLabel = `${source.year} ${source.kind}`;
  const surveyId = deterministicUuid(
    `${seedPrefix}:survey:${source.year}:${source.kind}`,
  );
  const programId = deterministicUuid(`${seedPrefix}:program:${source.year}`);
  seedLog(`${surveyLabel}: reading workbook definition...`, {
    file: source.fileName,
  });
  const definition = await readXlsxSurveyDefinition({
    fileName: source.fileName,
    filePath: source.filePath,
    questionId: (dataLabel) =>
      deterministicUuid(`${surveyId}:question:${dataLabel}`),
  });
  const questions: ParsedQuestion[] = definition.questions;
  seedLog(`${surveyLabel}: workbook definition loaded.`, {
    questions: questions.length,
  });
  for (const question of questions) {
    question.caption =
      standardOpenQuestionCaptions[question.dataLabel] ?? question.caption;
  }
  if (source.kind === "EFS") {
    const publishedQuestions = reports.workforceBenchmark.categories.flatMap(
      (category) =>
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
  let respondentCount = 0;
  const organizationRows = new Map<string, OrganizationSourceDetails>();
  seedLog(`${surveyLabel}: scanning source rows...`);
  await forEachXlsxSurveyRow(
    definition,
    { includeOrganization: isTargetOrganization },
    (row) => {
      respondentCount += 1;
      const key = organizationKey(
        targetOrganizationName,
        source.year,
        row.rowNumber,
        row.organizationId,
      );
      let existing = organizationRows.get(key);
      if (!existing) {
        existing = {
          count: 0,
          sourceOrganizationName: targetOrganizationName,
        };
        if (row.organizationId) {
          existing.sourceOrganizationId = row.organizationId;
        }
      }
      existing.count += 1;
      if (row.companySize !== undefined) existing.size = row.companySize;
      organizationRows.set(key, existing);
    },
  );
  if (organizationRows.size === 0) {
    throw new Error(
      `${source.fileName}: no rows found for organization "${targetOrganizationName}"`,
    );
  }
  seedLog(`${surveyLabel}: source row scan complete.`, {
    organizations: organizationRows.size,
    respondents: respondentCount,
  });

  if (prisma) {
    seedLog(`${surveyLabel}: upserting program...`);
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
            JSON.stringify({
              workforceBenchmark: reports.workforceBenchmark,
            }),
          ) as Prisma.InputJsonValue,
          seed: seedPrefix,
        },
      },
    });
    seedLog(`${surveyLabel}: creating survey...`);
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
    seedLog(`${surveyLabel}: upserting organizations...`, {
      organizations: organizationRows.size,
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
    seedLog(`${surveyLabel}: upserting program enrollments...`, {
      organizations: organizationRows.size,
    });
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
      const isWinner = rankingWinnerStatus(
        source.year,
        details.sourceOrganizationName ?? organization.name,
        winnerStatuses,
      );
      await prisma.organizationProgram.upsert({
        where: {
          organizationId_programId: {
            organizationId: organization.id,
            programId,
          },
        },
        update: {
          isWinner,
          metadata: {
            publishedReports: JSON.parse(
              JSON.stringify({
                benefitsBestPractices: reports.benefitsBestPractices,
              }),
            ) as Prisma.InputJsonValue,
          },
          ...(source.kind === "EFS"
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
            : {}),
        },
        create: {
          organizationId: organization.id,
          projectId,
          programId,
          externalId: `${seedPrefix}-enrollment-${source.year}-${digest(key, 12)}`,
          stage: "Active",
          isWinner,
          metadata: {
            publishedReports: JSON.parse(
              JSON.stringify({
                benefitsBestPractices: reports.benefitsBestPractices,
              }),
            ) as Prisma.InputJsonValue,
          },
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
    seedLog(`${surveyLabel}: inserting questions...`, {
      questions: questions.length,
    });
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
          reportRole: questionReportRole(question.type),
          anonymized: true,
          ...(question.type === "likert"
            ? { QuestionResponses: likertQuestionResponses }
            : {}),
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
    seedLog(`${surveyLabel}: survey structure created.`);
  }

  let responseCount = 0;
  let persistedRespondentCount = 0;
  let persistedResponseCount = 0;
  let flushCount = 0;
  const respondentBatch: Prisma.RespondentCreateManyInput[] = [];
  const responseBatch: Prisma.ResponseCreateManyInput[] = [];
  const flush = async (): Promise<void> => {
    if (!prisma) {
      respondentBatch.length = 0;
      responseBatch.length = 0;
      return;
    }
    if (respondentBatch.length === 0 && responseBatch.length === 0) return;
    const respondentsInBatch = respondentBatch.length;
    const responsesInBatch = responseBatch.length;
    flushCount += 1;
    seedLog(`${surveyLabel}: writing database batch ${flushCount}...`, {
      respondentsInBatch,
      responsesInBatch,
    });
    if (respondentBatch.length > 0) {
      await prisma.respondent.createMany({ data: respondentBatch });
      persistedRespondentCount += respondentBatch.length;
      respondentBatch.length = 0;
    }
    if (responseBatch.length > 0) {
      await insertBatches(responseBatch, (data) =>
        prisma.response.createMany({ data }),
      );
      persistedResponseCount += responseBatch.length;
      responseBatch.length = 0;
    }
    seedLog(`${surveyLabel}: database batch ${flushCount} complete.`, {
      persistedRespondents: persistedRespondentCount,
      persistedResponses: persistedResponseCount,
    });
  };

  seedLog(`${surveyLabel}: parsing rows and inserting responses...`);
  await forEachXlsxSurveyRow(
    definition,
    { includeOrganization: isTargetOrganization },
    async (row) => {
      const organization = sourceOrganization(
        organizationKey(
          targetOrganizationName,
          source.year,
          row.rowNumber,
          row.organizationId,
        ),
        targetOrganizationName,
      );
      const respondentToken = digest(
        `${source.year}:${source.kind}:${String(row.respondent ?? row.rowNumber)}`,
        32,
      );
      const respondentId = deterministicUuid(
        `${surveyId}:respondent:${respondentToken}`,
      );
      respondentBatch.push({
        id: respondentId,
        externalId: `${seedPrefix}-respondent-${respondentToken}`,
        surveyId,
        organizationId: organization.id,
        status: row.completed ? "COMPLETED" : "INCOMPLETE",
        locale: row.language,
        respondentHash: digest(`respondent:${respondentToken}`, 64),
        completedAt: row.completed
          ? (row.completedAt ?? new Date(`${source.year}-06-30T12:00:00.000Z`))
          : null,
        metadata: {
          anonymized: true,
          seed: seedPrefix,
          sourceRow: row.rowNumber,
          surveyKind: source.kind,
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
        responseCount += 1;
      }
      if (
        respondentBatch.length >= 500 ||
        responseBatch.length >= responseBatchSize
      ) {
        await flush();
      }
    },
  );
  await flush();
  seedLog(`${surveyLabel}: workbook import complete.`, {
    respondents: respondentCount,
    responses: responseCount,
  });
  return {
    organizations: organizationRows.size,
    questions: questions.length,
    respondents: respondentCount,
    responses: responseCount,
  };
}

async function main(): Promise<void> {
  setSeedStage("parse-options");
  const options = parseOptions(process.argv.slice(2));
  const databaseUrl = process.env.DATABASE_URL;
  if (!options.dryRun && !databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  if (options.skipIfPresent && !options.dryRun && databaseUrl) {
    setSeedStage("inspect-existing-seed");
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
  setSeedStage("load-source-workbooks");
  const loadedSources = loadSourceWorkbooks(options.source);
  setSeedStage("load-ranking-data");
  const winnerStatuses = await loadBatonRougeWinnerStatuses(
    options.rankingSource,
  );
  const sources = loadedSources.workbooks;
  const reportYears = [...new Set(sources.map(({ year }) => year))];
  let reportSource =
    extname(options.source).toLowerCase() === ".zip" &&
    !options.reportSourceExplicit
      ? loadedSources.directory
      : options.reportSource;
  let publishedReports: Map<number, PublishedReports>;
  try {
    setSeedStage("load-published-reports", { source: reportSource });
    publishedReports = await loadPublishedReports(reportSource, reportYears);
  } catch (error) {
    const canFallBackBesideArchive =
      reportSource === loadedSources.directory &&
      reportSource !== options.reportSource &&
      error instanceof Error &&
      error.message.startsWith(
        "Published Baton Rouge report workbooks are missing",
      );
    if (!canFallBackBesideArchive) {
      loadedSources.cleanup();
      throw error;
    }
    reportSource = options.reportSource;
    try {
      setSeedStage("load-published-reports-fallback", {
        source: reportSource,
      });
      publishedReports = await loadPublishedReports(reportSource, reportYears);
    } catch (fallbackError) {
      loadedSources.cleanup();
      throw fallbackError;
    }
  }
  const actual = sources.map(
    ({ fileName, year, kind }) => `${year} ${kind} (${fileName})`,
  );
  console.log(`Baton Rouge source: ${options.source}`);
  console.log(
    `2026 ranking source: ${options.rankingSource} (${winnerStatuses.size} valid assignments)`,
  );
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
      setSeedStage("cleanup-previous-seed");
      await clearPreviousBatonRougeSeed(prisma, seedLog);
      setSeedStage("create-project");
      await prisma.project.create({
        data: {
          id: projectId,
          externalId: `${seedPrefix}-project`,
          name: "Baton Rouge Best Places to Work",
          slug: "baton-rouge-best-places-to-work",
          metadata: { anonymized: true, seed: seedPrefix },
        },
      });
      seedLog("Seed project created.", { projectId });
    }
    let totalRespondents = 0;
    let totalResponses = 0;
    const expectedStats = new Map<string, SurveyStats>();
    for (const source of sources) {
      setSeedStage(`import-${source.year}-${source.kind.toLowerCase()}`, {
        file: source.fileName,
      });
      const reports = publishedReports.get(source.year);
      if (!reports)
        throw new Error(`Published reports not loaded for ${source.year}`);
      const stats = await seedSurvey(
        prisma,
        source,
        projectId,
        reports,
        winnerStatuses,
      );
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
      setSeedStage("create-report-user");
      await createReportUser(prisma, projectId);
      setSeedStage("verify-imported-data");
      await verifyImportedData(
        prisma,
        projectId,
        sources,
        expectedStats,
        publishedReports,
        winnerStatuses,
      );
    }
    setSeedStage("complete");
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
  console.error(
    `[BR seed ${new Date().toISOString()}] FATAL during stage ${currentSeedStage}:`,
    safeErrorJson(error),
  );
  process.exitCode = 1;
});
