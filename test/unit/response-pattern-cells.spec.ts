import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import {
  classifyHighAgreementCells,
  classifyResponsePatternCells,
  projectResponsePatternCells,
  type ResponsePatternCell,
} from "../../src/modules/reports/response-pattern-cells.js";
import { createWorkforceFeedbackWorkbook } from "../../src/modules/reports/report-template-workbooks.js";

function projectedFixture(): ResponsePatternCell[] {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Workforce Feedback Results");
  sheet.getColumn(6).width = 1;
  sheet.getCell("D3").value = "%Agreement";
  sheet.getCell("E3").value = "%Disagreement";
  sheet.getCell("G3").value = "Female";
  sheet.getCell("H3").value = "Male";
  sheet.getCell("I3").value = "Department";

  sheet.getCell("B4").value = "Total number of responses:";
  sheet.getCell("D4").value = 10;
  sheet.getCell("G4").value = 4;
  sheet.getCell("B5").value = "CORE EMPLOYEE EXPERIENCE";
  sheet.getCell("B6").value = "I can do my best work";
  sheet.getCell("D6").value = "80";
  sheet.getCell("E6").value = 20;
  sheet.getCell("G6").value = 75;
  sheet.getCell("H6").value = "x";
  sheet.getCell("I6").value = "not numeric";
  sheet.getCell("B7").value = "CORE EMPLOYEE EXPERIENCE - AVERAGE";
  sheet.getCell("D7").value = 82;
  sheet.getCell("E7").value = 18;
  sheet.getCell("B8").value = "SURVEY AVERAGE";
  sheet.getCell("D8").value = 81;
  sheet.getCell("B9").value =
    "Note: This report shows the percentage of agreement.";
  sheet.getCell("B116").value = "Outside the legacy highlight window";
  sheet.getCell("D116").value = 90;

  return projectResponsePatternCells(sheet);
}

function at(
  cells: ResponsePatternCell[],
  row: number,
  column: number,
): ResponsePatternCell {
  const cell = cells.find((item) => item.row === row && item.column === column);
  assert.ok(cell, `Expected projected cell at row ${row}, column ${column}`);
  return cell;
}

describe("response-pattern cell projection", () => {
  it("projects the generated Workforce Feedback template layout", async () => {
    const buffer = await createWorkforceFeedbackWorkbook({
      metadata: {
        organizationName: "Test organization",
        programName: "Test program",
        surveyDates: "2026",
      },
      demographics: [
        {
          title: "Gender",
          groupLabel: "Gender",
          options: [{ label: "Female", count: 8 }],
        },
      ],
      sections: [
        {
          title: "Core Employee Experience",
          questions: [
            {
              text: "I can do my best work",
              agreement: 80,
              neutral: 10,
              disagreement: 10,
              responseCount: 10,
              demographicAgreement: { Gender: { Female: 75 } },
              demographicResponseCount: { Gender: { Female: 8 } },
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
    const cells = projectResponsePatternCells(sheet);

    assert.equal(at(cells, 4, 4).rowKind, "response-count");
    assert.equal(at(cells, 6, 4).columnKind, "overall-agreement");
    assert.equal(at(cells, 6, 4).metric, "agreement");
    assert.equal(at(cells, 6, 4).numericValue, 80);
    assert.equal(at(cells, 6, 5).columnKind, "overall-disagreement");
    assert.equal(at(cells, 6, 5).metric, "disagreement");
    assert.equal(at(cells, 6, 5).numericValue, 10);
    assert.equal(at(cells, 6, 6).columnKind, "separator");
    assert.equal(at(cells, 6, 6).metric, null);
    assert.equal(at(cells, 6, 7).columnKind, "demographic-agreement");
    assert.equal(at(cells, 6, 7).numericValue, 75);
    assert.equal(at(cells, 15, 4).rowKind, "category-average");
    assert.equal(at(cells, 101, 4).rowKind, "survey-average");
  });

  it("classifies overall, demographic, count, average, and separator cells", () => {
    const cells = projectedFixture();

    assert.equal(at(cells, 4, 4).rowKind, "response-count");
    assert.equal(at(cells, 6, 4).rowKind, "question");
    assert.equal(at(cells, 7, 4).rowKind, "category-average");
    assert.equal(at(cells, 8, 4).rowKind, "survey-average");
    assert.equal(at(cells, 9, 4).rowKind, "note");
    assert.equal(at(cells, 5, 4).rowKind, "section");
    assert.equal(at(cells, 6, 4).columnKind, "overall-agreement");
    assert.equal(at(cells, 6, 5).columnKind, "overall-disagreement");
    assert.equal(at(cells, 6, 6).columnKind, "separator");
    assert.equal(at(cells, 6, 7).columnKind, "demographic-agreement");
  });

  it("preserves the legacy denominator independently from highlight eligibility", () => {
    const cells = projectedFixture();

    assert.equal(at(cells, 4, 4).denominatorEligible, true);
    assert.equal(at(cells, 4, 4).classificationEligible, false);
    assert.equal(at(cells, 6, 4).numericValue, 80);
    assert.equal(at(cells, 6, 4).denominatorEligible, true);
    assert.equal(at(cells, 6, 4).classificationEligible, true);
    assert.equal(at(cells, 6, 4).highlightEligible, true);
    assert.equal(at(cells, 6, 9).denominatorEligible, false);
    assert.equal(at(cells, 116, 4).denominatorEligible, true);
    assert.equal(at(cells, 116, 4).classificationEligible, false);
    assert.equal(at(cells, 116, 4).highlightEligible, false);
  });

  it("counts suppressed cells without treating them as numeric highlights", () => {
    const suppressed = at(projectedFixture(), 6, 8);

    assert.equal(suppressed.rawValue, "x");
    assert.equal(suppressed.numericValue, null);
    assert.equal(suppressed.suppressed, true);
    assert.equal(suppressed.denominatorEligible, true);
    assert.equal(suppressed.classificationEligible, true);
    assert.equal(suppressed.highlightEligible, false);
  });

  it("allows explicit workbook bounds without changing denominator membership", () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Workforce Feedback Results");
    sheet.getCell("B6").value = "Question";
    sheet.getCell("D6").value = 80;
    sheet.getCell("B7").value = "Question two";
    sheet.getCell("D7").value = 90;
    const cells = projectResponsePatternCells(sheet, {
      firstValueRow: 7,
      lastValueRow: 7,
    });

    assert.equal(at(cells, 6, 4).denominatorEligible, true);
    assert.equal(at(cells, 6, 4).classificationEligible, false);
    assert.equal(at(cells, 7, 4).classificationEligible, true);
  });

  it("classifies High Agreement with inclusive bounds and the legacy denominator", () => {
    const result = classifyHighAgreementCells(projectedFixture(), [80, 82]);

    assert.equal(result.denominator, 10);
    assert.equal(result.matchCount, 3);
    assert.equal(result.percentage, 30);
    assert.deepEqual(
      result.cells
        .filter(({ color }) => color === "positive")
        .map(({ row, column, value }) => ({ row, column, value })),
      [
        { row: 6, column: 4, value: 80 },
        { row: 7, column: 4, value: 82 },
        { row: 8, column: 4, value: 81 },
      ],
    );
    assert.equal(
      result.cells.some(
        ({ row, column, color, value }) =>
          row === 6 && column === 8 && color === "gray" && value === "x",
      ),
      true,
    );
  });

  it("does not classify disagreement values as High Agreement", () => {
    const result = classifyHighAgreementCells(projectedFixture(), [18, 20]);

    assert.equal(result.matchCount, 0);
    assert.equal(
      result.cells.some(({ column }) => column === 5),
      false,
    );
  });

  it("classifies Moderate Agreement with inclusive bounds", () => {
    const result = classifyResponsePatternCells(projectedFixture(), {
      neutral: [75, 80],
    });

    assert.equal(result.denominator, 10);
    assert.deepEqual(result.matchCounts, {
      positive: 0,
      neutral: 2,
      negative: 0,
    });
    assert.deepEqual(result.percentages, {
      positive: 0,
      neutral: 20,
      negative: 0,
    });
    assert.deepEqual(
      result.cells
        .filter(({ color }) => color === "neutral")
        .map(({ row, column, value }) => ({ row, column, value })),
      [
        { row: 6, column: 4, value: 80 },
        { row: 6, column: 7, value: 75 },
      ],
    );
  });

  it("gives High Agreement precedence over overlapping Moderate Agreement", () => {
    const result = classifyResponsePatternCells(projectedFixture(), {
      positive: [80, 82],
      neutral: [75, 81],
    });

    assert.deepEqual(result.matchCounts, {
      positive: 3,
      neutral: 1,
      negative: 0,
    });
    assert.equal(
      result.cells.find(({ row, column }) => row === 6 && column === 4)?.color,
      "positive",
    );
    assert.equal(
      result.cells.find(({ row, column }) => row === 8 && column === 4)?.color,
      "positive",
    );
  });

  it("keeps adjacent agreement ranges mutually exclusive", () => {
    const result = classifyResponsePatternCells(projectedFixture(), {
      positive: [81, 82],
      neutral: [75, 80],
    });

    assert.deepEqual(result.matchCounts, {
      positive: 2,
      neutral: 2,
      negative: 0,
    });
  });

  it("classifies only disagreement cells as High Disagreement", () => {
    const result = classifyResponsePatternCells(projectedFixture(), {
      negative: [18, 20],
    });

    assert.equal(result.denominator, 10);
    assert.deepEqual(result.matchCounts, {
      positive: 0,
      neutral: 0,
      negative: 2,
    });
    assert.equal(result.percentages.negative, 20);
    assert.deepEqual(
      result.cells.map(({ row, column, color, value }) => ({
        row,
        column,
        color,
        value,
      })),
      [
        { row: 6, column: 5, color: "negative", value: 20 },
        { row: 7, column: 5, color: "negative", value: 18 },
      ],
    );
  });

  it("uses one denominator for every single and combined selection", () => {
    const cases = [
      {
        ranges: { positive: [80, 82] as [number, number] },
        counts: { positive: 3, neutral: 0, negative: 0 },
      },
      {
        ranges: { neutral: [75, 80] as [number, number] },
        counts: { positive: 0, neutral: 2, negative: 0 },
      },
      {
        ranges: { negative: [18, 20] as [number, number] },
        counts: { positive: 0, neutral: 0, negative: 2 },
      },
      {
        ranges: {
          positive: [80, 82] as [number, number],
          neutral: [75, 81] as [number, number],
        },
        counts: { positive: 3, neutral: 1, negative: 0 },
      },
      {
        ranges: {
          positive: [80, 82] as [number, number],
          negative: [18, 20] as [number, number],
        },
        counts: { positive: 3, neutral: 0, negative: 2 },
      },
      {
        ranges: {
          neutral: [75, 80] as [number, number],
          negative: [18, 20] as [number, number],
        },
        counts: { positive: 0, neutral: 2, negative: 2 },
      },
      {
        ranges: {
          positive: [80, 82] as [number, number],
          neutral: [75, 81] as [number, number],
          negative: [18, 20] as [number, number],
        },
        counts: { positive: 3, neutral: 1, negative: 2 },
      },
    ];

    for (const { ranges, counts } of cases) {
      const result = classifyResponsePatternCells(projectedFixture(), ranges);
      assert.equal(result.denominator, 10);
      assert.deepEqual(result.matchCounts, counts);
    }
  });

  it("returns zero percentages when no selected range matches", () => {
    const result = classifyResponsePatternCells(projectedFixture(), {
      positive: [1, 2],
      neutral: [3, 4],
      negative: [5, 6],
    });

    assert.deepEqual(result.matchCounts, {
      positive: 0,
      neutral: 0,
      negative: 0,
    });
    assert.deepEqual(result.percentages, {
      positive: 0,
      neutral: 0,
      negative: 0,
    });
  });
});
