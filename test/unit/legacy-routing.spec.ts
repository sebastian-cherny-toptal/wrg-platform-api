import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  findLegacyRoute,
  LEGACY_ROUTES,
} from "../../src/modules/legacy-endpoints/legacy-routes.js";

describe("native legacy route registry", () => {
  it("contains the remaining compatibility surface", () => {
    assert.ok(LEGACY_ROUTES.length > 0);
    assert.ok(findLegacyRoute("POST", "/webhook/dealsWebhook"));
    assert.equal(findLegacyRoute("POST", "/admin/addrole"), undefined);
    assert.equal(findLegacyRoute("POST", "/payment/checkout"), undefined);
    assert.equal(findLegacyRoute("GET", "/admin/getOrganizations"), undefined);
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
      ["POST", "/client/responseDetailReportQuestionResult"],
      ["GET", "/client/responseCountByDemographicCategory"],
      ["GET", "/client/getCustomReport"],
      ["GET", "/client/employerBenchmarkReportExcel"],
      ["GET", "/client/employerBenchmarkReport"],
      ["GET", "/client/getWinnersList"],
      ["GET", "/client/getAllUsername"],
      ["GET", "/client/deletOrganizationDataToReSync"],
      ["GET", "/client/replaceValues"],
      ["GET", "/client/getKeyImpactAnalysis"],
      ["GET", "/client/surveyResponseRateAnuualTrend"],
      ["GET", "/client/employeeAnnualTrendsCategory"],
      ["POST", "/client/employeeAnnualTrendsDetail"],
      ["POST", "/client/annualTrensReportDownload"],
      ["GET", "/admin/getroles"],
      ["GET", "/admin/getprojects"],
      ["GET", "/admin/getprojects/123"],
      ["GET", "/admin/getProgramsByProjectId"],
      ["GET", "/admin/getProgramById/123"],
      ["GET", "/admin/getpermissions/123"],
      ["POST", "/admin/addrole"],
      ["PUT", "/admin/updaterole"],
      ["POST", "/admin/managerole"],
      ["PUT", "/admin/managerole"],
      ["DELETE", "/admin/deleterole"],
      ["POST", "/admin/uploadCustomReport"],
      ["POST", "/admin/uploadKeyImpactAnalysis"],
      ["DELETE", "/admin/keyImpactAnalysis/123"],
      ["DELETE", "/admin/customReport/123"],
      ["GET", "/admin/getOrganizations"],
      ["GET", "/admin/getOrganizations/123"],
      ["GET", "/admin/order/log"],
      ["GET", "/admin/system/log"],
      ["GET", "/admin/loginSession/log"],
      ["POST", "/admin/resortOrg"],
      ["GET", "/dashboard/surveyinformation"],
      ["POST", "/payment/stripePaymentIntent"],
      ["POST", "/payment/checkout"],
      ["GET", "/zoho/syncProjects"],
      ["GET", "/zoho/syncPrograms"],
      ["GET", "/zoho/syncOrganizations"],
      ["GET", "/zoho/syncClients"],
    ] as const;
    for (const [method, path] of migratedRoutes) {
      assert.equal(findLegacyRoute(method, path), undefined);
    }
  });
});
