import AdmZip from "adm-zip";
import ExcelJS from "exceljs";
import assert from "node:assert/strict";
import {
  existsSync,
  mkdtempSync,
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
  it("downloads the no-upload definition from the selected EFS and matching year defaults", async () => {
    const root = mkdtempSync(join(tmpdir(), "historical-definition-"));
    const previousCwd = process.cwd();
    process.chdir(root);
    try {
      const efsPath = join(root, "efs.xlsx");
      const source = new ExcelJS.Workbook();
      const survey = source.addWorksheet("Survey");
      survey.addRow([
        "organization name",
        "Respondent",
        "Language",
        "Date responded",
        "Reached end",
        "Score %",
        "q_CoreEmployeeExperience_Test",
      ]);
      survey.addRow(["Acme Corp", 1, "en", "2026-01-01", "Yes", null, 4]);
      await source.xlsx.writeFile(efsPath);
      const service = new HistoricalImportService({
        project: {
          findFirst: () =>
            Promise.resolve({ id: "project-1", name: "Project" }),
        },
        question: {
          findMany: () =>
            Promise.resolve([
              {
                dataLabel: "q_CoreEmployeeExperience_Test",
                caption: "I feel supported at work.",
                type: "likert",
                metadata: {},
                survey: { programId: "other-program", program: { year: 2026 } },
              },
            ]),
        },
      } as never);
      const bytes = await service.downloadDefaultSurveyDefinition(
        {
          sub: "admin",
          roles: ["admin"],
          permissions: [],
          organizationId: null,
        },
        {
          projectId: "project-1",
          programName: "Program 2026",
          programYear: 2026,
          efsLaunchDate: "2026-01-01",
          efsDeadline: "2026-12-31",
        },
        { filename: "efs.xlsx", buffer: readFileSync(efsPath) },
      );
      const workbook = new ExcelJS.Workbook();
      await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
      assert.deepEqual(
        workbook.worksheets.map(({ name }) => name),
        ["Questions", "Answers"],
      );
      assert.equal(
        workbook.getWorksheet("Questions")?.getCell("B2").value,
        "I feel supported at work.",
      );
      assert.equal(
        workbook.getWorksheet("Answers")?.getCell("C5").value,
        "Agree",
      );
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  for (const categories of [undefined, [], ["Default"]]) {
    it(`defaults missing benchmark categories ${JSON.stringify(categories)} during stateless preparation`, async () => {
      const root = mkdtempSync(join(tmpdir(), "historical-default-category-"));
      const filePath = join(root, "ea.xlsx");
      await writeWorkbook(filePath, "Acme", 1);
      const service = new HistoricalImportService({} as never);
      try {
        const result = await service.prepare(
          {
            sub: "admin",
            roles: ["admin"],
            permissions: [],
            organizationId: null,
          },
          {
            projectName: "Default project",
            programName: "Default program",
            programYear: 2026,
            efsLaunchDate: "2026-01-01",
            efsDeadline: "2026-12-31",
            benchmarkCategories: categories,
            organizationPrograms: [
              {
                organizationKey: "acme",
                surveysSent: 10,
                isWinner: "Y",
                currentZohoCategory: "Large",
                benchmarkCategory: "Small",
                reportCategory: "25-99",
              },
            ],
          },
          { eaFile: { filename: "ea.xlsx", buffer: readFileSync(filePath) } },
        );
        assert.deepEqual(result.metadata.benchmarkCategories, ["Default"]);
        assert.equal(
          result.metadata.organizationPrograms?.[0]?.currentZohoCategory,
          "Default",
        );
        assert.equal(
          result.metadata.organizationPrograms[0].benchmarkCategory,
          "Default",
        );
        assert.equal(
          result.metadata.organizationPrograms[0].reportCategory,
          "25-99",
        );
      } finally {
        rmSync(root, { recursive: true, force: true });
      }
    });
  }

  it("prepares a single-workbook preview without creating a sync job", async () => {
    const root = mkdtempSync(join(tmpdir(), "historical-import-prepare-"));
    const previousCwd = process.cwd();
    process.chdir(root);
    const eaPath = join(root, "ea.xlsx");
    await writeWorkbook(eaPath, "Acme Corp", 1);
    let createCalls = 0;
    const prisma = {
      syncJob: {
        create: () => {
          createCalls += 1;
        },
      },
    };

    try {
      const service = new HistoricalImportService(prisma as never);
      const internals = service as unknown as {
        storeWorkbook: (
          draft: unknown,
          kind: "EA" | "EFS",
          file: unknown,
        ) => { filePath: string };
      };
      const storeWorkbook = internals.storeWorkbook.bind(service);
      let stagedFilePath: string | undefined;
      internals.storeWorkbook = (draft, kind, file) => {
        const stored = storeWorkbook(draft, kind, file);
        stagedFilePath = stored.filePath;
        return stored;
      };
      const result = await service.prepare(
        {
          sub: "user-1",
          roles: ["admin"],
          permissions: [],
          organizationId: null,
        },
        {
          projectName: "Test Project",
          programName: "Test Program",
          programYear: 2026,
          efsLaunchDate: "2026-01-01",
          efsDeadline: "2026-12-31",
        },
        {
          eaFile: { filename: "ea.xlsx", buffer: readFileSync(eaPath) },
        },
      );

      assert.equal(createCalls, 0);
      assert.equal(result.validation.blockingErrorCount, 0);
      assert.equal(result.validation.workbooks.length, 1);
      assert.equal(result.validation.workbooks[0]?.kind, "EA");
      assert.equal(
        result.validation.organizations[0]?.displayName,
        "Acme Corp",
      );
      assert.ok(stagedFilePath);
      assert.equal(existsSync(stagedFilePath), false);
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("reports missing EFS question text during preview and accepts a program definition", async () => {
    const root = mkdtempSync(
      join(tmpdir(), "historical-import-label-preview-"),
    );
    const previousCwd = process.cwd();
    process.chdir(root);
    const efsPath = join(root, "efs.xlsx");
    await writeWorkbook(efsPath, "Acme Corp", 1);
    const workbook = readFileSync(efsPath);
    const prisma = {
      question: {
        findMany: () => [
          {
            dataLabel: "q_CoreEmployeeExperience_Test",
            caption: "A newer program's wording",
            type: "likert",
            metadata: {},
            survey: { programId: "newer-program", program: { year: 2026 } },
          },
        ],
      },
    };
    const service = new HistoricalImportService(prisma as never);
    const principal = {
      sub: "user-1",
      roles: ["admin"],
      permissions: [],
      organizationId: null,
    };
    const metadata = {
      projectName: "Test Project",
      programName: "Test Program",
      programYear: 2022,
      efsLaunchDate: "2022-01-01",
      efsDeadline: "2022-12-31",
    };

    try {
      const missing = await service.prepare(principal, metadata, {
        efsFile: { filename: "efs.xlsx", buffer: workbook },
      });
      assert.equal(missing.validation.blockingErrorCount, 1);
      assert.match(
        missing.validation.issues[0]?.message ?? "",
        /q_CoreEmployeeExperience_Test/u,
      );

      const definition = new ExcelJS.Workbook();
      definition.addWorksheet("Questions").addRows([
        ["question_key", "question_label", "question_type"],
        ["q_CoreEmployeeExperience_Test", "Approved 2022 wording", "likert"],
      ]);
      definition.addWorksheet("Answers").addRows([
        ["question_key", "raw_answer", "answer_label", "score"],
        ["q_CoreEmployeeExperience_Test", 4, "Agree", 4],
      ]);
      const defined = await service.prepare(principal, metadata, {
        efsFile: { filename: "efs.xlsx", buffer: workbook },
        surveyDefinitionFile: {
          filename: "definition.xlsx",
          buffer: Buffer.from(await definition.xlsx.writeBuffer()),
        },
      });
      assert.equal(defined.validation.blockingErrorCount, 0);
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("persists only sanitized audit data and commits the runtime draft", async () => {
    const root = mkdtempSync(join(tmpdir(), "historical-import-submit-"));
    const previousCwd = process.cwd();
    process.chdir(root);
    const eaPath = join(root, "ea.xlsx");
    const efsPath = join(root, "efs.xlsx");
    await writeWorkbook(eaPath, "Acme Corp", 1);
    await writeWorkbook(efsPath, "Acme Corp", 1);
    let createdJob: Record<string, unknown> | undefined;
    let runtimeDraft:
      { stagingDir: string; eaFile?: { filePath: string } } | undefined;
    const prisma = {
      question: {
        findMany: () => [
          {
            dataLabel: "q_CoreEmployeeExperience_Test",
            caption: "Approved 2026 wording",
            type: "likert",
            metadata: {},
            survey: { programId: "known-program", program: { year: 2026 } },
          },
        ],
      },
      syncJob: {
        create: ({ data }: { data: Record<string, unknown> }) => {
          createdJob = data;
          return data;
        },
      },
    };

    try {
      const service = new HistoricalImportService(prisma as never);
      const internals = service as unknown as {
        commitDraft: (
          principal: unknown,
          draft: {
            importId: string;
            stagingDir: string;
            eaFile?: { filePath: string };
          },
          validation: unknown,
        ) => Promise<unknown>;
      };
      internals.commitDraft = (_principal, draft) => {
        runtimeDraft = draft;
        assert.equal(existsSync(draft.stagingDir), true);
        assert.equal(existsSync(draft.eaFile?.filePath ?? ""), true);
        return Promise.resolve({
          importId: draft.importId,
          status: "succeeded",
          metadata: {
            projectName: "Test Project",
            programName: "Test Program",
            programYear: 2026,
            efsLaunchDate: "2026-01-01",
            efsDeadline: "2026-12-31",
          },
        });
      };

      await service.submit(
        {
          sub: "user-1",
          roles: ["admin"],
          permissions: [],
          organizationId: null,
        },
        {
          projectName: "Test Project",
          programName: "Test Program",
          programYear: 2026,
          efsLaunchDate: "2026-01-01",
          efsDeadline: "2026-12-31",
        },
        {
          eaFile: { filename: "ea.xlsx", buffer: readFileSync(eaPath) },
          efsFile: { filename: "efs.xlsx", buffer: readFileSync(efsPath) },
        },
      );

      assert.ok(createdJob);
      assert.equal(createdJob.status, "RUNNING");
      assert.ok(runtimeDraft);
      assert.equal(existsSync(runtimeDraft.stagingDir), false);
      const serializedInput = JSON.stringify(createdJob.input);
      assert.doesNotMatch(serializedInput, /stagingDir|filePath|buffer/u);
      const input = createdJob.input as {
        createdByUserId?: string;
        metadata?: { programName?: string };
        workbooks?: Array<Record<string, unknown>>;
      };
      assert.equal(input.createdByUserId, "user-1");
      assert.equal(input.metadata?.programName, "Test Program");
      assert.deepEqual(
        input.workbooks?.map(({ kind, fileName, sizeBytes }) => ({
          kind,
          fileName,
          sizeBytes,
        })),
        [
          {
            kind: "EA",
            fileName: "ea.xlsx",
            sizeBytes: readFileSync(eaPath).length,
          },
          {
            kind: "EFS",
            fileName: "efs.xlsx",
            sizeBytes: readFileSync(efsPath).length,
          },
        ],
      );
      assert.ok(
        input.workbooks.every(({ sha256 }) => typeof sha256 === "string"),
      );
      assert.equal(
        (createdJob.output as { workbooks?: unknown[] }).workbooks?.length,
        2,
      );
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cleans request files and marks the audit job failed when commit fails", async () => {
    const root = mkdtempSync(join(tmpdir(), "historical-import-failure-"));
    const eaPath = join(root, "ea.xlsx");
    const efsPath = join(root, "efs.xlsx");
    await writeWorkbook(eaPath, "Acme Corp", 1);
    await writeWorkbook(efsPath, "Acme Corp", 1);
    let stagedFilePath: string | undefined;
    let failedStatus: string | undefined;
    const prisma = {
      question: {
        findMany: () => [
          {
            dataLabel: "q_CoreEmployeeExperience_Test",
            caption: "Approved 2026 wording",
            type: "likert",
            metadata: {},
            survey: { programId: "known-program", program: { year: 2026 } },
          },
        ],
      },
      syncJob: {
        create: ({ data }: { data: unknown }) => data,
        updateMany: ({ data }: { data: { status?: string } }) => {
          failedStatus = data.status;
          return { count: 1 };
        },
      },
      project: {
        findUnique: () => {
          throw new Error("database unavailable");
        },
        deleteMany: () => Promise.resolve({ count: 0 }),
      },
      organization: { deleteMany: () => Promise.resolve({ count: 0 }) },
    };
    const service = new HistoricalImportService(prisma as never);
    const internals = service as unknown as {
      storeWorkbook: (
        draft: unknown,
        kind: "EA" | "EFS",
        file: unknown,
      ) => { filePath: string };
    };
    const storeWorkbook = internals.storeWorkbook.bind(service);
    internals.storeWorkbook = (draft, kind, file) => {
      const stored = storeWorkbook(draft, kind, file);
      stagedFilePath = stored.filePath;
      return stored;
    };

    try {
      await assert.rejects(
        service.submit(
          {
            sub: "user-1",
            roles: ["admin"],
            permissions: [],
            organizationId: null,
          },
          {
            projectName: "Test Project",
            programName: "Test Program",
            programYear: 2026,
            efsLaunchDate: "2026-01-01",
            efsDeadline: "2026-12-31",
          },
          {
            eaFile: { filename: "ea.xlsx", buffer: readFileSync(eaPath) },
            efsFile: { filename: "efs.xlsx", buffer: readFileSync(efsPath) },
          },
        ),
        /database unavailable/u,
      );
      assert.equal(failedStatus, "FAILED");
      assert.ok(stagedFilePath);
      assert.equal(existsSync(stagedFilePath), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("cleans request files without creating an audit job when validation rejects the submission", async () => {
    const root = mkdtempSync(join(tmpdir(), "historical-import-invalid-"));
    const eaPath = join(root, "ea.xlsx");
    const efsPath = join(root, "efs.xlsx");
    await writeWorkbook(eaPath, "Acme Corp", 1);
    await writeWorkbook(efsPath, "Acme Corp", 1);
    let stagedFilePath: string | undefined;
    let createCalls = 0;
    const service = new HistoricalImportService({
      question: { findMany: () => [] },
      syncJob: {
        create: () => {
          createCalls += 1;
        },
      },
    } as never);
    const internals = service as unknown as {
      storeWorkbook: (
        draft: unknown,
        kind: "EA" | "EFS",
        file: unknown,
      ) => { filePath: string };
    };
    const storeWorkbook = internals.storeWorkbook.bind(service);
    internals.storeWorkbook = (draft, kind, file) => {
      const stored = storeWorkbook(draft, kind, file);
      stagedFilePath = stored.filePath;
      return stored;
    };

    try {
      await assert.rejects(
        service.submit(
          {
            sub: "user-1",
            roles: ["admin"],
            permissions: [],
            organizationId: null,
          },
          {
            projectName: "Test Project",
            programName: "Test Program",
            programYear: 2022,
            efsLaunchDate: "2022-01-01",
            efsDeadline: "2022-12-31",
          },
          {
            eaFile: { filename: "ea.xlsx", buffer: readFileSync(eaPath) },
            efsFile: { filename: "efs.xlsx", buffer: readFileSync(efsPath) },
          },
        ),
        /q_CoreEmployeeExperience_Test/u,
      );
      assert.equal(createCalls, 0);
      assert.ok(stagedFilePath);
      assert.equal(existsSync(stagedFilePath), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("isolates concurrent one-shot imports in separate request workspaces", async () => {
    const root = mkdtempSync(join(tmpdir(), "historical-import-concurrent-"));
    const eaPath = join(root, "ea.xlsx");
    const efsPath = join(root, "efs.xlsx");
    await writeWorkbook(eaPath, "Acme Corp", 1);
    await writeWorkbook(efsPath, "Acme Corp", 1);
    const prisma = {
      question: {
        findMany: () => [
          {
            dataLabel: "q_CoreEmployeeExperience_Test",
            caption: "Approved 2026 wording",
            type: "likert",
            metadata: {},
            survey: { programId: "known-program", program: { year: 2026 } },
          },
        ],
      },
      syncJob: { create: ({ data }: { data: unknown }) => data },
    };
    const service = new HistoricalImportService(prisma as never);
    const workspaces: string[] = [];
    let release!: () => void;
    let bothEntered!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      bothEntered = resolve;
    });
    const internals = service as unknown as {
      commitDraft: (
        principal: unknown,
        draft: { importId: string; stagingDir: string },
        validation: unknown,
      ) => Promise<unknown>;
    };
    internals.commitDraft = async (_principal, draft) => {
      workspaces.push(draft.stagingDir);
      if (workspaces.length === 2) bothEntered();
      await gate;
      return {
        importId: draft.importId,
        status: "succeeded",
        metadata: {
          programName: "Test Program",
          programYear: 2026,
          efsLaunchDate: "2026-01-01",
          efsDeadline: "2026-12-31",
        },
      };
    };
    const submit = () =>
      service.submit(
        {
          sub: "user-1",
          roles: ["admin"],
          permissions: [],
          organizationId: null,
        },
        {
          projectName: "Test Project",
          programName: "Test Program",
          programYear: 2026,
          efsLaunchDate: "2026-01-01",
          efsDeadline: "2026-12-31",
        },
        {
          eaFile: { filename: "ea.xlsx", buffer: readFileSync(eaPath) },
          efsFile: { filename: "efs.xlsx", buffer: readFileSync(efsPath) },
        },
      );

    try {
      const imports = [submit(), submit()];
      await entered;
      assert.equal(new Set(workspaces).size, 2);
      assert.ok(workspaces.every((workspace) => existsSync(workspace)));
      release();
      await Promise.all(imports);
      assert.ok(workspaces.every((workspace) => !existsSync(workspace)));
    } finally {
      release();
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("links the wizard's Zoho project selection to an existing local project", async () => {
    const root = mkdtempSync(
      join(tmpdir(), "historical-import-existing-project-"),
    );
    const previousCwd = process.cwd();
    process.chdir(root);
    const eaPath = join(root, "ea.xlsx");
    await writeWorkbook(eaPath, "Acme", 1);
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
    };

    try {
      const service = new HistoricalImportService(prisma as never);
      const result = await service.prepare(
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
        { eaFile: { filename: "ea.xlsx", buffer: readFileSync(eaPath) } },
      );

      assert.equal(
        result.metadata.projectId,
        "11111111-1111-4111-8111-111111111111",
      );
      assert.equal(result.metadata.zohoProjectId, "zoho-project-1");
    } finally {
      process.chdir(previousCwd);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a Zoho project that has not been created locally yet", async () => {
    const root = mkdtempSync(join(tmpdir(), "historical-import-zoho-project-"));
    const previousCwd = process.cwd();
    process.chdir(root);
    const eaPath = join(root, "ea.xlsx");
    await writeWorkbook(eaPath, "Acme", 1);
    const prisma = {
      project: { findFirst: () => null },
    };

    try {
      const service = new HistoricalImportService(prisma as never);
      const result = await service.prepare(
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
            ["Boutique", "15-24", 45_000],
            ["Small", "25-99", 55_000],
            ["Medium", "100-199", 65_000],
            ["Large", "200-499", 75_000],
            ["Major", "1000+", 95_000],
          ].map(([tier, pricingCategoryName, priceCents]) => ({
            tier,
            pricingCategoryName,
            priceCents,
          })),
          benchmarkCategories: ["Small", "Small-Medium", "Medium", "Large"],
          organizationPrograms: [
            {
              organizationKey: "organization-1",
              organizationName: "Acme",
              surveysSent: 20,
              isWinner: "Y",
              isIncluded: true,
              currentZohoCategory: "Small/Medium",
              reportCategory: "25-99",
            },
          ],
        },
        { eaFile: { filename: "ea.xlsx", buffer: readFileSync(eaPath) } },
      );

      assert.equal(result.metadata.zohoProjectId, "zoho-project-1");
      assert.equal(result.metadata.projectId, undefined);
      assert.equal(
        result.metadata.categoryPricing?.[1]?.pricingCategoryName,
        "25-99",
      );
      assert.deepEqual(result.metadata.benchmarkCategories, [
        "Small",
        "Small-Medium",
        "Medium",
        "Large",
      ]);
      assert.equal(
        result.metadata.organizationPrograms?.[0]?.currentZohoCategory,
        "Small/Medium",
      );
      assert.equal(
        result.metadata.organizationPrograms[0].reportCategory,
        "25-99",
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

  it("matches ranking workbooks without creating a persisted draft", async () => {
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
    const service = new HistoricalImportService({} as never);
    const ranking = await service.previewRanking(
      {
        sub: "user-1",
        roles: ["admin"],
        permissions: [],
        organizationId: null,
      },
      {
        projectName: "Test Project",
        programName: "Test Program",
        benchmarkCategories: ["Small/Medium"],
        programYear: 2026,
        efsLaunchDate: "2026-01-01",
        efsDeadline: "2026-12-31",
        organizationPrograms: [
          {
            organizationKey: "name:acme corp",
            sourceOrganizationId: "1",
            organizationName: "Acme Corp",
            surveysSent: 1,
            isWinner: null,
            isIncluded: true,
          },
        ],
      },
      {
        filename: "ranking.xlsx",
        buffer: Buffer.from(await rankingWorkbook.xlsx.writeBuffer()),
      },
    );
    assert.equal(ranking.matchedOrganizations, 1);
    assert.equal(ranking.invalidRows, 1);
    assert.equal(ranking.organizationPrograms[0]?.isWinner, "Y");
    const matched = ranking.organizationPrograms[0];
    assert.equal(
      "currentZohoCategory" in matched
        ? matched.currentZohoCategory
        : undefined,
      "Small/Medium",
    );
  });

  it("stores EA file metadata and imports EA for Benefits reports", async () => {
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
      warningCount: 0,
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
      syncJob: { updateMany: () => ({ count: 1 }) },
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
        commitDraft: (
          principal: unknown,
          draft: unknown,
          validation: unknown,
        ) => Promise<unknown>;
        collectOrganizationRows: (
          ...args: unknown[]
        ) => Promise<Map<string, never>>;
        createOrganizationsAndEnrollments: (
          ...args: unknown[]
        ) => Promise<Map<string, string>>;
        importSurvey: (...args: unknown[]) => Promise<void>;
        updateOrganizationPrograms: (...args: unknown[]) => Promise<void>;
      };
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

      await internals.commitDraft(
        {
          sub: "bypass-login-auth",
          roles: ["admin"],
          permissions: [],
          organizationId: null,
        },
        draft,
        validation,
      );

      assert.deepEqual(reconciliationFileKinds, ["EA", "EFS"]);
      assert.deepEqual(importedSurveyKinds, ["EA", "EFS"]);
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
