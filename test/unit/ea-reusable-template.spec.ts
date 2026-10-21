import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ExcelJS from "exceljs";
import headers from "../fixtures/ea-template-program-headers.json" with { type: "json" };
import type { PrismaService } from "../../src/database/prisma.service.js";
import { loadDefaultEaTemplateDefinition } from "../../src/modules/imports/ea-template-definition.js";
import { HistoricalImportService } from "../../src/modules/imports/historical-import.service.js";
import { HistoricalImportController } from "../../src/modules/imports/historical-import.controller.js";
import type { FastifyReply } from "fastify";
import { ProgramSurveyDefinitionService } from "../../src/modules/imports/program-survey-definition.service.js";
import {
  parseSurveyDefinition,
  type SurveyDefinition,
} from "../../src/modules/imports/survey-definition.js";
import { loadDefaultBenefitsBestPracticesDefinition } from "../../src/modules/reports/benefits-best-practices-from-ea.js";
import {
  applicableEaDefinition,
  customEaDefinitionFromMetadata,
  generateCustomEaReport,
  validateCustomEaSources,
} from "../../src/modules/reports/custom-ea-report.js";

const principal = {
  sub: "admin",
  roles: ["admin"],
  permissions: [],
  organizationId: null,
};

test("UK Campaign endpoint exports EA columns and enforces admin access", async () => {
  const service = new HistoricalImportService({} as PrismaService);
  const bytes =
    await service.downloadUkCampaignEmployerAssessmentDefinition(principal);
  const source = await readFile(
    new URL(
      "../../src/modules/imports/templates/uk-campaign-ea-questions-and-answers.xlsx",
      import.meta.url,
    ),
  );
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  const answers = workbook.getWorksheet("Answers");
  assert.ok(answers);
  assert.equal(
    (answers.getRow(1).values as ExcelJS.CellValue[]).includes("score"),
    false,
  );
  const definition = await parseSurveyDefinition(bytes, "EA");
  const original = await parseSurveyDefinition(source, "EA");
  for (const question of original) {
    delete question.type;
    for (const option of question.options ?? []) delete option.Score;
  }
  assert.deepEqual(definition, original);
  assert.equal(definition.length, 25);
  assert.equal(
    definition.reduce(
      (count, question) => count + (question.options?.length ?? 0),
      0,
    ),
    160,
  );
  assert.ok(definition[0]);
  assert.match(definition[0].caption, /organisation/u);
  const headers = new Map<string, string>();
  let sent: unknown;
  const reply = {
    header(name: string, value: string) {
      headers.set(name, value);
      return this;
    },
    send(value: unknown) {
      sent = value;
      return this;
    },
  };
  await new HistoricalImportController(
    service,
  ).downloadUkCampaignEmployerAssessmentDefinition(
    principal,
    reply as unknown as FastifyReply,
  );
  assert.ok(Buffer.isBuffer(sent));
  // Separate XLSX exports can have different ZIP timestamps.
  assert.deepEqual(await parseSurveyDefinition(sent, "EA"), definition);
  assert.equal(
    headers.get("content-disposition"),
    'attachment; filename="UK_EA_Definition_v1.xlsx"',
  );
  assert.equal(headers.get("cache-control"), "no-store");
  await assert.rejects(
    () =>
      service.downloadUkCampaignEmployerAssessmentDefinition({
        ...principal,
        roles: [],
      }),
    /access|admin|permission|Forbidden/iu,
  );
});

test("the default EA download combines all legacy and AD questions with every mapping column", async () => {
  const service = new HistoricalImportService({} as PrismaService);
  const buffer =
    await service.downloadDefaultEmployerAssessmentDefinition(principal);
  const definition = await parseSurveyDefinition(buffer, "EA");
  const defaults = await loadDefaultBenefitsBestPracticesDefinition();
  const ad = await parseSurveyDefinition(
    await readFile(
      new URL("../fixtures/ad-2026-ea-qa-upload.xlsx", import.meta.url),
    ),
    "EA",
  );
  assert.equal(definition.length, 47);
  for (const question of [...defaults, ...ad]) {
    assert.ok(definition.some((q) => q.dataLabel === question.dataLabel));
  }
  assert.ok(definition.every((q) => q.ea?.missingSource === "skip"));
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  assert.deepEqual(
    Array.from(
      workbook.getWorksheet("Questions")?.getRow(1)
        .values as ExcelJS.CellValue[],
    ).slice(1),
    [
      "question_key",
      "question_label",
      "category",
      "display_order",
      "calculation",
      "source_column",
      "output_format",
      "group_key",
      "group_label",
      "eligible_question",
      "eligible_value",
      "missing_source",
    ],
  );
  assert.deepEqual(
    Array.from(
      workbook.getWorksheet("Answers")?.getRow(1).values as ExcelJS.CellValue[],
    ).slice(1),
    [
      "question_key",
      "raw_answer",
      "answer_label",
      "display_order",
      "source_column",
    ],
  );
});

test("the same default template uploads to AD and older programs and omits absent sections in reports", async () => {
  const catalog = await loadDefaultEaTemplateDefinition();
  for (const [programId, columns] of Object.entries(headers)) {
    assert.deepEqual(validateCustomEaSources(catalog, columns), []);
    const expectedCount = programId.startsWith("AD.") ? 20 : 39;
    assert.equal(
      applicableEaDefinition(catalog, columns).length,
      expectedCount,
    );
    let metadata: Record<string, unknown> = {};
    const db = {
      program: {
        findFirst: () => Promise.resolve({ id: programId, metadata }),
        update: ({ data }: { data: { metadata: Record<string, unknown> } }) => {
          metadata = data.metadata;
          return Promise.resolve();
        },
      },
      question: {
        findMany: () =>
          Promise.resolve(columns.map((dataLabel) => ({ dataLabel }))),
      },
    };
    const prisma = {
      ...db,
      $transaction: async <T>(fn: (transaction: typeof db) => Promise<T>) =>
        fn(db),
    };
    const service = new ProgramSurveyDefinitionService(
      prisma as unknown as PrismaService,
    );
    const download = await service.downloadEmployerAssessment(
      principal,
      programId,
    );
    const result = await service.uploadEmployerAssessment(
      principal,
      programId,
      "template.xlsx",
      download,
    );
    assert.equal(result.updatedLabels, 47);
    const saved = customEaDefinitionFromMetadata(metadata);
    assert.ok(saved);
    assert.deepEqual(
      await parseSurveyDefinition(
        await service.downloadEmployerAssessment(principal, programId),
        "EA",
      ),
      saved,
    );
    const report = generateCustomEaReport({
      definition: saved,
      minimumOrganizations: 1,
      cohorts: [{ title: "All", type: "All_All", organizationIds: ["a"] }],
      answers: [
        {
          organizationId: "a",
          values: Object.fromEntries(columns.map((column) => [column, 1])),
        },
      ],
    });
    assert.equal(
      report.sections.reduce((n, s) => n + s.questions.length, 0),
      expectedCount,
    );
    assert.ok(report.sections.every((s) => s.questions.length > 0));
    if (!programId.startsWith("AD."))
      assert.equal(
        report.sections.some(
          (s) => s.title === "Training And Career Development",
        ),
        false,
      );
  }
});

test("an invalid missing_source policy cannot silently turn a required mapping into an optional one", async () => {
  const { surveyDefinitionWorkbook } =
    await import("../../src/modules/imports/program-survey-definition.service.js");
  const definition: SurveyDefinition = [
    {
      dataLabel: "q_Test",
      caption: "Test",
      categoryLabel: "Test",
      position: 1,
      ea: {
        calculation: "mean",
        sourceColumn: "q_Test",
        format: "number",
        missingSource: "skip",
      },
    },
  ];
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(
    (await surveyDefinitionWorkbook(definition)) as unknown as ExcelJS.Buffer,
  );
  const sheet = workbook.getWorksheet("Questions");
  assert.ok(sheet);
  sheet.getCell("L2").value = "ignore-typo";
  const buffer = Buffer.from(await workbook.xlsx.writeBuffer());
  await assert.rejects(
    () => parseSurveyDefinition(buffer, "EA"),
    /missing_source/u,
  );
});
