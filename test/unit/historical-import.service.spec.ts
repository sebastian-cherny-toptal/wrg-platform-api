import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
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
  it("links the wizard's Zoho project selection to an existing local project", async () => {
    const root = mkdtempSync(
      join(tmpdir(), "historical-import-existing-project-"),
    );
    const previousCwd = process.cwd();
    process.chdir(root);
    let storedInput: unknown;
    const prisma = {
      project: {
        findFirst: ({ where }: { where: Record<string, unknown> }) => {
          const references = Array.isArray(where.OR) ? where.OR : [where];
          return references.some(
            (reference) =>
              (reference as { legacyId?: string }).legacyId ===
              "zoho-project-1",
          )
            ? {
                id: "11111111-1111-4111-8111-111111111111",
                name: "Baton Rouge",
              }
            : null;
        },
      },
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
          projectId: null,
          zohoProjectId: "zoho-project-1",
          projectName: "Baton Rouge",
          programName: "Baton Rouge 2026",
          programYear: 2026,
          efsLaunchDate: "2026-01-01",
          efsDeadline: "2026-12-31",
        },
      );

      assert.equal(
        result.metadata.projectId,
        "11111111-1111-4111-8111-111111111111",
      );
      assert.equal(result.metadata.zohoProjectId, "zoho-project-1");
      assert.equal(
        (storedInput as { projectId?: string }).projectId,
        "11111111-1111-4111-8111-111111111111",
      );
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

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
          categoryPricing: [
            ["Boutique", "Boutique", "15-24", 45_000],
            ["Small", "Small", "25-49", 55_000],
            ["Medium", "Small/Medium", "50-99", 65_000],
            ["Large", "Large", "100-249", 75_000],
            ["Mega", "Mega", "250-999", 85_000],
            ["Major", "Major", "1,000+", 95_000],
          ].map(([tier, zohoCategoryName, employeeSize, priceCents]) => ({
            tier,
            zohoCategoryName,
            employeeSize,
            priceCents,
          })),
          organizationPrograms: [
            {
              organizationKey: "organization-1",
              organizationName: "Acme",
              surveysSent: 20,
              isWinner: true,
              isIncluded: true,
              currentZohoCategory: "Small/Medium",
              reportCategory: "25-99",
            },
          ],
        },
      );

      assert.equal(result.metadata.zohoProjectId, "zoho-project-1");
      assert.equal(result.metadata.projectId, undefined);
      assert.equal(
        result.metadata.categoryPricing?.[2]?.zohoCategoryName,
        "Small/Medium",
      );
      assert.equal(
        result.metadata.organizationPrograms?.[0]?.currentZohoCategory,
        "Small/Medium",
      );
      assert.equal(
        result.metadata.organizationPrograms[0].reportCategory,
        "25-99",
      );
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
    const root = mkdtempSync(join(tmpdir(), "historical-import-efs-template-"));
    const fileName = "BR 2026 - EFS ORD.xlsx";
    const filePath = join(root, fileName);
    const fixture = new AdmZip(
      join(process.cwd(), "secure", "seed-data", "Baton Rouge 24-26.zip"),
    ).readFile(fileName);
    assert.ok(fixture, `${fileName} is missing from the seed archive`);
    writeFileSync(filePath, fixture);

    try {
      const definition = await readXlsxSurveyDefinition({
        fileName,
        filePath,
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
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
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
      rankingSheet.addRow(["Promote", "Acme Corp", "1", "Yes", "Small/Medium"]);
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
          isIncluded: true,
          currentZohoCategory: "Small/Medium",
        },
      ]);
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("stores EA file metadata without importing EA as a survey", async () => {
    const root = mkdtempSync(join(tmpdir(), "historical-import-ea-metadata-"));
    const importId = "import-ea-metadata";
    const eaPath = join(root, "ea.xlsx");
    const efsPath = join(root, "efs.xlsx");
    await writeWorkbook(eaPath, "Acme Corp", 1);
    await writeWorkbook(efsPath, "Acme Corp", 1);
    const eaSizeBytes = readFileSync(eaPath).length;
    const importedSurveyKinds: string[] = [];
    const reconciliationFileKinds: string[] = [];
    let programMetadata: unknown;
    const validation = {
      issues: [],
      workbooks: [],
      organizations: [],
      blockingErrorCount: 0,
    };
    const draft = {
      importId,
      stagingDir: root,
      projectName: "Indiana",
      programName: "Indiana 2026",
      programYear: 2026,
      efsLaunchDate: "2026-01-01",
      efsDeadline: "2026-12-31",
      status: "validated",
      eaFile: {
        kind: "EA",
        fileName: "IN 2026 EA ORDS.xlsx",
        filePath: eaPath,
        sha256: "ea-sha256",
        sizeBytes: eaSizeBytes,
      },
      efsFile: {
        kind: "EFS",
        fileName: "IN 26 EFS ORDS.xlsx",
        filePath: efsPath,
        sha256: "efs-sha256",
        sizeBytes: readFileSync(efsPath).length,
      },
    };
    const prisma = {
      syncJob: { findFirst: () => ({ output: validation }) },
      project: {
        findUnique: () => null,
        create: ({ data }: { data: unknown }) => data,
      },
      program: {
        create: ({ data }: { data: { metadata: unknown } }) => {
          programMetadata = data.metadata;
          return data;
        },
      },
      programZohoCategory: { deleteMany: () => ({ count: 0 }) },
      auditLog: { create: () => ({}) },
    };

    try {
      const service = new HistoricalImportService(prisma as never);
      const internals = service as unknown as {
        loadDraft: () => Promise<unknown>;
        saveDraft: (...args: unknown[]) => Promise<void>;
        collectOrganizationRows: (
          ...args: unknown[]
        ) => Promise<Map<string, never>>;
        createOrganizationsAndEnrollments: (
          ...args: unknown[]
        ) => Promise<Map<string, string>>;
        importSurvey: (...args: unknown[]) => Promise<void>;
        updateOrganizationPrograms: (...args: unknown[]) => Promise<void>;
        getStatus: (...args: unknown[]) => Promise<unknown>;
      };
      internals.loadDraft = () => Promise.resolve(draft);
      internals.saveDraft = () => Promise.resolve();
      internals.collectOrganizationRows = (...args) => {
        reconciliationFileKinds.push(
          ...args
            .slice(0, 2)
            .map((file) => String((file as { kind?: unknown }).kind)),
        );
        return Promise.resolve(new Map<string, never>());
      };
      internals.createOrganizationsAndEnrollments = () =>
        Promise.resolve(new Map<string, string>());
      internals.importSurvey = (...args) => {
        importedSurveyKinds.push(String(args[2]));
        return Promise.resolve();
      };
      internals.updateOrganizationPrograms = () => Promise.resolve();
      internals.getStatus = () => Promise.resolve({ status: "succeeded" });

      await service.commit(
        {
          sub: "bypass-login-auth",
          roles: ["admin"],
          permissions: [],
          organizationId: null,
        },
        importId,
      );

      assert.deepEqual(reconciliationFileKinds, ["EA", "EFS"]);
      assert.deepEqual(importedSurveyKinds, ["EFS"]);
      assert.deepEqual(
        (programMetadata as { employerAssessmentFile?: unknown })
          .employerAssessmentFile,
        {
          fileName: "IN 2026 EA ORDS.xlsx",
          sha256: "ea-sha256",
          sizeBytes: eaSizeBytes,
        },
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
