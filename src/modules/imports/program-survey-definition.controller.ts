import {
  BadRequestException,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  Res,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import { ProgramSurveyDefinitionService } from "./program-survey-definition.service.js";
import { HistoricalImportService } from "./historical-import.service.js";

@ApiTags("administration program survey definition")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "admin/programs/:programId", version: VERSION_NEUTRAL })
export class ProgramSurveyDefinitionController {
  constructor(
    @Inject(ProgramSurveyDefinitionService)
    private readonly definitions: ProgramSurveyDefinitionService,
    @Inject(HistoricalImportService)
    private readonly imports: HistoricalImportService,
  ) {}

  @Post("efs/preview")
  @HttpCode(200)
  @ApiConsumes("multipart/form-data")
  async previewEfs(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
    @Req() request: FastifyRequest,
  ) {
    const { file } = await this.efsPayload(request);
    return {
      success: true,
      data: await this.imports.reuploadProgramEfs(principal, programId, file),
    };
  }

  @Post("efs")
  @HttpCode(200)
  @ApiConsumes("multipart/form-data")
  async saveEfs(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
    @Req() request: FastifyRequest,
  ) {
    const { file, revision } = await this.efsPayload(request);
    if (!revision)
      throw new BadRequestException("Review the EFS before saving");
    return {
      success: true,
      data: await this.imports.reuploadProgramEfs(
        principal,
        programId,
        file,
        revision,
      ),
    };
  }

  private async efsPayload(request: FastifyRequest) {
    if (!request.isMultipart())
      throw new BadRequestException("multipart/form-data is required");
    let file:
      { filename: string; mimetype: string; buffer: Buffer } | undefined;
    let revision: string | undefined;
    for await (const part of request.parts()) {
      if (part.type === "file" && part.fieldname === "efsFile") {
        if (file) throw new BadRequestException("Upload exactly one efsFile");
        file = {
          filename: part.filename,
          mimetype: part.mimetype,
          buffer: await part.toBuffer(),
        };
      } else if (part.type === "field" && part.fieldname === "revision")
        revision = String(part.value);
      else
        throw new BadRequestException(
          "Upload one efsFile and its review revision",
        );
    }
    if (!file) throw new BadRequestException("Upload an efsFile");
    return { file, revision };
  }

  @Get("survey-definition.xlsx")
  async download(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
    @Res() reply: FastifyReply,
  ) {
    const bytes = await this.definitions.download(principal, programId);
    reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .header(
        "content-disposition",
        'attachment; filename="Questions_and_Answers.xlsx"',
      )
      .header("access-control-expose-headers", "*")
      .header("cache-control", "no-store")
      .send(bytes);
  }

  @Post("survey-definition")
  @HttpCode(200)
  @ApiConsumes("multipart/form-data")
  async upload(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!request.isMultipart())
      throw new BadRequestException("multipart/form-data is required");
    const file = await request.file();
    if (file?.fieldname !== "surveyDefinitionFile")
      throw new BadRequestException("Upload a surveyDefinitionFile");
    const data = await this.definitions.upload(
      principal,
      programId,
      file.filename,
      await file.toBuffer(),
    );
    return {
      success: true,
      message: data.unchanged
        ? "Questions and Answers are unchanged"
        : "Questions and Answers updated",
      data,
    };
  }

  @Get("employer-assessment-definition.xlsx")
  async downloadEmployerAssessment(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
    @Res() reply: FastifyReply,
  ) {
    const bytes = await this.definitions.downloadEmployerAssessment(
      principal,
      programId,
    );
    reply
      .header(
        "content-type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      )
      .header(
        "content-disposition",
        'attachment; filename="EA_Questions_and_Answers.xlsx"',
      )
      .header("access-control-expose-headers", "*")
      .header("cache-control", "no-store")
      .send(bytes);
  }

  @Post("employer-assessment-definition")
  @HttpCode(200)
  @ApiConsumes("multipart/form-data")
  async uploadEmployerAssessment(
    @CurrentUser() principal: Principal,
    @Param("programId") programId: string,
    @Req() request: FastifyRequest,
  ) {
    if (!request.isMultipart())
      throw new BadRequestException("multipart/form-data is required");
    const file = await request.file();
    if (file?.fieldname !== "employerAssessmentDefinitionFile")
      throw new BadRequestException(
        "Upload an employerAssessmentDefinitionFile",
      );
    const data = await this.definitions.uploadEmployerAssessment(
      principal,
      programId,
      file.filename,
      await file.toBuffer(),
    );
    return {
      success: true,
      message: data.unchanged
        ? "EA Questions and Answers are unchanged"
        : "EA Questions and Answers updated",
      data,
    };
  }
}
