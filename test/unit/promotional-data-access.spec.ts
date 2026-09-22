import assert from "node:assert/strict";
import { it } from "node:test";
import { Global, Injectable, Module } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { NestFactory } from "@nestjs/core";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import { FastifyAdapter, type NestFastifyApplication } from "@nestjs/platform-fastify";
import { ExtractJwt, Strategy } from "passport-jwt";
import ExcelJS from "exceljs";
import { PrismaService } from "../../src/database/prisma.service.js";
import { JwtAuthGuard, type Principal } from "../../src/modules/auth/auth.module.js";
import {
  CompatibilityReportsController,
  CompatibilityReportsService,
} from "../../src/modules/reports/compatibility-reports.module.js";
import { ReportsModule } from "../../src/modules/reports/reports.module.js";
import { SurveysModule } from "../../src/modules/surveys/surveys.module.js";
import { TenantGuard } from "../../src/modules/tenants/tenants.module.js";

const jwtSecret = "promotional-access-test-secret-at-least-32-chars";
const realSentinel = "PRIVATE_ORGANIZATION_RESULT_98765";

@Injectable()
class TestJwtStrategy extends PassportStrategy(Strategy) {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: jwtSecret,
    });
  }

  validate(payload: Principal): Principal {
    return payload;
  }
}

it("keeps real dashboard and report responses out of promotional sessions", async () => {
  const prisma = {
    program: {
      findFirst: () => ({
        id: "program-1", projectId: "project-1", name: "Test program", year: 2026,
        startsAt: null, metadata: {}, project: { id: "project-1", name: "Test project" },
      }),
    },
    organizationProgram: {
      findFirst: () => ({
        id: "enrollment-1", reportAccess: { WFR_Access: "yes" },
        metrics: { Surveys_Sent: 98765 }, metadata: {},
        organization: { name: realSentinel },
      }),
      findMany: () => [],
    },
    survey: {
      findFirst: () => ({ id: "survey-1", title: "Employee Feedback Survey", startsAt: null, endsAt: null }),
    },
    respondent: { count: () => 7, findMany: () => [] },
    question: { findMany: () => [] },
    response: { findMany: () => [] },
  } as unknown as PrismaService;

  @Global()
  @Module({ providers: [{ provide: PrismaService, useValue: prisma }], exports: [PrismaService] })
  class TestDataModule {}

  @Module({
    imports: [PassportModule, JwtModule.register({ secret: jwtSecret }), TestDataModule, ReportsModule, SurveysModule],
    controllers: [CompatibilityReportsController],
    providers: [CompatibilityReportsService, TestJwtStrategy, JwtAuthGuard, TenantGuard],
  })
  class TestModule {}

  const app = await NestFactory.create<NestFastifyApplication>(TestModule, new FastifyAdapter(), { logger: false });
  await app.init();
  const token = (role: "promotional" | "client") => app.get(JwtService).sign({
    sub: `${role}-1`, organizationId: "organization-1", roles: [role], permissions: [],
  });
  const get = (role: "promotional" | "client", endpoint: string, isDummy = false) => app.inject({
    method: "GET", url: `/client/${endpoint}?selectedProgramId=program-1${isDummy ? "&isDummy=true" : ""}`,
    headers: { authorization: `Bearer ${token(role)}` },
  });

  try {
    for (const endpoint of ["surveyResponseRate", "averagePercentageOfAgreement", "dashboardTopBottomStatements", "responseCountByDemographicCategory"]) {
      const response = await get("promotional", endpoint);
      assert.equal(response.statusCode, 403, `${endpoint}: ${response.body}`);
      assert.doesNotMatch(response.body, /98765|PRIVATE_ORGANIZATION_RESULT/u);
    }

    for (const endpoint of ["surveyResponseRate", "averagePercentageOfAgreement", "dashboardTopBottomStatements", "responseCountByDemographicCategory"]) {
      const response = await get("promotional", endpoint, true);
      assert.equal(response.statusCode, 200, `${endpoint}: ${response.body}`);
      assert.doesNotMatch(response.body, /98765|PRIVATE_ORGANIZATION_RESULT/u);
    }

    const unsafePreview = await get("promotional", "employeeSurveyResponseInformation", true);
    assert.equal(unsafePreview.statusCode, 400, unsafePreview.body);

    for (const url of [
      "/organizations/organization-1/reports/wfr?surveyId=survey-1",
      "/surveys/survey-1",
      "/surveys/survey-1/summary",
    ]) {
      const response = await app.inject({
        method: "GET", url,
        headers: { authorization: `Bearer ${token("promotional")}` },
      });
      assert.equal(response.statusCode, 403, `${url}: ${response.body}`);
    }

    const clientResponse = await get("client", "surveyResponseRate");
    assert.equal(clientResponse.statusCode, 200, clientResponse.body);
    const clientPayload = clientResponse.json() as { data: { sendSurvey: number } };
    assert.equal(clientPayload.data.sendSurvey, 98765);

    const workbookBuffer = await app.get(CompatibilityReportsService).feedbackWorkbook(
      { sub: "promotional-1", organizationId: "organization-1", roles: ["promotional"], permissions: [] },
      { selectedProgramId: "program-1", isDummy: true },
      false,
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer as never);
    const cellValues: string[] = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          cellValues.push(String(cell.value ?? ""));
        });
      });
    });
    const workbookText = cellValues.join(" ");
    assert.match(workbookText, /Sample Organization/u);
    assert.doesNotMatch(workbookText, /PRIVATE_ORGANIZATION_RESULT|Test program|98765/u);
  } finally {
    await app.close();
  }
});
