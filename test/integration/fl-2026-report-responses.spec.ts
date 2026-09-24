import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
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
} from "../../src/modules/reports/compatibility-reports.module.js";

const sourceDirectory = process.cwd();
const eaFile = join(sourceDirectory, "FL 2026 - EA ORD.xlsx");
const efsFile = join(sourceDirectory, "FL 2026 - EFS ORD.xlsx");
const surveyDefinitionFile = join(
  sourceDirectory,
  "SUFS_Questions_and_Answers.xlsx",
);
const programId = "fl-2026";
const organizationId = "119";
const organizationName = "Step Up For Students";
const jwtSecret = "fl-2026-report-contract-test-secret";

interface Question {
  id: string;
  legacyId: null;
  externalId: null;
  dataLabel: string;
  caption: string;
  type: string;
  position: number;
  metadata: Record<string, unknown>;
}

interface Response {
  questionId: string;
  value: boolean | number | string;
  score: number | null;
  question: Question;
}

interface Respondent {
  id: string;
  legacyId: string;
  externalId: null;
  metadata: Record<string, never>;
  organizationId: string;
  completedAt: Date | null;
  createdAt: Date;
  responses: Response[];
}

interface JsonResponse {
  statusCode: number;
  json: unknown;
}

interface AnswerOption {
  Id?: unknown;
  Caption?: unknown;
  Score?: unknown;
}

let app: NestFastifyApplication;
let headers: { authorization: string };
let questions: Question[];
let respondents: Respondent[];
let targetRespondents: Respondent[];
let reportAccess: Record<string, string>;
let enrollmentMetrics: Record<string, number | string>;

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function metadata(question: Question): Record<string, unknown> {
  return question.metadata;
}

function answerOptions(question: Question): AnswerOption[] {
  const options = metadata(question).QuestionResponses;
  return Array.isArray(options)
    ? options
        .filter(
          (option) => option && typeof option === "object" && !Array.isArray(option),
        )
        .map((option) => option as AnswerOption)
    : [];
}

function answerCaption(
  question: Question,
  value: boolean | number | string,
): string {
  const options = answerOptions(question);
  if (options.length > 0) {
    const match = options.find(
      (candidate) => String(candidate.Id) === String(value),
    );
    if (typeof match?.Caption === "string") return match.Caption;
  }
  return String(value);
}

function questionCategory(question: Question): string {
  const configured = metadata(question).categoryLabel;
  if (typeof configured === "string") return configured;
  const match = /^q_([^_]+)_/u.exec(question.dataLabel);
  return match?.[1] ?? "Other";
}

function isLikert(question: Question): boolean {
  return question.type === "likert" && !question.dataLabel.includes("ORGID");
}

function isDemographic(question: Question): boolean {
  return question.type === "demographic";
}

function relevantResponses(
  population: Respondent[],
  question: Question,
): Response[] {
  return population.flatMap((respondent) =>
    respondent.responses.filter((response) => response.questionId === question.id),
  );
}

function scoredResponses(responses: Response[]): Response[] {
  return responses.filter(
    ({ score }) => score !== null && score >= 1 && score <= 5,
  );
}

function exactPercentage(numerator: number, denominator: number): number {
  return denominator === 0 ? 0 : (numerator * 100) / denominator;
}

function expectedThreeWay(responses: Response[]) {
  const valid = scoredResponses(responses);
  const counts = {
    Agree: valid.filter(({ score }) => (score ?? 0) >= 4).length,
    Neutral: valid.filter(({ score }) => score === 3).length,
    Disagree: valid.filter(({ score }) => (score ?? 6) <= 2).length,
  };
  return Object.fromEntries(
    Object.entries(counts).map(([caption, count]) => [
      caption,
      {
        numberOfResponses: count,
        percent: valid.length === 0 ? 0 : count / valid.length,
        percentage: exactPercentage(count, valid.length),
      },
    ]),
  );
}

function normalizeThreeWay(body: unknown) {
  const payload = body as {
    data: Array<Record<string, Array<Record<string, unknown>>>>;
  };
  return Object.fromEntries(
    payload.data.map((section) => {
      const entry = Object.entries(section)[0];
      assert.ok(entry);
      const [category, values] = entry;
      const totals = values.find((value) => "totalRespondents" in value) ?? {};
      const distribution: Record<
        string,
        {
          numberOfResponses: unknown;
          percent: unknown;
          percentage: unknown;
        }
      > = {};
      for (const value of values) {
        if (typeof value.ResponseCaption !== "string") continue;
        distribution[value.ResponseCaption] = {
          numberOfResponses: value.numberOfResponses,
          percent: value.percent,
          percentage: value.percentage,
        };
      }
      return [
        category,
        {
          distribution,
          totalNumberOfQuestionsPerSection:
            totals.totalNumberOfQuestionsPerSection,
          totalNumberOfResponsePerSection:
            totals.totalNumberOfResponsePerSection,
          totalRespondents: totals.totalRespondents,
        },
      ];
    }),
  );
}

function expectedSections() {
  const likert = questions.filter(isLikert);
  const categories = new Map<string, Question[]>();
  for (const question of likert) {
    const category = questionCategory(question);
    categories.set(category, [...(categories.get(category) ?? []), question]);
  }
  return Object.fromEntries(
    [...categories].map(([category, categoryQuestions]) => {
      const responses = categoryQuestions.flatMap((question) =>
        relevantResponses(targetRespondents, question),
      );
      return [
        category,
        {
          distribution: expectedThreeWay(responses),
          totalNumberOfQuestionsPerSection: categoryQuestions.length,
          totalNumberOfResponsePerSection:
            categoryQuestions.length * targetRespondents.length,
          totalRespondents: targetRespondents.length,
        },
      ];
    }),
  );
}

function expectedQuestionBreakdown() {
  return questions.filter(isLikert).map((question) => {
    const responses = relevantResponses(targetRespondents, question);
    const options = answerOptions(question);
    assert.ok(options.length > 0, `${question.dataLabel} has answer options`);
    const valid = scoredResponses(responses);
    return {
      question: question.caption,
      responses: options
        .filter(
          (option) =>
            Number(option.Score) >= 1 &&
            Number(option.Score) <= 5,
        )
        .map((option) => {
          const caption = String(option.Caption);
          const count = responses.filter(
            (response) => answerCaption(question, response.value) === caption,
          ).length;
          const score = Number(option.Score);
          return {
            ResponseCaption: caption,
            numberOfResponses: count,
            percent: exactPercentage(count, valid.length),
            agreementGroup:
              score >= 4 ? "Agree" : score <= 2 ? "Disagree" : "Neutral",
          };
        }),
    };
  });
}

function normalizeQuestionBreakdown(body: unknown) {
  const payload = body as {
    data: Array<{
      question: string;
      responses: Array<Record<string, unknown>>;
    }>;
  };
  return payload.data.map(({ question, responses }) => ({
    question,
    responses: responses.map(
      ({ ResponseCaption, numberOfResponses, percent, agreementGroup }) => ({
        ResponseCaption,
        numberOfResponses,
        percent,
        agreementGroup,
      }),
    ),
  }));
}

function expectedDemographicCounts(): Record<
  string,
  Record<string, number>
> {
  return Object.fromEntries(
    questions
      .filter(
        (question) =>
          isDemographic(question) &&
          answerOptions(question).length > 0,
      )
      .flatMap((question) => {
        const responses = relevantResponses(targetRespondents, question);
        if (responses.length === 0) return [];
        const counts = new Map<string, number>();
        for (const response of responses) {
          const caption = answerCaption(question, response.value);
          counts.set(caption, (counts.get(caption) ?? 0) + 1);
        }
        const configured = answerOptions(question).flatMap((option) =>
          typeof option.Caption === "string" ? [option.Caption] : [],
        );
        return [
          [
            question.caption,
            Object.fromEntries(
              [...new Set([...configured, ...counts.keys()])].map((caption) => [
                caption,
                counts.get(caption) ?? 0,
              ]),
            ),
          ],
        ];
      }),
  );
}

function normalizeDemographicCounts(body: unknown) {
  const payload = body as {
    data: Array<{
      categoryLabel: string;
      options: Array<{ Caption: string; Count: number }>;
    }>;
  };
  return Object.fromEntries(
    payload.data.map(({ categoryLabel, options }) => [
      categoryLabel,
      Object.fromEntries(options.map(({ Caption, Count }) => [Caption, Count])),
    ]),
  );
}

async function request(
  method: "GET" | "POST",
  path: string,
  payload?: Record<string, unknown>,
): Promise<JsonResponse> {
  const response = await app.inject({
    method,
    url: path,
    headers,
    ...(payload ? { payload } : {}),
  });
  assert.equal(response.statusCode, 200, response.body);
  return { statusCode: response.statusCode, json: response.json() };
}

async function loadFixture(): Promise<PrismaService> {
  // Reading the EA file is intentional: it protects the paired historical-import
  // fixture even though the assertions below exercise employee-report endpoints.
  const eaDefinition = await readXlsxSurveyDefinition({
    fileName: "FL 2026 - EA ORD.xlsx",
    filePath: eaFile,
    questionId: (dataLabel) => `ea:${dataLabel}`,
  });
  let eaRows = 0;
  await forEachXlsxSurveyRow(eaDefinition, {}, () => {
    eaRows += 1;
  });
  assert.equal(eaRows, 134);

  const configured = await parseSurveyDefinition(readFileSync(surveyDefinitionFile));
  const definition = await readXlsxSurveyDefinition({
    fileName: "FL 2026 - EFS ORD.xlsx",
    filePath: efsFile,
    includedQuestionLabels: configured.map(({ dataLabel }) => dataLabel),
    questionId: (dataLabel) => dataLabel,
  });
  questions = definition.questions.map((source, index) => {
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
      metadata: jsonRecord(applied.metadata),
    };
  });
  const byId = new Map(questions.map((question) => [question.id, question]));
  respondents = [];
  await forEachXlsxSurveyRow(definition, {}, (row) => {
    if (!row.organizationId) return;
    respondents.push({
      id: `respondent-${row.respondent}`,
      legacyId: String(row.respondent),
      externalId: null,
      metadata: {},
      organizationId: row.organizationId,
      completedAt: row.completed ? (row.completedAt ?? new Date(0)) : null,
      createdAt: new Date(row.rowNumber),
      responses: row.responses.flatMap((response) => {
        const question = byId.get(response.question.id);
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
  targetRespondents = respondents.filter(
    (respondent) =>
      respondent.organizationId === organizationId && respondent.completedAt,
  );
  assert.equal(targetRespondents.length, 152);

  reportAccess = {
    WFR_Access: "yes",
    EV_Access: "yes",
    SEV_Access: "yes",
    RD_Access: "yes",
  };
  enrollmentMetrics = {
    Surveys_Sent: targetRespondents.length,
    SEV_Filter: "f_WorkplaceDemographics_jobLevel_ORGID_119",
  };
  const enrollment = {
    id: "enrollment-119",
    organizationId,
    legacyId: organizationId,
    externalId: organizationId,
    dealExternalId: null,
    isWinner: null,
    currentZohoCategory: "Default",
    benchmarkCategory: "Default",
    reportAccess,
    metrics: enrollmentMetrics,
    metadata: {},
    organization: {
      name: organizationName,
      legacyId: organizationId,
      externalId: organizationId,
      metadata: {},
    },
  };
  const program = {
    id: programId,
    projectId: "best-companies-to-work-for",
    legacyId: programId,
    externalId: programId,
    name: "Best Companies to Work for in Florida 2026",
    year: 2026,
    startsAt: null,
    metadata: { benchmarkCategories: ["Default"] },
    project: {
      id: "best-companies-to-work-for",
      name: "Best Companies to Work for",
    },
  };
  const survey = {
    id: "fl-2026-efs",
    title: "Best Companies to Work for in Florida 2026 Employee Feedback Survey",
    startsAt: null,
    endsAt: null,
  };

  const selectedRespondents = (where: Record<string, unknown> | undefined) => {
    const selectedOrganization = where?.organizationId;
    return respondents.filter(
      (respondent) =>
        (selectedOrganization === undefined ||
          respondent.organizationId === selectedOrganization) &&
        (!("completedAt" in (where ?? {})) || respondent.completedAt !== null),
    );
  };
  const prisma = {
    program: { findFirst: () => program },
    organizationProgram: {
      findFirst: () => enrollment,
      findMany: () => [enrollment],
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
        const selected = new Set(where.questionId?.in ?? []);
        return respondents.flatMap((respondent) =>
          respondent.completedAt
            ? respondent.responses
                .filter((response) => selected.has(response.questionId))
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
  };
  return prisma as unknown as PrismaService;
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

describe("Florida 2026 imported report endpoint values", () => {
  before(async () => {
    const prisma = await loadFixture();
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
    const token = app.get(JwtService).sign({
      sub: "step-up-for-students-client",
      organizationId,
      roles: ["client"],
      permissions: [],
    });
    headers = { authorization: `Bearer ${token}` };
  });

  after(async () => {
    await app.close();
  });

  it("returns every dashboard number and the exact top and bottom statements", async () => {
    const [rate, agreement, statements] = await Promise.all([
      request("GET", `/client/surveyResponseRate?selectedProgramId=${programId}`),
      request(
        "GET",
        `/client/averagePercentageOfAgreement?selectedProgramId=${programId}`,
      ),
      request(
        "GET",
        `/client/dashboardTopBottomStatements?selectedProgramId=${programId}`,
      ),
    ]);
    assert.deepEqual((rate.json as { data: unknown }).data, {
      sendSurvey: 152,
      Total_Number_of_Program_EEs: 0,
      completedSurvey: 152,
      Total_Number_of_National_EEs: 0,
      responseRate: 100,
    });

    const likert = questions.filter(isLikert);
    const allResponses = likert.flatMap((question) =>
      relevantResponses(targetRespondents, question),
    );
    const valid = scoredResponses(allResponses);
    const positive = valid.filter(({ score }) => (score ?? 0) >= 4).length;
    const negative = valid.filter(({ score }) => (score ?? 6) <= 2).length;
    const agreementData = (agreement.json as { data: Record<string, unknown> })
      .data;
    assert.equal(
      Number(agreementData.percentage),
      exactPercentage(positive, valid.length),
    );
    assert.equal(
      Number(agreementData.negativePercentage),
      exactPercentage(negative, valid.length),
    );
    assert.equal(agreementData.totalRespondents, 152);
    assert.equal(agreementData.numberOfQuestions, 77);
    assert.equal(Math.round(Number(agreementData.percentage)), 89);
    assert.equal(Math.round(Number(agreementData.negativePercentage)), 4);

    const ranked = likert.map((question) => {
      const responses = scoredResponses(
        relevantResponses(targetRespondents, question),
      );
      return {
        title: question.caption,
        percentage: exactPercentage(
          responses.filter(({ score }) => (score ?? 0) >= 4).length,
          responses.length,
        ),
        position: question.position,
      };
    });
    const expectedTop = [...ranked]
      .sort(
        (left, right) =>
          right.percentage - left.percentage || left.position - right.position,
      )
      .slice(0, 3);
    const expectedBottom = [...ranked]
      .sort(
        (left, right) =>
          left.percentage - right.percentage || left.position - right.position,
      )
      .slice(0, 3);
    const statementData = (statements.json as { data: Record<string, unknown> })
      .data;
    assert.deepEqual(statementData.top, expectedTop);
    assert.deepEqual(statementData.bottom, expectedBottom);
    assert.deepEqual(
      expectedTop.map(({ title, percentage }) => ({
        title,
        displayedPercentage: Math.round(percentage),
      })),
      [
        {
          title: "I have access to dependable computer equipment",
          displayedPercentage: 98,
        },
        { title: "I find purpose in my work", displayedPercentage: 97 },
        {
          title: "I like what I do for this organization",
          displayedPercentage: 97,
        },
      ],
    );
  });

  it("returns every demographic count and filter option", async () => {
    const counts = await request(
      "GET",
      `/client/responseCountByDemographicCategory?selectedProgramId=${programId}`,
    );
    const expected = expectedDemographicCounts();
    assert.deepEqual(normalizeDemographicCounts(counts.json), expected);
    assert.deepEqual(expected["Job Level"], {
      "Director or Above": 22,
      "Hourly - Individual Contributor": 22,
      "Manager of People": 42,
      "Salaried - Individual Contributor": 66,
    });

    const filters = await request(
      "GET",
      `/client/fetchSurveyFilter?selectedProgramId=${programId}`,
    );
    const filterData = (
      filters.json as {
        data: Array<{
          filterLabel: string;
          filterOption: Array<{ Caption: string }>;
        }>;
      }
    ).data;
    assert.deepEqual(
      Object.fromEntries(
        filterData.map(({ filterLabel, filterOption }) => [
          filterLabel,
          new Set(filterOption.map(({ Caption }) => Caption)),
        ]),
      ),
      Object.fromEntries(
        Object.entries(expected).map(([label, options]) => [
          label,
          new Set(Object.keys(options)),
        ]),
      ),
    );
  });

  it("returns every section and statement count and percentage", async () => {
    const section = await request(
      "POST",
      `/client/employeeResponseBreakdownBySection?selectedProgramId=${programId}&fullReport=false`,
      { queryFilter: {} },
    );
    assert.deepEqual(normalizeThreeWay(section.json), expectedSections());

    const likertIds = questions.filter(isLikert).map(({ id }) => id);
    const detail = await request(
      "POST",
      `/client/employeeResponseBreakdown?selectedProgramId=${programId}&fullReport=false`,
      { questionRange: likertIds, queryFilter: {} },
    );
    assert.deepEqual(
      normalizeQuestionBreakdown(detail.json),
      expectedQuestionBreakdown(),
    );
  });

  it("returns the response-detail catalog and every cell for Job Level", async () => {
    const sections = await request(
      "GET",
      `/client/responseDetailReportSectionQuestions?selectedProgramId=${programId}`,
    );
    const sectionData = (
      sections.json as { data: Array<Record<string, unknown[]>> }
    ).data;
    assert.equal(
      sectionData.flatMap((section) => Object.values(section)).flat().length,
      77,
    );

    const question = questions.find(
      ({ dataLabel }) => dataLabel === "q_CoreEmployeeExperience_1",
    );
    const jobLevel = questions.find(
      ({ dataLabel }) =>
        dataLabel === "f_WorkplaceDemographics_jobLevel_ORGID_119",
    );
    assert.ok(question && jobLevel);
    const result = await request(
      "POST",
      `/client/responseDetailReportQuestionResult?selectedProgramId=${programId}&version=1`,
      { QuestionId: question.id, filterQuestion: jobLevel.id },
    );
    const body = result.json as { data: Array<Array<unknown>> };
    const expectedCounts = new Map<string, Map<string, number>>();
    const totals = new Map<string, number>();
    for (const respondent of targetRespondents) {
      const answer = respondent.responses.find(
        ({ questionId }) => questionId === question.id,
      );
      const filter = respondent.responses.find(
        ({ questionId }) => questionId === jobLevel.id,
      );
      if (!answer || !filter) continue;
      const column = answerCaption(jobLevel, filter.value);
      const row = answerCaption(question, answer.value);
      const counts = expectedCounts.get(row) ?? new Map<string, number>();
      counts.set(column, (counts.get(column) ?? 0) + 1);
      expectedCounts.set(row, counts);
      totals.set(column, (totals.get(column) ?? 0) + 1);
    }
    const header = body.data[0] as string[];
    assert.equal(header[0], "");
    for (const row of body.data.slice(1, -1) as Array<
      Array<string | { percentile: number; respondentCount: number }>
    >) {
      const caption = String(row[0]);
      for (let index = 1; index < header.length; index += 1) {
        const column = header[index] ?? "";
        const count = expectedCounts.get(caption)?.get(column) ?? 0;
        const percentage = exactPercentage(count, totals.get(column) ?? 0);
        assert.deepEqual(row[index], {
          percentile: percentage === 0 ? "0%" : `${percentage.toFixed(2)}%`,
          respondentCount: count,
        });
      }
    }
    assert.deepEqual(body.data.at(-1), [
      "Question Total",
      ...header.slice(1).map((column) => totals.get(column) ?? 0),
    ]);
  });

  it("returns first and last verbatims normally and with the purchased Job Level sort", async () => {
    const open = questions.filter(({ type }) => type === "open-text");
    const catalog = await request(
      "GET",
      `/client/getOpenResponsesQuestions?selectedProgramId=${programId}`,
    );
    const catalogData = (
      catalog.json as { data: Array<{ caption: string }> }
    ).data;
    assert.deepEqual(
      catalogData.map(({ caption }) => caption),
      open.map(({ caption }) => caption),
    );

    const jobLevel = questions.find(
      ({ dataLabel }) =>
        dataLabel === "f_WorkplaceDemographics_jobLevel_ORGID_119",
    );
    assert.ok(jobLevel);

    delete reportAccess.SEV_Access;
    delete enrollmentMetrics.SEV_Filter;
    for (const question of open) {
      const ordinary = await request(
        "POST",
        `/client/getOpenResponsesAnswers?selectedProgramId=${programId}&questionId=${encodeURIComponent(question.id)}`,
        { queryFilter: {} },
      );
      const actual = (
        ordinary.json as {
          data: {
            sortingFilter?: { label: string };
            respondentData: Array<{ responses: { Value: string } }>;
          };
        }
      ).data;
      assert.equal(actual.sortingFilter, undefined);
      const expected = targetRespondents
        .flatMap((respondent) => {
          const answer = respondent.responses.find(
            ({ questionId }) => questionId === question.id,
          );
          return answer ? [String(answer.value)] : [];
        })
        .sort((left, right) =>
          left.localeCompare(right, "en", {
            numeric: true,
            sensitivity: "base",
          }),
        );
      assert.deepEqual(
        [
          ...actual.respondentData.slice(0, 2),
          ...actual.respondentData.slice(-2),
        ].map(({ responses }) => responses.Value),
        [...expected.slice(0, 2), ...expected.slice(-2)],
      );
    }

    reportAccess.SEV_Access = "yes";
    enrollmentMetrics.SEV_Filter = jobLevel.id;
    for (const question of open) {
      const endpoint = `/client/getOpenResponsesAnswers?selectedProgramId=${programId}&questionId=${encodeURIComponent(question.id)}`;
      const sorted = await request("POST", endpoint, { queryFilter: {} });
      const actual = (
        sorted.json as {
          data: {
            sortingFilter?: { label: string };
            respondentData: Array<{
              sortingValue?: string;
              responses: { Value: string };
            }>;
          };
        }
      ).data;
      assert.equal(actual.sortingFilter?.label, "Job Level");
      const expected: Array<{
        sortingValue: string;
        sortingSortValue: string;
        value: string;
      }> = targetRespondents.flatMap((respondent) => {
        const answer = respondent.responses.find(
          ({ questionId }) => questionId === question.id,
        );
        const filter = respondent.responses.find(
          ({ questionId }) => questionId === jobLevel.id,
        );
        return answer && filter
          ? [
              {
                sortingValue: answerCaption(jobLevel, filter.value),
                sortingSortValue: String(filter.value),
                value: String(answer.value),
              },
            ]
          : [];
      });
      expected.sort((left, right) =>
        left.sortingSortValue.localeCompare(right.sortingSortValue, "en", {
          numeric: true,
          sensitivity: "base",
        }),
      );
      const relevant = (values: typeof expected) => [
        ...values.slice(0, 2),
        ...values.slice(-2),
      ].map(({ sortingValue, value }) => ({ sortingValue, value }));
      assert.deepEqual(
        [
          ...actual.respondentData.slice(0, 2),
          ...actual.respondentData.slice(-2),
        ].map(({ sortingValue, responses }) => ({
          sortingValue,
          value: responses.Value,
        })),
        relevant(expected),
      );
    }
  });
});
