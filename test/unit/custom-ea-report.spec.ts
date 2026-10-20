import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { readFile } from "node:fs/promises";
import type { PrismaService } from "../../src/database/prisma.service.js";
import { convertEaQuestionResponseWorkbook } from "../../src/modules/imports/ea-question-response-converter.js";
import {
  parseSurveyDefinition,
  type SurveyDefinition,
} from "../../src/modules/imports/survey-definition.js";
import { surveyDefinitionWorkbook } from "../../src/modules/imports/program-survey-definition.service.js";
import {
  generateCustomEaReport,
  validateCustomEaSources,
  validateCustomEaDefinition,
  mergeEaDefinitions,
  normalizeEmployerAssessmentDefinition,
  eaDefinitionMetadata,
  resolveEaSource,
} from "../../src/modules/reports/custom-ea-report.js";
import { loadDefaultBenefitsBestPracticesDefinition } from "../../src/modules/reports/benefits-best-practices-from-ea.js";
import { ProgramSurveyDefinitionService } from "../../src/modules/imports/program-survey-definition.service.js";
import { HistoricalImportService } from "../../src/modules/imports/historical-import.service.js";
import { createBenefitsWorkbook } from "../../src/modules/reports/report-template-workbooks.js";
const definition: SurveyDefinition = [
  {
    dataLabel: "holidays",
    position: 1,
    caption: "Bank holidays",
    categoryLabel: "Benefits",
    ea: { calculation: "multi", sourceColumn: "holidays", format: "percent" },
    options: [
      {
        Id: "Boxing Day",
        Caption: "Boxing Day",
        Position: 1,
        SourceColumn: "holidays. Boxing Day",
      },
      {
        Id: "Other",
        Caption: "Other",
        Position: 2,
        SourceColumn: "holidays.other",
      },
    ],
  },
  {
    dataLabel: "benefits.1",
    position: 2,
    caption: "Supplementary benefits",
    categoryLabel: "Benefits",
    ea: {
      calculation: "choice",
      sourceColumn: "benefits.1",
      format: "percent",
      groupKey: "benefits",
      groupLabel: "Life Assurance",
    },
    options: [
      { Id: "7", Caption: "Standard", Position: 2 },
      { Id: "3", Caption: "Optional", Position: 1 },
    ],
  },
  {
    dataLabel: "count",
    position: 3,
    caption: "Holiday count",
    categoryLabel: "Benefits",
    ea: { calculation: "mean", sourceColumn: "count", format: "number" },
  },
];
test("custom EA calculates new holidays, raw matrix codes, and numeric means independently of display order", () => {
  const result = generateCustomEaReport({
    definition,
    minimumOrganizations: 1,
    cohorts: [
      { title: "All", type: "All_All", organizationIds: ["a", "b", "c"] },
    ],
    answers: [
      {
        organizationId: "a",
        values: {
          "holidays. Boxing Day": 1,
          "holidays.other": "Birthday",
          "benefits.1": 7,
          count: 32,
        },
      },
      { organizationId: "b", values: { "benefits.1": 3, count: 0 } },
      { organizationId: "c", values: { count: null } },
    ],
  });
  const questions = required(result.sections[0]).questions;
  assert.equal(
    required(required(questions[0]).responses[0]).dataValues[0],
    100 / 3,
  );
  assert.equal(
    required(required(questions[0]).responses[1]).dataValues[0],
    100 / 3,
  );
  assert.deepEqual(
    required(questions[1]).responses.map((r) => [
      r.label,
      r.groupLabel,
      r.dataValues[0],
    ]),
    [
      ["Optional", "Life Assurance", 50],
      ["Standard", "Life Assurance", 50],
    ],
  );
  assert.equal(required(required(questions[2]).responses[0]).dataValues[0], 16);
});
test("custom definitions round-trip source mappings without turning raw codes into positions", async () => {
  assert.deepEqual(
    await parseSurveyDefinition(await surveyDefinitionWorkbook(definition)),
    definition
      .map((q) => ({
        ...q,
        options: q.options?.toSorted((a, b) => a.Position - b.Position),
      }))
      .map(({ options, ...q }) => (options ? { ...q, options } : q)),
  );
});
test("custom source validation accepts punctuation variants but rejects missing and ambiguous columns", () => {
  const d: SurveyDefinition = [
    {
      dataLabel: "holiday",
      caption: "Holiday",
      ea: { calculation: "multi", sourceColumn: "holiday", format: "percent" },
      options: [
        {
          Id: "New Year's Day",
          Caption: "New Year’s Day",
          Position: 1,
          SourceColumn: "holiday. New Year's Day",
        },
      ],
    },
  ];
  assert.deepEqual(validateCustomEaSources(d, ["holiday. New Year’s Day"]), []);
  assert.match(required(validateCustomEaSources(d, [])[0]), /not found/u);
  assert.match(
    required(
      validateCustomEaSources(d, [
        "holiday. New Year’s Day",
        "HOLIDAY. NEW YEAR’S DAY",
      ])[0],
    ),
    /ambiguous/u,
  );
});
test("EA source matching accepts shortened AD headers and quote differences through validation and calculation", () => {
  const community = "q_GivingBackandWorkplaceWellness_GivingBack";
  const training = "q_TrainingandCareerDevelopment_Leaders";
  const shortened = `${community}. We allow employees to participate in community service during normal`;
  const quoted = `${training}. Internal 'lunch and learn' or professional development sessions`;
  const d: SurveyDefinition = [
    {
      dataLabel: community,
      caption: "Community",
      ea: { calculation: "multi", sourceColumn: community, format: "percent" },
      options: [
        {
          Id: "community",
          Caption: "Paid volunteering",
          Position: 1,
          SourceColumn: `${shortened} business hours without losing pay or using vacation time`,
        },
      ],
    },
    {
      dataLabel: training,
      caption: "Training",
      ea: { calculation: "multi", sourceColumn: training, format: "percent" },
      options: [
        {
          Id: "training",
          Caption: "Lunch and learn",
          Position: 1,
          SourceColumn: `${training}. Internal "lunch and learn" or professional development sessions`,
        },
      ],
    },
  ];
  assert.deepEqual(validateCustomEaSources(d, [shortened, quoted]), []);
  const result = generateCustomEaReport({
    definition: d,
    minimumOrganizations: 1,
    cohorts: [{ title: "All", type: "All_All", organizationIds: ["a", "b"] }],
    answers: [
      { organizationId: "a", values: { [shortened]: 1, [quoted]: 1 } },
      { organizationId: "b", values: { [shortened]: 0, [quoted]: 0 } },
    ],
  });
  assert.deepEqual(
    result.sections.flatMap((s) =>
      s.questions.flatMap((q) => q.responses.map((r) => r.dataValues[0])),
    ),
    [50, 50],
  );
});

test("EA shortened header matching rejects ambiguous mappings and unrelated or short prefixes", () => {
  const prefix =
    "q_GivingBackandWorkplaceWellness_GivingBack. We allow employees to participate in community service during normal";
  const full = `${prefix} business hours without losing pay or using vacation time`;
  assert.equal(resolveEaSource(full, [prefix]), prefix);
  assert.equal(
    resolveEaSource(full, [prefix, `${prefix} business hours`]),
    undefined,
  );
  assert.equal(
    resolveEaSource(full, [prefix.replace("GivingBack.", "Other.")]),
    undefined,
  );
  assert.equal(
    resolveEaSource(full, [
      "q_GivingBackandWorkplaceWellness_GivingBack. We allow employees",
    ]),
    undefined,
  );
  assert.equal(resolveEaSource(full, [full, prefix]), full);
  const d: SurveyDefinition = [
    {
      dataLabel: "community",
      caption: "Community",
      ea: {
        calculation: "multi",
        sourceColumn: "community",
        format: "percent",
      },
      options: [full, `${prefix} business hours using vacation time`].map(
        (source, i) => ({
          Id: String(i),
          Caption: source,
          Position: i + 1,
          SourceColumn: source,
        }),
      ),
    },
  ];
  const issues = validateCustomEaSources(d, [prefix]);
  assert.equal(issues.length, 2);
  assert.ok(issues.every((issue) => issue.includes("ambiguous")));
  const quoteSource =
    'q_TrainingandCareerDevelopment_Leaders. Internal "lunch and learn"';
  assert.equal(
    resolveEaSource(quoteSource, [
      quoteSource.replaceAll('"', "'"),
      quoteSource.replaceAll('"', "‘"),
    ]),
    undefined,
  );
});

test("custom reports retain the existing five-assessment confidentiality minimum and explicit eligibility", () => {
  const d: SurveyDefinition = [
    {
      dataLabel: "choice",
      caption: "Choice",
      ea: {
        calculation: "choice",
        sourceColumn: "choice",
        format: "percent",
        eligibleQuestion: "gate",
        eligibleValue: "7",
      },
      options: [{ Id: "99", Caption: "None", Position: 1 }],
    },
  ];
  const answers = ["a", "b", "c", "d", "e"].map((organizationId, index) => ({
    organizationId,
    values: { gate: index < 2 ? 7 : 2, choice: index === 0 ? 99 : 3 },
  }));
  const generate = (organizationIds: string[]) =>
    required(
      required(
        required(
          generateCustomEaReport({
            definition: d,
            answers,
            cohorts: [{ title: "All", type: "All_All", organizationIds }],
          }).sections[0],
        ).questions[0],
      ).responses[0],
    ).dataValues[0];
  assert.equal(generate(["a", "b", "c", "d"]), "x");
  assert.equal(generate(["a", "b", "c", "d", "e"]), 50);
});
test("the Campaign fixture upgrades regional holidays and matrices without editing the supplied sheet", async () => {
  const parsed = await parseSurveyDefinition(
    await readFile(
      new URL("../fixtures/campaign-2026-ea-qa-upload.xlsx", import.meta.url),
    ),
  );
  const custom = normalizeEmployerAssessmentDefinition(
    parsed,
    await loadDefaultBenefitsBestPracticesDefinition(),
  );
  assert.equal(
    custom.find((q) => q.dataLabel.endsWith("SelectPaidHolidays"))?.ea
      ?.calculation,
    "multi",
  );
  assert.ok(custom.every((q) => q.ea));
});
test("custom definition replacement removes deleted rows and download preserves only the saved report", async () => {
  let metadata: Record<string, unknown> = eaDefinitionMetadata(definition);
  const program = { id: "program", metadata };
  const db = {
    program: {
      findFirst: () => Promise.resolve({ ...program, metadata }),
      update: ({
        data,
      }: {
        data: {
          metadata: Record<string, unknown>;
        };
      }) => {
        metadata = data.metadata;
        return Promise.resolve();
      },
    },
    question: { findMany: () => Promise.resolve([{ dataLabel: "count" }]) },
  };
  const prisma = {
    ...db,
    $transaction: async <T>(fn: (transaction: typeof db) => Promise<T>) =>
      fn(db),
  };
  const service = new ProgramSurveyDefinitionService(
    prisma as unknown as PrismaService,
  );
  const principal = {
    sub: "admin",
    roles: ["admin"],
    permissions: [],
    organizationId: null,
  };
  await service.uploadEmployerAssessment(
    principal,
    "program",
    "definition.xlsx",
    await surveyDefinitionWorkbook([required(definition[2])]),
  );
  assert.deepEqual(
    await parseSurveyDefinition(
      await service.downloadEmployerAssessment(principal, "program"),
    ),
    [required(definition[2])],
  );
  assert.equal(metadata.employerAssessmentDefinition, null);
  assert.deepEqual(
    mergeEaDefinitions(definition, [
      { dataLabel: "standard", caption: "Standard" },
    ]),
    [{ dataLabel: "standard", caption: "Standard" }],
  );
});
test("EA preview blocks a custom definition whose source is missing from the workbook", async () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Raw-data");
  sheet.addRow([
    "organization name",
    "Respondent",
    "Language",
    "Date responded",
    "Reached end",
    "Score %",
    "unrelated",
  ]);
  sheet.addRow(["Test Employer", 1, "en", "2026-01-01", "Yes", null, 1]);
  const service = new HistoricalImportService({} as never);
  const result = await service.prepare(
    { sub: "admin", roles: ["admin"], permissions: [], organizationId: null },
    {
      projectName: "Test",
      programName: "Test 2026",
      programYear: 2026,
      efsLaunchDate: "2026-01-01",
      efsDeadline: "2026-12-31",
    },
    {
      eaFile: {
        filename: "ea.xlsx",
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      },
      employerAssessmentDefinitionFile: {
        filename: "definition.xlsx",
        buffer: await surveyDefinitionWorkbook([required(definition[2])]),
      },
    },
  );
  assert.equal(result.validation.blockingErrorCount, 1);
  assert.match(
    required(result.validation.issues[0]).message,
    /count.*not found/u,
  );
});
test("custom matrix workbook contains group headings and percentages", async () => {
  const bytes = await createBenefitsWorkbook({
    headers: ["All Winners"],
    sections: [
      {
        title: "Benefits",
        questions: [
          {
            text: "Supplementary benefits",
            responses: [
              {
                groupLabel: "Life Assurance",
                label: "Standard Offering",
                format: "percent",
                values: [63],
              },
              {
                groupLabel: "Life Assurance",
                label: "Not Offered",
                format: "percent",
                values: [37],
              },
            ],
          },
        ],
      },
    ],
  });
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const sheet = required(workbook.worksheets[0]);
  assert.equal(sheet.getCell("A10").text, "Life Assurance");
  assert.equal(sheet.getCell("A11").text, "Standard Offering");
  assert.equal(sheet.getCell("B11").value, 0.63);
});
test("converter retains custom questions and matrix ordinals instead of imposing the standard answer whitelist", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Questions");
  [
    ["ORGANISATIONAL BENEFITS"],
    [
      "1. Please select bank holidays. (q_OrganisationalBenefits_SelectPaidHolidays)",
    ],
    ["Each respondent could choose MULTIPLE responses."],
    [null, "2nd January (12)"],
    ["2.1 For each benefit select status. (q_OrganisationalBenefits_Benefits)"],
    ["Life Assurance"],
    ["Each respondent could choose only ONE response."],
    [null, "Standard Offering (7)"],
    [null, "Not Offered (3)"],
    ["3. Which policies are offered? (q_OrganizationalBenefits_Policies)"],
    ["Each respondent could choose MULTIPLE responses."],
    [null, "Floating holidays (9)"],
  ].forEach((row) => sheet.addRow(row));
  const result = convertEaQuestionResponseWorkbook(workbook, []);
  assert.equal(result.importable, true);
  assert.equal(result.definition.length, 3);
  assert.equal(
    required(required(required(result.definition[0]).options)[0]).SourceColumn,
    "q_OrganisationalBenefits_SelectPaidHolidays. 2nd January",
  );
  assert.equal(
    required(required(result.definition[1]).ea).sourceColumn,
    "q_OrganisationalBenefits_Benefits.1",
  );
  assert.deepEqual(
    required(required(result.definition[1]).options).map((o) => o.Id),
    ["7", "3"],
  );
});

function required<T>(value: T | undefined): T {
  assert.notEqual(value, undefined);
  if (value === undefined) throw new Error("Missing expected test value");
  return value;
}

test("multi-column numeric definitions require an explicit source for every answer", () => {
  assert.throws(() => {
    validateCustomEaDefinition([
      {
        dataLabel: "premium",
        caption: "Premium",
        ea: {
          calculation: "mean",
          sourceColumn: "premium",
          format: "percent",
        },
        options: [{ Id: "medical", Caption: "Medical", Position: 1 }],
      },
    ]);
  }, /Answers source_column is required/u);
});
