import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@prisma/client";
import type { PrismaService } from "../../src/database/prisma.service.js";
import {
  CompatibilityReportsService,
  defaultKeyImpactContributions,
  type BenchmarkQuestion,
} from "../../src/modules/reports/compatibility-reports.module.js";

function benchmarkQuestion(
  id: string,
  categoryLabel: string,
  position: number,
): BenchmarkQuestion {
  return {
    id,
    legacyId: null,
    externalId: null,
    dataLabel: `q_${id}`,
    caption: id,
    type: "likert",
    position,
    metadata: { categoryLabel },
  };
}

describe("compatibility report categories", () => {
  it("returns the legacy key-impact defaults when no report asset exists", async () => {
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
          reportAccess: { KIA_Access: "yes" },
          metrics: {},
          metadata: {},
        }),
        findMany: () => [],
      },
      survey: {
        findFirst: () => ({
          id: "survey-1",
          title: "Test survey",
          startsAt: null,
          endsAt: null,
        }),
      },
      asset: { findMany: () => [] },
    } as unknown as PrismaService;

    const result = await new CompatibilityReportsService(
      prisma,
    ).keyImpactAnalysis(
      {
        sub: "client-1",
        organizationId: "organization-1",
        roles: ["client"],
        permissions: [],
      },
      { selectedProgramId: "program-1", isDummy: false },
    );

    assert.deepEqual(result.data.mapping, defaultKeyImpactContributions);
    assert.equal(result.data.report.length, 10);
    assert.equal(
      result.data.report[0]?.value,
      defaultKeyImpactContributions[
        "I understand how my work impacts organizational success"
      ] / 100,
    );
  });

  it("includes zero-count standard demographic options", async () => {
    const genderQuestion = {
      id: "gender-question",
      legacyId: null,
      externalId: null,
      dataLabel: "f_PersonalDemographics_gender",
      caption: "Gender",
      type: "demographic",
      position: 1,
      metadata: { QuestionTypeId: 2, filterLabel: "Gender" },
    };
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
          reportAccess: { WFR_Access: "yes" },
          metrics: {},
          metadata: {},
        }),
        findMany: () => [],
      },
      survey: {
        findFirst: () => ({
          id: "survey-1",
          title: "Test survey",
          startsAt: null,
          endsAt: null,
        }),
      },
      respondent: {
        findMany: () => [
          {
            id: "respondent-1",
            legacyId: null,
            externalId: null,
            metadata: {},
            responses: [
              {
                questionId: genderQuestion.id,
                value: 1,
                score: null,
                question: genderQuestion,
              },
            ],
          },
        ],
      },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);
    const principal = {
      sub: "admin-1",
      organizationId: "organization-1",
      roles: ["admin"],
      permissions: [],
    };
    const query = { selectedProgramId: "program-1", isDummy: false };

    const [counts, filters] = await Promise.all([
      service.demographicResponseCounts(principal, query),
      service.surveyFilters(principal, query),
    ]);

    assert.deepEqual(
      counts.data[0]?.options.map(({ Caption, Count }) => [Caption, Count]),
      [
        ["Female", 1],
        ["Male", 0],
        ["Non-Binary", 0],
        ["Prefer not to answer", 0],
      ],
    );
    assert.deepEqual(
      filters.data[0]?.filterOption.map(({ Caption }) => Caption),
      ["Female", "Male", "Non-Binary", "Prefer not to answer"],
    );
  });

  it("labels Likert ordinals, colors segments, and excludes 6/99 N/A", async () => {
    const question = benchmarkQuestion("core", "Core Employee Experience", 1);
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
          reportAccess: { WFR_Access: "yes" },
          metrics: {},
          metadata: {},
        }),
        findMany: () => [],
      },
      survey: {
        findFirst: () => ({
          id: "survey-1",
          title: "Test survey",
          startsAt: null,
          endsAt: null,
        }),
      },
      question: { findMany: () => [question] },
      respondent: {
        findMany: () =>
          [1, 2, 3, 4, 5, 6, 99].map((value) => ({
            id: `respondent-${value}`,
            legacyId: null,
            externalId: null,
            metadata: {},
            responses: [
              { questionId: question.id, value, score: null, question },
            ],
          })),
      },
    } as unknown as PrismaService;

    const result = await new CompatibilityReportsService(
      prisma,
    ).responseBreakdown(
      {
        sub: "admin-1",
        organizationId: "organization-1",
        roles: ["admin"],
        permissions: [],
      },
      { selectedProgramId: "program-1", isDummy: false },
      [question.id],
    );

    assert.deepEqual(
      result.data[0]?.responses.map(
        ({ ResponseCaption, numberOfResponses, percent, colorCode }) => ({
          ResponseCaption,
          numberOfResponses,
          percent,
          colorCode,
        }),
      ),
      [
        {
          ResponseCaption: "Strongly Disagree",
          numberOfResponses: 1,
          percent: 20,
          colorCode: "#c00000",
        },
        {
          ResponseCaption: "Disagree",
          numberOfResponses: 1,
          percent: 20,
          colorCode: "#ed7d31",
        },
        {
          ResponseCaption: "Neutral",
          numberOfResponses: 1,
          percent: 20,
          colorCode: "#ffc955",
        },
        {
          ResponseCaption: "Agree",
          numberOfResponses: 1,
          percent: 20,
          colorCode: "#70ad47",
        },
        {
          ResponseCaption: "Strongly Agree",
          numberOfResponses: 1,
          percent: 20,
          colorCode: "#00a46a",
        },
      ],
    );
  });

  it("returns dummy report data only for promotional users", async () => {
    const prisma = {
      program: {
        findFirst: () => ({
          id: "program-1",
          projectId: "project-1",
          name: "Test program",
          year: 2026,
          startsAt: null,
          metadata: {} as Prisma.JsonValue,
          project: { id: "project-1", name: "Test project" },
        }),
      },
      organizationProgram: {
        findFirst: () => ({
          id: "enrollment-1",
          reportAccess: {},
          metrics: {},
          metadata: {},
        }),
        findMany: () => [],
      },
      survey: {
        findFirst: () => ({
          id: "survey-1",
          title: "Test survey",
          startsAt: null,
          endsAt: null,
        }),
      },
      question: { findMany: () => [] },
      response: { findMany: () => [] },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);
    const query = { selectedProgramId: "program-1", isDummy: false };
    const promotional = {
      sub: "promotional-user",
      organizationId: "organization-1",
      roles: ["promotional"],
      permissions: [],
    };
    const dummyQuery = { ...query, isDummy: true };

    const result = await service.demographicResponseCounts(
      promotional,
      dummyQuery,
    );
    assert.equal(result.data.length, 4);
    assert.ok(
      result.data.every((demographic) =>
        demographic.options.every(({ Count }) => Count >= 8 && Count <= 45),
      ),
    );
    const questions = await service.openResponseQuestions(
      promotional,
      dummyQuery,
    );
    const answers = await service.openResponseAnswers(
      promotional,
      dummyQuery,
      String(questions.data[0]?.id),
    );
    const filters = await service.surveyFilters(promotional, dummyQuery);
    const benchmark = await service.workforceComparison(
      promotional,
      dummyQuery,
    );
    const benefits = await service.employerBenchmark(promotional, dummyQuery);
    assert.ok(questions.data.length > 0);
    assert.ok(answers.data.respondentData.length > 0);
    assert.ok(filters.data.length > 0);
    assert.ok(benchmark.data.data.length > 0);
    assert.ok(benefits.data.tableData.length > 0);
    const [
      feedbackWorkbook,
      verbatimWorkbook,
      benchmarkWorkbook,
      benefitsWorkbook,
    ] = await Promise.all([
      service.feedbackWorkbook(promotional, dummyQuery, false),
      service.openResponsesWorkbook(promotional, dummyQuery),
      service.benchmarkWorkbook(promotional, dummyQuery),
      service.employerBenchmarkWorkbook(promotional, dummyQuery),
    ]);
    assert.ok(feedbackWorkbook.byteLength > 0);
    assert.ok(verbatimWorkbook.byteLength > 0);
    assert.ok(benchmarkWorkbook.byteLength > 0);
    assert.ok(benefitsWorkbook.byteLength > 0);
    const client = {
      sub: "client-user",
      organizationId: "organization-1",
      roles: ["client"],
      permissions: [],
    };
    const clientVerbatimsDemo = await service.openResponseQuestions(client, dummyQuery);
    const clientResponseDetailDemo = await service.responseDetailSections(client, dummyQuery);
    const clientKeyImpactDemo = await service.keyImpactAnalysis(client, dummyQuery);
    assert.ok(clientVerbatimsDemo.data.every(({ id }) => id.startsWith("dummy-")));
    assert.ok(clientResponseDetailDemo.data.length > 0);
    assert.deepEqual(clientKeyImpactDemo.data.mapping, defaultKeyImpactContributions);
    await assert.rejects(
      service.demographicResponseCounts(
        client,
        { ...query, isDummy: true },
      ),
      /Dummy report data is only available to promotional users/u,
    );
    await assert.rejects(
      service.sectionComparison(
        client,
        query,
      ),
      /This program does not include access to the requested report/u,
    );
  });

  it("sorts section comparison categories from questionGroups.keys()", async () => {
    const questions = [
      benchmarkQuestion(
        "q-relationship-manager",
        "Relationship With Your Manager",
        2,
      ),
      benchmarkQuestion("q-survey", "Survey Questions", 1),
      benchmarkQuestion("q-your-job", "Your Job", 2),
      benchmarkQuestion("q-core-duplicate", "Core Employee Experience", 3),
      benchmarkQuestion("q-unknown", "Zeta", 4),
      benchmarkQuestion(
        "q-communication-culture",
        "Communication and Workplace Culture",
        5,
      ),
      benchmarkQuestion("q-core", "Core Employee Experience", 6),
    ];
    const prisma = {
      program: {
        findFirst: () => ({
          id: "program-1",
          projectId: "project-1",
          name: "Test program",
          year: 2026,
          startsAt: null,
          metadata: {} as Prisma.JsonValue,
          project: { id: "project-1", name: "Test project" },
        }),
      },
      organizationProgram: {
        findFirst: () => ({
          id: "enrollment-1",
          reportAccess: {},
          metrics: {},
        }),
        findMany: () => [],
      },
      survey: {
        findFirst: () => ({
          id: "survey-1",
          title: "Test survey",
          startsAt: null,
          endsAt: null,
        }),
      },
      question: {
        findMany: () => questions,
      },
      response: {
        findMany: () => [],
      },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);

    const result = await service.sectionComparison(
      {
        sub: "user-1",
        organizationId: "organization-1",
        roles: ["admin"],
        permissions: [],
      },
      {
        selectedProgramId: "program-1",
        isDummy: false,
      },
    );

    assert.deepEqual(
      result.data.map(({ category }) => category),
      [
        "Core Employee Experience",
        "Your Job",
        "Communication and Workplace Culture",
        "Relationship With Your Manager",
        "Survey Questions",
        "Zeta",
      ],
    );
  });

  it("calculates winner cohorts from every organization in the program", async () => {
    const question = benchmarkQuestion("q-core", "Core Employee Experience", 1);
    const winners = Array.from({ length: 2 }, (_, index) => `winner-${index}`);
    const nonWinners = Array.from(
      { length: 2 },
      (_, index) => `non-winner-${index}`,
    );
    const prisma = {
      program: {
        findFirst: () => ({
          id: "program-1",
          projectId: "project-1",
          name: "Test program",
          year: 2026,
          startsAt: null,
          metadata: {} as Prisma.JsonValue,
          project: { id: "project-1", name: "Test project" },
        }),
      },
      organizationProgram: {
        findFirst: () => ({
          id: "enrollment-1",
          reportAccess: {},
          metrics: {},
          metadata: {},
        }),
        findMany: () => [
          ...winners.map((organizationId) => ({
            organizationId,
            isWinner: true,
            metrics: { Current_Year_Winner: "No" },
            organization: { metadata: {} },
          })),
          ...nonWinners.map((organizationId) => ({
            organizationId,
            isWinner: false,
            metrics: { Current_Year_Winner: "Yes" },
            organization: { metadata: {} },
          })),
        ],
      },
      survey: {
        findFirst: () => ({
          id: "survey-1",
          title: "Test survey",
          startsAt: null,
          endsAt: null,
        }),
      },
      question: { findMany: () => [question] },
      response: {
        findMany: () => [
          ...winners.map((organizationId) => ({
            questionId: question.id,
            value: "Agree",
            score: null,
            respondent: { organizationId },
          })),
          ...nonWinners.map((organizationId) => ({
            questionId: question.id,
            value: "Disagree",
            score: null,
            respondent: { organizationId },
          })),
        ],
      },
    } as unknown as PrismaService;

    const result = await new CompatibilityReportsService(
      prisma,
    ).workforceComparison(
      {
        sub: "user-1",
        organizationId: winners[0] ?? null,
        roles: ["admin"],
        permissions: [],
      },
      { selectedProgramId: "program-1", isDummy: false },
    );

    assert.deepEqual(result.data.data[0]?.dataValues, [100, 0]);
    assert.equal(result.data.cohortOrganizationCount, 4);
  });
});
