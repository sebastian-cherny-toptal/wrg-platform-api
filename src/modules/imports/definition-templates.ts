import { BadRequestException } from "@nestjs/common";
import { createHash } from "node:crypto";
import { basename } from "node:path";
import efsV1 from "./templates/v1/efs.json" with { type: "json" };
import eaV1 from "./templates/v1/ea.json" with { type: "json" };
import type { SurveyDefinition } from "./survey-definition.js";

export const CURRENT_DEFINITION_VERSION = "v1";
export type DefinitionKind = "EFS" | "EA";
export interface DefinitionFile {
  [key: string]: string;
  fileName: string;
  sha256: string;
  /** Original workbook, retained durably with the program, not in import staging. */
  contentBase64: string;
}

/** Released catalogs are immutable. Add a new version rather than editing v1. */
export function defaultDefinition(
  kind: DefinitionKind,
  version = CURRENT_DEFINITION_VERSION,
): SurveyDefinition {
  if (version !== "v1")
    throw new BadRequestException(
      `Unknown ${kind} definition template ${version}`,
    );
  return structuredClone((kind === "EFS" ? efsV1 : eaV1) as SurveyDefinition);
}

export function definitionFile(
  filename: string,
  buffer: Buffer,
): DefinitionFile {
  return {
    fileName: basename(filename),
    sha256: createHash("sha256").update(buffer).digest("hex"),
    contentBase64: buffer.toString("base64"),
  };
}

export function definitionVersion(
  metadata: Record<string, unknown>,
  kind: DefinitionKind,
): string {
  const key =
    kind === "EFS"
      ? "surveyDefinitionVersion"
      : "employerAssessmentDefinitionVersion";
  const version = metadata[key];
  return typeof version === "string" ? version : CURRENT_DEFINITION_VERSION;
}

/** A saved snapshot wins over the catalog so releases never rewrite a program. */
export function programDefinition(
  metadata: Record<string, unknown>,
  kind: DefinitionKind,
): SurveyDefinition {
  if (kind === "EA") {
    const report = metadata.employerAssessmentReportDefinition;
    if (
      report &&
      typeof report === "object" &&
      "questions" in report &&
      Array.isArray(report.questions)
    )
      return structuredClone(report.questions as SurveyDefinition);
  }
  const saved =
    metadata[
      kind === "EFS" ? "surveyDefinition" : "employerAssessmentDefinition"
    ];
  return Array.isArray(saved)
    ? structuredClone(saved as SurveyDefinition)
    : defaultDefinition(kind, definitionVersion(metadata, kind));
}
