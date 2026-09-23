import type ExcelJS from "exceljs";

export type ResponsePatternRowKind =
  | "response-count"
  | "question"
  | "category-average"
  | "survey-average"
  | "section"
  | "note"
  | "other";

export type ResponsePatternColumnKind =
  | "overall-agreement"
  | "overall-disagreement"
  | "demographic-agreement"
  | "separator"
  | "other";

export type ResponsePatternMetric = "agreement" | "disagreement";

export interface ResponsePatternCell {
  row: number;
  column: number;
  rowKind: ResponsePatternRowKind;
  columnKind: ResponsePatternColumnKind;
  metric: ResponsePatternMetric | null;
  rawValue: unknown;
  numericValue: number | null;
  suppressed: boolean;
  denominatorEligible: boolean;
  classificationEligible: boolean;
  highlightEligible: boolean;
}

export interface ResponsePatternCellProjectionOptions {
  firstValueRow?: number;
  lastValueRow?: number;
  firstValueColumn?: number;
}

export interface ResponsePatternClassificationRanges {
  positive?: readonly [number, number];
  neutral?: readonly [number, number];
  negative?: readonly [number, number];
}

export interface ResponsePatternClassification {
  denominator: number;
  matchCounts: {
    positive: number;
    neutral: number;
    negative: number;
  };
  percentages: {
    positive: number;
    neutral: number;
    negative: number;
  };
  cells: Array<{
    row: number;
    column: number;
    color: "positive" | "neutral" | "negative" | "gray";
    value: number | "x";
  }>;
}

export interface HighAgreementClassification {
  denominator: number;
  matchCount: number;
  percentage: number;
  cells: ResponsePatternClassification["cells"];
}

const defaultProjectionOptions = {
  firstValueRow: 5,
  // The legacy report classified rows 5 through 115 while still counting
  // numeric cells outside that window in its percentage denominator.
  lastValueRow: 115,
  firstValueColumn: 4,
} as const;

function scalarCellValue(value: ExcelJS.CellValue): unknown {
  if (value !== null && typeof value === "object" && "result" in value) {
    return value.result;
  }
  return value;
}

function numericCellValue(value: unknown): number | null {
  const numeric =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;
  return Number.isFinite(numeric) ? numeric : null;
}

function rowKind(
  sheet: ExcelJS.Worksheet,
  row: number,
  firstValueColumn: number,
): ResponsePatternRowKind {
  if (row === 4) return "response-count";
  const labelValue = scalarCellValue(sheet.getCell(row, 2).value);
  const label = typeof labelValue === "string" ? labelValue.trim() : "";
  if (/^survey average$/iu.test(label)) return "survey-average";
  if (/ - average$/iu.test(label)) return "category-average";
  if (/^(note:|some responses are marked)/iu.test(label)) return "note";
  if (!label) return "other";

  for (
    let column = firstValueColumn;
    column <= sheet.columnCount;
    column += 1
  ) {
    const value = scalarCellValue(sheet.getCell(row, column).value);
    if (numericCellValue(value) !== null || value === "x") return "question";
  }
  return "section";
}

function columnKind(
  sheet: ExcelJS.Worksheet,
  column: number,
): ResponsePatternColumnKind {
  if (column === 4) return "overall-agreement";
  if (column === 5) return "overall-disagreement";
  const width = sheet.getColumn(column).width;
  if (width !== undefined && width <= 1) return "separator";
  if (column > 5) return "demographic-agreement";
  return "other";
}

function metric(kind: ResponsePatternColumnKind): ResponsePatternMetric | null {
  if (kind === "overall-disagreement") return "disagreement";
  if (kind === "overall-agreement" || kind === "demographic-agreement") {
    return "agreement";
  }
  return null;
}

/**
 * Projects the generated Workforce Feedback worksheet into the cell population
 * used by the legacy Response Patterns calculation. This implementation is
 * owned by the new API and intentionally has no dependency on the old service.
 */
export function projectResponsePatternCells(
  sheet: ExcelJS.Worksheet,
  options: ResponsePatternCellProjectionOptions = {},
): ResponsePatternCell[] {
  const firstValueRow =
    options.firstValueRow ?? defaultProjectionOptions.firstValueRow;
  const lastValueRow =
    options.lastValueRow ?? defaultProjectionOptions.lastValueRow;
  const firstValueColumn =
    options.firstValueColumn ?? defaultProjectionOptions.firstValueColumn;
  const cells: ResponsePatternCell[] = [];

  for (let row = 4; row <= sheet.rowCount; row += 1) {
    const projectedRowKind = rowKind(sheet, row, firstValueColumn);
    for (
      let column = firstValueColumn;
      column <= sheet.columnCount;
      column += 1
    ) {
      const rawValue = scalarCellValue(sheet.getCell(row, column).value);
      const numericValue = numericCellValue(rawValue);
      const suppressed = rawValue === "x";
      const denominatorEligible = numericValue !== null || suppressed;
      const projectedColumnKind = columnKind(sheet, column);
      const classificationEligible =
        denominatorEligible &&
        row >= firstValueRow &&
        row <= lastValueRow &&
        projectedColumnKind !== "separator";

      cells.push({
        row,
        column,
        rowKind: projectedRowKind,
        columnKind: projectedColumnKind,
        metric: metric(projectedColumnKind),
        rawValue,
        numericValue,
        suppressed,
        denominatorEligible,
        classificationEligible,
        highlightEligible: classificationEligible && numericValue !== null,
      });
    }
  }

  return cells;
}

function roundToTwo(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

export function classifyHighAgreementCells(
  cells: ResponsePatternCell[],
  range: readonly [number, number],
): HighAgreementClassification {
  const result = classifyResponsePatternCells(cells, { positive: range });
  return {
    denominator: result.denominator,
    matchCount: result.matchCounts.positive,
    percentage: result.percentages.positive,
    cells: result.cells,
  };
}

function matchesRange(
  value: number | null,
  range: readonly [number, number] | undefined,
): value is number {
  return (
    value !== null &&
    range !== undefined &&
    value >= range[0] &&
    value <= range[1]
  );
}

/**
 * Applies the legacy range-mode precedence to the projected worksheet cells.
 * High Agreement is evaluated before Moderate Agreement, and disagreement is
 * evaluated only for the overall-disagreement column. Every selected pattern
 * shares the same whole-workbook denominator.
 */
export function classifyResponsePatternCells(
  cells: ResponsePatternCell[],
  ranges: ResponsePatternClassificationRanges,
): ResponsePatternClassification {
  const denominator = cells.filter((cell) => cell.denominatorEligible).length;
  const matchCounts = { positive: 0, neutral: 0, negative: 0 };
  const classified: ResponsePatternClassification["cells"] = [];

  for (const cell of cells) {
    if (!cell.classificationEligible) continue;

    if (cell.metric === "agreement" && (ranges.positive || ranges.neutral)) {
      let color: "positive" | "neutral" | "gray" = "gray";
      if (matchesRange(cell.numericValue, ranges.positive)) {
        color = "positive";
        matchCounts.positive += 1;
      } else if (matchesRange(cell.numericValue, ranges.neutral)) {
        color = "neutral";
        matchCounts.neutral += 1;
      }
      classified.push({
        row: cell.row,
        column: cell.column,
        color,
        value: cell.numericValue ?? "x",
      });
      continue;
    }

    if (
      cell.metric === "disagreement" &&
      matchesRange(cell.numericValue, ranges.negative)
    ) {
      matchCounts.negative += 1;
      classified.push({
        row: cell.row,
        column: cell.column,
        color: "negative",
        value: cell.numericValue,
      });
    }
  }

  const percentage = (count: number) =>
    denominator === 0 ? 0 : roundToTwo((count * 100) / denominator);

  return {
    denominator,
    matchCounts,
    percentages: {
      positive: percentage(matchCounts.positive),
      neutral: percentage(matchCounts.neutral),
      negative: percentage(matchCounts.negative),
    },
    cells: classified,
  };
}
