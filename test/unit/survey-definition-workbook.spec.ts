import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ExcelJS from "exceljs";
import {
  effectiveSurveyDefinition,
  loadDefaultSurveyDefinition,
  surveyDefinitionWorkbook,
} from "../../src/modules/imports/program-survey-definition.service.js";
import { parseSurveyDefinition } from "../../src/modules/imports/survey-definition.js";
import {
  loadDefaultBenefitsBestPracticesDefinition,
  validateBenefitsBestPracticesDefinition,
} from "../../src/modules/reports/benefits-best-practices-from-ea.js";

test("default EA definition template exposes the built-in Benefits & Best Practices labels", async () => {
  const defaults = await loadDefaultBenefitsBestPracticesDefinition();
  const parsed = await parseSurveyDefinition(
    await surveyDefinitionWorkbook(defaults),
  );

  assert.equal(parsed.length, 38);
  assert.ok(
    parsed.some(
      ({ dataLabel }) =>
        dataLabel === "q_OrganizationalBenefits_AdoptionBirthBenefits",
    ),
  );
  assert.equal(
    parsed.find(
      ({ dataLabel }) => dataLabel === "q_EmployerInformation_FunActivities",
    )?.caption,
    "Does your organization coordinate “Fun” activities?",
  );
  assert.equal(
    parsed.find(
      ({ dataLabel }) => dataLabel === "q_EmployerInformation_FunActivities",
    )?.options?.[0]?.Caption,
    "Yes",
  );
  const paidHolidays = parsed.find(
    ({ dataLabel }) =>
      dataLabel === "q_OrganizationalBenefits_NumberPaidHolidays",
  );
  assert.ok(paidHolidays);
  assert.ok(paidHolidays.options);
  assert.equal(paidHolidays.options.length, 25);
  assert.equal(paidHolidays.options[0]?.Id, "1");
  assert.equal(paidHolidays.options[24]?.Id, "25");
});

test("Campaign 2026 EA Questions and Answers parses but is rejected when attached", async () => {
  const uploaded = await parseSurveyDefinition(
    await readFile(
      new URL("../fixtures/campaign-2026-ea-qa-upload.xlsx", import.meta.url),
    ),
  );

  assert.equal(uploaded.length, 26);
  assert.equal(
    uploaded.reduce(
      (answerCount, question) => answerCount + (question.options?.length ?? 0),
      0,
    ),
    161,
  );
  assert.equal(
    uploaded.find(
      ({ dataLabel }) => dataLabel === "q_EmployerInformation_FunActivities",
    )?.caption,
    "Does your organisation coordinate “Fun” activities?",
  );
  const defaults = await loadDefaultBenefitsBestPracticesDefinition();

  assert.throws(() => {
    validateBenefitsBestPracticesDefinition(uploaded, defaults);
  }, /EA definition answer is not used by q_OrganizationalBenefits_SelectPaidHolidays: 2nd January/u);
});

test("default survey definition workbook contains both sheets and effective answers", async () => {
  const definition = effectiveSurveyDefinition(
    [
      {
        id: "question-1",
        legacyId: null,
        externalId: null,
        dataLabel: "q_CoreEmployeeExperience_Test",
        caption: "I feel supported at work.",
        type: "likert",
        position: 1,
        metadata: {
          QuestionResponses: [
            { Id: 1, Caption: "Strongly Disagree" },
            { Id: 2, Caption: "Disagree" },
            { Id: 3, Caption: "Neutral" },
            { Id: 4, Caption: "Agree" },
            { Id: 5, Caption: "Strongly Agree" },
            { Id: 6, Caption: "N/A" },
          ],
        },
      },
    ],
    2026,
    [{ questionId: "question-1", value: 4 }],
  );
  definition.push(
    {
      dataLabel: "124. Company Size",
      caption: "Company Size",
      type: "demographic",
      position: 124,
      options: [{ Id: "1", Caption: "1–49", Position: 1 }],
    },
    {
      dataLabel: "125. Sample size",
      caption: "Sample size",
      type: "demographic",
      position: 125,
      options: [{ Id: "1", Caption: "1–49", Position: 1 }],
    },
  );
  const bytes = await surveyDefinitionWorkbook(definition);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);

  assert.deepEqual(
    workbook.worksheets.map(({ name }) => name),
    ["Questions", "Answers"],
  );
  assert.equal(
    workbook.getWorksheet("Questions")?.getCell("B2").value,
    "I feel supported at work.",
  );
  assert.equal(workbook.getWorksheet("Answers")?.rowCount, 8);
  assert.equal(workbook.getWorksheet("Answers")?.getCell("C5").value, "Agree");
  for (const sheetName of ["Questions", "Answers"]) {
    const keys = workbook.getWorksheet(sheetName)?.getColumn(1).values;
    assert.ok(keys);
    assert.equal(keys.includes("124. Company Size"), false);
    assert.equal(keys.includes("125. Sample size"), false);
  }
});

test("default survey definition workbook uses the standard gender codes", async () => {
  const defaults = await loadDefaultSurveyDefinition();
  const definition = effectiveSurveyDefinition(
    [
      {
        id: "gender",
        legacyId: null,
        externalId: null,
        dataLabel: "f_PersonalDemographics_gender",
        caption: "Gender",
        type: "demographic",
        position: 1,
        metadata: {
          QuestionResponses: [
            { Id: 1, Caption: "Male" },
            { Id: 2, Caption: "Female" },
            { Id: 3, Caption: "Non-Binary" },
            { Id: 4, Caption: "Prefer not to answer" },
          ],
        },
      },
    ],
    2026,
    [],
    defaults,
  );
  const bytes = await surveyDefinitionWorkbook(definition);
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);

  const answers = workbook.getWorksheet("Answers");
  assert.deepEqual(
    [2, 3, 4, 5].map((row) => [
      answers?.getCell(`B${row}`).value,
      answers?.getCell(`C${row}`).value,
      answers?.getCell(`D${row}`).value,
    ]),
    [
      ["1", "Female", 1],
      ["2", "Male", 2],
      ["3", "Non-Binary", 3],
      ["4", "Prefer not to answer", 4],
    ],
  );
});
