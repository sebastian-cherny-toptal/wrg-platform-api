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
import ExcelJS from "exceljs";
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
const winnersAndCategoriesFile = join(
  sourceDirectory,
  "Florida_2026_Winners_and_Categories.xlsx",
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

interface HeatMapPreviewBody {
  success: boolean;
  message: string;
  isConfidential: boolean;
  isFallback: boolean;
  data: {
    heatmapPreview: Array<{
      row: number;
      col: number;
      color: string;
      value: number | "x";
    }>;
    percentage: {
      positivePercentage: number;
      neutralPercentage: number;
      negativePercentage: number;
      greenPercentage: number;
      bluePercentage: number;
      redPercentage: number;
    };
  };
}

interface VerbatimBody {
  success: boolean;
  message: string;
  data: {
    respondentData: Array<Record<string, unknown>>;
    dataLen: number;
    sortingFilter?: { questionId: string; label: string };
    queryQuestion: { Caption: string; Id: string; DataLabel: string };
  };
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
let benchmarkEnrollments: Array<{
  organizationId: string;
  organizationName: string;
  surveysSent: number;
  isWinner: "Y" | "N";
  currentZohoCategory: "Small" | "Medium" | "Large";
}>;

const categoryOrder = [
  "Core Employee Experience",
  "Your Job",
  "Communication And Workplace Culture",
  "Relationship With Your Manager",
  "Training, Technology And Professional Development",
  "Diversity And Inclusion",
  "Leadership Of This Organization",
  "Employee Benefits",
  "Work-Life Balance",
] as const;

const responseColors: Record<string, string> = {
  "Strongly Agree": "#00a46a",
  Agree: "#70ad47",
  "Neither Agree nor Disagree": "#ffc955",
  Neutral: "#ffc955",
  Disagree: "#ed7d31",
  "Strongly Disagree": "#c00000",
};

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
          (option) =>
            option && typeof option === "object" && !Array.isArray(option),
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
    respondent.responses.filter(
      (response) => response.questionId === question.id,
    ),
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

function responseColor(caption: string): string {
  return responseColors[caption] ?? "#8C60F3";
}

function expectedThreeWay(responses: Response[]) {
  const valid = scoredResponses(responses);
  const counts = {
    Agree: valid.filter(({ score }) => (score ?? 0) >= 4).length,
    Neutral: valid.filter(({ score }) => score === 3).length,
    Disagree: valid.filter(({ score }) => (score ?? 6) <= 2).length,
  };
  return (["Agree", "Neutral", "Disagree"] as const).map((caption) => {
    const count = counts[caption];
    return {
      ResponseCaption: caption,
      numberOfResponses: count,
      percent: valid.length === 0 ? 0 : count / valid.length,
      percentage: exactPercentage(count, valid.length),
      colorCode: responseColor(caption),
      ...(caption === "Agree"
        ? { percentOfAgreement: valid.length === 0 ? 0 : count / valid.length }
        : {}),
    };
  });
}

function questionsInCategory(category: string): Question[] {
  return questions.filter(
    (question) => isLikert(question) && questionCategory(question) === category,
  );
}

function expectedSectionResponse(category: string) {
  const categoryQuestions = questionsInCategory(category);
  const responses = categoryQuestions.flatMap((question) =>
    relevantResponses(targetRespondents, question),
  );
  return {
    success: true,
    message: "success",
    isConfidential: false,
    data: [
      {
        [category]: [
          ...expectedThreeWay(responses),
          {
            totalNumberOfQuestionsPerSection: categoryQuestions.length,
            totalNumberOfResponsePerSection:
              categoryQuestions.length * targetRespondents.length,
            totalRespondents: targetRespondents.length,
            questionRange: categoryQuestions.map(({ id }) => id),
          },
        ],
      },
    ],
  };
}

function expectedQuestionResponse(selectedQuestions: Question[]) {
  return {
    success: true,
    message: "success",
    isConfidential: false,
    data: selectedQuestions.map((question) => {
      const responses = relevantResponses(targetRespondents, question);
      const options = answerOptions(question);
      assert.ok(options.length > 0, `${question.dataLabel} has answer options`);
      const valid = scoredResponses(responses);
      return {
        question: question.caption,
        questionId: question.id,
        responses: options
          .filter(
            (option) => Number(option.Score) >= 1 && Number(option.Score) <= 5,
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
              colorCode: responseColor(caption),
              agreementGroup:
                score >= 4 ? "Agree" : score <= 2 ? "Disagree" : "Neutral",
            };
          }),
      };
    }),
  };
}

function expectedDemographicResponse(labels: string[]) {
  const personal = new Set(["Age Generation", "Race/Ethnicity", "Gender"]);
  return {
    success: true,
    message: "success",
    data: questions
      .filter(
        (question) =>
          isDemographic(question) &&
          answerOptions(question).length > 0 &&
          labels.includes(question.caption),
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
          {
            QuestionId: question.id,
            category: personal.has(question.caption)
              ? "Personal Demographics"
              : "Workplace Demographics",
            categoryLabel: question.caption,
            options: [...new Set([...configured, ...counts.keys()])].map(
              (Caption) => ({
                Caption,
                Count: counts.get(Caption) ?? 0,
                Position: Math.max(configured.indexOf(Caption) + 1, 1),
              }),
            ),
          },
        ];
      }),
  };
}

function expectedSurveyFiltersResponse() {
  const demographics = questions
    .filter(
      (question) => isDemographic(question) && answerOptions(question).length,
    )
    .map((question) => ({
      QuestionId: question.id,
      filterLabel: question.caption,
      type: "Demographics",
      filterOption: [
        ...new Set(
          answerOptions(question).map(({ Caption }) => String(Caption)),
        ),
      ].map((Caption) => ({ Caption })),
    }))
    .sort((left, right) => left.filterLabel.localeCompare(right.filterLabel));
  return { success: true, message: "success", data: demographics };
}

interface BenchmarkGroup {
  key: string;
  size: "All" | "Small" | "Medium" | "Large";
  winner: "Yes" | "No";
  organizationIds: string[];
}

function expectedBenchmarkGroups(): BenchmarkGroup[] {
  return (["All", "Small", "Medium", "Large"] as const).flatMap((size) =>
    (["Yes", "No"] as const).map((winner) => ({
      key: `${size}${winner}`,
      size,
      winner,
      organizationIds: benchmarkEnrollments
        .filter(
          (enrollment) =>
            enrollment.isWinner === (winner === "Yes" ? "Y" : "N") &&
            (size === "All" || enrollment.currentZohoCategory === size),
        )
        .map(({ organizationId: id }) => id),
    })),
  );
}

function benchmarkPercentage(
  selectedQuestions: Question[],
  organizationIds: string[],
): number {
  const selected = new Set(selectedQuestions.map(({ id }) => id));
  const organizations = new Set(organizationIds);
  const responses = respondents.flatMap((respondent) =>
    respondent.completedAt && organizations.has(respondent.organizationId)
      ? respondent.responses.filter(({ questionId }) =>
          selected.has(questionId),
        )
      : [],
  );
  const valid = scoredResponses(responses);
  return exactPercentage(
    valid.filter(({ score }) => (score ?? 0) >= 4).length,
    valid.length,
  );
}

function expectedWorkforceBenchmarkResponse() {
  const groups = expectedBenchmarkGroups();
  const likert = questions.filter(isLikert);
  const tableHeaders = groups.map((group) => ({
    title:
      group.size === "All" ? "All Size Categories" : `${group.size} Employers`,
    type: `${group.size}_${group.winner}`,
    color: group.winner === "Yes" ? "#0f0" : "#ff0",
  }));
  const legends = [
    { color: "#00a46a", title: "Winners" },
    { color: "#ffc955", title: "Non-Winners" },
  ];
  return {
    success: true,
    message: "true",
    data: {
      tableHeaders,
      data: categoryOrder.map((title) => {
        const categoryQuestions = questionsInCategory(title);
        return {
          title,
          nestedData: categoryQuestions.map((question) => ({
            id: question.id,
            title: question.caption,
            dataValues: groups.map((group) =>
              benchmarkPercentage([question], group.organizationIds),
            ),
          })),
          dataValues: groups.map((group) =>
            benchmarkPercentage(categoryQuestions, group.organizationIds),
          ),
          legends,
        };
      }),
      surveyAverage: (["All", "Small", "Medium", "Large"] as const).map(
        (size) => {
          const yes = groups.find(
            (group) => group.size === size && group.winner === "Yes",
          );
          const no = groups.find(
            (group) => group.size === size && group.winner === "No",
          );
          assert.ok(yes && no);
          return {
            title: size === "All" ? "All Size Categories" : `${size} Employers`,
            subTitle: "Survey Average",
            Yes: {
              title: "Winners",
              value: benchmarkPercentage(likert, yes.organizationIds),
            },
            No: {
              title: "Non-Winners",
              value: benchmarkPercentage(likert, no.organizationIds),
            },
          };
        },
      ),
      cohortOrganizationCount: benchmarkEnrollments.length,
    },
  };
}

function expectedComparisonQuestions(
  category: string,
  selectedCategoryOption: string,
) {
  const group = expectedBenchmarkGroups().find(
    ({ key }) => key.toLowerCase() === selectedCategoryOption.toLowerCase(),
  );
  assert.ok(group);
  return {
    success: true,
    message: "success",
    data: {
      questionResponse: questionsInCategory(category).map((question) => ({
        question: question.caption,
        currentOrg: benchmarkPercentage([question], [organizationId]),
        otherOrg: benchmarkPercentage([question], group.organizationIds),
      })),
    },
  };
}

function expectedResponseDetail(question: Question, filterQuestion: Question) {
  const optionCaptions = answerOptions(filterQuestion).map(({ Caption }) =>
    String(Caption),
  );
  const answerCaptions = [
    ...new Set(answerOptions(question).map(({ Caption }) => String(Caption))),
  ];
  const counts = new Map<string, Map<string, number>>();
  const totals = new Map<string, number>();
  for (const respondent of targetRespondents) {
    const answer = respondent.responses.find(
      ({ questionId }) => questionId === question.id,
    );
    const filter = respondent.responses.find(
      ({ questionId }) => questionId === filterQuestion.id,
    );
    if (!answer || !filter) continue;
    const column = answerCaption(filterQuestion, filter.value);
    const row = answerCaption(question, answer.value);
    const rowCounts = counts.get(row) ?? new Map<string, number>();
    rowCounts.set(column, (rowCounts.get(column) ?? 0) + 1);
    counts.set(row, rowCounts);
    totals.set(column, (totals.get(column) ?? 0) + 1);
  }
  return {
    success: true,
    message: "success",
    data: [
      ["", ...optionCaptions],
      ...answerCaptions.map((caption) => [
        caption,
        ...optionCaptions.map((column) => {
          const count = counts.get(caption)?.get(column) ?? 0;
          const denominator = totals.get(column) ?? 0;
          const percentage =
            denominator === 0
              ? 0
              : Math.round((count * 10_000) / denominator) / 100;
          return {
            percentile: `${percentage}%`,
            respondentCount: count,
          };
        }),
      ]),
      [
        "Question Total",
        ...optionCaptions.map((column) => totals.get(column) ?? 0),
      ],
    ],
  };
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

  const configured = await parseSurveyDefinition(
    readFileSync(surveyDefinitionFile),
  );
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
    WBC_Access: "yes",
  };
  const cohortWorkbook = new ExcelJS.Workbook();
  await cohortWorkbook.xlsx.readFile(winnersAndCategoriesFile);
  const cohortSheet = cohortWorkbook.getWorksheet("Organizations");
  assert.ok(cohortSheet, "Organizations cohort worksheet exists");
  benchmarkEnrollments = [];
  cohortSheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1) return;
    const winner = row.getCell(11).text.trim();
    const category = row.getCell(12).text.trim();
    if (
      !["Winner", "Non-Winner"].includes(winner) ||
      !["Small", "Medium", "Large"].includes(category)
    ) {
      return;
    }
    benchmarkEnrollments.push({
      organizationName: row.getCell(1).text.trim(),
      organizationId: row.getCell(2).text.trim(),
      surveysSent: Number(row.getCell(4).value),
      isWinner: winner === "Winner" ? "Y" : "N",
      currentZohoCategory: category as "Small" | "Medium" | "Large",
    });
  });
  const targetBenchmark = benchmarkEnrollments.find(
    (entry) => entry.organizationId === organizationId,
  );
  assert.ok(targetBenchmark);
  enrollmentMetrics = {
    Surveys_Sent: targetBenchmark.surveysSent,
    SEV_Filter: "f_WorkplaceDemographics_jobLevel_ORGID_119",
  };
  const enrollment = {
    id: "enrollment-119",
    organizationId,
    legacyId: organizationId,
    externalId: organizationId,
    dealExternalId: null,
    isWinner: targetBenchmark.isWinner,
    currentZohoCategory: targetBenchmark.currentZohoCategory,
    benchmarkCategory: targetBenchmark.currentZohoCategory,
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
  const allEnrollments = benchmarkEnrollments.map((benchmark) =>
    benchmark.organizationId === organizationId
      ? enrollment
      : {
          id: `enrollment-${benchmark.organizationId}`,
          organizationId: benchmark.organizationId,
          legacyId: benchmark.organizationId,
          externalId: benchmark.organizationId,
          dealExternalId: null,
          isWinner: benchmark.isWinner,
          currentZohoCategory: benchmark.currentZohoCategory,
          benchmarkCategory: benchmark.currentZohoCategory,
          reportAccess: {},
          metrics: {},
          metadata: {},
          organization: {
            name: benchmark.organizationName,
            legacyId: benchmark.organizationId,
            externalId: benchmark.organizationId,
            metadata: {},
          },
        },
  );
  const program = {
    id: programId,
    projectId: "best-companies-to-work-for",
    legacyId: programId,
    externalId: programId,
    name: "Best Companies to Work for in Florida 2026",
    year: 2026,
    startsAt: new Date("2026-03-17T00:00:00.000Z"),
    metadata: { benchmarkCategories: ["Small", "Medium", "Large"] },
    project: {
      id: "best-companies-to-work-for",
      name: "Best Companies to Work for",
    },
  };
  const survey = {
    id: "fl-2026-efs",
    title:
      "Best Companies to Work for in Florida 2026 Employee Feedback Survey",
    startsAt: new Date("2026-03-17T00:00:00.000Z"),
    endsAt: new Date("2026-03-30T00:00:00.000Z"),
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
      findMany: () => allEnrollments,
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

  describe("Dashboard view", () => {
    describe("Average Positive and Average Negative Response", () => {
      it("asserts every returned value", async () => {
        const response = await request(
          "GET",
          `/client/averagePercentageOfAgreement?selectedProgramId=${programId}`,
        );
        const likert = questions.filter(isLikert);
        const valid = scoredResponses(
          likert.flatMap((question) =>
            relevantResponses(targetRespondents, question),
          ),
        );
        const positive = valid.filter(({ score }) => (score ?? 0) >= 4).length;
        const negative = valid.filter(({ score }) => (score ?? 6) <= 2).length;
        assert.deepEqual(response.json, {
          success: true,
          message: "success",
          data: {
            percentage: String(exactPercentage(positive, valid.length)),
            negativePercentage: String(exactPercentage(negative, valid.length)),
            totalRespondents: 152,
            StartDate: "2026-03-17T00:00:00.000Z",
            EndDateOld: "2026-03-30T00:00:00.000Z",
            EndDate: "2026-03-30T00:00:00.000Z",
            numberOfQuestions: 77,
          },
        });
        assert.equal(Math.round(exactPercentage(positive, valid.length)), 89);
        assert.equal(Math.round(exactPercentage(negative, valid.length)), 4);
      });
    });

    describe("Response Rate Overview", () => {
      it("asserts surveys completed, surveys sent, and response rate", async () => {
        const response = await request(
          "GET",
          `/client/surveyResponseRate?selectedProgramId=${programId}`,
        );
        assert.deepEqual(response.json, {
          success: true,
          message: "success",
          data: {
            sendSurvey: 446,
            Total_Number_of_Program_EEs: 0,
            completedSurvey: 152,
            Total_Number_of_National_EEs: 0,
            responseRate: (152 * 100) / 446,
          },
        });
        assert.equal(Math.round((152 * 100) / 446), 34);
      });
    });

    describe("What are your employees saying?", () => {
      it("asserts all fields in the top and bottom three statements", async () => {
        const response = await request(
          "GET",
          `/client/dashboardTopBottomStatements?selectedProgramId=${programId}`,
        );
        const ranked = questions.filter(isLikert).map((question) => {
          const valid = scoredResponses(
            relevantResponses(targetRespondents, question),
          );
          return {
            title: question.caption,
            percentage: exactPercentage(
              valid.filter(({ score }) => (score ?? 0) >= 4).length,
              valid.length,
            ),
            position: question.position,
          };
        });
        const top = [...ranked]
          .sort(
            (left, right) =>
              right.percentage - left.percentage ||
              left.position - right.position,
          )
          .slice(0, 3);
        const bottom = [...ranked]
          .sort(
            (left, right) =>
              left.percentage - right.percentage ||
              left.position - right.position,
          )
          .slice(0, 3);
        assert.deepEqual(response.json, {
          success: true,
          message: "success",
          data: {
            top,
            bottom,
            noteTop:
              "If your organization has a tie of four or more highest rated statements, the top three are selected in survey order.",
            noteBottom:
              "If your organization has a tie of four or more lowest rated statements, the bottom three are selected in survey order.",
          },
        });
        assert.deepEqual(
          top.map(({ title, percentage }) => [title, Math.round(percentage)]),
          [
            ["I have access to dependable computer equipment", 98],
            ["I find purpose in my work", 97],
            ["I like what I do for this organization", 97],
          ],
        );
        assert.deepEqual(
          bottom.map(({ title, percentage }) => [
            title,
            Math.round(percentage),
          ]),
          [
            ["I am rewarded for doing a good job", 74],
            ["I am kept aware of this organization's financial status", 75],
            ["I don’t worry about the security of my position", 76],
          ],
        );
      });
    });
  });

  describe("Workforce Feedback view", () => {
    const personalSections = ["Gender", "Age Generation", "Race/Ethnicity"];
    const workplaceSections = [
      "Employment Length",
      "Job Status",
      "Workplace Setting",
      "Job Level",
      "Department",
    ];

    describe("Personal Demographics", () => {
      for (const label of personalSections) {
        describe(label, () => {
          it("asserts every option, count, position, and identifier", async () => {
            const response = await request(
              "GET",
              `/client/responseCountByDemographicCategory?selectedProgramId=${programId}`,
            );
            const actual = response.json as {
              success: true;
              message: string;
              data: Array<{ categoryLabel: string }>;
            };
            assert.equal(actual.success, true);
            assert.equal(actual.message, "success");
            assert.deepEqual(
              actual.data.filter(
                ({ categoryLabel }) => categoryLabel === label,
              ),
              expectedDemographicResponse([label]).data,
            );
          });
        });
      }
    });

    describe("Workplace Demographics", () => {
      for (const label of workplaceSections) {
        describe(label, () => {
          it("asserts every option, count, position, and identifier", async () => {
            const response = await request(
              "GET",
              `/client/responseCountByDemographicCategory?selectedProgramId=${programId}`,
            );
            const actual = response.json as {
              success: true;
              message: string;
              data: Array<{ categoryLabel: string }>;
            };
            assert.equal(actual.success, true);
            assert.equal(actual.message, "success");
            assert.deepEqual(
              actual.data.filter(
                ({ categoryLabel }) => categoryLabel === label,
              ),
              expectedDemographicResponse([label]).data,
            );
          });
        });
      }
    });

    describe("Survey filters", () => {
      it("asserts every demographic filter and option returned to the frontend", async () => {
        const response = await request(
          "GET",
          `/client/fetchSurveyFilter?selectedProgramId=${programId}`,
        );
        assert.deepEqual(response.json, expectedSurveyFiltersResponse());
      });
    });
  });

  describe("Detailed Results view", () => {
    for (const category of categoryOrder) {
      describe(category, () => {
        it("asserts every category-average count, percentage, color, total, and question range", async () => {
          const categoryQuestions = questionsInCategory(category);
          const response = await request(
            "POST",
            `/client/employeeResponseBreakdownBySection?selectedProgramId=${programId}&fullReport=false`,
            { queryFilter: {} },
          );
          const body = response.json as {
            success: true;
            message: string;
            isConfidential: boolean;
            data: Array<Record<string, unknown>>;
          };
          assert.deepEqual(
            {
              success: body.success,
              message: body.message,
              isConfidential: body.isConfidential,
              data: body.data.filter((item) => category in item),
            },
            expectedSectionResponse(category),
          );
          assert.ok(categoryQuestions.length > 0);
        });

        it("asserts every question-level response count, percentage, group, and color", async () => {
          const categoryQuestions = questionsInCategory(category);
          const response = await request(
            "POST",
            `/client/employeeResponseBreakdown?selectedProgramId=${programId}&fullReport=false`,
            {
              questionRange: categoryQuestions.map(({ id }) => id),
              queryFilter: {},
            },
          );
          assert.deepEqual(
            response.json,
            expectedQuestionResponse(categoryQuestions),
          );
        });
      });
    }
  });

  describe("Response Patterns view", () => {
    const endpoint = (ranges: string) =>
      `/client/generateHeatMap?selectedProgramId=${programId}&patternMode=range&${ranges}&isPreview=true`;

    describe("High % Agreement", () => {
      it("asserts the complete preview and 80-100% result", async () => {
        const response = await request(
          "GET",
          endpoint(
            "includePositive=true&includeNeutral=false&includeNegative=false&positiveMin=80&positiveMax=100",
          ),
        );
        const body = response.json as HeatMapPreviewBody;
        assert.equal(body.success, true);
        assert.equal(body.message, "success");
        assert.equal(body.isConfidential, false);
        assert.equal(body.isFallback, false);
        assert.equal(body.data.percentage.positivePercentage, 39.39);
        assert.equal(body.data.percentage.greenPercentage, 39.39);
        assert.equal(body.data.percentage.neutralPercentage, 0);
        assert.equal(body.data.percentage.negativePercentage, 0);
        assert.equal(body.data.percentage.bluePercentage, 0);
        assert.equal(body.data.percentage.redPercentage, 0);
        assert.ok(body.data.heatmapPreview.length > 0);
      });
    });

    describe("Moderate % Agreement", () => {
      it("asserts the complete preview and 60-79% result", async () => {
        const response = await request(
          "GET",
          endpoint(
            "includePositive=false&includeNeutral=true&includeNegative=false&neutralMin=60&neutralMax=79",
          ),
        );
        const body = response.json as HeatMapPreviewBody;
        assert.equal(body.data.percentage.neutralPercentage, 7.03);
        assert.equal(body.data.percentage.bluePercentage, 7.03);
        assert.equal(body.data.percentage.positivePercentage, 0);
        assert.equal(body.data.percentage.negativePercentage, 0);
      });
    });

    describe("High % Disagreement", () => {
      it("asserts the complete preview and 10-20% result", async () => {
        const response = await request(
          "GET",
          endpoint(
            "includePositive=false&includeNeutral=false&includeNegative=true&negativeMin=10&negativeMax=20",
          ),
        );
        const body = response.json as HeatMapPreviewBody;
        assert.equal(body.data.percentage.negativePercentage, 0.02);
        assert.equal(body.data.percentage.redPercentage, 0.02);
        assert.equal(body.data.percentage.positivePercentage, 0);
        assert.equal(body.data.percentage.neutralPercentage, 0);
      });
    });

    describe("Response Patterns Report", () => {
      it("asserts every returned heat-map cell and all six percentages", async () => {
        const response = await request(
          "GET",
          endpoint(
            "includePositive=true&includeNeutral=true&includeNegative=true&positiveMin=80&positiveMax=100&neutralMin=60&neutralMax=79&negativeMin=10&negativeMax=20",
          ),
        );
        const body = response.json as HeatMapPreviewBody;
        assert.deepEqual(body.data.percentage, {
          positivePercentage: 39.39,
          neutralPercentage: 7.03,
          negativePercentage: 0.02,
          greenPercentage: 39.39,
          bluePercentage: 7.03,
          redPercentage: 0.02,
        });
        for (const cell of body.data.heatmapPreview as Array<{
          row: number;
          col: number;
          color: string;
          value: number | "x";
        }>) {
          assert.ok(Number.isInteger(cell.row) && cell.row > 0);
          assert.ok(Number.isInteger(cell.col) && cell.col > 0);
          if (cell.col === 5) {
            assert.equal(cell.color, "negative");
            assert.equal(typeof cell.value, "number");
            assert.ok(Number(cell.value) >= 10 && Number(cell.value) <= 20);
          } else if (typeof cell.value === "number" && cell.value >= 80) {
            assert.equal(cell.color, "positive");
          } else if (
            typeof cell.value === "number" &&
            cell.value >= 60 &&
            cell.value <= 79
          ) {
            assert.equal(cell.color, "neutral");
          } else {
            assert.equal(cell.color, "gray");
          }
        }
      });
    });
  });

  describe("Workforce Benchmark view", () => {
    let benchmarkBody: ReturnType<typeof expectedWorkforceBenchmarkResponse>;
    let expectedBenchmark: ReturnType<
      typeof expectedWorkforceBenchmarkResponse
    >;

    before(async () => {
      const response = await request(
        "GET",
        `/client/v2/employeeComparisonReport?selectedProgramId=${programId}`,
      );
      benchmarkBody = response.json as ReturnType<
        typeof expectedWorkforceBenchmarkResponse
      >;
      expectedBenchmark = expectedWorkforceBenchmarkResponse();
    });

    describe("Survey Average", () => {
      it("asserts all cohorts, winner/non-winner values, headers, and organization count", () => {
        assert.equal(benchmarkBody.success, true);
        assert.equal(benchmarkBody.message, "true");
        assert.deepEqual(
          benchmarkBody.data.tableHeaders,
          expectedBenchmark.data.tableHeaders,
        );
        assert.deepEqual(
          benchmarkBody.data.surveyAverage,
          expectedBenchmark.data.surveyAverage,
        );
        assert.equal(
          benchmarkBody.data.cohortOrganizationCount,
          expectedBenchmark.data.cohortOrganizationCount,
        );
        assert.deepEqual(
          benchmarkBody.data.surveyAverage.map((average) => [
            Math.round(average.Yes.value),
            Math.round(average.No.value),
          ]),
          [
            [92, 84],
            [94, 79],
            [92, 85],
            [90, 84],
          ],
        );
      });
    });

    for (const category of categoryOrder) {
      describe(category, () => {
        it("asserts every category and question benchmark value for every cohort", () => {
          assert.deepEqual(
            benchmarkBody.data.data.filter(
              (item: { title: string }) => item.title === category,
            ),
            expectedBenchmark.data.data.filter(
              ({ title }) => title === category,
            ),
          );
        });

        it("asserts every current-organization and selected-cohort question value", async () => {
          const response = await request(
            "POST",
            `/client/employeeSectionQuestionsComparisonWithMeReport?selectedProgramId=${programId}`,
            { category, selectedCategoryOption: "AllYes" },
          );
          assert.deepEqual(
            response.json,
            expectedComparisonQuestions(category, "AllYes"),
          );
        });
      });
    }
  });

  describe("Response Detail view", () => {
    describe("Section and question catalog", () => {
      it("asserts all 77 question identifiers and captions grouped by frontend section", async () => {
        const response = await request(
          "GET",
          `/client/responseDetailReportSectionQuestions?selectedProgramId=${programId}`,
        );
        assert.deepEqual(response.json, {
          success: true,
          message: "success",
          data: categoryOrder.map((category) => ({
            [category]: questionsInCategory(category).map((question) => ({
              QuestionId: question.id,
              Caption: question.caption,
            })),
          })),
        });
      });
    });

    for (const category of categoryOrder) {
      describe(category, () => {
        it("asserts every response-detail cell for every question using Job Level", async () => {
          const jobLevel = questions.find(
            ({ dataLabel }) =>
              dataLabel === "f_WorkplaceDemographics_jobLevel_ORGID_119",
          );
          assert.ok(jobLevel);
          for (const question of questionsInCategory(category)) {
            const response = await request(
              "POST",
              `/client/responseDetailReportQuestionResult?selectedProgramId=${programId}&version=1`,
              { QuestionId: question.id, filterQuestion: jobLevel.id },
            );
            assert.deepEqual(
              response.json,
              expectedResponseDetail(question, jobLevel),
            );
          }
        });
      });
    }
  });

  describe("Employee Verbatims view", () => {
    describe("Question catalog", () => {
      it("asserts every returned question field", async () => {
        const open = questions.filter(({ type }) => type === "open-text");
        const response = await request(
          "GET",
          `/client/getOpenResponsesQuestions?selectedProgramId=${programId}`,
        );
        assert.deepEqual(response.json, {
          success: true,
          message: "success",
          data: open.map((question) => ({
            caption: question.caption,
            id: question.id,
            _id: question.id,
            questionNumber: question.position,
          })),
        });
      });
    });

    const assertVerbatimEdges = async (
      questionIndex: number,
      sorted: boolean,
    ) => {
      const open = questions.filter(({ type }) => type === "open-text");
      const question = questionIndex === -1 ? open.at(-1) : open[questionIndex];
      const jobLevel = questions.find(
        ({ dataLabel }) =>
          dataLabel === "f_WorkplaceDemographics_jobLevel_ORGID_119",
      );
      assert.ok(question && jobLevel);
      if (sorted) {
        reportAccess.SEV_Access = "yes";
        enrollmentMetrics.SEV_Filter = jobLevel.id;
      } else {
        delete reportAccess.SEV_Access;
        delete enrollmentMetrics.SEV_Filter;
      }
      const response = await request(
        "POST",
        `/client/getOpenResponsesAnswers?selectedProgramId=${programId}&questionId=${encodeURIComponent(question.id)}`,
        { queryFilter: {} },
      );
      const body = response.json as VerbatimBody;
      const expected = targetRespondents.flatMap((respondent) => {
        const answer = respondent.responses.find(
          ({ questionId }) => questionId === question.id,
        );
        const filter = respondent.responses.find(
          ({ questionId }) => questionId === jobLevel.id,
        );
        if (!answer || (sorted && !filter)) return [];
        return [
          {
            _id: respondent.id,
            RespondentId: respondent.legacyId,
            responses: {
              QuestionId: question.id,
              DataLabel: question.dataLabel,
              Value: String(answer.value),
              ResponseCaption: " ",
            },
            ...(sorted && filter
              ? { sortingValue: answerCaption(jobLevel, filter.value) }
              : {}),
            sortingSortValue: sorted && filter ? String(filter.value) : null,
          },
        ];
      });
      expected.sort((left, right) =>
        sorted
          ? String(left.sortingSortValue).localeCompare(
              String(right.sortingSortValue),
              "en",
              { numeric: true, sensitivity: "base" },
            )
          : left.responses.Value.localeCompare(right.responses.Value, "en", {
              numeric: true,
              sensitivity: "base",
            }),
      );
      const visible = expected.map(({ sortingSortValue, ...item }) => {
        void sortingSortValue;
        return item;
      });
      assert.equal(body.success, true);
      assert.equal(body.message, "success");
      assert.equal(body.data.dataLen, visible.length);
      assert.deepEqual(body.data.queryQuestion, {
        Caption: question.caption,
        Id: question.id,
        DataLabel: question.dataLabel,
      });
      assert.deepEqual(
        body.data.sortingFilter,
        sorted ? { questionId: jobLevel.id, label: "Job Level" } : undefined,
      );
      assert.deepEqual(
        [
          ...body.data.respondentData.slice(0, 2),
          ...body.data.respondentData.slice(-2),
        ],
        [...visible.slice(0, 2), ...visible.slice(-2)],
      );
    };

    describe("First open-ended question", () => {
      it("asserts the first two and last two ordinary answers", () =>
        assertVerbatimEdges(0, false));
      it("asserts the first two and last two answers with the purchased Job Level sort", () =>
        assertVerbatimEdges(0, true));
    });

    describe("Last open-ended question", () => {
      it("asserts the first two and last two ordinary answers", () =>
        assertVerbatimEdges(-1, false));
      it("asserts the first two and last two answers with the purchased Job Level sort", () =>
        assertVerbatimEdges(-1, true));
    });
  });
});
