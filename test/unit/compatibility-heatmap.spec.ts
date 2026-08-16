import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { Injectable, Module, VersioningType } from "@nestjs/common";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { NestFactory } from "@nestjs/core";
import { PassportModule, PassportStrategy } from "@nestjs/passport";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import type { Prisma } from "@prisma/client";
import { ExtractJwt, Strategy } from "passport-jwt";
import { describe, it } from "node:test";
import ExcelJS from "exceljs";
import {
  forEachXlsxSurveyRow,
  readXlsxSurveyDefinition,
} from "../../src/modules/imports/xlsx-survey-importer.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import {
  CompatibilityReportsController,
  CompatibilityReportsService,
  type BenchmarkQuestion,
  type DetailedRespondent,
} from "../../src/modules/reports/compatibility-reports.module.js";
import {
  JwtAuthGuard,
  type Principal,
} from "../../src/modules/auth/auth.module.js";
import expectedHeatMapTable from "../fixtures/compatibility-heatmap-2026.json" with { type: "json" };

const testJwtSecret = "test-secret-that-is-at-least-32-characters";
const selectedProgramId = "c0cfe468-d239-5ffe-812e-45ac21f92e91";
const organizationName = "Commerce Title & Abstract Company";
const sourceWorkbook = join(
  process.cwd(),
  "..",
  "Baton Rouge 24-26",
  "BR 2026 - EFS ORD.xlsx",
);
const publishedWorkbook = join(
  process.cwd(),
  "..",
  "BR 2026 - Workforce Benchmark Comparisons.xlsx",
);

interface PublishedQuestion {
  categoryLabel: string;
  text: string;
}

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

function titleCase(value: string): string {
  return value
    .toLowerCase()
    .replace(
      /(^|[\s-])([a-z])/gu,
      (_match, prefix: string, letter: string) =>
        `${prefix}${letter.toUpperCase()}`,
    );
}

async function publishedQuestions(): Promise<PublishedQuestion[]> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.readFile(publishedWorkbook);
  const worksheet = workbook.worksheets[0];
  assert.ok(worksheet, "published workforce workbook has no worksheet");
  const questions: PublishedQuestion[] = [];
  let categoryLabel = "";
  for (let rowNumber = 8; rowNumber <= worksheet.rowCount; rowNumber += 1) {
    const label = String(worksheet.getCell(rowNumber, 1).value ?? "").trim();
    if (!label) continue;
    if (/average$|^survey average$|^x\s*[–-]|^this report/iu.test(label)) {
      continue;
    }
    if (typeof worksheet.getCell(rowNumber, 2).value !== "number") {
      categoryLabel = titleCase(label);
      continue;
    }
    questions.push({ categoryLabel, text: label });
  }
  return questions;
}

async function fixturePrisma(): Promise<PrismaService> {
  assert.ok(existsSync(sourceWorkbook), `missing ${sourceWorkbook}`);
  assert.ok(existsSync(publishedWorkbook), `missing ${publishedWorkbook}`);
  const definition = await readXlsxSurveyDefinition({
    fileName: "BR 2026 - EFS ORD.xlsx",
    filePath: sourceWorkbook,
    questionId: (dataLabel) => dataLabel,
  });
  const published = await publishedQuestions();
  const likertQuestions = definition.questions.filter(
    (question) => question.type === "likert",
  );
  assert.equal(likertQuestions.length, published.length);
  let publishedIndex = 0;
  const questions: BenchmarkQuestion[] = definition.questions.map(
    (question, index) => {
      const publishedQuestion =
        question.type === "likert" ? published[publishedIndex++] : undefined;
      return {
        id: question.id,
        legacyId: null,
        externalId: null,
        dataLabel: question.dataLabel,
        caption: publishedQuestion?.text ?? question.caption,
        type: question.type,
        position: index + 1,
        metadata: {
          QuestionTypeId: question.type === "likert" ? 5 : 2,
          ...(publishedQuestion
            ? { categoryLabel: publishedQuestion.categoryLabel }
            : {}),
        },
      };
    },
  );
  const questionById = new Map(
    questions.map((question) => [question.id, question]),
  );
  const respondents: DetailedRespondent[] = [];
  await forEachXlsxSurveyRow(
    definition,
    { includeOrganization: (name) => name === organizationName },
    (row) => {
      respondents.push({
        id: `respondent-${row.rowNumber}`,
        legacyId: null,
        externalId: null,
        metadata: {},
        responses: row.responses.map((response) => {
          const question = questionById.get(response.question.id);
          assert.ok(question, `missing question ${response.question.id}`);
          return {
            questionId: question.id,
            value: response.value,
            score: response.score as unknown as Prisma.Decimal | null,
            question: {
              ...question,
              metadata: question.metadata,
            },
          };
        }),
      });
    },
  );
  assert.equal(respondents.length, 16);

  return {
    program: {
      findFirst: () => ({
        id: selectedProgramId,
        projectId: "project-1",
        name: "Best Places to Work in Baton Rouge 2026",
        year: 2026,
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        metadata: {},
        project: { id: "project-1", name: "Baton Rouge" },
      }),
    },
    organizationProgram: {
      findFirst: () => ({
        id: "enrollment-1",
        reportAccess: { WFR_Access: "yes" },
        metrics: {},
      }),
      findMany: () => [],
    },
    survey: {
      findFirst: () => ({
        id: "survey-1",
        title: "Baton Rouge 2026 Employee Feedback Survey",
        startsAt: new Date("2026-01-01T00:00:00.000Z"),
        endsAt: new Date("2026-06-30T23:59:59.999Z"),
      }),
    },
    question: { findMany: () => questions },
    respondent: { findMany: () => respondents },
  } as unknown as PrismaService;
}

function workbookTable(workbook: ExcelJS.Workbook): unknown[][] {
  const worksheet = workbook.worksheets[0];
  assert.ok(worksheet, "downloaded workbook has no worksheet");
  return Array.from({ length: worksheet.rowCount }, (_, rowIndex) =>
    Array.from(
      { length: worksheet.columnCount },
      (_, columnIndex) =>
        worksheet.getRow(rowIndex + 1).getCell(columnIndex + 1).value ?? null,
    ),
  );
}

async function createTestApp(
  prisma: PrismaService,
): Promise<NestFastifyApplication> {
  @Module({
    imports: [PassportModule, JwtModule.register({ secret: testJwtSecret })],
    controllers: [CompatibilityReportsController],
    providers: [
      CompatibilityReportsService,
      { provide: PrismaService, useValue: prisma },
      TestJwtStrategy,
      JwtAuthGuard,
    ],
  })
  class CompatibilityReportsTestModule {}

  const app = await NestFactory.create<NestFastifyApplication>(
    CompatibilityReportsTestModule,
    new FastifyAdapter(),
    { logger: false },
  );
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: "1",
  });
  await app.init();
  return app;
}

describe("compatibility heat-map endpoint", () => {
  it("downloads the complete 2026 Commerce Title & Abstract Company table", async () => {
    const app = await createTestApp(await fixturePrisma());
    const token = app.get(JwtService).sign({
      sub: "user-1",
      organizationId: "organization-1",
      roles: ["admin"],
      permissions: [],
    });
    try {
      const response = await app.inject({
        method: "GET",
        url: `/client/generateHeatMap?selectedProgramId=${selectedProgramId}`,
        headers: { authorization: `Bearer ${token}` },
      });
      assert.equal(response.statusCode, 200, response.body);
      assert.equal(
        response.headers["content-type"],
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      assert.equal(
        response.headers["content-disposition"],
        'attachment; filename="Employee_Feedback_Heatmap.xlsx"',
      );
      const workbook = new ExcelJS.Workbook();
      const payload = response.rawPayload as unknown as Parameters<
        typeof workbook.xlsx.load
      >[0];
      await workbook.xlsx.load(payload);
      const actualTable = workbookTable(workbook);
      assert.deepEqual(actualTable, expectedHeatMapTable);
    } finally {
      await app.close();
    }
  });
});

describe("CompatibilityReportsService.feedbackSections", () => {
  it("groups the 2026 sample report into ordered sections", async () => {
    const prisma = await fixturePrisma();
    const service = new CompatibilityReportsService(prisma);
    const fixture = prisma as unknown as {
      question: { findMany: () => BenchmarkQuestion[] };
      respondent: { findMany: () => DetailedRespondent[] };
    };
    const sections = (
      service as unknown as {
        feedbackSections: (
          questions: BenchmarkQuestion[],
          respondents: DetailedRespondent[],
          programYear?: number | null,
        ) => Array<{
          title: string;
          questions: Array<{
            text: string;
            agreement: number;
            neutral: number;
            disagreement: number;
            demographicAgreement?: Record<string, Record<string, number>>;
          }>;
        }>;
      }
    ).feedbackSections(
      fixture.question
        .findMany()
        .filter((question) => question.type === "likert"),
      fixture.respondent.findMany(),
      2026,
    );
    assert.deepEqual(
      sections.map(({ title, questions }) => {
        const summarize = (question: (typeof questions)[number] | undefined) =>
          question && {
            text: question.text,
            agreement: question.agreement,
            neutral: question.neutral,
            disagreement: question.disagreement,
          };
        return {
          title,
          count: questions.length,
          first: summarize(questions[0]),
          last: summarize(questions.at(-1)),
        };
      }),
      [
        {
          title: "Core Employee Experience",
          count: 9,
          first: {
            text: "This organization's culture allows me to do my best work",
            agreement: 87.5,
            neutral: 12.5,
            disagreement: 0,
          },
          last: {
            text: "I find purpose in my work",
            agreement: 100,
            neutral: 0,
            disagreement: 0,
          },
        },
        {
          title: "Your Job",
          count: 12,
          first: {
            text: "I understand what is expected of me",
            agreement: 100,
            neutral: 0,
            disagreement: 0,
          },
          last: {
            text: "I understand how my work impacts organizational success",
            agreement: 100,
            neutral: 0,
            disagreement: 0,
          },
        },
        {
          title: "Communication And Workplace Culture",
          count: 11,
          first: {
            text: "This organization treats me with dignity, not as just a number",
            agreement: 93.75,
            neutral: 6.25,
            disagreement: 0,
          },
          last: {
            text: "I am kept aware of this organization's financial status",
            agreement: 75,
            neutral: 18.75,
            disagreement: 6.25,
          },
        },
        {
          title: "Relationship With Your Manager",
          count: 9,
          first: {
            text: "My manager lets me know when I need to improve my work",
            agreement: 87.5,
            neutral: 12.5,
            disagreement: 0,
          },
          last: {
            text: "My manager wants me to reach my full potential",
            agreement: 87.5,
            neutral: 12.5,
            disagreement: 0,
          },
        },
        {
          title: "Employee Benefits",
          count: 12,
          first: {
            text: "This organization's benefits package is satisfactory",
            agreement: 100,
            neutral: 0,
            disagreement: 0,
          },
          last: {
            text: "I like this organization's disability plan",
            agreement: 93.75,
            neutral: 6.25,
            disagreement: 0,
          },
        },
        {
          title: "Work-Life Balance",
          count: 6,
          first: {
            text: "I am satisfied with the number of hours I work each week",
            agreement: 87.5,
            neutral: 6.25,
            disagreement: 6.25,
          },
          last: {
            text: "My organization encourages me to take time off",
            agreement: 93.75,
            neutral: 6.25,
            disagreement: 0,
          },
        },
        {
          title: "Diversity And Inclusion",
          count: 6,
          first: {
            text: "This organization does not differentiate based on backgrounds, beliefs, or identities",
            agreement: 100,
            neutral: 0,
            disagreement: 0,
          },
          last: {
            text: "Discrimination is not tolerated in this organization",
            agreement: 93.75,
            neutral: 6.25,
            disagreement: 0,
          },
        },
        {
          title: "Leadership Of This Organization",
          count: 5,
          first: {
            text: "I believe in this organization's leadership",
            agreement: 100,
            neutral: 0,
            disagreement: 0,
          },
          last: {
            text: "This organization's long-term plans seem sensible",
            agreement: 93.75,
            neutral: 6.25,
            disagreement: 0,
          },
        },
        {
          title: "Training, Technology And Professional Development",
          count: 7,
          first: {
            text: "This organization assists me in following a well-aligned career path",
            agreement: 75,
            neutral: 25,
            disagreement: 0,
          },
          last: {
            text: "I have the software necessary to do my job efficiently",
            agreement: 100,
            neutral: 0,
            disagreement: 0,
          },
        },
      ],
    );
    assert.deepEqual(
      sections.map(({ title, questions }) => ({
        title,
        first: questions[0]?.demographicAgreement,
        last: questions.at(-1)?.demographicAgreement,
      })),
      [
        {
          title: "Core Employee Experience",
          first: {
            Gender: {
              Female: 85.71428571428571,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 83.33333333333333,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 85.71428571428571,
            },
            "Race/Ethnicity": {
              White: 87.5,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 85.71428571428571,
              "Less than one year": 100,
              "Ten years or more": 75,
            },
            "Job Status": {
              "Full-Time": 86.66666666666667,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 90,
              "Fully on-site": 100,
              "Fully remote": 0,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 80,
              "Department Manager/Supervisor": 100,
              "Production/Service": 75,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 75,
              "Human Resources": 100,
              Other: 100,
              Production: 80,
              "Public Relations/Marketing": 100,
            },
          },
          last: {
            Gender: {
              Female: 100,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 100,
            },
            "Race/Ethnicity": {
              White: 100,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 100,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 100,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 100,
              "Fully on-site": 100,
              "Fully remote": 100,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 100,
              "Department Manager/Supervisor": 100,
              "Production/Service": 100,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 100,
              "Human Resources": 100,
              Other: 100,
              Production: 100,
              "Public Relations/Marketing": 100,
            },
          },
        },
        {
          title: "Your Job",
          first: {
            Gender: {
              Female: 100,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 100,
            },
            "Race/Ethnicity": {
              White: 100,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 100,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 100,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 100,
              "Fully on-site": 100,
              "Fully remote": 100,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 100,
              "Department Manager/Supervisor": 100,
              "Production/Service": 100,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 100,
              "Human Resources": 100,
              Other: 100,
              Production: 100,
              "Public Relations/Marketing": 100,
            },
          },
          last: {
            Gender: {
              Female: 100,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 100,
            },
            "Race/Ethnicity": {
              White: 100,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 100,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 100,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 100,
              "Fully on-site": 100,
              "Fully remote": 100,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 100,
              "Department Manager/Supervisor": 100,
              "Production/Service": 100,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 100,
              "Human Resources": 100,
              Other: 100,
              Production: 100,
              "Public Relations/Marketing": 100,
            },
          },
        },
        {
          title: "Communication And Workplace Culture",
          first: {
            Gender: {
              Female: 92.85714285714286,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 85.71428571428571,
            },
            "Race/Ethnicity": {
              White: 93.75,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 85.71428571428571,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 93.33333333333333,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 100,
              "Fully on-site": 100,
              "Fully remote": 0,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 80,
              "Department Manager/Supervisor": 100,
              "Production/Service": 100,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 75,
              "Human Resources": 100,
              Other: 100,
              Production: 100,
              "Public Relations/Marketing": 100,
            },
          },
          last: {
            Gender: {
              Female: 71.42857142857143,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 66.66666666666667,
              "Baby Boomers (Born 1946 to 1964)": 50,
              "Generation X (Born 1965 to 1980)": 85.71428571428571,
            },
            "Race/Ethnicity": {
              White: 75,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 33.333333333333336,
              "Five years to less than ten years": 85.71428571428571,
              "Less than one year": 100,
              "Ten years or more": 75,
            },
            "Job Status": {
              "Full-Time": 73.33333333333333,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 80,
              "Fully on-site": 80,
              "Fully remote": 0,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 60,
              "Department Manager/Supervisor": 100,
              "Production/Service": 50,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 75,
              "Human Resources": 100,
              Other: 75,
              Production: 60,
              "Public Relations/Marketing": 100,
            },
          },
        },
        {
          title: "Relationship With Your Manager",
          first: {
            Gender: {
              Female: 85.71428571428571,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 71.42857142857143,
            },
            "Race/Ethnicity": {
              White: 87.5,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 71.42857142857143,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 86.66666666666667,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 100,
              "Fully on-site": 80,
              "Fully remote": 0,
            },
            "Job Level": {
              Other: 66.66666666666667,
              "Administrative/Clerical": 80,
              "Department Manager/Supervisor": 100,
              "Production/Service": 100,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 75,
              "Human Resources": 100,
              Other: 75,
              Production: 100,
              "Public Relations/Marketing": 100,
            },
          },
          last: {
            Gender: {
              Female: 85.71428571428571,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 71.42857142857143,
            },
            "Race/Ethnicity": {
              White: 87.5,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 71.42857142857143,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 86.66666666666667,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 100,
              "Fully on-site": 80,
              "Fully remote": 0,
            },
            "Job Level": {
              Other: 66.66666666666667,
              "Administrative/Clerical": 80,
              "Department Manager/Supervisor": 100,
              "Production/Service": 100,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 75,
              "Human Resources": 100,
              Other: 75,
              Production: 100,
              "Public Relations/Marketing": 100,
            },
          },
        },
        {
          title: "Employee Benefits",
          first: {
            Gender: {
              Female: 100,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 100,
            },
            "Race/Ethnicity": {
              White: 100,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 100,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 100,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 100,
              "Fully on-site": 100,
              "Fully remote": 100,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 100,
              "Department Manager/Supervisor": 100,
              "Production/Service": 100,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 100,
              "Human Resources": 100,
              Other: 100,
              Production: 100,
              "Public Relations/Marketing": 100,
            },
          },
          last: {
            Gender: {
              Female: 92.85714285714286,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 50,
              "Generation X (Born 1965 to 1980)": 100,
            },
            "Race/Ethnicity": {
              White: 93.75,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 66.66666666666667,
              "Five years to less than ten years": 100,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 93.33333333333333,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 90,
              "Fully on-site": 100,
              "Fully remote": 100,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 100,
              "Department Manager/Supervisor": 100,
              "Production/Service": 75,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 100,
              "Human Resources": 100,
              Other: 100,
              Production: 80,
              "Public Relations/Marketing": 100,
            },
          },
        },
        {
          title: "Work-Life Balance",
          first: {
            Gender: {
              Female: 85.71428571428571,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 83.33333333333333,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 85.71428571428571,
            },
            "Race/Ethnicity": {
              White: 87.5,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 85.71428571428571,
              "Less than one year": 100,
              "Ten years or more": 75,
            },
            "Job Status": {
              "Full-Time": 86.66666666666667,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 90,
              "Fully on-site": 100,
              "Fully remote": 0,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 80,
              "Department Manager/Supervisor": 100,
              "Production/Service": 75,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 75,
              "Human Resources": 100,
              Other: 100,
              Production: 80,
              "Public Relations/Marketing": 100,
            },
          },
          last: {
            Gender: {
              Female: 92.85714285714286,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 85.71428571428571,
            },
            "Race/Ethnicity": {
              White: 93.75,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 85.71428571428571,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 93.33333333333333,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 100,
              "Fully on-site": 100,
              "Fully remote": 0,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 80,
              "Department Manager/Supervisor": 100,
              "Production/Service": 100,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 75,
              "Human Resources": 100,
              Other: 100,
              Production: 100,
              "Public Relations/Marketing": 100,
            },
          },
        },
        {
          title: "Diversity And Inclusion",
          first: {
            Gender: {
              Female: 100,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 100,
            },
            "Race/Ethnicity": {
              White: 100,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 100,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 100,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 100,
              "Fully on-site": 100,
              "Fully remote": 100,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 100,
              "Department Manager/Supervisor": 100,
              "Production/Service": 100,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 100,
              "Human Resources": 100,
              Other: 100,
              Production: 100,
              "Public Relations/Marketing": 100,
            },
          },
          last: {
            Gender: {
              Female: 92.85714285714286,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 50,
              "Generation X (Born 1965 to 1980)": 100,
            },
            "Race/Ethnicity": {
              White: 93.75,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 66.66666666666667,
              "Five years to less than ten years": 100,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 93.33333333333333,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 90,
              "Fully on-site": 100,
              "Fully remote": 100,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 100,
              "Department Manager/Supervisor": 100,
              "Production/Service": 75,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 100,
              "Human Resources": 100,
              Other: 100,
              Production: 80,
              "Public Relations/Marketing": 100,
            },
          },
        },
        {
          title: "Leadership Of This Organization",
          first: {
            Gender: {
              Female: 100,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 100,
            },
            "Race/Ethnicity": {
              White: 100,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 100,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 100,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 100,
              "Fully on-site": 100,
              "Fully remote": 100,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 100,
              "Department Manager/Supervisor": 100,
              "Production/Service": 100,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 100,
              "Human Resources": 100,
              Other: 100,
              Production: 100,
              "Public Relations/Marketing": 100,
            },
          },
          last: {
            Gender: {
              Female: 92.85714285714286,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 85.71428571428571,
            },
            "Race/Ethnicity": {
              White: 93.75,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 85.71428571428571,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 93.33333333333333,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 100,
              "Fully on-site": 80,
              "Fully remote": 100,
            },
            "Job Level": {
              Other: 66.66666666666667,
              "Administrative/Clerical": 100,
              "Department Manager/Supervisor": 100,
              "Production/Service": 100,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 100,
              "Human Resources": 100,
              Other: 75,
              Production: 100,
              "Public Relations/Marketing": 100,
            },
          },
        },
        {
          title: "Training, Technology And Professional Development",
          first: {
            Gender: {
              Female: 71.42857142857143,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 83.33333333333333,
              "Baby Boomers (Born 1946 to 1964)": 50,
              "Generation X (Born 1965 to 1980)": 71.42857142857143,
            },
            "Race/Ethnicity": {
              White: 75,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 66.66666666666667,
              "Five years to less than ten years": 71.42857142857143,
              "Less than one year": 100,
              "Ten years or more": 75,
            },
            "Job Status": {
              "Full-Time": 73.33333333333333,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 80,
              "Fully on-site": 80,
              "Fully remote": 0,
            },
            "Job Level": {
              Other: 66.66666666666667,
              "Administrative/Clerical": 80,
              "Department Manager/Supervisor": 100,
              "Production/Service": 50,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 75,
              "Human Resources": 100,
              Other: 75,
              Production: 60,
              "Public Relations/Marketing": 100,
            },
          },
          last: {
            Gender: {
              Female: 100,
              Male: 100,
            },
            "Age Generation": {
              "Generation Z (Born 1997 or later)": 100,
              "Millennials (Born 1981 to 1996)": 100,
              "Baby Boomers (Born 1946 to 1964)": 100,
              "Generation X (Born 1965 to 1980)": 100,
            },
            "Race/Ethnicity": {
              White: 100,
            },
            "Employment Length": {
              "One year to less than two years": 100,
              "Two years to less than five years": 100,
              "Five years to less than ten years": 100,
              "Less than one year": 100,
              "Ten years or more": 100,
            },
            "Job Status": {
              "Full-Time": 100,
              "Part-Time": 100,
            },
            "Workplace Setting": {
              "Hybrid (a blend of on-site and remote)": 100,
              "Fully on-site": 100,
              "Fully remote": 100,
            },
            "Job Level": {
              Other: 100,
              "Administrative/Clerical": 100,
              "Department Manager/Supervisor": 100,
              "Production/Service": 100,
            },
            Department: {
              "Business Development/Sales": 100,
              "Customer Service/Care/Support": 100,
              "Human Resources": 100,
              Other: 100,
              Production: 100,
              "Public Relations/Marketing": 100,
            },
          },
        },
      ],
    );
    const firstSection = sections[0];
    assert.ok(firstSection);
    const firstQuestion = firstSection.questions[0];
    assert.ok(firstQuestion);
    assert.ok(firstQuestion.demographicAgreement);
    assert.ok(firstQuestion.demographicAgreement.Gender);
    const subgroupLabels = Object.keys(
      firstQuestion.demographicAgreement,
    ).sort();
    for (const section of sections) {
      for (const question of section.questions) {
        assert.ok(question.demographicAgreement);
        assert.deepEqual(
          Object.keys(question.demographicAgreement).sort(),
          subgroupLabels,
        );
      }
    }
    assert.equal(
      firstQuestion.demographicAgreement.Gender.Female,
      85.71428571428571,
    );
    assert.equal(firstQuestion.demographicAgreement.Gender.Male, 100);
  });
});

describe("CompatibilityReportsService.workbookDemographicsFromRespondents", () => {
  it("groups gender and age generation values from the 2026 sample report", async () => {
    const prisma = await fixturePrisma();
    const service = new CompatibilityReportsService(prisma);
    const fixture = prisma as unknown as {
      respondent: { findMany: () => DetailedRespondent[] };
    };
    const respondents = fixture.respondent.findMany();
    const demographics = (
      service as unknown as {
        workbookDemographicsFromRespondents: (
          respondents: DetailedRespondent[],
          programYear?: number | null,
        ) => Array<{
          title: string;
          groupLabel: string;
          options: Array<{ label: string; count: number }>;
        }>;
      }
    ).workbookDemographicsFromRespondents(respondents, 2026);

    assert.deepEqual(
      demographics.find(({ options }) =>
        options.some(({ label }) => label === "Female"),
      ),
      {
        title: "Personal Demographics",
        groupLabel: "Gender",
        options: [
          { label: "Female", count: 14 },
          { label: "Male", count: 2 },
        ],
      },
    );
    assert.deepEqual(
      demographics.find(({ options }) =>
        options.some(
          ({ label }) => label === "Generation X (Born 1965 to 1980)",
        ),
      ),
      {
        title: "Personal Demographics",
        groupLabel: "Age Generation",
        options: [
          { label: "Baby Boomers (Born 1946 to 1964)", count: 2 },
          { label: "Generation X (Born 1965 to 1980)", count: 7 },
          { label: "Millennials (Born 1981 to 1996)", count: 6 },
          { label: "Generation Z (Born 1997 or later)", count: 1 },
        ],
      },
    );
  });
});
