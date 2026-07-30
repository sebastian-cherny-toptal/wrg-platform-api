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
    const firstResponse = firstQuestion.responses[0];
    assert.ok(firstResponse);
    assert.equal(firstResponse.ResponseCaption, "Agree");
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
});
