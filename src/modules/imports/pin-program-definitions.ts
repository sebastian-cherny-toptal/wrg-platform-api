import "dotenv/config";
import type { Prisma } from "@prisma/client";
import { PrismaService } from "../../database/prisma.service.js";
import {
  effectiveSurveyDefinition,
  pinProgramDefinitions,
} from "./program-survey-definition.service.js";
import { loadDefaultBenefitsBestPracticesDefinition } from "../reports/benefits-best-practices-from-ea.js";
import {
  customEaDefinitionFromMetadata,
  normalizeEmployerAssessmentDefinition,
  eaDefinitionMetadata,
} from "../reports/custom-ea-report.js";
import {
  mergeSurveyDefinitions,
  type SurveyDefinition,
} from "./survey-definition.js";

// Idempotent upgrade: keep each program's saved content, archive custom snapshots,
// and pin unconfigured definitions to v1. Read only this program's current survey
// when archiving legacy behavior, never another program's data.
const prisma = new PrismaService();
let updated = 0;
try {
  const programs = await prisma.program.findMany({
    select: { id: true, metadata: true },
  });
  for (const program of programs) {
    await prisma.$transaction(
      async (db) => {
        const current = await db.program.findUniqueOrThrow({
          where: { id: program.id },
        });
        const metadata = current.metadata as Prisma.JsonObject;
        const snapshot = { ...metadata };
        const efsFile = metadata.surveyDefinitionFile;
        const hasEfsFile =
          efsFile &&
          typeof efsFile === "object" &&
          !Array.isArray(efsFile) &&
          efsFile.contentBase64;
        if (!metadata.surveyDefinitionVersion && !hasEfsFile) {
          const survey = await db.survey.findFirst({
            where: {
              programId: current.id,
              OR: [
                { metadata: { path: ["kind"], equals: "employee" } },
                {
                  title: { contains: "Employee Feedback", mode: "insensitive" },
                },
                { externalId: { endsWith: "-efs", mode: "insensitive" } },
                { externalId: { endsWith: ":efs", mode: "insensitive" } },
              ],
            },
            orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }],
            include: {
              questions: {
                orderBy: [{ position: "asc" }, { dataLabel: "asc" }],
              },
            },
          });
          if (survey?.questions.length) {
            const responses = await db.response.groupBy({
              by: ["questionId", "value"],
              where: {
                questionId: {
                  in: survey.questions
                    .filter(
                      ({ type }) => !["9", "text", "open-text"].includes(type),
                    )
                    .map(({ id }) => id),
                },
              },
            });
            const definition = effectiveSurveyDefinition(
              survey.questions,
              current.year,
              responses,
            );
            snapshot.surveyDefinition = JSON.parse(
              JSON.stringify(
                mergeSurveyDefinitions(
                  Array.isArray(metadata.surveyDefinition)
                    ? (metadata.surveyDefinition as unknown as SurveyDefinition)
                    : [],
                  definition,
                ),
              ),
            ) as Prisma.JsonValue;
          }
        }
        const eaFile = metadata.employerAssessmentDefinitionFile;
        const hasEaFile =
          eaFile &&
          typeof eaFile === "object" &&
          !Array.isArray(eaFile) &&
          eaFile.contentBase64;
        if (
          !metadata.employerAssessmentDefinitionVersion &&
          !hasEaFile &&
          !customEaDefinitionFromMetadata(metadata)
        ) {
          const survey = await db.survey.findFirst({
            where: {
              programId: current.id,
              OR: [
                { metadata: { path: ["kind"], equals: "employer" } },
                {
                  title: {
                    contains: "Employer Assessment",
                    mode: "insensitive",
                  },
                },
              ],
            },
            select: { id: true },
          });
          if (survey || Array.isArray(metadata.employerAssessmentDefinition)) {
            const defaults = await loadDefaultBenefitsBestPracticesDefinition();
            const labels = Array.isArray(metadata.employerAssessmentDefinition)
              ? (metadata.employerAssessmentDefinition as unknown as SurveyDefinition)
              : [];
            const definition = normalizeEmployerAssessmentDefinition(
              mergeSurveyDefinitions(defaults, labels),
              defaults,
            );
            Object.assign(snapshot, eaDefinitionMetadata(definition));
          }
        }
        const pinned = await pinProgramDefinitions(snapshot);
        if (JSON.stringify(metadata) !== JSON.stringify(pinned)) {
          await db.program.update({
            where: { id: current.id },
            data: { metadata: pinned },
          });
          updated++;
        }
      },
      { isolationLevel: "Serializable", timeout: 30_000 },
    );
  }
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "Program" VALIDATE CONSTRAINT program_efs_definition_source',
  );
  await prisma.$executeRawUnsafe(
    'ALTER TABLE "Program" VALIDATE CONSTRAINT program_ea_definition_source',
  );
  console.log(
    `Pinned EFS and EA definitions for ${updated} of ${programs.length} programs.`,
  );
} finally {
  await prisma.$disconnect();
}
