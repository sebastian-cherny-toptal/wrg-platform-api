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
