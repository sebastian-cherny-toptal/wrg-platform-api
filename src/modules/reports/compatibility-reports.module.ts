import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Inject,
  Injectable,
  Module,
  NotFoundException,
  Post,
  Query,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiProperty,
  ApiPropertyOptional,
  ApiProduces,
  ApiTags,
} from "@nestjs/swagger";
import { Prisma } from "@prisma/client";
import {
  IsArray,
  IsObject,
  IsOptional,
  IsString,
  MinLength,
} from "class-validator";
import ExcelJS from "exceljs";
import type { FastifyReply } from "fastify";
import { BodyDto } from "../../common/http/body-dto.js";
import { PrismaService } from "../../database/prisma.service.js";
import {
  AuthModule,
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import {
  publishedBenefitsBestPracticesSnapshot,
  type BenefitsBestPracticesSnapshot,
  type PublishedReportHeader,
} from "./benefits-best-practices-workbook.js";
import {
  createAnnualTrendsWorkbook,
  createBenchmarkWorkbook,
  createBenefitsWorkbook,
  createResponseDetailWorkbook,
  createVerbatimWorkbook,
  createWorkforceFeedbackWorkbook,
  type FeedbackWorkbookSection,
  type AnnualTrendsWorkbookValue,
  type ReportWorkbookDemographic,
  type ReportWorkbookMetadata,
  type ResponsePatternRanges,
} from "./report-template-workbooks.js";

const privacyThreshold = 5;
const promotionalPreviewAccess = new Set([
  "WFR_Access",
  "EV_Access",
  "WBC_Access",
  "BBP_Access",
  "RD_Access",
  "KIA_Access",
]);
const clientDemoAccess = new Set(["EV_Access", "RD_Access", "KIA_Access"]);
const dummyResponseDetailSections = [
  {
    Engagement: [
      { QuestionId: "dummy-detail-1", Caption: "I feel valued for the work I contribute." },
      { QuestionId: "dummy-detail-2", Caption: "I would recommend this organization as a great place to work." },
    ],
  },
  {
    Leadership: [
      { QuestionId: "dummy-detail-3", Caption: "Leaders communicate a clear direction for the organization." },
    ],
  },
];
const dummyResponseDetailResult = [
  ["Response", "All employees", "Female", "Male", "Hybrid"],
  ["Strongly Agree", { percentile: "41%", respondentCount: 74 }, { percentile: "45%", respondentCount: 42 }, { percentile: "36%", respondentCount: 29 }, { percentile: "47%", respondentCount: 31 }],
  ["Agree", { percentile: "35%", respondentCount: 63 }, { percentile: "33%", respondentCount: 31 }, { percentile: "38%", respondentCount: 31 }, { percentile: "32%", respondentCount: 21 }],
  ["Neutral", { percentile: "12%", respondentCount: 22 }, { percentile: "11%", respondentCount: 10 }, { percentile: "14%", respondentCount: 11 }, { percentile: "10%", respondentCount: 7 }],
  ["Question Total", { average: "4.8", respondentCount: 180 }, { average: "4.9", respondentCount: 94 }, { average: "4.6", respondentCount: 81 }, { average: "5.0", respondentCount: 66 }],
];
const dummyDemographicOptions = [
  {
    category: "Personal Demographics",
    label: "Gender",
    options: ["Female", "Male", "Non-binary"],
  },
  {
    category: "Personal Demographics",
    label: "Age Generation",
    options: ["Generation Z", "Millennial", "Generation X", "Baby Boomer"],
  },
  {
    category: "Workplace Demographics",
    label: "Employment Length",
    options: [
      "Less than 1 year",
      "1-5 years",
      "6-10 years",
      "More than 10 years",
    ],
  },
  {
    category: "Workplace Demographics",
    label: "Workplace Setting",
    options: ["On-site", "Hybrid", "Remote"],
  },
] as const;
const dummyOpenQuestions = [
  { id: "dummy-open-1", caption: "What do you value most about working here?" },
  {
    id: "dummy-open-2",
    caption: "What is one thing the organization could improve?",
  },
] as const;
const dummyVerbatims = [
  "I appreciate the support from my manager and teammates.",
  "Communication across departments could be more consistent.",
  "The flexibility and opportunities to learn make this a great workplace.",
  "Clearer priorities would help our team work more effectively.",
  "I feel recognized for the work I contribute.",
] as const;

export const defaultKeyImpactContributions = {
  "I understand how my work impacts organizational success": 15.49,
  "I typically feel I make daily progress at work": 14.87,
  "I am part of a team with a common purpose": 13.36,
  "I believe this organization values me": 10.62,
  "This organization treats me with dignity, not as just a number": 9.82,
  "This organization is committed to producing high-quality products/services":
    8.76,
  "This organizations benefits package is satisfactory": 8.17,
  "My share of healthcare costs is reasonable": 6.82,
  "I am kept aware of this organizations financial status": 6.16,
  "I am informed prior to changes that will impact me": 5.95,
} as const;

const defaultKeyImpactCategories: Record<
  keyof typeof defaultKeyImpactContributions,
  string
> = {
  "I understand how my work impacts organizational success": "Your Job",
  "I typically feel I make daily progress at work": "Your Job",
  "I am part of a team with a common purpose": "Your Job",
  "I believe this organization values me": "Your Job",
  "This organization treats me with dignity, not as just a number":
    "Communication and Workplace Culture",
  "This organization is committed to producing high-quality products/services":
    "Communication and Workplace Culture",
  "This organizations benefits package is satisfactory": "Employee Benefits",
  "My share of healthcare costs is reasonable": "Employee Benefits",
  "I am kept aware of this organizations financial status":
    "Communication and Workplace Culture",
  "I am informed prior to changes that will impact me":
    "Communication and Workplace Culture",
};

const defaultKeyImpactReport = Object.entries(defaultKeyImpactContributions).map(
  ([question, percentage]) => ({
    label:
      defaultKeyImpactCategories[
        question as keyof typeof defaultKeyImpactContributions
      ],
    key: question,
    value: percentage / 100,
  }),
);

function randomInteger(minimum: number, maximum: number): number {
  return Math.floor(Math.random() * (maximum - minimum + 1)) + minimum;
}

function randomPercentage(): number {
  return randomInteger(42, 94);
}

function dummyFeedbackSections(): FeedbackWorkbookSection[] {
  return [
    "Core Employee Experience",
    "Your Job",
    "Communication and Workplace Culture",
  ].map((title, sectionIndex) => ({
    title,
    questions: Array.from({ length: 3 }, (_unused, questionIndex) => {
      const agreement = randomInteger(55, 90);
      const neutral = randomInteger(5, Math.min(25, 95 - agreement));
      return {
        text: `Sample survey statement ${sectionIndex * 3 + questionIndex + 1}`,
        agreement,
        neutral,
        disagreement: 100 - agreement - neutral,
      };
    }),
  }));
}

function dummyWorkbookDemographics(): ReportWorkbookDemographic[] {
  return dummyDemographicOptions.map((demographic) => ({
    title: demographic.label,
    groupLabel: demographic.category,
    options: demographic.options.map((label) => ({
      label,
      count: randomInteger(8, 45),
    })),
  }));
}
const winnerColors = { Yes: "#00a46a", No: "#ffc955" } as const;
const headerColors = { Yes: "#0f0", No: "#ff0" } as const;
const winnerTitles = { Yes: "Winners", No: "Non-Winners" } as const;
const categoryOrder = [
  "Core Employee Experience",
  "Your Job",
  "Communication and Workplace",
  "Communication and Workplace Culture",
  "Communication And Workplace",
  "Communication And Workplace Culture",
  "Relationship With Your Manager",
  "Training, Technology And Professional Development",
  "Diversity And Inclusion",
  "Leadership",
  "Leadership of this Organization",
  "Leadership of this Organisation",
  "Leadership Of This Organization",
  "Employee Benefits",
  "Work-Life Balance",
  "Culture and Belonging",
  "Survey Questions",
];
const sizeOrder = [
  "All",
  "Boutique",
  "Small",
  "Medium",
  "Large",
  "Mega",
  "Major",
];

class CategoryDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  category!: string;
}

class ComparisonWithMeDto {
  @ApiPropertyOptional({ type: String, default: "AllYes" })
  @IsOptional()
  @IsString()
  @MinLength(1)
  selectedCategoryOption?: string;
}

class OpenResponsesReportDto {
  @ApiPropertyOptional({
    type: Object,
    additionalProperties: true,
    description: "Optional legacy report filter.",
  })
  @IsOptional()
  @IsObject()
  queryFilter?: Record<string, unknown>;
}

class QueryFilterDto {
  @ApiPropertyOptional({ type: Object, additionalProperties: true })
  @IsOptional()
  @IsObject()
  queryFilter?: Record<string, unknown>;
}

class QuestionRangeDto extends QueryFilterDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  questionRange!: string[];
}

class ProgramBodyDto extends QueryFilterDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  selectedProgramId!: string;
}

class CategoryWithMeDto extends CategoryDto {
  @ApiPropertyOptional({ type: String, default: "AllYes" })
  @IsOptional()
  @IsString()
  selectedCategoryOption?: string;
}

class ResponseDetailQuestionDto {
  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  QuestionId!: string;

  @ApiProperty({ type: String })
  @IsString()
  @MinLength(1)
  filterQuestion!: string;
}

class AnnualTrendDetailDto extends CategoryDto {
  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  curruntYear!: string[];

  @ApiProperty({ type: [String] })
  @IsArray()
  @IsString({ each: true })
  prevYear!: string[];
}

interface ReportQuery {
  selectedProgramId: string;
  organizationId?: string;
  isDummy: boolean;
}

interface ResponsePatternQueryInput {
  patternMode: string | string[] | undefined;
  includePositive: string | string[] | undefined;
  includeNeutral: string | string[] | undefined;
  includeNegative: string | string[] | undefined;
  positiveMin: string | string[] | undefined;
  positiveMax: string | string[] | undefined;
  neutralMin: string | string[] | undefined;
  neutralMax: string | string[] | undefined;
  negativeMin: string | string[] | undefined;
  negativeMax: string | string[] | undefined;
}

interface ReportContext {
  isDummy: boolean;
  organizationId: string;
  enrollmentId: string;
  reportAccess: Prisma.JsonValue;
  enrollmentMetrics: Prisma.JsonValue;
  enrollmentMetadata: Prisma.JsonValue;
  program: {
    id: string;
    projectId: string;
    name: string;
    year: number | null;
    startsAt: Date | null;
    metadata: Prisma.JsonValue;
    project: { id: string; name: string };
  };
  survey: {
    id: string;
    title: string;
    startsAt: Date | null;
    endsAt: Date | null;
  };
  organizationPrograms: Array<{
    organizationId: string;
    isWinner: boolean;
    metrics: Prisma.JsonValue;
    organization: { metadata: Prisma.JsonValue };
  }>;
}

export interface BenchmarkQuestion {
  id: string;
  legacyId: string | null;
  externalId: string | null;
  dataLabel: string;
  caption: string;
  type: string;
  position: number;
  metadata: Prisma.JsonValue;
}

interface AgreementResponse {
  questionId: string;
  value: Prisma.JsonValue;
  score: Prisma.Decimal | null;
  respondent: { organizationId: string | null };
}

export interface DetailedResponse {
  questionId: string;
  value: Prisma.JsonValue;
  score: Prisma.Decimal | null;
  question: {
    id: string;
    legacyId: string | null;
    externalId: string | null;
    dataLabel: string;
    caption: string;
    type: string;
    position: number;
    metadata: Prisma.JsonValue;
  };
}

export interface DetailedRespondent {
  id: string;
  legacyId: string | null;
  externalId: string | null;
  metadata: Prisma.JsonValue;
  responses: DetailedResponse[];
}

interface BenchmarkGroup {
  key: string;
  size: string;
  winner: "Yes" | "No";
  organizationIds: string[];
  hidden: boolean;
}

interface PublishedWorkforceSnapshot {
  categories: Array<{
    dataValues: Array<number | string>;
    questions: Array<{ dataValues: Array<number | string>; text: string }>;
    title: string;
  }>;
  headers: PublishedReportHeader[];
  sourceFile: string;
  surveyAverage: Array<number | string>;
}

function isUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(
    value,
  );
}

function jsonObject(value: Prisma.JsonValue): Prisma.JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function metadataString(
  value: Prisma.JsonValue,
  ...keys: string[]
): string | null {
  const metadata = jsonObject(value);
  for (const key of keys) {
    const candidate = metadata[key];
    if (typeof candidate === "string" && candidate.trim()) {
      return candidate.trim();
    }
  }
  return null;
}

function scalarQuery(
  name: string,
  value: string | string[] | undefined,
  required = false,
): string | undefined {
  if (Array.isArray(value)) {
    throw new BadRequestException(`${name} must not be repeated`);
  }
  const normalized = value?.trim();
  if (required && !normalized) {
    throw new BadRequestException(
      name === "selectedProgramId"
        ? "Please select a ProgramId"
        : `${name} is required`,
    );
  }
  return normalized === "" ? undefined : normalized;
}

function categoryFromDataLabel(dataLabel: string): string {
  const segment = dataLabel.split("_")[1] ?? "SurveyQuestions";
  return segment
    .replace(/\d+$/u, "")
    .replace(/([a-z])([A-Z])/gu, "$1 $2")
    .replace(/\s+/gu, " ")
    .trim();
}

function sortedCategories(categories: Iterable<string>): string[] {
  return [...new Set(categories)].sort((left, right) => {
    const leftIndex = categoryOrder.indexOf(left);
    const rightIndex = categoryOrder.indexOf(right);
    if (leftIndex !== -1 || rightIndex !== -1) {
      return (
        (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
        (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex)
      );
    }
    return left.localeCompare(right);
  });
}

function responseCaption(value: Prisma.JsonValue): string | null {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  if (value === null || Array.isArray(value)) return null;
  for (const key of [
    "ResponseCaption",
    "responseCaption",
    "caption",
    "value",
    "Value",
  ]) {
    const candidate = value[key];
    if (
      typeof candidate === "string" ||
      typeof candidate === "number" ||
      typeof candidate === "boolean"
    ) {
      return String(candidate).trim();
    }
  }
  return null;
}

const standardDemographicOptions: Record<string, string[]> = {
  f_personaldemographics_agegeneration: [
    "The Silent Generation (Born 1928 to 1945)",
    "Baby Boomers (Born 1946 to 1964)",
    "Generation X (Born 1965 to 1980)",
    "Millennials (Born 1981 to 1996)",
    "Generation Z (Born 1997 or later)",
    "Prefer not to answer",
  ],
  f_personaldemographics_gender: [
    "Female",
    "Male",
    "Non-Binary",
    "Prefer not to answer",
  ],
  f_personaldemographics_education: [
    "Some High School",
    "High School Graduate (includes equivalency)",
    "Vocational Training",
    "Some College",
    "Associate Degree",
    "Bachelor's Degree",
    "Master's or Professional Degree",
    "Other",
    "Prefer not to answer",
  ],
  f_workplacedemographics_employmentlength: [
    "Less than one year",
    "One year to less than two years",
    "Two years to less than five years",
    "Five years to less than ten years",
    "Ten years or more",
    "Prefer not to answer",
  ],
  f_workplacedemographics_jobstatus: [
    "Full-Time",
    "Part-Time",
    "Prefer not to answer",
  ],
  f_workplacedemographics_workplacesetting: [
    "Fully on-site",
    "Hybrid (a blend of on-site and remote)",
    "Fully remote",
    "Prefer not to answer",
  ],
  f_workplacedemographics_joblevel: [
    "CEO/President/Owner",
    "Sr. Executive (COO, CFO, CHRO, VP, Dir., etc.)",
    "Department Manager/Supervisor",
    "Production/Service",
    "Professional/Salesperson/Analyst/Technician",
    "Administrative/Clerical",
    "Other",
    "Prefer not to answer",
  ],
  f_workplacedemographics_department: [
    "Administration/Management",
    "Business Development/Sales",
    "Customer Service/Care/Support",
    "Finance/Accounting",
    "Human Resources",
    "Information Technology",
    "Public Relations/Marketing",
    "Maintenance/Operations",
    "Production",
    "Other",
    "Prefer not to answer",
  ],
};

function demographicGroupFromDataLabel(dataLabel: string): string {
  const normalized = dataLabel.trim().toLowerCase();
  const groups: Array<[string, string]> = [
    ["gender", "Gender"],
    ["agegeneration", "Age Generation"],
    ["ethnicorigin", "Race/Ethnicity"],
    ["race", "Race/Ethnicity"],
    ["employmentlength", "Employment Length"],
    ["jobstatus", "Job Status"],
    ["workplacesetting", "Workplace Setting"],
    ["joblevel", "Job Level"],
    ["department", "Department"],
  ];
  return groups.find(([key]) => normalized.includes(key))?.[1] ?? dataLabel;
}

const legacyEthnicityOptions = [
  "Asian",
  "Bi-Racial or Multi-Racial",
  "Black or African American",
  "Hispanic or Latino",
  "Native American (not Pacific Islander)",
  "Pacific Islander",
  "White or Caucasian",
  "Other",
  "Prefer not to answer",
];

const currentEthnicityOptions = [
  "American Indian or Alaska Native",
  "Asian",
  "Black or African American",
  "Hispanic or Latino",
  "Middle Eastern or North African",
  "Multiracial and/or Multiethnic",
  "Native Hawaiian or Pacific Islander",
  "White",
  "Other",
  "Prefer not to answer",
];

function optionScalar(value: Prisma.JsonValue | undefined): string | null {
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return String(value).trim();
  }
  return null;
}

function metadataResponseCaption(
  rawCaption: string,
  metadata: Prisma.JsonValue,
): string | null {
  const source = jsonObject(metadata);
  for (const field of [
    "QuestionResponses",
    "questionResponses",
    "responseOptions",
    "options",
  ]) {
    const configured = source[field];
    if (
      configured &&
      typeof configured === "object" &&
      !Array.isArray(configured)
    ) {
      const direct = optionScalar(configured[rawCaption]);
      if (direct) return direct;
    }
    if (!Array.isArray(configured)) continue;
    for (const [index, item] of configured.entries()) {
      const scalarItem = optionScalar(item);
      if (scalarItem && rawCaption === String(index + 1)) return scalarItem;
      if (item === null || typeof item !== "object" || Array.isArray(item)) {
        continue;
      }
      const identifiers = [
        "Id",
        "id",
        "ResponseId",
        "responseId",
        "Value",
        "value",
        "Code",
        "code",
      ]
        .map((key) => optionScalar(item[key]))
        .filter((candidate): candidate is string => Boolean(candidate));
      if (
        identifiers.length > 0
          ? !identifiers.includes(rawCaption)
          : rawCaption !== String(index + 1)
      ) {
        continue;
      }
      const caption = ["Caption", "caption", "Label", "label", "Text", "text"]
        .map((key) => optionScalar(item[key]))
        .find(Boolean);
      if (caption) return caption;
    }
  }
  return null;
}

function ageGenerationCaption(rawCaption: string, programYear?: number | null) {
  const optionId = Number(rawCaption);
  if (!Number.isInteger(optionId) || optionId < 1 || optionId > 86) return null;
  if (optionId === 86) return "Prefer not to answer";
  if (!programYear) return null;
  // const birthYear = programYear - optionId - 17;
  const birthYear = 2013 - optionId;
  if (birthYear >= 1997) return "Generation Z (Born 1997 or later)";
  if (birthYear >= 1981) return "Millennials (Born 1981 to 1996)";
  if (birthYear >= 1965) return "Generation X (Born 1965 to 1980)";
  if (birthYear >= 1946) return "Baby Boomers (Born 1946 to 1964)";
  return "The Silent Generation (Born 1928 to 1945)";
}

function demographicOptionOrder(
  question: Pick<DetailedResponse["question"], "dataLabel" | "metadata">,
  programYear?: number | null,
): string[] {
  const dataLabel = question.dataLabel.toLowerCase();
  const standardOptions =
    dataLabel === "f_personaldemographics_ethnicorigin"
      ? programYear && programYear <= 2024
        ? legacyEthnicityOptions
        : currentEthnicityOptions
      : standardDemographicOptions[dataLabel];
  if (standardOptions) return standardOptions;

  const configured = jsonObject(question.metadata).QuestionResponses;
  if (!Array.isArray(configured)) return [];
  return configured.flatMap((option) => {
    if (
      option !== null &&
      typeof option === "object" &&
      !Array.isArray(option)
    ) {
      const caption = optionScalar(
        option.Caption ?? option.caption ?? option.Label ?? option.label,
      );
      return caption ? [caption] : [];
    }
    const caption = optionScalar(option);
    return caption ? [caption] : [];
  });
}

export function demographicResponsePosition(
  caption: string,
  question: Pick<DetailedResponse["question"], "dataLabel" | "metadata">,
  programYear?: number | null,
): number {
  const position = demographicOptionOrder(question, programYear).indexOf(
    caption,
  );
  return position === -1 ? Number.MAX_SAFE_INTEGER : position + 1;
}

function compareDemographicOptions(
  left: string,
  right: string,
  question: Pick<DetailedResponse["question"], "dataLabel" | "metadata">,
  programYear?: number | null,
): number {
  return (
    demographicResponsePosition(left, question, programYear) -
      demographicResponsePosition(right, question, programYear) ||
    left.localeCompare(right)
  );
}

export function demographicResponseCaption(
  value: Prisma.JsonValue,
  question: Pick<DetailedResponse["question"], "dataLabel" | "metadata">,
  programYear?: number | null,
): string | null {
  const rawCaption = responseCaption(value);
  if (!rawCaption) return null;
  const configured = metadataResponseCaption(rawCaption, question.metadata);
  if (configured) return configured;
  const dataLabel = question.dataLabel.toLowerCase();
  if (dataLabel.includes("_orgid")) return rawCaption;
  if (dataLabel === "f_personaldemographics_agegeneration") {
    return ageGenerationCaption(rawCaption, programYear) ?? rawCaption;
  }
  const options =
    dataLabel === "f_personaldemographics_ethnicorigin"
      ? programYear && programYear <= 2024
        ? legacyEthnicityOptions
        : currentEthnicityOptions
      : standardDemographicOptions[dataLabel];
  const optionId = Number(rawCaption);
  return Number.isInteger(optionId) && optionId >= 1
    ? (options?.[optionId - 1] ?? rawCaption)
    : rawCaption;
}

export const responseDetailOptions = [
  "Strongly Disagree",
  "Disagree",
  "Neutral",
  "Agree",
  "Strongly Agree",
  "N/A",
] as const;

function isLikertQuestion(
  question: Pick<DetailedResponse["question"], "metadata" | "type">,
): boolean {
  const type = question.type.trim().toLowerCase();
  const typeId = jsonObject(question.metadata).QuestionTypeId;
  return (
    ["5", "likert", "scale", "rating", "agreement"].includes(type) ||
    typeId === 5 ||
    typeId === "5"
  );
}

export function reportResponseCaption(
  value: Prisma.JsonValue,
  question: Pick<
    DetailedResponse["question"],
    "dataLabel" | "metadata" | "type"
  >,
  programYear?: number | null,
): string | null {
  const mapped = demographicResponseCaption(value, question, programYear);
  if (!mapped || !isLikertQuestion(question)) return mapped;
  const numeric = Number(mapped);
  if (numeric === 99) return "N/A";
  if (Number.isInteger(numeric) && numeric >= 1 && numeric <= 6) {
    return responseDetailOptions[numeric - 1] ?? null;
  }
  const normalized = mapped.trim().toLowerCase();
  if (
    normalized === "neither agree nor disagree" ||
    normalized === "neither disagree nor agree"
  ) {
    return "Neutral";
  }
  if (
    normalized === "not applicable" ||
    normalized === "not applicable / prefer not to answer" ||
    normalized === "n/a" ||
    normalized === "na"
  ) {
    return "N/A";
  }
  return (
    responseDetailOptions.find(
      (option) => option.toLowerCase() === normalized,
    ) ?? mapped
  );
}

export type ResponseDetailTableCell =
  number | string | { percentile: string; respondentCount: number };

function responseDetailPercentage(count: number, denominator: number): string {
  if (denominator === 0) return "0%";
  const percentage = Math.round((count * 10_000) / denominator) / 100;
  return `${percentage}%`;
}

export function buildResponseDetailTable(
  question: BenchmarkQuestion,
  filterQuestion: BenchmarkQuestion,
  respondents: DetailedRespondent[],
  programYear?: number | null,
  version = "1",
): ResponseDetailTableCell[][] {
  const groups = new Map<string, DetailedRespondent[]>();
  for (const respondent of respondents) {
    const filterResponse = respondent.responses.find(
      ({ questionId }) => questionId === filterQuestion.id,
    );
    const caption = filterResponse
      ? demographicResponseCaption(
          filterResponse.value,
          filterQuestion,
          programYear,
        )
      : null;
    if (!caption) continue;
    const existing = groups.get(caption) ?? [];
    existing.push(respondent);
    groups.set(caption, existing);
  }
  const headers = [...groups.keys()].sort((left, right) =>
    compareDemographicOptions(left, right, filterQuestion, programYear),
  );
  const data: ResponseDetailTableCell[][] = [["", ...headers]];
  for (const option of responseDetailOptions) {
    const row: ResponseDetailTableCell[] = [option];
    for (const header of headers) {
      const group = groups.get(header) ?? [];
      if (group.length < privacyThreshold) {
        row.push("x");
        continue;
      }
      const answers = group.flatMap((respondent) => {
        const answer = respondent.responses.find(
          ({ questionId }) => questionId === question.id,
        );
        const caption = answer
          ? reportResponseCaption(answer.value, question, programYear)
          : null;
        return caption ? [caption] : [];
      });
      const count = answers.filter((answer) => answer === option).length;
      const percentile = responseDetailPercentage(count, answers.length);
      row.push(
        version === "1" ? { percentile, respondentCount: count } : percentile,
      );
    }
    data.push(row);
  }
  const totalRow: ResponseDetailTableCell[] = ["Question Total"];
  for (const header of headers) {
    const group = groups.get(header) ?? [];
    if (group.length < privacyThreshold) {
      totalRow.push("x");
      continue;
    }
    totalRow.push(
      group.filter((respondent) =>
        respondent.responses.some(
          ({ questionId, value }) =>
            questionId === question.id &&
            Boolean(reportResponseCaption(value, question, programYear)),
        ),
      ).length,
    );
  }
  data.push(totalRow);
  return data;
}

function safeSpreadsheetValue(value: string): string {
  return /^[=+\-@]/u.test(value) ? `'${value}` : value;
}

function responseColor(caption: string): string {
  const colors: Record<string, string> = {
    "strongly agree": "#00a46a",
    agree: "#70ad47",
    "neither agree nor disagree": "#ffc955",
    neutral: "#ffc955",
    disagree: "#ed7d31",
    "strongly disagree": "#c00000",
  };
  return colors[caption.trim().toLowerCase()] ?? "#8C60F3";
}

@Injectable()
export class CompatibilityReportsService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  private async reportWorkbookMetadata(
    principal: Principal,
    query: ReportQuery,
    providedContext?: ReportContext,
  ): Promise<ReportWorkbookMetadata> {
    const context = providedContext ?? (await this.context(principal, query));
    const formatDate = (value: Date | null) =>
      value?.toLocaleDateString("en-US", {
        day: "numeric",
        month: "long",
        timeZone: "UTC",
        year: "numeric",
      }) ?? "Not available";
    return {
      organizationName:
        metadataString(
          context.enrollmentMetrics,
          "OrganizationName",
          "organizationName",
          "CompanyName",
          "companyName",
        ) ?? "Organization",
      programName: context.program.name,
      surveyDates: `${formatDate(context.survey.startsAt)} to ${formatDate(context.survey.endsAt)}`,
    };
  }

  private async reportWorkbookDemographics(
    principal: Principal,
    query: ReportQuery,
  ): Promise<ReportWorkbookDemographic[]> {
    const response = await this.demographicResponseCounts(principal, query);
    return response.data.map((demographic) => ({
      title: demographic.categoryLabel,
      groupLabel: demographic.categoryLabel,
      options: demographic.options.map((option) => ({
        label: option.Caption,
        count: option.Count,
      })),
    }));
  }

  private feedbackSectionsFromBreakdown(
    breakdown: Awaited<
      ReturnType<CompatibilityReportsService["responseBreakdownBySection"]>
    >,
  ): FeedbackWorkbookSection[] {
    const percentage = (
      responses: Array<Record<string, unknown>>,
      caption: "Agree" | "Neutral" | "Disagree",
    ) => {
      const response = responses.find(
        (item) => item.ResponseCaption === caption,
      );
      if (typeof response?.percentage === "number") return response.percentage;
      if (typeof response?.percent === "number") {
        return response.percent <= 1
          ? response.percent * 100
          : response.percent;
      }
      return 0;
    };
    return breakdown.data.flatMap((section) =>
      Object.entries(section).map(([title, responses]) => ({
        title,
        questions: [
          {
            text: `${title} average`,
            agreement: percentage(responses, "Agree"),
            neutral: percentage(responses, "Neutral"),
            disagreement: percentage(responses, "Disagree"),
          },
        ],
      })),
    );
  }

  async employeeComparison(
    principal: Principal,
    query: ReportQuery,
  ): Promise<{
    success: true;
    message: "success";
    data: Array<Record<string, number>>;
  }> {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "WBC_Access");
    const questions = await this.benchmarkQuestions(context.survey.id);
    const groups = this.groups(context).filter((group) => !group.hidden);
    const responses = await this.agreementResponses(
      context.survey.id,
      questions,
    );
    return {
      success: true,
      message: "success",
      data: groups.map((group) => ({
        [group.key]: this.percentage(
          responses,
          questions.map(({ id }) => id),
          group.organizationIds,
        ),
      })),
    };
  }

  async workforceComparison(
    principal: Principal,
    query: ReportQuery,
  ): Promise<{
    success: true;
    message: "true";
    data: {
      tableHeaders: Array<Record<string, string>>;
      data: Array<Record<string, unknown>>;
      surveyAverage: Array<Record<string, unknown>>;
      cohortOrganizationCount: number;
    };
  }> {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "WBC_Access");
    if (query.isDummy) {
      const cohorts = ["All Employers", "Similar Size Employers"];
      const tableHeaders = cohorts.flatMap((title) => [
        {
          title,
          type: `${title.replaceAll(" ", "")}_Yes`,
          color: winnerColors.Yes,
        },
        {
          title,
          type: `${title.replaceAll(" ", "")}_No`,
          color: winnerColors.No,
        },
      ]);
      const categories = [
        "Core Employee Experience",
        "Your Job",
        "Communication and Workplace Culture",
        "Relationship With Your Manager",
      ];
      return {
        success: true,
        message: "true",
        data: {
          tableHeaders,
          data: categories.map((title, categoryIndex) => ({
            title,
            dataValues: tableHeaders.map(() => randomPercentage()),
            nestedData: Array.from({ length: 3 }, (_unused, index) => ({
              id: `dummy-benchmark-${categoryIndex + 1}-${index + 1}`,
              title: `Sample benchmark statement ${categoryIndex * 3 + index + 1}`,
              dataValues: tableHeaders.map(() => randomPercentage()),
            })),
            legends: Object.entries(winnerTitles).map(
              ([winner, legendTitle]) => ({
                color: winnerColors[winner as "Yes" | "No"],
                title: legendTitle,
              }),
            ),
          })),
          surveyAverage: cohorts.map((title) => ({
            title,
            subTitle: "Survey Average",
            Yes: { title: "Winners", value: randomPercentage() },
            No: { title: "Non-Winners", value: randomPercentage() },
          })),
          cohortOrganizationCount: 0,
        },
      };
    }
    const questions = await this.benchmarkQuestions(context.survey.id);
    const groups = this.groups(context);
    const responses = await this.agreementResponses(
      context.survey.id,
      questions,
    );
    const questionGroups = this.questionsByCategory(questions);
    const tableHeaders = this.tableHeaders(groups);
    const data = sortedCategories(questionGroups.keys()).map((category) => {
      const categoryQuestions = questionGroups.get(category) ?? [];
      return {
        title: category,
        nestedData: categoryQuestions.map((question) => ({
          id: question.legacyId ?? question.externalId ?? question.id,
          title: question.caption,
          dataValues: groups.map((group) =>
            group.hidden
              ? "x"
              : this.percentage(
                  responses,
                  [question.id],
                  group.organizationIds,
                ),
          ),
        })),
        dataValues: groups.map((group) =>
          group.hidden
            ? "x"
            : this.percentage(
                responses,
                categoryQuestions.map(({ id }) => id),
                group.organizationIds,
              ),
        ),
        legends: Object.entries(winnerTitles).map(([winner, title]) => ({
          color: winnerColors[winner as "Yes" | "No"],
          title,
        })),
      };
    });
    return {
      success: true,
      message: "true",
      data: {
        tableHeaders,
        data,
        surveyAverage: this.surveyAverages(groups, questions, responses),
        cohortOrganizationCount:
          (groups.find(({ size, winner }) => size === "All" && winner === "Yes")
            ?.organizationIds.length ?? 0) +
          (groups.find(({ size, winner }) => size === "All" && winner === "No")
            ?.organizationIds.length ?? 0),
      },
    };
  }

  async sectionComparison(
    principal: Principal,
    query: ReportQuery,
  ): Promise<{
    success: true;
    message: "success";
    data: Array<{
      category: string;
      data: Array<Record<string, number>>;
    }>;
  }> {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "WBC_Access");
    const questions = await this.benchmarkQuestions(context.survey.id);
    const groups = this.groups(context).filter((group) => !group.hidden);
    const responses = await this.agreementResponses(
      context.survey.id,
      questions,
    );
    const questionGroups = this.questionsByCategory(questions);
    return {
      success: true,
      message: "success",
      data: sortedCategories(questionGroups.keys()).map((category) => ({
        category,
        data: groups.map((group) => ({
          [group.key]: this.percentage(
            responses,
            (questionGroups.get(category) ?? []).map(({ id }) => id),
            group.organizationIds,
          ),
        })),
      })),
    };
  }

  async questionComparison(
    principal: Principal,
    query: ReportQuery,
    category: string,
  ): Promise<{
    success: true;
    message: "success";
    data: {
      questionResponse: Array<{
        question: string;
        data: Array<Record<string, number>>;
      }>;
    };
  }> {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "WBC_Access");
    const allQuestions = await this.benchmarkQuestions(context.survey.id);
    const questions =
      this.questionsByCategory(allQuestions).get(category.trim()) ?? [];
    if (questions.length === 0) {
      throw new NotFoundException("Category not found");
    }
    const groups = this.groups(context).filter((group) => !group.hidden);
    const responses = await this.agreementResponses(
      context.survey.id,
      questions,
    );
    return {
      success: true,
      message: "success",
      data: {
        questionResponse: questions.map((question) => ({
          question: question.caption,
          data: groups.map((group) => ({
            [group.key]: this.percentage(
              responses,
              [question.id],
              group.organizationIds,
            ),
          })),
        })),
      },
    };
  }

  async workforceQuestionComparison(
    principal: Principal,
    query: ReportQuery,
    category: string,
  ): Promise<{
    success: true;
    message: "true";
    data: {
      tableHeaders: Array<Record<string, string>>;
      tableData: Array<Record<string, unknown>>;
    };
  }> {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "WBC_Access");
    const allQuestions = await this.benchmarkQuestions(context.survey.id);
    const questions =
      this.questionsByCategory(allQuestions).get(category.trim()) ?? [];
    if (questions.length === 0) {
      throw new NotFoundException("Category not found");
    }
    const groups = this.groups(context);
    const responses = await this.agreementResponses(
      context.survey.id,
      questions,
    );
    return {
      success: true,
      message: "true",
      data: {
        tableHeaders: this.tableHeaders(groups),
        tableData: [
          {
            title: category.trim(),
            nestedData: questions.map((question) => ({
              id: question.legacyId ?? question.externalId ?? question.id,
              title: question.caption,
              dataValues: groups.map((group) =>
                group.hidden
                  ? "x"
                  : this.percentage(
                      responses,
                      [question.id],
                      group.organizationIds,
                    ),
              ),
            })),
          },
        ],
      },
    };
  }

  async sectionComparisonWithMe(
    principal: Principal,
    query: ReportQuery,
    selectedCategoryOption = "AllYes",
  ): Promise<{
    success: true;
    message: "success";
    data: {
      categoryResponse: Array<{
        category: string;
        currentOrg: number;
        otherOrg: number;
      }>;
    };
  }> {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "WBC_Access");
    const questions = await this.benchmarkQuestions(context.survey.id);
    const published = this.publishedWorkforce(context);
    if (published) {
      const selectedIndex = published.headers.findIndex(
        (header) =>
          header.type.replaceAll("_", "").toLowerCase() ===
          selectedCategoryOption.replaceAll("_", "").toLowerCase(),
      );
      if (selectedIndex < 0) {
        throw new BadRequestException("Invalid benchmark category");
      }
      const responses = await this.agreementResponses(
        context.survey.id,
        questions,
      );
      const questionGroups = this.questionsByCategory(questions);
      return {
        success: true,
        message: "success",
        data: {
          categoryResponse: published.categories.map((category) => {
            const questionIds = (questionGroups.get(category.title) ?? []).map(
              ({ id }) => id,
            );
            return {
              category: category.title,
              currentOrg: this.percentage(responses, questionIds, [
                context.organizationId,
              ]),
              otherOrg: Number(category.dataValues[selectedIndex] ?? 0),
            };
          }),
        },
      };
    }
    const groups = this.groups(context);
    const selected = groups.find(
      (group) =>
        group.key.toLowerCase() === selectedCategoryOption.toLowerCase(),
    );
    if (!selected) throw new BadRequestException("Invalid benchmark category");
    const responses = await this.agreementResponses(
      context.survey.id,
      questions,
    );
    const questionGroups = this.questionsByCategory(questions);
    return {
      success: true,
      message: "success",
      data: {
        categoryResponse: sortedCategories(questionGroups.keys()).map(
          (category) => {
            const questionIds = (questionGroups.get(category) ?? []).map(
              ({ id }) => id,
            );
            return {
              category,
              currentOrg: this.percentage(responses, questionIds, [
                context.organizationId,
              ]),
              otherOrg: selected.hidden
                ? 0
                : this.percentage(
                    responses,
                    questionIds,
                    selected.organizationIds,
                  ),
            };
          },
        ),
      },
    };
  }

  async questionComparisonWithMe(
    principal: Principal,
    query: ReportQuery,
    category: string,
    selectedCategoryOption = "AllYes",
  ) {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "WBC_Access");
    const published = this.publishedWorkforce(context);
    if (published) {
      const selectedIndex = published.headers.findIndex(
        (header) =>
          header.type.replaceAll("_", "").toLowerCase() ===
          selectedCategoryOption.replaceAll("_", "").toLowerCase(),
      );
      if (selectedIndex < 0) {
        throw new BadRequestException("Invalid benchmark category");
      }
      const categorySnapshot = published.categories.find(
        (item) => item.title.toLowerCase() === category.trim().toLowerCase(),
      );
      const allQuestions = await this.benchmarkQuestions(context.survey.id);
      const questions =
        this.questionsByCategory(allQuestions).get(
          categorySnapshot?.title ?? category.trim(),
        ) ?? [];
      if (!categorySnapshot || questions.length === 0) {
        throw new NotFoundException("Category not found");
      }
      const responses = await this.agreementResponses(
        context.survey.id,
        questions,
      );
      return {
        success: true,
        message: "success",
        data: {
          questionResponse: questions.map((question, index) => ({
            question: question.caption,
            currentOrg: this.percentage(
              responses,
              [question.id],
              [context.organizationId],
            ),
            otherOrg: this.publishedValue(
              categorySnapshot.questions[index]?.dataValues[selectedIndex] ??
                "x",
            ),
          })),
        },
      };
    }
    const allQuestions = await this.benchmarkQuestions(context.survey.id);
    const questions =
      this.questionsByCategory(allQuestions).get(category.trim()) ?? [];
    if (questions.length === 0) {
      throw new NotFoundException("Category not found");
    }
    const groups = this.groups(context);
    const selected = groups.find(
      (group) =>
        group.key.toLowerCase() === selectedCategoryOption.toLowerCase(),
    );
    if (!selected) throw new BadRequestException("Invalid benchmark category");
    const responses = await this.agreementResponses(
      context.survey.id,
      questions,
    );
    return {
      success: true,
      message: "success",
      data: {
        questionResponse: questions.map((question) => ({
          question: question.caption,
          currentOrg: this.percentage(
            responses,
            [question.id],
            [context.organizationId],
          ),
          otherOrg: selected.hidden
            ? 0
            : this.percentage(
                responses,
                [question.id],
                selected.organizationIds,
              ),
        })),
      },
    };
  }

  async openResponseQuestions(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "EV_Access");
    if (query.isDummy) {
      return {
        success: true,
        message: "success",
        data: dummyOpenQuestions.map((question, index) => ({
          caption: question.caption,
          id: question.id,
          _id: question.id,
          questionNumber: index + 1,
        })),
      };
    }
    const questions = await this.openQuestions(context.survey.id);
    return {
      success: true,
      message: "success",
      data: questions.map((question) => ({
        caption: question.caption,
        id: question.legacyId ?? question.externalId ?? question.id,
        _id: question.id,
        questionNumber: question.position,
      })),
    };
  }

  async openResponseAnswers(
    principal: Principal,
    query: ReportQuery,
    questionReference: string,
    queryFilter?: Record<string, unknown>,
  ) {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "EV_Access");
    if (query.isDummy) {
      const question =
        dummyOpenQuestions.find(({ id }) => id === questionReference) ??
        dummyOpenQuestions[0];
      const respondentData = [...dummyVerbatims]
        .slice(0, randomInteger(3, dummyVerbatims.length))
        .sort((left, right) =>
          left.localeCompare(right, "en", {
            numeric: true,
            sensitivity: "base",
          }),
        )
        .map((Value, index) => ({
          _id: `dummy-respondent-${index + 1}`,
          RespondentId: `dummy-respondent-${index + 1}`,
          responses: {
            QuestionId: question.id,
            DataLabel: question.id,
            Value,
            ResponseCaption: Value,
          },
        }));
      return {
        success: true,
        message: "success",
        data: {
          respondentData,
          dataLen: respondentData.length,
          queryQuestion: {
            Caption: question.caption,
            Id: question.id,
            DataLabel: question.id,
          },
        },
      };
    }
    const questions = await this.openQuestions(context.survey.id);
    const question = questions.find(
      (candidate) =>
        candidate.id === questionReference ||
        candidate.legacyId === questionReference ||
        candidate.externalId === questionReference,
    );
    if (!question) throw new NotFoundException("Question not found");
    const respondents = await this.organizationRespondents(
      context,
      queryFilter,
    );
    const respondentData = respondents.flatMap((respondent) => {
      const response = respondent.responses.find(
        (candidate) => candidate.questionId === question.id,
      );
      const value = response ? responseCaption(response.value) : null;
      return value
        ? [
            {
              _id: respondent.id,
              RespondentId:
                respondent.legacyId ?? respondent.externalId ?? respondent.id,
              responses: {
                QuestionId:
                  question.legacyId ?? question.externalId ?? question.id,
                DataLabel: question.dataLabel,
                Value: value,
                ResponseCaption: " ",
              },
            },
          ]
        : [];
    });
    if (respondents.length < privacyThreshold) {
      throw new BadRequestException(
        "The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.",
      );
    }
    respondentData.sort((left, right) =>
      left.responses.Value.localeCompare(right.responses.Value, "en", {
        numeric: true,
        sensitivity: "base",
      }),
    );
    return {
      success: true,
      message: "success",
      data: {
        respondentData,
        dataLen: respondentData.length,
        queryQuestion: {
          Caption: question.caption,
          Id: question.legacyId ?? question.externalId ?? question.id,
          DataLabel: question.dataLabel,
        },
      },
    };
  }

  async responseBreakdownBySection(
    principal: Principal,
    query: ReportQuery,
    queryFilter?: Record<string, unknown>,
    accessKey: "WFR_Access" | "RD_Access" = "WFR_Access",
  ) {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, accessKey);
    const questions = await this.benchmarkQuestions(context.survey.id);
    const respondents = await this.organizationRespondents(
      context,
      queryFilter,
    );
    const confidential =
      Boolean(queryFilter && Object.keys(queryFilter).length > 0) &&
      respondents.length < privacyThreshold;
    if (confidential) {
      return {
        success: true,
        message:
          "The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.",
        isConfidential: true,
        data: [],
      };
    }
    const grouped = this.questionsByCategory(questions);
    return {
      success: true,
      message: respondents.length === 0 ? "No data found." : "success",
      isConfidential: false,
      data: sortedCategories(grouped.keys()).map((category) => {
        const categoryQuestions = grouped.get(category) ?? [];
        const distribution = this.sectionDistribution(
          respondents.flatMap(({ responses }) =>
            responses.filter((response) =>
              categoryQuestions.some(({ id }) => id === response.questionId),
            ),
          ),
        );
        return {
          [category]: [
            ...distribution,
            {
              totalNumberOfQuestionsPerSection: categoryQuestions.length,
              // Keep the legacy contract: this includes unanswered and N/A
              // responses, while the three distribution buckets do not.
              totalNumberOfResponsePerSection:
                categoryQuestions.length * respondents.length,
              totalRespondents: respondents.length,
              questionRange: categoryQuestions.map(
                (question) =>
                  question.legacyId ?? question.externalId ?? question.id,
              ),
            },
          ],
        };
      }),
    };
  }

  async responseBreakdown(
    principal: Principal,
    query: ReportQuery,
    questionRange: string[],
    queryFilter?: Record<string, unknown>,
  ) {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "WFR_Access");
    const questions = await this.benchmarkQuestions(context.survey.id);
    const selected = this.resolveQuestions(questions, questionRange);
    const respondents = await this.organizationRespondents(
      context,
      queryFilter,
    );
    if (
      queryFilter &&
      Object.keys(queryFilter).length > 0 &&
      respondents.length < privacyThreshold
    ) {
      return {
        success: true,
        message:
          "The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.",
        isConfidential: true,
        data: [],
      };
    }
    return {
      success: true,
      message: "success",
      isConfidential: false,
      data: selected.map((question) => ({
        question: question.caption,
        questionId: question.legacyId ?? question.externalId ?? question.id,
        responses: this.detailedDistribution(
          respondents.flatMap(({ responses }) =>
            responses.filter((response) => response.questionId === question.id),
          ),
          question,
          context.program.year,
        ),
      })),
    };
  }

  async meanScoreBySection(principal: Principal, query: ReportQuery) {
    const result = await this.responseBreakdownBySection(principal, query);
    return { success: true, message: result.message, data: result.data };
  }

  async meanScoreByQuestions(
    principal: Principal,
    query: ReportQuery,
    questionRange: string[],
  ) {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "WFR_Access");
    const questions = this.resolveQuestions(
      await this.benchmarkQuestions(context.survey.id),
      questionRange,
    );
    const respondents = await this.organizationRespondents(context);
    const sectionTotals = new Map<string, number>();
    const rows = questions.map((question) => {
      const responses = respondents.flatMap(({ responses: items }) =>
        items.filter((response) => response.questionId === question.id),
      );
      const distribution = this.distribution(responses);
      for (const item of distribution) {
        sectionTotals.set(
          item.ResponseCaption,
          (sectionTotals.get(item.ResponseCaption) ?? 0) + item.percent,
        );
      }
      const scores = responses.flatMap((response) =>
        response.score === null ? [] : [Number(response.score)],
      );
      return {
        question: question.caption,
        questionId: question.legacyId ?? question.externalId ?? question.id,
        questionType: question.type,
        dataLabel: question.dataLabel,
        totalNumberOfRespondents: respondents.length,
        meanScore:
          scores.length === 0
            ? "0.00"
            : (
                scores.reduce((sum, score) => sum + score, 0) / scores.length
              ).toFixed(2),
        responses: distribution,
      };
    });
    rows.push({
      sectionAvg: Object.fromEntries(
        [...sectionTotals].map(([caption, total]) => [
          caption,
          (total / Math.max(questions.length, 1)).toFixed(2),
        ]),
      ),
    } as unknown as (typeof rows)[number]);
    return { success: true, message: "success", data: rows };
  }

  async surveyFilters(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    if (query.isDummy) {
      return {
        success: true,
        message: "success",
        data: dummyDemographicOptions.map((demographic, index) => ({
          QuestionId: `dummy-filter-${index + 1}`,
          filterLabel: demographic.label,
          type: "Demographics",
          filterOption: demographic.options.map((Caption) => ({ Caption })),
        })),
      };
    }
    const respondents = await this.organizationRespondents(context);
    const options = new Map<
      string,
      { question: DetailedResponse["question"]; values: Set<string> }
    >();
    for (const respondent of respondents) {
      for (const response of respondent.responses) {
        if (
          !response.question.dataLabel.toLowerCase().includes("demographic")
        ) {
          continue;
        }
        const value = demographicResponseCaption(
          response.value,
          response.question,
          context.program.year,
        );
        if (!value) continue;
        const entry = options.get(response.questionId) ?? {
          question: response.question,
          values: new Set<string>(),
        };
        entry.values.add(value);
        options.set(response.questionId, entry);
      }
    }
    return {
      success: true,
      message: "success",
      data: [...options.values()]
        .map(({ question, values }) => ({
          QuestionId: question.legacyId ?? question.externalId ?? question.id,
          filterLabel:
            metadataString(question.metadata, "filterLabel") ??
            categoryFromDataLabel(question.dataLabel)
              .replace(/^Demographics\s*/u, "")
              .trim(),
          type: "Demographics",
          filterOption: [
            ...new Set([
              ...demographicOptionOrder(question, context.program.year),
              ...values,
            ]),
          ]
            .sort((left, right) =>
              compareDemographicOptions(
                left,
                right,
                question,
                context.program.year,
              ),
            )
            .map((Caption) => ({ Caption })),
        }))
        .sort((left, right) =>
          left.filterLabel.localeCompare(right.filterLabel),
        ),
    };
  }

  async unavailableAnnualTrend(principal: Principal, query: ReportQuery) {
    await this.context(principal, query);
    return { success: true, message: "Not available", data: [] };
  }

  async surveyResponseRate(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    const [sent, completed] = await Promise.all([
      this.prisma.respondent.count({
        where: {
          surveyId: context.survey.id,
          organizationId: context.organizationId,
        },
      }),
      this.prisma.respondent.count({
        where: {
          surveyId: context.survey.id,
          organizationId: context.organizationId,
          completedAt: { not: null },
        },
      }),
    ]);
    const metrics = jsonObject(context.enrollmentMetrics);
    const configuredSent = this.numericMetadata(
      metrics,
      "total_sent_surveys",
      "Surveys_Sent",
    );
    const sendSurvey = configuredSent ?? sent;
    const completedSurvey = completed;
    return {
      success: true,
      message: "success",
      data: {
        sendSurvey,
        Total_Number_of_Program_EEs:
          this.numericMetadata(
            metrics,
            "Program_EE_Count",
            "Total_Number_of_Program_EEs",
          ) ?? 0,
        completedSurvey,
        Total_Number_of_National_EEs:
          this.numericMetadata(metrics, "National_EE_Count") ?? 0,
        responseRate:
          sendSurvey === 0 ? 0 : (completedSurvey * 100) / sendSurvey,
      },
    };
  }

  async surveyInformation(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    const questions = await this.benchmarkQuestions(context.survey.id);
    const respondents = await this.organizationRespondents(context);
    const distribution = this.distribution(
      respondents.flatMap(({ responses }) =>
        responses.filter((response) =>
          questions.some(({ id }) => id === response.questionId),
        ),
      ),
    );
    const total = await this.prisma.respondent.count({
      where: {
        surveyId: context.survey.id,
        organizationId: context.organizationId,
      },
    });
    return {
      success: true,
      message: "success",
      data: {
        responseData: distribution,
        numberOfRespondents: total,
        totalRespondents: respondents.length,
        StartDate: context.survey.startsAt,
        EndDate: context.survey.endsAt,
        numberOfQuestions: questions.length,
      },
    };
  }

  async averageAgreement(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    const questions = await this.benchmarkQuestions(context.survey.id);
    const responses = await this.agreementResponses(
      context.survey.id,
      questions,
    );
    const scoped = responses.filter(
      ({ respondent }) => respondent.organizationId === context.organizationId,
    );
    const percentage = this.percentage(
      responses,
      questions.map(({ id }) => id),
      [context.organizationId],
    );
    const negative = scoped.filter((response) => {
      const caption = responseCaption(response.value)?.toLowerCase();
      return caption === "disagree" || caption === "strongly disagree";
    }).length;
    const denominator = scoped.filter(
      (response) => responseCaption(response.value)?.toLowerCase() !== "n/a",
    ).length;
    const totalRespondents = await this.prisma.respondent.count({
      where: {
        surveyId: context.survey.id,
        organizationId: context.organizationId,
        completedAt: { not: null },
      },
    });
    return {
      success: true,
      message: "success",
      data: {
        percentage: String(percentage),
        negativePercentage: String(
          denominator === 0 ? 0 : (negative * 100) / denominator,
        ),
        totalRespondents,
        StartDate: context.survey.startsAt,
        EndDateOld: context.survey.endsAt,
        EndDate: context.survey.endsAt,
        numberOfQuestions: questions.length,
      },
    };
  }

  async topBottomStatements(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    const questions = await this.benchmarkQuestions(context.survey.id);
    const respondents = await this.organizationRespondents(context);
    const noteTop =
      "If your organization has a tie of four or more highest rated statements, the top three are selected in survey order.";
    const noteBottom =
      "If your organization has a tie of four or more lowest rated statements, the bottom three are selected in survey order.";
    if (respondents.length < privacyThreshold) {
      return {
        success: true,
        message: "success",
        data: { top: [], bottom: [], noteTop, noteBottom },
      };
    }
    const scores = questions.map((question) => ({
      title: question.caption,
      percentage: this.positivePercentage(
        respondents.flatMap(({ responses }) =>
          responses.filter((response) => response.questionId === question.id),
        ),
      ),
      position: question.position,
    }));
    const top = [...scores]
      .sort(
        (left, right) =>
          right.percentage - left.percentage || left.position - right.position,
      )
      .slice(0, 3);
    const bottom = [...scores]
      .sort(
        (left, right) =>
          left.percentage - right.percentage || left.position - right.position,
      )
      .slice(0, 3);
    return {
      success: true,
      message: "success",
      data: { top, bottom, noteTop, noteBottom },
    };
  }

  async feedbackWorkbook(
    principal: Principal,
    query: ReportQuery,
    detailed: boolean,
    queryFilter?: Record<string, unknown>,
    responsePatternRanges?: ResponsePatternRanges,
  ): Promise<Buffer> {
    const responsePatterns = Array.isArray(queryFilter?.responsePatterns)
      ? queryFilter.responsePatterns.filter(
          (
            item: unknown,
          ): item is {
            metric: "agreement" | "disagreement";
            minimum: number;
            maximum: number;
          } =>
            Boolean(
              item &&
              typeof item === "object" &&
              "metric" in item &&
              (item.metric === "agreement" || item.metric === "disagreement") &&
              "minimum" in item &&
              typeof item.minimum === "number" &&
              "maximum" in item &&
              typeof item.maximum === "number",
            ),
        )
      : [];
    const legacyRanges = responsePatterns.reduce<ResponsePatternRanges>(
      (ranges, pattern) => {
        const range: [number, number] = [pattern.minimum, pattern.maximum];
        if (pattern.metric === "disagreement") ranges.negative = range;
        else if (pattern.minimum >= 80) ranges.positive = range;
        else ranges.neutral = range;
        return ranges;
      },
      {},
    );
    const highlightRanges =
      responsePatternRanges ??
      (Object.keys(legacyRanges).length ? legacyRanges : undefined);
    const context = await this.context(principal, query);
    this.requiresDemo(
      principal,
      context,
      detailed ? "RD_Access" : "WFR_Access",
    );
    if (query.isDummy) {
      return createWorkforceFeedbackWorkbook({
        metadata: await this.reportWorkbookMetadata(principal, query, context),
        demographics: dummyWorkbookDemographics(),
        sections: dummyFeedbackSections(),
        totalResponses: randomInteger(65, 180),
        ...(highlightRanges ? { responsePatternRanges: highlightRanges } : {}),
      });
    }
    const respondentFilter = Object.fromEntries(
      Object.entries(queryFilter ?? {}).filter(
        ([key]) => key !== "responsePatterns",
      ),
    );
    const questions = await this.benchmarkQuestions(context.survey.id);
    const respondents = await this.organizationRespondents(
      context,
      respondentFilter,
    );
    const confidential =
      Object.keys(respondentFilter).length > 0 &&
      respondents.length < privacyThreshold;
    const sourceSections = confidential
      ? []
      : this.feedbackSections(questions, respondents, context.program.year);
    const demographics = this.workbookDemographicsFromRespondents(
      respondents,
      context.program.year,
    );
    const metadata = await this.reportWorkbookMetadata(
      principal,
      query,
      context,
    );
    const totalResponses = respondents.length;
    return createWorkforceFeedbackWorkbook({
      metadata,
      demographics,
      sections: sourceSections,
      totalResponses,
      ...(highlightRanges ? { responsePatternRanges: highlightRanges } : {}),
    });
  }

  async feedbackPreview(
    principal: Principal,
    query: ReportQuery,
    ranges: ResponsePatternRanges,
  ) {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "WFR_Access");
    const questions = await this.benchmarkQuestions(context.survey.id);
    const respondents = await this.organizationRespondents(context);
    const isConfidential = respondents.length < privacyThreshold;
    const sections = isConfidential
      ? []
      : this.feedbackSections(questions, respondents, context.program.year);
    const isFallback = false;

    const cells: Array<{
      row: number;
      col: number;
      color: "positive" | "neutral" | "negative" | "gray";
      value: number;
    }> = [];
    let total = 0;
    let positive = 0;
    let neutral = 0;
    let negative = 0;
    let row = 5;

    for (const question of sections.flatMap((section) => section.questions)) {
      if (ranges.positive || ranges.neutral) {
        total += 1;
        let color: "positive" | "neutral" | "gray" = "gray";
        if (
          ranges.positive &&
          question.agreement >= ranges.positive[0] &&
          question.agreement <= ranges.positive[1]
        ) {
          color = "positive";
          positive += 1;
        } else if (
          ranges.neutral &&
          question.agreement >= ranges.neutral[0] &&
          question.agreement <= ranges.neutral[1]
        ) {
          color = "neutral";
          neutral += 1;
        }
        cells.push({ row, col: 4, color, value: question.agreement });
      }
      if (ranges.negative) {
        total += 1;
        const matches =
          question.disagreement >= ranges.negative[0] &&
          question.disagreement <= ranges.negative[1];
        if (matches) negative += 1;
        cells.push({
          row,
          col: 5,
          color: matches ? "negative" : "gray",
          value: question.disagreement,
        });
      }
      row += 1;
    }

    const percentage = (count: number) =>
      total === 0 ? 0 : (count * 100) / total;
    const positivePercentage = percentage(positive);
    const neutralPercentage = percentage(neutral);
    const negativePercentage = percentage(negative);

    return {
      success: true as const,
      message: "success" as const,
      isConfidential,
      isFallback,
      data: {
        heatmapPreview: cells,
        percentage: {
          positivePercentage,
          neutralPercentage,
          negativePercentage,
          greenPercentage: positivePercentage,
          bluePercentage: neutralPercentage,
          redPercentage: negativePercentage,
        },
      },
    };
  }

  private feedbackSections(
    questions: BenchmarkQuestion[],
    respondents: DetailedRespondent[],
    programYear?: number | null,
  ): FeedbackWorkbookSection[] {
    const grouped = this.questionsByCategory(questions);
    return sortedCategories(grouped.keys()).map((title) => ({
      title,
      questions: (grouped.get(title) ?? []).map((question) => {
        const distribution = this.trendDistribution(
          respondents.flatMap(({ responses }) =>
            responses.filter((response) => response.questionId === question.id),
          ),
        );
        const percentage = (caption: "Agree" | "Neutral" | "Disagree") =>
          distribution.find((item) => item.ResponseCaption === caption)
            ?.percentage ?? 0;
        const responseCount = distribution.reduce(
          (total, item) => total + item.numberOfResponses,
          0,
        );
        const demographic = this.demographicAgreementByQuestion(
          question,
          respondents,
          programYear,
        );
        return {
          text: question.caption,
          agreement: percentage("Agree"),
          neutral: percentage("Neutral"),
          disagreement: percentage("Disagree"),
          responseCount,
          demographicAgreement: demographic.agreement,
          demographicResponseCount: demographic.responseCount,
        };
      }),
    }));
  }

  private demographicAgreementByQuestion(
    question: BenchmarkQuestion,
    respondents: DetailedRespondent[],
    programYear?: number | null,
  ): {
    agreement: Record<string, Record<string, number>>;
    responseCount: Record<string, Record<string, number>>;
  } {
    const grouped = new Map<string, Map<string, DetailedResponse[]>>();
    for (const respondent of respondents) {
      const labels = new Map<string, Set<string>>();
      for (const response of respondent.responses) {
        if (
          !/^f_/iu.test(response.question.dataLabel) ||
          !this.isDemographicQuestion(response.question)
        ) {
          continue;
        }
        const label = demographicResponseCaption(
          response.value,
          response.question,
          programYear,
        );
        if (!label) continue;
        const group = demographicGroupFromDataLabel(
          response.question.dataLabel,
        );
        const groupLabels = labels.get(group) ?? new Set<string>();
        groupLabels.add(label);
        labels.set(group, groupLabels);
      }
      const answer = respondent.responses.find(
        (response) => response.questionId === question.id,
      );
      for (const [group, groupLabels] of labels) {
        const groupedByLabel =
          grouped.get(group) ?? new Map<string, DetailedResponse[]>();
        for (const label of groupLabels) {
          const responses = groupedByLabel.get(label) ?? [];
          if (answer) responses.push(answer);
          groupedByLabel.set(label, responses);
        }
        grouped.set(group, groupedByLabel);
      }
    }
    const distributions = [...grouped].map(
      ([group, labels]) =>
        [
          group,
          [...labels].map(
            ([label, responses]) =>
              [label, this.trendDistribution(responses)] as const,
          ),
        ] as const,
    );
    return {
      agreement: Object.fromEntries(
        distributions.map(([group, labels]) => [
          group,
          Object.fromEntries(
            labels.map(([label, distribution]) => [
              label,
              distribution.find((item) => item.ResponseCaption === "Agree")
                ?.percentage ?? 0,
            ]),
          ),
        ]),
      ),
      responseCount: Object.fromEntries(
        distributions.map(([group, labels]) => [
          group,
          Object.fromEntries(
            labels.map(([label, distribution]) => [
              label,
              distribution.reduce(
                (total, item) => total + item.numberOfResponses,
                0,
              ),
            ]),
          ),
        ]),
      ),
    };
  }

  private workbookDemographicsFromRespondents(
    respondents: DetailedRespondent[],
    programYear?: number | null,
  ): ReportWorkbookDemographic[] {
    const questions = new Map<string, DetailedResponse["question"]>();
    const counts = new Map<string, Map<string, number>>();
    for (const respondent of respondents) {
      for (const response of respondent.responses) {
        if (!this.isDemographicQuestion(response.question)) continue;
        const caption = demographicResponseCaption(
          response.value,
          response.question,
          programYear,
        );
        if (!caption) continue;
        questions.set(response.questionId, response.question);
        const options =
          counts.get(response.questionId) ?? new Map<string, number>();
        options.set(caption, (options.get(caption) ?? 0) + 1);
        counts.set(response.questionId, options);
      }
    }
    return [...questions.entries()]
      .sort(([, left], [, right]) => left.position - right.position)
      .map(([questionId, question]) => ({
        title: this.demographicLabel(question),
        groupLabel: demographicGroupFromDataLabel(question.dataLabel),
        options: [...(counts.get(questionId) ?? new Map<string, number>())]
          .sort(([left], [right]) =>
            compareDemographicOptions(left, right, question, programYear),
          )
          .map(([label, count]) => ({ label, count })),
      }));
  }

  async benchmarkWorkbook(
    principal: Principal,
    query: ReportQuery,
  ): Promise<Buffer> {
    const report = await this.workforceComparison(principal, query);
    const surveyAverage = report.data.surveyAverage.flatMap((average) =>
      (["Yes", "No"] as const).map((key) => {
        const value = average[key];
        return value &&
          typeof value === "object" &&
          "value" in value &&
          (typeof value.value === "number" || typeof value.value === "string")
          ? value.value
          : "x";
      }),
    );
    return createBenchmarkWorkbook({
      metadata: await this.reportWorkbookMetadata(principal, query),
      headerTypes: report.data.tableHeaders.flatMap(({ type }) =>
        typeof type === "string" ? [type] : [],
      ),
      categories: report.data.data.map((category) => ({
        title: typeof category.title === "string" ? category.title : "",
        values: Array.isArray(category.dataValues)
          ? category.dataValues.filter(
              (value): value is number | string =>
                typeof value === "number" || typeof value === "string",
            )
          : [],
        questions: Array.isArray(category.nestedData)
          ? (category.nestedData as unknown[]).flatMap((question: unknown) => {
              if (!question || typeof question !== "object") return [];
              const rawValues: unknown[] =
                "dataValues" in question && Array.isArray(question.dataValues)
                  ? (question.dataValues as unknown[])
                  : [];
              const values = rawValues.filter(
                (value: unknown): value is number | string =>
                  typeof value === "number" || typeof value === "string",
              );
              return [
                {
                  text:
                    "title" in question && typeof question.title === "string"
                      ? question.title
                      : "",
                  values,
                },
              ];
            })
          : [],
      })),
      surveyAverage,
      cohortOrganizationCount: report.data.cohortOrganizationCount,
    });
  }

  async responseDetailSections(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "RD_Access");
    if (query.isDummy) return { success: true, message: "success", data: dummyResponseDetailSections };
    const questions = await this.benchmarkQuestions(context.survey.id);
    const respondents = await this.organizationRespondents(context);
    if (respondents.length < privacyThreshold) {
      return {
        success: true,
        message:
          "The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.",
        data: [],
      };
    }
    const grouped = this.questionsByCategory(questions);
    return {
      success: true,
      message: "success",
      data: sortedCategories(grouped.keys()).map((category) => ({
        [category]: (grouped.get(category) ?? []).map((question) => ({
          QuestionId: question.legacyId ?? question.externalId ?? question.id,
          Caption: question.caption,
        })),
      })),
    };
  }

  async responseDetailQuestionResult(
    principal: Principal,
    query: ReportQuery,
    questionReference: string,
    filterReference: string,
    version = "1",
  ) {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "RD_Access");
    if (query.isDummy) return { success: true, message: "success", data: dummyResponseDetailResult };
    const allQuestions = await this.prisma.question.findMany({
      where: { surveyId: context.survey.id },
      orderBy: { position: "asc" },
      select: {
        id: true,
        legacyId: true,
        externalId: true,
        dataLabel: true,
        caption: true,
        type: true,
        position: true,
        metadata: true,
      },
    });
    const question = this.resolveQuestions(allQuestions, [
      questionReference,
    ])[0];
    const filterQuestion = this.resolveQuestions(allQuestions, [
      filterReference,
    ])[0];
    if (!question || !filterQuestion) {
      throw new NotFoundException("Question not found");
    }
    const respondents = await this.organizationRespondents(context);
    if (respondents.length < privacyThreshold) {
      return {
        success: true,
        message:
          "The information is not visible due to confidentiality reasons. The number of employee responses is less than 5.",
        data: [],
      };
    }
    const data = buildResponseDetailTable(
      question,
      filterQuestion,
      respondents,
      context.program.year,
      version,
    );
    return { success: true, message: "success", data };
  }

  async responseDetailWorkbook(
    principal: Principal,
    query: ReportQuery,
    filterReference?: string,
  ): Promise<Buffer> {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "RD_Access");
    const [questions, respondents] = await Promise.all([
      this.benchmarkQuestions(context.survey.id),
      this.organizationRespondents(context),
    ]);
    let filterGroupLabel: string | undefined;
    if (filterReference) {
      const surveyQuestions = await this.prisma.question.findMany({
        where: { surveyId: context.survey.id },
        orderBy: { position: "asc" },
        select: {
          id: true,
          legacyId: true,
          externalId: true,
          dataLabel: true,
          caption: true,
          type: true,
          position: true,
          metadata: true,
        },
      });
      const filterQuestion = this.resolveQuestions(surveyQuestions, [
        filterReference,
      ])[0];
      if (!filterQuestion || !this.isDemographicQuestion(filterQuestion)) {
        throw new NotFoundException("Demographic filter not found");
      }
      filterGroupLabel = this.demographicLabel(filterQuestion);
    }
    const demographics = this.workbookDemographicsFromRespondents(
      respondents,
      context.program.year,
    ).map((demographic) => ({
      ...demographic,
      groupLabel: demographic.title,
    }));
    const distribution = (
      question: BenchmarkQuestion,
      population: DetailedRespondent[],
    ): number[] => {
      const captions = population.flatMap((respondent) => {
        const answer = respondent.responses.find(
          (response) => response.questionId === question.id,
        );
        const caption = answer
          ? reportResponseCaption(
              answer.value,
              question,
              context.program.year,
            )
          : null;
        return caption ? [caption] : [];
      });
      return responseDetailOptions.map((option) => {
        if (captions.length === 0) return 0;
        return (
          (captions.filter((caption) => caption === option).length * 100) /
          captions.length
        );
      });
    };
    const groupedQuestions = this.questionsByCategory(questions);
    const sections: FeedbackWorkbookSection[] = sortedCategories(
      groupedQuestions.keys(),
    ).map((category) => ({
      title: category,
      questions: (groupedQuestions.get(category) ?? []).map((question) => {
        const responseDistribution = distribution(question, respondents);
        const demographicResponseDistribution = Object.fromEntries(
          demographics.map((demographic) => [
            demographic.groupLabel,
            Object.fromEntries(
              demographic.options.map((option) => {
                const population = respondents.filter((respondent) =>
                  respondent.responses.some(
                    (response) =>
                      this.isDemographicQuestion(response.question) &&
                      this.demographicLabel(response.question) ===
                        demographic.groupLabel &&
                      demographicResponseCaption(
                        response.value,
                        response.question,
                        context.program.year,
                      ) === option.label,
                  ),
                );
                return [option.label, distribution(question, population)];
              }),
            ),
          ]),
        );
        return {
          text: question.caption,
          disagreement:
            (responseDistribution[0] ?? 0) +
            (responseDistribution[1] ?? 0),
          neutral: responseDistribution[2] ?? 0,
          agreement:
            (responseDistribution[3] ?? 0) +
            (responseDistribution[4] ?? 0),
          responseCount: respondents.length,
          responseDistribution,
          demographicResponseDistribution,
        };
      }),
    }));
    return createResponseDetailWorkbook({
      metadata: await this.reportWorkbookMetadata(principal, query),
      demographics,
      sections,
      totalResponses: respondents.length,
      ...(filterGroupLabel ? { filterGroupLabel } : {}),
    });
  }

  async demographicResponseCounts(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "WFR_Access");
    if (query.isDummy) {
      return {
        success: true,
        message: "success",
        data: dummyDemographicOptions.map((demographic, index) => ({
          QuestionId: `dummy-demographic-${index + 1}`,
          category: demographic.category,
          categoryLabel: demographic.label,
          options: demographic.options.map((Caption, optionIndex) => ({
            Caption,
            Count: randomInteger(8, 45),
            Position: optionIndex + 1,
          })),
        })),
      };
    }
    const respondents = await this.organizationRespondents(context);
    const questions = new Map<string, DetailedResponse["question"]>();
    const counts = new Map<string, Map<string, number>>();
    for (const respondent of respondents) {
      for (const response of respondent.responses) {
        if (!this.isDemographicQuestion(response.question)) continue;
        const caption = demographicResponseCaption(
          response.value,
          response.question,
          context.program.year,
        );
        if (!caption) continue;
        questions.set(response.questionId, response.question);
        const options =
          counts.get(response.questionId) ?? new Map<string, number>();
        options.set(caption, (options.get(caption) ?? 0) + 1);
        counts.set(response.questionId, options);
      }
    }
    const data = [...questions.entries()]
      .sort(([, left], [, right]) => left.position - right.position)
      .map(([questionId, question]) => {
        const categoryLabel = this.demographicLabel(question);
        return {
          QuestionId: question.legacyId ?? question.externalId ?? question.id,
          category: this.demographicCategory(categoryLabel),
          categoryLabel,
          options: [
            ...new Set([
              ...demographicOptionOrder(question, context.program.year),
              ...(counts.get(questionId)?.keys() ?? []),
            ]),
          ]
            .map((Caption) => ({
              Caption,
              Count: counts.get(questionId)?.get(Caption) ?? 0,
              Position: demographicResponsePosition(
                Caption,
                question,
                context.program.year,
              ),
            }))
            .sort(
              (left, right) =>
                left.Position - right.Position ||
                left.Caption.localeCompare(right.Caption),
            ),
        };
      });
    return { success: true, message: "success", data };
  }

  async customReports(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    const assets = await this.prisma.asset.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { createdAt: "desc" },
    });
    const data = assets
      .filter((asset) => {
        const metadata = jsonObject(asset.metadata);
        return (
          metadata.kind === "customReport" &&
          metadata.programId === context.program.id
        );
      })
      .map((asset) => ({
        _id: asset.legacyId ?? asset.id,
        key: asset.key,
        bucket: asset.bucket,
        fileType: asset.contentType,
        fileSize: Number(asset.sizeBytes),
        createdAt: asset.createdAt,
        ...jsonObject(asset.metadata),
      }));
    if (data.length === 0) {
      throw new NotFoundException("no data found");
    }
    return { success: true, message: "success", data };
  }

  async employerBenchmark(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "BBP_Access");
    if (query.isDummy) {
      const tableHeaders = [
        {
          title: "All Employers",
          subTitle: "Winners",
          type: "All_Yes",
          color: winnerColors.Yes,
        },
        {
          title: "All Employers",
          subTitle: "Non-Winners",
          type: "All_No",
          color: winnerColors.No,
        },
        {
          title: "Similar Size Employers",
          subTitle: "Winners",
          type: "Size_Yes",
          color: winnerColors.Yes,
        },
        {
          title: "Similar Size Employers",
          subTitle: "Non-Winners",
          type: "Size_No",
          color: winnerColors.No,
        },
      ];
      const sections = [
        {
          title: "Benefits",
          questions: [
            "Medical insurance",
            "Retirement plan",
            "Paid parental leave",
          ],
        },
        {
          title: "Workplace Practices",
          questions: [
            "Flexible work schedules",
            "Employee recognition program",
            "Professional development",
          ],
        },
      ];
      return {
        success: true,
        message: "true",
        data: {
          tableHeaders,
          tableData: sections.map((section) => ({
            title: section.title,
            nestedData: section.questions.map((title, index) => ({
              id: `dummy-benefit-${section.title}-${index + 1}`,
              title,
              type: "%",
              nestedData: [
                {
                  title: "Yes",
                  type: "%",
                  dataValues: tableHeaders.map(() => randomPercentage()),
                },
                {
                  title: "No",
                  type: "%",
                  dataValues: tableHeaders.map(() => randomInteger(5, 40)),
                },
              ],
            })),
          })),
        },
      };
    }
    const published = this.publishedBenefits(context);
    if (!published) {
      throw new NotFoundException(
        "Benefits & Best Practices is not available for this program",
      );
    }
    return {
      success: true,
      message: "true",
      data: {
        tableHeaders: this.publishedHeaders(published.headers),
        tableData: published.sections.map((section) => ({
          title: section.title,
          nestedData: section.questions.map((question, questionIndex) => ({
            id: `${section.title}-${questionIndex + 1}`,
            title: question.text,
            type: question.responses.every(({ format }) => format === "percent")
              ? "%"
              : "number",
            nestedData: question.responses.map((response) => ({
              title: response.label,
              type: response.format === "percent" ? "%" : "number",
              dataValues: response.dataValues.map((value) =>
                this.publishedValue(value),
              ),
            })),
          })),
        })),
      },
    };
  }

  async employerBenchmarkWorkbook(
    principal: Principal,
    query: ReportQuery,
  ): Promise<Buffer> {
    const [context, report] = await Promise.all([
      this.context(principal, query),
      this.employerBenchmark(principal, query),
    ]);
    return createBenefitsWorkbook({
      headers: report.data.tableHeaders.map((header) => header.title),
      columnHeaders: report.data.tableHeaders.map((header) => {
        const size = header.title
          .replace(/\s+size categories$/iu, "")
          .replace(/\s+employers$/iu, "");
        return `${size} ${header.subTitle}`;
      }),
      programName: context.program.name,
      sections: report.data.tableData.map((section) => ({
        title: section.title,
        questions: section.nestedData.map((question) => ({
          text: question.title,
          responses: question.nestedData.map((response) => ({
            format: response.type === "%" ? "percent" : "number",
            label: response.title,
            values: response.dataValues,
          })),
        })),
      })),
    });
  }

  async winnersList(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    return this.groups(context)
      .filter((group) => !group.hidden)
      .map((group) => ({
        title:
          group.winner === "Yes"
            ? `${group.size} Winners`
            : `${group.size} Non-Winners`,
        key: group.key,
      }));
  }

  async clientUsernames(principal: Principal, projectReference?: string) {
    this.assertAdmin(principal);
    const project = projectReference
      ? await this.prisma.project.findFirst({
          where: this.referenceWhere(projectReference),
          select: { id: true },
        })
      : null;
    if (projectReference && !project) {
      throw new NotFoundException("Project not found");
    }
    const users = await this.prisma.user.findMany({
      where: {
        roles: { some: { role: { key: "client" } } },
        ...(project ? { projects: { some: { projectId: project.id } } } : {}),
      },
      orderBy: { username: "asc" },
      select: {
        username: true,
        organization: {
          select: {
            externalId: true,
            legacyId: true,
            id: true,
            name: true,
            metadata: true,
          },
        },
      },
    });
    return {
      success: true,
      message: "success",
      data: {
        users: users.flatMap((user) =>
          user.organization
            ? [
                {
                  username: user.username,
                  accountid:
                    user.organization.externalId ??
                    user.organization.legacyId ??
                    user.organization.id,
                  Account_Name:
                    metadataString(
                      user.organization.metadata,
                      "Alias_Company_Name",
                    ) ?? user.organization.name,
                },
              ]
            : [],
        ),
      },
    };
  }

  async deleteOrganizationForResync(
    principal: Principal,
    accountReference: string,
    username: string,
  ) {
    this.assertAdmin(principal);
    const organization = await this.prisma.organization.findFirst({
      where: this.referenceWhere(accountReference),
      select: { id: true },
    });
    if (!organization) throw new NotFoundException("Account id not found");
    const user = await this.prisma.user.findFirst({
      where: { organizationId: organization.id, username },
      select: { id: true },
    });
    if (!user) throw new NotFoundException("Username not found");
    await this.prisma.$transaction(async (transaction) => {
      await transaction.auditLog.deleteMany({
        where: { organizationId: organization.id },
      });
      await transaction.order.deleteMany({
        where: { organizationId: organization.id },
      });
      await transaction.asset.deleteMany({
        where: { organizationId: organization.id },
      });
      await transaction.respondent.deleteMany({
        where: { organizationId: organization.id },
      });
      await transaction.user.deleteMany({
        where: { organizationId: organization.id },
      });
      await transaction.organizationProgram.deleteMany({
        where: { organizationId: organization.id },
      });
      await transaction.organization.delete({ where: { id: organization.id } });
    });
    return { success: true, message: "success", data: {} };
  }

  async swapOrganizationCategoryValues(principal: Principal) {
    this.assertAdmin(principal);
    const enrollments = await this.prisma.organizationProgram.findMany({
      select: { id: true, metrics: true },
    });
    await this.prisma.$transaction(
      enrollments.map((enrollment) => {
        const metrics = jsonObject(enrollment.metrics);
        return this.prisma.organizationProgram.update({
          where: { id: enrollment.id },
          data: {
            metrics: {
              ...metrics,
              Current_Year_Category_Rank: metrics.Current_Year_Category ?? null,
              Current_Year_Category: metrics.Current_Year_Category_Rank ?? null,
            },
          },
        });
      }),
    );
    return {
      success: true,
      message: "success",
      data: { updated: enrollments.length },
    };
  }

  async keyImpactAnalysis(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "KIA_Access");
    if (query.isDummy) {
      return {
        success: true,
        message: "success",
        data: {
          mapping: defaultKeyImpactContributions,
          report: defaultKeyImpactReport,
          data: { signedUrl: null },
        },
      };
    }
    const assets = await this.prisma.asset.findMany({
      where: { organizationId: context.organizationId },
      orderBy: { createdAt: "desc" },
    });
    const asset = assets.find((candidate) => {
      const metadata = jsonObject(candidate.metadata);
      return (
        metadata.kind === "keyImpactAnalysis" &&
        (metadata.organizationProgramId === context.enrollmentId ||
          metadata.programId === context.program.id)
      );
    });
    const metadata = asset ? jsonObject(asset.metadata) : {};
    const uploadedReport = Array.isArray(metadata.report)
      ? metadata.report.flatMap((entry) => {
          const item = jsonObject(entry);
          const value = Number(item.value);
          if (
            typeof item.label !== "string" ||
            typeof item.key !== "string" ||
            !Number.isFinite(value)
          ) {
            return [];
          }
          return [{ label: item.label, key: item.key, value }];
        })
      : [];
    const storedReport =
      uploadedReport.length > 0 ? uploadedReport : defaultKeyImpactReport;
    const mapping = Object.fromEntries(
      storedReport.map((item) => {
        const percentage = item.value <= 1 ? item.value * 100 : item.value;
        return [
          item.key,
          Math.round(percentage * 100) / 100,
        ];
      }),
    );
    return {
      success: true,
      message: "success",
      data: {
        ...(asset ? { _id: asset.legacyId ?? asset.id, key: asset.key } : {}),
        fileName: metadata.fileName,
        mapping,
        report: storedReport,
        data: {
          signedUrl: metadata.signedUrl ?? null,
        },
      },
    };
  }

  async annualResponseRate(principal: Principal, query: ReportQuery) {
    const { current, previous } = await this.annualContexts(principal, query);
    this.requiresDemo(principal, current, "WFR_Access");
    const currentYear = this.contextYear(current);
    const previousYear = previous
      ? this.contextYear(previous)
      : String(Number(currentYear) - 1);
    if (!previous) {
      return { success: true, message: "survey avg data", data: null };
    }
    const [currentPercentage, previousPercentage] = await Promise.all([
      this.contextAgreement(current),
      this.contextAgreement(previous),
    ]);
    return {
      success: true,
      message: "survey avg data",
      data: [
        {
          [currentYear]: String(currentPercentage),
          [previousYear]: String(previousPercentage),
        },
      ],
    };
  }

  async annualCategories(principal: Principal, query: ReportQuery) {
    const { current, previous } = await this.annualContexts(principal, query);
    this.requiresDemo(principal, current, "WFR_Access");
    const currentYear = this.contextYear(current);
    const previousYear = previous
      ? this.contextYear(previous)
      : String(Number(currentYear) - 1);
    if (!previous) {
      return { success: true, data: [] };
    }
    const [currentData, previousData] = await Promise.all([
      this.annualCategorySnapshot(current),
      this.annualCategorySnapshot(previous),
    ]);
    const categories = new Set([...currentData.keys(), ...previousData.keys()]);
    return {
      success: true,
      data: sortedCategories(categories).map((category) => ({
        category: { category },
        [currentYear]: currentData.get(category) ?? {
          data: this.emptyTrendDistribution(),
          questionIds: [],
        },
        [previousYear]: previousData.get(category) ?? {
          data: this.emptyTrendDistribution(),
          questionIds: [],
        },
      })),
    };
  }

  async annualDetails(
    principal: Principal,
    query: ReportQuery,
    category: string,
    currentReferences: string[],
    previousReferences: string[],
  ) {
    const { current, previous } = await this.annualContexts(principal, query);
    this.requiresDemo(principal, current, "WFR_Access");
    const currentYear = this.contextYear(current);
    const previousYear = previous
      ? this.contextYear(previous)
      : String(Number(currentYear) - 1);
    if (!previous) {
      return { success: true, message: "success", data: [], category };
    }
    const currentQuestions = this.selectCategoryQuestions(
      await this.benchmarkQuestions(current.survey.id),
      category,
      currentReferences,
    );
    const previousQuestions = this.selectCategoryQuestions(
      await this.benchmarkQuestions(previous.survey.id),
      category,
      previousReferences,
    );
    const previousByLabel = new Map(
      previousQuestions.map((question) => [question.dataLabel, question]),
    );
    const [currentRespondents, previousRespondents] = await Promise.all([
      this.organizationRespondents(current),
      this.organizationRespondents(previous),
    ]);
    const data = currentQuestions.map((question) => {
      const previousQuestion = previousByLabel.get(question.dataLabel);
      return {
        question: question.caption,
        questionId: question.legacyId ?? question.externalId ?? question.id,
        [currentYear]: {
          question: question.caption,
          questionId: question.legacyId ?? question.externalId ?? question.id,
          responses: this.trendDistribution(
            currentRespondents.flatMap(({ responses }) =>
              responses.filter(({ questionId }) => questionId === question.id),
            ),
          ),
        },
        ...(previousQuestion
          ? {
              [previousYear]: {
                question: previousQuestion.caption,
                questionId:
                  previousQuestion.legacyId ??
                  previousQuestion.externalId ??
                  previousQuestion.id,
                responses: this.trendDistribution(
                  previousRespondents.flatMap(({ responses }) =>
                    responses.filter(
                      ({ questionId }) => questionId === previousQuestion.id,
                    ),
                  ),
                ),
              },
            }
          : {}),
      };
    });
    return { success: true, message: "success", data, category };
  }

  async annualTrendWorkbook(
    principal: Principal,
    query: ReportQuery,
  ): Promise<Buffer> {
    const { current, previous } = await this.annualContexts(principal, query);
    this.requiresDemo(principal, current, "WFR_Access");
    const currentYear = this.contextYear(current);
    const previousYear = previous
      ? this.contextYear(previous)
      : String(Number(currentYear) - 1);
    const [
      currentQuestions,
      previousQuestions,
      currentRespondents,
      previousRespondents,
    ] = await Promise.all([
      this.benchmarkQuestions(current.survey.id),
      previous ? this.benchmarkQuestions(previous.survey.id) : [],
      this.organizationRespondents(current),
      previous ? this.organizationRespondents(previous) : [],
    ]);
    const currentGrouped = this.questionsByCategory(currentQuestions);
    const previousGrouped = this.questionsByCategory(previousQuestions);
    const categories = sortedCategories(
      new Set([...currentGrouped.keys(), ...previousGrouped.keys()]),
    );
    const snapshot = (
      question: BenchmarkQuestion | undefined,
      respondents: DetailedRespondent[],
    ): AnnualTrendsWorkbookValue | undefined => {
      if (!question) return undefined;
      const distribution = this.trendDistribution(
        respondents.flatMap(({ responses }) =>
          responses.filter((response) => response.questionId === question.id),
        ),
      );
      const percentage = (caption: "Agree" | "Disagree") =>
        distribution.find((item) => item.ResponseCaption === caption)
          ?.percentage ?? 0;
      return {
        agreement: percentage("Agree"),
        disagreement: percentage("Disagree"),
        responseCount: distribution.reduce(
          (total, item) => total + item.numberOfResponses,
          0,
        ),
      };
    };
    const sections = categories.map((title) => {
      const currentCategoryQuestions = currentGrouped.get(title) ?? [];
      const previousCategoryQuestions = previousGrouped.get(title) ?? [];
      const previousByLabel = new Map(
        previousCategoryQuestions.map((question) => [
          question.dataLabel,
          question,
        ]),
      );
      const sourceQuestions = currentCategoryQuestions.length
        ? currentCategoryQuestions
        : previousCategoryQuestions;
      return {
        title,
        questions: sourceQuestions.map((question) => {
          const currentSnapshot = snapshot(
            currentCategoryQuestions.find(
              (candidate) => candidate.dataLabel === question.dataLabel,
            ),
            currentRespondents,
          );
          const previousSnapshot = snapshot(
            previousByLabel.get(question.dataLabel),
            previousRespondents,
          );
          return {
            text: question.caption,
            ...(currentSnapshot ? { current: currentSnapshot } : {}),
            ...(previousSnapshot ? { previous: previousSnapshot } : {}),
          };
        }),
      };
    });
    return createAnnualTrendsWorkbook({
      metadata: await this.reportWorkbookMetadata(principal, query, current),
      currentYear,
      previousYear,
      currentTotalResponses: currentRespondents.length,
      previousTotalResponses: previousRespondents.length,
      sections,
    });
  }

  async openResponsesWorkbook(
    principal: Principal,
    query: ReportQuery,
    queryFilter?: Record<string, unknown>,
  ): Promise<Buffer> {
    const context = await this.context(principal, query);
    this.requiresDemo(principal, context, "EV_Access");
    if (queryFilter?.questionId !== undefined) {
      this.requiresDemo(principal, context, "SEV_Access");
    }
    if (query.isDummy) {
      return createVerbatimWorkbook({
        metadata: await this.reportWorkbookMetadata(principal, query, context),
        questions: dummyOpenQuestions.map((question) => ({
          text: question.caption,
          responses: [...dummyVerbatims]
            .slice(0, randomInteger(3, dummyVerbatims.length))
            .sort((left, right) =>
              left.localeCompare(right, "en", {
                numeric: true,
                sensitivity: "base",
              }),
            )
            .map((answer) => ({ answer })),
        })),
      });
    }
    const questions = await this.openQuestions(context.survey.id, queryFilter);
    const filterReference = queryFilter?.questionId;
    const filterQuestion =
      typeof filterReference === "string" || typeof filterReference === "number"
        ? questions.find((question) =>
            [question.id, question.legacyId, question.externalId]
              .filter(Boolean)
              .includes(String(filterReference)),
          )
        : undefined;
    const reportQuestions = filterQuestion
      ? questions.filter(({ id }) => id !== filterQuestion.id)
      : questions;
    const respondents = await this.prisma.respondent.findMany({
      where: {
        surveyId: context.survey.id,
        organizationId: context.organizationId,
        completedAt: { not: null },
      },
      orderBy: { createdAt: "asc" },
      select: {
        responses: {
          where: { questionId: { in: questions.map(({ id }) => id) } },
          select: { questionId: true, value: true },
        },
      },
    });
    return createVerbatimWorkbook({
      metadata: await this.reportWorkbookMetadata(principal, query, context),
      ...(filterQuestion ? { demographicTitle: filterQuestion.caption } : {}),
      questions: reportQuestions.map((question) => ({
        text: question.caption,
        responses: respondents
          .flatMap((respondent) => {
            const response = respondent.responses.find(
              (item) => item.questionId === question.id,
            );
            const answer = response ? responseCaption(response.value) : null;
            const demographicResponse = filterQuestion
              ? respondent.responses.find(
                  (item) => item.questionId === filterQuestion.id,
                )
              : undefined;
            const demographic = demographicResponse
              ? responseCaption(demographicResponse.value)
              : null;
            return answer
              ? [{
                  answer: safeSpreadsheetValue(answer),
                  ...(demographic
                    ? { demographic: safeSpreadsheetValue(demographic) }
                    : {}),
                }]
              : [];
          })
          .sort((left, right) =>
            (left.demographic ?? "").localeCompare(
              right.demographic ?? "",
              "en",
              { numeric: true, sensitivity: "base" },
            ) ||
            left.answer.localeCompare(right.answer, "en", {
              numeric: true,
              sensitivity: "base",
            }),
          ),
      })),
    });
  }

  private async context(
    principal: Principal,
    query: ReportQuery,
  ): Promise<ReportContext> {
    const programSelect = {
      id: true,
      projectId: true,
      name: true,
      year: true,
      startsAt: true,
      metadata: true,
      project: { select: { id: true, name: true } },
    } satisfies Prisma.ProgramSelect;
    const program = query.selectedProgramId
      ? await this.prisma.program.findFirst({
          where: isUuid(query.selectedProgramId)
            ? { id: query.selectedProgramId }
            : {
                OR: [
                  { legacyId: query.selectedProgramId },
                  { externalId: query.selectedProgramId },
                ],
              },
          select: programSelect,
        })
      : (
          await this.prisma.user.findUnique({
            where: { id: principal.sub },
            select: {
              organizationProgram: {
                select: { program: { select: programSelect } },
              },
            },
          })
        )?.organizationProgram?.program;
    if (!program) throw new NotFoundException("Program not found");

    let organizationId = principal.organizationId;
    if (!principal.roles.includes("client") && query.organizationId) {
      const organization = await this.prisma.organization.findFirst({
        where: isUuid(query.organizationId)
          ? { id: query.organizationId }
          : {
              OR: [
                { legacyId: query.organizationId },
                { externalId: query.organizationId },
              ],
            },
        select: { id: true },
      });
      organizationId = organization?.id ?? null;
    }
    if (!organizationId) {
      throw new BadRequestException("Organization is required");
    }
    const enrollment = await this.prisma.organizationProgram.findFirst({
      where: { organizationId, programId: program.id, isIncluded: true },
      select: { id: true, reportAccess: true, metrics: true, metadata: true },
    });
    if (!enrollment) {
      throw new ForbiddenException(
        "You are not authorized to access this program",
      );
    }
    const survey = await this.prisma.survey.findFirst({
      where: { programId: program.id },
      orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, title: true, startsAt: true, endsAt: true },
    });
    if (!survey) throw new NotFoundException("Survey not found");
    const organizationPrograms = await this.prisma.organizationProgram.findMany(
      {
        where: { programId: program.id, isIncluded: true },
        select: {
          organizationId: true,
          isWinner: true,
          metrics: true,
          organization: { select: { metadata: true } },
        },
      },
    );
    return {
      isDummy: query.isDummy,
      organizationId,
      enrollmentId: enrollment.id,
      reportAccess: enrollment.reportAccess,
      enrollmentMetrics: enrollment.metrics,
      enrollmentMetadata: enrollment.metadata,
      program,
      survey,
      organizationPrograms,
    };
  }

  private requiresDemo(
    principal: Principal,
    context: ReportContext,
    accessKey:
      | "WBC_Access"
      | "EV_Access"
      | "WFR_Access"
      | "RD_Access"
      | "BBP_Access"
      | "KIA_Access"
      | "SEV_Access",
  ): false {
    if (
      context.isDummy &&
      principal.roles.includes("client") &&
      !clientDemoAccess.has(accessKey)
    ) {
      throw new ForbiddenException(
        "Dummy report data is only available to promotional users",
      );
    }
    if (
      principal.roles.includes("admin") ||
      principal.roles.includes("super_admin") ||
      (context.isDummy &&
        ((principal.roles.includes("promotional") && promotionalPreviewAccess.has(accessKey)) ||
          (principal.roles.includes("client") && clientDemoAccess.has(accessKey))))
    )
      return false;
    const access = jsonObject(context.reportAccess);
    const aliases = {
      WBC_Access: "workforceBenchmark",
      EV_Access: "employeeVerbatims",
      WFR_Access: "workforceFeedback",
      RD_Access: "responseDetail",
      BBP_Access: "benefitsBestPractices",
      KIA_Access: "keyImpactAnalysis",
      SEV_Access: "sortedEmployeeVerbatims",
    } as const;
    const value = access[accessKey] ?? access[aliases[accessKey]];
    const allowed =
      value === true ||
      (typeof value === "string" && value.trim().toLowerCase() === "yes");
    if (!allowed) {
      throw new ForbiddenException(
        "This program does not include access to the requested report",
      );
    }
    return false;
  }

  private async benchmarkQuestions(
    surveyId: string,
  ): Promise<BenchmarkQuestion[]> {
    const questions = await this.prisma.question.findMany({
      where: { surveyId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        legacyId: true,
        externalId: true,
        dataLabel: true,
        caption: true,
        type: true,
        position: true,
        metadata: true,
      },
    });
    return questions.filter((question) => {
      const type = question.type.trim().toLowerCase();
      const questionTypeId = jsonObject(question.metadata).QuestionTypeId;
      return (
        !question.dataLabel.toUpperCase().includes("ORGID") &&
        (["5", "likert", "scale", "rating", "agreement"].includes(type) ||
          questionTypeId === 5 ||
          questionTypeId === "5")
      );
    });
  }

  private async openQuestions(
    surveyId: string,
    queryFilter?: Record<string, unknown>,
  ): Promise<BenchmarkQuestion[]> {
    const questions = await this.prisma.question.findMany({
      where: { surveyId },
      orderBy: { position: "asc" },
      select: {
        id: true,
        legacyId: true,
        externalId: true,
        dataLabel: true,
        caption: true,
        type: true,
        position: true,
        metadata: true,
      },
    });
    const open = questions.filter((question) => {
      const reportRole = metadataString(question.metadata, "reportRole");
      if (reportRole) return reportRole === "verbatim";
      const type = question.type.toLowerCase();
      const questionTypeId = jsonObject(question.metadata).QuestionTypeId;
      return (
        question.dataLabel.toLowerCase().includes("openended") ||
        type.includes("open") ||
        type.includes("text") ||
        questionTypeId === 9 ||
        questionTypeId === "9"
      );
    });
    const filterReference = queryFilter?.questionId;
    if (
      typeof filterReference !== "string" &&
      typeof filterReference !== "number"
    ) {
      return open;
    }
    const reference = String(filterReference);
    const filterQuestion = questions.find(
      (question) =>
        question.id === reference ||
        question.legacyId === reference ||
        question.externalId === reference,
    );
    return filterQuestion && !open.some(({ id }) => id === filterQuestion.id)
      ? [...open, filterQuestion]
      : open;
  }

  private groups(context: ReportContext): BenchmarkGroup[] {
    const categorized = context.organizationPrograms.flatMap((enrollment) => {
      const storedCategory =
        metadataString(
          enrollment.metrics,
          "Current_Year_Category",
          "currentYearCategory",
          "category",
        ) ??
        metadataString(
          enrollment.organization.metadata,
          "Current_Year_Category",
          "currentYearCategory",
          "category",
        );
      const metrics = jsonObject(enrollment.metrics);
      const companySize = Number(metrics.Company_Size ?? metrics.companySize);
      const category =
        storedCategory ??
        (Number.isFinite(companySize)
          ? companySize >= 250
            ? "Large"
            : companySize >= 50
              ? "Medium"
              : companySize >= 15
                ? "Small"
                : "Boutique"
          : null);
      return [
        {
          organizationId: enrollment.organizationId,
          category,
          winner: enrollment.isWinner ? ("Yes" as const) : ("No" as const),
        },
      ];
    });
    const observedSizes = [
      ...new Set(
        categorized.flatMap(({ category }) => (category ? [category] : [])),
      ),
    ].sort((left, right) => {
      const leftIndex = sizeOrder.indexOf(left);
      const rightIndex = sizeOrder.indexOf(right);
      return (
        (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
          (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex) ||
        left.localeCompare(right)
      );
    });
    return ["All", ...observedSizes].flatMap((size) =>
      (["Yes", "No"] as const).map((winner) => {
        const organizationIds = categorized
          .filter(
            (entry) =>
              entry.winner === winner &&
              (size === "All" || entry.category === size),
          )
          .map(({ organizationId }) => organizationId);
        return {
          key: `${size.replace(/\s+/gu, "")}${winner}`,
          size,
          winner,
          organizationIds,
          hidden: organizationIds.length === 0,
        };
      }),
    );
  }

  private async agreementResponses(
    surveyId: string,
    questions: BenchmarkQuestion[],
  ): Promise<AgreementResponse[]> {
    if (questions.length === 0) return [];
    return this.prisma.response.findMany({
      where: {
        questionId: { in: questions.map(({ id }) => id) },
        respondent: {
          surveyId,
          organizationId: { not: null },
          completedAt: { not: null },
        },
      },
      select: {
        questionId: true,
        value: true,
        score: true,
        respondent: { select: { organizationId: true } },
      },
    });
  }

  private async organizationRespondents(
    context: ReportContext,
    queryFilter?: Record<string, unknown>,
  ): Promise<DetailedRespondent[]> {
    const respondents = await this.prisma.respondent.findMany({
      where: {
        surveyId: context.survey.id,
        organizationId: context.organizationId,
        completedAt: { not: null },
      },
      orderBy: { createdAt: "asc" },
      select: {
        id: true,
        legacyId: true,
        externalId: true,
        metadata: true,
        responses: {
          orderBy: { questionId: "asc" },
          select: {
            questionId: true,
            value: true,
            score: true,
            question: {
              select: {
                id: true,
                legacyId: true,
                externalId: true,
                dataLabel: true,
                caption: true,
                type: true,
                position: true,
                metadata: true,
              },
            },
          },
        },
      },
    });
    if (!queryFilter || Object.keys(queryFilter).length === 0) {
      return respondents;
    }
    return respondents.filter((respondent) =>
      Object.entries(queryFilter).every(([reference, rawValues]) => {
        const values = (Array.isArray(rawValues) ? rawValues : [rawValues])
          .flatMap((value) =>
            typeof value === "string" ||
            typeof value === "number" ||
            typeof value === "boolean"
              ? [String(value).trim().toLowerCase()]
              : [],
          )
          .filter(Boolean);
        if (values.length === 0) return true;
        return respondent.responses.some((response) => {
          const matchesQuestion =
            response.question.id === reference ||
            response.question.legacyId === reference ||
            response.question.externalId === reference;
          const caption = demographicResponseCaption(
            response.value,
            response.question,
            context.program.year,
          )?.toLowerCase();
          return Boolean(
            matchesQuestion && caption && values.includes(caption),
          );
        });
      }),
    );
  }

  private isDemographicQuestion(
    question: DetailedResponse["question"],
  ): boolean {
    const typeId = jsonObject(question.metadata).QuestionTypeId;
    return (
      question.dataLabel.toLowerCase().includes("demographic") ||
      typeId === 2 ||
      typeId === "2" ||
      typeId === 3 ||
      typeId === "3"
    );
  }

  private demographicLabel(question: DetailedResponse["question"]): string {
    const configured = metadataString(
      question.metadata,
      "categoryLabel",
      "filterLabel",
    );
    if (configured) return configured;
    return categoryFromDataLabel(question.dataLabel)
      .replace(/^Demographics?\s*/iu, "")
      .replace(/\d+$/u, "")
      .trim();
  }

  private demographicCategory(label: string): string {
    const personal = new Set([
      "Age Generation",
      "Education",
      "Ethnic Origin",
      "Race/Ethnicity",
      "Gender",
    ]);
    return personal.has(label)
      ? "Personal Demographics"
      : "Workplace Demographics";
  }

  private assertAdmin(principal: Principal): void {
    if (
      !principal.roles.includes("admin") &&
      !principal.roles.includes("super_admin") &&
      !principal.permissions.includes("ops.manage")
    ) {
      throw new ForbiddenException("Administrator access required");
    }
  }

  private referenceWhere(reference: string) {
    return isUuid(reference)
      ? { id: reference }
      : { OR: [{ legacyId: reference }, { externalId: reference }] };
  }

  private async annualContexts(
    principal: Principal,
    query: ReportQuery,
  ): Promise<{ current: ReportContext; previous: ReportContext | null }> {
    const current = await this.context(principal, query);
    const enrollments = await this.prisma.organizationProgram.findMany({
      where: {
        isIncluded: true,
        organizationId: current.organizationId,
        projectId: current.program.projectId,
        programId: { not: current.program.id },
      },
      select: {
        program: {
          select: {
            id: true,
            year: true,
            startsAt: true,
            createdAt: true,
          },
        },
      },
    });
    const candidates = enrollments
      .map(({ program }) => program)
      .filter((program) => {
        if (current.program.year !== null && program.year !== null) {
          return program.year < current.program.year;
        }
        if (current.program.startsAt && program.startsAt) {
          return program.startsAt < current.program.startsAt;
        }
        return program.createdAt < (current.program.startsAt ?? new Date());
      })
      .sort(
        (left, right) =>
          (right.year ?? 0) - (left.year ?? 0) ||
          Number(right.startsAt ?? right.createdAt) -
            Number(left.startsAt ?? left.createdAt),
      );
    const previousProgram = candidates[0];
    const previous = previousProgram
      ? await this.context(principal, {
          ...query,
          selectedProgramId: previousProgram.id,
        })
      : null;
    return { current, previous };
  }

  private contextYear(context: ReportContext): string {
    if (context.program.year !== null) return String(context.program.year);
    const match = /\d{4}/u.exec(context.program.name);
    return (
      match?.[0] ??
      String(
        context.survey.endsAt?.getUTCFullYear() ??
          context.program.startsAt?.getUTCFullYear() ??
          new Date().getUTCFullYear(),
      )
    );
  }

  private async contextAgreement(context: ReportContext): Promise<number> {
    const questions = await this.benchmarkQuestions(context.survey.id);
    const responses = await this.agreementResponses(
      context.survey.id,
      questions,
    );
    return this.percentage(
      responses,
      questions.map(({ id }) => id),
      [context.organizationId],
    );
  }

  private async annualCategorySnapshot(context: ReportContext): Promise<
    Map<
      string,
      {
        data: ReturnType<CompatibilityReportsService["trendDistribution"]>;
        questionIds: string[];
      }
    >
  > {
    const questions = await this.benchmarkQuestions(context.survey.id);
    const grouped = this.questionsByCategory(questions);
    const respondents = await this.organizationRespondents(context);
    return new Map(
      sortedCategories(grouped.keys()).map((category) => {
        const categoryQuestions = grouped.get(category) ?? [];
        const responses = respondents.flatMap(({ responses: items }) =>
          items.filter((response) =>
            categoryQuestions.some(({ id }) => id === response.questionId),
          ),
        );
        return [
          category,
          {
            data: this.trendDistribution(responses),
            questionIds: categoryQuestions.map(
              (question) =>
                question.legacyId ?? question.externalId ?? question.id,
            ),
          },
        ];
      }),
    );
  }

  private trendDistribution(responses: DetailedResponse[]) {
    const counts = { Agree: 0, Neutral: 0, Disagree: 0 };
    for (const response of responses) {
      const caption = responseCaption(response.value)?.toLowerCase();
      if (!caption || caption === "n/a" || caption === "not applicable") {
        continue;
      }
      const numericCaption = /^-?\d+(?:\.\d+)?$/u.test(caption)
        ? Number(caption)
        : null;
      if (numericCaption === 6 || numericCaption === 99) continue;
      // WRG Likert exports use numeric codes 1–5 for scored answers and 6 for
      // N/A. Exclude any out-of-range code instead of counting it as agreement.
      if (
        response.score === null &&
        numericCaption !== null &&
        (numericCaption < 1 || numericCaption > 5)
      ) {
        continue;
      }
      const score =
        response.score === null ? numericCaption : Number(response.score);
      if (
        caption === "agree" ||
        caption === "strongly agree" ||
        (score !== null && score >= 4)
      ) {
        counts.Agree += 1;
      } else if (
        caption === "disagree" ||
        caption === "strongly disagree" ||
        (score !== null && score <= 2)
      ) {
        counts.Disagree += 1;
      } else {
        counts.Neutral += 1;
      }
    }
    const total = counts.Agree + counts.Neutral + counts.Disagree;
    return (["Agree", "Neutral", "Disagree"] as const).map(
      (ResponseCaption) => {
        const numberOfResponses = counts[ResponseCaption];
        const percentage = total === 0 ? 0 : (numberOfResponses * 100) / total;
        return {
          ResponseCaption,
          numberOfResponses,
          percent: total === 0 ? 0 : numberOfResponses / total,
          percentage,
          colorCode: responseColor(ResponseCaption),
        };
      },
    );
  }

  private emptyTrendDistribution() {
    return this.trendDistribution([]);
  }

  private sectionDistribution(responses: DetailedResponse[]) {
    return this.trendDistribution(responses).map((item) =>
      item.ResponseCaption === "Agree"
        ? { ...item, percentOfAgreement: item.percent }
        : item,
    );
  }

  private selectCategoryQuestions(
    questions: BenchmarkQuestion[],
    category: string,
    references: string[],
  ): BenchmarkQuestion[] {
    const categoryQuestions =
      this.questionsByCategory(questions).get(category.trim()) ?? [];
    if (references.length === 0) return categoryQuestions;
    const referenceSet = new Set(references);
    const selected = categoryQuestions.filter(
      (question) =>
        referenceSet.has(question.id) ||
        Boolean(question.legacyId && referenceSet.has(question.legacyId)) ||
        Boolean(question.externalId && referenceSet.has(question.externalId)),
    );
    return selected.length > 0 ? selected : categoryQuestions;
  }

  private resolveQuestions(
    questions: BenchmarkQuestion[],
    references: string[],
  ): BenchmarkQuestion[] {
    const referenceSet = new Set(references.map((value) => value.trim()));
    const selected = questions.filter(
      (question) =>
        referenceSet.has(question.id) ||
        Boolean(question.legacyId && referenceSet.has(question.legacyId)) ||
        Boolean(question.externalId && referenceSet.has(question.externalId)),
    );
    if (selected.length === 0) {
      throw new NotFoundException("Questions not found");
    }
    return selected;
  }

  private distribution(responses: DetailedResponse[]) {
    const counts = new Map<string, { caption: string; count: number }>();
    for (const response of responses) {
      const caption = responseCaption(response.value);
      if (
        !caption ||
        ["n/a", "not applicable"].includes(caption.toLowerCase())
      ) {
        continue;
      }
      const key = caption.toLowerCase();
      const current = counts.get(key);
      counts.set(key, {
        caption: current?.caption ?? caption,
        count: (current?.count ?? 0) + 1,
      });
    }
    const denominator = [...counts.values()].reduce(
      (sum, item) => sum + item.count,
      0,
    );
    const order = [
      "strongly agree",
      "agree",
      "neither agree nor disagree",
      "neutral",
      "disagree",
      "strongly disagree",
    ];
    return [...counts.values()]
      .sort((left, right) => {
        const leftIndex = order.indexOf(left.caption.toLowerCase());
        const rightIndex = order.indexOf(right.caption.toLowerCase());
        return (
          (leftIndex === -1 ? Number.MAX_SAFE_INTEGER : leftIndex) -
            (rightIndex === -1 ? Number.MAX_SAFE_INTEGER : rightIndex) ||
          left.caption.localeCompare(right.caption)
        );
      })
      .map(({ caption, count }) => ({
        ResponseCaption: caption,
        numberOfResponses: count,
        percent: denominator === 0 ? 0 : (count * 100) / denominator,
        colorCode: responseColor(caption),
      }));
  }

  private detailedDistribution(
    responses: DetailedResponse[],
    question: BenchmarkQuestion,
    programYear?: number | null,
  ) {
    const counts = new Map<string, number>();
    for (const response of responses) {
      const caption = reportResponseCaption(
        response.value,
        question,
        programYear,
      );
      if (!caption || caption === "N/A") continue;
      counts.set(caption, (counts.get(caption) ?? 0) + 1);
    }
    const denominator = [...counts.values()].reduce(
      (sum, count) => sum + count,
      0,
    );
    return responseDetailOptions
      .filter((caption) => caption !== "N/A")
      .map((ResponseCaption) => {
        const numberOfResponses = counts.get(ResponseCaption) ?? 0;
        return {
          ResponseCaption,
          numberOfResponses,
          percent:
            denominator === 0 ? 0 : (numberOfResponses * 100) / denominator,
          colorCode: responseColor(ResponseCaption),
        };
      });
  }

  private positivePercentage(responses: DetailedResponse[]): number {
    let positive = 0;
    let denominator = 0;
    for (const response of responses) {
      const caption = responseCaption(response.value)?.toLowerCase();
      if (!caption || caption === "n/a" || caption === "not applicable") {
        continue;
      }
      const score =
        response.score === null
          ? /^-?\d+(?:\.\d+)?$/u.test(caption)
            ? Number(caption)
            : null
          : Number(response.score);
      if (score === 6 || score === 99) continue;
      denominator += 1;
      if (
        caption === "agree" ||
        caption === "strongly agree" ||
        (score !== null && score >= 4)
      ) {
        positive += 1;
      }
    }
    return denominator === 0 ? 0 : (positive * 100) / denominator;
  }

  private numericMetadata(
    metadata: Prisma.JsonObject,
    ...keys: string[]
  ): number | null {
    for (const key of keys) {
      const value = metadata[key];
      if (typeof value === "number" && Number.isFinite(value)) return value;
      if (
        typeof value === "string" &&
        value.trim() &&
        Number.isFinite(Number(value))
      ) {
        return Number(value);
      }
    }
    return null;
  }

  private styleWorkbook(worksheet: ExcelJS.Worksheet): void {
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2E1065" },
    };
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
  }

  private percentage(
    responses: AgreementResponse[],
    questionIds: string[],
    organizationIds: string[],
  ): number {
    if (questionIds.length === 0 || organizationIds.length === 0) return 0;
    const questionSet = new Set(questionIds);
    const organizationSet = new Set(organizationIds);
    let positive = 0;
    let denominator = 0;
    for (const response of responses) {
      if (
        !questionSet.has(response.questionId) ||
        !response.respondent.organizationId ||
        !organizationSet.has(response.respondent.organizationId)
      ) {
        continue;
      }
      const caption = responseCaption(response.value)?.toLowerCase();
      if (caption === "n/a" || caption === "not applicable") continue;
      const score =
        response.score === null
          ? caption && /^-?\d+(?:\.\d+)?$/u.test(caption)
            ? Number(caption)
            : null
          : Number(response.score);
      denominator += 1;
      if (
        caption === "agree" ||
        caption === "strongly agree" ||
        (score !== null && score >= 4)
      ) {
        positive += 1;
      }
    }
    return denominator === 0 ? 0 : (positive * 100) / denominator;
  }

  private questionsByCategory(
    questions: BenchmarkQuestion[],
  ): Map<string, BenchmarkQuestion[]> {
    const result = new Map<string, BenchmarkQuestion[]>();
    for (const question of questions) {
      const category =
        metadataString(question.metadata, "categoryLabel") ??
        categoryFromDataLabel(question.dataLabel);
      const existing = result.get(category) ?? [];
      existing.push(question);
      result.set(category, existing);
    }
    return result;
  }

  private publishedWorkforce(
    context: ReportContext,
  ): PublishedWorkforceSnapshot | null {
    const published = jsonObject(context.program.metadata).publishedReports;
    if (
      published === null ||
      typeof published !== "object" ||
      Array.isArray(published)
    ) {
      return null;
    }
    const snapshot = published.workforceBenchmark;
    if (
      snapshot === null ||
      typeof snapshot !== "object" ||
      Array.isArray(snapshot)
    ) {
      return null;
    }
    const candidate = snapshot as unknown as PublishedWorkforceSnapshot;
    return Array.isArray(candidate.headers) &&
      Array.isArray(candidate.categories)
      ? candidate
      : null;
  }

  private publishedBenefits(
    context: ReportContext,
  ): BenefitsBestPracticesSnapshot | null {
    return publishedBenefitsBestPracticesSnapshot(context.enrollmentMetadata);
  }

  private publishedHeaders(headers: PublishedReportHeader[]) {
    return headers.map((header) => ({
      ...header,
      subTitle: header.type.endsWith("_No") ? "Non-Winners" : "Winners",
      color: headerColors[header.type.endsWith("_No") ? "No" : "Yes"],
    }));
  }

  private publishedValue(value: number | string): number | string {
    return typeof value === "number" ? value : value; // Do not round numbers
  }

  private tableHeaders(
    groups: BenchmarkGroup[],
  ): Array<Record<string, string>> {
    return groups.map((group) => ({
      title:
        group.size === "All"
          ? "All Size Categories"
          : `${group.size} Employers`,
      type: `${group.size}_${group.winner}`,
      color: headerColors[group.winner],
    }));
  }

  private surveyAverages(
    groups: BenchmarkGroup[],
    questions: BenchmarkQuestion[],
    responses: AgreementResponse[],
  ): Array<Record<string, unknown>> {
    const sizes = [...new Set(groups.map(({ size }) => size))];
    return sizes.map((size) => {
      const result: Record<string, unknown> = {
        title: size === "All" ? "All Size Categories" : `${size} Employers`,
        subTitle: "Survey Average",
      };
      for (const winner of ["Yes", "No"] as const) {
        const group = groups.find(
          (candidate) => candidate.size === size && candidate.winner === winner,
        );
        result[winner] = {
          title: winnerTitles[winner],
          value:
            !group || group.hidden
              ? "x"
              : this.percentage(
                  responses,
                  questions.map(({ id }) => id),
                  group.organizationIds,
                ),
        };
      }
      return result;
    });
  }
}

@ApiTags("reports")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "client", version: VERSION_NEUTRAL })
export class CompatibilityReportsController {
  constructor(
    @Inject(CompatibilityReportsService)
    private readonly reports: CompatibilityReportsService,
  ) {}

  @Get("employeeComparisonReport")
  employeeComparison(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.employeeComparison(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
  }

  @Get("v2/employeeComparisonReport")
  workforceComparison(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.workforceComparison(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
    );
  }

  @Post("getOpenResponsesAnswersReport")
  @HttpCode(200)
  @ApiProduces(
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  )
  @ApiOkResponse({ description: "An Employee Verbatims XLSX workbook." })
  async openResponsesReport(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @BodyDto(OpenResponsesReportDto) body: OpenResponsesReportDto,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workbook = await this.reports.openResponsesWorkbook(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
      body.queryFilter,
    );
    reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .header(
        "content-disposition",
        'attachment; filename="Employee_Verbatims_Report.xlsx"',
      )
      .header("access-control-expose-headers", "*")
      .send(workbook);
  }

  @Get("employeeSectionComparisonReport")
  sectionComparison(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.sectionComparison(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
  }

  @Post("employeeQuestionsSectionComparisonReport")
  @HttpCode(200)
  questionComparison(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @BodyDto(CategoryDto) body: CategoryDto,
  ) {
    return this.reports.questionComparison(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
      body.category,
    );
  }

  @Post("v2/employeeQuestionsSectionComparisonReport")
  @HttpCode(200)
  workforceQuestionComparison(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @BodyDto(CategoryDto) body: CategoryDto,
  ) {
    return this.reports.workforceQuestionComparison(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
      body.category,
    );
  }

  @Post("employeeSectionComparisonWithMeReport")
  @HttpCode(200)
  sectionComparisonWithMe(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @BodyDto(ComparisonWithMeDto) body: ComparisonWithMeDto,
  ) {
    return this.reports.sectionComparisonWithMe(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
      body.selectedCategoryOption,
    );
  }

  @Post("employeeSectionQuestionsComparisonWithMeReport")
  @HttpCode(200)
  questionComparisonWithMe(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @BodyDto(CategoryWithMeDto) body: CategoryWithMeDto,
  ) {
    return this.reports.questionComparisonWithMe(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
      body.category,
      body.selectedCategoryOption,
    );
  }

  @Get("getOpenResponsesQuestions")
  openResponseQuestions(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.openResponseQuestions(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
    );
  }

  @Post("getOpenResponsesAnswers")
  @HttpCode(200)
  openResponseAnswers(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @Query("questionId") questionId: string | string[] | undefined,
    @BodyDto(QueryFilterDto) body: QueryFilterDto,
  ) {
    const reference = scalarQuery("questionId", questionId, true);
    if (!reference) throw new BadRequestException("questionId is required");
    return this.reports.openResponseAnswers(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
      reference,
      body.queryFilter,
    );
  }

  @Post("employeeResponseBreakdown")
  @HttpCode(200)
  responseBreakdown(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @BodyDto(QuestionRangeDto) body: QuestionRangeDto,
  ) {
    return this.reports.responseBreakdown(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
      body.questionRange,
      body.queryFilter,
    );
  }

  @Post("employeeResponseBreakdownBySection")
  @HttpCode(200)
  responseBreakdownBySection(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @BodyDto(QueryFilterDto) body: QueryFilterDto,
  ) {
    return this.reports.responseBreakdownBySection(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
      body.queryFilter,
    );
  }

  @Post("employeeMeanScoreBySection")
  @HttpCode(200)
  meanScoreBySection(
    @CurrentUser() principal: Principal,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @BodyDto(ProgramBodyDto) body: ProgramBodyDto,
  ) {
    return this.reports.meanScoreBySection(
      principal,
      this.reportQuery(body.selectedProgramId, organizationId, isDummy),
    );
  }

  @Post("employeeMeanScoreByQuestions")
  @HttpCode(200)
  meanScoreByQuestions(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @BodyDto(QuestionRangeDto) body: QuestionRangeDto,
  ) {
    return this.reports.meanScoreByQuestions(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, true),
      body.questionRange,
    );
  }

  @Get("fetchSurveyFilter")
  surveyFilters(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.surveyFilters(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
    );
  }

  @Get("employeeAnnualTrends")
  annualTrends(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.unavailableAnnualTrend(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
  }

  @Post("employeeAnnualTrendsBySection")
  @HttpCode(200)
  annualTrendsBySection(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.unavailableAnnualTrend(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
  }

  @Get("surveyResponseRate")
  surveyResponseRate(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.surveyResponseRate(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
  }

  @Get("employeeSurveyResponseInformation")
  surveyInformation(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.surveyInformation(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
  }

  @Get("averagePercentageOfAgreement")
  averageAgreement(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.averageAgreement(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
  }

  @Get("dashboardTopBottomStatements")
  topBottomStatements(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.topBottomStatements(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
  }

  @Get("generateHeatMap")
  async heatMap(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @Query("queryFilter") queryFilter: string | string[] | undefined,
    @Query("patternMode") patternMode: string | string[] | undefined,
    @Query("includePositive") includePositive: string | string[] | undefined,
    @Query("includeNeutral") includeNeutral: string | string[] | undefined,
    @Query("includeNegative") includeNegative: string | string[] | undefined,
    @Query("positiveMin") positiveMin: string | string[] | undefined,
    @Query("positiveMax") positiveMax: string | string[] | undefined,
    @Query("neutralMin") neutralMin: string | string[] | undefined,
    @Query("neutralMax") neutralMax: string | string[] | undefined,
    @Query("negativeMin") negativeMin: string | string[] | undefined,
    @Query("negativeMax") negativeMax: string | string[] | undefined,
    @Query("isPreview") isPreview: string | string[] | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const reportQuery = this.reportQuery(
      selectedProgramId,
      organizationId,
      isDummy,
    );
    const ranges = this.parseResponsePatternRanges({
      patternMode,
      includePositive,
      includeNeutral,
      includeNegative,
      positiveMin,
      positiveMax,
      neutralMin,
      neutralMax,
      negativeMin,
      negativeMax,
    });
    const preview = this.parseBooleanQuery("isPreview", isPreview);
    if (preview) {
      if (!ranges) {
        throw new BadRequestException(
          "At least one response pattern range is required for a preview",
        );
      }
      reply.send(
        await this.reports.feedbackPreview(principal, reportQuery, ranges),
      );
      return;
    }
    const parsedFilter = this.parseQueryFilter(queryFilter);
    const responsePatterns = ranges
      ? [
          ...(ranges.positive
            ? [
                {
                  metric: "agreement" as const,
                  minimum: ranges.positive[0],
                  maximum: ranges.positive[1],
                },
              ]
            : []),
          ...(ranges.neutral
            ? [
                {
                  metric: "agreement" as const,
                  minimum: ranges.neutral[0],
                  maximum: ranges.neutral[1],
                },
              ]
            : []),
          ...(ranges.negative
            ? [
                {
                  metric: "disagreement" as const,
                  minimum: ranges.negative[0],
                  maximum: ranges.negative[1],
                },
              ]
            : []),
        ]
      : undefined;
    const workbook = await this.reports.feedbackWorkbook(
      principal,
      reportQuery,
      false,
      responsePatterns ? { ...parsedFilter, responsePatterns } : parsedFilter,
      ranges,
    );
    this.sendWorkbook(reply, workbook, "Employee_Feedback_Heatmap.xlsx");
  }

  @Post("generateHeatMap")
  @HttpCode(200)
  async heatMapPost(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @Query("queryFilter") queryFilter: string | string[] | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workbook = await this.reports.feedbackWorkbook(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
      false,
      this.parseQueryFilter(queryFilter),
    );
    this.sendWorkbook(reply, workbook, "Employee_Feedback_Heatmap.xlsx");
  }

  @Get("generateHeatMapDetailed")
  async detailedHeatMap(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @Query("queryFilter") queryFilter: string | string[] | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workbook = await this.reports.feedbackWorkbook(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
      true,
      this.parseQueryFilter(queryFilter),
    );
    this.sendWorkbook(reply, workbook, "Employee_Feedback_Detailed.xlsx");
  }

  @Get("generateBenchmarkReport")
  async benchmarkReport(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workbook = await this.reports.benchmarkWorkbook(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
    this.sendWorkbook(reply, workbook, "Benchmark_Report.xlsx");
  }

  @Get("v2/generateBenchmarkReport")
  async workforceBenchmarkReport(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workbook = await this.reports.benchmarkWorkbook(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
    );
    this.sendWorkbook(reply, workbook, "Workforce_Benchmark_Report.xlsx");
  }

  @Get("responseDetailReportSectionQuestions")
  responseDetailSections(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.responseDetailSections(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
    );
  }

  @Post("responseDetailReportQuestionResult")
  @HttpCode(200)
  responseDetailQuestionResult(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @Query("version") version: string | string[] | undefined,
    @BodyDto(ResponseDetailQuestionDto) body: ResponseDetailQuestionDto,
  ) {
    return this.reports.responseDetailQuestionResult(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
      body.QuestionId,
      body.filterQuestion,
      scalarQuery("version", version) ?? "1",
    );
  }

  @Get("responseDetailReportExcel")
  async responseDetailWorkbook(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @Query("filterQuestion")
    filterQuestion: string | string[] | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const selectedFilter = scalarQuery("filterQuestion", filterQuestion);
    const workbook = await this.reports.responseDetailWorkbook(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
      selectedFilter,
    );
    this.sendWorkbook(
      reply,
      workbook,
      selectedFilter
        ? "Response_Detail_Filtered_Report.xlsx"
        : "Response_Detail_Report.xlsx",
    );
  }

  @Get("responseCountByDemographicCategory")
  demographicResponseCounts(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.demographicResponseCounts(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
    );
  }

  @Get("getCustomReport")
  customReports(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.customReports(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
  }

  @Get("employerBenchmarkReportExcel")
  async employerBenchmarkWorkbook(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workbook = await this.reports.employerBenchmarkWorkbook(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
    );
    this.sendWorkbook(reply, workbook, "Benefits_&_Best_Practices.xlsx");
  }

  @Get("employerBenchmarkReport")
  employerBenchmark(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.employerBenchmark(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
    );
  }

  @Get("getWinnersList")
  winnersList(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.winnersList(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
  }

  @Get("getAllUsername")
  clientUsernames(
    @CurrentUser() principal: Principal,
    @Query("projectId") projectId: string | string[] | undefined,
  ) {
    return this.reports.clientUsernames(
      principal,
      scalarQuery("projectId", projectId),
    );
  }

  @Get("deletOrganizationDataToReSync")
  deleteOrganizationForResync(
    @CurrentUser() principal: Principal,
    @Query("accountId") accountId: string | string[] | undefined,
    @Query("username") username: string | string[] | undefined,
  ) {
    const accountReference = scalarQuery("accountId", accountId, true);
    const selectedUsername = scalarQuery("username", username, true);
    if (!accountReference || !selectedUsername) {
      throw new BadRequestException("accountId and username are required");
    }
    return this.reports.deleteOrganizationForResync(
      principal,
      accountReference,
      selectedUsername,
    );
  }

  @Get("replaceValues")
  swapOrganizationCategoryValues(@CurrentUser() principal: Principal) {
    return this.reports.swapOrganizationCategoryValues(principal);
  }

  @Get("getKeyImpactAnalysis")
  keyImpactAnalysis(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.keyImpactAnalysis(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy, false, true),
    );
  }

  @Get("surveyResponseRateAnuualTrend")
  annualResponseRate(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.annualResponseRate(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
  }

  @Get("employeeAnnualTrendsCategory")
  annualCategories(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
  ) {
    return this.reports.annualCategories(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
  }

  @Post("employeeAnnualTrendsDetail")
  @HttpCode(200)
  annualDetails(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @BodyDto(AnnualTrendDetailDto) body: AnnualTrendDetailDto,
  ) {
    return this.reports.annualDetails(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
      body.category,
      body.curruntYear,
      body.prevYear,
    );
  }

  @Post("annualTrensReportDownload")
  @HttpCode(200)
  async annualTrendWorkbook(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId")
    selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workbook = await this.reports.annualTrendWorkbook(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
    this.sendWorkbook(reply, workbook, "Annual_Trends_Report.xlsx");
  }

  private parseQueryFilter(
    value: string | string[] | undefined,
  ): Record<string, unknown> | undefined {
    const raw = scalarQuery("queryFilter", value);
    if (!raw) return undefined;
    try {
      const parsed: unknown = JSON.parse(raw);
      if (
        parsed === null ||
        typeof parsed !== "object" ||
        Array.isArray(parsed)
      ) {
        throw new Error("not an object");
      }
      return parsed as Record<string, unknown>;
    } catch {
      throw new BadRequestException("queryFilter must be a JSON object");
    }
  }

  private parseBooleanQuery(
    name: string,
    value: string | string[] | undefined,
  ): boolean {
    const raw = scalarQuery(name, value);
    if (raw === undefined) return false;
    if (raw !== "true" && raw !== "false") {
      throw new BadRequestException(`${name} must be true or false`);
    }
    return raw === "true";
  }

  private parseResponsePatternRanges(
    input: ResponsePatternQueryInput,
  ): ResponsePatternRanges | undefined {
    const mode = scalarQuery("patternMode", input.patternMode);
    const hasRangeValue = [
      input.positiveMin,
      input.positiveMax,
      input.neutralMin,
      input.neutralMax,
      input.negativeMin,
      input.negativeMax,
    ].some((value) => value !== undefined);
    if (!mode && !hasRangeValue) return undefined;
    if (mode && mode !== "range") {
      throw new BadRequestException("patternMode must be range");
    }

    const parseRange = (
      name: "positive" | "neutral" | "negative",
      includedValue: string | string[] | undefined,
      minimumValue: string | string[] | undefined,
      maximumValue: string | string[] | undefined,
    ): [number, number] | undefined => {
      const included = this.parseBooleanQuery(
        `include${name[0]?.toUpperCase()}${name.slice(1)}`,
        includedValue,
      );
      const rawMinimum = scalarQuery(`${name}Min`, minimumValue);
      const rawMaximum = scalarQuery(`${name}Max`, maximumValue);
      if (!included && rawMinimum === undefined && rawMaximum === undefined) {
        return undefined;
      }
      const minimum = Number(rawMinimum);
      const maximum = Number(rawMaximum);
      if (
        rawMinimum === undefined ||
        rawMaximum === undefined ||
        !Number.isFinite(minimum) ||
        !Number.isFinite(maximum) ||
        minimum < 0 ||
        maximum > 100 ||
        minimum > maximum
      ) {
        throw new BadRequestException(
          `${name}Min and ${name}Max must define a valid 0-100 range`,
        );
      }
      return [minimum, maximum];
    };

    const positive = parseRange(
      "positive",
      input.includePositive,
      input.positiveMin,
      input.positiveMax,
    );
    const neutral = parseRange(
      "neutral",
      input.includeNeutral,
      input.neutralMin,
      input.neutralMax,
    );
    const negative = parseRange(
      "negative",
      input.includeNegative,
      input.negativeMin,
      input.negativeMax,
    );
    if (!positive && !neutral && !negative) return undefined;
    return {
      ...(positive ? { positive } : {}),
      ...(neutral ? { neutral } : {}),
      ...(negative ? { negative } : {}),
    };
  }

  private sendWorkbook(
    reply: FastifyReply,
    workbook: Buffer,
    filename: string,
  ): void {
    reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .header("content-disposition", `attachment; filename="${filename}"`)
      .header("access-control-expose-headers", "*")
      .send(workbook);
  }

  private reportQuery(
    selectedProgramId: string | string[] | undefined,
    organizationId: string | string[] | undefined,
    isDummy: string | string[] | undefined,
    allowCurrentProgram = false,
    allowDummy = false,
  ): ReportQuery {
    const dummy = scalarQuery("isDummy", isDummy);
    if (dummy !== undefined && dummy !== "true" && dummy !== "false") {
      throw new BadRequestException("isDummy must be true or false");
    }
    if (dummy === "true" && !allowDummy) {
      throw new BadRequestException(
        "Dummy data is not supported for this report",
      );
    }
    const selectedOrganizationId = scalarQuery(
      "organizationId",
      organizationId,
    );
    const programId = scalarQuery(
      "selectedProgramId",
      selectedProgramId,
      !allowCurrentProgram,
    );
    if (!programId && !allowCurrentProgram) {
      throw new BadRequestException("Please select a ProgramId");
    }
    return {
      selectedProgramId: programId ?? "",
      ...(selectedOrganizationId
        ? { organizationId: selectedOrganizationId }
        : {}),
      isDummy: dummy === "true",
    };
  }
}

@Module({
  imports: [AuthModule],
  providers: [CompatibilityReportsService],
  controllers: [CompatibilityReportsController],
})
export class CompatibilityReportsModule {}
