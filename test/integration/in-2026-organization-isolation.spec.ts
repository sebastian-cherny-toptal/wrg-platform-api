import "dotenv/config";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { after, before, describe, it } from "node:test";
import { Injectable, Module } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { NestFactory } from "@nestjs/core";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import { ExtractJwt, Strategy } from "passport-jwt";
import { PrismaService } from "../../src/database/prisma.service.js";
import {
  JwtAuthGuard,
  type Principal,
} from "../../src/modules/auth/auth.module.js";
import { ZohoService } from "../../src/modules/crm-sync/zoho.service.js";
import {
  applySurveyDefinition,
  parseSurveyDefinition,
} from "../../src/modules/imports/survey-definition.js";
import {
  forEachXlsxSurveyRow,
  readXlsxSurveyDefinition,
} from "../../src/modules/imports/xlsx-survey-importer.js";
import {
  CompatibilityReportsController,
  CompatibilityReportsService,
  type BenchmarkQuestion,
} from "../../src/modules/reports/compatibility-reports.module.js";

const eaFile = process.env.IN_2026_EA_FILE ?? "";
const efsFile = process.env.IN_2026_EFS_FILE ?? "";
const surveyDefinitionFile = process.env.IN_2026_SURVEY_DEFINITION_FILE ?? "";
const fixtureFiles = [eaFile, efsFile, surveyDefinitionFile];
const targetOrganizations = ["147", "150"] as const;
const jwtSecret = "in-2026-organization-isolation-test-secret";
const programName = "Best Places to Work in Indiana 2026";
const liveEnvironmentAvailable = Boolean(
  process.env.ZOHO_CLIENT_ID &&
  process.env.ZOHO_CLIENT_SECRET &&
  process.env.ZOHO_REFRESH_TOKEN &&
  fixtureFiles.every((file) => file && existsSync(file)),
);

interface TestResponse {
  questionId: string;
  value: boolean | number | string;
  score: number | null;
  question: BenchmarkQuestion;
}

interface TestRespondent {
  id: string;
  legacyId: string;
  externalId: null;
  metadata: Record<string, never>;
  organizationId: string;
  completedAt: Date | null;
  createdAt: Date;
  responses: TestResponse[];
}

interface TestEnrollment {
  id: string;
  organizationId: string;
  legacyId: string;
  externalId: string;
  dealExternalId: string;
  isWinner: null;
  currentZohoCategory: null;
  benchmarkCategory: null;
  reportAccess: Record<string, string>;
  metrics: Record<string, number | string>;
  metadata: Record<string, never>;
  organization: {
    name: string;
    legacyId: string;
    externalId: string;
    metadata: { sourceOrganizationId: string };
  };
}

interface VerbatimAnswerBody {
  data: {
    dataLen: number;
    respondentData: Array<{ responses: { Value: string } }>;
  };
}

interface AgreementBody {
  data: {
    percentage: string;
    negativePercentage: string;
    totalRespondents: number;
    numberOfQuestions: number;
  };
}

interface ResponseRateBody {
  data: {
    sendSurvey: number;
    completedSurvey: number;
    responseRate: number;
  };
}

let app: NestFastifyApplication;
let questions: BenchmarkQuestion[];
let respondents: TestRespondent[];
let enrollments: TestEnrollment[];
let zohoProgramId: string;

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : String(value ?? "").trim();
}

function answerHashes(values: string[]): string[] {
  return values
    .map((value) => createHash("sha256").update(value).digest("hex"))
    .sort();
}

function isOpenQuestion(question: BenchmarkQuestion): boolean {
  const metadata = record(question.metadata);
  return (
    metadata.reportRole === "verbatim" ||
    question.type.includes("open") ||
    question.type.includes("text") ||
    metadata.QuestionTypeId === 9 ||
    metadata.QuestionTypeId === "9"
  );
}

function visibleOpenQuestions(organizationId: string): BenchmarkQuestion[] {
  return questions.filter((question) => {
    if (!isOpenQuestion(question)) return false;
    const scopedOrganization = /_ORGID_(.+)$/iu.exec(question.dataLabel)?.[1];
    return !scopedOrganization || scopedOrganization === organizationId;
  });
}

function selectedRespondents(
  where: Record<string, unknown> | undefined,
): TestRespondent[] {
  const organizationId = where?.organizationId;
  return respondents.filter(
    (respondent) =>
      (organizationId === undefined ||
        respondent.organizationId === organizationId) &&
      (!("completedAt" in (where ?? {})) || respondent.completedAt !== null),
  );
}

async function createImportedProgramFixture(): Promise<PrismaService> {
  const zoho = ZohoService.fromEnv({
    ...process.env,
    ...(process.env.ZOHO_BASE_URL
      ? {
          ZOHO_CRM_BASE_URL: process.env.ZOHO_BASE_URL.replace(
            /\/crm\/v\d+\/?$/iu,
            "",
          ),
        }
      : {}),
  });
  const zohoPrograms = await zoho.getAllProgram();
  const zohoProgram = zohoPrograms.find(
    (candidate) =>
      text(candidate.Name) === programName &&
      Number(candidate.Program_Year) === 2026,
  );
  assert.ok(zohoProgram, `${programName} exists in Zoho`);
  zohoProgramId = zohoProgram.id;

  const zohoDeals = await zoho.getRecordBySearch({
    module: zoho.deal_module,
    criteria: `(Program:equals:${zohoProgramId})`,
  });
  const targetDeals = new Map(
    zohoDeals
      .filter((deal) =>
        targetOrganizations.includes(
          text(
            deal.Deal_Organization_ID,
          ) as (typeof targetOrganizations)[number],
        ),
      )
      .map((deal) => [text(deal.Deal_Organization_ID), deal]),
  );
  assert.equal(targetDeals.size, targetOrganizations.length);

  const configured = await parseSurveyDefinition(
    readFileSync(surveyDefinitionFile),
  );
  const efsDefinition = await readXlsxSurveyDefinition({
    fileName: "IN 2026 EFS ORDS.xlsx",
    filePath: efsFile,
    includedQuestionLabels: configured.map(({ dataLabel }) => dataLabel),
    questionId: (dataLabel) => dataLabel,
  });
  questions = efsDefinition.questions.map((source, index) => {
    const applied = applySurveyDefinition(
      {
        ...source,
        legacyId: null,
        externalId: null,
        position: index + 1,
        metadata: {},
      },
      configured,
    );
    return {
      id: applied.id,
      legacyId: null,
      externalId: null,
      dataLabel: applied.dataLabel,
      caption: applied.caption,
      type: applied.type,
      position: applied.position,
      metadata: applied.metadata,
    };
  });
  const questionsById = new Map(
    questions.map((question) => [question.id, question]),
  );

  respondents = [];
  const workbookNames = new Map<string, Set<string>>(
    targetOrganizations.map((organizationId) => [organizationId, new Set()]),
  );
  await forEachXlsxSurveyRow(efsDefinition, {}, (row) => {
    if (!row.organizationId) return;
    if (row.organizationName && workbookNames.has(row.organizationId)) {
      workbookNames.get(row.organizationId)?.add(row.organizationName);
    }
    respondents.push({
      id: `respondent-${row.respondent}`,
      legacyId: String(row.respondent),
      externalId: null,
      metadata: {},
      organizationId: row.organizationId,
      completedAt: row.completed ? (row.completedAt ?? new Date(0)) : null,
      createdAt: new Date(row.rowNumber),
      responses: row.responses.flatMap((response) => {
        const question = questionsById.get(response.question.id);
        return question
          ? [
              {
                questionId: question.id,
                value: response.value,
                score: response.score,
                question,
              },
            ]
          : [];
      }),
    });
  });
  assert.deepEqual(
    [...(workbookNames.get("147") ?? [])],
    ["NorthShore Health Centers, Inc."],
  );
  assert.deepEqual(
    [...(workbookNames.get("150") ?? [])],
    ["Ohio Valley Gas Corporation"],
  );

  const eaDefinition = await readXlsxSurveyDefinition({
    fileName: "IN 2026 EA ORDS.xlsx",
    filePath: eaFile,
    questionId: (dataLabel) => `ea:${dataLabel}`,
  });
  let eaRespondents = 0;
  await forEachXlsxSurveyRow(eaDefinition, {}, () => {
    eaRespondents += 1;
  });
  assert.equal(eaRespondents, 238);

  const expectedNames: Record<(typeof targetOrganizations)[number], string> = {
    "147": "NorthShore Health Centers, Inc.",
    "150": "Ohio Valley Gas Corporation",
  };
  enrollments = targetOrganizations.map((organizationId) => {
    const deal = targetDeals.get(organizationId);
    assert.ok(deal);
    if (organizationId === "147") {
      assert.match(text(deal.Alias_Name), /^NorthShore Health Centers/iu);
    } else {
      assert.equal(text(deal.Alias_Name), expectedNames[organizationId]);
    }
    const surveysSent = Number(deal.Surveys_Sent);
    assert.ok(Number.isInteger(surveysSent) && surveysSent > 0);
    return {
      id: `enrollment-${organizationId}`,
      organizationId,
      legacyId: organizationId,
      externalId: organizationId,
      dealExternalId: deal.id,
      isWinner: null,
      currentZohoCategory: null,
      benchmarkCategory: null,
      reportAccess: { EV_Access: "yes", WFR_Access: "yes" },
      metrics: {
        Source_Organization_ID: organizationId,
        Surveys_Sent: surveysSent,
      },
      metadata: {},
      organization: {
        name: expectedNames[organizationId],
        legacyId: organizationId,
        externalId: organizationId,
        metadata: { sourceOrganizationId: organizationId },
      },
    };
  });

  const program = {
    id: zohoProgramId,
    projectId: text(record(zohoProgram.Project).id),
    legacyId: zohoProgramId,
    externalId: zohoProgramId,
    name: programName,
    year: 2026,
    startsAt: null,
    metadata: {
      sourceFiles: [
        "IN 2026 EA ORDS.xlsx",
        "IN 2026 EFS QA Upload.xlsx",
        "IN 2026 EFS ORDS.xlsx",
      ],
    },
    project: {
      id: text(record(zohoProgram.Project).id),
      name: text(record(zohoProgram.Project).name),
    },
  };
  const survey = {
    id: "in-2026-efs",
    title: "Best Places to Work in Indiana 2026 Employee Feedback Survey",
    startsAt: null,
    endsAt: null,
  };

  return {
    program: { findFirst: () => program },
    organizationProgram: {
      findFirst: ({ where }: { where: { organizationId: string } }) =>
        enrollments.find(
          (enrollment) => enrollment.organizationId === where.organizationId,
        ) ?? null,
      findMany: () => enrollments,
    },
    survey: { findFirst: () => survey },
    question: { findMany: () => questions },
    respondent: {
      count: ({ where }: { where?: Record<string, unknown> }) =>
        selectedRespondents(where).length,
      findMany: ({ where }: { where?: Record<string, unknown> }) =>
        structuredClone(selectedRespondents(where)),
    },
    response: {
      findMany: ({ where }: { where: { questionId?: { in?: string[] } } }) => {
        const selectedQuestionIds = new Set(where.questionId?.in ?? []);
        return respondents.flatMap((respondent) =>
          respondent.completedAt
            ? respondent.responses
                .filter((response) =>
                  selectedQuestionIds.has(response.questionId),
                )
                .map((response) => ({
                  questionId: response.questionId,
                  value: response.value,
                  score: response.score,
                  respondent: { organizationId: respondent.organizationId },
                }))
            : [],
        );
      },
    },
  } as unknown as PrismaService;
}

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

async function requestForOrganization(
  organizationId: (typeof targetOrganizations)[number],
  method: "GET" | "POST",
  path: string,
): Promise<unknown> {
  const token = app.get(JwtService).sign({
    sub: `in-2026-${organizationId}-client`,
    organizationId,
    roles: ["client"],
    permissions: [],
  });
  const response = await app.inject({
    method,
    url: path,
    headers: { authorization: `Bearer ${token}` },
    ...(method === "POST" ? { payload: { queryFilter: {} } } : {}),
  });
  assert.equal(response.statusCode, 200, response.body);
  return response.json();
}

describe(
  "Indiana 2026 imported organization isolation",
  { skip: !liveEnvironmentAvailable },
  () => {
    before(async () => {
      const prisma = await createImportedProgramFixture();
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

      app = await NestFactory.create<NestFastifyApplication>(
        TestModule,
        new FastifyAdapter(),
        { logger: false },
      );
      await app.init();
    });

    after(async () => {
      await app.close();
    });

    it("returns only each user's organization answers", async () => {
      for (const organizationId of targetOrganizations) {
        const questionCatalog = (await requestForOrganization(
          organizationId,
          "GET",
          `/client/getOpenResponsesQuestions?selectedProgramId=${zohoProgramId}`,
        )) as {
          data: Array<{ caption: string; id: string }>;
        };
        const expectedQuestions = visibleOpenQuestions(organizationId);
        assert.deepEqual(
          answerHashes(
            questionCatalog.data.map(({ caption, id }) => `${id}\0${caption}`),
          ),
          answerHashes(
            expectedQuestions.map(
              (question) => `${question.id}\0${question.caption}`,
            ),
          ),
        );

        for (const question of expectedQuestions) {
          const body = (await requestForOrganization(
            organizationId,
            "POST",
            `/client/getOpenResponsesAnswers?selectedProgramId=${zohoProgramId}&questionId=${encodeURIComponent(question.id)}`,
          )) as VerbatimAnswerBody;
          const expectedAnswers = respondents
            .filter(
              (respondent) =>
                respondent.organizationId === organizationId &&
                respondent.completedAt,
            )
            .flatMap((respondent) => {
              const response = respondent.responses.find(
                (candidate) => candidate.questionId === question.id,
              );
              const value = response ? String(response.value).trim() : "";
              return value ? [value] : [];
            });
          const actualAnswers = body.data.respondentData.map(
            ({ responses: answer }) => answer.Value,
          );
          assert.equal(body.data.dataLen, expectedAnswers.length);
          assert.deepEqual(
            answerHashes(actualAnswers),
            answerHashes(expectedAnswers),
          );
        }
      }
    });

    it("returns only each user's organization statistics", async () => {
      const expected = {
        "147": {
          completed: 199,
          surveysSent: 552,
          positive: 75.92234305157115,
          negative: 7.598905864300487,
        },
        "150": {
          completed: 116,
          surveysSent: 124,
          positive: 80.93402856495126,
          negative: 4.148719111312627,
        },
      } as const;

      for (const organizationId of targetOrganizations) {
        const agreement = (await requestForOrganization(
          organizationId,
          "GET",
          `/client/averagePercentageOfAgreement?selectedProgramId=${zohoProgramId}`,
        )) as AgreementBody;
        const responseRate = (await requestForOrganization(
          organizationId,
          "GET",
          `/client/surveyResponseRate?selectedProgramId=${zohoProgramId}`,
        )) as ResponseRateBody;
        const organizationExpected = expected[organizationId];

        assert.equal(
          Number(agreement.data.percentage),
          organizationExpected.positive,
        );
        assert.equal(
          Number(agreement.data.negativePercentage),
          organizationExpected.negative,
        );
        assert.equal(
          agreement.data.totalRespondents,
          organizationExpected.completed,
        );
        assert.equal(agreement.data.numberOfQuestions, 77);
        assert.deepEqual(
          {
            sendSurvey: responseRate.data.sendSurvey,
            completedSurvey: responseRate.data.completedSurvey,
            responseRate: responseRate.data.responseRate,
          },
          {
            sendSurvey: organizationExpected.surveysSent,
            completedSurvey: organizationExpected.completed,
            responseRate:
              (organizationExpected.completed * 100) /
              organizationExpected.surveysSent,
          },
        );
      }
    });
  },
);
