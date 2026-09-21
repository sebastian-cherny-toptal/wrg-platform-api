import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { Injectable, Module } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { NestFactory } from "@nestjs/core";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { ExtractJwt, Strategy } from "passport-jwt";
import ExcelJS from "exceljs";
import { PrismaService } from "../../src/database/prisma.service.js";
import {
  JwtAuthGuard,
  type Principal,
} from "../../src/modules/auth/auth.module.js";
import {
  CompatibilityReportsController,
  CompatibilityReportsService,
} from "../../src/modules/reports/compatibility-reports.module.js";

const jwtSecret = "test-secret-that-is-at-least-32-characters";

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

function workbookText(buffer: Buffer): Promise<string> {
  const workbook = new ExcelJS.Workbook();
  return workbook.xlsx.load(buffer as never).then(() => {
    const values: string[] = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => values.push(String(cell.value ?? "")));
      });
    });
    return values.join(" ");
  });
}

describe("Employee Verbatims direct routes", () => {
  it("keeps ordinary access before purchase, applies the purchased filter, and closes access if its selection is missing", async () => {
    const department = {
      id: "department",
      legacyId: null,
      externalId: null,
      dataLabel: "custom_department",
      caption: "Department",
      type: "demographic",
      position: 1,
      metadata: { QuestionTypeId: 2, filterLabel: "Department" },
    };
    const openQuestion = {
      id: "open-1",
      legacyId: null,
      externalId: null,
      dataLabel: "q_OpenEnded_1",
      caption: "What should we improve?",
      type: "open-text",
      position: 2,
      metadata: { QuestionTypeId: 9 },
    };
    const entitlement: Record<string, string> = { EV_Access: "yes" };
    const metrics: Record<string, string> = {};
    const respondents = Array.from({ length: 9 }, (_, index) => {
      const privateGroup = index < 4;
      return {
        id: `respondent-${index + 1}`,
        legacyId: null,
        externalId: null,
        metadata: {},
        responses: [
          {
            questionId: department.id,
            value: privateGroup ? "Private Team" : "Public Team",
            score: null,
            question: department,
          },
          {
            questionId: openQuestion.id,
            value: `${privateGroup ? "private" : "public"} answer ${index}`,
            score: null,
            question: openQuestion,
          },
        ],
      };
    });
    const prisma = {
      program: {
        findFirst: () => ({
          id: "program-1",
          projectId: "project-1",
          name: "Test program",
          year: 2026,
          startsAt: null,
          metadata: {},
          project: { id: "project-1", name: "Test project" },
        }),
      },
      organizationProgram: {
        findFirst: () => ({
          id: "enrollment-1",
          reportAccess: entitlement,
          metrics,
          metadata: {},
          organization: { name: "Test organization" },
        }),
        findMany: () => [],
      },
      survey: {
        findFirst: () => ({
          id: "survey-1",
          title: "Test Employee Feedback Survey",
          startsAt: null,
          endsAt: null,
        }),
      },
      question: { findMany: () => [department, openQuestion] },
      respondent: { findMany: () => respondents },
    } as unknown as PrismaService;

    @Module({
      imports: [PassportModule, JwtModule.register({ secret: jwtSecret })],
      controllers: [CompatibilityReportsController],
      providers: [
        CompatibilityReportsService,
        { provide: PrismaService, useValue: prisma },
        TestJwtStrategy,
        JwtAuthGuard,
      ],
    })
    class TestModule {}

    const app = await NestFactory.create<NestFastifyApplication>(
      TestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    await app.init();
    const token = app.get(JwtService).sign({
      sub: "client-1",
      organizationId: "organization-1",
      roles: ["client"],
      permissions: [],
    });
    const headers = { authorization: `Bearer ${token}` };
    const workbookRequest = () =>
      app.inject({
        method: "POST",
        url: "/client/getOpenResponsesAnswersReport?selectedProgramId=program-1",
        headers,
        payload: {},
      });
    const answersRequest = () =>
      app.inject({
        method: "POST",
        url: "/client/getOpenResponsesAnswers?selectedProgramId=program-1&questionId=open-1",
        headers,
        payload: {},
      });

    try {
      const ordinaryWorkbook = await workbookRequest();
      assert.equal(ordinaryWorkbook.statusCode, 200, ordinaryWorkbook.body);
      assert.match(
        await workbookText(ordinaryWorkbook.rawPayload),
        /private answer/u,
      );
      const ordinaryAnswers = await answersRequest();
      assert.equal(ordinaryAnswers.statusCode, 200, ordinaryAnswers.body);
      assert.match(ordinaryAnswers.body, /private answer/u);

      entitlement.SEV_Access = "yes";
      metrics.SEV_Filter = department.id;
      const sortedWorkbook = await workbookRequest();
      assert.equal(sortedWorkbook.statusCode, 200, sortedWorkbook.body);
      const sortedText = await workbookText(sortedWorkbook.rawPayload);
      assert.doesNotMatch(sortedText, /Private Team|private answer/u);
      assert.match(sortedText, /Public Team|public answer/u);
      const sortedAnswers = await answersRequest();
      assert.equal(sortedAnswers.statusCode, 200, sortedAnswers.body);
      assert.doesNotMatch(sortedAnswers.body, /Private Team|private answer/u);
      assert.match(sortedAnswers.body, /Public Team|public answer/u);
      const otherWorkbookFilter = await app.inject({
        method: "POST",
        url: "/client/getOpenResponsesAnswersReport?selectedProgramId=program-1",
        headers,
        payload: { queryFilter: { questionId: openQuestion.id } },
      });
      assert.equal(otherWorkbookFilter.statusCode, 400);
      const extraAnswerFilter = await app.inject({
        method: "POST",
        url: "/client/getOpenResponsesAnswers?selectedProgramId=program-1&questionId=open-1",
        headers,
        payload: { queryFilter: { department: "Private Team" } },
      });
      assert.equal(extraAnswerFilter.statusCode, 400);

      delete metrics.SEV_Filter;
      const unconfiguredWorkbook = await workbookRequest();
      assert.equal(unconfiguredWorkbook.statusCode, 400);
      assert.doesNotMatch(unconfiguredWorkbook.body, /private answer/u);
      const unconfiguredAnswers = await answersRequest();
      assert.equal(unconfiguredAnswers.statusCode, 400);
      assert.doesNotMatch(unconfiguredAnswers.body, /private answer/u);
    } finally {
      await app.close();
    }
  });
});
