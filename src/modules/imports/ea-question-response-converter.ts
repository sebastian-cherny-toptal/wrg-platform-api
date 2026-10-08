import ExcelJS from "exceljs";
import type {
  SurveyDefinition,
  SurveyDefinitionQuestion,
} from "./survey-definition.js";
import { cellScalar } from "./xlsx-survey-importer.js";

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
  caption: string;
  key: string;
  options: string[];
  row: number;
}

const exactQuestionAliases: Readonly<Record<string, string>> = {
  q_OrganizationalOverview_FunActivities: "q_EmployerInformation_FunActivities",
  q_OrganizationalOverview_RecognizingAchievements:
    "q_EmployerInformation_RecognizingAchievements",
  q_OrganizationalOverview_RecognizingMilestones:
    "q_EmployerInformation_RecognizeEmployeeMilestones",
  q_OrganizationalOverview_UtilizePreEmply:
    "q_RecruitingandEmploymentPractices_UtilizePreEmply",
  q_OrganizationalOverview_Screening:
    "q_RecruitingandEmploymentPractices_Screening",
  q_OrganizationalBenefits_ShareOptionScheme: "q_OrganizationalBenefits_Esop",
  q_GivingBackandWorkLifeBalance_GivingBack:
    "q_GivingBackandWorkplaceWellness_GivingBack",
  q_GivingBackandWorkLifeBalance_FamilyFriendlyBen:
    "q_GivingBackandWorkplaceWellness_FamilyFriendlyBen",
  q_GivingBackandWorkLifeBalance_WLBBenefits:
    "q_GivingBackandWorkplaceWellness_WLBBenefits",
};

function text(value: ExcelJS.CellValue): string {
  const scalar = cellScalar(value);
  return scalar === null ? "" : String(scalar).trim();
}

function decodeSurveyText(value: string): string {
  return value
    .replace(/&amp;/giu, "&")
    .replace(/&nbsp;/giu, " ")
    .replace(/&#39;|&apos;/giu, "'")
    .replace(/&quot;/giu, '"')
    .replace(/\s+/gu, " ")
    .trim();
}

function normalizedLabel(value: string): string {
  return decodeSurveyText(value)
    .toLowerCase()
    .replace(/[“”]/gu, '"')
    .replace(/[‘’]/gu, "'")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function canonicalQuestionKey(sourceKey: string): string {
  let key = sourceKey
    .replace(/^q_OrganisationalBenefits_/u, "q_OrganizationalBenefits_")
    .replace(/_RecognisingAchievements$/u, "_RecognizingAchievements")
    .replace(/_UtilisePreEmply$/u, "_UtilizePreEmply");
  key = exactQuestionAliases[key] ?? key;
  return key;
}

function sourceQuestionFromRow(
  value: string,
  row: number,
): SourceQuestion | null {
  const match = /\((q_[^)]+)\)\s*$/u.exec(value);
  if (!match?.[1]) return null;
  return {
    caption: decodeSurveyText(
      value.slice(0, match.index).replace(/^\d+(?:\.\d+)*\.?\s+/u, ""),
    ),
    key: match[1],
    options: [],
    row,
  };
}

function optionLabel(value: string): string | null {
  const match = /^(.*\S)\s+\(([^()]*)\)\s*$/u.exec(value);
  if (!match?.[1]) return null;
  const label = decodeSurveyText(match[1]);
  if (!label || /^(?:open answer|\s*)$/iu.test(label)) return null;
  return label;
}

function isQuestionBoundary(value: string): boolean {
  return /^Page\s+\d+/iu.test(value) || /^\d+(?:\.\d+)*\.?\s+/u.test(value);
}

function isInstruction(value: string): boolean {
  return (
    !value ||
    value === "4" ||
    value.startsWith("{{") ||
    /^Each respondent\b/iu.test(value) ||
    /^(?:The asterisk|Employer Assessment Instructions)\b/iu.test(value)
  );
}

function extractSourceQuestions(sheet: ExcelJS.Worksheet): SourceQuestion[] {
  const questions: SourceQuestion[] = [];
  for (let rowNumber = 1; rowNumber <= sheet.rowCount; rowNumber += 1) {
    const question = sourceQuestionFromRow(
      text(sheet.getRow(rowNumber).getCell(1).value),
      rowNumber,
    );
    if (!question) continue;
    let subprompt = "";
    for (
      let optionRow = rowNumber + 1;
      optionRow <= sheet.rowCount;
      optionRow += 1
    ) {
      const row = sheet.getRow(optionRow);
      const first = decodeSurveyText(text(row.getCell(1).value));
      const second = decodeSurveyText(text(row.getCell(2).value));
      if (first && isQuestionBoundary(first)) break;
      if (first && !isInstruction(first)) subprompt = first;
      const label = optionLabel(second);
      if (!label) continue;
      question.options.push(subprompt ? `${subprompt} - ${label}` : label);
    }
    questions.push(question);
  }
  return questions;
}

function answerOptions(input: {
  defaults: SurveyDefinitionQuestion;
  source: SourceQuestion;
}): NonNullable<SurveyDefinitionQuestion["options"]> {
  const expected = input.defaults.options ?? [];
  if (
    input.defaults.dataLabel === "q_OrganizationalBenefits_NumberPaidHolidays"
  ) {
    return expected.map((option) => ({ ...option }));
  }
  const expectedByLabel = new Map(
    expected.map((option) => [normalizedLabel(option.Id), option]),
  );
  const expectedYesOnly =
    expected.length === 1 && normalizedLabel(expected[0]?.Id ?? "") === "yes";
  return input.source.options.flatMap((caption, index) => {
    if (expectedYesOnly && normalizedLabel(caption) !== "yes") return [];
    const matching = expectedByLabel.get(normalizedLabel(caption));
    return [
      {
        Id: matching?.Id ?? caption,
        Caption: caption,
        Position: index + 1,
        ...(matching?.Score !== undefined ? { Score: matching.Score } : {}),
      },
    ];
  });
}

export function convertEaQuestionResponseWorkbook(
  workbook: ExcelJS.Workbook,
  defaults: SurveyDefinition,
): EaQuestionResponseConversion {
  const sheet = workbook.getWorksheet("Questions") ?? workbook.worksheets[0];
  if (!sheet) throw new Error("Workbook contains no worksheets");
  const sourceQuestions = extractSourceQuestions(sheet);
  if (!sourceQuestions.length) {
    throw new Error(
      "No survey questions with trailing q_ question keys were found",
    );
  }

  const defaultsByKey = new Map(
    defaults.map((question) => [question.dataLabel, question]),
  );
  const converted = new Map<string, SurveyDefinitionQuestion>();
  const issues: EaQuestionResponseIssue[] = [];

  for (const source of sourceQuestions) {
    const canonicalKey = canonicalQuestionKey(source.key);
    const defaultQuestion = defaultsByKey.get(canonicalKey);
    if (!defaultQuestion) {
      issues.push({
        code: "unsupported-question",
        message: `Question is not used by Benefits & Best Practices: ${source.key}`,
        questionKey: source.key,
        row: source.row,
      });
      continue;
    }
    const options = answerOptions({ defaults: defaultQuestion, source });
    const previous = converted.get(canonicalKey);
    if (!previous) {
      converted.set(canonicalKey, {
        dataLabel: canonicalKey,
        caption: source.caption,
        ...(defaultQuestion.categoryLabel
          ? { categoryLabel: defaultQuestion.categoryLabel }
          : {}),
        position: converted.size + 1,
        ...(options.length ? { options } : {}),
      });
      continue;
    }
    previous.options ??= [];
    for (const option of options) {
      if (previous.options.some(({ Id }) => Id === option.Id)) {
        issues.push({
          code: "duplicate-answer",
          message: `Duplicate answer ${option.Id} for ${canonicalKey}`,
          questionKey: canonicalKey,
          row: source.row,
        });
        continue;
      }
      previous.options.push({
        ...option,
        Position: previous.options.length + 1,
      });
    }
  }

  const definition = [...converted.values()];
  for (const question of definition) {
    const expected = defaultsByKey.get(question.dataLabel);
    if (!expected) continue;
    const allowed = new Set((expected.options ?? []).map(({ Id }) => Id));
    for (const option of question.options ?? []) {
      if (allowed.has(option.Id)) continue;
      issues.push({
        code: "unsupported-answer",
        message: `EA definition answer is not used by ${question.dataLabel}: ${option.Id}`,
        questionKey: question.dataLabel,
      });
    }
  }

  const blockingCodes = new Set<EaQuestionResponseIssue["code"]>([
    "unsupported-answer",
    "missing-question-key",
    "duplicate-answer",
  ]);
  return {
    definition,
    issues,
    sourceQuestionCount: sourceQuestions.length,
    supportedQuestionCount: definition.length,
    answerCount: definition.reduce(
      (count, question) => count + (question.options?.length ?? 0),
      0,
    ),
    importable: !issues.some(({ code }) => blockingCodes.has(code)),
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
