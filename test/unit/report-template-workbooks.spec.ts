import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import {
  createAnnualTrendsWorkbook,
  createBenchmarkWorkbook,
  createResponseDetailWorkbook,
  createVerbatimWorkbook,
  createWorkforceFeedbackWorkbook,
} from "../../src/modules/reports/report-template-workbooks.js";

describe("response detail workbook generation", () => {
  const input = {
    metadata: {
      organizationName: "Health organization",
      programName: "San Diego 2026",
      surveyDates: "April 2026",
    },
    demographics: [
      {
        title: "Gender",
        groupLabel: "Gender",
        options: [
          { label: "Female", count: 12 },
          { label: "Male", count: 8 },
          { label: "Non-Binary", count: 0 },
          { label: "Prefer not to answer", count: 0 },
        ],
      },
    ],
    sections: [
      {
        title: "Core Employee Experience",
        questions: [
          {
            text: "I can do my best work",
            agreement: 75,
            neutral: 15,
            disagreement: 10,
            responseDistribution: [1, 9, 15, 30, 45, 0],
            demographicResponseDistribution: {
              Gender: {
                Female: [2, 8, 10, 35, 45, 0],
                Male: [0, 5, 20, 25, 50, 0],
              },
            },
          },
        ],
      },
    ],
    totalResponses: 20,
  };

  it("uses the supplied 2026 layout for a full report", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await createResponseDetailWorkbook(input)) as never,
    );
    const sheet = workbook.getWorksheet("Response Detail Report");
    assert.ok(sheet);
    assert.equal(sheet.columnCount, 64);
    assert.equal(sheet.getCell("G2").value, "GENDER");
    assert.equal(sheet.getCell("S2").value, "RACE/ETHNICITY");
    assert.equal(sheet.getCell("BG2").value, "FSLA STATUS");
    assert.match(String(sheet.getCell("B3").value), /Health organization/u);
    assert.equal(sheet.getCell("E7").value, 1);
    assert.equal(sheet.getCell("G7").value, 2);
  });

  it("keeps only overall and the selected demographic columns", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await createResponseDetailWorkbook({
        ...input,
        filterGroupLabel: "Gender",
      })) as never,
    );
    const sheet = workbook.getWorksheet("Response Detail Report");
    assert.ok(sheet);
    assert.equal(sheet.columnCount, 10);
    assert.equal(sheet.getCell("G2").value, "GENDER");
    assert.equal(sheet.getCell("J3").value, "Prefer not to answer");
    assert.equal(sheet.getCell("K2").value, null);
  });
});

describe("annual trends workbook generation", () => {
  it("fills the supplied two-year annual trends template", async () => {
    const buffer = await createAnnualTrendsWorkbook({
      metadata: {
        organizationName: "Test organization",
        programName: "Test program 2026",
        surveyDates: "2026",
      },
      currentYear: "2026",
      previousYear: "2025",
      currentTotalResponses: 120,
      previousTotalResponses: 100,
      sections: [
        {
          title: "Core Employee Experience",
          questions: [
            {
              text: "I can do my best work",
              current: {
                agreement: 90,
                disagreement: 4,
                responseCount: 120,
              },
              previous: {
                agreement: 85,
                disagreement: 6,
                responseCount: 100,
              },
            },
          ],
        },
      ],
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Annual Trends Report");
    assert.ok(sheet);
    assert.equal(sheet.getCell("D2").value, "OVERALL 2026");
    assert.equal(sheet.getCell("G2").value, "OVERALL 2025");
    assert.match(String(sheet.getCell("B3").value), /Test organization/u);
    assert.equal(sheet.getCell("D4").value, 120);
    assert.equal(sheet.getCell("G4").value, 100);
    assert.equal(sheet.getCell("B5").value, "CORE EMPLOYEE EXPERIENCE");
    assert.equal(sheet.getCell("B6").value, "I can do my best work");
    assert.equal(sheet.getCell("D6").value, 90);
    assert.equal(sheet.getCell("D6").numFmt, "0");
    assert.equal(sheet.getCell("E6").value, 4);
    assert.equal(sheet.getCell("E6").numFmt, "0");
    assert.equal(sheet.getCell("G6").value, 85);
    assert.equal(sheet.getCell("G6").numFmt, "0");
    assert.equal(sheet.getCell("H6").value, 6);
    assert.equal(sheet.getCell("H6").numFmt, "0");
    assert.equal(sheet.getCell("D15").value, 90);
    assert.equal(sheet.getCell("G101").value, 85);
    assert.equal(sheet.getCell("A6").value, null);
  });
});

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
    for (const column of [1, 3, 6, 11]) {
      for (let row = 1; row <= sheet.rowCount; row += 1) {
        assert.equal(sheet.getCell(row, column).value, null);
      }
    }
    assert.equal(sheet.getCell("B101").value, "SURVEY AVERAGE");
    assert.equal(sheet.getCell("D101").value, 73.33333333333333);
    assert.equal(sheet.getCell("D101").numFmt, "0");
    assert.equal(sheet.getCell("E101").value, 16.666666666666668);
    assert.equal(sheet.getCell("E101").numFmt, "0");
  });
});

describe("employee verbatim workbook generation", () => {
  it("removes the demographic column when no filter is applied", async () => {
    const buffer = await createVerbatimWorkbook({
      metadata: {
        organizationName: "Test organization",
        programName: "Test program",
        surveyDates: "2026",
      },
      questions: [
        {
          text: "What do you value?",
          responses: [{ answer: "Autonomy" }, { answer: "People" }],
        },
      ],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Verbatims Q1");
    assert.ok(sheet);
    assert.equal(sheet.columnCount, 1);
    assert.equal(sheet.getCell("A5").value, "Autonomy");
    assert.equal(sheet.getCell("A6").value, "People");
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
