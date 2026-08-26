import ExcelJS from "exceljs";
import { fileURLToPath } from "node:url";

export interface ReportWorkbookMetadata {
  organizationName: string;
  programName: string;
  surveyDates: string;
}

export interface ReportWorkbookDemographic {
  title: string;
  groupLabel: string;
  options: Array<{ label: string; count: number }>;
}

export interface FeedbackWorkbookSection {
  title: string;
  questions: Array<{
    text: string;
    agreement: number;
    neutral: number;
    disagreement: number;
    responseCount?: number;
    demographicAgreement?: Record<string, Record<string, number>>;
    demographicResponseCount?: Record<string, Record<string, number>>;
    responseDistribution?: number[];
    demographicResponseDistribution?: Record<
      string,
      Record<string, number[]>
    >;
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

export interface AnnualTrendsWorkbookValue {
  agreement: number;
  disagreement: number;
  responseCount: number;
}

export interface AnnualTrendsWorkbookSection {
  title: string;
  questions: Array<{
    text: string;
    current?: AnnualTrendsWorkbookValue;
    previous?: AnnualTrendsWorkbookValue;
  }>;
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

function fillTokens(
  workbook: ExcelJS.Workbook,
  resolve: TemplateResolver,
): void {
  workbook.eachSheet((sheet) => {
    sheet.eachRow({ includeEmpty: true }, (row) => {
      row.eachCell({ includeEmpty: true }, (cell) => {
        if (typeof cell.value !== "string" || !cell.value.includes("{{"))
          return;
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
    throw new Error(
      `Unresolved report template values: ${unresolved.join(", ")}`,
    );
  }
}

async function workbookBuffer(workbook: ExcelJS.Workbook): Promise<Buffer> {
  assertNoTokens(workbook);
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function demographicCount(
  demographics: ReportWorkbookDemographic[],
  label: string,
  groupLabel?: string,
): number | undefined {
  const normalizedGroupLabel = groupLabel?.trim().toLowerCase();
  for (const demographic of demographics) {
    if (
      normalizedGroupLabel &&
      demographic.groupLabel.trim().toLowerCase() !== normalizedGroupLabel
    ) {
      continue;
    }
    const option = demographic.options.find((item) => item.label === label);
    if (option) return option.count;
  }
  return undefined;
}

function demographicGroupLabel(cell: ExcelJS.Cell): string | undefined {
  const value = cell.worksheet.getCell(2, cell.col).value;
  return typeof value === "string" ? value : undefined;
}

function normalizedDemographicLabel(value: unknown): string {
  return typeof value === "string"
    ? value.toLowerCase().replace(/[^a-z0-9]+/gu, "")
    : "";
}

function columnNumber(address: string): number {
  let result = 0;
  for (const character of address) {
    result = result * 26 + character.charCodeAt(0) - 64;
  }
  return result;
}

function columnName(column: number): string {
  let value = column;
  let result = "";
  while (value > 0) {
    value -= 1;
    result = String.fromCharCode(65 + (value % 26)) + result;
    value = Math.floor(value / 26);
  }
  return result;
}

function mappedResponseDetailMerge(
  merge: string,
  selectedStart: number,
  selectedEnd: number,
): string | undefined {
  const match = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/u.exec(merge);
  if (!match?.[1] || !match[2] || !match[3] || !match[4]) return undefined;
  const left = columnNumber(match[1]);
  const right = columnNumber(match[3]);
  const mapColumn = (column: number): number | undefined => {
    if (column <= 5) return column;
    if (column >= selectedStart - 1 && column <= selectedEnd) {
      return column - selectedStart + 7;
    }
    return undefined;
  };
  let mappedLeft: number | undefined;
  let mappedRight: number | undefined;
  for (let column = left; column <= right; column += 1) {
    const mapped = mapColumn(column);
    if (mapped === undefined) continue;
    mappedLeft ??= mapped;
    mappedRight = mapped;
  }
  if (mappedLeft === undefined || mappedRight === undefined) return undefined;
  return `${columnName(mappedLeft)}${match[2]}:${columnName(mappedRight)}${match[4]}`;
}

export function filterResponseDetailColumns(
  workbook: ExcelJS.Workbook,
  selectedGroupLabel: string,
): void {
  const sheet = workbook.worksheets[0];
  if (!sheet) throw new Error("Response detail template has no worksheet");
  const selected = normalizedDemographicLabel(selectedGroupLabel);
  let start = 0;
  let end = 0;
  for (let column = 7; column <= sheet.columnCount; column += 1) {
    const group = normalizedDemographicLabel(sheet.getCell(2, column).value);
    if (group === selected) {
      if (start === 0) start = column;
      end = column;
    } else if (start !== 0) {
      break;
    }
  }
  if (start === 0 || end === 0) {
    throw new Error(
      `Selected response detail filter is not present in the report template: ${selectedGroupLabel}`,
    );
  }
  const mappedMerges = sheet.model.merges.flatMap((merge) => {
    const mapped = mappedResponseDetailMerge(merge, start, end);
    return mapped ? [mapped] : [];
  });
  for (const merge of [...sheet.model.merges]) sheet.unMergeCells(merge);
  if (end < sheet.columnCount) {
    sheet.spliceColumns(end + 1, sheet.columnCount - end);
  }
  if (start > 7) {
    sheet.spliceColumns(6, start - 7);
  }
  for (const merge of mappedMerges) sheet.mergeCells(merge);
}

function subgroupAgreement(
  demographicAgreement: Record<string, Record<string, number>> | undefined,
  groupLabel: string | undefined,
  label: string,
): number | undefined {
  if (!demographicAgreement || !groupLabel) return undefined;
  const normalizedGroupLabel = groupLabel.trim().toLowerCase();
  const group = Object.entries(demographicAgreement).find(
    ([key]) => key.trim().toLowerCase() === normalizedGroupLabel,
  )?.[1];
  return group?.[label];
}

function subgroupResponsePercentage(
  distributions:
    | Record<string, Record<string, number[]>>
    | undefined,
  groupLabel: string | undefined,
  label: string,
  responseIndex: number,
): number | undefined {
  if (!distributions || !groupLabel) return undefined;
  const normalizedGroupLabel = normalizedDemographicLabel(groupLabel);
  const group = Object.entries(distributions).find(
    ([key]) => normalizedDemographicLabel(key) === normalizedGroupLabel,
  )?.[1];
  return group?.[label]?.[responseIndex];
}

function demographicValue(
  demographics: ReportWorkbookDemographic[],
  cell: ExcelJS.Cell,
  baseValue: number,
  demographicAgreement?: Record<string, Record<string, number>>,
): number | string {
  const label = cell.worksheet.getCell(3, cell.col).value;
  if (typeof label !== "string") return "x";
  const groupLabel = demographicGroupLabel(cell);
  const count = demographicCount(demographics, label, groupLabel);
  if (count === undefined || count < 5) return "x";
  return (
    subgroupAgreement(demographicAgreement, groupLabel, label) ?? baseValue
  );
}

function demographicAverageValue(
  demographics: ReportWorkbookDemographic[],
  cell: ExcelJS.Cell,
  baseValue: number,
  demographicAgreements: Array<
    Record<string, Record<string, number>> | undefined
  >,
  demographicResponseCounts: Array<
    Record<string, Record<string, number>> | undefined
  >,
): number | string {
  const label = cell.worksheet.getCell(3, cell.col).value;
  if (typeof label !== "string") return "x";
  const groupLabel = demographicGroupLabel(cell);
  const count = demographicCount(demographics, label, groupLabel);
  if (count === undefined || count < 5) return "x";
  const values = demographicAgreements.flatMap((agreement, index) => {
    const value = subgroupAgreement(agreement, groupLabel, label);
    if (typeof value !== "number") return [];
    const responseCount = subgroupAgreement(
      demographicResponseCounts[index],
      groupLabel,
      label,
    );
    return [{ value, weight: responseCount }];
  });
  return values.length ? weightedAverage(values) : baseValue;
}

function average(values: number[]): number {
  if (!values.length) return 0;
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function weightedAverage(
  values: Array<{ value: number; weight?: number | undefined }>,
): number {
  const weighted = values.filter(
    (item): item is { value: number; weight: number } =>
      typeof item.weight === "number" && item.weight > 0,
  );
  if (weighted.length === values.length && weighted.length > 0) {
    const totalWeight = weighted.reduce(
      (total, item) => total + item.weight,
      0,
    );
    return (
      weighted.reduce((total, item) => total + item.value * item.weight, 0) /
      totalWeight
    );
  }
  return average(values.map((item) => item.value));
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
        rules: [
          {
            type: "cellIs",
            operator: "between",
            formulae: ranges.negative,
            priority: 3,
            style: { fill: responsePatternFills.negative },
          },
        ],
      });
    }
  });
}

function rotateWorkforceFeedbackHeaders(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.getWorksheet("Workforce Feedback Results");
  if (!sheet) return;

  sheet.getRow(3).eachCell({ includeEmpty: false }, (cell) => {
    // Column B is the report title. The remaining non-separator cells are the
    // demographic headers that should read vertically in generated reports.
    if (cell.fullAddress.col < 4 || cell.value === 0 || cell.value === "0")
      return;
    cell.alignment = {
      ...cell.alignment,
      textRotation: 90,
    };
  });
}

function clearWorkforceFeedbackPlaceholders(workbook: ExcelJS.Workbook): void {
  const sheet = workbook.getWorksheet("Workforce Feedback Results");
  if (!sheet) return;
  sheet.getRow(1).eachCell({ includeEmpty: true }, (cell) => {
    cell.value = null;
  });
  sheet.getCell("B2").value = null;
}

export async function createWorkforceFeedbackWorkbook(input: {
  metadata: ReportWorkbookMetadata;
  demographics: ReportWorkbookDemographic[];
  sections: FeedbackWorkbookSection[];
  totalResponses: number;
  responsePatternRanges?: ResponsePatternRanges;
}): Promise<Buffer> {
  const workbook = await loadTemplate("workforce-feedback-results.xlsx");
  clearWorkforceFeedbackPlaceholders(workbook);
  rotateWorkforceFeedbackHeaders(workbook);
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
      const count =
        demographicCount(
          input.demographics,
          label,
          demographicGroupLabel(cell),
        ) ?? 0;
      return count;
    }
    const categoryMatch = /^CATEGORY_(\d+)_TITLE$/u.exec(name);
    if (categoryMatch)
      return input.sections[Number(categoryMatch[1]) - 1]?.title;
    const categoryQuestionMatch = /^CATEGORY_(\d+)_QUESTION_(\d+)_TEXT$/u.exec(
      name,
    );
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
    const averageValueMatch = /^CATEGORY_(\d+)_AVERAGE_VALUE_(\d+)$/u.exec(
      name,
    );
    if (averageValueMatch) {
      const section = input.sections[Number(averageValueMatch[1]) - 1];
      if (!section) return null;
      const valueIndex = Number(averageValueMatch[2]);
      const agreement = weightedAverage(
        section.questions.map((item) => ({
          value: item.agreement,
          weight: item.responseCount,
        })),
      );
      const disagreement = weightedAverage(
        section.questions.map((item) => ({
          value: item.disagreement,
          weight: item.responseCount,
        })),
      );
      if (valueIndex === 1) return agreement;
      if (valueIndex === 2) return disagreement;
      return demographicAverageValue(
        input.demographics,
        cell,
        agreement,
        section.questions.map((item) => item.demographicAgreement),
        section.questions.map((item) => item.demographicResponseCount),
      );
    }
    const questionValueMatch = /^QUESTION_(\d+)_VALUE_(\d+)$/u.exec(name);
    if (questionValueMatch) {
      const question = questions[Number(questionValueMatch[1]) - 1];
      if (!question) return null;
      const valueIndex = Number(questionValueMatch[2]);
      if (valueIndex === 1) return question.agreement;
      if (valueIndex === 2) return question.disagreement;
      return demographicValue(
        input.demographics,
        cell,
        question.agreement,
        question.demographicAgreement,
      );
    }
    const surveyAverageMatch = /^SURVEY_AVERAGE_VALUE_(\d+)$/u.exec(name);
    if (surveyAverageMatch) {
      const valueIndex = Number(surveyAverageMatch[1]);
      const agreement = weightedAverage(
        questions.map((item) => ({
          value: item.agreement,
          weight: item.responseCount,
        })),
      );
      const disagreement = weightedAverage(
        questions.map((item) => ({
          value: item.disagreement,
          weight: item.responseCount,
        })),
      );
      if (valueIndex === 1) return agreement;
      if (valueIndex === 2) return disagreement;
      return demographicAverageValue(
        input.demographics,
        cell,
        agreement,
        questions.map((question) => question.demographicAgreement),
        questions.map((question) => question.demographicResponseCount),
      );
    }
    return null;
  });
  applyResponsePatternFills(workbook, input.responsePatternRanges);
  return workbookBuffer(workbook);
}

export async function createBenchmarkWorkbook(input: {
  metadata: ReportWorkbookMetadata;
  headerTypes: string[];
  categories: BenchmarkWorkbookCategory[];
  surveyAverage: Array<number | string>;
  cohortOrganizationCount?: number;
}): Promise<Buffer> {
  const workbook = await loadTemplate("benchmark-comparison.xlsx");
  const groupTypes = {
    ALL_WINNER: "All_Yes",
    ALL_NON_WINNER: "All_No",
    SMALL_WINNER: "Small_Yes",
    SMALL_NON_WINNER: "Small_No",
    MEDIUM_WINNER: "Medium_Yes",
    MEDIUM_NON_WINNER: "Medium_No",
    LARGE_WINNER: "Large_Yes",
    LARGE_NON_WINNER: "Large_No",
  } as const;
  type GroupToken = keyof typeof groupTypes;
  const groupIndex = (token: GroupToken): number => {
    const expected = groupTypes[token].replaceAll("_", "").toLowerCase();
    return input.headerTypes.findIndex(
      (type) => type.replaceAll("_", "").toLowerCase() === expected,
    );
  };
  const groupValue = (
    values: Array<number | string> | undefined,
    token: GroupToken,
  ): number | string => {
    const index = groupIndex(token);
    return index >= 0 ? (values?.[index] ?? "x") : "x";
  };
  fillTokens(workbook, (name) => {
    if (name === "PROGRAM_NAME") return input.metadata.programName;
    if (name === "COHORT_ORGANIZATION_COUNT") {
      return input.cohortOrganizationCount ?? "";
    }
    const surveyAverageMatch =
      /^SURVEY_AVERAGE_(ALL_WINNER|ALL_NON_WINNER|SMALL_WINNER|SMALL_NON_WINNER|MEDIUM_WINNER|MEDIUM_NON_WINNER|LARGE_WINNER|LARGE_NON_WINNER)$/u.exec(
        name,
      );
    if (surveyAverageMatch?.[1]) {
      return groupValue(
        input.surveyAverage,
        surveyAverageMatch[1] as GroupToken,
      );
    }
    const categoryMatch = /^CATEGORY_(\d+)_TITLE$/u.exec(name);
    if (categoryMatch) {
      return input.categories[
        Number(categoryMatch[1]) - 1
      ]?.title.toUpperCase();
    }
    const averageTitleMatch = /^CATEGORY_(\d+)_AVERAGE_TITLE$/u.exec(name);
    if (averageTitleMatch) {
      const title = input.categories[Number(averageTitleMatch[1]) - 1]?.title;
      return title ? `${title.toUpperCase()} - AVERAGE` : null;
    }
    const averageValueMatch =
      /^CATEGORY_(\d+)_AVERAGE_(ALL_WINNER|ALL_NON_WINNER|SMALL_WINNER|SMALL_NON_WINNER|MEDIUM_WINNER|MEDIUM_NON_WINNER|LARGE_WINNER|LARGE_NON_WINNER)$/u.exec(
        name,
      );
    if (averageValueMatch) {
      const category = input.categories[Number(averageValueMatch[1]) - 1];
      return groupValue(category?.values, averageValueMatch[2] as GroupToken);
    }
    const questionMatch =
      /^CATEGORY_(\d+)_QUESTION_(\d+)_(TEXT|ALL_WINNER|ALL_NON_WINNER|SMALL_WINNER|SMALL_NON_WINNER|MEDIUM_WINNER|MEDIUM_NON_WINNER|LARGE_WINNER|LARGE_NON_WINNER)$/u.exec(
        name,
      );
    if (questionMatch) {
      const question =
        input.categories[Number(questionMatch[1]) - 1]?.questions[
          Number(questionMatch[2]) - 1
        ];
      if (questionMatch[3] === "TEXT") return question?.text;
      return groupValue(question?.values, questionMatch[3] as GroupToken);
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
  const rows =
    section?.questions.flatMap((question) =>
      question.responses.map((response) => ({
        question: question.text,
        response,
      })),
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
  demographicTitle?: string;
  questions: VerbatimWorkbookQuestion[];
}): Promise<Buffer> {
  const workbook = await loadTemplate("employee-verbatims.xlsx");
  const includeDemographic = Boolean(input.demographicTitle?.trim());
  fillTokens(workbook, (name) => {
    if (name === "ORGANIZATION_NAME") return input.metadata.organizationName;
    if (name === "PROGRAM_NAME") return input.metadata.programName;
    if (name === "SURVEY_DATES") return input.metadata.surveyDates;
    if (name === "DEMOGRAPHIC_TITLE") return input.demographicTitle;
    const questionMatch = /^QUESTION_(\d+)_TEXT$/u.exec(name);
    if (questionMatch)
      return input.questions[Number(questionMatch[1]) - 1]?.text;
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
    if (!includeDemographic) sheet.spliceColumns(2, 1);
  });
  return workbookBuffer(workbook);
}

function annualAverage(
  questions: AnnualTrendsWorkbookSection["questions"],
  period: "current" | "previous",
  metric: "agreement" | "disagreement",
): number | string {
  const values = questions.flatMap((question) => {
    const snapshot = question[period];
    return snapshot
      ? [{ value: snapshot[metric], weight: snapshot.responseCount }]
      : [];
  });
  return values.length ? weightedAverage(values) : "*";
}

export async function createAnnualTrendsWorkbook(input: {
  metadata: ReportWorkbookMetadata;
  currentYear: string;
  previousYear: string;
  currentTotalResponses: number;
  previousTotalResponses: number;
  sections: AnnualTrendsWorkbookSection[];
}): Promise<Buffer> {
  const workbook = await loadTemplate("annual-trends.xlsx");
  fillTokens(workbook, (name) => {
    if (name === "ORGANIZATION_NAME") return input.metadata.organizationName;
    if (name === "PROGRAM_NAME") return input.metadata.programName;
    if (name === "CURRENT_YEAR") return input.currentYear;
    if (name === "PREVIOUS_YEAR") return input.previousYear;
    if (name === "CURRENT_TOTAL_RESPONSES") {
      return input.currentTotalResponses;
    }
    if (name === "PREVIOUS_TOTAL_RESPONSES") {
      return input.previousTotalResponses;
    }
    const categoryTitleMatch = /^CATEGORY_(\d+)_TITLE$/u.exec(name);
    if (categoryTitleMatch) {
      return input.sections[
        Number(categoryTitleMatch[1]) - 1
      ]?.title.toUpperCase();
    }
    const categoryAverageTitleMatch = /^CATEGORY_(\d+)_AVERAGE_TITLE$/u.exec(
      name,
    );
    if (categoryAverageTitleMatch) {
      const title =
        input.sections[Number(categoryAverageTitleMatch[1]) - 1]?.title;
      return title ? `${title.toUpperCase()} - AVERAGE` : null;
    }
    const questionTextMatch = /^CATEGORY_(\d+)_QUESTION_(\d+)_TEXT$/u.exec(
      name,
    );
    if (questionTextMatch) {
      return input.sections[Number(questionTextMatch[1]) - 1]?.questions[
        Number(questionTextMatch[2]) - 1
      ]?.text;
    }
    const questionValueMatch =
      /^CATEGORY_(\d+)_QUESTION_(\d+)_(CURRENT|PREVIOUS)_(AGREEMENT|DISAGREEMENT)$/u.exec(
        name,
      );
    if (questionValueMatch) {
      const question =
        input.sections[Number(questionValueMatch[1]) - 1]?.questions[
          Number(questionValueMatch[2]) - 1
        ];
      if (!question) return null;
      const period = questionValueMatch[3]?.toLowerCase() as
        "current" | "previous";
      const metric = questionValueMatch[4]?.toLowerCase() as
        "agreement" | "disagreement";
      return question[period]?.[metric] ?? "*";
    }
    const categoryAverageMatch =
      /^CATEGORY_(\d+)_AVERAGE_(CURRENT|PREVIOUS)_(AGREEMENT|DISAGREEMENT)$/u.exec(
        name,
      );
    if (categoryAverageMatch) {
      const section = input.sections[Number(categoryAverageMatch[1]) - 1];
      if (!section) return null;
      return annualAverage(
        section.questions,
        categoryAverageMatch[2]?.toLowerCase() as "current" | "previous",
        categoryAverageMatch[3]?.toLowerCase() as "agreement" | "disagreement",
      );
    }
    const surveyAverageMatch =
      /^SURVEY_AVERAGE_(CURRENT|PREVIOUS)_(AGREEMENT|DISAGREEMENT)$/u.exec(
        name,
      );
    if (surveyAverageMatch) {
      return annualAverage(
        input.sections.flatMap((section) => section.questions),
        surveyAverageMatch[1]?.toLowerCase() as "current" | "previous",
        surveyAverageMatch[2]?.toLowerCase() as "agreement" | "disagreement",
      );
    }
    return null;
  });
  return workbookBuffer(workbook);
}

function responsePercentages(
  question: FeedbackWorkbookSection["questions"][number],
): number[] {
  if (question.responseDistribution) return question.responseDistribution;
  const stronglyDisagree = Math.round(question.disagreement * 0.4);
  const disagree = question.disagreement - stronglyDisagree;
  const stronglyAgree = Math.round(question.agreement * 0.6);
  const agree = question.agreement - stronglyAgree;
  return [
    stronglyDisagree,
    disagree,
    question.neutral,
    agree,
    stronglyAgree,
    0,
  ];
}

export async function createResponseDetailWorkbook(input: {
  metadata: ReportWorkbookMetadata;
  demographics: ReportWorkbookDemographic[];
  sections: FeedbackWorkbookSection[];
  totalResponses: number;
  filterGroupLabel?: string;
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
      const groupLabel = demographicGroupLabel(cell);
      return typeof label === "string"
        ? (demographicCount(input.demographics, label, groupLabel) ?? 0)
        : 0;
    }
    const categoryMatch = /^CATEGORY_(\d+)_TITLE$/u.exec(name);
    if (categoryMatch)
      return input.sections[Number(categoryMatch[1]) - 1]?.title;
    const questionTextMatch = /^QUESTION_(\d+)_TEXT$/u.exec(name);
    if (questionTextMatch)
      return questions[Number(questionTextMatch[1]) - 1]?.text;
    const totalMatch = /^QUESTION_(\d+)_TOTAL_VALUE_(\d+)$/u.exec(name);
    if (totalMatch) {
      if (cell.fullAddress.col === 5) return input.totalResponses;
      const label = cell.worksheet.getCell(3, cell.fullAddress.col).value;
      const groupLabel = demographicGroupLabel(cell);
      const count =
        typeof label === "string"
          ? demographicCount(input.demographics, label, groupLabel)
          : undefined;
      return count === undefined || count < 5
        ? "x"
        : Math.round((count * 100) / input.totalResponses);
    }
    const responseMatch = /^QUESTION_(\d+)_RESPONSE_(\d+)_VALUE_(\d+)$/u.exec(
      name,
    );
    if (responseMatch) {
      const question = questions[Number(responseMatch[1]) - 1];
      if (!question) return null;
      const value =
        responsePercentages(question)[Number(responseMatch[2]) - 1] ?? 0;
      if (cell.fullAddress.col === 5) return value;
      const label = cell.worksheet.getCell(3, cell.fullAddress.col).value;
      const groupLabel = demographicGroupLabel(cell);
      const subgroupValue =
        typeof label === "string"
          ? subgroupResponsePercentage(
              question.demographicResponseDistribution,
              groupLabel,
              label,
              Number(responseMatch[2]) - 1,
            )
          : undefined;
      return demographicValue(
        input.demographics,
        cell,
        subgroupValue ?? value,
      );
    }
    return null;
  });
  if (input.filterGroupLabel) {
    filterResponseDetailColumns(workbook, input.filterGroupLabel);
  }
  return workbookBuffer(workbook);
}
