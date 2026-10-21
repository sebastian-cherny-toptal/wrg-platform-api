import type { Prisma } from "@prisma/client";
import type { PrismaService } from "../../src/database/prisma.service.js";
import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import {
  defaultDefinition,
  definitionFile,
  programDefinition,
} from "../../src/modules/imports/definition-templates.js";
import {
  pinProgramDefinitions,
  ProgramSurveyDefinitionService,
  surveyDefinitionWorkbook,
} from "../../src/modules/imports/program-survey-definition.service.js";
import {
  applySurveyDefinition,
  parseSurveyDefinition,
} from "../../src/modules/imports/survey-definition.js";

for (const invalid of [
  "missing column",
  "empty cell",
  "whitespace cell",
  "unknown type",
]) {
  test(`EFS rejects question_type: ${invalid}`, async () => {
    const workbook = new ExcelJS.Workbook();
    const questions = workbook.addWorksheet("Questions");
    questions.addRow(["question_key", "question_label", "question_type"]);
    questions.addRow(["q_Test", "Test", "likert"]);
    workbook
      .addWorksheet("Answers")
      .addRow(["question_key", "raw_answer", "answer_label"]);
    questions.getRow(invalid === "missing column" ? 1 : 2).getCell(3).value =
      invalid === "whitespace cell"
        ? "  "
        : invalid === "unknown type"
          ? "old-type"
          : null;
    const bytes = Buffer.from(await workbook.xlsx.writeBuffer());
    await assert.rejects(
      () => parseSurveyDefinition(bytes, "EFS"),
      /question_type/,
    );
  });
}

test("both missing definitions are pinned to v1 and later catalog mutations do not affect a program", async () => {
  const pinned = await pinProgramDefinitions({});
  assert.equal(pinned.surveyDefinitionVersion, "v1");
  assert.equal(pinned.employerAssessmentDefinitionVersion, "v1");
  const saved = programDefinition(pinned, "EFS");
  const catalog = defaultDefinition("EFS");
  const catalogQuestion = catalog[0];
  assert.ok(catalogQuestion);
  catalogQuestion.caption = "Future wording";
  assert.deepEqual(programDefinition(pinned, "EFS"), saved);
  const releasedQuestion = defaultDefinition("EFS")[0];
  assert.ok(releasedQuestion);
  assert.notEqual(releasedQuestion.caption, "Future wording");
  assert.throws(() => defaultDefinition("EFS", "v999"), /Unknown/);
  const bytes = await surveyDefinitionWorkbook(saved, "EFS", "v1");
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
  assert.equal(workbook.subject, "EFS Definition template v1");
});

test("uploaded files retain the original bytes and legacy custom definitions acquire a durable workbook", async () => {
  const definition = [
    {
      dataLabel: "q_Test",
      caption: "My wording",
      type: "choice",
      categoryLabel: "My category",
      position: 1,
    },
  ];
  const bytes = await surveyDefinitionWorkbook(definition, "EFS");
  const file = definitionFile("../../my-definition.xlsx", bytes);
  assert.equal(file.fileName, "my-definition.xlsx");
  assert.deepEqual(Buffer.from(file.contentBase64, "base64"), bytes);
  const pinned = await pinProgramDefinitions({ surveyDefinition: definition });
  const archived = pinned.surveyDefinitionFile as { contentBase64: string };
  assert.deepEqual(
    await parseSurveyDefinition(Buffer.from(archived.contentBase64, "base64")),
    definition,
  );
  assert.equal(pinned.surveyDefinitionVersion, null);
  assert.deepEqual(await pinProgramDefinitions(pinned), pinned);
});

test("a new definition cannot inherit a stored type, answer list, or category", () => {
  const question = {
    dataLabel: "q_Test",
    caption: "Old",
    type: "likert",
    position: 99,
    metadata: {
      categoryLabel: "Old category",
      QuestionResponses: [{ Id: 1, Caption: "Old answer" }],
      surveyDefinitionAnswers: true,
    },
  };
  assert.throws(
    () =>
      applySurveyDefinition(question, [
        { dataLabel: "q_Test", caption: "New" },
      ]),
    /question_type is required/,
  );
  const mapped = applySurveyDefinition(question, [
    { dataLabel: "q_Test", caption: "New", type: "choice" },
  ]);
  assert.equal(mapped.type, "choice");
  assert.equal(mapped.position, 1);
  assert.equal(mapped.metadata.categoryLabel, undefined);
  assert.deepEqual(mapped.metadata.QuestionResponses, []);
});

for (const kind of ["EFS", "EA"] as const) {
  for (const uploaded of [true, false]) {
    test(`current ${kind} download returns ${uploaded ? "the exact uploaded workbook" : "the program’s pinned snapshot"}`, async () => {
      const metadata = await pinProgramDefinitions({});
      const prefix =
        kind === "EFS" ? "surveyDefinition" : "employerAssessmentDefinition";
      const original = new ExcelJS.Workbook();
      await original.xlsx.load(
        (await surveyDefinitionWorkbook(
          programDefinition(metadata, kind),
          kind,
        )) as unknown as ExcelJS.Buffer,
      );
      original.addWorksheet("Original notes").getCell("A1").value =
        "Preserve this sheet";
      const originalBytes = Buffer.from(await original.xlsx.writeBuffer());
      if (uploaded) {
        metadata[`${prefix}File`] = {
          ...definitionFile("My current definition.xlsx", originalBytes),
        };
        metadata[`${prefix}Version`] = null;
      }
      const definition = programDefinition(metadata, kind);
      const question = definition[0];
      assert.ok(question);
      question.caption = "This program’s saved wording";
      const savedDefinition = JSON.parse(
        JSON.stringify(definition),
      ) as Prisma.JsonArray;
      if (kind === "EFS") metadata.surveyDefinition = savedDefinition;
      else
        metadata.employerAssessmentReportDefinition = {
          version: 2,
          questions: savedDefinition,
        };
      const service = new ProgramSurveyDefinitionService({
        program: {
          findFirst: ({
            where,
          }: {
            where: { OR: Array<{ legacyId?: string }> };
          }) => {
            assert.ok(
              where.OR.some(({ legacyId }) => legacyId === "selected-program"),
            );
            return Promise.resolve({ id: "selected-program", metadata });
          },
          update: () => {
            throw new Error(
              "A download must not replace the program's definition",
            );
          },
        },
      } as unknown as PrismaService);
      const principal = {
        sub: "admin",
        roles: ["admin"],
        permissions: [],
        organizationId: null,
      };
      const result = await service.downloadCurrent(
        principal,
        "selected-program",
        kind,
      );
      if (uploaded) {
        assert.deepEqual(result.bytes, originalBytes);
        assert.equal(result.fileName, "My current definition.xlsx");
      } else {
        assert.equal(result.fileName, `${kind}_Definition_v1.xlsx`);
        const parsed = await parseSurveyDefinition(result.bytes, kind);
        const downloadedQuestion = parsed[0];
        assert.ok(downloadedQuestion);
        assert.equal(
          downloadedQuestion.caption,
          "This program’s saved wording",
        );
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(result.bytes as unknown as ExcelJS.Buffer);
        assert.equal(workbook.subject, `${kind} Definition template v1`);
      }
      await assert.rejects(
        () =>
          service.downloadCurrent(
            { ...principal, roles: [] },
            "selected-program",
            kind,
          ),
        /Access denied/,
      );
    });
  }
}
