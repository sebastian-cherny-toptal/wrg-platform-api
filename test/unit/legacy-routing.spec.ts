import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findLegacyRoute,
  LEGACY_ROUTES,
} from "../../src/modules/legacy-endpoints/legacy-routes.js";

describe("native legacy route registry", () => {
  it("contains the remaining compatibility surface", () => {
    assert.ok(LEGACY_ROUTES.length > 0);
    assert.ok(
      findLegacyRoute("POST", "/client/responseDetailReportQuestionResult"),
    );
    assert.ok(findLegacyRoute("POST", "/webhook/dealsWebhook"));
    assert.ok(findLegacyRoute("POST", "/payment/checkout"));
    assert.ok(findLegacyRoute("GET", "/admin/getprojects/123"));
  });

  it("keeps route methods and parameterized paths distinct", () => {
    assert.equal(findLegacyRoute("GET", "/ping"), undefined);
    assert.equal(findLegacyRoute("GET", "/deploy-check"), undefined);
    assert.equal(findLegacyRoute("GET", "/health"), undefined);
    assert.equal(findLegacyRoute("POST", "/user/create"), undefined);
    assert.equal(findLegacyRoute("PUT", "/user/update/123"), undefined);
    assert.equal(findLegacyRoute("GET", "/user/update/123"), undefined);
    assert.equal(findLegacyRoute("GET", "/user/list"), undefined);
    assert.equal(findLegacyRoute("DELETE", "/user/delete/123"), undefined);
    assert.equal(findLegacyRoute("POST", "/user/login"), undefined);
    assert.equal(findLegacyRoute("POST", "/user/management/login"), undefined);
    assert.equal(findLegacyRoute("PUT", "/user/management/login"), undefined);
    assert.equal(
      findLegacyRoute("POST", "/user/management/register2fa"),
      undefined,
    );
    assert.equal(
      findLegacyRoute("POST", "/user/management/validate2fa"),
      undefined,
    );
    assert.equal(
      findLegacyRoute("POST", "/user/admin-reset-password"),
      undefined,
    );
    assert.equal(
      findLegacyRoute("PUT", "/user/admin-reset-password-verify"),
      undefined,
    );
    assert.equal(findLegacyRoute("POST", "/user/forgot-password"), undefined);
    assert.equal(findLegacyRoute("PUT", "/user/forgot-password"), undefined);
    assert.equal(findLegacyRoute("POST", "/user/forgot-username"), undefined);
    assert.equal(findLegacyRoute("POST", "/user/refreshtoken"), undefined);
    assert.equal(
      findLegacyRoute("POST", "/user/admin-generate-temp-password"),
      undefined,
    );
    assert.equal(
      findLegacyRoute("GET", "/user/get-temporary-password/123"),
      undefined,
    );
    assert.equal(
      findLegacyRoute("POST", "/user/change-password-after-reset"),
      undefined,
    );
    assert.equal(
      findLegacyRoute("GET", "/client/employeeComparisonReport"),
      undefined,
    );
    assert.equal(
      findLegacyRoute("GET", "/client/v2/employeeComparisonReport"),
      undefined,
    );
    assert.equal(
      findLegacyRoute("POST", "/client/getOpenResponsesAnswersReport"),
      undefined,
    );
    assert.equal(
      findLegacyRoute("GET", "/client/employeeSectionComparisonReport"),
      undefined,
    );
    assert.equal(
      findLegacyRoute(
        "POST",
        "/client/employeeQuestionsSectionComparisonReport",
      ),
      undefined,
    );
    assert.equal(
      findLegacyRoute(
        "POST",
        "/client/v2/employeeQuestionsSectionComparisonReport",
      ),
      undefined,
    );
    assert.equal(
      findLegacyRoute("POST", "/client/employeeSectionComparisonWithMeReport"),
      undefined,
    );
    const migratedRoutes = [
      ["POST", "/client/employeeSectionQuestionsComparisonWithMeReport"],
      ["GET", "/client/getOpenResponsesQuestions"],
      ["POST", "/client/getOpenResponsesAnswers"],
      ["POST", "/client/employeeResponseBreakdown"],
      ["POST", "/client/employeeResponseBreakdownBySection"],
      ["POST", "/client/employeeMeanScoreBySection"],
      ["POST", "/client/employeeMeanScoreByQuestions"],
      ["GET", "/client/fetchSurveyFilter"],
      ["GET", "/client/employeeAnnualTrends"],
      ["POST", "/client/employeeAnnualTrendsBySection"],
      ["GET", "/client/surveyResponseRate"],
      ["GET", "/client/employeeSurveyResponseInformation"],
      ["GET", "/client/averagePercentageOfAgreement"],
      ["GET", "/client/dashboardTopBottomStatements"],
      ["GET", "/client/generateHeatMap"],
      ["POST", "/client/generateHeatMap"],
      ["GET", "/client/generateHeatMapDetailed"],
      ["GET", "/client/generateBenchmarkReport"],
      ["GET", "/client/v2/generateBenchmarkReport"],
      ["GET", "/client/responseDetailReportSectionQuestions"],
    ] as const;
    for (const [method, path] of migratedRoutes) {
      assert.equal(findLegacyRoute(method, path), undefined);
    }
  });
});
