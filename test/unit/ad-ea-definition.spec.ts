import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import type { PrismaService } from "../../src/database/prisma.service.js";
import {
  parseSurveyDefinition,
  type SurveyDefinition,
} from "../../src/modules/imports/survey-definition.js";
import { ProgramSurveyDefinitionService } from "../../src/modules/imports/program-survey-definition.service.js";
import {
  customEaDefinitionFromMetadata,
  generateCustomEaReport,
  normalizeEmployerAssessmentDefinition,
  validateCustomEaDefinition,
} from "../../src/modules/reports/custom-ea-report.js";

const calculations = [
  "mean",
  "choice",
  "multi",
  "multi",
  "choice",
  "multi",
  "yesNo",
  "yesNo",
  "yesNo",
  "multi",
  "mean",
  "multi",
  "multi",
  "multi",
  "multi",
  "yesNo",
  "yesNo",
  "multi",
  "multi",
  "yesNo",
];

const fixture = () =>
  readFile(new URL("../fixtures/ad-2026-ea-qa-upload.xlsx", import.meta.url));

test("the original AD workbook uploads, downloads, and calculates without mapping columns", async () => {
  const buffer = await fixture();
  const parsed = await parseSurveyDefinition(buffer, "EA");
  assert.equal(parsed.length, 20);
  assert.ok(parsed.every((q) => q.ea === undefined));

  // Model the EA export contract independently of the generated mappings.
  const columns = parsed.flatMap((question, index) =>
    calculations[index] === "multi"
      ? (question.options ?? []).map((o) => `${question.dataLabel}. ${o.Id}`)
      : [question.dataLabel],
  );
  let metadata: Record<string, unknown> = {};
  const db = {
    program: {
      findFirst: () => Promise.resolve({ id: "ad-2026", metadata }),
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
  const principal = {
    sub: "admin",
    roles: ["admin"],
    permissions: [],
    organizationId: null,
  };
  const result = await service.uploadEmployerAssessment(
    principal,
    "ad-2026",
    "ad.xlsx",
    buffer,
  );
  assert.equal(result.updatedLabels, 20);
  const definition = customEaDefinitionFromMetadata(metadata);
  assert.ok(definition);
  validateCustomEaDefinition(definition);
  assert.deepEqual(
    definition.map((q) => q.ea?.calculation),
    calculations,
  );
  for (const [index, question] of definition.entries()) {
    assert.ok(question.ea);
    assert.equal(question.dataLabel, parsed[index]?.dataLabel);
    assert.equal(question.caption, parsed[index]?.caption);
    assert.equal(question.ea.sourceColumn, question.dataLabel);
    assert.equal(question.ea.eligibleQuestion, undefined);
    if (question.ea.calculation === "multi") {
      assert.deepEqual(
        question.options?.map((o) => [o.Id, o.SourceColumn]),
        parsed[index]?.options?.map((o) => [
          o.Id,
          `${question.dataLabel}. ${o.Id}`,
        ]),
      );
    }
  }
  assert.deepEqual(
    await parseSurveyDefinition(
      await service.downloadEmployerAssessment(principal, "ad-2026"),
      "EA",
    ),
    definition.map(({ options, ...question }) =>
      options?.length ? { ...question, options } : question,
    ),
  );

  const ptoPolicy = "q_OrganizationalBenefits_AdditionalPtoPolicies";
  const bonus = "q_OrganizationalBenefits_BonusIncentive";
  const career = "q_TrainingandCareerDevelopment_EmplyProfDevCarerAd";
  const holidays = "q_OrganizationalBenefits_NumberPaidHolidays";
  const policyAnswer = parsed.find((q) => q.dataLabel === ptoPolicy)
    ?.options?.[0];
  assert.ok(policyAnswer);
  const organizations = ["a", "b", "c", "d", "e"];
  const report = generateCustomEaReport({
    definition,
    cohorts: [
      { title: "All", type: "All_All", organizationIds: organizations },
    ],
    answers: organizations.map((organizationId, index) => ({
      organizationId,
      values: {
        [`${ptoPolicy}. ${policyAnswer.Id}`]: index < 2 ? 1 : null,
        [bonus]: index < 3 ? 1 : 2,
        [career]: index < 4 ? 1 : 2,
        [holidays]: index === 0 ? 0 : 10,
      },
    })),
  });
  const questions = report.sections.flatMap((s) => s.questions);
  const value = (key: string) =>
    questions.find(
      (q) => q.text === parsed.find((p) => p.dataLabel === key)?.caption,
    )?.responses[0]?.dataValues[0];
  assert.equal(value(ptoPolicy), 40);
  assert.equal(value(bonus), 60);
  assert.equal(value(career), 80);
  assert.equal(value(holidays), 8);
});

test("automatic AD support still rejects unknown questions without explicit mappings", () => {
  const definition: SurveyDefinition = [
    {
      dataLabel: "q_OrganizationalBenefits_UnknownPolicy",
      caption: "Unknown policy",
      options: [{ Id: "Yes", Caption: "Yes", Position: 1 }],
    },
  ];
  assert.throws(
    () => normalizeEmployerAssessmentDefinition(definition, []),
    /add calculation and source_column/u,
  );
});
