import ExcelJS from "exceljs";
import { PrismaClient, type Prisma } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { HistoricalImportService } from "../../src/modules/imports/historical-import.service.js";
import {
  readXlsxSurveyDefinition,
  forEachXlsxSurveyRow,
} from "../../src/modules/imports/xlsx-survey-importer.js";

const connectionString = process.env.EFS_TEST_DATABASE_URL;
const principal = {
  sub: "test-admin",
  roles: ["admin"],
  permissions: [],
  organizationId: null,
};

const largeWorkbook = process.env.EFS_LARGE_WORKBOOK;
test(
  "full EFS workbook imports every respondent and response on PostgreSQL",
  { skip: !connectionString || !largeWorkbook },
  async () => {
    assert.ok(largeWorkbook);
    const prisma = new PrismaClient({
      adapter: new PrismaPg({ connectionString }),
    });
    const projectId = randomUUID(),
      programId = randomUUID(),
      oldSurveyId = randomUUID();
    const started = Date.now();
    const organizationIds = new Map<string, string>();
    try {
      const definition = await readXlsxSurveyDefinition({
        fileName: "efs.xlsx",
        filePath: largeWorkbook,
        questionId: (label) => label,
      });
      let expectedRespondents = 0,
        expectedResponses = 0,
        expectedYoloCompleted = 0;
      await forEachXlsxSurveyRow(definition, {}, (row) => {
        if (!row.organizationName) return;
        if (!organizationIds.has(row.organizationName))
          organizationIds.set(row.organizationName, randomUUID());
        expectedRespondents++;
        expectedResponses += row.responses.length;
        if (row.organizationName === "YoloCares" && row.completed)
          expectedYoloCompleted++;
      });
      await prisma.project.create({
        data: { id: projectId, name: "Large EFS test", slug: projectId },
      });
      await prisma.program.create({
        data: {
          id: programId,
          projectId,
          name: "Healthcare 2026",
          year: 2026,
          startsAt: new Date("2026-03-13"),
          endsAt: new Date("2026-03-27"),
        },
      });
      await prisma.organization.createMany({
        data: [...organizationIds].map(([name, id]) => ({
          id,
          name,
          slug: id,
        })),
      });
      await prisma.organizationProgram.createMany({
        data: [...organizationIds].map(([name, organizationId]) => ({
          organizationId,
          programId,
          projectId,
          metrics: { Source_Organization_Name: name },
        })),
      });
      await prisma.survey.create({
        data: {
          id: oldSurveyId,
          programId,
          title: "Employee Feedback Survey",
          status: "CLOSED",
          endsAt: new Date("2026-03-27"),
          metadata: { kind: "employee" },
        },
      });
      await prisma.question.createMany({
        data: definition.questions.map((question, position) => ({
          id: randomUUID(),
          surveyId: oldSurveyId,
          dataLabel: question.dataLabel,
          caption: question.caption,
          type: question.type,
          position,
        })),
      });
      const service = new HistoricalImportService(prisma as never);
      const file = {
        filename: "efs.xlsx",
        buffer: readFileSync(largeWorkbook),
      };
      const review = await service.reuploadProgramEfs(
        principal,
        programId,
        file,
      );
      assert.equal(review.validation.blockingErrorCount, 0);
      let lastLog = Date.now();
      const saved = await service.reuploadProgramEfs(
        principal,
        programId,
        file,
        review.revision,
        {
          onProgress: (progress) => {
            if (Date.now() - lastLog > 30_000) {
              console.log(JSON.stringify(progress));
              lastLog = Date.now();
            }
            return Promise.resolve();
          },
        },
      );
      assert.equal(saved.saved, true);
      assert.equal(
        await prisma.respondent.count({ where: { survey: { programId } } }),
        expectedRespondents,
      );
      assert.equal(
        await prisma.response.count({
          where: { respondent: { survey: { programId } } },
        }),
        expectedResponses,
      );
      const yoloOrganizationId = organizationIds.get("YoloCares");
      assert.ok(yoloOrganizationId);
      assert.equal(
        await prisma.respondent.count({
          where: {
            organizationId: yoloOrganizationId,
            survey: { programId },
            completedAt: { not: null },
          },
        }),
        expectedYoloCompleted,
      );
      console.log(
        JSON.stringify({
          verifiedRespondents: expectedRespondents,
          verifiedResponses: expectedResponses,
          yoloCompleted: expectedYoloCompleted,
          elapsedSeconds: Math.round((Date.now() - started) / 1000),
        }),
      );
    } finally {
      await prisma.project.deleteMany({ where: { id: projectId } });
      await prisma.organization.deleteMany({
        where: { id: { in: [...organizationIds.values()] } },
      });
      await prisma.$disconnect();
    }
  },
);

for (const failPublication of [false, true]) {
  test(
    `staged EFS import on PostgreSQL ${failPublication ? "rolls back a failed publication" : "publishes all response batches atomically"}`,
    { skip: !connectionString },
    async () => {
      const prisma = new PrismaClient({
        adapter: new PrismaPg({ connectionString }),
      });
      const projectId = randomUUID();
      const programId = randomUUID();
      const organizationId = randomUUID();
      const oldSurveyId = randomUUID();
      const labels = Array.from(
        { length: 89 },
        (_, index) => `q_CoreEmployeeExperience_Test${index}`,
      );
      const activeWhere = {
        programId,
        metadata: { path: ["kind"], equals: "employee" },
      };
      try {
        await prisma.project.create({
          data: { id: projectId, name: "EFS recovery test", slug: projectId },
        });
        await prisma.program.create({
          data: {
            id: programId,
            projectId,
            name: "Recovery 2026",
            year: 2026,
            startsAt: new Date("2026-03-13"),
            endsAt: new Date("2026-03-27"),
            metadata: {
              sentinel: "preserve",
              reportCatalog: [{ id: "report" }],
            },
          },
        });
        await prisma.organization.create({
          data: { id: organizationId, name: "YoloCares", slug: organizationId },
        });
        await prisma.organizationProgram.create({
          data: {
            organizationId,
            programId,
            projectId,
            metrics: {
              Source_Organization_Name: "YoloCares",
              Surveys_Sent: 106,
            },
          },
        });
        await prisma.survey.create({
          data: {
            id: oldSurveyId,
            programId,
            title: "Employee Feedback Survey",
            status: "CLOSED",
            endsAt: new Date("2026-03-27"),
            metadata: { kind: "employee" },
          },
        });
        await prisma.question.createMany({
          data: labels.map((dataLabel, index) => ({
            id: randomUUID(),
            surveyId: oldSurveyId,
            dataLabel,
            caption: `Statement ${index}`,
            type: "likert",
            position: index,
          })),
        });
        const workbook = new ExcelJS.Workbook();
        const sheet = workbook.addWorksheet("Survey");
        sheet.addRow([
          "organization name",
          "Respondent",
          "Date responded",
          "Reached end",
          "Score %",
          ...labels,
        ]);
        for (let index = 0; index < 250; index++)
          sheet.addRow([
            "YoloCares",
            index + 1,
            "2026-03-20",
            "Yes",
            null,
            ...labels.map(() => 4),
          ]);
        const file = {
          filename: "efs.xlsx",
          buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
        };
        let transactionCount = 0;
        let sawPrivateStaging = false;
        const guardedPrisma = new Proxy(prisma, {
          get(target, key, receiver) {
            if (key !== "$transaction")
              return Reflect.get(target, key, receiver) as unknown;
            return async (
              operation: (
                transaction: Prisma.TransactionClient,
              ) => Promise<void>,
            ) => {
              transactionCount++;
              return target.$transaction(
                async (transaction) => {
                  const guarded = new Proxy(transaction, {
                    get(tx, model, modelReceiver) {
                      if (model === "response")
                        return {
                          ...tx.response,
                          createMany: () => {
                            throw new Error(
                              "A query cannot be executed on an expired transaction",
                            );
                          },
                        };
                      if (model === "survey" && failPublication)
                        return {
                          ...tx.survey,
                          update: () => {
                            throw new Error("publication failed");
                          },
                        };
                      return Reflect.get(tx, model, modelReceiver) as unknown;
                    },
                  });
                  await operation(guarded);
                },
                { timeout: 5_000 },
              );
            };
          },
        });
        const service = new HistoricalImportService(guardedPrisma as never);
        const review = await service.reuploadProgramEfs(
          principal,
          programId,
          file,
        );
        const save = service.reuploadProgramEfs(
          principal,
          programId,
          file,
          review.revision,
          {
            onProgress: async () => {
              const active = await prisma.survey.findMany({
                where: activeWhere,
                select: { id: true },
              });
              assert.deepEqual(
                active.map(({ id }) => id),
                [oldSurveyId],
              );
              const staging = await prisma.survey.findFirst({
                where: {
                  programId,
                  metadata: { path: ["kind"], equals: "employee-staging" },
                },
              });
              assert.ok(staging);
              assert.equal(staging.status, "DRAFT");
              assert.ok(!staging.title.includes("Employee Feedback Survey"));
              assert.ok(!staging.externalId?.endsWith(":efs"));
              sawPrivateStaging = true;
            },
          },
        );
        if (failPublication) {
          await assert.rejects(save, /publication failed/u);
          assert.equal(await prisma.survey.count({ where: activeWhere }), 1);
          assert.equal(
            (await prisma.survey.findFirstOrThrow({ where: activeWhere })).id,
            oldSurveyId,
          );
          assert.equal(
            await prisma.respondent.count({ where: { survey: { programId } } }),
            0,
          );
        } else {
          assert.equal((await save).saved, true);
          assert.equal(await prisma.survey.count({ where: { programId } }), 1);
          assert.equal(
            await prisma.respondent.count({
              where: {
                organizationId,
                survey: activeWhere,
                completedAt: { not: null },
              },
            }),
            250,
          );
          assert.equal(
            await prisma.response.count({
              where: { respondent: { survey: { programId } } },
            }),
            250 * 89,
          );
        }
        assert.ok(sawPrivateStaging);
        assert.equal(transactionCount, 1);
        assert.equal(
          await prisma.survey.count({ where: { programId, status: "DRAFT" } }),
          0,
        );
        const metadata = (
          await prisma.program.findUniqueOrThrow({ where: { id: programId } })
        ).metadata;
        assert.ok(
          metadata && typeof metadata === "object" && !Array.isArray(metadata),
        );
        assert.equal(metadata.sentinel, "preserve");
        assert.deepEqual(metadata.reportCatalog, [{ id: "report" }]);
      } finally {
        await prisma.project.deleteMany({ where: { id: projectId } });
        await prisma.organization.deleteMany({ where: { id: organizationId } });
        await prisma.$disconnect();
      }
    },
  );
}
