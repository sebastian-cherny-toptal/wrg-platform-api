import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import type { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import type { PrismaService } from "../../src/database/prisma.service.js";
import { surveyDefinitionWorkbook } from "../../src/modules/imports/program-survey-definition.service.js";
import { parseSurveyDefinition } from "../../src/modules/imports/survey-definition.js";
import {
  forEachXlsxSurveyRow,
  readXlsxSurveyDefinition,
} from "../../src/modules/imports/xlsx-survey-importer.js";
import {
  applyBenefitsBestPracticesDefinition,
  benefitsBestPracticesDefinition,
  generateBenefitsBestPracticesFromEa,
  loadBenefitsBestPracticesTemplate,
  validateBenefitsBestPracticesDefinition,
} from "../../src/modules/reports/benefits-best-practices-from-ea.js";
import { CompatibilityReportsService } from "../../src/modules/reports/compatibility-reports.module.js";
import { createBenefitsWorkbook } from "../../src/modules/reports/report-template-workbooks.js";
import type { BenefitsBestPracticesSnapshot } from "../../src/modules/reports/benefits-best-practices-workbook.js";

const funQuestion = "Does your organization coordinate “Fun” activities?";
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
  it("keeps bundled labels by default and applies optional EA label overrides after calculation", () => {
    const template = templateSnapshot();
    const generated = generateBenefitsBestPracticesFromEa({
      template,
      minimumOrganizations: 1,
      cohorts: [{ title: "All", type: "All_Yes", organizationIds: ["one"] }],
      answers: [
        {
          organizationId: "one",
          values: { q_EmployerInformation_FunActivities: 1 },
        },
      ],
    });

    const generatedSection = generated.sections[0];
    assert.ok(generatedSection);
    const generatedQuestion = generatedSection.questions[0];
    assert.ok(generatedQuestion);
    const generatedResponse = generatedQuestion.responses[0];
    assert.ok(generatedResponse);
    assert.equal(generatedSection.title, "Employer Information");
    assert.equal(generatedQuestion.text, funQuestion);
    assert.equal(generatedResponse.label, "Yes");

    const customized = applyBenefitsBestPracticesDefinition(generated, [
      {
        dataLabel: "q_EmployerInformation_FunActivities",
        caption: "Does your team organize social activities?",
        categoryLabel: "Employee Experience",
        options: [{ Id: "Yes", Caption: "Offered", Position: 1 }],
      },
    ]);
    const customizedSection = customized.sections[0];
    assert.ok(customizedSection);
    const customizedQuestion = customizedSection.questions[0];
    assert.ok(customizedQuestion);
    const customizedResponse = customizedQuestion.responses[0];
    assert.ok(customizedResponse);
    assert.equal(customizedSection.title, "Employee Experience");
    assert.equal(
      customizedQuestion.text,
      "Does your team organize social activities?",
    );
    assert.equal(customizedResponse.label, "Offered");
    assert.deepEqual(customizedResponse.dataValues, [100]);
  });

  it("omits the duplicate Default fallback cohort", () => {
    const generated = generateBenefitsBestPracticesFromEa({
      template: templateSnapshot(),
      minimumOrganizations: 1,
      cohorts: [
        winnerCohort,
        nonWinnerCohort,
        {
          title: "Default Employers",
          type: "Default_Yes",
          organizationIds: ["win-1"],
        },
        {
          title: "Default Employers",
          type: "Default_No",
          organizationIds: ["lose-1"],
        },
      ],
      answers: [
        {
          organizationId: "win-1",
          values: { q_EmployerInformation_FunActivities: 1 },
        },
        {
          organizationId: "lose-1",
          values: { q_EmployerInformation_FunActivities: 0 },
        },
      ],
    });

    assert.deepEqual(
      generated.headers.map(({ type }) => type),
      ["All_Yes", "All_No"],
    );
    assert.equal(
      generated.sections[0]?.questions[0]?.responses[0]?.dataValues.length,
      2,
    );
  });

  it("builds an editable definition from the static report labels", () => {
    const definition = benefitsBestPracticesDefinition(templateSnapshot());
    assert.deepEqual(definition[0], {
      dataLabel: "q_EmployerInformation_FunActivities",
      caption: funQuestion,
      categoryLabel: "Employer Information",
      position: 1,
      options: [{ Id: "Yes", Caption: "Yes", Position: 1 }],
    });
  });

  it("rejects EA definition keys and answer ids that are not in the report template", () => {
    const defaults = benefitsBestPracticesDefinition(templateSnapshot());
    assert.throws(() => {
      validateBenefitsBestPracticesDefinition(
        [{ dataLabel: "unknown", caption: "Unknown" }],
        defaults,
      );
    }, /not used by Benefits & Best Practices: unknown/u);
    assert.throws(() => {
      validateBenefitsBestPracticesDefinition(
        [
          {
            dataLabel: "q_EmployerInformation_FunActivities",
            caption: "Social activities",
            options: [{ Id: "Sometimes", Caption: "Sometimes", Position: 1 }],
          },
        ],
        defaults,
      );
    }, /answer is not used/u);
  });

  it("accepts paid-holiday numeric answers from 1 through 25", async () => {
    const defaults = benefitsBestPracticesDefinition(
      await loadBenefitsBestPracticesTemplate(),
    );
    const uploaded = await parseSurveyDefinition(
      await surveyDefinitionWorkbook([
        {
          dataLabel: "q_OrganizationalBenefits_NumberPaidHolidays",
          caption: "How many employer-paid holidays are provided?",
          options: Array.from({ length: 25 }, (_, index) => ({
            Id: String(index + 1),
            Caption: String(index + 1),
            Position: index + 1,
          })),
        },
      ]),
    );
    assert.doesNotThrow(() => {
      validateBenefitsBestPracticesDefinition(uploaded, defaults);
    });
    assert.throws(() => {
      validateBenefitsBestPracticesDefinition(
        [
          {
            dataLabel: "q_OrganizationalBenefits_NumberPaidHolidays",
            caption: "How many employer-paid holidays are provided?",
            options: [{ Id: "26", Caption: "26", Position: 26 }],
          },
        ],
        defaults,
      );
    }, /NumberPaidHolidays: 26/u);
  });

  it("removes duplicate Default columns from a published fallback-category report", async () => {
    const published = {
      sourceFile: "published.xlsx",
      headers: [
        { title: "All Size Categories", type: "All_Yes" },
        { title: "All Size Categories", type: "All_No" },
        { title: "Default Employers", type: "DefaultYes" },
        { title: "Default Employers", type: "DefaultNo" },
      ],
      sections: [
        {
          title: "Benefits",
          questions: [
            {
              text: "Medical insurance",
              responses: [
                {
                  label: "Yes",
                  format: "percent",
                  dataValues: [80, 60, 80, 60],
                },
              ],
            },
          ],
        },
      ],
    } satisfies BenefitsBestPracticesSnapshot;
    const prisma = {
      program: {
        findFirst: () => ({
          id: "program-1",
          projectId: "project-1",
          name: "Default Program",
          year: 2026,
          startsAt: null,
          metadata: { benchmarkCategories: ["Default"] },
          project: { id: "project-1", name: "Project" },
        }),
      },
      organizationProgram: {
        findFirst: () => ({
          id: "enrollment-1",
          reportAccess: { BBP_Access: "yes" },
          metrics: {},
          metadata: {
            publishedReports: { benefitsBestPractices: published },
          },
          organization: { name: "Acme" },
        }),
        findMany: () => [],
      },
      survey: { findFirst: () => null },
    } as unknown as PrismaService;

    const report = await new CompatibilityReportsService(
      prisma,
    ).employerBenchmark(
      {
        sub: "client-1",
        organizationId: "organization-1",
        roles: ["client"],
        permissions: [],
      },
      { selectedProgramId: "program-1", isDummy: false },
    );

    assert.deepEqual(
      report.data.tableHeaders.map(({ type }) => type),
      ["All_Yes", "All_No"],
    );
    assert.deepEqual(
      report.data.tableData[0]?.nestedData[0]?.nestedData[0]?.dataValues,
      [80, 60],
    );
  });

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
            q_RecruitingandEmploymentPractices_UtilizePreEmply: 1,
            "q_RecruitingandEmploymentPractices_Screening. Credit history":
              index < 2 ? 1 : undefined,
            "q_RecruitingandEmploymentPractices_Screening. Criminal background checks": 1,
            q_OrganizationalBenefits_NumberPaidHolidays: 10 + index,
            q_OrganizationalBenefits_OfferPTOVSP: 1,
            q_OrganizationalBenefits_PtoVacationSickPersonal: index < 4 ? 1 : 2,
          },
        })),
        ...nonWinnerCohort.organizationIds.map((organizationId) => ({
          organizationId,
          values: {
            q_RecruitingandEmploymentPractices_UtilizePreEmply: 1,
            "q_RecruitingandEmploymentPractices_Screening. Criminal background checks": 1,
            q_OrganizationalBenefits_NumberPaidHolidays: 8,
            q_OrganizationalBenefits_OfferPTOVSP: 1,
            q_OrganizationalBenefits_PtoVacationSickPersonal: 2,
          },
        })),
      ],
    });

    const screening = snapshot.sections[1]?.questions[0]?.responses ?? [];
    assert.deepEqual(screening[0]?.dataValues, [40, 0]);
    assert.deepEqual(screening[1]?.dataValues, [100, 100]);

    const holidays =
      snapshot.sections[2]?.questions[0]?.responses[0]?.dataValues;
    assert.deepEqual(holidays, [12, 8]);

    const timeOff = snapshot.sections[2]?.questions[1]?.responses ?? [];
    assert.deepEqual(timeOff[0]?.dataValues, [80, 0]);
    assert.deepEqual(timeOff[1]?.dataValues, [20, 100]);
  });

  it("uses only organizations eligible for pre-employment screening as its denominator", () => {
    const organizations = ["one", "two", "three", "four", "five"];
    const snapshot = generateBenefitsBestPracticesFromEa({
      template: templateSnapshot(),
      minimumOrganizations: 1,
      cohorts: [
        {
          title: "All Size Categories",
          type: "All_Yes",
          organizationIds: organizations,
        },
      ],
      answers: organizations.map((organizationId, index) => ({
        organizationId,
        values: {
          q_RecruitingandEmploymentPractices_UtilizePreEmply: index < 2 ? 1 : 2,
          "q_RecruitingandEmploymentPractices_Screening. Credit history":
            index === 0 ? 1 : undefined,
          "q_RecruitingandEmploymentPractices_Screening. Criminal background checks":
            index < 2 ? 1 : undefined,
        },
      })),
    });

    const screening = snapshot.sections[1]?.questions[0]?.responses ?? [];
    assert.deepEqual(screening[0]?.dataValues, [50]);
    assert.deepEqual(screening[1]?.dataValues, [100]);
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

  it("parses a two-organization EA file and downloads a privacy-redacted BBP workbook", async () => {
    const directory = await mkdtemp(join(tmpdir(), "two-organization-ea-"));
    const filePath = join(directory, "EA_two_organizations_test.xlsx");
    try {
      const source = new ExcelJS.Workbook();
      const survey = source.addWorksheet("Survey");
      survey.addRow([
        "organization name",
        "organization ID",
        "Respondent",
        "Language",
        "Date responded",
        "Reached end",
        "Score %",
        "q_EmployerInformation_FunActivities",
        "q_OrganizationalBenefits_NumberPaidHolidays",
        "q_RecruitingandEmploymentPractices_Screening. Credit history",
        "q_OrganizationalBenefits_PtoVacationSickPersonal",
      ]);
      survey.addRow([
        "Acme Ltd",
        "ORG-001",
        1,
        "en",
        "2026-09-15",
        "Yes",
        null,
        1,
        10,
        1,
        1,
      ]);
      survey.addRow([
        "Beacon Co",
        "ORG-002",
        1,
        "en",
        "2026-09-16",
        "Yes",
        null,
        0,
        8,
        0,
        2,
      ]);
      await source.xlsx.writeFile(filePath);

      const definition = await readXlsxSurveyDefinition({
        fileName: "EA_two_organizations_test.xlsx",
        filePath,
        questionId: (dataLabel) => dataLabel,
      });
      const answers: Array<{
        organizationId: string;
        values: Record<string, unknown>;
      }> = [];
      await forEachXlsxSurveyRow(definition, {}, (row) => {
        assert.ok(row.organizationId);
        answers.push({
          organizationId: row.organizationId,
          values: Object.fromEntries(
            row.responses.map(({ question, value }) => [
              question.dataLabel,
              value,
            ]),
          ),
        });
      });

      assert.deepEqual(
        answers.map(({ organizationId }) => organizationId),
        ["ORG-001", "ORG-002"],
      );
      assert.equal(
        answers[0]?.values.q_OrganizationalBenefits_NumberPaidHolidays,
        10,
      );
      assert.equal(
        answers[1]?.values.q_OrganizationalBenefits_PtoVacationSickPersonal,
        2,
      );

      const generated = generateBenefitsBestPracticesFromEa({
        template: await loadBenefitsBestPracticesTemplate(),
        cohorts: [
          {
            title: "All Size Categories",
            type: "All_All",
            organizationIds: answers.map(
              ({ organizationId }) => organizationId,
            ),
          },
        ],
        answers,
      });
      const fun = generated.sections
        .flatMap(({ questions }) => questions)
        .find(({ text }) => text === funQuestion);
      assert.deepEqual(fun?.responses[0]?.dataValues, ["x"]);

      const buffer = await createBenefitsWorkbook({
        headers: generated.headers.map(({ title }) => title),
        columnHeaders: ["All Employers"],
        programName: "Two Organization Test 2026",
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
      const downloaded = new ExcelJS.Workbook();
      await downloaded.xlsx.load(buffer as never);
      const report = downloaded.getWorksheet("Benefits & Best Practices");
      assert.ok(report);
      assert.equal(
        report.getCell("A6").value,
        "PROGRAM: Two Organization Test 2026",
      );
      let funRow = 0;
      report.eachRow((row, rowNumber) => {
        if (String(row.getCell(1).value ?? "") === funQuestion)
          funRow = rowNumber;
      });
      assert.ok(funRow > 0);
      assert.equal(report.getCell(funRow + 1, 2).value, "x");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
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
      programName: "Example Region 2026",
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
    assert.equal(sheet.getCell("A6").value, "PROGRAM: Example Region 2026");
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
          name: "Example Region 2026",
          year: 2026,
          startsAt: null,
          metadata: {} as Prisma.JsonValue,
          project: { id: "project-1", name: "Example Region" },
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
              title: "Example Region 2026 Employer Assessment",
              startsAt: null,
              endsAt: null,
            };
          }
          return {
            id: "efs-survey",
            title: "Example Region 2026 Employee Feedback Survey",
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

  it("renders and downloads an EA report without an employee survey or assigned label template", async () => {
    const winnerIds = Array.from(
      { length: 5 },
      (_, index) => `winner-${index + 1}`,
    );
    const nonWinnerIds = Array.from(
      { length: 5 },
      (_, index) => `non-winner-${index + 1}`,
    );
    const organizationIds = [...winnerIds, ...nonWinnerIds];
    let hasEmployerSurvey = true;
    let hasWinnerAssignments = true;
    const prisma = {
      program: {
        findFirst: () => ({
          id: "ea-only-program",
          projectId: "project-1",
          name: "EA Only 2026",
          year: 2026,
          startsAt: null,
          metadata: {} as Prisma.JsonValue,
          project: { id: "project-1", name: "EA Only" },
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
          organizationIds.map((organizationId, index) => ({
            organizationId,
            isWinner: hasWinnerAssignments
              ? index < winnerIds.length
                ? "Y"
                : "N"
              : null,
            currentZohoCategory: "Small",
            benchmarkCategory: "Small",
            metrics: {},
            organization: { metadata: {} },
          })),
      },
      survey: {
        findFirst: ({ where }: { where: { OR?: unknown[] } }) =>
          hasEmployerSurvey && JSON.stringify(where).includes("employer")
            ? { id: "ea-survey" }
            : null,
      },
      respondent: {
        findMany: () =>
          organizationIds.map((organizationId) => ({
            organizationId,
            responses: [
              {
                value:
                  winnerIds.includes(organizationId) ||
                  organizationId === "non-winner-1"
                    ? 1
                    : 0,
                question: { dataLabel: "q_EmployerInformation_FunActivities" },
              },
            ],
          })),
      },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);
    const principal = {
      sub: "client-1",
      organizationId: "winner-1",
      roles: ["client"],
      permissions: [],
    };
    const query = { selectedProgramId: "ea-only-program", isDummy: false };

    const report = await service.employerBenchmark(principal, query);
    assert.deepEqual(
      report.data.tableHeaders.map(({ type }) => type),
      ["All_Yes", "All_No"],
    );
    const fun = report.data.tableData
      .flatMap((section) => section.nestedData)
      .find(({ title }) => title.includes("Fun"));
    assert.ok(fun);
    const allWinners = report.data.tableHeaders.findIndex(
      (header) => header.type === "All_Yes",
    );
    const allNonWinners = report.data.tableHeaders.findIndex(
      (header) => header.type === "All_No",
    );
    const yesRow = fun.nestedData[0];
    assert.ok(yesRow);
    assert.equal(yesRow.dataValues[allWinners], 100);
    assert.equal(yesRow.dataValues[allNonWinners], 20);

    const buffer = await service.employerBenchmarkWorkbook(principal, query);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as never);
    const sheet = workbook.getWorksheet("Benefits & Best Practices");
    assert.ok(sheet);
    assert.equal(sheet.getCell("A6").value, "PROGRAM: EA Only 2026");
    let funRow = 0;
    sheet.eachRow((row, rowNumber) => {
      if (String(row.getCell(1).value ?? "").includes("Fun"))
        funRow = rowNumber;
    });
    assert.ok(funRow > 0);
    assert.equal(sheet.getCell(funRow + 1, allWinners + 2).value, 1);
    assert.equal(sheet.getCell(funRow + 1, allNonWinners + 2).value, 0.2);

    hasWinnerAssignments = false;
    const unrankedReport = await service.employerBenchmark(principal, query);
    assert.deepEqual(unrankedReport.data.tableHeaders, [
      {
        title: "All Size Categories",
        subTitle: "Employers",
        type: "All_All",
        color: "#ddd",
      },
    ]);
    const unrankedFun = unrankedReport.data.tableData
      .flatMap((section) => section.nestedData)
      .find(({ title }) => title.includes("Fun"));
    assert.ok(unrankedFun);
    assert.deepEqual(unrankedFun.nestedData[0]?.dataValues, [60]);
    const unrankedBuffer = await service.employerBenchmarkWorkbook(
      principal,
      query,
    );
    const unrankedWorkbook = new ExcelJS.Workbook();
    await unrankedWorkbook.xlsx.load(unrankedBuffer as never);
    assert.equal(
      unrankedWorkbook.getWorksheet("Benefits & Best Practices")?.getCell("B6")
        .value,
      "All Employers",
    );

    hasEmployerSurvey = false;
    await assert.rejects(
      service.employerBenchmark(principal, query),
      /Benefits & Best Practices is not available for this program/u,
    );
  });

  it("generates from a globally linked Employer Assessment and raw organization answers", async () => {
    const organizationIds = Array.from(
      { length: 10 },
      (_, index) => `org-${index}`,
    );
    const prisma = {
      program: {
        findFirst: () => ({
          id: "program-1",
          projectId: "project-1",
          name: "Dealerships 2026",
          year: 2026,
          startsAt: null,
          metadata: { Employer_Survey_ID: 765432 },
          project: { id: "project-1", name: "Dealerships" },
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
          organizationIds.map((organizationId, index) => ({
            organizationId,
            isWinner: index < 5 ? "Y" : "N",
            currentZohoCategory: "Small",
            benchmarkCategory: "Small",
            metrics: { Deal_Organization_ID: 9000 + index },
            organization: { metadata: {} },
          })),
      },
      survey: {
        findFirst: ({ where }: { where: Record<string, unknown> }) =>
          JSON.stringify(where).includes("765432") && !("programId" in where)
            ? { id: "ea-survey" }
            : null,
      },
      respondent: {
        findMany: () =>
          organizationIds.map((_, index) => ({
            organizationId: null,
            metadata: {
              OrgId: 9000 + index,
              Responses: [
                {
                  DataLabel: "q_EmployerInformation_FunActivities",
                  Value: index < 5 || index === 5 ? "1" : "0",
                },
              ],
            },
            responses: [],
          })),
      },
    } as unknown as PrismaService;
    const service = new CompatibilityReportsService(prisma);
    const report = await service.employerBenchmark(
      {
        sub: "client-1",
        organizationId: "org-0",
        roles: ["client"],
        permissions: [],
      },
      { selectedProgramId: "program-1", isDummy: false },
    );
    const fun = report.data.tableData
      .flatMap((section) => section.nestedData)
      .find(({ title }) => title.includes("Fun"));
    assert.ok(fun);
    assert.equal(fun.nestedData[0]?.dataValues[0], 100);
    assert.equal(fun.nestedData[0].dataValues[1], 20);

    const workbookBuffer = await service.employerBenchmarkWorkbook(
      {
        sub: "client-1",
        organizationId: "org-0",
        roles: ["client"],
        permissions: [],
      },
      { selectedProgramId: "program-1", isDummy: false },
    );
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(workbookBuffer as never);
    const sheet = workbook.getWorksheet("Benefits & Best Practices");
    assert.ok(sheet);
    let funRow = 0;
    sheet.eachRow((row, rowNumber) => {
      if (String(row.getCell(1).value ?? "").includes("Fun"))
        funRow = rowNumber;
    });
    assert.ok(funRow > 0);
    assert.equal(sheet.getCell(funRow + 1, 2).value, 1);
    assert.equal(sheet.getCell(funRow + 1, 3).value, 0.2);
  });
});
