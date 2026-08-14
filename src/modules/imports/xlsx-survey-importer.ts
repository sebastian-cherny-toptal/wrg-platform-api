import ExcelJS from "exceljs";

export type XlsxSurveyKind = "EA" | "EFS";

export interface XlsxQuestionDefinition {
  benchmarkValues?: Array<number | string>;
  caption: string;
  categoryLabel?: string;
  column: number;
  dataLabel: string;
  filterLabel?: string;
  id: string;
  type: string;
}

interface XlsxSurveyColumns {
  companySize: number;
  dateResponded: number;
  language: number;
  organizationIds: number[];
  organizationNames: number[];
  reachedEnd: number;
  respondent: number;
}

export interface XlsxSurveyDefinition {
  columns: XlsxSurveyColumns;
  fileName: string;
  filePath: string;
  questions: XlsxQuestionDefinition[];
}

export interface XlsxImportedResponse {
  question: XlsxQuestionDefinition;
  score: number | null;
  value: boolean | number | string;
}

export interface XlsxSurveyRow {
  companySize?: number;
  completed: boolean;
  completedAt: Date | null;
  language: string;
  organizationId?: string;
  organizationName?: string;
  respondent: boolean | number | string | null;
  responses: XlsxImportedResponse[];
  rowNumber: number;
}

export interface ReadXlsxSurveyDefinitionInput {
  fileName: string;
  filePath: string;
  questionId: (dataLabel: string) => string;
}

export interface IterateXlsxSurveyRowsOptions {
  includeOrganization?: (organizationName: string | undefined) => boolean;
}

export function cellScalar(
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

function metadataColumn(headers: ExcelJS.Row, name: string): number {
  for (let column = 1; column <= headers.cellCount; column += 1) {
    if (headerValue(headers, column).toLowerCase() === name.toLowerCase()) {
      return column;
    }
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

export function xlsxQuestionType(dataLabel: string): string {
  if (
    /^q_(?:CoreEmployeeExperience|YourJob|CommunicationWorkplaceCulture|RelationshipManager|TrainingTechnologyProfessionalDevelopment|DiversityInclusion|Leadership|EmployeeBenefits|WorkLifeBalance)_/u.test(
      dataLabel,
    )
  ) {
    return "likert";
  }
  if (
    dataLabel.startsWith("f_") ||
    /Company Size|Sample size/iu.test(dataLabel) ||
    /^\d+\.\s*Select\b/iu.test(dataLabel)
  ) {
    return "demographic";
  }
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

function questionsForHeaders(
  headers: ExcelJS.Row,
  columnCount: number,
  questionId: (dataLabel: string) => string,
): XlsxQuestionDefinition[] {
  const scorePercentColumn = metadataColumn(headers, "Score %");
  if (scorePercentColumn === 0) throw new Error('Missing "Score %" column');
  const questions: XlsxQuestionDefinition[] = [];
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
    ) {
      continue;
    }
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
      id: questionId(dataLabel),
      type: xlsxQuestionType(dataLabel),
    });
  }
  return questions;
}

function sourceString(value: ExcelJS.CellValue): string | undefined {
  const scalar = cellScalar(value);
  if (scalar === null) return undefined;
  const normalized = String(scalar).trim();
  return normalized || undefined;
}

/**
 * Preserve reportable source values. PII/administrative columns are excluded by
 * header discovery before this function is called, so report answers must not
 * be replaced with generated placeholders here.
 */
export function xlsxResponseValue(
  value: ExcelJS.CellValue,
): boolean | number | string | null {
  const scalar = cellScalar(value);
  if (scalar === null || scalar === "") return null;
  if (typeof scalar === "number") {
    return Number.isFinite(scalar) ? scalar : null;
  }
  if (typeof scalar === "boolean") return scalar;
  if (scalar instanceof Date) return scalar.toISOString();
  const trimmed = scalar.trim();
  if (!trimmed) return null;
  if (/^-?\d+(?:\.\d+)?$/u.test(trimmed)) return Number(trimmed);
  if (/^(?:true|false)$/iu.test(trimmed)) {
    return trimmed.toLowerCase() === "true";
  }
  return trimmed;
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

async function firstWorksheetRow(
  filePath: string,
): Promise<{ columnCount: number; row: ExcelJS.Row }> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) throw new Error("Workbook contains no worksheets");
  return { columnCount: worksheet.columnCount, row: worksheet.getRow(1) };
}

export async function readXlsxSurveyDefinition(
  input: ReadXlsxSurveyDefinitionInput,
): Promise<XlsxSurveyDefinition> {
  const { columnCount, row } = await firstWorksheetRow(input.filePath);
  const columns: XlsxSurveyColumns = {
    organizationNames: [
      metadataColumn(row, "organization name"),
      metadataColumn(row, "organization_name"),
    ],
    organizationIds: [
      metadataColumn(row, "organization ID2"),
      metadataColumn(row, "organization ID"),
      metadataColumn(row, "organization_ID"),
    ],
    respondent: metadataColumn(row, "Respondent"),
    language: metadataColumn(row, "Language"),
    dateResponded: metadataColumn(row, "Date responded"),
    reachedEnd: metadataColumn(row, "Reached end"),
    companySize:
      Array.from({ length: row.cellCount }, (_, index) => index + 1).find(
        (column) => /Company Size/iu.test(headerValue(row, column)),
      ) ?? 0,
  };
  if (!columns.organizationNames.some(Boolean) || !columns.respondent) {
    throw new Error(
      `${input.fileName}: required respondent/organization columns are missing`,
    );
  }
  return {
    columns,
    fileName: input.fileName,
    filePath: input.filePath,
    questions: questionsForHeaders(row, columnCount, input.questionId),
  };
}

export async function forEachXlsxSurveyRow(
  definition: XlsxSurveyDefinition,
  options: IterateXlsxSurveyRowsOptions,
  callback: (row: XlsxSurveyRow) => Promise<void> | void,
): Promise<void> {
  // ExcelJS's streaming reader assumes workbook metadata appears before sheet
  // entries. Valid XLSX files produced by ExcelJS itself do not always have
  // that ZIP entry order, which makes the reader dereference an undefined
  // workbook model. The document reader handles either order reliably.
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(definition.filePath);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) {
    throw new Error(`${definition.fileName}: workbook contains no worksheets`);
  }
  for (let rowNumber = 2; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const row = worksheet.getRow(rowNumber);
    const organizationName = sourceString(
      firstNonEmptyCell(row, definition.columns.organizationNames),
    );
    const organizationId = sourceString(
      firstNonEmptyCell(row, definition.columns.organizationIds),
    );
    if (
      options.includeOrganization &&
      !options.includeOrganization(organizationName)
    ) {
      continue;
    }
    const completedAt = definition.columns.dateResponded
      ? parsedDate(row.getCell(definition.columns.dateResponded).value)
      : null;
    const responses = definition.questions.flatMap((question) => {
      const value = xlsxResponseValue(row.getCell(question.column).value);
      if (value === null) return [];
      const score =
        question.type === "likert" &&
        typeof value === "number" &&
        value >= 1 &&
        value <= 5
          ? value
          : null;
      return [{ question, score, value }];
    });
    const companySize = definition.columns.companySize
      ? cellScalar(row.getCell(definition.columns.companySize).value)
      : null;
    const respondent = cellScalar(
      row.getCell(definition.columns.respondent).value,
    );
    await callback({
      ...(typeof companySize === "number" ? { companySize } : {}),
      completed: isCompleted(
        definition.columns.reachedEnd
          ? row.getCell(definition.columns.reachedEnd).value
          : null,
        completedAt,
      ),
      completedAt,
      language: definition.columns.language
        ? String(
            cellScalar(row.getCell(definition.columns.language).value) ?? "en",
          ).slice(0, 12)
        : "en",
      ...(organizationId ? { organizationId } : {}),
      ...(organizationName ? { organizationName } : {}),
      respondent:
        respondent instanceof Date ? respondent.toISOString() : respondent,
      responses,
      rowNumber: row.number,
    });
  }
}
