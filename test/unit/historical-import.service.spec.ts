import ExcelJS from "exceljs";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, it } from "node:test";
import {
  HistoricalImportService,
  historicalQuestionMetadata,
  loadBundledWorkforceQuestionTemplates,
  missingQuestionTemplateLabels,
  mergeHistoricalQuestionTemplate,
} from "../../src/modules/imports/historical-import.service.js";
import { readXlsxSurveyDefinition } from "../../src/modules/imports/xlsx-survey-importer.js";

async function writeWorkbook(
  filePath: string,
  organizationName: string,
  respondent: number,
): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet("Survey");
  worksheet.addRow([
    "Score %",
    "organization name",
    "Respondent",
    "Language",
    "Date responded",
    "Reached end",
    "q_CoreEmployeeExperience_Test",
  ]);
  worksheet.addRow([
    null,
    organizationName,
    respondent,
    "en",
    "2026-01-01",
    "Yes",
    4,
  ]);
  await workbook.xlsx.writeFile(filePath);
}

describe("historical import service", () => {
  it("accepts a Zoho project that has not been created locally yet", async () => {
    const root = mkdtempSync(join(tmpdir(), "historical-import-zoho-project-"));
    const previousCwd = process.cwd();
    process.chdir(root);
    let storedInput: unknown;
    const prisma = {
      project: { findFirst: () => null },
      syncJob: {
        create: ({ data }: { data: { input: unknown } }) => {
          storedInput = data.input;
          return data;
        },
      },
    };

    try {
      const service = new HistoricalImportService(prisma as never);
      const result = await service.createDraft(
        {
          sub: "user-1",
          roles: ["admin"],
          permissions: [],
          organizationId: null,
        },
        {
          zohoProjectId: "zoho-project-1",
          projectName: "Baton Rouge",
          zohoProgramId: "zoho-program-1",
          programName: "Baton Rouge 2026",
          programYear: 2026,
          efsLaunchDate: "2026-01-01",
          efsDeadline: "2026-12-31",
        },
      );

      assert.equal(result.metadata.zohoProjectId, "zoho-project-1");
      assert.equal(result.metadata.projectId, undefined);
      assert.equal(
        (storedInput as { zohoProjectId?: string }).zohoProjectId,
        "zoho-project-1",
      );
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("uses stored question text and answer labels for imported survey columns", () => {
    const question = {
      id: "question-id",
      dataLabel: "q_YourJob_3_25",
      caption: "Your Job / 3 / 25",
      column: 7,
      type: "likert",
    };
    const template = {
      dataLabel: question.dataLabel,
      caption: "I have the resources I need to do my job well.",
      type: "likert",
      metadata: {
        QuestionTypeId: 5,
        QuestionResponses: [
          { Id: 1, Caption: "Strongly Disagree" },
          { Id: 5, Caption: "Strongly Agree" },
        ],
      },
    };

    assert.equal(
      mergeHistoricalQuestionTemplate(question, template).caption,
      template.caption,
    );
    assert.deepEqual(
      historicalQuestionMetadata(question, template.metadata, "import-id")
        .QuestionResponses,
      template.metadata.QuestionResponses,
    );
    assert.deepEqual(
      missingQuestionTemplateLabels([question], new Set([question.dataLabel])),
      [],
    );
    assert.deepEqual(missingQuestionTemplateLabels([question], new Set()), [
      question.dataLabel,
    ]);
  });

  it("loads EFS question templates without relying on an existing program", async () => {
    const definition = await readXlsxSurveyDefinition({
      fileName: "BR 2026 - EFS ORD.xlsx",
      filePath: join(
        process.cwd(),
        "..",
        "Baton Rouge 24-26",
        "BR 2026 - EFS ORD.xlsx",
      ),
      questionId: (dataLabel) => dataLabel,
    });
    const likertQuestions = definition.questions.filter(
      ({ type }) => type === "likert",
    );

    const templates = await loadBundledWorkforceQuestionTemplates(
      2026,
      definition.questions,
    );

    assert.equal(templates.size, likertQuestions.length);
    assert.equal(
      templates.get("q_CoreEmployeeExperience_1")?.caption,
      "This organization's culture allows me to do my best work",
    );
    assert.equal(
      (
        templates.get("q_CoreEmployeeExperience_1")?.metadata as {
          categoryLabel?: string;
        }
      ).categoryLabel,
      "Core Employee Experience",
    );
  });

  it("validates uploaded workbooks and returns a summary", async () => {
    const root = mkdtempSync(join(tmpdir(), "historical-import-test-"));
    const previousCwd = process.cwd();
    process.chdir(root);
    const importId = "import-test-id";
    const stagingDir = join(root, "var", "historical-imports", importId);
    mkdirSync(stagingDir, { recursive: true });
    const eaPath = join(stagingDir, "ea-ea.xlsx");
    const efsPath = join(stagingDir, "efs-efs.xlsx");
    await writeWorkbook(eaPath, "Acme Corp", 1);
    await writeWorkbook(efsPath, "Acme Corp", 1);

    const prisma = {
      syncJob: {
        findFirst: () => ({
          input: {
            importId,
            stagingDir,
            projectName: "Test Project",
            programName: "Test Program",
            programYear: 2026,
            efsLaunchDate: "2026-01-01",
            efsDeadline: "2026-12-31",
            status: "draft",
            eaFile: {
              kind: "EA",
              fileName: "ea.xlsx",
              filePath: eaPath,
              sha256: "ea",
              sizeBytes: readFileSync(eaPath).length,
            },
            efsFile: {
              kind: "EFS",
              fileName: "efs.xlsx",
              filePath: efsPath,
              sha256: "efs",
              sizeBytes: readFileSync(efsPath).length,
            },
          },
          output: null,
          status: "PENDING",
        }),
        updateMany: () => ({ count: 1 }),
      },
    };

    try {
      const service = new HistoricalImportService(prisma as never);
      const summary = await service.validate(
        {
          sub: "user-1",
          roles: ["admin"],
          permissions: [],
          organizationId: null,
        },
        importId,
      );
      assert.equal(summary.blockingErrorCount, 0);
      assert.equal(summary.workbooks.length, 2);
      assert.equal(summary.organizations.length, 1);

      const rankingWorkbook = new ExcelJS.Workbook();
      const rankingSheet = rankingWorkbook.addWorksheet("Ranking");
      rankingSheet.addRow([
        "Stage",
        "Alias Name",
        "Organization ID",
        "CY Winner",
        "CY Category",
      ]);
      rankingSheet.addRow(["Promote", "Acme Corp", "1", "Yes", "Medium"]);
      rankingSheet.addRow(["Promote", "Pending Corp", "2", "7", "7"]);
      const rankingBuffer = Buffer.from(
        await rankingWorkbook.xlsx.writeBuffer(),
      );
      const ranking = await service.matchRankingWorkbook(
        {
          sub: "user-1",
          roles: ["admin"],
          permissions: [],
          organizationId: null,
        },
        importId,
        { filename: "ranking.xlsx", buffer: rankingBuffer },
      );
      assert.equal(ranking.matchedOrganizations, 1);
      assert.equal(ranking.invalidRows, 1);
      assert.deepEqual(ranking.organizationPrograms, [
        {
          organizationKey: "name:acme corp",
          organizationName: "Acme Corp",
          surveysSent: 1,
          isWinner: true,
          currentYearCategory: "Medium",
        },
      ]);
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });
});
