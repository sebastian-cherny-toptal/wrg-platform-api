import {
  eaDefinitionMetadata,
  isCustomEaDefinition,
  normalizeEmployerAssessmentDefinition,
  validateCustomEaSources,
} from "../reports/custom-ea-report.js";
import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
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
  parseSurveyDefinition,
  rawSurveyAnswer,
  type SurveyDefinition,
  type SurveyDefinitionQuestion,
} from "./survey-definition.js";
import { isExcludedSurveyQuestion } from "./xlsx-survey-importer.js";
import {
  defaultDefinition,
  programDefinition,
  definitionFile,
} from "./definition-templates.js";
import {
  loadDefaultBenefitsBestPracticesDefinition,
  validateBenefitsBestPracticesDefinition,
} from "../reports/benefits-best-practices-from-ea.js";

const employeeSurvey: Prisma.SurveyWhereInput = {
  OR: [
    { metadata: { path: ["kind"], equals: "employee" } },
    { title: { contains: "Employee Feedback", mode: "insensitive" } },
    { externalId: { endsWith: "-efs", mode: "insensitive" } },
    { externalId: { endsWith: ":efs", mode: "insensitive" } },
  ],
};

export function loadDefaultSurveyDefinition(): Promise<SurveyDefinition> {
  return Promise.resolve(defaultDefinition("EFS"));
}

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
  defaults?: SurveyDefinitionQuestion,
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
  if (metadata.surveyDefinitionAnswers) {
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
  } else {
    for (const option of defaults?.options ?? []) add(option.Id, option);
  }
  if (!metadata.surveyDefinitionAnswers && !defaults?.options?.length) {
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
  const captionQuestion = metadata.surveyDefinitionAnswers
    ? question
    : { ...question, metadata: {} };
  const options = [...candidates].flatMap(([Id, source], index) => {
    const defaultCaption = defaults?.options?.find(
      (option) => option.Id === Id,
    )?.Caption;
    const Caption =
      defaultCaption ?? reportResponseCaption(Id, captionQuestion, year);
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
        : demographicResponsePosition(Caption, captionQuestion, year);
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
  defaults: SurveyDefinition = [],
): SurveyDefinition {
  const defaultsByKey = new Map(
    defaults.map((definition) => [definition.dataLabel, definition]),
  );
  return questions.map((question) => {
    const metadata = object(question.metadata);
    const defaultQuestion = defaultsByKey.get(question.dataLabel);
    const useDefaults = !metadata.surveyDefinition && defaultQuestion;
    const effectiveQuestion = useDefaults
      ? {
          ...question,
          caption: defaultQuestion.caption || question.caption,
          type: defaultQuestion.type ?? question.type,
          position: defaultQuestion.position ?? question.position,
          metadata: {
            ...metadata,
            ...(defaultQuestion.categoryLabel
              ? { categoryLabel: defaultQuestion.categoryLabel }
              : {}),
          },
        }
      : question;
    const options = answerOptions(
      effectiveQuestion,
      year,
      responses
        .filter((response) => response.questionId === question.id)
        .map(({ value }) => value),
      useDefaults ? defaultQuestion : undefined,
    );
    const effectiveMetadata = object(effectiveQuestion.metadata);
    const categoryLabel =
      typeof effectiveMetadata.categoryLabel === "string"
        ? effectiveMetadata.categoryLabel
        : undefined;
    return {
      dataLabel: effectiveQuestion.dataLabel,
      caption: surveyQuestionLabel(effectiveQuestion),
      type: questionType(effectiveQuestion.type),
      position: effectiveQuestion.position,
      ...(categoryLabel ? { categoryLabel } : {}),
      ...(options.length ? { options } : {}),
    };
  });
}

export async function surveyDefinitionWorkbook(
  definition: SurveyDefinition,
  kind: "EA" | "EFS" = definition.some((q) => q.ea) ? "EA" : "EFS",
  version?: string,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  workbook.subject = `${kind} Definition${version ? ` template ${version}` : ""}`;
  if (version) workbook.keywords = `definition-template:${version}`;
  const questions = workbook.addWorksheet("Questions");
  questions.addRow([
    "question_key",
    "question_label",
    ...(kind === "EFS" ? ["question_type"] : []),
    "category",
    "display_order",
    ...(definition.some((q) => q.ea)
      ? [
          "calculation",
          "source_column",
          "output_format",
          "group_key",
          "group_label",
          "eligible_question",
          "eligible_value",
          "missing_source",
        ]
      : []),
  ]);
  const answers = workbook.addWorksheet("Answers");
  answers.addRow([
    "question_key",
    "raw_answer",
    "answer_label",
    "display_order",
    ...(kind === "EFS" ? ["score"] : []),
    ...(definition.some((q) => q.ea) ? ["source_column"] : []),
  ]);
  for (const question of definition) {
    if (isExcludedSurveyQuestion(question.dataLabel)) continue;
    questions.addRow([
      question.dataLabel,
      question.caption,
      ...(kind === "EFS" ? [question.type] : []),
      question.categoryLabel,
      question.position,
      ...(definition.some((q) => q.ea)
        ? [
            question.ea?.calculation,
            question.ea?.sourceColumn,
            question.ea?.format,
            question.ea?.groupKey,
            question.ea?.groupLabel,
            question.ea?.eligibleQuestion,
            question.ea?.eligibleValue,
            question.ea?.missingSource,
          ]
        : []),
    ]);
    for (const option of question.options ?? [])
      answers.addRow([
        question.dataLabel,
        option.Id,
        option.Caption,
        option.Position,
        ...(kind === "EFS" ? [option.Score] : []),
        ...(definition.some((q) => q.ea) ? [option.SourceColumn] : []),
      ]);
  }
  for (const sheet of [questions, answers]) {
    sheet.views = [{ state: "frozen", ySplit: 1, showGridLines: false }];
    sheet.autoFilter = {
      from: { row: 1, column: 1 },
      to: { row: sheet.rowCount, column: sheet.columnCount },
    };
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
    if (definition.some((q) => q.ea)) {
      // Mapping columns contain export headers, not short answer codes.
      const widths: Record<string, number> = {
        category: 35,
        display_order: 18,
        raw_answer: 80,
        source_column: 100,
        group_key: 65,
        group_label: 50,
        eligible_question: 70,
      };
      sheet.columns.forEach((column, index) => {
        const header = String(sheet.getRow(1).getCell(index + 1).value ?? "");
        column.width = widths[header] ?? column.width ?? 18;
        column.alignment = { wrapText: true, vertical: "middle" };
      });
      sheet.eachRow((row) => {
        let lines = 1;
        row.eachCell((cell, column) => {
          const width = sheet.getColumn(column).width ?? 18;
          lines = Math.max(
            lines,
            Math.ceil(String(cell.value ?? "").length / Math.max(1, width - 3)),
          );
        });
        row.height = Math.max(22, lines * 15);
      });
    }
  }
  return Buffer.from(await workbook.xlsx.writeBuffer());
}

/** Upgrade legacy associations once, retaining a downloadable snapshot for custom definitions. */
export async function pinProgramDefinitions(
  metadata: Prisma.JsonObject,
): Promise<Prisma.JsonObject> {
  const pinned = { ...metadata };
  for (const kind of ["EFS", "EA"] as const) {
    const prefix =
      kind === "EFS" ? "surveyDefinition" : "employerAssessmentDefinition";
    const saved =
      kind === "EFS"
        ? Array.isArray(metadata.surveyDefinition)
        : Array.isArray(metadata.employerAssessmentDefinition) ||
          Boolean(metadata.employerAssessmentReportDefinition);
    const file = object(metadata[`${prefix}File`]);
    const definition = programDefinition(metadata, kind);
    if (saved && !metadata[`${prefix}Version`] && !file.contentBase64) {
      pinned[`${prefix}File`] = {
        ...definitionFile(
          `${kind}_Definition_Snapshot.xlsx`,
          await surveyDefinitionWorkbook(definition, kind),
        ),
      };
      pinned[`${prefix}Version`] = null;
    } else if (!file.contentBase64) {
      pinned[`${prefix}Version`] = metadata[`${prefix}Version`] ?? "v1";
      pinned[`${prefix}File`] = null;
    }
    if (kind === "EA") Object.assign(pinned, eaDefinitionMetadata(definition));
    else
      pinned.surveyDefinition = JSON.parse(
        JSON.stringify(definition),
      ) as Prisma.JsonValue;
  }
  return JSON.parse(JSON.stringify(pinned)) as Prisma.JsonObject;
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
    const pinned = await pinProgramDefinitions(object(program.metadata));
    if (JSON.stringify(pinned) !== JSON.stringify(program.metadata)) {
      await db.program.update({
        where: { id: program.id },
        data: { metadata: pinned },
      });
      program.metadata = pinned;
    }
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

  async downloadCurrent(
    principal: Principal,
    reference: string,
    kind: "EFS" | "EA",
  ) {
    this.assertAccess(principal);
    const program = await this.program(this.prisma, reference);
    const metadata = object(program.metadata);
    const prefix =
      kind === "EFS" ? "surveyDefinition" : "employerAssessmentDefinition";
    const file = object(metadata[`${prefix}File`]);
    if (
      typeof file.contentBase64 === "string" &&
      typeof file.fileName === "string"
    )
      return {
        bytes: Buffer.from(file.contentBase64, "base64"),
        fileName: file.fileName,
      };
    const version =
      typeof metadata[`${prefix}Version`] === "string"
        ? String(metadata[`${prefix}Version`])
        : undefined;
    return {
      bytes: await surveyDefinitionWorkbook(
        programDefinition(metadata, kind),
        kind,
        version,
      ),
      fileName: `${kind}_Definition${version ? `_${version}` : ""}.xlsx`,
    };
  }

  async download(principal: Principal, reference: string): Promise<Buffer> {
    this.assertAccess(principal);
    const program = await this.program(this.prisma, reference);
    return surveyDefinitionWorkbook(
      programDefinition(object(program.metadata), "EFS"),
      "EFS",
      typeof object(program.metadata).surveyDefinitionVersion === "string"
        ? String(object(program.metadata).surveyDefinitionVersion)
        : undefined,
    );
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
        const definition = uploaded;
        const allQuestions = await db.question.findMany({
          where: { survey: { programId: program.id, ...employeeSurvey } },
          orderBy: [{ position: "asc" }, { dataLabel: "asc" }],
        });
        for (const question of allQuestions) {
          if (
            !definition.some(
              ({ dataLabel }) => dataLabel === question.dataLabel,
            )
          )
            issues.push(
              `EFS definition is missing ${question.dataLabel}. Upload the complete definition.`,
            );
        }
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
            definition.find(({ dataLabel }) => dataLabel === question.dataLabel)
              ?.options?.length &&
            !definitionAnswer(response.value, question.metadata)
          )
            issues.push(
              `Unmapped answer ${String(raw)} for ${question.dataLabel}`,
            );
        }
        if (issues.length)
          throw new BadRequestException(issues.slice(0, 100).join("\n"));
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
              surveyDefinitionVersion: null,
              surveyDefinitionFile: definitionFile(filename, buffer),
            },
          },
        });
        return { updatedQuestions: mapped.length, unchanged: false };
      },
      { timeout: 30_000 },
    );
  }

  async downloadEmployerAssessment(
    principal: Principal,
    reference: string,
  ): Promise<Buffer> {
    this.assertAccess(principal);
    const program = await this.program(this.prisma, reference);
    return surveyDefinitionWorkbook(
      programDefinition(object(program.metadata), "EA"),
      "EA",
      typeof object(program.metadata).employerAssessmentDefinitionVersion ===
        "string"
        ? String(object(program.metadata).employerAssessmentDefinitionVersion)
        : undefined,
    );
  }

  async uploadEmployerAssessment(
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
    let uploaded: SurveyDefinition;
    try {
      uploaded = normalizeEmployerAssessmentDefinition(
        await parseSurveyDefinition(buffer, "EA"),
        await loadDefaultBenefitsBestPracticesDefinition(),
      );
      validateBenefitsBestPracticesDefinition(
        uploaded,
        await loadDefaultBenefitsBestPracticesDefinition(),
      );
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : "Invalid EA definition",
      );
    }
    return this.prisma.$transaction(async (db) => {
      const program = await this.program(db, reference);
      const metadata = object(program.metadata);
      const previous = programDefinition(metadata, "EA");
      const definition = uploaded;
      if (isCustomEaDefinition(definition)) {
        const questions = await db.question.findMany({
          where: {
            survey: {
              programId: program.id,
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
          },
          select: { dataLabel: true },
        });
        const issues = validateCustomEaSources(
          definition,
          questions.map((q) => q.dataLabel),
        );
        if (issues.length) throw new BadRequestException(issues.join("; "));
      }
      const unchanged = JSON.stringify(previous) === JSON.stringify(definition);
      await db.program.update({
        where: { id: program.id },
        data: {
          metadata: {
            ...metadata,
            ...(JSON.parse(
              JSON.stringify(eaDefinitionMetadata(definition)),
            ) as Prisma.JsonObject),
            employerAssessmentDefinitionVersion: null,
            employerAssessmentDefinitionFile: definitionFile(filename, buffer),
          },
        },
      });
      return { updatedLabels: uploaded.length, unchanged };
    });
  }
}
