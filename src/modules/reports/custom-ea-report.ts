import type { SurveyDefinition } from "../imports/survey-definition.js";
import type {
  BenefitsBestPracticesSnapshot,
  BenefitsBestPracticesQuestionSnapshot,
} from "./benefits-best-practices-workbook.js";
import type {
  BenefitsEaCohort,
  BenefitsEaOrganizationAnswers,
} from "./benefits-best-practices-from-ea.js";
import {
  canonicalEaQuestionKey,
  eaEligibility,
} from "../imports/ea-question-keys.js";
import { benefitsQuestionBindingForKey } from "./benefits-question-bindings.js";

export interface CustomEaReportDefinition {
  version: 2;
  questions: SurveyDefinition;
}

export function isCustomEaDefinition(definition: SurveyDefinition): boolean {
  return definition.some((q) => q.ea !== undefined);
}

export function customEaDefinitionFromMetadata(
  metadata: Record<string, unknown>,
): SurveyDefinition | undefined {
  const value = metadata.employerAssessmentReportDefinition;
  if (!value || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Partial<CustomEaReportDefinition>;
  return candidate.version === 2 && Array.isArray(candidate.questions)
    ? candidate.questions
    : undefined;
}

export function eaDefinitionMetadata(
  definition: SurveyDefinition,
): Record<string, unknown> {
  return isCustomEaDefinition(definition)
    ? {
        employerAssessmentReportDefinition: {
          version: 2,
          questions: definition,
        },
        employerAssessmentDefinition: null,
      }
    : {
        employerAssessmentDefinition: definition,
        employerAssessmentReportDefinition: null,
      };
}

export function mergeEaDefinitions(
  previous: SurveyDefinition | undefined,
  next: SurveyDefinition,
): SurveyDefinition {
  if (
    isCustomEaDefinition(next) ||
    (previous && isCustomEaDefinition(previous))
  )
    return next;
  const questions = new Map((previous ?? []).map((q) => [q.dataLabel, q]));
  for (const q of next)
    questions.set(q.dataLabel, { ...questions.get(q.dataLabel), ...q });
  return [...questions.values()];
}

/** Normalize typography only. Never guess a source by ordinal or display caption. */
function normalized(value: string): string {
  return canonicalEaQuestionKey(value)
    .normalize("NFKC")
    .replace(/[‘’]/gu, "'")
    .replace(/[“”]/gu, '"')
    .replace(/;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .toLowerCase();
}

/** Upgrade the previously supplied regional QA sheets using known survey contracts. */
export function normalizeEmployerAssessmentDefinition(
  definition: SurveyDefinition,
  defaults: SurveyDefinition,
): SurveyDefinition {
  if (isCustomEaDefinition(definition)) {
    validateCustomEaDefinition(definition);
    return definition;
  }
  const standard = new Map(defaults.map((q) => [q.dataLabel, q]));
  const needsCustom = definition.some(
    (q) =>
      !standard.has(q.dataLabel) ||
      q.options?.some(
        (o) => !standard.get(q.dataLabel)?.options?.some((d) => d.Id === o.Id),
      ),
  );
  if (!needsCustom) return definition;
  return definition.flatMap((question): SurveyDefinition => {
    const key = canonicalEaQuestionKey(question.dataLabel);
    const expected = standard.get(key);
    const binding = benefitsQuestionBindingForKey(key);
    const numeric =
      binding?.kind === "numeric" ||
      /NumberPaidHolidays|PctCostPaidByEmployerBenf|PctEmployeesWorkingRemote/u.test(
        key,
      );
    const extraMulti =
      /_(?:DEIInitiatives|Policies|Family|Wellness|WorkplacePerks)$/u.test(key);
    if (!expected && !numeric && !extraMulti && !binding)
      throw new Error(
        `EA question ${question.dataLabel}: add calculation and source_column in Questions for this custom question`,
      );
    if (
      key.endsWith("_Benefits") &&
      /standard offering/iu.test(question.caption)
    ) {
      return (question.options ?? []).map((option, index) => ({
        ...question,
        dataLabel: `${key}.${index + 1}`,
        ea: {
          calculation: "choice",
          sourceColumn: `${question.dataLabel}.${index + 1}`,
          format: "percent",
          groupKey: key,
          groupLabel: option.Caption,
        },
        options: [
          { Id: "1", Caption: "Standard Offering", Position: 1 },
          { Id: "2", Caption: "Optional Additional Benefit", Position: 2 },
          { Id: "3", Caption: "Not Offered", Position: 3 },
        ],
      }));
    }
    const yesNo =
      expected?.options?.length === 1 && expected.options[0]?.Id === "Yes";
    const choice =
      /_(?:PtoVacationSickPersonal|EligibilityHealthcareBene|NewHireEnrollHelthcreBenf|Conduct|FreqPer)$/u.test(
        key,
      );
    const calculation =
      (binding?.kind === "numeric" ? "mean" : binding?.kind) ??
      (numeric ? "mean" : yesNo ? "yesNo" : choice ? "choice" : "multi");
    const eligibility = binding?.eligibleWhenYes ?? eaEligibility(key);
    const eligibleSource = definition.find(
      (q) => canonicalEaQuestionKey(q.dataLabel) === eligibility,
    )?.dataLabel;
    const options = /NumberPaidHolidays|PctEmployeesWorkingRemote/u.test(key)
      ? undefined
      : question.options?.map((option) => ({
          ...option,
          Id:
            calculation === "yesNo"
              ? /^no$/iu.test(option.Id) || /^no$/iu.test(option.Caption)
                ? "2"
                : "1"
              : calculation === "choice"
                ? /^\d+$/u.test(option.Id)
                  ? option.Id
                  : /^none\b/iu.test(option.Caption)
                    ? "99"
                    : String(option.Position)
                : option.Id,
          ...(calculation === "multi" || calculation === "mean"
            ? { SourceColumn: `${question.dataLabel}. ${option.Id}` }
            : {}),
        }));
    return [
      {
        ...question,
        dataLabel: key,
        ea: {
          calculation,
          sourceColumn: question.dataLabel,
          format: numeric && !key.includes("Pct") ? "number" : "percent",
          ...(eligibleSource
            ? { eligibleQuestion: eligibleSource, eligibleValue: "1" }
            : {}),
        },
        ...(options ? { options } : { options: [] }),
      },
    ];
  });
}

function normalizedSource(value: string): string {
  return normalized(value).replace(/"/gu, "'").replace(/\.$/u, "");
}

/** Only long answer headers under the same question key can be shortened. */
function shortenedSourceMatches(source: string, column: string): boolean {
  const sourceParts = /^(q_[^.]+)\. (.+)$/u.exec(normalizedSource(source));
  const columnParts = /^(q_[^.]+)\. (.+)$/u.exec(normalizedSource(column));
  if (!sourceParts || !columnParts) return false;
  const answer = sourceParts[2] ?? "";
  const header = columnParts[2] ?? "";
  return (
    sourceParts[1] === columnParts[1] &&
    header.length >= 60 &&
    answer.length > header.length &&
    answer.startsWith(header)
  );
}

function eaSourceCandidates(
  source: string,
  columns: readonly string[],
): string[] {
  const exact = columns.filter((column) => column === source);
  if (exact.length) return exact;
  const equivalent = columns.filter(
    (column) => normalizedSource(column) === normalizedSource(source),
  );
  if (equivalent.length) return equivalent;
  return columns.filter((column) => shortenedSourceMatches(source, column));
}

export function resolveEaSource(
  source: string,
  columns: readonly string[],
  definitionSources: readonly string[] = [],
): string | undefined {
  return eaSourceResolver([source, ...definitionSources], columns)(source);
}

/** Resolve the whole catalog once, including collisions, rather than scanning it for every answer. */
function eaSourceResolver(
  sources: readonly string[],
  columns: readonly string[],
) {
  const candidates = new Map<string, string[]>();
  const owners = new Map<string, Set<string>>();
  for (const source of new Set(sources)) {
    const matches = eaSourceCandidates(source, columns);
    candidates.set(source, matches);
    for (const column of matches) {
      const claims = owners.get(column) ?? new Set<string>();
      claims.add(normalizedSource(source));
      owners.set(column, claims);
    }
  }
  return (source: string): string | undefined => {
    const matches = candidates.get(source) ?? [];
    const candidate = matches[0];
    return matches.length === 1 &&
      candidate !== undefined &&
      owners.get(candidate)?.size === 1
      ? candidate
      : undefined;
  };
}

function eaQuestionSources(question: SurveyDefinition[number]): string[] {
  const config = question.ea;
  if (!config) return [];
  const sources =
    config.calculation === "multi" ||
    (config.calculation === "mean" && question.options?.length)
      ? (question.options ?? []).map(
          (option) => option.SourceColumn ?? config.sourceColumn,
        )
      : [config.sourceColumn];
  if (config.eligibleQuestion) sources.push(config.eligibleQuestion);
  return [...new Set(sources)];
}

/** Skip only explicitly optional missing sources; keep ambiguous sources for validation. */
export function applicableEaDefinition(
  definition: SurveyDefinition,
  columns: readonly string[],
): SurveyDefinition {
  const exists = (source: string) =>
    eaSourceCandidates(source, columns).length > 0;
  return definition.flatMap((question): SurveyDefinition => {
    const config = question.ea;
    if (config?.missingSource !== "skip") return [question];
    // A reusable catalog's parent gate may not be asked in this program at all.
    // Retain the gate whenever its column exists, even when all its answers are blank.
    const ea = { ...config };
    if (ea.eligibleQuestion && !exists(ea.eligibleQuestion)) {
      delete ea.eligibleQuestion;
      delete ea.eligibleValue;
    }
    if (
      config.calculation === "multi" ||
      (config.calculation === "mean" && question.options?.length)
    ) {
      const options = (question.options ?? []).filter((option) =>
        exists(option.SourceColumn ?? config.sourceColumn),
      );
      return options.length ? [{ ...question, ea, options }] : [];
    }
    return exists(config.sourceColumn) ? [{ ...question, ea }] : [];
  });
}

export function validateCustomEaDefinition(definition: SurveyDefinition): void {
  for (const question of definition) {
    if (!question.ea)
      throw new Error(
        `EA question ${question.dataLabel}: add calculation and source_column for every custom report question`,
      );
    if (!question.ea.sourceColumn.trim())
      throw new Error(
        `EA question ${question.dataLabel}: source_column is required`,
      );
    if (question.ea.calculation !== "mean" && !question.options?.length)
      throw new Error(
        `EA question ${question.dataLabel}: add raw_answer and answer_label mappings`,
      );
    if (
      (question.ea.calculation === "multi" ||
        question.ea.calculation === "mean") &&
      question.options?.some((option) => !option.SourceColumn?.trim())
    )
      throw new Error(
        `EA question ${question.dataLabel}: Answers source_column is required for each multi-select or numeric answer`,
      );
  }
}

export function validateCustomEaSources(
  definition: SurveyDefinition,
  columns: readonly string[],
): string[] {
  const issues: string[] = [];
  const definitionSources = definition.flatMap(eaQuestionSources);
  const resolve = eaSourceResolver(definitionSources, columns);
  for (const question of applicableEaDefinition(definition, columns)) {
    for (const source of eaQuestionSources(question)) {
      if (resolve(source)) continue;
      const ambiguous = eaSourceCandidates(source, columns).length > 0;
      issues.push(
        `EA question ${question.dataLabel}: source column ${source} ${ambiguous ? "is ambiguous" : "was not found"}. Correct source_column in the Questions or Answers sheet to match the EA export.`,
      );
    }
  }
  return issues;
}

function scalar(value: unknown): unknown {
  if (Array.isArray(value)) return scalar(value[0]);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return scalar(record.value ?? record.result ?? null);
  }
  return value;
}
function present(value: unknown): boolean {
  const v = scalar(value);
  return v !== undefined && v !== null && String(v).trim() !== "";
}
function matches(value: unknown, code: string): boolean {
  if (!present(value)) return false;
  return normalized(String(scalar(value))) === normalized(code);
}
function selected(value: unknown, label: string): boolean {
  const v = scalar(value);
  if (v === true || matches(v, "1") || matches(v, "yes") || matches(v, "true"))
    return true;
  return /^other\b/iu.test(label) && present(v) && !Number.isFinite(Number(v));
}

export function generateCustomEaReport(input: {
  definition: SurveyDefinition;
  answers: BenefitsEaOrganizationAnswers[];
  cohorts: BenefitsEaCohort[];
  minimumOrganizations?: number;
}): BenefitsBestPracticesSnapshot {
  validateCustomEaDefinition(input.definition);
  const answers = new Map(
    input.answers.map((answer) => [answer.organizationId, answer.values]),
  );
  const columns = [
    ...new Set(input.answers.flatMap((answer) => Object.keys(answer.values))),
  ];
  const sourceMap = new Map<string, string | undefined>();
  const definitionSources = input.definition.flatMap(eaQuestionSources);
  const resolve = eaSourceResolver(definitionSources, columns);
  const read = (values: Record<string, unknown>, source: string): unknown => {
    if (!sourceMap.has(source)) sourceMap.set(source, resolve(source));
    const resolved = sourceMap.get(source);
    return resolved ? values[resolved] : undefined;
  };
  const cohorts = input.cohorts.filter(
    (c) =>
      c.title
        .replace(/\s+employers?$/iu, "")
        .trim()
        .toLowerCase() !== "default",
  );
  const sections: BenefitsBestPracticesSnapshot["sections"] = [];
  const groups = new Map<string, BenefitsBestPracticesQuestionSnapshot>();
  for (const question of applicableEaDefinition(
    input.definition,
    columns,
  ).toSorted((a, b) => (a.position ?? 0) - (b.position ?? 0))) {
    const config = question.ea;
    if (!config)
      throw new Error(`Missing calculation for ${question.dataLabel}`);
    const category = question.categoryLabel ?? "Benefits & Best Practices";
    let section = sections.find((section) => section.title === category);
    if (!section) {
      section = { title: category, questions: [] };
      sections.push(section);
    }
    const groupKey = `${category}:${config.groupKey ?? question.dataLabel}`;
    let output = groups.get(groupKey);
    if (!output) {
      output = { text: question.caption, responses: [] };
      groups.set(groupKey, output);
      section.questions.push(output);
    }
    const options = question.options?.length
      ? question.options.toSorted((a, b) => a.Position - b.Position)
      : [{ Id: "mean", Caption: question.caption, Position: 1 }];
    for (const option of options) {
      const source =
        "SourceColumn" in option && option.SourceColumn
          ? option.SourceColumn
          : config.sourceColumn;
      output.responses.push({
        label: option.Caption,
        format: config.format,
        ...(config.groupLabel ? { groupLabel: config.groupLabel } : {}),
        dataValues: cohorts.map((cohort) => {
          const organizations = cohort.organizationIds.flatMap((id) => {
            const values = answers.get(id);
            return values ? [values] : [];
          });
          if (organizations.length < (input.minimumOrganizations ?? 5))
            return "x";
          const eligible = organizations.filter(
            (values) =>
              !config.eligibleQuestion ||
              matches(
                read(values, config.eligibleQuestion),
                config.eligibleValue ?? "1",
              ),
          );
          if (!eligible.length) return "x";
          if (config.calculation === "multi")
            return (
              (eligible.filter((values) =>
                selected(read(values, source), option.Caption),
              ).length *
                100) /
              eligible.length
            );
          const values = eligible
            .map((values) => read(values, source))
            .filter(present);
          if (config.calculation === "mean") {
            const numbers = values
              .map(scalar)
              .map((value) => Number(value))
              .filter(Number.isFinite);
            return numbers.length
              ? numbers.reduce((a, b) => a + b, 0) / numbers.length
              : "x";
          }
          return values.length
            ? (values.filter((value) => matches(value, option.Id)).length *
                100) /
                values.length
            : "x";
        }),
      });
    }
  }
  return {
    headers: cohorts.map(({ title, type }) => ({ title, type })),
    sections,
    sourceFile: "generated-from-ea",
  };
}
