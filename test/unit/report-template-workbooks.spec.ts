import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { createWorkforceFeedbackWorkbook } from "../../src/modules/reports/report-template-workbooks.js";

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
  });
});
