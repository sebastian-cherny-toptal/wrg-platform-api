import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import ExcelJS from "exceljs";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import type { PrismaService } from "../../src/database/prisma.service.js";
import { HistoricalImportService } from "../../src/modules/imports/historical-import.service.js";
import {
  parseSurveyDefinition,
  type SurveyDefinition,
} from "../../src/modules/imports/survey-definition.js";
import {
  ProgramSurveyDefinitionService,
  surveyDefinitionWorkbook,
} from "../../src/modules/imports/program-survey-definition.service.js";
import { CompatibilityReportsService } from "../../src/modules/reports/compatibility-reports.module.js";

const connectionString = process.env.EA_TEST_DATABASE_URL;

test(
  "custom EA imports, saves, calculates, downloads, and replaces definitions on PostgreSQL",
  { skip: !connectionString },
  async () => {
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    });
    const imports = new HistoricalImportService(
      prisma as unknown as PrismaService,
    );
    const definitions = new ProgramSurveyDefinitionService(
      prisma as unknown as PrismaService,
    );
    const reports = new CompatibilityReportsService(
      prisma as unknown as PrismaService,
    );
    const principal = {
      sub: "bypass-login-auth",
      roles: ["admin"],
      permissions: [],
      organizationId: null,
    };
    const run = randomUUID();
    const programIds: string[] = [];
    const projectIds: string[] = [];
    const organizationIds: string[] = [];
    const importIds: string[] = [];
    const makeWorkbook = async (kind: "EA" | "EFS", prefix: string) => {
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Raw-data");
      sheet.addRow([
        "organization name",
        "Respondent",
        "Language",
        "Date responded",
        "Reached end",
        "Score %",
        ...(kind === "EA"
          ? [`${prefix}. Boxing Day`, `${prefix}.1`, `${prefix}_count`]
          : ["q_CoreEmployeeExperience_1"]),
      ]);
      for (let index = 0; index < 5; index++)
        sheet.addRow([
          `${run} Employer ${index}`,
          index + 1,
          "en",
          "2026-01-01",
          "Yes",
          null,
          ...(kind === "EA"
            ? [1, index < 3 ? 7 : 3, index === 0 ? 32 : 0]
            : [4]),
        ]);
      return {
        filename: `${kind.toLowerCase()}.xlsx`,
        buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      };
    };
    try {
      for (const prefix of [
        "q_OrganisationalBenefits_Holidays",
        "q_OrganizationalOverview_Holidays",
      ]) {
        const definition: SurveyDefinition = [
          {
            dataLabel: "holidays",
            caption: "Holiday choices",
            categoryLabel: "Benefits",
            ea: {
              calculation: "multi",
              sourceColumn: prefix,
              format: "percent",
            },
            options: [
              {
                Id: "Boxing Day",
                Caption: "Boxing Day",
                Position: 1,
                SourceColumn: `${prefix}. Boxing Day`,
              },
            ],
          },
          {
            dataLabel: "benefits",
            caption: "Supplementary benefits",
            categoryLabel: "Benefits",
            ea: {
              calculation: "choice",
              sourceColumn: `${prefix}.1`,
              format: "percent",
              groupLabel: "Life Assurance",
            },
            options: [
              { Id: "7", Caption: "Standard Offering", Position: 2 },
              { Id: "3", Caption: "Optional", Position: 1 },
            ],
          },
          {
            dataLabel: "count",
            caption: "Holiday count",
            categoryLabel: "Benefits",
            ea: {
              calculation: "mean",
              sourceColumn: `${prefix}_count`,
              format: "number",
            },
          },
        ];
        const metadata = {
          projectName: `${run} ${prefix}`,
          programName: `${run} 2026`,
          programYear: 2026,
          efsLaunchDate: "2026-01-01",
          efsDeadline: "2026-12-31",
        };
        const eaFile = await makeWorkbook("EA", prefix);
        const efsFile = await makeWorkbook("EFS", prefix);
        const employerAssessmentDefinitionFile = {
          filename: "definition.xlsx",
          buffer: await surveyDefinitionWorkbook(definition),
        };
        const preview = await imports.prepare(principal, metadata, {
          eaFile,
          employerAssessmentDefinitionFile,
        });
        assert.equal(preview.validation.blockingErrorCount, 0);
        const imported = await imports.submit(principal, metadata, {
          eaFile,
          efsFile,
          employerAssessmentDefinitionFile,
        });
        assert.equal(imported.status, "succeeded");
        assert.ok(imported.programId);
        assert.ok(imported.projectId);
        programIds.push(imported.programId);
        projectIds.push(imported.projectId);
        importIds.push(imported.importId);
        const enrollments = await prisma.organizationProgram.findMany({
          where: { programId: imported.programId },
        });
        assert.equal(enrollments.length, 5);
        organizationIds.push(
          ...enrollments.map((enrollment) => enrollment.organizationId),
        );
        await prisma.organizationProgram.updateMany({
          where: { programId: imported.programId },
          data: {
            isWinner: "Y",
            benchmarkCategory: "Small",
            currentZohoCategory: "Small",
            reportAccess: { BBP_Access: "yes" },
          },
        });
        const enrollment = enrollments[0];
        assert.ok(enrollment);
        const query = {
          selectedProgramId: imported.programId,
          organizationId: enrollment.organizationId,
          isDummy: false,
        };
        const report = await reports.employerBenchmark(principal, query);
        const questions = report.data.tableData.flatMap(
          (section) => section.nestedData,
        );
        const matrix = questions.find(
          (question) => question.title === "Supplementary benefits",
        );
        assert.ok(matrix);
        assert.deepEqual(
          matrix.nestedData.map((row) => [
            row.title,
            row.groupLabel,
            row.dataValues[0],
          ]),
          [
            ["Optional", "Life Assurance", 40],
            ["Standard Offering", "Life Assurance", 60],
          ],
        );
        assert.equal(
          questions.find((q) => q.title === "Holiday count")?.nestedData[0]
            ?.dataValues[0],
          6.4,
        );
        assert.equal(
          questions.find((q) => q.title === "Holiday choices")?.nestedData[0]
            ?.dataValues[0],
          100,
        );
        const bytes = await reports.employerBenchmarkWorkbook(principal, query);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(bytes as unknown as ExcelJS.Buffer);
        const labels: string[] = [];
        workbook.worksheets[0]
          ?.getColumn(1)
          .eachCell((cell) => labels.push(cell.text));
        assert.ok(labels.includes("Life Assurance"));
        assert.deepEqual(
          await parseSurveyDefinition(
            await definitions.downloadEmployerAssessment(
              principal,
              imported.programId,
            ),
          ),
          definition.map((q) => ({
            ...q,
            ...(q.options
              ? {
                  options: q.options.toSorted(
                    (a, b) => a.Position - b.Position,
                  ),
                }
              : {}),
          })),
        );
        const count = definition.find((q) => q.dataLabel === "count");
        assert.ok(count);
        await definitions.uploadEmployerAssessment(
          principal,
          imported.programId,
          "replaced.xlsx",
          await surveyDefinitionWorkbook([count]),
        );
        const replaced = await reports.employerBenchmark(principal, query);
        assert.equal(
          replaced.data.tableData.flatMap((section) => section.nestedData)
            .length,
          1,
        );
      }
      // Replacing the second program must not change the first program's saved definition.
      const first = programIds[0];
      assert.ok(first);
      assert.equal(
        (
          await parseSurveyDefinition(
            await definitions.downloadEmployerAssessment(principal, first),
          )
        ).length,
        1,
      );
    } finally {
      await prisma.auditLog.deleteMany({
        where: { resourceId: { in: projectIds } },
      });
      await prisma.project.deleteMany({ where: { id: { in: projectIds } } });
      await prisma.organization.deleteMany({
        where: { id: { in: organizationIds } },
      });
      await prisma.syncJob.deleteMany({
        where: {
          idempotencyKey: {
            in: importIds.map((id) => `historical-import:${id}`),
          },
        },
      });
      await prisma.$disconnect();
    }
  },
);
