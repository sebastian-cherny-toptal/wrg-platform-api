import assert from "node:assert/strict";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import { CompatibilityReportsService } from "../../src/modules/reports/compatibility-reports.module.js";
import { demoUserDemographicResponse } from "../../src/modules/reports/demo-user-demographic-response.js";
import { demoUserResponseBreakdownBySection } from "../../src/modules/reports/demo-user-response-breakdown.js";

describe("Demo User report fixtures", () => {
  it("serves the demo response breakdown without resolving a database program", async () => {
    const service = new CompatibilityReportsService({} as never);
    const result = await service.responseBreakdownBySection(
      {
        sub: "bypass-login-auth",
        organizationId: null,
        roles: ["admin"],
        permissions: ["ops.manage"],
      },
      {
        selectedProgramId: "demo-workplace-2025",
        isDummy: false,
      },
    );

    assert.deepEqual(result, demoUserResponseBreakdownBySection);
  });

  it("serves question-level demo data for a selected section", async () => {
    const service = new CompatibilityReportsService({} as never);
    const result = await service.responseBreakdown(
      {
        sub: "bypass-login-auth",
        organizationId: null,
        roles: ["admin"],
        permissions: ["ops.manage"],
      },
      {
        selectedProgramId: "demo-workplace-2025",
        isDummy: false,
      },
      ["21", "2"],
    );

    assert.equal(result.data.length, 2);
    const firstQuestion = result.data[0];
    assert.ok(firstQuestion);
    assert.equal(firstQuestion.questionId, "21");
    assert.equal(
      firstQuestion.question,
      "This organization's culture allows me to do my best work",
    );
    const firstResponse = firstQuestion.responses[0];
    assert.ok(firstResponse);
    assert.equal(firstResponse.ResponseCaption, "Agree");
    assert.equal(firstResponse.percent, 0.8);
  });

  it("serves Cohen annual averages without resolving database contexts", async () => {
    const service = new CompatibilityReportsService({} as never);
    const principal = {
      sub: "demo-user",
      organizationId: null,
      roles: ["client"],
      permissions: [],
    };
    const query = { selectedProgramId: "demo-workplace-2025", isDummy: false };

    const averages = await service.annualResponseRate(principal, query);
    const categories = await service.annualCategories(principal, query);

    assert.deepEqual(averages.data, [{ "2025": "83", "2024": "84" }]);
    assert.equal(categories.data[0]?.category.category, "Core Employee Experience");
    const firstCategory = categories.data[0] as unknown as Record<
      string,
      { data: { percentage: number }[] }
    >;
    assert.equal(firstCategory["2025"]?.data[0]?.percentage, 87);
    assert.equal(firstCategory["2024"]?.data[0]?.percentage, 86);
  });

  it("serves the demographic response counts for the Demo User", async () => {
    const service = new CompatibilityReportsService({} as never);
    const result = await service.demographicResponseCounts(
      {
        sub: "demo-user",
        organizationId: null,
        roles: ["client"],
        permissions: [],
      },
      {
        selectedProgramId: "demo-workplace-2025",
        isDummy: false,
      },
    );

    assert.deepEqual(result, demoUserDemographicResponse);
    assert.deepEqual(result.data[0], {
      QuestionId: 214,
      category: "Personal Demographics",
      categoryLabel: "Gender",
      options: [
        { Caption: "Female", Count: 81 },
        { Caption: "Male", Count: 118 },
        { Caption: "Non-Binary", Count: 0 },
        { Caption: "Prefer not to answer", Count: 0 },
      ],
    });
  });

  it("builds response-pattern preview percentages from report data", async () => {
    const service = new CompatibilityReportsService({} as never);
    const result = await service.feedbackPreview(
      {
        sub: "demo-user",
        organizationId: null,
        roles: ["client"],
        permissions: [],
      },
      {
        selectedProgramId: "demo-workplace-2025",
        isDummy: false,
      },
      { positive: [80, 100] },
    );

    assert.equal(result.success, true);
    assert.equal(result.isFallback, false);
    assert.equal(result.data.heatmapPreview.length, 82);
    assert.equal(result.data.percentage.positivePercentage, 64.63);
    assert.equal(result.data.percentage.greenPercentage, 64.63);
  });

  it("serves benchmark cards with question-level detail rows", async () => {
    const service = new CompatibilityReportsService({} as never);
    const result = await service.workforceComparison(
      {
        sub: "demo-user",
        organizationId: null,
        roles: ["client"],
        permissions: [],
      },
      {
        selectedProgramId: "demo-workplace-2025",
        isDummy: false,
      },
    );

    const firstCategory = result.data.data[0] as {
      dataValues: (number | string)[];
      nestedData: { title: string }[];
    };
    assert.equal(result.data.tableHeaders.length, 12);
    assert.deepEqual(firstCategory.dataValues.slice(0, 4), [91, "x", 96, "x"]);
    assert.equal(firstCategory.nestedData.length, 9);
    assert.equal(
      firstCategory.nestedData[0]?.title,
      "This organization's culture allows me to do my best work",
    );

    const comparison = await service.questionComparisonWithMe(
      {
        sub: "demo-user",
        organizationId: null,
        roles: ["client"],
        permissions: [],
      },
      {
        selectedProgramId: "demo-workplace-2025",
        isDummy: false,
      },
      "Core Employee Experience",
      "SmallYes",
    );
    assert.equal(comparison.data.questionResponse.length, 9);
    assert.deepEqual(comparison.data.questionResponse[0], {
      question: "This organization's culture allows me to do my best work",
      currentOrg: 80,
      otherOrg: 93,
    });
  });

  it("populates the branded XLSX templates without unresolved placeholders", async () => {
    const service = new CompatibilityReportsService({} as never);
    const principal = {
      sub: "demo-user",
      organizationId: null,
      roles: ["client"],
      permissions: [],
    };
    const query = { selectedProgramId: "demo-workplace-2025", isDummy: false };
    const workbooks = await Promise.all([
      service.feedbackWorkbook(principal, query, false),
      service.benchmarkWorkbook(principal, query),
      service.openResponsesWorkbook(principal, query),
      service.employerBenchmarkWorkbook(principal, query),
      service.responseDetailWorkbook(principal, query),
    ]);
    const loaded = await Promise.all(
      workbooks.map(async (buffer) => {
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(buffer as never);
        workbook.eachSheet((sheet) => {
          sheet.eachRow({ includeEmpty: true }, (row) => {
            row.eachCell({ includeEmpty: true }, (cell) => {
              assert.doesNotMatch(String(cell.value ?? ""), /\{\{/u);
            });
          });
        });
        return workbook;
      }),
    );

    const [feedback, benchmark, verbatims, benefits, responseDetail] = loaded;
    assert.ok(feedback);
    assert.ok(benchmark);
    assert.ok(verbatims);
    assert.ok(benefits);
    assert.ok(responseDetail);
    const feedbackSheet = feedback.worksheets[0];
    const benchmarkSheet = benchmark.worksheets[0];
    const verbatimSheet = verbatims.worksheets[0];
    const benefitsSheet = benefits.worksheets[0];
    const responseDetailSheet = responseDetail.worksheets[0];
    assert.ok(feedbackSheet);
    assert.ok(benchmarkSheet);
    assert.ok(verbatimSheet);
    assert.ok(benefitsSheet);
    assert.ok(responseDetailSheet);

    assert.equal(feedbackSheet.name, "Workforce Feedback Results");
    assert.match(String(feedbackSheet.getCell("B3").value), /Cohen & Steers/u);
    assert.equal(feedbackSheet.getCell("B6").value, "This organization's culture allows me to do my best work");
    assert.equal(feedbackSheet.getCell("D6").value, 80);
    assert.equal(benchmarkSheet.name, "Workforce Benchmark Comparisons");
    assert.match(String(benchmarkSheet.getCell("A6").value), /Money Management 2025/u);
    assert.equal(verbatims.worksheets.length, 2);
    assert.equal(verbatimSheet.getCell("A5").value, "The people, collaborative culture, and meaningful work.");
    assert.equal(benefitsSheet.getCell("B1").value, "All Winners");
    assert.equal(responseDetailSheet.name, "Response Detail Report");
    assert.match(String(responseDetailSheet.getCell("B3").value), /Cohen & Steers/u);
  });
});
