import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { PrismaService } from "../../database/prisma.service.js";
import type { Principal } from "../auth/auth.module.js";
import {
  demographicResponsePosition,
  reportResponseCaption,
  responseDetailOptions,
  surveyQuestionLabel,
  type BenchmarkQuestion,
} from "../reports/compatibility-reports.module.js";
import {
  applySurveyDefinition,
  definitionAnswer,
  mergeSurveyDefinitions,
  parseSurveyDefinition,
  rawSurveyAnswer,
  type SurveyDefinition,
  type SurveyDefinitionQuestion,
} from "./survey-definition.js";

const employeeSurvey: Prisma.SurveyWhereInput = {
  OR: [
    { metadata: { path: ["kind"], equals: "employee" } },
    { title: { contains: "Employee Feedback", mode: "insensitive" } },
    { externalId: { endsWith: "-efs", mode: "insensitive" } },
    { externalId: { endsWith: ":efs", mode: "insensitive" } },
  ],
};

const excludedSurveyDefinitionKeys = new Set([
  "126. Company Size",
  "127. Sample size",
]);

function object(value: Prisma.JsonValue | undefined): Prisma.JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function questionType(type: string): string {
  const normalized = type.toLowerCase();
  if (["5", "likert", "agreement", "scale", "rating"].includes(normalized))
    return "likert";
  if (["2", "3", "demographic"].includes(normalized)) return "demographic";
  if (["9", "open-text"].includes(normalized)) return "open-text";
  return normalized === "text" ? "text" : "choice";
}

/** Resolve options through the report's existing metadata/year-aware defaults. */
function answerOptions(
  question: BenchmarkQuestion,
  year: number | null,
  values: Prisma.JsonValue[],
): NonNullable<SurveyDefinitionQuestion["options"]> {
  const type = questionType(question.type);
  if (type === "text" || type === "open-text") return [];
  const metadata = object(question.metadata);
  const candidates = new Map<string, Prisma.JsonObject>();
  const add = (value: Prisma.JsonValue, option: Prisma.JsonObject = {}) => {
    const raw = rawSurveyAnswer(value);
    if (raw === null || typeof raw === "object" || String(raw).trim() === "")
      return;
    const key = String(raw);
    candidates.set(key, { ...candidates.get(key), ...option });
  };
  for (const field of [
    "QuestionResponses",
    "questionResponses",
    "responseOptions",
    "options",
  ]) {
    const source = metadata[field];
    if (Array.isArray(source)) {
      source.forEach((item, index) => {
        const option = object(item);
        add(
          option.Id ??
            option.id ??
            option.ResponseId ??
            option.responseId ??
            option.Value ??
            option.value ??
            option.Code ??
            option.code ??
            index + 1,
          { Position: index + 1, ...option },
        );
      });
    } else if (source && typeof source === "object") {
      for (const key of Object.keys(source)) add(key);
    }
    if (candidates.size) break;
  }
  if (!metadata.surveyDefinitionAnswers) {
    if (type === "likert") {
      for (const value of [1, 2, 3, 4, 5, 6, 99]) add(value);
    } else if (type === "demographic") {
      for (let value = 1; value <= 100; value++) {
        if (reportResponseCaption(value, question, year) === String(value))
          break;
        add(value);
      }
    }
  }
  for (const value of values) add(value);
  const options = [...candidates].flatMap(([Id, source], index) => {
    const Caption = reportResponseCaption(Id, question, year);
    if (!Caption) return [];
    const configured = definitionAnswer(Id, question.metadata);
    const configuredScore = Number(
      source.Score ?? configured?.Score ?? configured?.Id ?? Id,
    );
    const Score =
      type === "likert"
        ? Number.isInteger(configuredScore) &&
          ((configuredScore >= 1 && configuredScore <= 6) ||
            configuredScore === 99)
          ? configuredScore === 99
            ? 6
            : configuredScore
          : responseDetailOptions.indexOf(
              Caption as (typeof responseDetailOptions)[number],
            ) + 1
        : undefined;
    if (Score === 0)
      throw new BadRequestException(
        `${question.dataLabel}: answer ${Id} has no exportable Likert score`,
      );
    const order = Number(source.Position ?? source.position);
    const fallback =
      type === "likert"
        ? Score
        : demographicResponsePosition(Caption, question, year);
    const Position =
      Number.isInteger(order) && order > 0
        ? order
        : fallback && fallback !== Number.MAX_SAFE_INTEGER
          ? fallback
          : index + 1;
    return [
      { Id, Caption, Position, ...(Score !== undefined ? { Score } : {}) },
    ];
  });
  return options.sort(
    (a, b) =>
      a.Position - b.Position ||
      a.Id.localeCompare(b.Id, undefined, { numeric: true }),
  );
}

export function effectiveSurveyDefinition(
  questions: BenchmarkQuestion[],
  year: number | null,
  responses: Array<{ questionId: string; value: Prisma.JsonValue }>,
): SurveyDefinition {
  return questions.map((question) => {
    const options = answerOptions(
      question,
      year,
      responses
        .filter((response) => response.questionId === question.id)
        .map(({ value }) => value),
    );
    const metadata = object(question.metadata);
    const categoryLabel =
      typeof metadata.categoryLabel === "string"
        ? metadata.categoryLabel
        : undefined;
    return {
      dataLabel: question.dataLabel,
      caption: surveyQuestionLabel(question),
      type: questionType(question.type),
      position: question.position,
      ...(categoryLabel ? { categoryLabel } : {}),
      ...(options.length ? { options } : {}),
    };
  });
}

export async function surveyDefinitionWorkbook(
  definition: SurveyDefinition,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  const questions = workbook.addWorksheet("Questions");
  questions.addRow([
    "question_key",
    "question_label",
    "question_type",
    "category",
    "display_order",
  ]);
  const answers = workbook.addWorksheet("Answers");
  answers.addRow([
    "question_key",
    "raw_answer",
    "answer_label",
    "display_order",
    "score",
  ]);
  for (const question of definition) {
    if (excludedSurveyDefinitionKeys.has(question.dataLabel)) continue;
    questions.addRow([
      question.dataLabel,
      question.caption,
      question.type,
      question.categoryLabel,
      question.position,
    ]);
    for (const option of question.options ?? [])
      answers.addRow([
        question.dataLabel,
        option.Id,
        option.Caption,
        option.Position,
        option.Score,
      ]);
  }
  for (const sheet of [questions, answers]) {
    sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
    sheet.autoFilter = `A1:E${sheet.rowCount}`;
    sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    sheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF273E5A" },
    };
    sheet.columns.forEach((column, index) => {
      column.width =
        [
          65,
          sheet === questions ? 95 : 18,
          sheet === questions ? 18 : 70,
          35,
          18,
        ][index] ?? 18;
    });
    sheet.getColumn(sheet === questions ? 2 : 3).alignment = {
      wrapText: true,
      vertical: "middle",
    };
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

@Injectable()
export class ProgramSurveyDefinitionService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private assertAccess(principal: Principal, writing = false) {
    if (
      principal.roles.some(
        (role) => role === "admin" || role === "super_admin",
      ) ||
      principal.permissions.includes("ops.manage")
    )
      return;
    if (
      !writing &&
      principal.permissions.includes("clientsProjectsProgramsAccess")
    )
      return;
    throw new ForbiddenException("Access denied");
  }

  private async program(db: Prisma.TransactionClient, reference: string) {
    const program = await db.program.findFirst({
      where: {
        OR: [
          ...(/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
            reference,
          )
            ? [{ id: reference }]
            : []),
          { legacyId: reference },
          { externalId: reference },
        ],
      },
      select: { id: true, year: true, metadata: true },
    });
    if (!program) throw new NotFoundException("Program not found");
    return program;
  }

  private responses(
    db: Prisma.TransactionClient,
    questions: BenchmarkQuestion[],
  ) {
    const ids = questions
      .filter(
        (question) =>
          !["text", "open-text"].includes(questionType(question.type)) ||
          Boolean(object(question.metadata).surveyDefinitionAnswers),
      )
      .map(({ id }) => id);
    return ids.length
      ? db.response.groupBy({
          by: ["questionId", "value"],
          where: { questionId: { in: ids } },
        })
      : Promise.resolve([]);
  }

  async download(principal: Principal, reference: string): Promise<Buffer> {
    this.assertAccess(principal);
    const program = await this.program(this.prisma, reference);
    const survey = await this.prisma.survey.findFirst({
      where: { programId: program.id, ...employeeSurvey },
      orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }],
      include: {
        questions: { orderBy: [{ position: "asc" }, { dataLabel: "asc" }] },
      },
    });
    if (!survey?.questions.length)
      throw new BadRequestException(
        "This program has no imported EFS questions. Import EFS first.",
      );
    const definition = effectiveSurveyDefinition(
      survey.questions,
      program.year,
      await this.responses(this.prisma, survey.questions),
    );
    return surveyDefinitionWorkbook(definition);
  }

  async upload(
    principal: Principal,
    reference: string,
    filename: string,
    buffer: Buffer,
  ) {
    this.assertAccess(principal, true);
    if (
      !filename.toLowerCase().endsWith(".xlsx") ||
      !buffer.length ||
      buffer.length > 25 * 1024 * 1024
    )
      throw new BadRequestException("Upload an XLSX file up to 25 MB");
    const uploaded = await parseSurveyDefinition(buffer);
    return this.prisma.$transaction(
      async (db) => {
        const program = await this.program(db, reference);
        const questions = await db.question.findMany({
          where: {
            dataLabel: { in: uploaded.map(({ dataLabel }) => dataLabel) },
            survey: { programId: program.id, ...employeeSurvey },
          },
          orderBy: [{ position: "asc" }, { dataLabel: "asc" }],
        });
        const issues: string[] = [];
        for (const configured of uploaded) {
          if (
            !questions.some(
              ({ dataLabel }) => dataLabel === configured.dataLabel,
            )
          )
            issues.push(
              `Question not found in this program's EFS: ${configured.dataLabel}. Import EFS first to add previously excluded columns.`,
            );
        }
        const previous = object(program.metadata).surveyDefinition;
        const definition = mergeSurveyDefinitions(
          Array.isArray(previous)
            ? (previous as unknown as SurveyDefinition)
            : undefined,
          uploaded,
        );
        const mapped = questions.map((question) =>
          applySurveyDefinition(question, definition),
        );
        const responses = await this.responses(db, mapped);
        for (const response of responses) {
          const question = mapped.find(({ id }) => id === response.questionId);
          const raw = rawSurveyAnswer(response.value);
          if (
            question &&
            raw !== null &&
            String(raw).trim() !== "" &&
            object(question.metadata).surveyDefinitionAnswers &&
            !definitionAnswer(response.value, question.metadata)
          )
            issues.push(
              `Unmapped answer ${String(raw)} for ${question.dataLabel}`,
            );
        }
        if (issues.length)
          throw new BadRequestException(issues.slice(0, 100).join("\n"));
        const current = effectiveSurveyDefinition(
          questions,
          program.year,
          responses,
        );
        if (JSON.stringify(current) === JSON.stringify(uploaded))
          return { updatedQuestions: 0, unchanged: true };
        for (const question of mapped)
          await db.question.update({
            where: { id: question.id },
            data: {
              caption: question.caption,
              type: question.type,
              position: question.position,
              metadata: question.metadata as Prisma.InputJsonValue,
            },
          });
        await db.program.update({
          where: { id: program.id },
          data: {
            metadata: {
              ...object(program.metadata),
              surveyDefinition: JSON.parse(
                JSON.stringify(definition),
              ) as Prisma.InputJsonValue,
              surveyDefinitionFile: {
                fileName: basename(filename),
                sha256: createHash("sha256").update(buffer).digest("hex"),
                uploadedAt: new Date().toISOString(),
              },
            },
          },
        });
        return { updatedQuestions: mapped.length, unchanged: false };
      },
      { timeout: 30_000 },
    );
  }
}
