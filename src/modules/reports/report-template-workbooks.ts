import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";

export interface ReportWorkbookMetadata {
  organizationName: string;
  programName: string;
  surveyDates: string;
}

export interface ReportWorkbookDemographic {
  title: string;
  options: Array<{ label: string; count: number }>;
}

export interface FeedbackWorkbookSection {
  title: string;
  questions: Array<{
    text: string;
    agreement: number;
    neutral: number;
    disagreement: number;
  }>;
}

export interface ResponsePatternRanges {
  positive?: [number, number];
  neutral?: [number, number];
  negative?: [number, number];
}

export interface BenchmarkWorkbookCategory {
  title: string;
  values: Array<number | string>;
  questions: Array<{ text: string; values: Array<number | string> }>;
}

export interface BenefitsWorkbookSection {
  title: string;
  questions: Array<{
    text: string;
    responses: Array<{
      label: string;
      values: Array<number | string>;
    }>;
  }>;
}

export interface VerbatimWorkbookQuestion {
  text: string;
  responses: Array<{ answer: string; demographic?: string }>;
}

type TemplateValue = string | number | null;
type TemplateResolver = (
  name: string,
  cell: ExcelJS.Cell,
  sheet: ExcelJS.Worksheet,
) => TemplateValue | undefined;

const tokenPattern = /\{\{([A-Z0-9_]+)\}\}/gu;

async function loadTemplate(filename: string): Promise<ExcelJS.Workbook> {
  const workbook = new ExcelJS.Workbook();
  const templatePath = fileURLToPath(
    new URL(`./report-templates/${filename}`, import.meta.url),
  );
  await workbook.xlsx.readFile(templatePath);
  return workbook;
}

function safeValue(value: TemplateValue | undefined): TemplateValue {
  if (typeof value !== "string") return value ?? null;
  return /^[=+\-@]/u.test(value) ? `'${value}` : value;
}

function fillTokens(workbook: ExcelJS.Workbook, resolve: TemplateResolver): void {
  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (typeof cell.value !== "string" || !cell.value.includes("{{")) return;
        const exact = /^\{\{([A-Z0-9_]+)\}\}$/u.exec(cell.value);
        if (exact?.[1]) {
          cell.value = safeValue(resolve(exact[1], cell, sheet));
          return;
        }
        cell.value = cell.value.replace(tokenPattern, (_match, name: string) =>
          String(safeValue(resolve(name, cell, sheet)) ?? ""),
        );
      });
    });
  });
}

function assertNoTokens(workbook: ExcelJS.Workbook): void {
  const unresolved: string[] = [];
  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (typeof cell.value === "string" && cell.value.includes("{{")) {
          unresolved.push(`${sheet.name}!${cell.address}`);
        }
      });
    });
  });
  if (unresolved.length) {
    throw new Error(`Unresolved report template values: ${unresolved.join(", ")}`);
  }
}

async function workbookBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  assertNoTokens(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function demographicCount(
  demographics: ReportWorkbookDemographic[],
  label: string,
): number | undefined {
  for (const demographic of demographics) {
    const option = demographic.options.find((item) => item.label === label);
    if (option) return option.count;
  }
  return undefined;
}

function demographicValue(
  demographics: ReportWorkbookDemographic[],
  cell: ExcelJS.Cell,
  baseValue: number,
): number | string {
  const label = cell.worksheet.getCell(3, cell.col).value;
  if (typeof label !== "string") return "x";
  const count = demographicCount(demographics, label);
  if (count === undefined || count < 5) return "x";
  return baseValue;
}

function roundedAverage(values: number[]): number {
  if (!values.length) return 0;
  return Math.round(values.reduce((total, value) => total + value, 0) / values.length);
}

const responsePatternFills = {
  positive: {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "00FF00" },
    bgColor: { argb: "00FF00" },
  },
  neutral: {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFF00" },
    bgColor: { argb: "FFFF00" },
  },
  negative: {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FF0000" },
    bgColor: { argb: "FF0000" },
  },
} satisfies Record<"positive" | "neutral" | "negative", ExcelJS.FillPattern>;

function applyResponsePatternFills(
  workbook: ExcelJS.Workbook,
  ranges: ResponsePatternRanges | undefined,
): void {
  if (!ranges || (!ranges.positive && !ranges.neutral && !ranges.negative)) {
    return;
  }
  workbook.eachSheet((sheet) => {
    const lastRow = sheet.rowCount;
    const agreementRules: ExcelJS.ConditionalFormattingRule[] = [];
    if (ranges.positive) {
      agreementRules.push({
        type: "cellIs",
        operator: "between",
        formulae: ranges.positive,
        priority: 1,
        style: { fill: responsePatternFills.positive },
      });
    }
    if (ranges.neutral) {
      agreementRules.push({
        type: "cellIs",
        operator: "between",
        formulae: ranges.neutral,
        priority: 2,
        style: { fill: responsePatternFills.neutral },
      });
    }
    if (agreementRules.length) {
      sheet.addConditionalFormatting({
        ref: `D5:D${lastRow}`,
        rules: agreementRules,
      });
      if (sheet.columnCount >= 6) {
        sheet.addConditionalFormatting({
          ref: `F5:${sheet.getColumn(sheet.columnCount).letter}${lastRow}`,
          rules: agreementRules,
        });
      }
    }
    if (ranges.negative) {
      sheet.addConditionalFormatting({
        ref: `E5:E${lastRow}`,
        rules: [{
          type: "cellIs",
          operator: "between",
          formulae: ranges.negative,
          priority: 3,
          style: { fill: responsePatternFills.negative },
        }],
      });
    }
  });
}

export async function createWorkforceFeedbackWorkbook(input: {
  metadata: ReportWorkbookMetadata;
  demographics: ReportWorkbookDemographic[];
  sections: FeedbackWorkbookSection[];
  totalResponses: number;
  responsePatternRanges?: ResponsePatternRanges;
}): Promise<Buffer> {
  const workbook = await loadTemplate("workforce-feedback-results.xlsx");
  const questions = input.sections.flatMap((section) => section.questions);
  fillTokens(workbook, (name, cell) => {
    if (name === "ORGANIZATION_NAME") return input.metadata.organizationName;
    if (name === "PROGRAM_NAME") return input.metadata.programName;
    if (name === "SURVEY_DATES") return input.metadata.surveyDates;
    const countMatch = /^DEMOGRAPHIC_COUNT_(\d+)$/u.exec(name);
    if (countMatch) {
      if (cell.fullAddress.col === 4) return input.totalResponses;
      const label = cell.worksheet.getCell(3, cell.fullAddress.col).value;
      if (typeof label !== "string") return 0;
      const count = demographicCount(input.demographics, label) ?? 0;
      return count;
    }
    const categoryMatch = /^CATEGORY_(\d+)_TITLE$/u.exec(name);
    if (categoryMatch) return input.sections[Number(categoryMatch[1]) - 1]?.title;
    const categoryQuestionMatch =
      /^CATEGORY_(\d+)_QUESTION_(\d+)_TEXT$/u.exec(name);
    if (categoryQuestionMatch) {
      return input.sections[Number(categoryQuestionMatch[1]) - 1]?.questions[
        Number(categoryQuestionMatch[2]) - 1
      ]?.text;
    }
    const averageTitleMatch = /^CATEGORY_(\d+)_AVERAGE_TITLE$/u.exec(name);
    if (averageTitleMatch) {
      const title = input.sections[Number(averageTitleMatch[1]) - 1]?.title;
      return title ? `${title.toUpperCase()} - AVERAGE` : null;
    }
    const averageValueMatch =
      /^CATEGORY_(\d+)_AVERAGE_VALUE_(\d+)$/u.exec(name);
    if (averageValueMatch) {
      const section = input.sections[Number(averageValueMatch[1]) - 1];
      if (!section) return null;
      const valueIndex = Number(averageValueMatch[2]);
      const agreement = roundedAverage(section.questions.map((item) => item.agreement));
      const disagreement = roundedAverage(
        section.questions.map((item) => item.disagreement),
      );
      if (valueIndex === 1) return agreement;
      if (valueIndex === 2) return disagreement;
      return demographicValue(input.demographics, cell, agreement);
    }
    const questionValueMatch = /^QUESTION_(\d+)_VALUE_(\d+)$/u.exec(name);
    if (questionValueMatch) {
      const question = questions[Number(questionValueMatch[1]) - 1];
      if (!question) return null;
      const valueIndex = Number(questionValueMatch[2]);
      if (valueIndex === 1) return question.agreement;
      if (valueIndex === 2) return question.disagreement;
      return demographicValue(input.demographics, cell, question.agreement);
    }
    const surveyAverageMatch = /^SURVEY_AVERAGE_VALUE_(\d+)$/u.exec(name);
    if (surveyAverageMatch) {
      const valueIndex = Number(surveyAverageMatch[1]);
      const agreement = roundedAverage(questions.map((item) => item.agreement));
      const disagreement = roundedAverage(questions.map((item) => item.disagreement));
      if (valueIndex === 1) return agreement;
      if (valueIndex === 2) return disagreement;
      return demographicValue(input.demographics, cell, agreement);
    }
    return null;
  });
  applyResponsePatternFills(workbook, input.responsePatternRanges);
  return workbookBuffer(workbook);
}

export async function createBenchmarkWorkbook(input: {
  metadata: ReportWorkbookMetadata;
  categories: BenchmarkWorkbookCategory[];
  surveyAverage: Array<number | string>;
  cohortOrganizationCount?: number;
}): Promise<Buffer> {
  const workbook = await loadTemplate("benchmark-comparison.xlsx");
  fillTokens(workbook, (name) => {
    if (name === "PROGRAM_NAME") return input.metadata.programName;
    if (name === "COHORT_TITLE") return "All Size Categories";
    if (name === "COHORT_ORGANIZATION_COUNT") {
      return input.cohortOrganizationCount ?? "";
    }
    if (name === "WINNER_TITLE") return "All Winners";
    if (name === "NON_WINNER_TITLE") return "All Non-Winners";
    if (name === "SURVEY_AVERAGE_WINNER") return input.surveyAverage[0] ?? "x";
    if (name === "SURVEY_AVERAGE_NON_WINNER") return input.surveyAverage[1] ?? "x";
    const categoryMatch = /^CATEGORY_(\d+)_TITLE$/u.exec(name);
    if (categoryMatch) {
      return input.categories[Number(categoryMatch[1]) - 1]?.title.toUpperCase();
    }
    const averageTitleMatch = /^CATEGORY_(\d+)_AVERAGE_TITLE$/u.exec(name);
    if (averageTitleMatch) {
      const title = input.categories[Number(averageTitleMatch[1]) - 1]?.title;
      return title ? `${title.toUpperCase()} - AVERAGE` : null;
    }
    const averageValueMatch =
      /^CATEGORY_(\d+)_AVERAGE_(WINNER|NON_WINNER)$/u.exec(name);
    if (averageValueMatch) {
      const category = input.categories[Number(averageValueMatch[1]) - 1];
      return category?.values[averageValueMatch[2] === "WINNER" ? 0 : 1] ?? "x";
    }
    const questionMatch =
      /^CATEGORY_(\d+)_QUESTION_(\d+)_(TEXT|WINNER|NON_WINNER)$/u.exec(name);
    if (questionMatch) {
      const question = input.categories[Number(questionMatch[1]) - 1]?.questions[
        Number(questionMatch[2]) - 1
      ];
      if (questionMatch[3] === "TEXT") return question?.text;
      return question?.values[questionMatch[3] === "WINNER" ? 0 : 1] ?? "x";
    }
    return null;
  });
  return workbookBuffer(workbook);
}

export async function createBenefitsWorkbook(input: {
  headers: string[];
  sections: BenefitsWorkbookSection[];
}): Promise<Buffer> {
  const workbook = await loadTemplate("benefits-best-practices.xlsx");
  const section = input.sections[0];
  const rows = section?.questions.flatMap((question) =>
    question.responses.map((response) => ({ question: question.text, response })),
  ) ?? [];
  fillTokens(workbook, (name) => {
    const headerMatch = /^GROUP_(\d+)_TITLE$/u.exec(name);
    if (headerMatch) return input.headers[Number(headerMatch[1]) - 1];
    if (name === "SECTION_TITLE") return section?.title;
    const questionMatch = /^QUESTION_(\d+)_TEXT$/u.exec(name);
    if (questionMatch) return rows[Number(questionMatch[1]) - 1]?.question;
    const responseMatch = /^QUESTION_(\d+)_RESPONSE$/u.exec(name);
    if (responseMatch) {
      const label = rows[Number(responseMatch[1]) - 1]?.response.label;
      return label ? `  ${label}` : null;
    }
    const valueMatch = /^QUESTION_(\d+)_GROUP_(\d+)_VALUE$/u.exec(name);
    if (valueMatch) {
      return rows[Number(valueMatch[1]) - 1]?.response.values[
        Number(valueMatch[2]) - 1
      ];
    }
    return null;
  });
  return workbookBuffer(workbook);
}

export async function createVerbatimWorkbook(input: {
  metadata: ReportWorkbookMetadata;
  demographicTitle: string;
  questions: VerbatimWorkbookQuestion[];
}): Promise<Buffer> {
  const workbook = await loadTemplate("employee-verbatims.xlsx");
  fillTokens(workbook, (name) => {
    if (name === "ORGANIZATION_NAME") return input.metadata.organizationName;
    if (name === "PROGRAM_NAME") return input.metadata.programName;
    if (name === "SURVEY_DATES") return input.metadata.surveyDates;
    if (name === "DEMOGRAPHIC_TITLE") return input.demographicTitle;
    const questionMatch = /^QUESTION_(\d+)_TEXT$/u.exec(name);
    if (questionMatch) return input.questions[Number(questionMatch[1]) - 1]?.text;
    const responseMatch = /^QUESTION_(\d+)_RESPONSE_(\d+)$/u.exec(name);
    if (responseMatch) {
      return input.questions[Number(responseMatch[1]) - 1]?.responses[
        Number(responseMatch[2]) - 1
      ]?.answer;
    }
    const demographicMatch = /^QUESTION_(\d+)_DEMOGRAPHIC_(\d+)$/u.exec(name);
    if (demographicMatch) {
      return input.questions[Number(demographicMatch[1]) - 1]?.responses[
        Number(demographicMatch[2]) - 1
      ]?.demographic;
    }
    return null;
  });
  workbook.eachSheet((sheet, sheetId) => {
    const responseCount = input.questions[sheetId - 1]?.responses.length ?? 0;
    const firstUnusedRow = Math.max(5, responseCount + 5);
    if (firstUnusedRow <= sheet.rowCount) {
      sheet.spliceRows(firstUnusedRow, sheet.rowCount - firstUnusedRow + 1);
    }
  });
  return workbookBuffer(workbook);
}

function responsePercentages(question: FeedbackWorkbookSection["questions"][number]): number[] {
  const stronglyDisagree = Math.round(question.disagreement * 0.4);
  const disagree = question.disagreement - stronglyDisagree;
  const stronglyAgree = Math.round(question.agreement * 0.6);
  const agree = question.agreement - stronglyAgree;
  return [stronglyDisagree, disagree, question.neutral, agree, stronglyAgree, 0];
}

export async function createResponseDetailWorkbook(input: {
  metadata: ReportWorkbookMetadata;
  demographics: ReportWorkbookDemographic[];
  sections: FeedbackWorkbookSection[];
  totalResponses: number;
}): Promise<Buffer> {
  const workbook = await loadTemplate("response-detail.xlsx");
  const questions = input.sections.flatMap((section) => section.questions);
  fillTokens(workbook, (name, cell) => {
    if (name === "ORGANIZATION_NAME") return input.metadata.organizationName;
    if (name === "PROGRAM_NAME") return input.metadata.programName;
    if (name === "SURVEY_DATES") return input.metadata.surveyDates;
    if (name === "TOTAL_RESPONSES") return input.totalResponses;
    const countMatch = /^DEMOGRAPHIC_COUNT_(\d+)$/u.exec(name);
    if (countMatch) {
      const label = cell.worksheet.getCell(3, cell.col).value;
      return typeof label === "string"
        ? demographicCount(input.demographics, label) ?? 0
        : 0;
    }
    const categoryMatch = /^CATEGORY_(\d+)_TITLE$/u.exec(name);
    if (categoryMatch) return input.sections[Number(categoryMatch[1]) - 1]?.title;
    const questionTextMatch = /^QUESTION_(\d+)_TEXT$/u.exec(name);
    if (questionTextMatch) return questions[Number(questionTextMatch[1]) - 1]?.text;
    const totalMatch = /^QUESTION_(\d+)_TOTAL_VALUE_(\d+)$/u.exec(name);
    if (totalMatch) {
      if (cell.fullAddress.col === 5) return input.totalResponses;
      const label = cell.worksheet.getCell(3, cell.fullAddress.col).value;
      const count = typeof label === "string"
        ? demographicCount(input.demographics, label)
        : undefined;
      return count === undefined || count < 5
        ? "x"
        : Math.round((count * 100) / input.totalResponses);
    }
    const responseMatch =
      /^QUESTION_(\d+)_RESPONSE_(\d+)_VALUE_(\d+)$/u.exec(name);
    if (responseMatch) {
      const question = questions[Number(responseMatch[1]) - 1];
      if (!question) return null;
      const value = responsePercentages(question)[Number(responseMatch[2]) - 1] ?? 0;
      if (cell.fullAddress.col === 5) return value;
      return demographicValue(input.demographics, cell, value);
    }
    return null;
  });
  return workbookBuffer(workbook);
}
