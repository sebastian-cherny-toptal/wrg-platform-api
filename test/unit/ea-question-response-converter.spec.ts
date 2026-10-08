import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { convertEaQuestionResponseWorkbook } from "../../src/modules/imports/ea-question-response-converter.js";
import type { SurveyDefinition } from "../../src/modules/imports/survey-definition.js";

function sourceWorkbook(rows: Array<[string | null, string | null]>) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Questions");
  rows.forEach((row) => sheet.addRow(row));
  return workbook;
}

const defaults: SurveyDefinition = [
  {
    dataLabel: "q_EmployerInformation_FunActivities",
    caption: "Does your organization coordinate fun activities?",
    categoryLabel: "Employer Information",
    position: 1,
    options: [{ Id: "Yes", Caption: "Yes", Position: 1 }],
  },
  {
    dataLabel: "q_OrganizationalBenefits_SelectPaidHolidays",
    caption: "Which employer-paid holidays are offered?",
    categoryLabel: "Organizational Benefits",
    position: 2,
    options: [{ Id: "New Year's Day", Caption: "New Year's Day", Position: 1 }],
  },
  {
    dataLabel: "q_OrganizationalBenefits_Benefits",
    caption: "Which benefits are offered?",
    categoryLabel: "Organizational Benefits",
    position: 3,
    options: [],
  },
];

test("maps known custom question aliases and keeps only the reportable Yes option", () => {
  const result = convertEaQuestionResponseWorkbook(
    sourceWorkbook([
      [
        "6. Does your organization coordinate fun activities? (q_OrganizationalOverview_FunActivities)",
        null,
      ],
      ["Each respondent could choose only ONE response.", null],
      [null, "Yes (1)"],
      [null, "No (2)"],
    ]),
    defaults,
  );

  assert.equal(result.importable, true);
  assert.deepEqual(result.definition[0]?.options, [
    { Id: "Yes", Caption: "Yes", Position: 1 },
  ]);
});

test("reports a UK holiday that the current EA validator does not support", () => {
  const result = convertEaQuestionResponseWorkbook(
    sourceWorkbook([
      [
        "27. Please select bank holidays. (q_OrganisationalBenefits_SelectPaidHolidays)",
        null,
      ],
      ["Each respondent could choose MULTIPLE responses.", null],
      [null, "2nd January (1)"],
      [null, "New Year's Day (2)"],
    ]),
    defaults,
  );

  assert.equal(result.definition[0]?.dataLabel, defaults[1]?.dataLabel);
  assert.equal(result.importable, false);
  assert.match(
    result.issues.find(({ code }) => code === "unsupported-answer")?.message ??
      "",
    /2nd January/u,
  );
});

test("keeps matrix answers with their own question instead of the preceding question", () => {
  const result = convertEaQuestionResponseWorkbook(
    sourceWorkbook([
      [
        "27. Please select bank holidays. (q_OrganisationalBenefits_SelectPaidHolidays)",
        null,
      ],
      [null, "New Year's Day (1)"],
      [
        "28.1 For each benefit, select its status. (q_OrganisationalBenefits_Benefits)",
        null,
      ],
      ["Life Assurance", null],
      ["Each respondent could choose only ONE response.", null],
      [null, "Standard Offering (1)"],
      [null, "Not Offered (2)"],
    ]),
    defaults,
  );

  const holidays = result.definition.find(
    ({ dataLabel }) =>
      dataLabel === "q_OrganizationalBenefits_SelectPaidHolidays",
  );
  const benefits = result.definition.find(
    ({ dataLabel }) => dataLabel === "q_OrganizationalBenefits_Benefits",
  );
  assert.deepEqual(
    holidays?.options?.map(({ Id }) => Id),
    ["New Year's Day"],
  );
  assert.deepEqual(
    benefits?.options?.map(({ Id }) => Id),
    ["Life Assurance - Standard Offering", "Life Assurance - Not Offered"],
  );
});
