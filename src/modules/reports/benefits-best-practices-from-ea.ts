import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import {
  parseBenefitsBestPracticesWorkbook,
  type BenefitsBestPracticesQuestionSnapshot,
  type BenefitsBestPracticesSnapshot,
  type PublishedReportHeader,
} from "./benefits-best-practices-workbook.js";
import type {
  SurveyDefinition,
  SurveyDefinitionQuestion,
} from "../imports/survey-definition.js";

export interface BenefitsEaCohort {
  organizationIds: string[];
  title: string;
  type: string;
}

export interface BenefitsEaOrganizationAnswers {
  organizationId: string;
  values: Record<string, unknown>;
}

export interface GenerateBenefitsBestPracticesFromEaInput {
  answers: BenefitsEaOrganizationAnswers[];
  cohorts: BenefitsEaCohort[];
  minimumOrganizations?: number;
  template: BenefitsBestPracticesSnapshot;
}

type BenefitsQuestionKind = "yesNo" | "numeric" | "choice" | "multi";

interface BenefitsQuestionBinding {
  dataLabel: string;
  kind: BenefitsQuestionKind;
  match: RegExp;
  answerRange?: readonly [minimum: number, maximum: number];
  eligibleWhenYes?: string;
}

const benefitsQuestionBindings: BenefitsQuestionBinding[] = [
  {
    match: /coordinate\s+[“"']fun["'”] activities/iu,
    dataLabel: "q_EmployerInformation_FunActivities",
    kind: "yesNo",
  },
  {
    match: /structured system for recognizing achievements/iu,
    dataLabel: "q_EmployerInformation_RecognizingAchievements",
    kind: "yesNo",
  },
  {
    match: /formally recognize individual employee milestones/iu,
    dataLabel: "q_EmployerInformation_RecognizeEmployeeMilestones",
    kind: "yesNo",
  },
  {
    match: /strategy to recruit and retain a diverse workforce/iu,
    dataLabel: "q_RecruitingandEmploymentPractices_StrategyRecruit",
    kind: "yesNo",
  },
  {
    match: /recruit and retain generation z/iu,
    dataLabel: "q_RecruitingandEmploymentPractices_RecruitGenZ",
    kind: "yesNo",
  },
  {
    match: /utilize pre-employment screening/iu,
    dataLabel: "q_RecruitingandEmploymentPractices_UtilizePreEmply",
    kind: "yesNo",
  },
  {
    match: /which pre-employment screening/iu,
    dataLabel: "q_RecruitingandEmploymentPractices_Screening",
    kind: "multi",
    eligibleWhenYes: "q_RecruitingandEmploymentPractices_UtilizePreEmply",
  },
  {
    match: /formal grievance procedure/iu,
    dataLabel: "q_DiversityEquityandInclusion_FormalGrievanceProc",
    kind: "yesNo",
  },
  {
    match: /formal diversity and inclusion training/iu,
    dataLabel: "q_DiversityEquityandInclusion_FormalInclusionDiver",
    kind: "yesNo",
  },
  {
    match: /employee resource groups/iu,
    dataLabel: "q_DiversityEquityandInclusion_EmployeeResourceGrou",
    kind: "yesNo",
  },
  {
    match: /how many employer-paid holidays/iu,
    dataLabel: "q_OrganizationalBenefits_NumberPaidHolidays",
    kind: "numeric",
    answerRange: [1, 25],
  },
  {
    match: /which employer-paid holidays/iu,
    dataLabel: "q_OrganizationalBenefits_SelectPaidHolidays",
    kind: "multi",
  },
  {
    match: /offer pto or vacation\/sick\/personal time/iu,
    dataLabel: "q_OrganizationalBenefits_OfferPTOVSP",
    kind: "yesNo",
  },
  {
    match: /pto \(one bank of time\) or as vacation\/sick\/personal/iu,
    dataLabel: "q_OrganizationalBenefits_PtoVacationSickPersonal",
    kind: "choice",
    eligibleWhenYes: "q_OrganizationalBenefits_OfferPTOVSP",
  },
  {
    match: /offer unlimited pto/iu,
    dataLabel: "q_OrganizationalBenefits_OfferUnlimitedPTO",
    kind: "yesNo",
    eligibleWhenYes: "q_OrganizationalBenefits_OfferPTOVSP",
  },
  {
    match: /offer unlimited vacation days/iu,
    dataLabel: "q_OrganizationalBenefits_OfferUnlimitedVacationDay",
    kind: "yesNo",
    eligibleWhenYes: "q_OrganizationalBenefits_OfferPTOVSP",
  },
  {
    match: /offer unlimited sick days/iu,
    dataLabel: "q_OrganizationalBenefits_OfferUnlimitedSickDays",
    kind: "yesNo",
    eligibleWhenYes: "q_OrganizationalBenefits_OfferPTOVSP",
  },
  {
    match: /offer unlimited personal days/iu,
    dataLabel: "q_OrganizationalBenefits_OfferUnlimitedPersonalDay",
    kind: "yesNo",
    eligibleWhenYes: "q_OrganizationalBenefits_OfferPTOVSP",
  },
  {
    match: /offer healthcare benefits/iu,
    dataLabel: "q_OrganizationalBenefits_HealthcareBenefits",
    kind: "yesNo",
  },
  {
    match: /who is eligible for healthcare benefits/iu,
    dataLabel: "q_OrganizationalBenefits_EligibilityHealthcareBene",
    kind: "choice",
    eligibleWhenYes: "q_OrganizationalBenefits_HealthcareBenefits",
  },
  {
    match: /when can a new hire enroll/iu,
    dataLabel: "q_OrganizationalBenefits_NewHireEnrollHelthcreBenf",
    kind: "choice",
    eligibleWhenYes: "q_OrganizationalBenefits_HealthcareBenefits",
  },
  {
    match: /check mark next to each benefit provided/iu,
    dataLabel: "q_OrganizationalBenefits_Benefits",
    kind: "multi",
    eligibleWhenYes: "q_OrganizationalBenefits_HealthcareBenefits",
  },
  {
    match: /percentage of the premium cost/iu,
    dataLabel: "q_OrganizationalBenefits_PctCostPaidByEmployerBenf",
    kind: "numeric",
    eligibleWhenYes: "q_OrganizationalBenefits_HealthcareBenefits",
  },
  {
    match: /third-party resources to receive help/iu,
    dataLabel: "q_OrganizationalBenefits_ThirdPartyResources",
    kind: "yesNo",
  },
  {
    match: /offer an employee retirement plan/iu,
    dataLabel: "q_OrganizationalBenefits_RetirementPlan",
    kind: "multi",
  },
  {
    match: /participate in ownership/iu,
    dataLabel: "q_OrganizationalBenefits_Esop",
    kind: "yesNo",
  },
  {
    match: /tuition reimbursement/iu,
    dataLabel: "q_OrganizationalBenefits_Tuition",
    kind: "multi",
  },
  {
    match: /give back to the community/iu,
    dataLabel: "q_GivingBackandWorkplaceWellness_GivingBack",
    kind: "multi",
  },
  {
    match: /support health and wellness/iu,
    dataLabel: "q_GivingBackandWorkplaceWellness_SupportHealthandW",
    kind: "multi",
  },
  {
    match: /mental stress, fatigue, and\/or burnout/iu,
    dataLabel: "q_GivingBackandWorkplaceWellness_LookForDealBurnou",
    kind: "yesNo",
  },
  {
    match: /family-friendly benefits/iu,
    dataLabel: "q_GivingBackandWorkplaceWellness_FamilyFriendlyBen",
    kind: "multi",
  },
  {
    match: /work-life balance benefits/iu,
    dataLabel: "q_GivingBackandWorkplaceWellness_WLBBenefits",
    kind: "multi",
  },
  {
    match: /conduct employee engagement surveys/iu,
    dataLabel: "q_EmployeeFeedbackDevelopmentandEngagement_Conduct",
    kind: "choice",
  },
  {
    match: /conduct performance reviews/iu,
    dataLabel: "q_EmployeeFeedbackDevelopmentandEngagement_FreqPer",
    kind: "choice",
  },
  {
    match: /professional development and\/or career advancement/iu,
    dataLabel: "q_EmployeeFeedbackDevelopmentandEngagement_EmplyPr",
    kind: "yesNo",
  },
  {
    match: /prepares employees for leadership roles/iu,
    dataLabel: "q_EmployeeFeedbackDevelopmentandEngagement_Leaders",
    kind: "multi",
  },
  {
    match: /workplace-related training/iu,
    dataLabel: "q_EmployeeFeedbackDevelopmentandEngagement_Workspa",
    kind: "multi",
  },
];

const defaultMinimumOrganizations = 5;

function normalizeOption(value: string): string {
  return value
    .toLowerCase()
    .replace(/[“”"']/gu, "")
    .replace(/[^a-z0-9]+/gu, " ")
    .trim();
}

function isNoneOption(label: string): boolean {
  return /does not|none of the above|not offer|not formally support/iu.test(
    label,
  );
}

function bindingForQuestion(
  question: BenefitsBestPracticesQuestionSnapshot,
): BenefitsQuestionBinding | undefined {
  return benefitsQuestionBindings.find(({ match }) =>
    match.test(question.text),
  );
}

/** The bundled report workbook remains the source of the default EA labels. */
export function benefitsBestPracticesDefinition(
  template: BenefitsBestPracticesSnapshot,
): SurveyDefinition {
  let position = 0;
  return template.sections.flatMap((section) =>
    section.questions.flatMap((question) => {
      const binding = bindingForQuestion(question);
      if (!binding) return [];
      position += 1;
      const answerRange = binding.answerRange;
      const options = answerRange
        ? Array.from(
            {
              length: answerRange[1] - answerRange[0] + 1,
            },
            (_, index) => {
              const value = answerRange[0] + index;
              return {
                Id: String(value),
                Caption: String(value),
                Position: index + 1,
              };
            },
          )
        : question.responses.map((response, index) => ({
            Id: response.label,
            Caption: response.label,
            Position: index + 1,
          }));
      return [
        {
          dataLabel: binding.dataLabel,
          caption: question.text,
          categoryLabel: section.title,
          position,
          options,
        } satisfies SurveyDefinitionQuestion,
      ];
    }),
  );
}

export function validateBenefitsBestPracticesDefinition(
  definition: SurveyDefinition,
  defaults: SurveyDefinition,
): void {
  const defaultsByKey = new Map(
    defaults.map((question) => [question.dataLabel, question]),
  );
  for (const question of definition) {
    const expected = defaultsByKey.get(question.dataLabel);
    if (!expected) {
      throw new Error(
        `EA definition question is not used by Benefits & Best Practices: ${question.dataLabel}`,
      );
    }
    const expectedAnswers = new Set(
      (expected.options ?? []).map((option) => option.Id),
    );
    for (const option of question.options ?? []) {
      if (!expectedAnswers.has(option.Id)) {
        throw new Error(
          `EA definition answer is not used by ${question.dataLabel}: ${option.Id}`,
        );
      }
    }
  }
}

/** Relabel after calculation so customized captions never alter EA value matching. */
export function applyBenefitsBestPracticesDefinition(
  snapshot: BenefitsBestPracticesSnapshot,
  definition: SurveyDefinition | undefined,
): BenefitsBestPracticesSnapshot {
  if (!definition?.length) return snapshot;
  const byKey = new Map(
    definition.map((question) => [question.dataLabel, question]),
  );
  return {
    ...snapshot,
    sections: snapshot.sections.map((section) => {
      const mappedQuestions = section.questions.map((question) => {
        const binding = bindingForQuestion(question);
        const configured = binding ? byKey.get(binding.dataLabel) : undefined;
        const answers = new Map(
          (configured?.options ?? []).map((option) => [
            option.Id,
            option.Caption,
          ]),
        );
        return {
          ...question,
          text: configured?.caption ?? question.text,
          responses: question.responses.map((response) => ({
            ...response,
            label: answers.get(response.label) ?? response.label,
          })),
        };
      });
      const configuredCategory = section.questions
        .map((question) => {
          const binding = bindingForQuestion(question);
          return binding
            ? byKey.get(binding.dataLabel)?.categoryLabel
            : undefined;
        })
        .find((label): label is string => Boolean(label));
      return {
        ...section,
        title: configuredCategory ?? section.title,
        questions: mappedQuestions,
      };
    }),
  };
}

function answerScalar(value: unknown): unknown {
  if (Array.isArray(value)) return answerScalar(value[0]);
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if ("value" in record) return answerScalar(record.value);
    if ("result" in record) return answerScalar(record.result);
  }
  return value;
}

function numericAnswer(value: unknown): number | null {
  const scalar = answerScalar(value);
  if (typeof scalar === "boolean") return scalar ? 1 : 0;
  if (typeof scalar === "number" && Number.isFinite(scalar)) return scalar;
  if (typeof scalar === "string") {
    const trimmed = scalar.trim();
    if (!trimmed) return null;
    if (/^(?:yes|true)$/iu.test(trimmed)) return 1;
    if (/^(?:no|false)$/iu.test(trimmed)) return 0;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function isYes(value: unknown): boolean {
  const number = numericAnswer(value);
  if (number !== null) return number === 1;
  const scalar = answerScalar(value);
  return typeof scalar === "string" && /^(?:yes|true)$/iu.test(scalar.trim());
}

function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

function optionKeys(
  values: Record<string, unknown>,
  prefix: string,
): Array<[string, unknown]> {
  const startsWith = `${prefix}.`;
  return Object.entries(values).filter(
    ([dataLabel]) =>
      dataLabel === `${prefix}.other` || dataLabel.startsWith(startsWith),
  );
}

function optionValue(
  values: Record<string, unknown>,
  prefix: string,
  optionLabel: string,
): unknown {
  const exact = values[`${prefix}. ${optionLabel}`];
  if (exact !== undefined) return exact;
  const otherKey = `${prefix}.other`;
  if (/^other\b/iu.test(optionLabel) && values[otherKey] !== undefined) {
    return values[otherKey];
  }
  const needle = normalizeOption(optionLabel);
  for (const [dataLabel, value] of optionKeys(values, prefix)) {
    const suffix = dataLabel.slice(prefix.length).replace(/^\.\s*/u, "");
    if (normalizeOption(suffix) === needle) return value;
  }
  return undefined;
}

function matchesChoice(
  value: unknown,
  optionLabel: string,
  optionIndex: number,
  optionCount: number,
): boolean {
  const scalar = answerScalar(value);
  if (
    typeof scalar === "string" &&
    normalizeOption(scalar) === normalizeOption(optionLabel)
  ) {
    return true;
  }
  const number = numericAnswer(value);
  if (number === null) return false;
  if (
    number === 99 &&
    isNoneOption(optionLabel) &&
    optionIndex === optionCount - 1
  ) {
    return true;
  }
  return number === optionIndex + 1;
}

function cohortOrganizations(
  cohort: BenefitsEaCohort,
  answersByOrganization: Map<string, Record<string, unknown>>,
): Array<Record<string, unknown>> {
  return cohort.organizationIds.flatMap((organizationId) => {
    const values = answersByOrganization.get(organizationId);
    return values ? [values] : [];
  });
}

function percent(count: number, denominator: number): number | "x" {
  if (denominator === 0) return "x";
  return (count * 100) / denominator;
}

function average(values: number[]): number | "x" {
  if (values.length === 0) return "x";
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function valueForResponse(input: {
  binding: BenefitsQuestionBinding;
  organizations: Array<Record<string, unknown>>;
  optionIndex: number;
  optionLabel: string;
  optionCount: number;
  questionText: string;
}): number | string {
  const { binding, organizations, optionLabel, optionIndex, optionCount } =
    input;
  const eligibilityQuestion = binding.eligibleWhenYes;
  const eligibleOrganizations = eligibilityQuestion
    ? organizations.filter((values) => isYes(values[eligibilityQuestion]))
    : organizations;
  if (eligibleOrganizations.length === 0) return "x";

  if (binding.kind === "yesNo") {
    const answered = eligibleOrganizations.filter((values) =>
      isPresent(values[binding.dataLabel]),
    );
    if (answered.length === 0) return "x";
    const yesCount = answered.filter((values) =>
      isYes(values[binding.dataLabel]),
    ).length;
    if (/^no$/iu.test(optionLabel)) {
      return percent(answered.length - yesCount, answered.length);
    }
    return percent(yesCount, answered.length);
  }

  if (binding.kind === "multi") {
    const selected = eligibleOrganizations.filter((values) =>
      isYes(optionValue(values, binding.dataLabel, optionLabel)),
    ).length;
    return percent(selected, eligibleOrganizations.length);
  }

  if (binding.kind === "choice") {
    const answered = eligibleOrganizations.filter((values) =>
      isPresent(values[binding.dataLabel]),
    );
    if (answered.length === 0) return "x";
    const matched = answered.filter((values) =>
      matchesChoice(
        values[binding.dataLabel],
        optionLabel,
        optionIndex,
        optionCount,
      ),
    ).length;
    return percent(matched, answered.length);
  }

  const numbers = eligibleOrganizations.flatMap((values) => {
    const raw =
      optionLabel === input.questionText
        ? values[binding.dataLabel]
        : optionValue(values, binding.dataLabel, optionLabel);
    const number = numericAnswer(raw);
    return number === null ? [] : [number];
  });
  return average(numbers);
}

export function generateBenefitsBestPracticesFromEa(
  input: GenerateBenefitsBestPracticesFromEaInput,
): BenefitsBestPracticesSnapshot {
  const minimumOrganizations =
    input.minimumOrganizations ?? defaultMinimumOrganizations;
  // "Default" is the fallback assigned to organizations without a configured
  // size category. The All cohort already contains those organizations, so a
  // separate Default pair is both duplicate and misleading in the report.
  const cohorts = input.cohorts.filter(
    (cohort) =>
      cohort.title
        .replace(/\s+employers?$/iu, "")
        .trim()
        .toLowerCase() !== "default",
  );
  const answersByOrganization = new Map(
    input.answers.map((entry) => [entry.organizationId, entry.values]),
  );
  const headers: PublishedReportHeader[] = cohorts.map((cohort) => ({
    title: cohort.title,
    type: cohort.type,
  }));

  return {
    headers,
    sourceFile: "generated-from-ea",
    sections: input.template.sections.map((section) => ({
      title: section.title,
      questions: section.questions.map((question) => {
        const binding = bindingForQuestion(question);
        return {
          text: question.text,
          responses: question.responses.map((response, optionIndex) => ({
            format: response.format,
            label: response.label,
            dataValues: cohorts.map((cohort) => {
              const organizations = cohortOrganizations(
                cohort,
                answersByOrganization,
              );
              if (organizations.length < minimumOrganizations) return "x";
              if (!binding) return "x";
              return valueForResponse({
                binding,
                organizations,
                optionIndex,
                optionLabel: response.label,
                optionCount: question.responses.length,
                questionText: question.text,
              });
            }),
          })),
        };
      }),
    })),
  };
}

export async function loadBenefitsBestPracticesTemplate(): Promise<BenefitsBestPracticesSnapshot> {
  const templatePath = fileURLToPath(
    new URL("./report-templates/benefits-best-practices.xlsx", import.meta.url),
  );
  const buffer = await readFile(templatePath);
  return parseBenefitsBestPracticesWorkbook(
    buffer,
    "benefits-best-practices.xlsx",
  );
}

export async function loadDefaultBenefitsBestPracticesDefinition(): Promise<SurveyDefinition> {
  return benefitsBestPracticesDefinition(
    await loadBenefitsBestPracticesTemplate(),
  );
}
