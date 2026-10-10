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
    worksheet.addRow(["Acme", 1, "en", "2026-01-01", 1, 80, 4, 2, 3, 1]);
    await workbook.xlsx.writeFile(filePath);

    const descriptor = Object.getOwnPropertyDescriptor(
      ExcelJS.Workbook.prototype,
      "xlsx",
    );
    assert.ok(descriptor);
    Object.defineProperty(ExcelJS.Workbook.prototype, "xlsx", {
      configurable: true,
      get() {
        throw new Error(
          "Survey reading must not load the full workbook into memory",
        );
      },
    });
    try {
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
        responses.push(
          ...row.responses.map(({ question }) => question.dataLabel),
        );
      });
      assert.deepEqual(responses, [
        "q_CoreEmployeeExperience_1",
        "f_PersonalDemographics_gender",
      ]);
    } finally {
      Object.defineProperty(ExcelJS.Workbook.prototype, "xlsx", descriptor);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("streams inline strings, cached formulas, native dates, and the first worksheet only", async () => {
  const root = mkdtempSync(join(tmpdir(), "xlsx-stream-values-"));
  const filePath = join(root, "efs.xlsx");
  try {
    const workbook = new ExcelJS.stream.xlsx.WorkbookWriter({
      filename: filePath,
      useSharedStrings: false,
      useStyles: true,
    });
    const worksheet = workbook.addWorksheet("Respondents");
    worksheet
      .addRow([
        "organization name",
        "Respondent",
        "Date responded",
        "Score %",
        "q_Test",
        "f_Test",
      ])
      .commit();
    const date = new Date("2026-03-13T12:30:00Z");
    worksheet
      .addRow(["YoloCares", 1, date, 80, { formula: "2+2", result: 4 }, true])
      .commit();
    worksheet.commit();
    const second = workbook.addWorksheet("Ignore");
    second.addRow(["organization name", "Respondent", "q_Test"]).commit();
    second.addRow(["Other", 2, 1]).commit();
    second.commit();
    await workbook.commit();
    const definition = await readXlsxSurveyDefinition({
      fileName: "efs.xlsx",
      filePath,
      questionId: (label) => label,
    });
    let count = 0;
    await forEachXlsxSurveyRow(definition, {}, (row) => {
      count++;
      assert.equal(row.organizationName, "YoloCares");
      assert.equal(row.completedAt?.toISOString(), date.toISOString());
      assert.equal(row.completed, true);
      assert.deepEqual(
        row.responses.map((response) => response.value),
        [4, true],
      );
    });
    assert.equal(count, 1);
    await assert.rejects(
      forEachXlsxSurveyRow(definition, {}, () => {
        throw new Error("callback failed");
      }),
      /callback failed/u,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
