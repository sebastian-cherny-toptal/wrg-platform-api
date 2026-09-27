import ExcelJS from "exceljs";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import {
  forEachXlsxSurveyRow,
  isExcludedSurveyQuestion,
  readXlsxSurveyDefinition,
} from "../../src/modules/imports/xlsx-survey-importer.js";

test("recognizes administrative columns independently of question number", () => {
  for (const label of [
    "Company Size",
    "Sample size",
    "124. Company Size",
    "125. Sample size",
    "999. Company Size",
  ]) {
    assert.equal(isExcludedSurveyQuestion(label), true, label);
  }
  assert.equal(isExcludedSurveyQuestion("Company Size Satisfaction"), false);
});

test("skips company-size and sample-size administrative columns", async () => {
  const root = mkdtempSync(join(tmpdir(), "xlsx-survey-importer-"));
  const filePath = join(root, "efs.xlsx");
  try {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Raw-data");
    worksheet.addRow([
      "organization name",
      "Respondent",
      "Language",
      "Date responded",
      "Reached end",
      "Score %",
      "q_CoreEmployeeExperience_1",
      "f_PersonalDemographics_gender",
      "124. Company Size",
      "125. Sample size",
    ]);
    worksheet.addRow([
      "Acme",
      1,
      "en",
      "2026-01-01",
      1,
      80,
      4,
      2,
      3,
      1,
    ]);
    await workbook.xlsx.writeFile(filePath);

    const definition = await readXlsxSurveyDefinition({
      fileName: "efs.xlsx",
      filePath,
      questionId: (dataLabel) => dataLabel,
    });

    assert.deepEqual(
      definition.questions.map(({ dataLabel }) => dataLabel),
      ["q_CoreEmployeeExperience_1", "f_PersonalDemographics_gender"],
    );

    const responses: string[] = [];
    await forEachXlsxSurveyRow(definition, {}, (row) => {
      responses.push(...row.responses.map(({ question }) => question.dataLabel));
    });
    assert.deepEqual(responses, [
      "q_CoreEmployeeExperience_1",
      "f_PersonalDemographics_gender",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
