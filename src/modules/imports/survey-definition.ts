import { BadRequestException } from "@nestjs/common";
import type { Prisma } from "@prisma/client";
import ExcelJS from "exceljs";
import { cellScalar, xlsxResponseValue } from "./xlsx-survey-importer.js";

export interface SurveyDefinitionQuestion {
  dataLabel: string;
  caption: string;
  type?: string;
  position?: number;
  categoryLabel?: string;
  /** EA-only calculation contract. Absent on legacy label overrides and EFS. */
  ea?: {
    calculation: "yesNo" | "choice" | "multi" | "mean";
    sourceColumn: string;
    format: "number" | "percent";
    /** Reusable catalogs may omit questions/answer columns absent from a program. */
    missingSource?: "skip";
    groupKey?: string;
    groupLabel?: string;
    eligibleQuestion?: string;
    eligibleValue?: string;
  };
  options?: Array<{
    Id: string;
    Caption: string;
    Position: number;
    Score?: number;
    SourceColumn?: string;
  }>;
}

export type SurveyDefinition = SurveyDefinitionQuestion[];

export function mergeSurveyDefinitions(
  previous: SurveyDefinition | undefined,
  next: SurveyDefinition,
): SurveyDefinition {
  const definitions = new Map(
    (previous ?? []).map((item) => [item.dataLabel, item]),
  );
  for (const item of next)
    definitions.set(item.dataLabel, {
      ...definitions.get(item.dataLabel),
      ...item,
    });
  return [...definitions.values()];
}

/** Parse a program-owned definition, enforcing explicit EA presentation fields. */
export async function parseSurveyDefinition(
  buffer: Buffer,
  kind: "EFS" | "EA" = "EFS",
): Promise<SurveyDefinition> {
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);
  } catch {
    throw new BadRequestException(
      "Unable to read the survey definition workbook",
    );
  }
  const rows = (name: string, required: string[]) => {
    const sheet = workbook.worksheets.find(
      (item) => item.name.toLowerCase() === name.toLowerCase(),
    );
    if (!sheet)
      throw new BadRequestException(
        `Survey definition requires a ${name} sheet`,
      );
    if (sheet.rowCount > 10_000)
      throw new BadRequestException(`${name} exceeds 10,000 rows`);
    const columns = new Map<string, number>();
    sheet.getRow(1).eachCell((cell, column) => {
      columns.set(
        String(cellScalar(cell.value) ?? "")
          .trim()
          .toLowerCase(),
        column,
      );
    });
    for (const field of required) {
      if (!columns.has(field))
        throw new BadRequestException(`${name} requires ${field}`);
    }
    return Array.from(
      { length: Math.max(0, sheet.rowCount - 1) },
      (_, index) => {
        const row = sheet.getRow(index + 2);
        const get = (field: string) => {
          const column = columns.get(field);
          const value = column ? row.getCell(column).value : null;
          if (
            value &&
            typeof value === "object" &&
            ("formula" in value || "sharedFormula" in value)
          ) {
            throw new BadRequestException(
              `${name} row ${row.number}: formulas are not supported`,
            );
          }
          return value;
        };
        const text = (field: string) =>
          String(cellScalar(get(field)) ?? "").trim();
        const number = (field: string) => {
          const value = text(field);
          if (!value) return undefined;
          const result = Number(value);
          if (!Number.isFinite(result))
            throw new BadRequestException(
              `${name} row ${row.number}: invalid ${field}`,
            );
          return result;
        };
        return { get, text, number, row: row.number };
      },
    ).filter(({ text }) => required.some((field) => text(field)));
  };
  const questions = new Map<string, SurveyDefinitionQuestion>();
  for (const row of rows("Questions", [
    "question_key",
    "question_label",
    ...(kind === "EA" ? ["category", "display_order"] : []),
  ])) {
    const dataLabel = row.text("question_key");
    const caption = row.text("question_label");
    if (!dataLabel || !caption)
      throw new BadRequestException(
        `Questions row ${row.row}: question_key and question_label are required`,
      );
    if (questions.has(dataLabel))
      throw new BadRequestException(`Duplicate question_key: ${dataLabel}`);
    const type = row.text("question_type").toLowerCase();
    if (
      type &&
      !["likert", "demographic", "choice", "open-text", "text"].includes(type)
    ) {
      throw new BadRequestException(
        `Questions row ${row.row}: invalid question_type`,
      );
    }
    if (kind === "EA") {
      for (const field of ["category", "display_order"])
        if (!row.text(field))
          throw new BadRequestException(
            `Questions row ${row.row}: ${field} is required`,
          );
    }
    const position = row.number("display_order");
    const calculation = row.text("calculation");
    if (
      calculation &&
      !["yesNo", "choice", "multi", "mean"].includes(calculation)
    )
      throw new BadRequestException(
        `Questions row ${row.row}: invalid calculation`,
      );
    if (calculation && !row.text("source_column"))
      throw new BadRequestException(
        `Questions row ${row.row}: source_column is required`,
      );
    const format = row.text("output_format");
    const missingSource = row.text("missing_source");
    if (missingSource && !["error", "skip"].includes(missingSource))
      throw new BadRequestException(
        `Questions row ${row.row}: missing_source must be error or skip`,
      );
    if (missingSource && !calculation)
      throw new BadRequestException(
        `Questions row ${row.row}: missing_source requires calculation`,
      );
    if (calculation && !["number", "percent"].includes(format))
      throw new BadRequestException(
        `Questions row ${row.row}: output_format must be number or percent`,
      );
    if (row.text("eligible_question") && !row.text("eligible_value"))
      throw new BadRequestException(
        `Questions row ${row.row}: eligible_value is required`,
      );
    if (
      position !== undefined &&
      (!Number.isInteger(position) || position < 1)
    ) {
      throw new BadRequestException(
        `Questions row ${row.row}: display_order must be a positive integer`,
      );
    }
    questions.set(dataLabel, {
      dataLabel,
      caption,
      ...(type ? { type } : {}),
      ...(position !== undefined ? { position } : {}),
      ...(row.text("category") ? { categoryLabel: row.text("category") } : {}),
      ...(calculation
        ? {
            ea: {
              calculation: calculation as NonNullable<
                SurveyDefinitionQuestion["ea"]
              >["calculation"],
              sourceColumn: row.text("source_column"),
              format: format as "number" | "percent",
              ...(missingSource === "skip"
                ? { missingSource: "skip" as const }
                : {}),
              ...(row.text("group_key")
                ? { groupKey: row.text("group_key") }
                : {}),
              ...(row.text("group_label")
                ? { groupLabel: row.text("group_label") }
                : {}),
              ...(row.text("eligible_question")
                ? {
                    eligibleQuestion: row.text("eligible_question"),
                    eligibleValue: row.text("eligible_value"),
                  }
                : {}),
            },
          }
        : {}),
    });
  }
  if (!questions.size)
    throw new BadRequestException(
      "Questions sheet must contain at least one question",
    );
  for (const row of rows("Answers", [
    "question_key",
    "raw_answer",
    "answer_label",
    ...(kind === "EA" ? ["display_order"] : []),
  ])) {
    const question = questions.get(row.text("question_key"));
    if (!question)
      throw new BadRequestException(
        `Answers row ${row.row}: unknown question_key`,
      );
    const value = xlsxResponseValue(row.get("raw_answer"));
    const caption = row.text("answer_label");
    if (value === null || !caption)
      throw new BadRequestException(
        `Answers row ${row.row}: raw_answer and answer_label are required`,
      );
    const id = String(value);
    question.options ??= [];
    if (question.options.some((option) => option.Id === id))
      throw new BadRequestException(
        `Duplicate answer ${id} for ${question.dataLabel}`,
      );
    if (kind === "EA" && !row.text("display_order"))
      throw new BadRequestException(
        `Answers row ${row.row}: display_order is required`,
      );
    const position = row.number("display_order") ?? question.options.length + 1;
    if (!Number.isInteger(position) || position < 1)
      throw new BadRequestException(
        `Answers row ${row.row}: display_order must be a positive integer`,
      );
    const score = row.number("score");
    if (
      score !== undefined &&
      (!Number.isInteger(score) || score < 1 || score > 6)
    ) {
      throw new BadRequestException(
        `Answers row ${row.row}: score must be 1–5, or 6 for N/A`,
      );
    }
    question.options.push({
      Id: id,
      Caption: caption,
      Position: position,
      ...(score !== undefined ? { Score: score } : {}),
      ...(row.text("source_column")
        ? { SourceColumn: row.text("source_column") }
        : {}),
    });
  }
  for (const question of questions.values())
    question.options?.sort((a, b) => a.Position - b.Position);
  return [...questions.values()];
}

export function applySurveyDefinition<
  T extends {
    dataLabel: string;
    caption: string;
    type: string;
    position?: number;
    metadata?: Prisma.JsonValue;
  },
>(question: T, definition: SurveyDefinition | undefined): T {
  const configured = definition?.find(
    (item) => item.dataLabel === question.dataLabel,
  );
  if (!configured) return question;
  const metadata =
    question.metadata &&
    typeof question.metadata === "object" &&
    !Array.isArray(question.metadata)
      ? question.metadata
      : {};
  const rawType = (configured.type ?? question.type).trim().toLowerCase();
  const type = ["5", "scale", "rating", "agreement"].includes(rawType)
    ? "likert"
    : ["2", "3"].includes(rawType)
      ? "demographic"
      : rawType === "9"
        ? "open-text"
        : rawType;
  if (type === "likert" && configured.options) {
    if (new Set(configured.options.map(({ Caption }) => Caption)).size > 6) {
      throw new BadRequestException(
        `${question.dataLabel}: Likert questions support up to six labels (including N/A)`,
      );
    }
    for (const option of configured.options) {
      const score = Number(option.Score ?? option.Id);
      if (
        !Number.isInteger(score) ||
        !((score >= 1 && score <= 6) || score === 99)
      ) {
        throw new BadRequestException(
          `${question.dataLabel}: answer ${option.Id} requires a score (1–5, or 6 for N/A)`,
        );
      }
    }
  }
  return {
    ...question,
    caption: configured.caption,
    type,
    ...(type === "demographic" ? { filterLabel: configured.caption } : {}),
    ...(configured.position !== undefined
      ? { position: configured.position }
      : {}),
    metadata: {
      ...metadata,
      surveyDefinition: true,
      QuestionTypeId:
        type === "likert"
          ? 5
          : type === "demographic"
            ? 2
            : type.includes("text")
              ? 9
              : 1,
      reportRole:
        type === "likert"
          ? "core"
          : type === "demographic"
            ? "demographic"
            : type === "open-text"
              ? "verbatim"
              : "other",
      ...(type === "demographic" ? { filterLabel: configured.caption } : {}),
      ...(configured.categoryLabel
        ? { categoryLabel: configured.categoryLabel }
        : {}),
      ...(configured.options
        ? {
            QuestionResponses: configured.options,
            surveyDefinitionAnswers: true,
          }
        : {}),
    },
  };
}

export function rawSurveyAnswer(value: Prisma.JsonValue): Prisma.JsonValue {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value.ResponseId ??
        value.responseId ??
        value.Value ??
        value.value ??
        value.Code ??
        value.code ??
        value.ResponseCaption ??
        value.responseCaption ??
        value.caption ??
        null)
    : value;
}

export function definitionAnswer(
  value: Prisma.JsonValue,
  metadata: Prisma.JsonValue,
): Prisma.JsonObject | undefined {
  if (
    !metadata ||
    typeof metadata !== "object" ||
    Array.isArray(metadata) ||
    !metadata.surveyDefinitionAnswers
  )
    return undefined;
  const raw = rawSurveyAnswer(value);
  const options = metadata.QuestionResponses;
  if (!Array.isArray(options)) return undefined;
  const objects = options.filter((option): option is Prisma.JsonObject =>
    Boolean(option && typeof option === "object" && !Array.isArray(option)),
  );
  return (
    objects.find((option) => String(option.Id) === String(raw)) ??
    objects.find((option) => String(option.Caption) === String(raw))
  );
}
