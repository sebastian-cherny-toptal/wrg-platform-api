import ExcelJS from "exceljs";
import type {
  SurveyDefinition,
  SurveyDefinitionQuestion,
} from "./survey-definition.js";
import { cellScalar } from "./xlsx-survey-importer.js";
import { canonicalEaQuestionKey, eaEligibility } from "./ea-question-keys.js";
import { benefitsQuestionBindingForKey } from "../reports/benefits-question-bindings.js";

export interface EaQuestionResponseIssue {
  code:
    | "unsupported-question"
    | "unsupported-answer"
    | "missing-question-key"
    | "duplicate-answer";
  message: string;
  questionKey?: string;
  row?: number;
}

export interface EaQuestionResponseConversion {
  definition: SurveyDefinition;
  issues: EaQuestionResponseIssue[];
  sourceQuestionCount: number;
  supportedQuestionCount: number;
  answerCount: number;
  importable: boolean;
}

interface SourceQuestion {
  key: string;
  caption: string;
  category: string;
  row: number;
  matrixItem?: string;
  groupLabel?: string;
  instructions: string;
  options: Array<{ label: string; code: string }>;
}
function text(value: ExcelJS.CellValue): string {
  return String(cellScalar(value) ?? "")
    .replace(/&amp;/giu, "&")
    .replace(/&nbsp;/giu, " ")
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&quot;/giu, '"')
    .replace(/\s+/gu, " ")
    .trim();
}
function categoryForKey(key: string): string {
  return (key.split("_")[1] ?? "Benefits & Best Practices")
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/and/gu, " and ")
    .replace(/\s+/gu, " ")
    .trim();
}
function extractQuestions(sheet: ExcelJS.Worksheet): SourceQuestion[] {
  const result: SourceQuestion[] = [];
  let category = "";
  for (let r = 1; r <= sheet.rowCount; r++) {
    const first = text(sheet.getRow(r).getCell(1).value);
    if (/^[A-Z &,-]{8,}$/u.test(first)) category = first;
    const match = /\((q_[^)]+)\)\s*$/u.exec(first);
    if (!match?.[1]) continue;
    const item = /^\d+\.(\d+)\s/u.exec(first)?.[1];
    const question: SourceQuestion = {
      key: match[1],
      caption: first.slice(0, match.index).replace(/^\d+(?:\.\d+)*\.?\s+/u, ""),
      category: category || categoryForKey(match[1]),
      row: r,
      instructions: "",
      options: [],
      ...(item ? { matrixItem: item } : {}),
    };
    for (let next = r + 1; next <= sheet.rowCount; next++) {
      const row = sheet.getRow(next);
      const a = text(row.getCell(1).value),
        b = text(row.getCell(2).value);
      if (/^Page\s+\d+|^\d+(?:\.\d+)*\.?\s+/iu.test(a)) break;
      if (/^Each respondent/iu.test(a)) question.instructions += a;
      else if (item && a && !a.startsWith("{{")) question.groupLabel = a;
      const option = /^(.*\S)\s+\(([^()]*)\)\s*$/u.exec(b);
      if (option?.[1] && option[2] && !/^open answer$/iu.test(option[1]))
        question.options.push({
          label: option[1].trim(),
          code: option[2].trim(),
        });
    }
    result.push(question);
  }
  return result;
}

/** Converts source semantics; captions and display positions never become raw codes. */
export function convertEaQuestionResponseWorkbook(
  workbook: ExcelJS.Workbook,
  defaults: SurveyDefinition,
): EaQuestionResponseConversion {
  const sheet = workbook.getWorksheet("Questions") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("Workbook contains no worksheets");
  const sources = extractQuestions(sheet);
  if (!sources.length)
    throw new Error(
      "No survey questions with trailing q_ question keys were found",
    );
  const definition: SurveyDefinition = [];
  const issues: EaQuestionResponseIssue[] = [];
  const sourceKeys = new Map(
    sources.map((q) => [canonicalEaQuestionKey(q.key), q.key]),
  );
  for (const source of sources) {
    const canonical = canonicalEaQuestionKey(source.key);
    const binding = benefitsQuestionBindingForKey(canonical);
    const numeric =
      binding?.kind === "numeric" ||
      /NumberPaidHolidays|PctCostPaidByEmployerBenf|PctEmployeesWorkingRemote/u.test(
        canonical,
      );
    const narrative = /could write/iu.test(source.instructions) && !numeric;
    if (canonical.startsWith("q_SupplementaryQuestions_") || narrative) {
      issues.push({
        code: "unsupported-question",
        questionKey: source.key,
        row: source.row,
        message: `Excluded narrative/contact/non-report question: ${source.key}`,
      });
      continue;
    }
    const multiple = /MULTIPLE responses/iu.test(source.instructions);
    const yesNo =
      source.options.length === 2 &&
      source.options.some((o) => /^yes$/iu.test(o.label)) &&
      source.options.some((o) => /^no$/iu.test(o.label));
    const single =
      source.matrixItem !== undefined ||
      /only ONE response/iu.test(source.instructions);
    const calculation = numeric
      ? "mean"
      : multiple
        ? "multi"
        : yesNo
          ? "yesNo"
          : single
            ? "choice"
            : ((binding?.kind === "numeric" ? "mean" : binding?.kind) ??
              "choice");
    if (!numeric && !source.options.length) {
      issues.push({
        code: "missing-question-key",
        questionKey: source.key,
        row: source.row,
        message: `Questions row ${source.row}: cannot determine answer mappings for ${source.key}`,
      });
      continue;
    }
    const dataLabel = source.matrixItem
      ? `${canonical}.${source.matrixItem}`
      : canonical;
    if (definition.some((q) => q.dataLabel === dataLabel)) {
      issues.push({
        code: "duplicate-answer",
        questionKey: source.key,
        row: source.row,
        message: `Questions row ${source.row}: duplicate question ${dataLabel}`,
      });
      continue;
    }
    const sourceColumn = source.matrixItem
      ? `${source.key}.${source.matrixItem}`
      : source.key;
    const eligible = source.matrixItem
      ? undefined
      : (binding?.eligibleWhenYes ?? eaEligibility(canonical));
    const eligibleSource = eligible ? sourceKeys.get(eligible) : undefined;
    const configured: SurveyDefinitionQuestion = {
      dataLabel,
      caption: source.caption,
      categoryLabel: source.category,
      position: definition.length + 1,
      ea: {
        calculation,
        sourceColumn,
        format: numeric && !canonical.includes("Pct") ? "number" : "percent",
        ...(source.matrixItem
          ? {
              groupKey: canonical,
              groupLabel: source.groupLabel ?? `Benefit ${source.matrixItem}`,
            }
          : {}),
        ...(eligibleSource
          ? {
              eligibleQuestion: eligibleSource,
              eligibleValue:
                sources
                  .find((q) => q.key === eligibleSource)
                  ?.options.find((o) => /^yes$/iu.test(o.label))?.code ?? "1",
            }
          : {}),
      },
    };
    const options = source.options
      .filter((o) => !yesNo || /^yes$/iu.test(o.label))
      .map((option, index) => ({
        Id:
          calculation === "multi" || calculation === "mean"
            ? option.label
            : option.code,
        Caption: option.label,
        Position: index + 1,
        ...(calculation === "multi" || calculation === "mean"
          ? { SourceColumn: `${source.key}. ${option.label}` }
          : {}),
      }));
    if (options.length) configured.options = options;
    const defaultQuestion = defaults.find((q) => q.dataLabel === canonical);
    if (!source.category && defaultQuestion?.categoryLabel)
      configured.categoryLabel = defaultQuestion.categoryLabel;
    definition.push(configured);
  }
  return {
    definition,
    issues,
    sourceQuestionCount: sources.length,
    supportedQuestionCount: definition.length,
    answerCount: definition.reduce((n, q) => n + (q.options?.length ?? 0), 0),
    importable: !issues.some((i) => i.code !== "unsupported-question"),
  };
}

export async function convertEaQuestionResponseBuffer(
  buffer: Buffer,
  defaults: SurveyDefinition,
): Promise<EaQuestionResponseConversion> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  return convertEaQuestionResponseWorkbook(workbook, defaults);
}
