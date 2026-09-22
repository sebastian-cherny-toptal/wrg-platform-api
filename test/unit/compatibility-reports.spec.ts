import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
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
  it("returns Elle's exact confidentiality message for filtered Detailed Results", async () => {
    const question = benchmarkQuestion("core", "Core Employee Experience", 1);
    const demographic = {
      ...benchmarkQuestion("gender", "Demographics", 2),
      type: "demographic",
      metadata: { QuestionTypeId: 2 },
    };
    const prisma = {
      program: { findFirst: () => ({ id: "program-1", projectId: "project-1", name: "Test", year: 2026, startsAt: null, metadata: {}, project: { id: "project-1", name: "Test" } }) },
      organizationProgram: {
        findFirst: () => ({ id: "enrollment-1", reportAccess: { WFR_Access: "yes" }, metrics: {}, metadata: {} }),
        findMany: () => [],
      },
      survey: { findFirst: () => ({ id: "survey-1", title: "Employee Feedback Survey", startsAt: null, endsAt: null }) },
      question: { findMany: () => [question] },
      respondent: {
        findMany: () => Array.from({ length: 4 }, (_, index) => ({
          id: `respondent-${index}`,
          legacyId: null,
          externalId: null,
          metadata: {},
          responses: [
            { questionId: question.id, value: 4, score: null, question },
            { questionId: demographic.id, value: "Female", score: null, question: demographic },
          ],
        })),
      },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);
    const principal = { sub: "client-1", organizationId: "organization-1", roles: ["client"], permissions: [] };
    const query = { selectedProgramId: "program-1", isDummy: false };
    const filter = { gender: ["Female"] };
    const expected = "The information is not visible to maintain confidentiality. The number of employee responses is fewer than 5.";

    const section = await service.responseBreakdownBySection(principal, query, filter);
    const questionResult = await service.responseBreakdown(principal, query, [question.id], filter);
    assert.deepEqual({ message: section.message, isConfidential: section.isConfidential, data: section.data }, { message: expected, isConfidential: true, data: [] });
    assert.deepEqual({ message: questionResult.message, isConfidential: questionResult.isConfidential, data: questionResult.data }, { message: expected, isConfidential: true, data: [] });
  });

  it("uses the employee survey when the employer assessment ends later", async () => {
    let surveyQuery: unknown;
    const prisma = {
      program: {
        findFirst: () => ({
          id: "program-1",
          projectId: "project-1",
          name: "Indiana 2026",
          year: 2026,
          startsAt: null,
          metadata: {},
          project: { id: "project-1", name: "Indiana" },
        }),
      },
      organizationProgram: {
        findFirst: () => ({
          id: "enrollment-1",
          reportAccess: {},
          metrics: { Surveys_Sent: 996 },
          metadata: {},
          organization: { name: "Allied Solutions" },
        }),
        findMany: () => [],
      },
      survey: {
        findFirst: (query: unknown) => {
          surveyQuery = query;
          const employeeSurveyRequested =
            JSON.stringify(query).includes('"employee"');
          return employeeSurveyRequested
            ? {
                id: "employee-survey",
                title: "Indiana 2026 Employee Feedback Survey",
                startsAt: new Date("2026-01-01T00:00:00.000Z"),
                endsAt: new Date("2026-01-15T23:59:59.999Z"),
              }
            : {
                id: "employer-survey",
                title: "Indiana 2026 Employer Assessment",
                startsAt: new Date("2026-01-01T00:00:00.000Z"),
                endsAt: new Date("2026-05-31T23:59:59.999Z"),
              };
        },
      },
      respondent: {
        count: ({ where }: { where: { surveyId: string } }) =>
          where.surveyId === "employee-survey" ? 996 : 1,
      },
    } as unknown as PrismaService;

    const result = await new CompatibilityReportsService(
      prisma,
    ).surveyResponseRate(
      {
        sub: "client-1",
        organizationId: "organization-1",
        roles: ["client"],
        permissions: [],
      },
      { selectedProgramId: "program-1", isDummy: false },
    );

    assert.match(JSON.stringify(surveyQuery), /employee/u);
    assert.equal(result.data.sendSurvey, 996);
    assert.equal(result.data.completedSurvey, 996);
    assert.equal(result.data.responseRate, 100);
  });

  it("returns an empty key-impact report while the purchased file is awaiting upload", async () => {
    let keyImpactRows: Array<{
      id: string;
      label: string;
      key: string;
      value: string;
      sourceFileName: string;
    }> = [];
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
      keyImpactAnalysisRow: { findMany: () => keyImpactRows },
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

    assert.deepEqual(result.data.mapping, {});
    assert.deepEqual(result.data.report, []);

    keyImpactRows = [
      {
        id: "kia-row-1",
        label: "Leadership",
        key: "leadership",
        value: "0.42",
        sourceFileName: "kia.xlsx",
      },
      {
        id: "kia-row-2",
        label: "Benefits",
        key: "benefits",
        value: "27.5",
        sourceFileName: "kia.xlsx",
      },
    ];
    const uploaded = await new CompatibilityReportsService(
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

    assert.deepEqual(uploaded.data.mapping, {
      leadership: 42,
      benefits: 27.5,
    });
    assert.deepEqual(uploaded.data.report, [
      { label: "Leadership", key: "leadership", value: 0.42 },
      { label: "Benefits", key: "benefits", value: 27.5 },
    ]);
    assert.equal(
      "fileName" in uploaded.data ? uploaded.data.fileName : undefined,
      "kia.xlsx",
    );
    assert.equal(uploaded.data.data.signedUrl, null);
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

  it("calculates dashboard disagreement from imported numeric Likert scores", async () => {
    const question = benchmarkQuestion("core", "Core Employee Experience", 1);
    const values = [1, 2, 3, 4, "Not Applicable"] as const;
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
          reportAccess: {},
          metrics: {},
          metadata: {},
          organization: { name: "Test organization" },
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
      response: {
        findMany: () =>
          values.map((value) => ({
            questionId: question.id,
            value,
            score: typeof value === "number" ? value : null,
            respondent: { organizationId: "organization-1" },
          })),
      },
      respondent: { count: () => 1 },
    } as unknown as PrismaService;

    const result = await new CompatibilityReportsService(
      prisma,
    ).averageAgreement(
      {
        sub: "client-1",
        organizationId: "organization-1",
        roles: ["client"],
        permissions: [],
      },
      { selectedProgramId: "program-1", isDummy: false },
    );

    assert.equal(Number(result.data.percentage), 25);
    assert.equal(Number(result.data.negativePercentage), 50);
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
    const dummyAnswerValues = answers.data.respondentData.map(
      ({ responses }) => responses.Value,
    );
    assert.deepEqual(
      dummyAnswerValues,
      [...dummyAnswerValues].sort((left, right) =>
        left.localeCompare(right, "en", { numeric: true, sensitivity: "base" }),
      ),
    );
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
    const clientVerbatimsDemo = await service.openResponseQuestions(
      client,
      dummyQuery,
    );
    const clientResponseDetailDemo = await service.responseDetailSections(
      client,
      dummyQuery,
    );
    const clientKeyImpactDemo = await service.keyImpactAnalysis(
      client,
      dummyQuery,
    );
    assert.ok(
      clientVerbatimsDemo.data.every(({ id }) => id.startsWith("dummy-")),
    );
    assert.ok(clientResponseDetailDemo.data.length > 0);
    assert.deepEqual(
      clientKeyImpactDemo.data.mapping,
      defaultKeyImpactContributions,
    );
    await assert.rejects(
      service.demographicResponseCounts(client, { ...query, isDummy: true }),
      /Dummy report data is only available to promotional users/u,
    );
    await assert.rejects(
      service.sectionComparison(client, query),
      /This program does not include access to the requested report/u,
    );
  });

  it("lets any client read employee verbatims sorted alphabetically without EV_Access", async () => {
    const openQuestion = {
      id: "open-question-1",
      legacyId: null,
      externalId: null,
      dataLabel: "q_OpenEnded_1",
      caption: "What should we improve?",
      type: "open-text",
      position: 1,
      metadata: { QuestionTypeId: 9 },
    };
    const answers = [
      "Zebra-level process noise",
      "A clear weekly plan",
      "More coaching from managers",
      "Better tools for the job",
      "Shared project priorities",
    ];
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
          reportAccess: { EV_Access: "no" },
          metrics: {},
          metadata: {},
          organization: { name: "Actual Organization Name" },
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
      question: { findMany: () => [openQuestion] },
      respondent: {
        findMany: () =>
          answers.map((value, index) => ({
            id: `respondent-${index + 1}`,
            legacyId: null,
            externalId: null,
            metadata: {},
            responses: [
              {
                questionId: openQuestion.id,
                value,
                score: null,
                question: openQuestion,
              },
            ],
          })),
      },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);
    const client = {
      sub: "client-1",
      organizationId: "organization-1",
      roles: ["client"],
      permissions: [],
    };
    const query = { selectedProgramId: "program-1", isDummy: false };

    const questions = await service.openResponseQuestions(client, query);
    const result = await service.openResponseAnswers(
      client,
      query,
      openQuestion.id,
    );

    assert.equal(questions.data.length, 1);
    assert.deepEqual(
      result.data.respondentData.map(({ responses }) => responses.Value),
      [
        "A clear weekly plan",
        "Better tools for the job",
        "More coaching from managers",
        "Shared project priorities",
        "Zebra-level process noise",
      ],
    );
    assert.equal(result.data.sortingFilter, undefined);
  });

  it("suppresses small sorted verbatim groups in answers and workbook", async () => {
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
    const questions = [1, 2].map((number) => ({
      id: `open-${number}`,
      legacyId: null,
      externalId: null,
      dataLabel: `q_OpenEnded_${number}`,
      caption: `Open question ${number}`,
      type: "open-text",
      position: number + 1,
      metadata: { QuestionTypeId: 9 },
    }));
    const respondents = Array.from({ length: 9 }, (_, index) => {
      const small = index < 4;
      return {
        id: `respondent-${index + 1}`,
        legacyId: null,
        externalId: null,
        metadata: {},
        responses: [department, ...questions].map((question) => ({
          questionId: question.id,
          value:
            question.id === department.id
              ? small
                ? "Private Team"
                : "Public Team"
              : `${small ? "private" : "public"} answer ${question.id} ${index}`,
          score: null,
          question,
        })),
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
          reportAccess: { EV_Access: "yes", SEV_Access: "yes" },
          metrics: { SEV_Filter: department.id },
          metadata: {},
          organization: { name: "Actual Organization Name" },
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
      question: { findMany: () => [department, ...questions] },
      respondent: { findMany: () => respondents },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);
    const principal = {
      sub: "client-1",
      organizationId: "organization-1",
      roles: ["client"],
      permissions: [],
    };
    const query = { selectedProgramId: "program-1", isDummy: false };

    for (const question of questions) {
      const result = await service.openResponseAnswers(
        principal,
        query,
        question.id,
      );
      const serialized = JSON.stringify(result);
      assert.doesNotMatch(serialized, /Private Team|private answer/u);
      assert.match(serialized, /Public Team|public answer/u);
      assert.equal(result.data.respondentData.length, 5);
    }
    await assert.rejects(
      service.openResponseAnswers(principal, query, department.id),
      /Question not found/u,
    );
    const firstQuestion = questions[0];
    assert.ok(firstQuestion);
    await assert.rejects(
      service.openResponseAnswers(principal, query, firstQuestion.id, {
        [department.id]: "Private Team",
      }),
      /Additional verbatim filters are unavailable/u,
    );
    await assert.rejects(
      service.openResponsesWorkbook(principal, query, {
        questionId: firstQuestion.id,
      }),
      /Only the purchased sorting filter is available/u,
    );

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await service.openResponsesWorkbook(principal, query, {
        questionId: department.id,
      })) as never,
    );
    const workbookText: string[] = [];
    workbook.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          workbookText.push(String(cell.value ?? ""));
        });
      });
    });
    assert.doesNotMatch(workbookText.join(" "), /Private Team|private answer/u);
    assert.match(workbookText.join(" "), /Public Team|public answer/u);
    const withoutFilter = new ExcelJS.Workbook();
    await withoutFilter.xlsx.load(
      (await service.openResponsesWorkbook(principal, query)) as never,
    );
    const directRequestText: string[] = [];
    withoutFilter.eachSheet((sheet) => {
      sheet.eachRow((row) => {
        row.eachCell((cell) => {
          directRequestText.push(String(cell.value ?? ""));
        });
      });
    });
    assert.doesNotMatch(
      directRequestText.join(" "),
      /Private Team|private answer/u,
    );
    assert.match(directRequestText.join(" "), /Public Team|public answer/u);
  });

  it("sorts each open-ended question by the purchased demographic and returns its label", async () => {
    const departmentQuestion = {
      id: "department",
      legacyId: null,
      externalId: null,
      dataLabel: "custom_department",
      caption: "Department",
      type: "demographic",
      position: 1,
      metadata: {
        QuestionTypeId: 2,
        filterLabel: "Department",
        QuestionResponses: {
          "1": "Administration/Management",
          "2": "Human Resources",
          "10": "Technology",
        },
      },
    };
    const openQuestion = {
      id: "open-question-1",
      legacyId: null,
      externalId: null,
      dataLabel: "q_OpenEnded_1",
      caption: "What should we improve?",
      type: "open-text",
      position: 2,
      metadata: { QuestionTypeId: 9 },
    };
    const five = (value: string) => Array.from({ length: 5 }, () => value);
    let departments: Array<number | string> = [
      10, 2, 1, 10, 2, 1, 1, 1, 1, 2, 2, 2, 10, 10, 10,
    ];
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
          reportAccess: { EV_Access: "yes", SEV_Access: "yes" },
          metrics: { SEV_Filter: "Department" },
          metadata: {},
          organization: {
            name: "Actual Organization Name",
          },
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
      question: { findMany: () => [departmentQuestion, openQuestion] },
      respondent: {
        findMany: () =>
          departments.map((department, index) => ({
            id: `respondent-${index + 1}`,
            legacyId: null,
            externalId: null,
            metadata: {},
            responses: [
              {
                questionId: departmentQuestion.id,
                value: department,
                score: null,
                question: departmentQuestion,
              },
              {
                questionId: openQuestion.id,
                value: `Answer from respondent ${index + 1}`,
                score: null,
                question: openQuestion,
              },
            ],
          })),
      },
    } as unknown as PrismaService;

    const service = new CompatibilityReportsService(prisma);
    const result = await service.openResponseAnswers(
      {
        sub: "client-1",
        organizationId: "organization-1",
        roles: ["client"],
        permissions: [],
      },
      { selectedProgramId: "program-1", isDummy: false },
      openQuestion.id,
    );

    assert.deepEqual(
      result.data.respondentData.map(({ sortingValue }) => sortingValue),
      [
        ...five("Administration/Management"),
        ...five("Human Resources"),
        ...five("Technology"),
      ],
    );
    assert.equal(result.data.sortingFilter?.label, "Department");

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await service.openResponsesWorkbook(
        {
          sub: "client-1",
          organizationId: "organization-1",
          roles: ["client"],
          permissions: [],
        },
        { selectedProgramId: "program-1", isDummy: false },
        { questionId: departmentQuestion.id },
      )) as never,
    );
    const sheet = workbook.getWorksheet("Verbatims Q1");
    assert.ok(sheet);
    assert.match(
      String(sheet.getCell("A3").value),
      /Actual Organization Name/u,
    );
    assert.equal(sheet.getCell("B4").value, "Department");
    assert.deepEqual(
      Array.from(
        { length: 15 },
        (_, index) => sheet.getCell(`B${index + 5}`).value,
      ),
      [
        ...five("Administration/Management"),
        ...five("Human Resources"),
        ...five("Technology"),
      ],
    );

    departments = Array.from(
      { length: 25 },
      (_, index) =>
        ["Sales 10", "Sales 2", "Administration", "Human Resources", "Finance"][
          index % 5
        ] ?? "",
    );
    const alphanumericResult = await service.openResponseAnswers(
      {
        sub: "client-1",
        organizationId: "organization-1",
        roles: ["client"],
        permissions: [],
      },
      { selectedProgramId: "program-1", isDummy: false },
      openQuestion.id,
    );
    assert.deepEqual(
      alphanumericResult.data.respondentData.map(
        ({ sortingValue }) => sortingValue,
      ),
      [
        ...five("Administration"),
        ...five("Finance"),
        ...five("Human Resources"),
        ...five("Sales 2"),
        ...five("Sales 10"),
      ],
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

  for (const categories of [["Small/Medium"], undefined, [], ["Default"]]) {
    it(`calculates winner cohorts for categories ${JSON.stringify(categories)}`, async () => {
      const question = benchmarkQuestion(
        "q-core",
        "Core Employee Experience",
        1,
      );
      const winners = Array.from(
        { length: 5 },
        (_, index) => `winner-${index}`,
      );
      const nonWinners = Array.from(
        { length: 5 },
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
            metadata: { benchmarkCategories: categories } as Prisma.JsonValue,
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
              isWinner: "Y",
              currentZohoCategory: "Small/Medium",
              benchmarkCategory: "Super",
              metrics: {
                Current_Year_Winner: "No",
                Current_Year_Category: "Small/Medium",
              },
              organization: { metadata: {} },
            })),
            ...nonWinners.map((organizationId) => ({
              organizationId,
              isWinner: "N",
              currentZohoCategory: "Small/Medium",
              benchmarkCategory: "Super",
              metrics: {
                Current_Year_Winner: "Yes",
                Current_Year_Category: "Small/Medium",
              },
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

      assert.deepEqual(result.data.data[0]?.dataValues, [100, 0, 100, 0]);
      assert.equal(result.data.cohortOrganizationCount, 10);
      assert.ok(
        result.data.tableHeaders.some(
          ({ title }) =>
            title ===
            (categories?.[0] === "Small/Medium"
              ? "Small/Medium Employers"
              : "Default Employers"),
        ),
      );
      assert.ok(
        result.data.tableHeaders.every(
          ({ title }) => title !== "Super Employers",
        ),
      );
    });
  }

  it("suppresses benchmark cohorts below five in details, averages, and workbook", async () => {
    const question = benchmarkQuestion("q-core", "Core Employee Experience", 1);
    const programMetadata: {
      benchmarkCategories: string[];
      publishedReports?: Record<string, unknown>;
    } = { benchmarkCategories: ["Small", "Medium"] };
    const principal = {
      sub: "user-1",
      organizationId: "winner-0",
      roles: ["admin"],
      permissions: [],
    };
    const query = { selectedProgramId: "program-1", isDummy: false };
    const enrollments = [
      ...Array.from({ length: 5 }, (_, index) => ({
        organizationId: `winner-${index}`,
        isWinner: "Y",
        currentZohoCategory: index === 4 ? "Medium" : "Small",
        isIncluded: true,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        organizationId: `non-winner-${index}`,
        isWinner: "N",
        currentZohoCategory: "Small",
        isIncluded: true,
      })),
      {
        organizationId: "excluded-winner",
        isWinner: "Y",
        currentZohoCategory: "Small",
        isIncluded: false,
      },
    ];
    const prisma = {
      program: {
        findFirst: () => ({
          id: "program-1",
          projectId: "project-1",
          name: "Test program",
          year: 2026,
          startsAt: null,
          metadata: programMetadata,
          project: { id: "project-1", name: "Test project" },
        }),
      },
      organizationProgram: {
        findFirst: () => ({
          id: "enrollment-1",
          reportAccess: {},
          metrics: {},
          metadata: {},
          organization: { name: "Test organization" },
        }),
        findMany: ({ where }: { where: { isIncluded: boolean } }) => {
          assert.equal(where.isIncluded, true);
          return enrollments
            .filter((enrollment) => enrollment.isIncluded)
            .map((enrollment) => ({
              ...enrollment,
              benchmarkCategory: enrollment.currentZohoCategory,
              metrics: {},
              organization: { metadata: {} },
            }));
        },
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
        findMany: () =>
          enrollments.map((enrollment) => ({
            questionId: question.id,
            value: enrollment.isWinner === "Y" ? "Agree" : "Disagree",
            score: null,
            respondent: { organizationId: enrollment.organizationId },
          })),
      },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);

    const report = await service.workforceComparison(principal, query);
    const headers = report.data.tableHeaders.map(({ type }) => type);
    const values = report.data.data[0]?.dataValues as Array<number | string>;
    const detailValues = (
      report.data.data[0]?.nestedData as Array<{ dataValues: unknown[] }>
    )[0]?.dataValues;
    const averages = report.data.surveyAverage;
    const valueAt = (type: string) => values[headers.indexOf(type)];
    const detailAt = (type: string) => detailValues?.[headers.indexOf(type)];
    assert.equal(valueAt("All_Yes"), 100);
    assert.equal(valueAt("All_No"), 0);
    assert.equal(valueAt("Small_Yes"), "x");
    assert.equal(valueAt("Small_No"), 0);
    assert.equal(valueAt("Medium_Yes"), "x");
    assert.equal(valueAt("Medium_No"), "x");
    assert.equal(detailAt("Small_Yes"), "x");
    assert.equal(detailAt("Small_No"), 0);
    assert.deepEqual(
      averages.find(({ title }) => title === "Small Employers")?.Yes,
      {
        title: "Winners",
        value: "x",
      },
    );
    assert.deepEqual(
      averages.find(({ title }) => title === "Small Employers")?.No,
      {
        title: "Non-Winners",
        value: 0,
      },
    );
    assert.equal(report.data.cohortOrganizationCount, 10);

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(
      (await service.benchmarkWorkbook(principal, query)) as never,
    );
    const sheet = workbook.getWorksheet("Workforce Benchmark Comparisons");
    assert.ok(sheet);
    assert.equal(sheet.getCell("B9").value, 100);
    assert.equal(sheet.getCell("D9").value, "x");
    assert.equal(sheet.getCell("D18").value, "x");
    assert.equal(sheet.getCell("D104").value, "x");

    const selected = await service.questionComparisonWithMe(
      principal,
      query,
      "Core Employee Experience",
      "SmallYes",
    );
    assert.equal(selected.data.questionResponse[0]?.otherOrg, "x");
    const selectedSummary = await service.sectionComparisonWithMe(
      principal,
      query,
      "SmallYes",
    );
    assert.equal(selectedSummary.data.categoryResponse[0]?.otherOrg, "x");
    const directDetail = await service.workforceQuestionComparison(
      principal,
      query,
      "Core Employee Experience",
    );
    assert.equal(
      (
        directDetail.data.tableData[0]?.nestedData as Array<{
          dataValues: Array<number | string>;
        }>
      )[0]?.dataValues[headers.indexOf("Small_Yes")],
      "x",
    );
    const legacy = await service.employeeComparison(principal, query);
    assert.ok(legacy.data.every((entry) => !("SmallYes" in entry)));
    assert.ok(
      (await service.winnersList(principal, query)).every(
        ({ key }) => key !== "SmallYes",
      ),
    );

    for (const winnerCount of [0, 1, 2, 3, 4, 5]) {
      for (const enrollment of enrollments) {
        enrollment.isIncluded =
          enrollment.organizationId === "excluded-winner"
            ? false
            : enrollment.isWinner === "Y"
              ? Number(enrollment.organizationId.split("-").at(-1)) <
                winnerCount
              : true;
      }
      const boundary = await service.workforceComparison(principal, query);
      const allWinnerIndex = boundary.data.tableHeaders.findIndex(
        ({ type }) => type === "All_Yes",
      );
      assert.equal(
        (boundary.data.data[0]?.dataValues as Array<number | string>)[
          allWinnerIndex
        ],
        winnerCount < 5 ? "x" : 100,
        `overall winners with ${winnerCount} included organizations`,
      );
      assert.equal(
        (boundary.data.data[0]?.dataValues as Array<number | string>)[
          boundary.data.tableHeaders.findIndex(({ type }) => type === "All_No")
        ],
        0,
      );
    }
    for (const nonWinnerCount of [0, 1, 2, 3, 4, 5]) {
      for (const enrollment of enrollments) {
        enrollment.isIncluded =
          enrollment.organizationId === "excluded-winner"
            ? false
            : enrollment.isWinner === "N"
              ? Number(enrollment.organizationId.split("-").at(-1)) <
                nonWinnerCount
              : true;
      }
      const boundary = await service.workforceComparison(principal, query);
      assert.equal(
        (boundary.data.data[0]?.dataValues as Array<number | string>)[
          boundary.data.tableHeaders.findIndex(({ type }) => type === "All_No")
        ],
        nonWinnerCount < 5 ? "x" : 0,
        `overall non-winners with ${nonWinnerCount} included organizations`,
      );
      assert.equal(
        (boundary.data.data[0]?.dataValues as Array<number | string>)[
          boundary.data.tableHeaders.findIndex(({ type }) => type === "All_Yes")
        ],
        100,
      );
    }

    programMetadata.publishedReports = {
      workforceBenchmark: {
        headers: [{ type: "Small_Yes" }, { type: "Small_No" }],
        categories: [
          {
            title: "Core Employee Experience",
            dataValues: [100, 0],
            questions: [{ text: question.caption, dataValues: [100, 0] }],
          },
        ],
        surveyAverage: [100, 0],
        sourceFile: "fixture.xlsx",
      },
    };
    for (const enrollment of enrollments) {
      enrollment.isIncluded = enrollment.organizationId !== "excluded-winner";
    }
    assert.equal(
      (
        await service.questionComparisonWithMe(
          principal,
          query,
          "Core Employee Experience",
          "SmallYes",
        )
      ).data.questionResponse[0]?.otherOrg,
      "x",
    );
    assert.equal(
      (await service.sectionComparisonWithMe(principal, query, "SmallNo")).data
        .categoryResponse[0]?.otherOrg,
      0,
    );
  });
});
