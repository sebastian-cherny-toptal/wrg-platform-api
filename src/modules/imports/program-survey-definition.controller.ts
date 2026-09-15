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

@ApiTags("administration program survey definition")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "admin/programs/:programId", version: VERSION_NEUTRAL })
export class ProgramSurveyDefinitionController {
  constructor(
    @Inject(ProgramSurveyDefinitionService)
    private readonly definitions: ProgramSurveyDefinitionService,
  ) {}

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
}
