import {
  Injectable,
  Module,
  RequestMethod,
  VersioningType,
} from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { NestFactory } from "@nestjs/core";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../src/database/prisma.service.js";
import {
  JwtAuthGuard,
  type Principal,
} from "../../src/modules/auth/auth.module.js";
import {
  CompatibilityReportsController,
  CompatibilityReportsService,
} from "../../src/modules/reports/compatibility-reports.module.js";

const testJwtSecret = "test-secret-that-is-at-least-32-characters";
const routeCalls = new Map<string, number>();
const mark = (name: string) => {
  routeCalls.set(name, (routeCalls.get(name) ?? 0) + 1);
};
const success = { success: true, message: "success", data: [] };
const reportsStub = {
  employeeComparison: () => {
    mark("employeeComparison");
    return success;
  },
  workforceComparison: () => {
    mark("workforceComparison");
    return {
      success: true,
      message: "true",
      data: { tableHeaders: [], data: [], surveyAverage: [] },
    };
  },
  openResponsesWorkbook: () => {
    mark("openResponsesWorkbook");
    return Promise.resolve(Buffer.from("xlsx"));
  },
  sectionComparison: () => {
    mark("sectionComparison");
    return success;
  },
  questionComparison: () => {
    mark("questionComparison");
    return {
      success: true,
      message: "success",
      data: { questionResponse: [] },
    };
  },
  workforceQuestionComparison: () => {
    mark("workforceQuestionComparison");
    return {
      success: true,
      message: "true",
      data: { tableHeaders: [], tableData: [] },
    };
  },
  sectionComparisonWithMe: () => {
    mark("sectionComparisonWithMe");
    return {
      success: true,
      message: "success",
      data: { categoryResponse: [] },
    };
  },
  questionComparisonWithMe: () => {
    mark("questionComparisonWithMe");
    return success;
  },
  openResponseQuestions: () => {
    mark("openResponseQuestions");
    return success;
  },
  openResponseAnswers: () => {
    mark("openResponseAnswers");
    return success;
  },
  responseBreakdown: () => {
    mark("responseBreakdown");
    return success;
  },
  responseBreakdownBySection: () => {
    mark("responseBreakdownBySection");
    return success;
  },
  meanScoreBySection: () => {
    mark("meanScoreBySection");
    return success;
  },
  meanScoreByQuestions: () => {
    mark("meanScoreByQuestions");
    return success;
  },
  surveyFilters: () => {
    mark("surveyFilters");
    return success;
  },
  unavailableAnnualTrend: () => {
    mark("unavailableAnnualTrend");
    return { success: true, message: "Not available", data: [] };
  },
  surveyResponseRate: () => {
    mark("surveyResponseRate");
    return success;
  },
  surveyInformation: () => {
    mark("surveyInformation");
    return success;
  },
  averageAgreement: () => {
    mark("averageAgreement");
    return success;
  },
  topBottomStatements: () => {
    mark("topBottomStatements");
    return success;
  },
  feedbackWorkbook: () => {
    mark("feedbackWorkbook");
    return Promise.resolve(Buffer.from("xlsx"));
  },
  benchmarkWorkbook: () => {
    mark("benchmarkWorkbook");
    return Promise.resolve(Buffer.from("xlsx"));
  },
  responseDetailSections: () => {
    mark("responseDetailSections");
    return success;
  },
  responseDetailQuestionResult: () => {
    mark("responseDetailQuestionResult");
    return success;
  },
  demographicResponseCounts: () => {
    mark("demographicResponseCounts");
    return success;
  },
  customReports: () => {
    mark("customReports");
    return success;
  },
  employerBenchmarkWorkbook: () => {
    mark("employerBenchmarkWorkbook");
    return Promise.resolve(Buffer.from("xlsx"));
  },
  employerBenchmark: () => {
    mark("employerBenchmark");
    return {
      success: true,
      message: "true",
      data: { tableHeaders: [], tableData: [] },
    };
  },
  winnersList: () => {
    mark("winnersList");
    return [];
  },
  clientUsernames: () => {
    mark("clientUsernames");
    return success;
  },
  deleteOrganizationForResync: () => {
    mark("deleteOrganizationForResync");
    return success;
  },
  swapOrganizationCategoryValues: () => {
    mark("swapOrganizationCategoryValues");
    return success;
  },
  keyImpactAnalysis: () => {
    mark("keyImpactAnalysis");
    return success;
  },
  annualResponseRate: () => {
    mark("annualResponseRate");
    return success;
  },
  annualCategories: () => {
    mark("annualCategories");
    return success;
  },
  annualDetails: () => {
    mark("annualDetails");
    return success;
  },
  annualTrendWorkbook: () => {
    mark("annualTrendWorkbook");
    return Promise.resolve(Buffer.from("xlsx"));
  },
};

@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: testJwtSecret,
    });
  }

  validate(payload: Principal): Principal {
    return payload;
  }
}

@Module({
  imports: [PassportModule, JwtModule.register({ secret: testJwtSecret })],
  controllers: [CompatibilityReportsController],
  providers: [
    { provide: CompatibilityReportsService, useValue: reportsStub },
    TestJwtStrategy,
    JwtAuthGuard,
  ],
})
class CompatibilityReportsTestModule {}

async function createTestApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    CompatibilityReportsTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  app.setGlobalPrefix("api", {
    exclude: [
      { path: "client/:one", method: RequestMethod.ALL },
      { path: "client/:one/:two", method: RequestMethod.ALL },
    ],
  });
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });
  await app.init();
  return app;
}

describe("native compatibility report endpoints", () => {
  it("serves all seven migrated report routes", async () => {
    const app = await createTestApp();
    routeCalls.clear();
    const token = app.get(JwtService).sign({
      sub: "6c79998f-10bd-45af-bdd1-61e11b50297a",
      organizationId: "206ab572-1825-4327-81d7-a4c3524a938a",
      roles: ["client"],
      permissions: ["reports.read"],
    } satisfies Principal);
    const headers = { authorization: `Bearer ${token}` };
    const query = "?selectedProgramId=legacy-program";

    try {
      const responses = await Promise.all([
        app.inject({
          method: "GET",
          url: `/client/employeeComparisonReport${query}`,
          headers,
        }),
        app.inject({
          method: "GET",
          url: `/client/v2/employeeComparisonReport${query}`,
          headers,
        }),
        app.inject({
          method: "POST",
          url: `/client/getOpenResponsesAnswersReport${query}`,
          headers,
          payload: {},
        }),
        app.inject({
          method: "GET",
          url: `/client/employeeSectionComparisonReport${query}`,
          headers,
        }),
        app.inject({
          method: "POST",
          url: `/client/employeeQuestionsSectionComparisonReport${query}`,
          headers,
          payload: { category: "Your Job" },
        }),
        app.inject({
          method: "POST",
          url: `/client/v2/employeeQuestionsSectionComparisonReport${query}`,
          headers,
          payload: { category: "Your Job" },
        }),
        app.inject({
          method: "POST",
          url: `/client/employeeSectionComparisonWithMeReport${query}`,
          headers,
          payload: { selectedCategoryOption: "AllYes" },
        }),
      ]);

      for (const response of responses) {
        assert.equal(response.statusCode, 200, response.body);
      }
      assert.match(
        responses[2].headers["content-type"] ?? "",
        /spreadsheetml/u,
      );
      assert.deepEqual(Object.fromEntries(routeCalls), {
        employeeComparison: 1,
        workforceComparison: 1,
        openResponsesWorkbook: 1,
        sectionComparison: 1,
        questionComparison: 1,
        workforceQuestionComparison: 1,
        sectionComparisonWithMe: 1,
      });
    } finally {
      await app.close();
    }
  });

  it("requires native authentication and a selected program", async () => {
    const app = await createTestApp();
    const token = app.get(JwtService).sign({
      sub: "6c79998f-10bd-45af-bdd1-61e11b50297a",
      organizationId: "206ab572-1825-4327-81d7-a4c3524a938a",
      roles: ["client"],
      permissions: [],
    } satisfies Principal);
    try {
      const unauthenticated = await app.inject({
        method: "GET",
        url: "/client/employeeComparisonReport?selectedProgramId=program",
      });
      const missingProgram = await app.inject({
        method: "GET",
        url: "/client/employeeComparisonReport",
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(unauthenticated.statusCode, 401);
      assert.equal(missingProgram.statusCode, 400);
    } finally {
      await app.close();
    }
  });

  it("serves the next twenty migrated routes without legacy dispatch", async () => {
    const app = await createTestApp();
    routeCalls.clear();
    const token = app.get(JwtService).sign({
      sub: "6c79998f-10bd-45af-bdd1-61e11b50297a",
      organizationId: "206ab572-1825-4327-81d7-a4c3524a938a",
      roles: ["client"],
      permissions: ["reports.read"],
    } satisfies Principal);
    const headers = { authorization: `Bearer ${token}` };
    const query = "?selectedProgramId=legacy-program";
    const requests = [
      {
        method: "POST" as const,
        url: `/client/employeeSectionQuestionsComparisonWithMeReport${query}`,
        payload: { category: "Your Job", selectedCategoryOption: "AllYes" },
      },
      {
        method: "GET" as const,
        url: `/client/getOpenResponsesQuestions${query}`,
      },
      {
        method: "POST" as const,
        url: `/client/getOpenResponsesAnswers${query}&questionId=question-1`,
        payload: {},
      },
      {
        method: "POST" as const,
        url: `/client/employeeResponseBreakdown${query}`,
        payload: { questionRange: ["question-1"] },
      },
      {
        method: "POST" as const,
        url: `/client/employeeResponseBreakdownBySection${query}`,
        payload: {},
      },
      {
        method: "POST" as const,
        url: "/client/employeeMeanScoreBySection",
        payload: { selectedProgramId: "legacy-program" },
      },
      {
        method: "POST" as const,
        url: `/client/employeeMeanScoreByQuestions${query}`,
        payload: { questionRange: ["question-1"] },
      },
      { method: "GET" as const, url: `/client/fetchSurveyFilter${query}` },
      { method: "GET" as const, url: `/client/employeeAnnualTrends${query}` },
      {
        method: "POST" as const,
        url: `/client/employeeAnnualTrendsBySection${query}`,
        payload: { currentYear: "2026" },
      },
      { method: "GET" as const, url: `/client/surveyResponseRate${query}` },
      {
        method: "GET" as const,
        url: `/client/employeeSurveyResponseInformation${query}`,
      },
      {
        method: "GET" as const,
        url: `/client/averagePercentageOfAgreement${query}`,
      },
      {
        method: "GET" as const,
        url: `/client/dashboardTopBottomStatements${query}`,
      },
      { method: "GET" as const, url: `/client/generateHeatMap${query}` },
      {
        method: "POST" as const,
        url: `/client/generateHeatMap${query}`,
        payload: {},
      },
      {
        method: "GET" as const,
        url: `/client/generateHeatMapDetailed${query}`,
      },
      {
        method: "GET" as const,
        url: `/client/generateBenchmarkReport${query}`,
      },
      {
        method: "GET" as const,
        url: `/client/v2/generateBenchmarkReport${query}`,
      },
      {
        method: "GET" as const,
        url: `/client/responseDetailReportSectionQuestions${query}`,
      },
    ];

    try {
      const responses = await Promise.all(
        requests.map((request) => app.inject({ ...request, headers })),
      );
      assert.equal(responses.length, 20);
      for (const response of responses) {
        assert.equal(response.statusCode, 200, response.body);
      }
      for (const index of [14, 15, 16, 17, 18]) {
        assert.match(
          responses[index]?.headers["content-type"] ?? "",
          /spreadsheetml/u,
        );
      }
      assert.deepEqual(Object.fromEntries(routeCalls), {
        questionComparisonWithMe: 1,
        openResponseQuestions: 1,
        openResponseAnswers: 1,
        responseBreakdown: 1,
        responseBreakdownBySection: 1,
        meanScoreBySection: 1,
        meanScoreByQuestions: 1,
        surveyFilters: 1,
        unavailableAnnualTrend: 2,
        surveyResponseRate: 1,
        surveyInformation: 1,
        averageAgreement: 1,
        topBottomStatements: 1,
        feedbackWorkbook: 3,
        benchmarkWorkbook: 2,
        responseDetailSections: 1,
      });
    } finally {
      await app.close();
    }
  });

  it("serves the next fourteen native client report routes", async () => {
    const app = await createTestApp();
    routeCalls.clear();
    const token = app.get(JwtService).sign({
      sub: "6c79998f-10bd-45af-bdd1-61e11b50297a",
      organizationId: "206ab572-1825-4327-81d7-a4c3524a938a",
      roles: ["admin"],
      permissions: ["ops.manage", "reports.read"],
    } satisfies Principal);
    const headers = { authorization: `Bearer ${token}` };
    const query = "?selectedProgramId=legacy-program";
    const requests = [
      {
        method: "POST" as const,
        url: `/client/responseDetailReportQuestionResult${query}&version=1`,
        payload: {
          QuestionId: "question-1",
          filterQuestion: "demographic-1",
        },
      },
      {
        method: "GET" as const,
        url: `/client/responseCountByDemographicCategory${query}`,
      },
      { method: "GET" as const, url: `/client/getCustomReport${query}` },
      {
        method: "GET" as const,
        url: `/client/employerBenchmarkReportExcel${query}`,
      },
      {
        method: "GET" as const,
        url: `/client/employerBenchmarkReport${query}`,
      },
      { method: "GET" as const, url: `/client/getWinnersList${query}` },
      { method: "GET" as const, url: "/client/getAllUsername" },
      {
        method: "GET" as const,
        url: "/client/deletOrganizationDataToReSync?accountId=account-1&username=client",
      },
      { method: "GET" as const, url: "/client/replaceValues" },
      {
        method: "GET" as const,
        url: `/client/getKeyImpactAnalysis${query}`,
      },
      {
        method: "GET" as const,
        url: `/client/surveyResponseRateAnuualTrend${query}`,
      },
      {
        method: "GET" as const,
        url: `/client/employeeAnnualTrendsCategory${query}`,
      },
      {
        method: "POST" as const,
        url: `/client/employeeAnnualTrendsDetail${query}`,
        payload: {
          category: "Your Job",
          curruntYear: ["question-1"],
          prevYear: ["previous-question-1"],
        },
      },
      {
        method: "POST" as const,
        url: `/client/annualTrensReportDownload${query}`,
        payload: {},
      },
    ];

    try {
      const responses = await Promise.all(
        requests.map((request) => app.inject({ ...request, headers })),
      );
      assert.equal(responses.length, 14);
      for (const response of responses) {
        assert.equal(response.statusCode, 200, response.body);
      }
      for (const index of [3, 13]) {
        assert.match(
          responses[index]?.headers["content-type"] ?? "",
          /spreadsheetml/u,
        );
      }
      assert.deepEqual(Object.fromEntries(routeCalls), {
        responseDetailQuestionResult: 1,
        demographicResponseCounts: 1,
        customReports: 1,
        employerBenchmarkWorkbook: 1,
        employerBenchmark: 1,
        winnersList: 1,
        clientUsernames: 1,
        deleteOrganizationForResync: 1,
        swapOrganizationCategoryValues: 1,
        keyImpactAnalysis: 1,
        annualResponseRate: 1,
        annualCategories: 1,
        annualDetails: 1,
        annualTrendWorkbook: 1,
      });
    } finally {
      await app.close();
    }
  });
});

describe("native benchmark report calculations", () => {
  it("uses normalized responses and hides cohorts below five organizations", async () => {
    let reportAccess: Record<string, string> = {
      WBC_Access: "yes",
      EV_Access: "yes",
    };
    const organizations = Array.from({ length: 9 }, (_, index) => ({
      organizationId: `organization-${index + 1}`,
      metrics: {
        Current_Year_Winner: index < 5 ? "Yes" : "No",
        Current_Year_Category: "Small",
      },
      organization: { metadata: {} },
    }));
    const questions = [
      {
        id: "question-1",
        legacyId: "legacy-question-1",
        externalId: null,
        dataLabel: "q_YourJob1",
        caption: "I have the tools I need.",
        type: "5",
        position: 1,
        metadata: {},
      },
      {
        id: "question-2",
        legacyId: "legacy-question-2",
        externalId: null,
        dataLabel: "q_Leadership1",
        caption: "Leadership communicates clearly.",
        type: "5",
        position: 2,
        metadata: {},
      },
    ];
    const responses = organizations.flatMap((organization, index) =>
      questions.map((question) => ({
        questionId: question.id,
        value: index < 5 ? "Strongly Agree" : "Disagree",
        score: index < 5 ? 5 : 2,
        respondent: { organizationId: organization.organizationId },
      })),
    );
    const prisma = {
      program: {
        findFirst: () =>
          Promise.resolve({
            id: "program-id",
            metadata: {},
            project: { name: "Project" },
          }),
      },
      organizationProgram: {
        findFirst: () =>
          Promise.resolve({
            id: "enrollment-id",
            reportAccess,
          }),
        findMany: () => Promise.resolve(organizations),
      },
      survey: {
        findFirst: () =>
          Promise.resolve({ id: "survey-id", title: "Employee Survey" }),
      },
      question: { findMany: () => Promise.resolve(questions) },
      response: { findMany: () => Promise.resolve(responses) },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);
    const principal: Principal = {
      sub: "user-id",
      organizationId: "organization-1",
      roles: ["client"],
      permissions: ["reports.read"],
    };
    const query = {
      selectedProgramId: "legacy-program",
      isDummy: false,
    };

    const overall = await service.employeeComparison(principal, query);
    const workforce = await service.workforceComparison(principal, query);
    const withMe = await service.sectionComparisonWithMe(
      principal,
      query,
      "AllNo",
    );

    assert.deepEqual(overall.data, [{ AllYes: 100 }, { SmallYes: 100 }]);
    assert.equal(workforce.data.tableHeaders.length, 4);
    const firstCategory = workforce.data.data[0] as {
      dataValues: Array<number | string>;
    };
    assert.deepEqual(firstCategory.dataValues, [100, "x", 100, "x"]);
    const firstComparison = withMe.data.categoryResponse[0];
    assert.ok(firstComparison);
    assert.equal(firstComparison.currentOrg, 100);
    assert.equal(firstComparison.otherOrg, 0);

    reportAccess = {};
    const enforcedDemo = await service.employeeComparison(principal, query);
    assert.deepEqual(enforcedDemo.data, [
      { AllYes: 78 },
      { AllNo: 62 },
      { SmallYes: 76 },
      { SmallNo: 60 },
    ]);
  });

  it("builds a downloadable demo workbook without exposing live responses", async () => {
    const prisma = {
      program: {
        findFirst: () =>
          Promise.resolve({
            id: "program-id",
            metadata: {},
            project: { name: "Project" },
          }),
      },
      organizationProgram: {
        findFirst: () =>
          Promise.resolve({
            id: "enrollment-id",
            reportAccess: { WBC_Access: "yes", EV_Access: "yes" },
          }),
        findMany: () => Promise.resolve([]),
      },
      survey: {
        findFirst: () =>
          Promise.resolve({ id: "survey-id", title: "Employee Survey" }),
      },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);
    const workbook = await service.openResponsesWorkbook(
      {
        sub: "user-id",
        organizationId: "organization-id",
        roles: ["client"],
        permissions: ["reports.read"],
      },
      { selectedProgramId: "legacy-program", isDummy: true },
    );

    assert.equal(workbook.subarray(0, 2).toString("utf8"), "PK");
    assert.ok(workbook.length > 1_000);
  });

  it("calculates feedback, filters, and dashboard data from normalized respondents", async () => {
    const agreementQuestion = {
      id: "question-1",
      legacyId: "legacy-question-1",
      externalId: null,
      dataLabel: "q_YourJob1",
      caption: "I have the tools I need.",
      type: "5",
      position: 1,
      metadata: {},
    };
    const demographicQuestion = {
      id: "question-demographic",
      legacyId: "legacy-demographic",
      externalId: null,
      dataLabel: "q_DemographicsDepartment1",
      caption: "Department",
      type: "choice",
      position: 2,
      metadata: {},
    };
    const respondents = Array.from({ length: 5 }, (_, index) => ({
      id: `respondent-${index + 1}`,
      legacyId: null,
      externalId: null,
      metadata: {},
      responses: [
        {
          questionId: agreementQuestion.id,
          value: index < 3 ? "Agree" : "Disagree",
          score: index < 3 ? 4 : 2,
          question: agreementQuestion,
        },
        {
          questionId: demographicQuestion.id,
          value: index < 2 ? "Sales" : "Operations",
          score: null,
          question: demographicQuestion,
        },
      ],
    }));
    const agreementResponses = respondents.map((respondent, index) => ({
      questionId: agreementQuestion.id,
      value: index < 3 ? "Agree" : "Disagree",
      score: index < 3 ? 4 : 2,
      respondent: { organizationId: "organization-id" },
    }));
    const prisma = {
      program: {
        findFirst: () =>
          Promise.resolve({
            id: "program-id",
            metadata: {},
            project: { name: "Project" },
          }),
      },
      organizationProgram: {
        findFirst: () =>
          Promise.resolve({
            id: "enrollment-id",
            reportAccess: {
              WBC_Access: "yes",
              EV_Access: "yes",
              WFR_Access: "yes",
              RD_Access: "yes",
            },
            metrics: { total_sent_surveys: 10, surveys_completed: 5 },
          }),
        findMany: () => Promise.resolve([]),
      },
      survey: {
        findFirst: () =>
          Promise.resolve({
            id: "survey-id",
            title: "Employee Survey",
            startsAt: new Date("2026-01-01"),
            endsAt: new Date("2026-01-31"),
          }),
      },
      question: {
        findMany: () =>
          Promise.resolve([agreementQuestion, demographicQuestion]),
      },
      respondent: {
        findMany: () => Promise.resolve(respondents),
        count: () => Promise.resolve(5),
      },
      response: { findMany: () => Promise.resolve(agreementResponses) },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);
    const principal: Principal = {
      sub: "user-id",
      organizationId: "organization-id",
      roles: ["client"],
      permissions: ["reports.read"],
    };
    const query = {
      selectedProgramId: "legacy-program",
      isDummy: false,
    };

    const breakdown = await service.responseBreakdownBySection(
      principal,
      query,
    );
    const filters = await service.surveyFilters(principal, query);
    const agreement = await service.averageAgreement(principal, query);
    const responseRate = await service.surveyResponseRate(principal, query);
    const statements = await service.topBottomStatements(principal, query);
    const demographics = await service.demographicResponseCounts(
      principal,
      query,
    );
    const responseDetail = await service.responseDetailQuestionResult(
      principal,
      query,
      "legacy-question-1",
      "legacy-demographic",
    );

    const section = breakdown.data[0]?.["Your Job"];
    const agreeDistribution = section?.[0] as
      { ResponseCaption: string; percent: number } | undefined;
    assert.equal(agreeDistribution?.ResponseCaption, "Agree");
    assert.equal(agreeDistribution.percent, 60);
    assert.deepEqual(filters.data[0]?.filterOption, [
      { Caption: "Operations" },
      { Caption: "Sales" },
    ]);
    assert.equal(agreement.data.percentage, "60");
    assert.equal(responseRate.data.responseRate, 50);
    assert.equal(statements.data.top[0]?.percentage, 60);
    assert.deepEqual(demographics.data[0]?.options, [
      { Caption: "Operations", Count: 3 },
      { Caption: "Sales", Count: 2 },
    ]);
    assert.deepEqual(responseDetail.data[0], ["", "Operations", "Sales"]);
  });

  it("produces native demo employer and annual-trend reports", async () => {
    const question = {
      id: "question-1",
      legacyId: "legacy-question-1",
      externalId: null,
      dataLabel: "q_YourJob1",
      caption: "I have the tools I need.",
      type: "5",
      position: 1,
      metadata: {},
    };
    const prisma = {
      program: {
        findFirst: () =>
          Promise.resolve({
            id: "program-id",
            projectId: "project-id",
            name: "Program 2026",
            year: 2026,
            startsAt: new Date("2026-01-01"),
            metadata: {},
            project: { id: "project-id", name: "Project" },
          }),
      },
      organizationProgram: {
        findFirst: () =>
          Promise.resolve({
            id: "enrollment-id",
            reportAccess: {},
            metrics: {},
          }),
        findMany: (args: { where?: { programId?: string } }) =>
          Promise.resolve(args.where?.programId ? [] : []),
      },
      survey: {
        findFirst: () =>
          Promise.resolve({
            id: "employee-survey",
            title: "Employee Survey",
            startsAt: new Date("2026-01-01"),
            endsAt: new Date("2026-01-31"),
          }),
        findMany: () =>
          Promise.resolve([
            {
              id: "employer-survey",
              title: "Employer Survey",
              startsAt: new Date("2026-01-01"),
              endsAt: new Date("2026-01-31"),
              metadata: { kind: "employer" },
            },
          ]),
      },
      question: { findMany: () => Promise.resolve([question]) },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);
    const principal: Principal = {
      sub: "user-id",
      organizationId: "organization-id",
      roles: ["client"],
      permissions: ["reports.read"],
    };
    const query = { selectedProgramId: "legacy-program", isDummy: true };

    const employer = await service.employerBenchmark(principal, query);
    const annual = await service.annualCategories(principal, query);
    const annualRate = await service.annualResponseRate(principal, query);
    const workbook = await service.annualTrendWorkbook(principal, query);

    assert.equal(employer.data.tableData[0]?.title, "Benefits");
    assert.equal(annual.data[0]?.category.category, "Your Job");
    assert.deepEqual(annualRate.data, [{ "2026": "78", "2025": "74" }]);
    assert.equal(workbook.subarray(0, 2).toString("utf8"), "PK");
  });
});
