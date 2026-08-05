import assert from "node:assert/strict";
import { describe, it } from "node:test";
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
});
