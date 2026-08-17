import ExcelJS from "exceljs";
import { cellScalar } from "../imports/xlsx-survey-importer.js";

export interface PublishedReportHeader {
  title: string;
  type: string;
}

export interface BenefitsBestPracticesResponseSnapshot {
  dataValues: Array<number | string>;
  format: "number" | "percent";
  label: string;
}

export interface BenefitsBestPracticesQuestionSnapshot {
  responses: BenefitsBestPracticesResponseSnapshot[];
  text: string;
}

export interface BenefitsBestPracticesSectionSnapshot {
  questions: BenefitsBestPracticesQuestionSnapshot[];
  title: string;
}

export interface BenefitsBestPracticesSnapshot {
  headers: PublishedReportHeader[];
  sections: BenefitsBestPracticesSectionSnapshot[];
  sourceFile: string;
  uploadedAt?: string;
}

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
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

export function parsePublishedReportHeaders(
  worksheet: ExcelJS.Worksheet,
): PublishedReportHeader[] {
  return reportHeaders(worksheet, 6, 2);
}

function reportHeaders(
  worksheet: ExcelJS.Worksheet,
  rowNumber: number,
  startColumn: number,
): PublishedReportHeader[] {
  const labels = worksheet.getRow(rowNumber);
  const headers: PublishedReportHeader[] = [];
  for (let column = startColumn; column <= worksheet.columnCount; column += 1) {
    const title = String(cellScalar(labels.getCell(column).value) ?? "").trim();
    if (!title) break;
    const winner = /non-winners?$/iu.test(title) ? "No" : "Yes";
    const size = title
      .replace(/\s+non-winners?$/iu, "")
      .replace(/\s+winners?$/iu, "")
      .trim();
    headers.push({
      title: size === "All" ? "All Size Categories" : `${size} Employers`,
      type: `${size.replace(/\s+/gu, "")}_${winner}`,
    });
  }
  return headers;
}

export function parsePublishedReportValues(
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

function parseTemplateWorkbook(
  worksheet: ExcelJS.Worksheet,
  sourceFile: string,
): BenefitsBestPracticesSnapshot {
  const headers = reportHeaders(worksheet, 1, 2);
  if (headers.length === 0 || headers.some(({ type }) => type === "_Yes")) {
    throw new Error(`${sourceFile} does not contain report headers in row 1`);
  }
  const sectionTitle = String(
    cellScalar(worksheet.getRow(2).getCell(1).value) ?? "",
  ).trim();
  if (!sectionTitle) {
    throw new Error(`${sourceFile} does not contain a section title in row 2`);
  }
  const section: BenefitsBestPracticesSectionSnapshot = {
    questions: [],
    title: sectionTitle,
  };
  let question: BenefitsBestPracticesQuestionSnapshot | undefined;
  for (let rowNumber = 3; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const label = String(cellScalar(row.getCell(1).value) ?? "").trim();
    if (!label) continue;
    const hasNumbers = Array.from({ length: headers.length }, (_, index) =>
      cellScalar(row.getCell(index + 2).value),
    ).some((value) => typeof value === "number");
    if (!hasNumbers) {
      if (question?.text !== label) {
        question = { responses: [], text: label };
        section.questions.push(question);
      }
      continue;
    }
    if (!question) {
      throw new Error(`${sourceFile} has values before a question`);
    }
    const numFmt = row.getCell(2).numFmt as string | undefined;
    const percent = typeof numFmt === "string" && numFmt.includes("%");
    question.responses.push({
      dataValues: parsePublishedReportValues(
        row,
        headers.length,
        percent ? "percent" : "number",
      ),
      format: percent ? "percent" : "number",
      label,
    });
  }
  if (
    section.questions.length === 0 ||
    section.questions.every(({ responses }) => responses.length === 0)
  ) {
    throw new Error(`${sourceFile} does not contain benefits report data`);
  }
  return { headers, sections: [section], sourceFile };
}

export async function parseBenefitsBestPracticesWorkbook(
  buffer: Buffer,
  sourceFile: string,
): Promise<BenefitsBestPracticesSnapshot> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error(`${sourceFile} contains no worksheet`);
  const firstCell = String(
    cellScalar(worksheet.getRow(1).getCell(1).value) ?? "",
  ).trim();
  if (/^section\s*\/\s*question\s*\/\s*response$/iu.test(firstCell)) {
    return parseTemplateWorkbook(worksheet, sourceFile);
  }

  const headers = parsePublishedReportHeaders(worksheet);
  if (headers.length === 0 || headers.some(({ type }) => type === "_Yes")) {
    throw new Error(`${sourceFile} does not contain report headers in row 6`);
  }

  const sections: BenefitsBestPracticesSectionSnapshot[] = [];
  let section: BenefitsBestPracticesSectionSnapshot | undefined;
  let question: BenefitsBestPracticesQuestionSnapshot | undefined;
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
        if (!section) {
          throw new Error(`${sourceFile} has a question before a section`);
        }
        question = { responses: [], text: label };
        section.questions.push(question);
      }
      continue;
    }
    if (!section) throw new Error(`${sourceFile} has values before a section`);
    if (!question) {
      question = { responses: [], text: label };
      section.questions.push(question);
    }
    const percent = row.getCell(2).numFmt.includes("%");
    question.responses.push({
      dataValues: parsePublishedReportValues(
        row,
        headers.length,
        percent ? "percent" : "number",
      ),
      format: percent ? "percent" : "number",
      label,
    });
  }

  if (
    sections.length === 0 ||
    sections.every(({ questions }) => questions.length === 0)
  ) {
    throw new Error(`${sourceFile} does not contain benefits report data`);
  }
  return { headers, sections, sourceFile };
}

export function publishedBenefitsBestPracticesSnapshot(
  metadata: unknown,
): BenefitsBestPracticesSnapshot | null {
  const publishedReports = record(record(metadata).publishedReports);
  const candidate = record(publishedReports.benefitsBestPractices);
  return Array.isArray(candidate.headers) &&
    candidate.headers.length > 0 &&
    Array.isArray(candidate.sections) &&
    candidate.sections.length > 0 &&
    typeof candidate.sourceFile === "string"
    ? (candidate as unknown as BenefitsBestPracticesSnapshot)
    : null;
}

export function hasPublishedBenefitsBestPractices(metadata: unknown): boolean {
  return publishedBenefitsBestPracticesSnapshot(metadata) !== null;
}
