import adQuestions from "./ad-ea-template-questions.json" with { type: "json" };
import { loadDefaultBenefitsBestPracticesDefinition } from "../reports/benefits-best-practices-from-ea.js";
import {
  normalizeEmployerAssessmentDefinition,
  validateCustomEaDefinition,
} from "../reports/custom-ea-report.js";
import {
  mergeSurveyDefinitions,
  type SurveyDefinition,
} from "./survey-definition.js";

function optionKey(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[‘’“”"]/gu, "'")
    .replace(/;/gu, " ")
    .replace(/\s+/gu, " ")
    .trim()
    .replace(/\.$/u, "")
    .toLowerCase();
}

/** The reusable upload catalog is independent of the legacy report's default layout. */
export async function loadDefaultEaTemplateDefinition(
  overrides: SurveyDefinition = [],
): Promise<SurveyDefinition> {
  const defaults = await loadDefaultBenefitsBestPracticesDefinition();
  const base = mergeSurveyDefinitions(defaults, overrides);
  const additions: SurveyDefinition = adQuestions;
  const definition = normalizeEmployerAssessmentDefinition(
    [
      ...base,
      ...additions.filter(
        (q) => !base.some((b) => b.dataLabel === q.dataLabel),
      ),
    ],
    defaults,
  );
  const ad = normalizeEmployerAssessmentDefinition(additions, defaults);
  const merged = definition.map((question, index) => {
    const extra = ad.find((q) => q.dataLabel === question.dataLabel);
    const options = [...(question.options ?? [])];
    for (const option of extra?.options ?? []) {
      const key = optionKey(option.SourceColumn ?? option.Id);
      if (
        !options.some(
          (existing) => optionKey(existing.SourceColumn ?? existing.Id) === key,
        )
      )
        options.push({ ...option, Position: options.length + 1 });
    }
    if (!question.ea)
      throw new Error(`Missing EA template mapping for ${question.dataLabel}`);
    return {
      ...question,
      position: index + 1,
      ea: { ...question.ea, missingSource: "skip" as const },
      options,
    };
  });
  validateCustomEaDefinition(merged);
  return merged;
}
