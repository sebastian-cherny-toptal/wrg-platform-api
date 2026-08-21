import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import {
  createBenchmarkWorkbook,
  createWorkforceFeedbackWorkbook,
} from "../../src/modules/reports/report-template-workbooks.js";

describe("workforce feedback workbook generation", () => {
  it("rotates demographic headers in row 3", async () => {
    const buffer = await createWorkforceFeedbackWorkbook({
      metadata: {
        organizationName: "Test organization",
        programName: "Test program",
        surveyDates: "2026",
      },
      demographics: [],
      sections: [
        {
          title: "Test section",
          questions: [
            {
              text: "Test question",
              agreement: 80,
              neutral: 10,
              disagreement: 10,
              responseCount: 10,
            },
          ],
        },
        {
          title: "Second section",
          questions: [
            {
              text: "Second question",
              agreement: 60,
              neutral: 10,
              disagreement: 30,
              responseCount: 5,
            },
          ],
        },
      ],
      totalResponses: 10,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Workforce Feedback Results");
    assert.ok(sheet);

    for (const address of ["D3", "E3", "G3", "H3", "BM3"]) {
      assert.equal(sheet.getCell(address).alignment.textRotation, 90, address);
    }
    assert.notEqual(sheet.getCell("F3").alignment.textRotation, 90);
    assert.notEqual(sheet.getCell("B3").alignment.textRotation, 90);
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      assert.equal(sheet.getCell(1, column).value, null);
    }
    assert.equal(sheet.getCell("B2").value, null);
    assert.equal(sheet.getCell("G4").value, 0);
    assert.equal(sheet.getCell("B101").value, "SURVEY AVERAGE");
    assert.equal(sheet.getCell("D101").value, 73.33333333333333);
    assert.equal(sheet.getCell("E101").value, 16.666666666666668);
  });
});

describe("benchmark workbook generation", () => {
  it("fills the supplied nine-column benchmark template in cohort order", async () => {
    const buffer = await createBenchmarkWorkbook({
      metadata: {
        organizationName: "Test organization",
        programName: "Test program",
        surveyDates: "2026",
      },
      headerTypes: [
        "All_Yes",
        "All_No",
        "Small_Yes",
        "Small_No",
        "Medium_Yes",
        "Medium_No",
        "Large_Yes",
        "Large_No",
      ],
      categories: [
        {
          title: "Core Employee Experience",
          values: [91, 81, 92, 82, 93, 83, 94, 84],
          questions: [
            {
              text: "I can do my best work",
              values: [90, 80, 91, 81, 92, 82, 93, 83],
            },
          ],
        },
      ],
      surveyAverage: [89, 79, 88, 78, 87, 77, 86, 76],
      cohortOrganizationCount: 42,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Workforce Benchmark Comparisons");
    assert.ok(sheet);
    assert.equal(sheet.getCell("A6").value, "PROGRAM: Test program");
    assert.equal(sheet.getCell("B5").value, 42);
    assert.deepEqual(
      ["B9", "C9", "D9", "E9", "F9", "G9", "H9", "I9"].map(
        (address) => sheet.getCell(address).value,
      ),
      [90, 80, 91, 81, 92, 82, 93, 83],
    );
    assert.deepEqual(
      ["B104", "C104", "D104", "E104", "F104", "G104", "H104", "I104"].map(
        (address) => sheet.getCell(address).value,
      ),
      [89, 79, 88, 78, 87, 77, 86, 76],
    );
  });
});
