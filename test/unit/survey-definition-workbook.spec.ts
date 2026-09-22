import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import {
  effectiveSurveyDefinition,
  surveyDefinitionWorkbook,
} from "../../src/modules/imports/program-survey-definition.service.js";

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
});
