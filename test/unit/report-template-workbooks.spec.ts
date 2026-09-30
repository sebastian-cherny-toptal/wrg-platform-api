import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import {
  createAnnualTrendsWorkbook,
  createBenchmarkWorkbook,
  createResponseDetailWorkbook,
  createVerbatimWorkbook,
  createWorkforceFeedbackWorkbook,
} from "../../src/modules/reports/report-template-workbooks.js";

function conditionalFormattingRanges(sheet: ExcelJS.Worksheet): string[] {
  return (
    sheet as ExcelJS.Worksheet & {
      conditionalFormattings: ExcelJS.ConditionalFormattingOptions[];
    }
  ).conditionalFormattings.map(({ ref }) => ref);
}

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

  it("uses only this program's demographics in a full report", async () => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await createResponseDetailWorkbook(input)) as never,
    );
    const sheet = workbook.getWorksheet("Response Detail Report");
    assert.ok(sheet);
    assert.equal(sheet.columnCount, 11);
    assert.equal(sheet.getCell("G2").value, "GENDER");
    assert.equal(sheet.getCell("L2").value, null);
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

  it("renders a custom field and filters its columns without template labels", async () => {
    const demographics = [
      ...input.demographics,
      {
        title: "Location",
        groupLabel: "Location",
        options: [
          { label: "North", count: 12 },
          { label: "South", count: 8 },
        ],
      },
    ];
    const full = new ExcelJS.Workbook();
    await full.xlsx.load(
      (await createResponseDetailWorkbook({ ...input, demographics })) as never,
    );
    const fullSheet = full.getWorksheet("Response Detail Report");
    assert.ok(fullSheet);
    assert.equal(fullSheet.getCell("L2").value, "LOCATION");
    assert.equal(fullSheet.getCell("M3").value, "South");
    assert.equal(fullSheet.getCell("O2").value, null);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await createResponseDetailWorkbook({
        ...input,
        demographics,
        filterGroupLabel: "Location",
      })) as never,
    );
    const sheet = workbook.getWorksheet("Response Detail Report");
    assert.ok(sheet);
    assert.equal(sheet.getCell("G2").value, "LOCATION");
    assert.equal(sheet.getCell("G3").value, "North");
    assert.equal(sheet.getCell("H3").value, "South");
    assert.equal(sheet.getCell("G4").value, 12);
    assert.equal(sheet.getCell("H4").value, 8);
    assert.equal(sheet.getCell("J2").value, null);
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
  it("omits sections whose response counts are zero in every column", async () => {
    const buffer = await createWorkforceFeedbackWorkbook({
      metadata: {
        organizationName: "Test organization",
        programName: "Test program",
        surveyDates: "2026",
      },
      demographics: [
        {
          title: "Office Location",
          groupLabel: "Office Location",
          options: [{ label: "North", count: 4 }],
        },
      ],
      sections: [
        {
          title: "Empty section",
          questions: [
            {
              text: "Unanswered question",
              agreement: 0,
              neutral: 0,
              disagreement: 0,
              responseCount: 0,
              demographicResponseCount: {
                "Office Location": { North: 0 },
              },
            },
          ],
        },
        {
          title: "Demographic responses",
          questions: [
            {
              text: "Answered by a demographic group",
              agreement: 75,
              neutral: 0,
              disagreement: 25,
              responseCount: 0,
              demographicAgreement: {
                "Office Location": { North: 75 },
              },
              demographicResponseCount: {
                "Office Location": { North: 4 },
              },
            },
          ],
        },
        {
          title: "Overall responses",
          questions: [
            {
              text: "Answered overall",
              agreement: 80,
              neutral: 10,
              disagreement: 10,
              responseCount: 5,
            },
          ],
        },
      ],
      totalResponses: 5,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Workforce Feedback Results");
    assert.ok(sheet);
    assert.equal(sheet.getCell("B5").value, "Demographic responses");
    assert.equal(sheet.getCell("B6").value, "Answered by a demographic group");
    assert.equal(sheet.getCell("B16").value, "Overall responses");
    assert.equal(sheet.getCell("B17").value, "Answered overall");
    const values: unknown[] = [];
    sheet.eachRow((row) => {
      row.eachCell((cell) => {
        values.push(cell.value);
      });
    });
    assert.ok(!values.includes("Empty section"));
    assert.ok(!values.includes("Unanswered question"));
  });

  it("omits zero-response demographic groups but keeps zero-count options in populated groups", async () => {
    const buffer = await createWorkforceFeedbackWorkbook({
      metadata: {
        organizationName: "Test organization",
        programName: "Custom program",
        surveyDates: "2026",
      },
      demographics: [
        {
          title: "Job Level",
          groupLabel: "Job Level",
          options: [
            { label: "Director or Above", count: 22 },
            { label: "Salaried - Individual Contributor", count: 0 },
          ],
        },
        {
          title: "Job Level",
          groupLabel: "Job Level",
          options: [
            { label: "CEO/President/Owner", count: 0 },
            { label: "Department Manager/Supervisor", count: 0 },
          ],
        },
        {
          title: "Department",
          groupLabel: "Department",
          options: [{ label: "Administration/Management", count: 0 }],
        },
        {
          title: "Department",
          groupLabel: "Department",
          options: [
            { label: "Finance", count: 31 },
            { label: "Information Technology", count: 0 },
          ],
        },
        {
          title: "Survey Questions",
          groupLabel: "Survey Questions",
          options: [{ label: "3", count: 0 }],
        },
      ],
      sections: [
        {
          title: "Test section",
          questions: [
            {
              text: "Test question",
              agreement: 80,
              neutral: 10,
              disagreement: 10,
              responseCount: 53,
              demographicAgreement: {
                "Job Level": { "Director or Above": 75 },
                Department: { Finance: 80 },
              },
              demographicResponseCount: {
                "Job Level": { "Director or Above": 22 },
                Department: { Finance: 31 },
              },
            },
          ],
        },
      ],
      totalResponses: 53,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Workforce Feedback Results");
    assert.ok(sheet);
    assert.equal(sheet.getCell("G2").value, "JOB LEVEL");
    assert.equal(sheet.getCell("G3").value, "Director or Above");
    assert.equal(sheet.getCell("H3").value, "Salaried - Individual Contributor");
    assert.equal(sheet.getCell("G4").value, 22);
    assert.equal(sheet.getCell("H4").value, 0);
    assert.equal(sheet.getCell("G6").value, 75);
    assert.equal(sheet.getCell("H6").value, "x");
    assert.equal(sheet.getCell("J2").value, "DEPARTMENT");
    assert.equal(sheet.getCell("J3").value, "Finance");
    assert.equal(sheet.getCell("K3").value, "Information Technology");
    assert.equal(sheet.getCell("J4").value, 31);
    assert.equal(sheet.getCell("K4").value, 0);
    assert.equal(sheet.getCell("M2").value, null);
    const headerValues = [2, 3].flatMap((row) =>
      Array.from(
        { length: sheet.columnCount },
        (_, index) => sheet.getCell(row, index + 1).value,
      ),
    );
    assert.ok(!headerValues.includes("CEO/President/Owner"));
    assert.ok(!headerValues.includes("Administration/Management"));
    assert.ok(!headerValues.includes("SURVEY QUESTIONS"));
  });

  it("uses the supplied survey demographics instead of template defaults", async () => {
    const buffer = await createWorkforceFeedbackWorkbook({
      metadata: {
        organizationName: "Test organization",
        programName: "Custom program",
        surveyDates: "2026",
      },
      demographics: [
        {
          title: "Office Location",
          groupLabel: "Office Location",
          options: [
            { label: "North", count: 8 },
            { label: "South", count: 2 },
          ],
        },
      ],
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
              demographicAgreement: {
                "Office Location": { North: 75, South: 100 },
              },
              demographicResponseCount: {
                "Office Location": { North: 8, South: 2 },
              },
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
    assert.equal(sheet.getCell("G2").value, "OFFICE LOCATION");
    assert.equal(sheet.getCell("G3").value, "North");
    assert.equal(sheet.getCell("H3").value, "South");
    assert.equal(sheet.getCell("G4").value, 8);
    assert.equal(sheet.getCell("H4").value, 2);
    assert.equal(sheet.getCell("G6").value, 75);
    assert.equal(sheet.getCell("H6").value, "x");
    assert.equal(sheet.getCell("I2").value, null);
    assert.equal(sheet.getCell("J2").value, null);
  });

  it("limits High Agreement highlights to legacy agreement cells", async () => {
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
              disagreement: 20,
              responseCount: 10,
            },
          ],
        },
      ],
      totalResponses: 10,
      responsePatternRanges: { positive: [80, 100] },
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Workforce Feedback Results");
    assert.ok(sheet);
    assert.deepEqual(sheet.getCell("D6").fill, {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "00FF00" },
      bgColor: { argb: "00FF00" },
    });
    assert.notDeepEqual(sheet.getCell("E6").fill, sheet.getCell("D6").fill);
  });

  it("applies overlap precedence and isolates disagreement highlights", async () => {
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
          options: [{ label: "Female", count: 10 }],
        },
      ],
      sections: [
        {
          title: "Test section",
          questions: [
            {
              text: "Overlapping agreement question",
              agreement: 80,
              neutral: 0,
              disagreement: 20,
              responseCount: 10,
              demographicAgreement: { Gender: { Female: 75 } },
              demographicResponseCount: { Gender: { Female: 10 } },
            },
          ],
        },
      ],
      totalResponses: 10,
      responsePatternRanges: {
        positive: [80, 100],
        neutral: [60, 80],
        negative: [20, 20],
      },
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Workforce Feedback Results");
    assert.ok(sheet);

    assert.equal(
      (sheet.getCell("D6").fill as ExcelJS.FillPattern).fgColor?.argb,
      "00FF00",
    );
    assert.equal(
      (sheet.getCell("E6").fill as ExcelJS.FillPattern).fgColor?.argb,
      "FF0000",
    );
    assert.equal(
      (sheet.getCell("G6").fill as ExcelJS.FillPattern).fgColor?.argb,
      "FFFF00",
    );
  });

  it("rotates demographic headers in row 3", async () => {
    const buffer = await createWorkforceFeedbackWorkbook({
      metadata: {
        organizationName: "Test organization",
        programName: "Test program",
        surveyDates: "2026",
      },
      demographics: [
        {
          title: "Office Location",
          groupLabel: "Office Location",
          options: [
            { label: "North", count: 6 },
            { label: "South", count: 4 },
          ],
        },
      ],
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

    for (const address of ["D3", "E3", "G3", "H3"]) {
      assert.equal(sheet.getCell(address).alignment.textRotation, 90, address);
    }
    assert.notEqual(sheet.getCell("F3").alignment.textRotation, 90);
    assert.notEqual(sheet.getCell("B3").alignment.textRotation, 90);
    for (let column = 1; column <= sheet.columnCount; column += 1) {
      assert.equal(sheet.getCell(1, column).value, null);
    }
    assert.equal(sheet.getCell("B2").value, null);
    assert.equal(sheet.getCell("G4").value, 6);
    for (const column of [1, 3, 6, 9]) {
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
    const emptySheet = workbook.getWorksheet("Verbatims Q2");
    assert.ok(sheet);
    assert.ok(emptySheet);
    assert.equal(sheet.columnCount, 1);
    assert.equal(sheet.rowCount, 6);
    assert.deepEqual(conditionalFormattingRanges(sheet), ["A5:A6"]);
    assert.equal(sheet.getCell("A5").value, "Autonomy");
    assert.equal(sheet.getCell("A6").value, "People");
    assert.equal(emptySheet.columnCount, 1);
    assert.equal(emptySheet.rowCount, 4);
    assert.deepEqual(conditionalFormattingRanges(emptySheet), []);
  });

  it("includes the sorting field and each respondent's displayed value", async () => {
    const buffer = await createVerbatimWorkbook({
      metadata: {
        organizationName: "Actual Organization Name",
        programName: "Test program",
        surveyDates: "2026",
      },
      demographicTitle: "Department",
      questions: [
        {
          text: "What do you value?",
          responses: [
            { answer: "Autonomy", demographic: "Human Resources" },
            {
              answer: "People",
              demographic: "Customer Service/Care/Support",
            },
          ],
        },
      ],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Verbatims Q1");
    assert.ok(sheet);
    assert.equal(sheet.columnCount, 2);
    assert.equal(sheet.rowCount, 6);
    assert.deepEqual(conditionalFormattingRanges(sheet), ["A5:B6"]);
    assert.match(
      String(sheet.getCell("A3").value),
      /Actual Organization Name/u,
    );
    assert.equal(sheet.getCell("B4").value, "Department");
    assert.equal(sheet.getCell("B5").value, "Human Resources");
    assert.equal(sheet.getCell("B6").value, "Customer Service/Care/Support");
  });

  it("extends both template sheets when responses exceed their placeholder rows", async () => {
    const responses = (prefix: string, count: number) =>
      Array.from({ length: count }, (_, index) => ({
        answer: `${prefix} ${index + 1}`,
        demographic: `Group ${index + 1}`,
      }));
    const buffer = await createVerbatimWorkbook({
      metadata: {
        organizationName: "Test organization",
        programName: "Test program",
        surveyDates: "2026",
      },
      demographicTitle: "Department",
      questions: [
        { text: "Question one", responses: responses("First answer", 137) },
        { text: "Question two", responses: responses("Second answer", 83) },
      ],
    });
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const firstSheet = workbook.getWorksheet("Verbatims Q1");
    const secondSheet = workbook.getWorksheet("Verbatims Q2");
    assert.ok(firstSheet);
    assert.ok(secondSheet);
    assert.equal(firstSheet.getCell("A141").value, "First answer 137");
    assert.equal(firstSheet.getCell("B141").value, "Group 137");
    assert.equal(secondSheet.getCell("A87").value, "Second answer 83");
    assert.equal(secondSheet.getCell("B87").value, "Group 83");
    assert.equal(firstSheet.rowCount, 141);
    assert.equal(secondSheet.rowCount, 87);
    assert.deepEqual(conditionalFormattingRanges(firstSheet), ["A5:B141"]);
    assert.deepEqual(conditionalFormattingRanges(secondSheet), ["A5:B87"]);
  });
});

describe("benchmark workbook generation", () => {
  it("removes unused benchmark-category columns", async () => {
    const buffer = await createBenchmarkWorkbook({
      metadata: {
        organizationName: "Test organization",
        programName: "Test program",
        surveyDates: "2026",
      },
      headers: [
        { title: "All Size Categories", type: "All_Yes" },
        { title: "All Size Categories", type: "All_No" },
      ],
      categories: [
        {
          title: "Core Employee Experience",
          values: [91, "x"],
          questions: [{ text: "I can do my best work", values: [90, "x"] }],
        },
      ],
      surveyAverage: [89, "x"],
      cohortOrganizationCount: 13,
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Workforce Benchmark Comparisons");
    assert.ok(sheet);
    assert.equal(sheet.columnCount, 3);
    assert.equal(sheet.pageSetup.printArea, "A1:C106");
    assert.equal(sheet.getCell("B9").value, 90);
    assert.equal(sheet.getCell("C9").value, "x");
    assert.ok(sheet.model.merges.includes("B1:C1"));
    assert.ok(sheet.model.merges.includes("A8:C8"));
    assert.equal(sheet.model.merges.some((merge) => /[D-I]/u.test(merge)), false);
  });

  it("fills the supplied nine-column benchmark template in cohort order", async () => {
    const buffer = await createBenchmarkWorkbook({
      metadata: {
        organizationName: "Test organization",
        programName: "Test program",
        surveyDates: "2026",
      },
      headers: [
        { title: "All Size Categories", type: "All_Yes" },
        { title: "All Size Categories", type: "All_No" },
        { title: "Small Employers", type: "Small_Yes", employeeSize: "15-49 US" },
        { title: "Small Employers", type: "Small_No", employeeSize: "15-49 US" },
        { title: "Medium Employers", type: "Medium_Yes", employeeSize: "50-249 US" },
        { title: "Medium Employers", type: "Medium_No", employeeSize: "50-249 US" },
        { title: "Large Employers", type: "Large_Yes", employeeSize: "250+ US" },
        { title: "Large Employers", type: "Large_No", employeeSize: "250+ US" },
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
    const titleFill = sheet.getCell("A1").fill;
    const sectionFill = sheet.getCell("A8").fill;
    const averageFill = sheet.getCell("A18").fill;
    assert.equal(titleFill.type, "pattern");
    assert.equal(sectionFill.type, "pattern");
    assert.equal(averageFill.type, "pattern");
    assert.match(titleFill.fgColor?.argb ?? "", /2E1065$/u);
    assert.match(sectionFill.fgColor?.argb ?? "", /2E1065$/u);
    assert.match(averageFill.fgColor?.argb ?? "", /E2E8F0$/u);
    assert.match(sheet.getCell("A1").font.color?.argb ?? "", /F3F4F5$/u);
    assert.match(sheet.getCell("A8").font.color?.argb ?? "", /F3F4F5$/u);

    const archive = new AdmZip(buffer);
    const drawing = archive
      .getEntry("xl/drawings/drawing1.xml")
      ?.getData()
      .toString("utf8");
    assert.ok(drawing);
    assert.match(drawing, /<a:off x="128000" y="72000"\/>/u);
    assert.match(drawing, /<a:ext cx="2857500" cy="476250"\/>/u);
    const logo = archive.getEntry("xl/media/image1.png")?.getData();
    assert.ok(logo);
    assert.equal(
      crypto.createHash("sha256").update(logo).digest("hex"),
      "3db66c047e152acae3ff3b8f0792527865d230d8a2389a9a166c1e5104d64a9c",
    );
  });
});
