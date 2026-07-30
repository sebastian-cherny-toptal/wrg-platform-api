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

const privacyThreshold = 5;
const winnerColors = { Yes: "#00a46a", No: "#ffc955" } as const;
const headerColors = { Yes: "#0f0", No: "#ff0" } as const;
const winnerTitles = { Yes: "Winners", No: "Non-Winners" } as const;
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
          ? this.sampleDistribution(index)
          : this.distribution(
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
              totalNumberOfResponsePerSection: distribution.reduce(
                (sum, item) => sum + item.numberOfResponses,
                0,
              ),
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

  async openResponsesWorkbook(
    principal: Principal,
    query: ReportQuery,
    queryFilter?: Record<string, unknown>,
  ): Promise<Buffer> {
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
      metadata: true,
      project: { select: { name: true } },
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
    accessKey: "WBC_Access" | "EV_Access" | "WFR_Access" | "RD_Access",
  ): boolean {
    if (principal.roles.includes("admin")) return false;
    const access = jsonObject(context.reportAccess);
    const aliases = {
      WBC_Access: "workforceBenchmark",
      EV_Access: "employeeVerbatims",
      WFR_Access: "workforceFeedback",
      RD_Access: "responseDetail",
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
