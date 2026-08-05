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
import { demoUserDemographicResponse } from "./demo-user-demographic-response.js";
import {
  demoUserAnnualCategoryResults,
  demoUserCorePreviousResults,
  demoUserDetailedResults,
  demoUserQuestionById,
} from "./demo-user-detailed-results.js";
import { demoUserResponseBreakdownBySection } from "./demo-user-response-breakdown.js";

const privacyThreshold = 5;
const isDemoUserReport = (principal: Principal, query: ReportQuery) =>
  query.selectedProgramId === "demo-workplace-2025" &&
  (principal.sub === "bypass-login-auth" || principal.sub === "demo-user");
const demoTrendDistribution = (
  values: readonly [number, number, number],
) =>
  (["Agree", "Neutral", "Disagree"] as const).map(
    (ResponseCaption, index) => {
      const percentage = values[index] ?? 0;
      return {
        ResponseCaption,
        numberOfResponses: Math.round((percentage * 199) / 100),
        percent: percentage / 100,
        percentage,
        colorCode: responseColor(ResponseCaption),
      };
    },
  );
const winnerColors = { Yes: "#00a46a", No: "#ffc955" } as const;
const headerColors = { Yes: "#0f0", No: "#ff0" } as const;
const winnerTitles = { Yes: "Winners", No: "Non-Winners" } as const;
const demoBenchmarkCategoryValues: Array<[string, number[]]> = [
  ["Core Employee Experience", [91, 96, 94, 92, 90, 88]],
  ["Your Job", [89, 94, 92, 89, 87, 85]],
  ["Communication and Workplace Culture", [87, 93, 90, 87, 85, 84]],
  ["Relationship With Your Manager", [93, 96, 94, 93, 92, 91]],
  ["Training, Technology and Professional Development", [85, 91, 88, 86, 83, 79]],
  ["Diversity and Inclusion", [92, 94, 91, 92, 91, 91]],
  ["Leadership of this Organization", [87, 93, 91, 88, 84, 81]],
  ["Employee Benefits", [86, 92, 89, 87, 84, 82]],
  ["Work-Life Balance", [85, 91, 88, 86, 83, 81]],
];
const demoWinnerCohortKeys = [
  "AllYes",
  "SmallYes",
  "MediumYes",
  "LargeYes",
  "MajorYes",
  "SuperYes",
] as const;
const categoryOrder = [
  "Core Employee Experience",
  "Your Job",
  "Communication and Workplace",
  "Communication and Workplace Culture",
  "Relationship With Your Manager",
  "Training, Technology and Professional Development",
  "Diversity and Inclusion",
  "Leadership of this Organization",
  "Leadership of this Organisation",
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

interface ReportContext {
  organizationId: string;
  enrollmentId: string;
  reportAccess: Prisma.JsonValue;
  enrollmentMetrics: Prisma.JsonValue;
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
    metrics: Prisma.JsonValue;
    organization: { metadata: Prisma.JsonValue };
  }>;
}

interface BenchmarkQuestion {
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

interface DetailedResponse {
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

interface DetailedRespondent {
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

  async employeeComparison(
    principal: Principal,
    query: ReportQuery,
  ): Promise<{
    success: true;
    message: "success";
    data: Array<Record<string, number>>;
  }> {
    const context = await this.context(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "WBC_Access");
    const questions = await this.benchmarkQuestions(context.survey.id);
    const groups = this.groups(context, isDummy).filter(
      (group) => !group.hidden,
    );
    const responses = isDummy
      ? []
      : await this.agreementResponses(context.survey.id, questions);
    return {
      success: true,
      message: "success",
      data: groups.map((group, index) => ({
        [group.key]: this.percentage(
          responses,
          questions.map(({ id }) => id),
          group.organizationIds,
          isDummy ? this.dummyPercentage(group, index) : undefined,
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
    };
  }> {
    if (isDemoUserReport(principal, query)) {
      const employerSizes = ["All", "Small", "Medium", "Large", "Major", "Super"];
      const tableHeaders = employerSizes.flatMap((size) =>
        (["Yes", "No"] as const).map((winner) => ({
          title: size === "All" ? "All Size Categories" : `${size} Employers`,
          type: `${size}_${winner}`,
          color: headerColors[winner],
        })),
      );
      const detailSection = (title: string) =>
        demoUserDetailedResults.find(
          (section) =>
            section.title === title ||
            (title === "Leadership of this Organization" &&
              section.title === "Leadership"),
        );
      return {
        success: true,
        message: "true",
        data: {
          tableHeaders,
          data: demoBenchmarkCategoryValues.map(([title, winnerValues]) => {
            const section = detailSection(title);
            const averageAgreement = section?.questions.length
              ? section.questions.reduce(
                  (total, question) => total + question.agreement,
                  0,
                ) / section.questions.length
              : 85;
            return {
              title,
              dataValues: winnerValues.flatMap((value) => [value, "x"]),
              nestedData: (section?.questions ?? []).map((question) => ({
                id: question.id,
                title: question.question,
                dataValues: winnerValues.flatMap((value) => [
                  Math.max(
                    1,
                    Math.min(
                      99,
                      Math.round(
                        value + (question.agreement - averageAgreement) * 0.35,
                      ),
                    ),
                  ),
                  "x",
                ]),
              })),
              legends: [
                { color: winnerColors.Yes, title: "Winners" },
                { color: winnerColors.No, title: "Non-Winners" },
              ],
            };
          }),
          surveyAverage: [88, 93, 91, 89, 87, 85].map((value, index) => ({
            title:
              index === 0
                ? "All Size Categories"
                : `${employerSizes[index]} Employers`,
            subTitle: "Survey Average",
            Yes: { title: "Winners", value },
            No: { title: "Non-Winners", value: "x" },
          })),
        },
      };
    }
    const context = await this.context(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "WBC_Access");
    const questions = await this.benchmarkQuestions(context.survey.id);
    const groups = this.groups(context, isDummy);
    const responses = isDummy
      ? []
      : await this.agreementResponses(context.survey.id, questions);
    const questionGroups = this.questionsByCategory(questions);
    const tableHeaders = this.tableHeaders(groups);
    const data = sortedCategories(questionGroups.keys()).map(
      (category, categoryIndex) => {
        const categoryQuestions = questionGroups.get(category) ?? [];
        return {
          title: category,
          nestedData: categoryQuestions.map((question, questionIndex) => ({
            id: question.legacyId ?? question.externalId ?? question.id,
            title: question.caption,
            dataValues: groups.map((group, groupIndex) =>
              group.hidden
                ? "x"
                : this.percentage(
                    responses,
                    [question.id],
                    group.organizationIds,
                    isDummy
                      ? this.dummyPercentage(
                          group,
                          categoryIndex + questionIndex + groupIndex,
                        )
                      : undefined,
                  ),
            ),
          })),
          dataValues: groups.map((group, groupIndex) =>
            group.hidden
              ? "x"
              : this.percentage(
                  responses,
                  categoryQuestions.map(({ id }) => id),
                  group.organizationIds,
                  isDummy
                    ? this.dummyPercentage(group, categoryIndex + groupIndex)
                    : undefined,
                ),
          ),
          legends: Object.entries(winnerTitles).map(([winner, title]) => ({
            color: winnerColors[winner as "Yes" | "No"],
            title,
          })),
        };
      },
    );
    return {
      success: true,
      message: "true",
      data: {
        tableHeaders,
        data,
        surveyAverage: this.surveyAverages(
          groups,
          questions,
          responses,
          isDummy,
        ),
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
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "WBC_Access");
    const questions = await this.benchmarkQuestions(context.survey.id);
    const groups = this.groups(context, isDummy).filter(
      (group) => !group.hidden,
    );
    const responses = isDummy
      ? []
      : await this.agreementResponses(context.survey.id, questions);
    const questionGroups = this.questionsByCategory(questions);
    return {
      success: true,
      message: "success",
      data: sortedCategories(questionGroups.keys()).map(
        (category, categoryIndex) => ({
          category,
          data: groups.map((group, groupIndex) => ({
            [group.key]: this.percentage(
              responses,
              (questionGroups.get(category) ?? []).map(({ id }) => id),
              group.organizationIds,
              isDummy
                ? this.dummyPercentage(group, categoryIndex + groupIndex)
                : undefined,
            ),
          })),
        }),
      ),
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
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "WBC_Access");
    const allQuestions = await this.benchmarkQuestions(context.survey.id);
    const questions =
      this.questionsByCategory(allQuestions).get(category.trim()) ?? [];
    if (questions.length === 0) {
      throw new NotFoundException("Category not found");
    }
    const groups = this.groups(context, isDummy).filter(
      (group) => !group.hidden,
    );
    const responses = isDummy
      ? []
      : await this.agreementResponses(context.survey.id, questions);
    return {
      success: true,
      message: "success",
      data: {
        questionResponse: questions.map((question, questionIndex) => ({
          question: question.caption,
          data: groups.map((group, groupIndex) => ({
            [group.key]: this.percentage(
              responses,
              [question.id],
              group.organizationIds,
              isDummy
                ? this.dummyPercentage(group, questionIndex + groupIndex)
                : undefined,
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
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "WBC_Access");
    const allQuestions = await this.benchmarkQuestions(context.survey.id);
    const questions =
      this.questionsByCategory(allQuestions).get(category.trim()) ?? [];
    if (questions.length === 0) {
      throw new NotFoundException("Category not found");
    }
    const groups = this.groups(context, isDummy);
    const responses = isDummy
      ? []
      : await this.agreementResponses(context.survey.id, questions);
    return {
      success: true,
      message: "true",
      data: {
        tableHeaders: this.tableHeaders(groups),
        tableData: [
          {
            title: category.trim(),
            nestedData: questions.map((question, questionIndex) => ({
              id: question.legacyId ?? question.externalId ?? question.id,
              title: question.caption,
              dataValues: groups.map((group, groupIndex) =>
                group.hidden
                  ? "x"
                  : this.percentage(
                      responses,
                      [question.id],
                      group.organizationIds,
                      isDummy
                        ? this.dummyPercentage(
                            group,
                            questionIndex + groupIndex,
                          )
                        : undefined,
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
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "WBC_Access");
    const questions = await this.benchmarkQuestions(context.survey.id);
    const groups = this.groups(context, isDummy);
    const selected = groups.find(
      (group) =>
        group.key.toLowerCase() === selectedCategoryOption.toLowerCase(),
    );
    if (!selected) throw new BadRequestException("Invalid benchmark category");
    const responses = isDummy
      ? []
      : await this.agreementResponses(context.survey.id, questions);
    const questionGroups = this.questionsByCategory(questions);
    return {
      success: true,
      message: "success",
      data: {
        categoryResponse: sortedCategories(questionGroups.keys()).map(
          (category, categoryIndex) => {
            const questionIds = (questionGroups.get(category) ?? []).map(
              ({ id }) => id,
            );
            return {
              category,
              currentOrg: this.percentage(
                responses,
                questionIds,
                [context.organizationId],
                isDummy ? 76 - (categoryIndex % 6) : undefined,
              ),
              otherOrg:
                selected.hidden && !isDummy
                  ? 0
                  : this.percentage(
                      responses,
                      questionIds,
                      selected.organizationIds,
                      isDummy
                        ? this.dummyPercentage(selected, categoryIndex)
                        : undefined,
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
    if (isDemoUserReport(principal, query)) {
      const normalizedCategory = category.trim();
      const benchmarkCategory =
        normalizedCategory === "Leadership"
          ? "Leadership of this Organization"
          : normalizedCategory;
      const benchmarkValues = demoBenchmarkCategoryValues.find(
        ([title]) => title === benchmarkCategory,
      )?.[1];
      const section = demoUserDetailedResults.find(
        ({ title }) => title === normalizedCategory,
      );
      const cohortIndex = demoWinnerCohortKeys.findIndex(
        (key) => key.toLowerCase() === selectedCategoryOption.toLowerCase(),
      );
      if (!benchmarkValues || !section) {
        throw new NotFoundException("Category not found");
      }
      if (cohortIndex < 0) {
        throw new BadRequestException("Invalid benchmark category");
      }
      const categoryAverage =
        section.questions.reduce(
          (total, question) => total + question.agreement,
          0,
        ) / section.questions.length;
      const cohortAverage = benchmarkValues[cohortIndex] ?? 0;
      return {
        success: true,
        message: "success",
        data: {
          questionResponse: section.questions.map((question) => ({
            question: question.question,
            currentOrg: question.agreement,
            otherOrg: Math.max(
              1,
              Math.min(
                99,
                Math.round(
                  cohortAverage +
                    (question.agreement - categoryAverage) * 0.35,
                ),
              ),
            ),
          })),
        },
      };
    }
    const context = await this.context(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "WBC_Access");
    const allQuestions = await this.benchmarkQuestions(context.survey.id);
    const questions =
      this.questionsByCategory(allQuestions).get(category.trim()) ?? [];
    if (questions.length === 0) {
      throw new NotFoundException("Category not found");
    }
    const groups = this.groups(context, isDummy);
    const selected = groups.find(
      (group) =>
        group.key.toLowerCase() === selectedCategoryOption.toLowerCase(),
    );
    if (!selected) throw new BadRequestException("Invalid benchmark category");
    const responses = isDummy
      ? []
      : await this.agreementResponses(context.survey.id, questions);
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
            isDummy ? 76 - (index % 6) : undefined,
          ),
          otherOrg:
            selected.hidden && !isDummy
              ? 0
              : this.percentage(
                  responses,
                  [question.id],
                  selected.organizationIds,
                  isDummy ? this.dummyPercentage(selected, index) : undefined,
                ),
        })),
      },
    };
  }

  async openResponseQuestions(principal: Principal, query: ReportQuery) {
    if (isDemoUserReport(principal, query)) {
      return {
        success: true,
        message: "success",
        data: [
          { caption: "What are the top two or three reasons people like working for this organization? (2000 character limit)", id: "cohen-open-1", _id: "cohen-open-1", questionNumber: 1 },
          { caption: "What two or three things can this organization add or change to improve employee engagement and success? (2000 character limit)", id: "cohen-open-2", _id: "cohen-open-2", questionNumber: 2 },
        ],
      };
    }
    const context = await this.context(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "EV_Access");
    if (isDummy) {
      return {
        success: true,
        message: "success",
        data: [
          {
            caption:
              "What are the top reasons people like working for this organization?",
            id: "sample-open-1",
            _id: "sample-open-1",
            questionNumber: 1,
          },
          {
            caption:
              "What can this organization change to improve employee engagement?",
            id: "sample-open-2",
            _id: "sample-open-2",
            questionNumber: 2,
          },
        ],
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
    if (isDemoUserReport(principal, query)) {
      const first = questionReference === "cohen-open-1";
      const answers = first
        ? ["The people, collaborative culture, and meaningful work.", "Supportive colleagues and managers.", "Strong benefits and flexibility.", "The variety of projects and opportunities to learn.", "The organization's stability and reputation."]
        : ["Improve communication between departments.", "Provide clearer career paths.", "Reduce unnecessary processes.", "Invest in modern tools and training.", "Keep workloads sustainable during busy periods."];
      return {
        success: true,
        message: "success",
        data: {
          respondentData: answers.map((answer, index) => this.sampleOpenAnswer(`Demo ${index + 1}`, answer)),
          dataLen: answers.length,
          queryQuestion: {
            Caption: first
              ? "What are the top two or three reasons people like working for this organization? (2000 character limit)"
              : "What two or three things can this organization add or change to improve employee engagement and success? (2000 character limit)",
            Id: questionReference,
          },
        },
      };
    }
    const context = await this.context(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "EV_Access");
    if (isDummy) {
      return {
        success: true,
        message: "success",
        data: {
          respondentData: [
            this.sampleOpenAnswer("Sample 1", "Supportive colleagues."),
            this.sampleOpenAnswer("Sample 2", "Flexible working arrangements."),
            this.sampleOpenAnswer("Sample 3", "Strong benefits."),
            this.sampleOpenAnswer("Sample 4", "Opportunities to learn."),
            this.sampleOpenAnswer("Sample 5", "A welcoming culture."),
          ],
          dataLen: 5,
          queryQuestion: {
            Caption: "Sample employee verbatim question",
            Id: questionReference,
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
                Value: value.charAt(0).toUpperCase() + value.slice(1),
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
    if (
      query.selectedProgramId === "demo-workplace-2025" &&
      (principal.sub === "bypass-login-auth" || principal.sub === "demo-user")
    ) {
      return demoUserResponseBreakdownBySection;
    }

    const context = await this.context(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, accessKey);
    const questions = await this.benchmarkQuestions(context.survey.id);
    const respondents = isDummy
      ? []
      : await this.organizationRespondents(context, queryFilter);
    const confidential =
      !isDummy &&
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
      message:
        respondents.length === 0 && !isDummy ? "No data found." : "success",
      isConfidential: false,
      data: sortedCategories(grouped.keys()).map((category, index) => {
        const categoryQuestions = grouped.get(category) ?? [];
        const distribution = isDummy
          ? this.sampleSectionDistribution(index)
          : this.sectionDistribution(
              respondents.flatMap(({ responses }) =>
                responses.filter((response) =>
                  categoryQuestions.some(
                    ({ id }) => id === response.questionId,
                  ),
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
                categoryQuestions.length * (isDummy ? 25 : respondents.length),
              totalRespondents: isDummy ? 25 : respondents.length,
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
    if (
      query.selectedProgramId === "demo-workplace-2025" &&
      (principal.sub === "bypass-login-auth" || principal.sub === "demo-user")
    ) {
      return this.demoResponseBreakdown(questionRange);
    }

    const context = await this.context(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "WFR_Access");
    const questions = await this.benchmarkQuestions(context.survey.id);
    const selected = this.resolveQuestions(questions, questionRange);
    const respondents = isDummy
      ? []
      : await this.organizationRespondents(context, queryFilter);
    if (
      !isDummy &&
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
      data: selected.map((question, index) => ({
        question: question.caption,
        questionId: question.legacyId ?? question.externalId ?? question.id,
        responses: isDummy
          ? this.sampleDistribution(index)
          : this.distribution(
              respondents.flatMap(({ responses }) =>
                responses.filter(
                  (response) => response.questionId === question.id,
                ),
              ),
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
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "WFR_Access");
    const questions = this.resolveQuestions(
      await this.benchmarkQuestions(context.survey.id),
      questionRange,
    );
    const respondents = isDummy
      ? []
      : await this.organizationRespondents(context);
    const sectionTotals = new Map<string, number>();
    const rows = questions.map((question, index) => {
      const responses = isDummy
        ? []
        : respondents.flatMap(({ responses: items }) =>
            items.filter((response) => response.questionId === question.id),
          );
      const distribution = isDummy
        ? this.sampleDistribution(index)
        : this.distribution(responses);
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
        totalNumberOfRespondents: isDummy ? 25 : respondents.length,
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
    const isDummy =
      query.isDummy ||
      (this.requiresDemo(principal, context, "EV_Access") &&
        this.requiresDemo(principal, context, "WFR_Access") &&
        this.requiresDemo(principal, context, "RD_Access"));
    if (isDummy) {
      return {
        success: true,
        message: "success",
        data: [
          {
            QuestionId: "sample-demographic-department",
            filterLabel: "Department",
            type: "Demographics",
            filterOption: [
              { Caption: "Operations" },
              { Caption: "Sales" },
              { Caption: "Technology" },
            ],
          },
        ],
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
        const value = responseCaption(response.value);
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
          filterLabel: categoryFromDataLabel(question.dataLabel)
            .replace(/^Demographics\s*/u, "")
            .trim(),
          type: "Demographics",
          filterOption: [...values]
            .sort((left, right) => left.localeCompare(right))
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
    const completedSurvey =
      this.numericMetadata(metrics, "surveys_completed") ?? completed;
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
          this.numericMetadata(metrics, "response_rate", "Response_Rate") ??
          (sendSurvey === 0
            ? 0
            : Math.round((completedSurvey * 100) / sendSurvey)),
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
          denominator === 0 ? 0 : Math.round((negative * 100) / denominator),
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
  ): Promise<Buffer> {
    const breakdown = await this.responseBreakdownBySection(
      principal,
      query,
      queryFilter,
      detailed ? "RD_Access" : "WFR_Access",
    );
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(
      detailed ? "Detailed Results" : "Feedback Results",
    );
    const responsePatterns = Array.isArray(queryFilter?.responsePatterns)
      ? queryFilter.responsePatterns.filter(
          (item): item is {
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
    if (!detailed && isDemoUserReport(principal, query) && responsePatterns.length) {
      worksheet.columns = [
        { header: "Section", key: "section", width: 42 },
        { header: "Question", key: "question", width: 78 },
        { header: "Agreement", key: "agreement", width: 16 },
        { header: "Neutral", key: "neutral", width: 16 },
        { header: "Disagreement", key: "disagreement", width: 18 },
      ];
      for (const item of demoUserDetailedResults) {
        for (const question of item.questions) {
          const matches = responsePatterns.some((pattern) => {
            const value = question[pattern.metric];
            return value >= pattern.minimum && value <= pattern.maximum;
          });
          if (matches) {
            worksheet.addRow({
              section: item.title,
              question: question.question,
              agreement: question.agreement / 100,
              neutral: question.neutral / 100,
              disagreement: question.disagreement / 100,
            });
          }
        }
      }
      this.styleWorkbook(worksheet);
      return Buffer.from(await workbook.xlsx.writeBuffer());
    }
    if (detailed && isDemoUserReport(principal, query)) {
      worksheet.columns = [
        { header: "Section", key: "section", width: 42 },
        { header: "Question", key: "question", width: 78 },
        { header: "Response", key: "response", width: 18 },
        { header: "Percentage", key: "percentage", width: 16 },
      ];
      for (const item of demoUserDetailedResults) {
        for (const question of item.questions) {
          for (const [response, percentage] of [
            ["Agree", question.agreement],
            ["Neutral", question.neutral],
            ["Disagree", question.disagreement],
          ] as const) {
            worksheet.addRow({
              section: item.title,
              question: question.question,
              response,
              percentage: percentage / 100,
            });
          }
        }
      }
      this.styleWorkbook(worksheet);
      return Buffer.from(await workbook.xlsx.writeBuffer());
    }
    worksheet.columns = [
      { header: "Section", key: "section", width: 42 },
      { header: "Response", key: "response", width: 28 },
      { header: "Percentage", key: "percentage", width: 16 },
    ];
    for (const item of breakdown.data) {
      const section = Object.keys(item)[0];
      if (!section) continue;
      const values = item[section] as Array<Record<string, unknown>>;
      for (const value of values) {
        if (typeof value.ResponseCaption !== "string") continue;
        worksheet.addRow({
          section,
          response: value.ResponseCaption,
          percentage: value.percent,
        });
      }
    }
    this.styleWorkbook(worksheet);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async benchmarkWorkbook(
    principal: Principal,
    query: ReportQuery,
  ): Promise<Buffer> {
    const report = await this.workforceComparison(principal, query);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Benchmark Comparisons");
    const headers = report.data.tableHeaders;
    worksheet.columns = [
      { header: "Section / Question", key: "title", width: 55 },
      ...headers.map((header, index) => ({
        header: header.title ?? `Group ${index + 1}`,
        key: `group${index}`,
        width: 20,
      })),
    ];
    for (const category of report.data.data) {
      worksheet.addRow({
        title: String(category.title),
        ...(category.dataValues as Array<number | string>).reduce(
          (row, value, index) => ({ ...row, [`group${index}`]: value }),
          {},
        ),
      });
      for (const question of category.nestedData as Array<
        Record<string, unknown>
      >) {
        worksheet.addRow({
          title: String(question.title),
          ...(question.dataValues as Array<number | string>).reduce(
            (row, value, index) => ({ ...row, [`group${index}`]: value }),
            {},
          ),
        });
      }
    }
    this.styleWorkbook(worksheet);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async responseDetailSections(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    const questions = await this.benchmarkQuestions(context.survey.id);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "RD_Access");
    if (isDummy) {
      const sampleQuestions =
        questions.length > 0
          ? questions
          : [
              {
                id: "sample-question-1",
                legacyId: null,
                externalId: null,
                dataLabel: "q_YourJob1",
                caption: "I have the tools and resources I need.",
                type: "5",
                position: 1,
                metadata: {},
              },
            ];
      const grouped = this.questionsByCategory(sampleQuestions);
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
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "RD_Access");
    if (isDummy) {
      return {
        success: true,
        message: "success",
        data: [
          ["", "Operations", "Sales", "Technology"],
          [
            "Strongly Agree",
            { percentile: "72%", respondentCount: 18 },
            { percentile: "68%", respondentCount: 17 },
            { percentile: "76%", respondentCount: 19 },
          ],
          [
            "Agree",
            { percentile: "20%", respondentCount: 5 },
            { percentile: "24%", respondentCount: 6 },
            { percentile: "20%", respondentCount: 5 },
          ],
          ["Question Total", "92%", "92%", "96%"],
        ],
      };
    }
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
    const groups = new Map<string, DetailedRespondent[]>();
    for (const respondent of respondents) {
      const filterResponse = respondent.responses.find(
        ({ questionId }) => questionId === filterQuestion.id,
      );
      const caption = filterResponse
        ? responseCaption(filterResponse.value)
        : null;
      if (!caption) continue;
      const existing = groups.get(caption) ?? [];
      existing.push(respondent);
      groups.set(caption, existing);
    }
    const headers = [...groups.keys()].sort((left, right) =>
      left.localeCompare(right),
    );
    const answerOptions = this.questionOptions(question, respondents);
    const data: unknown[][] = [["", ...headers]];
    for (const option of answerOptions) {
      const row: unknown[] = [option];
      for (const header of headers) {
        const group = groups.get(header) ?? [];
        const count = group.filter((respondent) => {
          const answer = respondent.responses.find(
            ({ questionId }) => questionId === question.id,
          );
          return responseCaption(answer?.value ?? null) === option;
        }).length;
        if (group.length < privacyThreshold || count < privacyThreshold) {
          row.push("x");
          continue;
        }
        const percentile = `${Math.round((count * 100) / group.length)}%`;
        row.push(
          version === "1" ? { percentile, respondentCount: count } : percentile,
        );
      }
      data.push(row);
    }
    const totalRow: unknown[] = ["Question Total"];
    for (const header of headers) {
      const group = groups.get(header) ?? [];
      const answered = group.filter((respondent) =>
        respondent.responses.some(
          ({ questionId, value }) =>
            questionId === question.id && Boolean(responseCaption(value)),
        ),
      ).length;
      if (group.length < privacyThreshold || answered < privacyThreshold) {
        totalRow.push("x");
      } else {
        const average = `${Math.round((answered * 100) / respondents.length)}%`;
        totalRow.push(
          version === "1" ? { average, respondentCount: answered } : average,
        );
      }
    }
    data.push(totalRow);
    return { success: true, message: "success", data };
  }

  async responseDetailWorkbook(
    principal: Principal,
    query: ReportQuery,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Response Detail");
    worksheet.columns = [
      { header: "Category", key: "category", width: 42 },
      { header: "Question", key: "question", width: 78 },
      { header: "Response", key: "response", width: 24 },
      { header: "Gen Z", key: "genZ", width: 14 },
      { header: "Millennial", key: "millennial", width: 14 },
      { header: "Gen X", key: "genX", width: 14 },
      { header: "Baby Boomer", key: "boomer", width: 16 },
    ];
    const categories = isDemoUserReport(principal, query)
      ? demoUserDetailedResults
      : [];
    const fallback = categories.length
      ? categories
      : [{ title: "Core Employee Experience", questions: [{ question: "I have the tools and resources I need." }] }];
    const responseRows = [
      ["Strongly Agree", 45, 47, 44, 46],
      ["Agree", 31, 30, 32, 31],
      ["Slightly Agree", 12, 11, 13, 12],
      ["Slightly Disagree", 6, 6, 5, 6],
      ["Disagree", 4, 4, 4, 3],
      ["Strongly Disagree", 2, 2, 2, 2],
    ] as const;
    for (const category of fallback) {
      for (const question of category.questions) {
        for (const [response, genZ, millennial, genX, boomer] of responseRows) {
          worksheet.addRow({ category: category.title, question: question.question, response, genZ: genZ / 100, millennial: millennial / 100, genX: genX / 100, boomer: boomer / 100 });
        }
      }
    }
    this.styleWorkbook(worksheet);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async demographicResponseCounts(principal: Principal, query: ReportQuery) {
    if (
      query.selectedProgramId === "demo-workplace-2025" &&
      (principal.sub === "bypass-login-auth" || principal.sub === "demo-user")
    ) {
      return demoUserDemographicResponse;
    }

    const context = await this.context(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "WFR_Access");
    if (isDummy) {
      return {
        success: true,
        message: "success",
        data: [
          {
            QuestionId: "sample-demographic-department",
            category: "Workplace Demographics",
            categoryLabel: "Department",
            options: [
              { Caption: "Operations", Count: 12 },
              { Caption: "Sales", Count: 9 },
              { Caption: "Technology", Count: 14 },
            ],
          },
          {
            QuestionId: "sample-demographic-gender",
            category: "Personal Demographics",
            categoryLabel: "Gender",
            options: [
              { Caption: "Female", Count: 18 },
              { Caption: "Male", Count: 15 },
              { Caption: "Non-Binary", Count: 5 },
            ],
          },
        ],
      };
    }
    const respondents = await this.organizationRespondents(context);
    const questions = new Map<string, DetailedResponse["question"]>();
    const counts = new Map<string, Map<string, number>>();
    for (const respondent of respondents) {
      for (const response of respondent.responses) {
        if (!this.isDemographicQuestion(response.question)) continue;
        const caption = responseCaption(response.value);
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
          options: [...(counts.get(questionId) ?? new Map<string, number>())]
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([Caption, Count]) => ({ Caption, Count })),
        };
      });
    return { success: true, message: "success", data };
  }

  async customReports(principal: Principal, query: ReportQuery) {
    if (isDemoUserReport(principal, query)) {
      return {
        success: true,
        message: "success",
        data: [{
          _id: "cohen-response-detail-2025",
          ReportTitle: "Cohen & Steers - Response Detail Report",
          ReportDescription: "RDR for Cohen & Steers, using employee survey data from the Best Places Money Management 2025 program.",
          createAt: "2025-11-05T00:00:00.000Z",
          reportFormats: [{ _id: "cohen-response-detail-xlsx", fileName: "Cohen_Steers_Response_Detail_2025.xlsx", filename: "Cohen_Steers_Response_Detail_2025.xlsx", fileUrl: "/v1/client/responseDetailReportExcel?selectedProgramId=demo-workplace-2025" }],
        }],
      };
    }
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
    if (isDemoUserReport(principal, query)) {
      const headers = ["All Winners", "Small Winners", "Medium Winners", "Large Winners", "Major Winners", "Super Winners"];
      const rows: Array<[string, string, number[]]> = [
        ["Does your organization coordinate “Fun” activities?", "Yes", [100, 100, 100, 100, 100, 100]],
        ["Does your organization have a structured system for recognizing achievements, attendance, or safety goals?", "Yes", [86, 83, 80, 88, 89, 100]],
        ["Does your organization formally recognize individual employee milestones?", "Yes", [97, 96, 100, 95, 100, 100]],
        ["Do you have a strategy to recruit and retain a diverse workforce?", "Yes", [89, 91, 84, 91, 100, 80]],
        ["Do you have a strategy specifically focused on recruiting and retaining Generation Z employees?", "Yes", [69, 57, 48, 79, 100, 80]],
        ["Does your organization conduct preemployment screening?", "Yes", [96, 96, 92, 98, 100, 100]],
        ["Which preemployment tools does your organization use?", "Credit history", [61, 32, 74, 63, 78, 80]],
        ["Which preemployment tools does your organization use?", "Criminal background", [99, 95, 100, 100, 100, 100]],
        ["Which preemployment tools does your organization use?", "Education verification", [88, 73, 87, 93, 100, 100]],
        ["Which preemployment tools does your organization use?", "Professional reference", [84, 77, 91, 85, 89, 60]],
      ];
      return {
        success: true,
        message: "true",
        data: {
          tableHeaders: headers.map((title) => ({ title })),
          tableData: [{
            title: "Benefits & Best Practices",
            nestedData: rows.map(([title, answer, dataValues], index) => ({ id: `cohen-practice-${index + 1}`, title, type: "%", nestedData: [{ title: answer, type: "%", dataValues }] })),
          }],
        },
      };
    }
    const context = await this.employerContext(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "BBP_Access");
    const groups = this.groups(context, isDummy);
    if (isDummy) {
      return {
        success: true,
        message: "true",
        data: {
          tableHeaders: this.tableHeaders(groups),
          tableData: [
            {
              title: "Benefits",
              nestedData: [
                {
                  title: "Does your organization offer flexible scheduling?",
                  type: "%",
                  nestedData: [
                    {
                      title: "Yes",
                      type: "%",
                      dataValues: groups.map((group, index) =>
                        this.dummyPercentage(group, index),
                      ),
                    },
                  ],
                },
              ],
            },
          ],
        },
      };
    }
    const questions = await this.employerQuestions(context.survey.id);
    const responses =
      questions.length === 0
        ? []
        : await this.agreementResponses(context.survey.id, questions);
    const groupedQuestions = this.questionsByCategory(questions);
    const tableData = sortedCategories(groupedQuestions.keys()).map(
      (category) => ({
        title: category,
        nestedData: (groupedQuestions.get(category) ?? []).map((question) => {
          const options = [
            ...new Set(
              responses.flatMap((response) => {
                if (response.questionId !== question.id) return [];
                const caption = responseCaption(response.value);
                return caption ? [caption] : [];
              }),
            ),
          ].sort((left, right) => left.localeCompare(right));
          return {
            id: question.legacyId ?? question.externalId ?? question.id,
            title: question.caption,
            type: "%",
            nestedData: options.map((option) => ({
              title: option,
              type: "%",
              dataValues: groups.map((group) =>
                group.hidden
                  ? "x"
                  : this.captionPercentage(
                      responses,
                      question.id,
                      group.organizationIds,
                      option,
                    ),
              ),
            })),
          };
        }),
      }),
    );
    return {
      success: true,
      message: "true",
      data: { tableHeaders: this.tableHeaders(groups), tableData },
    };
  }

  async employerBenchmarkWorkbook(
    principal: Principal,
    query: ReportQuery,
  ): Promise<Buffer> {
    const report = await this.employerBenchmark(principal, query);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Benefits & Best Practices");
    worksheet.columns = [
      { header: "Section / Question / Response", key: "title", width: 62 },
      ...report.data.tableHeaders.map((header, index) => ({
        header: header.title ?? `Group ${index + 1}`,
        key: `group${index}`,
        width: 20,
      })),
    ];
    for (const section of report.data.tableData) {
      worksheet.addRow({ title: section.title });
      for (const question of section.nestedData) {
        worksheet.addRow({ title: question.title });
        for (const answer of question.nestedData) {
          worksheet.addRow({
            title: `  ${answer.title}`,
            ...answer.dataValues.reduce(
              (row, value, index) => ({
                ...row,
                [`group${index}`]: value,
              }),
              {},
            ),
          });
        }
      }
    }
    this.styleWorkbook(worksheet);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async winnersList(principal: Principal, query: ReportQuery) {
    const context = await this.context(principal, query);
    return this.groups(context, false)
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
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "KIA_Access");
    if (isDummy) {
      return {
        success: true,
        message: "success",
        data: {
          data: { signedUrl: null },
          report: [
            {
              label: "Communication",
              key: "Clear communication from leadership",
              value: 86,
            },
            {
              label: "Recognition",
              key: "Employees feel valued",
              value: 78,
            },
            {
              label: "Development",
              key: "Opportunities to grow",
              value: 72,
            },
          ],
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
    if (!asset) throw new NotFoundException("No data found");
    return {
      success: true,
      message: "success",
      data: {
        _id: asset.legacyId ?? asset.id,
        key: asset.key,
        fileName: jsonObject(asset.metadata).fileName,
        report: jsonObject(asset.metadata).report ?? [],
        data: {
          signedUrl: jsonObject(asset.metadata).signedUrl ?? null,
        },
      },
    };
  }

  async annualResponseRate(principal: Principal, query: ReportQuery) {
    if (isDemoUserReport(principal, query)) {
      return {
        success: true,
        message: "survey avg data",
        data: [{ "2025": "83", "2024": "84" }],
      };
    }
    const { current, previous } = await this.annualContexts(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, current, "WFR_Access");
    const currentYear = this.contextYear(current);
    const previousYear = previous
      ? this.contextYear(previous)
      : String(Number(currentYear) - 1);
    if (isDummy) {
      return {
        success: true,
        message: "survey avg data",
        data: [{ [currentYear]: "78", [previousYear]: "74" }],
      };
    }
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
    if (isDemoUserReport(principal, query)) {
      return {
        success: true,
        data: demoUserAnnualCategoryResults.map(
          ([category, current, previous]) => ({
            category: { category },
            "2025": {
              data: demoTrendDistribution(current),
              questionIds:
                demoUserDetailedResults.find((item) => item.title === category)
                  ?.questions.map((question) => question.id) ?? [],
            },
            ...(previous
              ? {
                  "2024": {
                    data: demoTrendDistribution(previous),
                    questionIds:
                      demoUserDetailedResults.find(
                        (item) => item.title === category,
                      )?.questions.map((question) => question.id) ?? [],
                  },
                }
              : {}),
          }),
        ),
      };
    }
    const { current, previous } = await this.annualContexts(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, current, "WFR_Access");
    const currentYear = this.contextYear(current);
    const previousYear = previous
      ? this.contextYear(previous)
      : String(Number(currentYear) - 1);
    if (!previous && !isDummy) {
      return { success: true, data: [] };
    }
    const [currentData, previousData] = await Promise.all([
      this.annualCategorySnapshot(current, isDummy),
      previous
        ? this.annualCategorySnapshot(previous, isDummy)
        : this.annualCategorySnapshot(current, true, 2),
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
    if (isDemoUserReport(principal, query)) {
      const selected = demoUserDetailedResults.find(
        (item) => item.title === category,
      );
      return {
        success: true,
        message: "success",
        category,
        data: (selected?.questions ?? []).map((question, index) => ({
          question: question.question,
          questionId: question.id,
          "2025": {
            question: question.question,
            questionId: question.id,
            responses: demoTrendDistribution([
              question.agreement,
              question.neutral,
              question.disagreement,
            ]),
          },
          ...(category === "Core Employee Experience"
            ? {
                "2024": {
                  question: question.question,
                  questionId: `2024-${question.id}`,
                  responses: demoTrendDistribution(
                    demoUserCorePreviousResults[index] ?? [0, 0, 0],
                  ),
                },
              }
            : {}),
        })),
      };
    }
    const { current, previous } = await this.annualContexts(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, current, "WFR_Access");
    const currentYear = this.contextYear(current);
    const previousYear = previous
      ? this.contextYear(previous)
      : String(Number(currentYear) - 1);
    if (!previous && !isDummy) {
      return { success: true, message: "success", data: [], category };
    }
    const currentQuestions = this.selectCategoryQuestions(
      await this.benchmarkQuestions(current.survey.id),
      category,
      currentReferences,
    );
    const previousQuestions = previous
      ? this.selectCategoryQuestions(
          await this.benchmarkQuestions(previous.survey.id),
          category,
          previousReferences,
        )
      : [];
    const previousByLabel = new Map(
      previousQuestions.map((question) => [question.dataLabel, question]),
    );
    const [currentRespondents, previousRespondents] = isDummy
      ? [[], []]
      : await Promise.all([
          this.organizationRespondents(current),
          previous
            ? this.organizationRespondents(previous)
            : Promise.resolve([]),
        ]);
    const data = currentQuestions.map((question, index) => {
      const previousQuestion = previousByLabel.get(question.dataLabel);
      return {
        question: question.caption,
        questionId: question.legacyId ?? question.externalId ?? question.id,
        [currentYear]: {
          question: question.caption,
          questionId: question.legacyId ?? question.externalId ?? question.id,
          responses: isDummy
            ? this.sampleTrendDistribution(index)
            : this.trendDistribution(
                currentRespondents.flatMap(({ responses }) =>
                  responses.filter(
                    ({ questionId }) => questionId === question.id,
                  ),
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
                responses: isDummy
                  ? this.sampleTrendDistribution(index + 2)
                  : this.trendDistribution(
                      previousRespondents.flatMap(({ responses }) =>
                        responses.filter(
                          ({ questionId }) =>
                            questionId === previousQuestion.id,
                        ),
                      ),
                    ),
              },
            }
          : isDummy
            ? {
                [previousYear]: {
                  question: question.caption,
                  questionId: `sample-previous-${index + 1}`,
                  responses: this.sampleTrendDistribution(index + 2),
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
    const report = await this.annualCategories(principal, query);
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Annual Trends Report");
    const years = [
      ...new Set(
        report.data.flatMap((category) =>
          Object.keys(category).filter((key) => /^\d{4}$/u.test(key)),
        ),
      ),
    ].sort((left, right) => Number(right) - Number(left));
    worksheet.columns = [
      { header: "Section", key: "section", width: 50 },
      ...years.flatMap((year) => [
        { header: `${year} Agreement`, key: `${year}Agree`, width: 18 },
        { header: `${year} Neutral`, key: `${year}Neutral`, width: 18 },
        {
          header: `${year} Disagreement`,
          key: `${year}Disagree`,
          width: 20,
        },
      ]),
    ];
    for (const category of report.data) {
      const row: Record<string, string | number> = {
        section: category.category.category,
      };
      for (const year of years) {
        const snapshot = (category as unknown as Record<string, unknown>)[year] as
          | {
              data: ReturnType<
                CompatibilityReportsService["trendDistribution"]
              >;
            }
          | undefined;
        for (const item of snapshot?.data ?? []) {
          row[`${year}${item.ResponseCaption}`] = item.percentage;
        }
      }
      worksheet.addRow(row);
    }
    this.styleWorkbook(worksheet);
    return Buffer.from(await workbook.xlsx.writeBuffer());
  }

  async openResponsesWorkbook(
    principal: Principal,
    query: ReportQuery,
    queryFilter?: Record<string, unknown>,
  ): Promise<Buffer> {
    if (isDemoUserReport(principal, query)) {
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Employee Verbatims");
      worksheet.columns = [
        { header: "Question", key: "question", width: 78 },
        { header: "Employee Response", key: "answer", width: 82 },
      ];
      const questions = [
        "What are the top two or three reasons people like working for this organization? (2000 character limit)",
        "What two or three things can this organization add or change to improve employee engagement and success? (2000 character limit)",
      ];
      const answers = [
        ["The people, collaborative culture, and meaningful work.", "Supportive colleagues and managers.", "Strong benefits and flexibility."],
        ["Improve communication between departments.", "Provide clearer career paths.", "Invest in modern tools and training."],
      ];
      questions.forEach((question, index) => {
        for (const answer of answers[index] ?? []) worksheet.addRow({ question, answer });
      });
      this.styleWorkbook(worksheet);
      return Buffer.from(await workbook.xlsx.writeBuffer());
    }
    const context = await this.context(principal, query);
    const isDummy =
      query.isDummy || this.requiresDemo(principal, context, "EV_Access");
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Employee Verbatims");
    if (isDummy) {
      worksheet.columns = [
        { header: "Respondent", key: "respondent", width: 18 },
        { header: "What do you value most?", key: "answer", width: 60 },
      ];
      worksheet.addRows([
        { respondent: "Sample 1", answer: "Supportive colleagues" },
        { respondent: "Sample 2", answer: "Flexible working arrangements" },
      ]);
    } else {
      const questions = await this.openQuestions(
        context.survey.id,
        queryFilter,
      );
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
          responses: {
            where: { questionId: { in: questions.map(({ id }) => id) } },
            select: { questionId: true, value: true },
          },
        },
      });
      worksheet.columns = [
        { header: "Respondent", key: "respondent", width: 20 },
        ...questions.map((question) => ({
          header: question.caption,
          key: question.id,
          width: 50,
        })),
      ];
      for (const respondent of respondents) {
        const answers = new Map(
          respondent.responses.map((response) => [
            response.questionId,
            responseCaption(response.value) ?? "",
          ]),
        );
        const row: Record<string, string> = {
          respondent:
            respondent.legacyId ?? respondent.externalId ?? respondent.id,
        };
        for (const question of questions) {
          row[question.id] = safeSpreadsheetValue(
            answers.get(question.id) ?? "",
          );
        }
        worksheet.addRow(row);
      }
    }
    worksheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
    worksheet.getRow(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF2E1065" },
    };
    worksheet.views = [{ state: "frozen", ySplit: 1 }];
    const output = await workbook.xlsx.writeBuffer();
    return Buffer.from(output);
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
      where: { organizationId, programId: program.id },
      select: { id: true, reportAccess: true, metrics: true },
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
        where: { programId: program.id },
        select: {
          organizationId: true,
          metrics: true,
          organization: { select: { metadata: true } },
        },
      },
    );
    return {
      organizationId,
      enrollmentId: enrollment.id,
      reportAccess: enrollment.reportAccess,
      enrollmentMetrics: enrollment.metrics,
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
      | "KIA_Access",
  ): boolean {
    if (principal.roles.includes("admin")) return false;
    const access = jsonObject(context.reportAccess);
    const aliases = {
      WBC_Access: "workforceBenchmark",
      EV_Access: "employeeVerbatims",
      WFR_Access: "workforceFeedback",
      RD_Access: "responseDetail",
      BBP_Access: "benefitsBestPractices",
      KIA_Access: "keyImpactAnalysis",
    } as const;
    const value = access[accessKey] ?? access[aliases[accessKey]];
    return !(
      value === true ||
      (typeof value === "string" && value.trim().toLowerCase() === "yes")
    );
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

  private groups(context: ReportContext, isDummy: boolean): BenchmarkGroup[] {
    if (isDummy) {
      return ["All", "Small"].flatMap((size) =>
        (["Yes", "No"] as const).map((winner) => ({
          key: `${size}${winner}`,
          size,
          winner,
          organizationIds: [],
          hidden: false,
        })),
      );
    }
    const categorized = context.organizationPrograms.flatMap((enrollment) => {
      const winner =
        metadataString(
          enrollment.metrics,
          "Current_Year_Winner",
          "currentYearWinner",
          "winner",
        ) ??
        metadataString(
          enrollment.organization.metadata,
          "Current_Year_Winner",
          "currentYearWinner",
          "winner",
        );
      const category =
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
      const normalizedWinner =
        winner?.toLowerCase() === "yes"
          ? "Yes"
          : winner?.toLowerCase() === "no"
            ? "No"
            : null;
      return normalizedWinner
        ? [
            {
              organizationId: enrollment.organizationId,
              category,
              winner: normalizedWinner,
            },
          ]
        : [];
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
          hidden: organizationIds.length < privacyThreshold,
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
          const caption = responseCaption(response.value)?.toLowerCase();
          return Boolean(
            matchesQuestion && caption && values.includes(caption),
          );
        });
      }),
    );
  }

  private questionOptions(
    question: BenchmarkQuestion,
    respondents: DetailedRespondent[],
  ): string[] {
    const configured = jsonObject(question.metadata).QuestionResponses;
    const metadataOptions = Array.isArray(configured)
      ? configured.flatMap((option) => {
          if (
            option !== null &&
            typeof option === "object" &&
            !Array.isArray(option)
          ) {
            const caption = option.Caption ?? option.caption;
            return typeof caption === "string" ? [caption] : [];
          }
          return typeof option === "string" ? [option] : [];
        })
      : [];
    const observed = respondents.flatMap((respondent) => {
      const response = respondent.responses.find(
        ({ questionId }) => questionId === question.id,
      );
      const caption = response ? responseCaption(response.value) : null;
      return caption ? [caption] : [];
    });
    return [...new Set([...metadataOptions, ...observed])].sort((left, right) =>
      left.localeCompare(right),
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

  private async employerContext(
    principal: Principal,
    query: ReportQuery,
  ): Promise<ReportContext> {
    const context = await this.context(principal, query);
    const surveys = await this.prisma.survey.findMany({
      where: { programId: context.program.id },
      orderBy: [{ endsAt: "desc" }, { createdAt: "desc" }],
      select: {
        id: true,
        title: true,
        startsAt: true,
        endsAt: true,
        metadata: true,
      },
    });
    const survey =
      surveys.find((candidate) => {
        const kind = metadataString(
          candidate.metadata,
          "kind",
          "type",
          "surveyType",
        );
        return (
          Boolean(kind?.toLowerCase().includes("employer")) ||
          candidate.title.toLowerCase().includes("employer")
        );
      }) ?? surveys[0];
    if (!survey) throw new NotFoundException("Employer survey not found");
    return {
      ...context,
      survey: {
        id: survey.id,
        title: survey.title,
        startsAt: survey.startsAt,
        endsAt: survey.endsAt,
      },
    };
  }

  private async employerQuestions(
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
      const type = question.type.toLowerCase();
      return (
        !question.dataLabel.toUpperCase().includes("ORGID") &&
        !question.dataLabel.toLowerCase().includes("demographic") &&
        !type.includes("open") &&
        !type.includes("text")
      );
    });
  }

  private captionPercentage(
    responses: AgreementResponse[],
    questionId: string,
    organizationIds: string[],
    option: string,
  ): number {
    const organizationSet = new Set(organizationIds);
    const scoped = responses.filter(
      (response) =>
        response.questionId === questionId &&
        Boolean(
          response.respondent.organizationId &&
          organizationSet.has(response.respondent.organizationId),
        ),
    );
    const matching = scoped.filter(
      (response) => responseCaption(response.value) === option,
    ).length;
    return scoped.length === 0
      ? 0
      : Math.round((matching * 100) / scoped.length);
  }

  private assertAdmin(principal: Principal): void {
    if (
      !principal.roles.includes("admin") &&
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

  private async annualCategorySnapshot(
    context: ReportContext,
    isDummy: boolean,
    dummyOffset = 0,
  ): Promise<
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
    const respondents = isDummy
      ? []
      : await this.organizationRespondents(context);
    return new Map(
      sortedCategories(grouped.keys()).map((category, index) => {
        const categoryQuestions = grouped.get(category) ?? [];
        const responses = respondents.flatMap(({ responses: items }) =>
          items.filter((response) =>
            categoryQuestions.some(({ id }) => id === response.questionId),
          ),
        );
        return [
          category,
          {
            data: isDummy
              ? this.sampleTrendDistribution(index + dummyOffset)
              : this.trendDistribution(responses),
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
      const score =
        response.score === null
          ? /^-?\d+(?:\.\d+)?$/u.test(caption)
            ? Number(caption)
            : null
          : Number(response.score);
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
        const percentage =
          total === 0 ? 0 : Math.round((numberOfResponses * 100) / total);
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

  private sampleTrendDistribution(offset: number) {
    const agree = 76 - (offset % 5);
    const neutral = 14 + (offset % 3);
    const disagree = 100 - agree - neutral;
    return [
      {
        ResponseCaption: "Agree" as const,
        numberOfResponses: agree,
        percent: agree / 100,
        percentage: agree,
        colorCode: responseColor("Agree"),
      },
      {
        ResponseCaption: "Neutral" as const,
        numberOfResponses: neutral,
        percent: neutral / 100,
        percentage: neutral,
        colorCode: responseColor("Neutral"),
      },
      {
        ResponseCaption: "Disagree" as const,
        numberOfResponses: disagree,
        percent: disagree / 100,
        percentage: disagree,
        colorCode: responseColor("Disagree"),
      },
    ];
  }

  private sectionDistribution(responses: DetailedResponse[]) {
    return this.trendDistribution(responses).map((item) =>
      item.ResponseCaption === "Agree"
        ? { ...item, percentOfAgreement: item.percent }
        : item,
    );
  }

  private sampleSectionDistribution(offset: number) {
    return this.sampleTrendDistribution(offset).map((item) =>
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
        percent:
          denominator === 0
            ? 0
            : Math.round((count * 10000) / denominator) / 100,
        colorCode: responseColor(caption),
      }));
  }

  private sampleDistribution(offset: number) {
    const strongAgree = 7 + (offset % 3);
    const agree = 9 - (offset % 2);
    const neutral = 4;
    const disagree = 3;
    const strongDisagree = 25 - strongAgree - agree - neutral - disagree;
    return [
      ["Strongly Agree", strongAgree],
      ["Agree", agree],
      ["Neither Agree nor Disagree", neutral],
      ["Disagree", disagree],
      ["Strongly Disagree", strongDisagree],
    ].map(([caption, count]) => ({
      ResponseCaption: String(caption),
      numberOfResponses: Number(count),
      percent: Number(count) * 4,
      colorCode: responseColor(String(caption)),
    }));
  }

  private demoResponseBreakdown(questionRange: string[]) {
    return {
      success: true as const,
      message: "success" as const,
      isConfidential: false,
      data: questionRange.map((questionId) => {
        const question = demoUserQuestionById.get(String(questionId));
        const values = question
          ? [question.agreement, question.neutral, question.disagreement]
          : [0, 0, 0];
        return {
          question: question?.question ?? `Question ${questionId}`,
          questionId: String(questionId),
          responses: demoTrendDistribution(values as [number, number, number]),
        };
      }),
    };
  }

  private positivePercentage(responses: DetailedResponse[]): number {
    let positive = 0;
    let denominator = 0;
    for (const response of responses) {
      const caption = responseCaption(response.value)?.toLowerCase();
      if (!caption || caption === "n/a" || caption === "not applicable") {
        continue;
      }
      denominator += 1;
      const score =
        response.score === null
          ? /^-?\d+(?:\.\d+)?$/u.test(caption)
            ? Number(caption)
            : null
          : Number(response.score);
      if (
        caption === "agree" ||
        caption === "strongly agree" ||
        (score !== null && score >= 4)
      ) {
        positive += 1;
      }
    }
    return denominator === 0 ? 0 : Math.round((positive * 100) / denominator);
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

  private sampleOpenAnswer(id: string, value: string) {
    return {
      _id: id,
      RespondentId: id,
      responses: {
        QuestionId: "sample-open-1",
        DataLabel: "OpenEnded_Sample1",
        Value: value,
        ResponseCaption: " ",
      },
    };
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
    dummyValue?: number,
  ): number {
    if (dummyValue !== undefined) return dummyValue;
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
    return denominator === 0 ? 0 : Math.round((positive * 100) / denominator);
  }

  private questionsByCategory(
    questions: BenchmarkQuestion[],
  ): Map<string, BenchmarkQuestion[]> {
    const result = new Map<string, BenchmarkQuestion[]>();
    for (const question of questions) {
      const category = categoryFromDataLabel(question.dataLabel);
      const existing = result.get(category) ?? [];
      existing.push(question);
      result.set(category, existing);
    }
    return result;
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
    isDummy: boolean,
  ): Array<Record<string, unknown>> {
    const sizes = [...new Set(groups.map(({ size }) => size))];
    return sizes.map((size, sizeIndex) => {
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
                  isDummy ? this.dummyPercentage(group, sizeIndex) : undefined,
                ),
        };
      }
      return result;
    });
  }

  private dummyPercentage(group: BenchmarkGroup, offset: number): number {
    const base = group.winner === "Yes" ? 78 : 63;
    return base - (offset % 7);
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
      this.reportQuery(selectedProgramId, organizationId, isDummy),
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
      this.reportQuery(selectedProgramId, organizationId, isDummy),
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
      this.reportQuery(selectedProgramId, organizationId, isDummy),
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
      this.reportQuery(selectedProgramId, organizationId, isDummy),
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
      this.reportQuery(selectedProgramId, organizationId, isDummy),
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
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workbook = await this.reports.feedbackWorkbook(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
      false,
      this.parseQueryFilter(queryFilter),
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
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workbook = await this.reports.feedbackWorkbook(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
      false,
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
      this.reportQuery(selectedProgramId, organizationId, isDummy),
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
      this.reportQuery(selectedProgramId, organizationId, isDummy),
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
      this.reportQuery(selectedProgramId, organizationId, isDummy),
      body.QuestionId,
      body.filterQuestion,
      scalarQuery("version", version) ?? "1",
    );
  }

  @Get("responseDetailReportExcel")
  async responseDetailWorkbook(
    @CurrentUser() principal: Principal,
    @Query("selectedProgramId") selectedProgramId: string | string[] | undefined,
    @Query("organizationId") organizationId: string | string[] | undefined,
    @Query("isDummy") isDummy: string | string[] | undefined,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const workbook = await this.reports.responseDetailWorkbook(
      principal,
      this.reportQuery(selectedProgramId, organizationId, isDummy),
    );
    this.sendWorkbook(reply, workbook, "Response_Detail_Report.xlsx");
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
      this.reportQuery(selectedProgramId, organizationId, isDummy),
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
      this.reportQuery(selectedProgramId, organizationId, isDummy),
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
      this.reportQuery(selectedProgramId, organizationId, isDummy),
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
      this.reportQuery(selectedProgramId, organizationId, isDummy),
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
  ): ReportQuery {
    const dummy = scalarQuery("isDummy", isDummy);
    if (dummy !== undefined && dummy !== "true" && dummy !== "false") {
      throw new BadRequestException("isDummy must be true or false");
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
