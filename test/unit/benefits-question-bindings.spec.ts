import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { benefitsQuestionBindingForKey } from "../../src/modules/reports/benefits-question-bindings.js";
import { convertEaQuestionResponseWorkbook } from "../../src/modules/imports/ea-question-response-converter.js";
import { normalizeEmployerAssessmentDefinition } from "../../src/modules/reports/custom-ea-report.js";
import { loadDefaultBenefitsBestPracticesDefinition } from "../../src/modules/reports/benefits-best-practices-from-ea.js";

test("the existing report bindings cover the default report and UK key variants", async () => {
  for (const question of await loadDefaultBenefitsBestPracticesDefinition()) {
    assert.ok(
      benefitsQuestionBindingForKey(question.dataLabel),
      question.dataLabel,
    );
    assert.equal(
      benefitsQuestionBindingForKey(
        question.dataLabel.replace(
          "OrganizationalBenefits",
          "OrganisationalBenefits",
        ),
      ),
      benefitsQuestionBindingForKey(question.dataLabel),
    );
  }
});

test("upload normalization reuses the declared yes/no type independently of answer labels", () => {
  const [question] = normalizeEmployerAssessmentDefinition(
    [
      {
        dataLabel: "q_EmployerInformation_FunActivities",
        caption: "Social activities",
        options: [{ Id: "1", Caption: "Provided", Position: 1 }],
      },
    ],
    [],
  );
  assert.equal(question?.ea?.calculation, "yesNo");
  assert.equal(question.ea.sourceColumn, "q_EmployerInformation_FunActivities");
});

test("canonical questions normalize independently of report templates and document wording", () => {
  const questions = normalizeEmployerAssessmentDefinition(
    [
      {
        dataLabel: "q_OrganisationalBenefits_AdditionalPtoPolicies",
        caption: "Our leave policies",
        categoryLabel: "Custom category",
        options: [
          {
            Id: "Exchange leave for pay",
            Caption: "Cash out leave",
            Position: 1,
          },
        ],
      },
      {
        dataLabel: "q_TrainingandCareerDevelopment_EmplyProfDevCarerAd",
        caption: "Career support",
        options: [{ Id: "Yes", Caption: "Yes", Position: 1 }],
      },
    ],
    [],
  );
  assert.equal(
    questions[0]?.dataLabel,
    "q_OrganizationalBenefits_AdditionalPtoPolicies",
  );
  assert.equal(questions[0].ea?.calculation, "multi");
  assert.equal(
    questions[0].options?.[0]?.SourceColumn,
    "q_OrganisationalBenefits_AdditionalPtoPolicies. Exchange leave for pay",
  );
  assert.equal(questions[0].caption, "Our leave policies");
  assert.equal(questions[1]?.ea?.calculation, "yesNo");
  assert.equal(questions[1].options?.[0]?.Id, "1");
});

test("question response conversion uses canonical contracts when selection instructions are absent", () => {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Questions");
  sheet.addRows([
    ["1. Select policies (q_OrganizationalBenefits_AdditionalPtoPolicies)"],
    [null, "Exchange leave for pay (7)"],
    ["2. Select tuition support (q_TrainingandCareerDevelopment_Tuition)"],
    [null, "Professional certification (3)"],
  ]);
  const result = convertEaQuestionResponseWorkbook(workbook, []);
  assert.equal(result.importable, true);
  assert.deepEqual(
    result.definition.map((q) => q.ea?.calculation),
    ["multi", "multi"],
  );
  assert.equal(
    result.definition[1]?.options?.[0]?.SourceColumn,
    "q_TrainingandCareerDevelopment_Tuition. Professional certification",
  );
});

test("explicit source selection instructions take precedence over canonical defaults", () => {
  const workbook = new ExcelJS.Workbook();
  workbook
    .addWorksheet("Questions")
    .addRows([
      ["1. Select tuition support (q_TrainingandCareerDevelopment_Tuition)"],
      ["Each respondent could choose only ONE response."],
      [null, "Professional certification (7)"],
    ]);
  const result = convertEaQuestionResponseWorkbook(workbook, []);
  assert.equal(result.importable, true);
  assert.equal(result.definition[0]?.ea?.calculation, "choice");
  assert.equal(result.definition[0].options?.[0]?.Id, "7");
});
