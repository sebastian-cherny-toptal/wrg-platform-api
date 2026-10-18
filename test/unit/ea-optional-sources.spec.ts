import assert from "node:assert/strict";
import { test } from "node:test";
import type { SurveyDefinition } from "../../src/modules/imports/survey-definition.js";
import { parseSurveyDefinition } from "../../src/modules/imports/survey-definition.js";
import { surveyDefinitionWorkbook } from "../../src/modules/imports/program-survey-definition.service.js";
import {
  generateCustomEaReport,
  validateCustomEaSources,
} from "../../src/modules/reports/custom-ea-report.js";

const definition: SurveyDefinition = [
  {
    dataLabel: "q_Optional",
    caption: "Optional section question",
    categoryLabel: "Absent section",
    ea: {
      calculation: "yesNo",
      sourceColumn: "q_Optional",
      format: "percent",
      missingSource: "skip",
    },
    options: [{ Id: "1", Caption: "Yes", Position: 1 }],
  },
  {
    dataLabel: "q_Policies",
    caption: "Policies",
    categoryLabel: "Present section",
    ea: {
      calculation: "multi",
      sourceColumn: "q_Policies",
      format: "percent",
      missingSource: "skip",
    },
    options: [
      {
        Id: "one",
        Caption: "One",
        Position: 1,
        SourceColumn: "q_Policies. One",
      },
      {
        Id: "two",
        Caption: "Two",
        Position: 2,
        SourceColumn: "q_Policies. Two",
      },
    ],
  },
];

test("optional EA sources omit absent questions, sections and answer columns without treating missing as zero", () => {
  const columns = ["q_Policies. One"];
  assert.deepEqual(validateCustomEaSources(definition, columns), []);
  const report = generateCustomEaReport({
    definition,
    minimumOrganizations: 1,
    cohorts: [{ title: "All", type: "All_All", organizationIds: ["a", "b"] }],
    answers: [
      { organizationId: "a", values: { "q_Policies. One": 1 } },
      { organizationId: "b", values: { "q_Policies. One": null } },
    ],
  });
  assert.deepEqual(
    report.sections.map((s) => s.title),
    ["Present section"],
  );
  assert.deepEqual(
    report.sections[0]?.questions[0]?.responses.map((r) => [
      r.label,
      ...r.dataValues,
    ]),
    [["One", 50]],
  );
  const required = definition.map((q) => {
    const ea = { ...q.ea };
    delete ea.missingSource;
    return { ...q, ea };
  }) as SurveyDefinition;
  assert.equal(validateCustomEaSources(required, columns).length, 2);
});

test("optional EA mappings round-trip but never hide ambiguous sources", async () => {
  assert.deepEqual(
    await parseSurveyDefinition(await surveyDefinitionWorkbook(definition)),
    definition,
  );
  const issues = validateCustomEaSources(definition, [
    "q_Policies. ONE",
    "q_Policies. one",
  ]);
  assert.equal(issues.length, 1);
  assert.match(issues[0] ?? "", /ambiguous/u);
});

test("reusable EA questions apply eligibility only when the parent gate is in the program", () => {
  const question = definition[1];
  assert.ok(question?.ea);
  const gated: SurveyDefinition = [
    {
      ...question,
      ea: { ...question.ea, eligibleQuestion: "q_Gate", eligibleValue: "1" },
    },
  ];
  assert.deepEqual(validateCustomEaSources(gated, ["q_Policies. One"]), []);
  const report = generateCustomEaReport({
    definition: gated,
    minimumOrganizations: 1,
    cohorts: [{ title: "All", type: "All_All", organizationIds: ["a"] }],
    answers: [{ organizationId: "a", values: { "q_Policies. One": 1 } }],
  });
  assert.equal(
    report.sections[0]?.questions[0]?.responses[0]?.dataValues[0],
    100,
  );
  const withGate = generateCustomEaReport({
    definition: gated,
    minimumOrganizations: 1,
    cohorts: [{ title: "All", type: "All_All", organizationIds: ["a", "b"] }],
    answers: [
      { organizationId: "a", values: { "q_Policies. One": 1, q_Gate: 1 } },
      { organizationId: "b", values: { "q_Policies. One": 1, q_Gate: 2 } },
    ],
  });
  assert.equal(
    withGate.sections[0]?.questions[0]?.responses[0]?.dataValues[0],
    100,
  );
});
