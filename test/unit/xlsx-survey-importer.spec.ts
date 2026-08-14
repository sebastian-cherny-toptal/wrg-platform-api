import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, before, describe, it } from "node:test";
import type { Prisma } from "@prisma/client";
import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import {
  forEachXlsxSurveyRow,
  readXlsxSurveyDefinition,
  xlsxQuestionType,
  xlsxResponseValue,
  type XlsxQuestionDefinition,
  type XlsxSurveyRow,
} from "../../src/modules/imports/xlsx-survey-importer.js";
import {
  buildResponseDetailTable,
  type BenchmarkQuestion,
  type DetailedRespondent,
} from "../../src/modules/reports/compatibility-reports.module.js";

const fixtureOrganization = "Synthetic 06f796de0c9331b9";
const fixtureName = "BR 2026 - EFS ORD.xlsx";
let fixtureDirectory = "";
let fixturePath = "";

function reportQuestion(question: XlsxQuestionDefinition): BenchmarkQuestion {
  return {
    id: question.id,
    legacyId: null,
    externalId: null,
    dataLabel: question.dataLabel,
    caption: question.caption,
    type: question.type,
    position: question.column,
    metadata: {
      QuestionTypeId: question.type === "likert" ? 5 : 2,
    },
  };
}

describe("reusable XLSX survey import", () => {
  before(() => {
    const archive = new AdmZip(
      join(process.cwd(), "prisma/fixtures/baton-rouge-test-data.zip"),
    );
    const entry = archive.getEntry(fixtureName);
    assert.ok(entry, `${fixtureName} is missing from the committed fixture`);
    fixtureDirectory = mkdtempSync(join(tmpdir(), "wrg-xlsx-import-test-"));
    for (const workbookEntry of archive
      .getEntries()
      .filter((candidate) =>
        /BR 20\d{2} - (?:EA|EFS) ORD\.xlsx$/u.test(candidate.entryName),
      )) {
      writeFileSync(
        join(fixtureDirectory, workbookEntry.entryName),
        workbookEntry.getData(),
      );
    }
    fixturePath = join(fixtureDirectory, fixtureName);
  });

  after(() => {
    if (fixtureDirectory) {
      rmSync(fixtureDirectory, { recursive: true, force: true });
    }
  });

  it("preserves report answers instead of replacing them with placeholders", () => {
    const answer = "The people and the supportive culture.";
    assert.equal(xlsxResponseValue(answer), answer);
    assert.equal(xlsxResponseValue("  yes  "), "yes");
    assert.equal(xlsxResponseValue("5"), 5);
    assert.equal(xlsxQuestionType("92. Select your job level:"), "demographic");
  });

  it("keeps an employee verbatim unchanged through XLSX parsing", async () => {
    const filePath = join(fixtureDirectory, "verbatim-import.xlsx");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Responses");
    worksheet.addRow([
      "Respondent",
      "organization name",
      "Language",
      "Date responded",
      "Reached end",
      "Score %",
      "q_OpenEnded_1",
    ]);
    worksheet.addRow([
      "respondent-1",
      "Example Organization",
      "en",
      new Date("2026-06-01T12:00:00.000Z"),
      "yes",
      100,
      "The people and the supportive culture.",
    ]);
    await workbook.xlsx.writeFile(filePath);
    const definition = await readXlsxSurveyDefinition({
      fileName: "verbatim-import.xlsx",
      filePath,
      questionId: (dataLabel) => dataLabel,
    });
    const rows: XlsxSurveyRow[] = [];
    await forEachXlsxSurveyRow(definition, {}, (row) => {
      rows.push(row);
    });

    assert.equal(definition.questions[0]?.type, "open-text");
    assert.equal(
      rows[0]?.responses[0]?.value,
      "The people and the supportive culture.",
    );
  });

  it("reproduces the current backend import totals for every fixture XLSX", async () => {
    const expected = [
      ["BR 2024 - EA ORD.xlsx", 287, 1, 132],
      ["BR 2024 - EFS ORD.xlsx", 93, 22, 1965],
      ["BR 2025 - EA ORD.xlsx", 289, 1, 132],
      ["BR 2025 - EFS ORD.xlsx", 89, 22, 1919],
      ["BR 2026 - EA ORD.xlsx", 277, 1, 129],
      ["BR 2026 - EFS ORD.xlsx", 89, 16, 1393],
    ] as const;
    const actual: Array<readonly [string, number, number, number]> = [];
    for (const [fileName] of expected) {
      const definition = await readXlsxSurveyDefinition({
        fileName,
        filePath: join(fixtureDirectory, fileName),
        questionId: (dataLabel) => dataLabel,
      });
      let respondentCount = 0;
      let responseCount = 0;
      await forEachXlsxSurveyRow(
        definition,
        { includeOrganization: (name) => name === fixtureOrganization },
        (row) => {
          respondentCount += 1;
          responseCount += row.responses.length;
        },
      );
      actual.push([
        fileName,
        definition.questions.length,
        respondentCount,
        responseCount,
      ]);
    }
    assert.deepEqual(actual, expected);

    const definition = await readXlsxSurveyDefinition({
      fileName: fixtureName,
      filePath: fixturePath,
      questionId: (dataLabel) => dataLabel,
    });
    const rows: XlsxSurveyRow[] = [];
    await forEachXlsxSurveyRow(
      definition,
      { includeOrganization: (name) => name === fixtureOrganization },
      (row) => {
        rows.push(row);
      },
    );
    assert.deepEqual(
      ["q_OpenEnded_1", "q_OpenEnded_2"].map((dataLabel) => ({
        dataLabel,
        responses: rows.reduce(
          (count, row) =>
            count +
            Number(
              row.responses.some(
                (response) => response.question.dataLabel === dataLabel,
              ),
            ),
          0,
        ),
      })),
      [
        { dataLabel: "q_OpenEnded_1", responses: 10 },
        { dataLabel: "q_OpenEnded_2", responses: 7 },
      ],
    );
  });

  it("produces the accurate response-detail table for the fixture XLSX", async () => {
    const definition = await readXlsxSurveyDefinition({
      fileName: fixtureName,
      filePath: fixturePath,
      questionId: (dataLabel) => dataLabel,
    });
    const rows: XlsxSurveyRow[] = [];
    await forEachXlsxSurveyRow(
      definition,
      { includeOrganization: (name) => name === fixtureOrganization },
      (row) => {
        rows.push(row);
      },
    );
    const respondents: DetailedRespondent[] = rows.map((row, index) => ({
      id: String(index + 1),
      legacyId: null,
      externalId: null,
      metadata: {},
      responses: row.responses.map((response) => ({
        questionId: response.question.id,
        value: response.value as Prisma.JsonValue,
        score: null,
        question: reportQuestion(response.question),
      })),
    }));
    const question = definition.questions.find(
      ({ dataLabel }) => dataLabel === "q_CoreEmployeeExperience_1",
    );
    const gender = definition.questions.find(
      ({ dataLabel }) => dataLabel === "f_PersonalDemographics_gender",
    );
    assert.ok(question);
    assert.ok(gender);

    assert.deepEqual(
      buildResponseDetailTable(
        reportQuestion(question),
        reportQuestion(gender),
        respondents,
        2026,
      ),
      [
        ["", "Male", "Female"],
        ["Strongly Disagree", { percentile: "0%", respondentCount: 0 }, "x"],
        ["Disagree", { percentile: "0%", respondentCount: 0 }, "x"],
        ["Neutral", { percentile: "14.29%", respondentCount: 2 }, "x"],
        ["Agree", { percentile: "14.29%", respondentCount: 2 }, "x"],
        ["Strongly Agree", { percentile: "71.43%", respondentCount: 10 }, "x"],
        ["N/A", { percentile: "0%", respondentCount: 0 }, "x"],
        ["Question Total", 14, "x"],
      ],
    );
  });
});
