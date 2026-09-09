import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import type { PrismaService } from "../../src/database/prisma.service.js";
import {
  generateBenefitsBestPracticesFromEa,
  loadBenefitsBestPracticesTemplate,
} from "../../src/modules/reports/benefits-best-practices-from-ea.js";
import { CompatibilityReportsService } from "../../src/modules/reports/compatibility-reports.module.js";
import { createBenefitsWorkbook } from "../../src/modules/reports/report-template-workbooks.js";
import type { BenefitsBestPracticesSnapshot } from "../../src/modules/reports/benefits-best-practices-workbook.js";

const funQuestion =
  'Does your organization coordinate “Fun” activities?';
const recognitionQuestion =
  "Does your organization have a structured system for recognizing achievements, attendance, or safety goals?";

function templateSnapshot(): BenefitsBestPracticesSnapshot {
  return {
    sourceFile: "benefits-best-practices.xlsx",
    headers: [
      { title: "All Size Categories", type: "All_Yes" },
      { title: "All Size Categories", type: "All_No" },
    ],
    sections: [
      {
        title: "Employer Information",
        questions: [
          {
            text: funQuestion,
            responses: [{ label: "Yes", format: "percent", dataValues: [] }],
          },
          {
            text: recognitionQuestion,
            responses: [{ label: "Yes", format: "percent", dataValues: [] }],
          },
        ],
      },
      {
        title: "Recruiting and Employment Practices",
        questions: [
          {
            text: "Please select which pre-employment screening or skills assessment tools your organization utilizes. (Select all that apply)",
            responses: [
              {
                label: "Credit history",
                format: "percent",
                dataValues: [],
              },
              {
                label: "Criminal background checks",
                format: "percent",
                dataValues: [],
              },
            ],
          },
        ],
      },
      {
        title: "Organizational Benefits",
        questions: [
          {
            text: "How many employer-paid holidays do you offer each year? Enter the number of fixed paid holidays observed by your organization (days when the organization is closed, such as New Year's Day, Memorial Day, etc.)",
            responses: [
              {
                label:
                  "How many employer-paid holidays do you offer each year? Enter the number of fixed paid holidays observed by your organization (days when the organization is closed, such as New Year's Day, Memorial Day, etc.)",
                format: "number",
                dataValues: [],
              },
            ],
          },
          {
            text: "Does your organization provide time off as PTO (one bank of time) or as vacation/sick/personal days (separate banks)?",
            responses: [
              {
                label: "PTO (one bank of time)",
                format: "percent",
                dataValues: [],
              },
              {
                label: "Vacation/sick/personal days (separate banks)",
                format: "percent",
                dataValues: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

const winnerCohort = {
  title: "All Size Categories",
  type: "All_Yes",
  organizationIds: ["win-1", "win-2", "win-3", "win-4", "win-5"],
};
const nonWinnerCohort = {
  title: "All Size Categories",
  type: "All_No",
  organizationIds: ["lose-1", "lose-2", "lose-3", "lose-4", "lose-5"],
};
const cohorts = [winnerCohort, nonWinnerCohort];

describe("Benefits & Best Practices generation from EA", () => {
  it("averages yes/no EA columns onto the matching template questions", () => {
    const snapshot = generateBenefitsBestPracticesFromEa({
      template: templateSnapshot(),
      cohorts,
      answers: [
        {
          organizationId: "win-1",
          values: {
            q_EmployerInformation_FunActivities: 1,
            q_EmployerInformation_RecognizingAchievements: 1,
          },
        },
        {
          organizationId: "win-2",
          values: {
            q_EmployerInformation_FunActivities: 1,
            q_EmployerInformation_RecognizingAchievements: 0,
          },
        },
        {
          organizationId: "win-3",
          values: {
            q_EmployerInformation_FunActivities: 1,
            q_EmployerInformation_RecognizingAchievements: 1,
          },
        },
        {
          organizationId: "win-4",
          values: {
            q_EmployerInformation_FunActivities: 1,
            q_EmployerInformation_RecognizingAchievements: 1,
          },
        },
        {
          organizationId: "win-5",
          values: {
            q_EmployerInformation_FunActivities: 1,
            q_EmployerInformation_RecognizingAchievements: 1,
          },
        },
        {
          organizationId: "lose-1",
          values: {
            q_EmployerInformation_FunActivities: 0,
            q_EmployerInformation_RecognizingAchievements: 0,
          },
        },
        {
          organizationId: "lose-2",
          values: {
            q_EmployerInformation_FunActivities: 1,
            q_EmployerInformation_RecognizingAchievements: 0,
          },
        },
        {
          organizationId: "lose-3",
          values: {
            q_EmployerInformation_FunActivities: 0,
            q_EmployerInformation_RecognizingAchievements: 1,
          },
        },
        {
          organizationId: "lose-4",
          values: {
            q_EmployerInformation_FunActivities: 0,
            q_EmployerInformation_RecognizingAchievements: 0,
          },
        },
        {
          organizationId: "lose-5",
          values: {
            q_EmployerInformation_FunActivities: 0,
            q_EmployerInformation_RecognizingAchievements: 0,
          },
        },
      ],
    });

    const fun = snapshot.sections[0]?.questions.find(
      ({ text }) => text === funQuestion,
    );
    const recognition = snapshot.sections[0]?.questions.find(
      ({ text }) => text === recognitionQuestion,
    );
    assert.deepEqual(fun?.responses[0]?.dataValues, [100, 20]);
    assert.deepEqual(recognition?.responses[0]?.dataValues, [80, 20]);
    assert.equal(snapshot.sourceFile, "generated-from-ea");
  });

  it("does not take recognition percentages from the Fun Activities list columns", () => {
    const snapshot = generateBenefitsBestPracticesFromEa({
      template: templateSnapshot(),
      cohorts,
      answers: [
        ...winnerCohort.organizationIds.map((organizationId) => ({
          organizationId,
          values: {
            q_EmployerInformation_FunActivities: 1,
            q_EmployerInformation_RecognizingAchievements: 0,
            "EmployerInformation_ListFunActivities. One": "Bowling night",
          },
        })),
        ...nonWinnerCohort.organizationIds.map((organizationId) => ({
          organizationId,
          values: {
            q_EmployerInformation_FunActivities: 0,
            q_EmployerInformation_RecognizingAchievements: 1,
            "EmployerInformation_ListFunActivities. One": "Picnic",
          },
        })),
      ],
    });

    const recognition = snapshot.sections[0]?.questions.find(
      ({ text }) => text === recognitionQuestion,
    );
    assert.deepEqual(recognition?.responses[0]?.dataValues, [0, 100]);
  });

  it("counts multi-select EA option columns and radio indexes", () => {
    const snapshot = generateBenefitsBestPracticesFromEa({
      template: templateSnapshot(),
      cohorts,
      answers: [
        ...winnerCohort.organizationIds.map((organizationId, index) => ({
          organizationId,
          values: {
            "q_RecruitingandEmploymentPractices_Screening. Credit history":
              index < 2 ? 1 : undefined,
            "q_RecruitingandEmploymentPractices_Screening. Criminal background checks": 1,
            q_OrganizationalBenefits_NumberPaidHolidays: 10 + index,
            q_OrganizationalBenefits_PtoVacationSickPersonal: index < 4 ? 1 : 2,
          },
        })),
        ...nonWinnerCohort.organizationIds.map((organizationId) => ({
          organizationId,
          values: {
            "q_RecruitingandEmploymentPractices_Screening. Criminal background checks": 1,
            q_OrganizationalBenefits_NumberPaidHolidays: 8,
            q_OrganizationalBenefits_PtoVacationSickPersonal: 2,
          },
        })),
      ],
    });

    const screening = snapshot.sections[1]?.questions[0]?.responses ?? [];
    assert.deepEqual(screening[0]?.dataValues, [40, 0]);
    assert.deepEqual(screening[1]?.dataValues, [100, 100]);

    const holidays = snapshot.sections[2]?.questions[0]?.responses[0]?.dataValues;
    assert.deepEqual(holidays, [12, 8]);

    const timeOff = snapshot.sections[2]?.questions[1]?.responses ?? [];
    assert.deepEqual(timeOff[0]?.dataValues, [80, 0]);
    assert.deepEqual(timeOff[1]?.dataValues, [20, 100]);
  });

  it("writes x when a cohort has fewer than five employer assessments", () => {
    const snapshot = generateBenefitsBestPracticesFromEa({
      template: templateSnapshot(),
      cohorts: [
        {
          title: "Small Employers",
          type: "Small_Yes",
          organizationIds: ["win-1", "win-2"],
        },
      ],
      answers: [
        {
          organizationId: "win-1",
          values: { q_EmployerInformation_FunActivities: 1 },
        },
        {
          organizationId: "win-2",
          values: { q_EmployerInformation_FunActivities: 1 },
        },
      ],
    });

    const fun = snapshot.sections[0]?.questions[0]?.responses[0]?.dataValues;
    assert.deepEqual(fun, ["x"]);
  });

  it("fills the report template from EA answers for the Fun Activities question", async () => {
    const template = await loadBenefitsBestPracticesTemplate();
    const generated = generateBenefitsBestPracticesFromEa({
      template,
      cohorts,
      answers: [
        ...winnerCohort.organizationIds.map((organizationId) => ({
          organizationId,
          values: { q_EmployerInformation_FunActivities: 1 },
        })),
        ...nonWinnerCohort.organizationIds.map((organizationId) => ({
          organizationId,
          values: { q_EmployerInformation_FunActivities: 0 },
        })),
      ],
    });
    const buffer = await createBenefitsWorkbook({
      headers: generated.headers.map(({ title }) => title),
      columnHeaders: ["All Winners", "All Non-Winners"],
      programName: "Baton Rouge 2026",
      sections: generated.sections.map((section) => ({
        title: section.title,
        questions: section.questions.map((question) => ({
          text: question.text,
          responses: question.responses.map((response) => ({
            format: response.format,
            label: response.label,
            values: response.dataValues,
          })),
        })),
      })),
    });

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Benefits & Best Practices");
    assert.ok(sheet);
    assert.equal(
      sheet.getCell("A6").value,
      "PROGRAM: Baton Rouge 2026",
    );
    let funRow = 0;
    sheet.eachRow((row, rowNumber) => {
      if (String(row.getCell(1).value ?? "").includes("Fun")) {
        funRow = rowNumber;
      }
    });
    assert.ok(funRow > 0);
    assert.equal(sheet.getCell(funRow + 1, 1).value, "Yes");
    assert.equal(sheet.getCell(funRow + 1, 2).value, 1);
    assert.equal(sheet.getCell(funRow + 1, 3).value, 0);
  });

  it("builds the client report from the program EA survey instead of an uploaded workbook", async () => {
    const winners = ["win-1", "win-2", "win-3", "win-4", "win-5"];
    const nonWinners = ["lose-1", "lose-2", "lose-3", "lose-4", "lose-5"];
    const prisma = {
      program: {
        findFirst: () => ({
          id: "program-1",
          projectId: "project-1",
          name: "Baton Rouge 2026",
          year: 2026,
          startsAt: null,
          metadata: {} as Prisma.JsonValue,
          project: { id: "project-1", name: "Baton Rouge" },
        }),
      },
      organizationProgram: {
        findFirst: () => ({
          id: "enrollment-1",
          reportAccess: { BBP_Access: "yes" },
          metrics: {},
          metadata: {},
          organization: { name: "Winner One" },
        }),
        findMany: () =>
          [...winners, ...nonWinners].map((organizationId, index) => ({
            organizationId,
            isWinner: index < winners.length ? "Y" : "N",
            currentZohoCategory: "Small",
            benchmarkCategory: "Small",
            metrics: {},
            organization: { metadata: {} },
          })),
      },
      survey: {
        findFirst: ({ where }: { where?: { OR?: unknown[] } }) => {
          const query = JSON.stringify(where ?? {});
          if (
            query.includes("employer") ||
            query.includes("Employer Assessment")
          ) {
            return {
              id: "ea-survey",
              title: "Baton Rouge 2026 Employer Assessment",
              startsAt: null,
              endsAt: null,
            };
          }
          return {
            id: "efs-survey",
            title: "Baton Rouge 2026 Employee Feedback Survey",
            startsAt: null,
            endsAt: null,
          };
        },
      },
      respondent: {
        findMany: () =>
          [
            ...winners.map((organizationId) => ({ organizationId, yes: 1 })),
            ...nonWinners.map((organizationId, index) => ({
              organizationId,
              yes: index === 0 ? 1 : 0,
            })),
          ].map(({ organizationId, yes }) => ({
            organizationId,
            responses: [
              {
                value: yes,
                question: {
                  dataLabel: "q_EmployerInformation_FunActivities",
                },
              },
            ],
          })),
      },
      question: { findMany: () => [] },
      response: { findMany: () => [] },
    } as unknown as PrismaService;

    const report = await new CompatibilityReportsService(
      prisma,
    ).employerBenchmark(
      {
        sub: "client-1",
        organizationId: "win-1",
        roles: ["client"],
        permissions: [],
      },
      { selectedProgramId: "program-1", isDummy: false },
    );

    const fun = report.data.tableData
      .flatMap((section) => section.nestedData)
      .find(({ title }) => title.includes("Fun"));
    assert.ok(fun);
    const allYes = report.data.tableHeaders.findIndex(
      (header) => header.type === "All_Yes",
    );
    const allNo = report.data.tableHeaders.findIndex(
      (header) => header.type === "All_No",
    );
    const yesRow = fun.nestedData[0];
    assert.ok(yesRow);
    assert.equal(yesRow.dataValues[allYes], 100);
    assert.equal(yesRow.dataValues[allNo], 20);
  });
});
