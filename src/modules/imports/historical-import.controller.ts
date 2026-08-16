import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Put,
  Req,
  UseGuards,
  VERSION_NEUTRAL,
} from "@nestjs/common";
import { ApiBearerAuth, ApiConsumes, ApiTags } from "@nestjs/swagger";
import type { FastifyRequest } from "fastify";
import {
  CurrentUser,
  JwtAuthGuard,
  type Principal,
} from "../auth/auth.module.js";
import { HistoricalImportService } from "./historical-import.service.js";

interface UploadedPart {
  filename: string;
  mimetype: string;
  buffer: Buffer;
}

async function multipartPayload(
  request: FastifyRequest,
): Promise<{ fields: Record<string, string>; files: Record<string, UploadedPart> }> {
  if (!request.isMultipart()) {
    throw new BadRequestException("multipart/form-data is required");
  }
  const fields: Record<string, string> = {};
  const files: Record<string, UploadedPart> = {};
  for await (const part of request.parts()) {
    if (part.type === "file") {
      files[part.fieldname] = {
        filename: part.filename,
        mimetype: part.mimetype,
        buffer: await part.toBuffer(),
      };
    } else {
      fields[part.fieldname] = String(part.value ?? "");
    }
  }
  return { fields, files };
}

@ApiTags("administration historical import")
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller({ path: "admin/historicalImports", version: VERSION_NEUTRAL })
export class HistoricalImportController {
  constructor(
    @Inject(HistoricalImportService)
    private readonly imports: HistoricalImportService,
  ) {}

  @Post()
  @HttpCode(200)
  createDraft(@CurrentUser() principal: Principal, @Body() body: unknown) {
    return this.imports.createDraft(principal, body).then((data) => ({
      success: true,
      message: "Historical import draft created",
      data,
    }));
  }

  @Put(":importId/metadata")
  @HttpCode(200)
  updateMetadata(
    @CurrentUser() principal: Principal,
    @Param("importId") importId: string,
    @Body() body: unknown,
  ) {
    return this.imports.updateMetadata(principal, importId, body).then((data) => ({
      success: true,
      message: "Historical import metadata saved",
      data,
    }));
  }

  @Post(":importId/workbooks")
  @HttpCode(200)
  @ApiConsumes("multipart/form-data")
  async uploadWorkbooks(
    @CurrentUser() principal: Principal,
    @Param("importId") importId: string,
    @Req() request: FastifyRequest,
  ) {
    const { files } = await multipartPayload(request);
    const resolvedEa = files.eaFile;
    const resolvedEfs = files.efsFile;
    if (!resolvedEa || !resolvedEfs) {
      throw new BadRequestException("Both eaFile and efsFile uploads are required");
    }
    const data = await this.imports.uploadWorkbooks(
      principal,
      importId,
      resolvedEa,
      resolvedEfs,
    );
    return {
      success: true,
      message: "Historical import workbooks uploaded",
      data,
    };
  }

  @Post(":importId/validate")
  @HttpCode(200)
  validate(@CurrentUser() principal: Principal, @Param("importId") importId: string) {
    return this.imports.validate(principal, importId).then((data) => ({
      success: true,
      message: "Historical import validated",
      data,
    }));
  }

  @Post(":importId/commit")
  @HttpCode(200)
  commit(@CurrentUser() principal: Principal, @Param("importId") importId: string) {
    return this.imports.commit(principal, importId).then((data) => ({
      success: true,
      message: "Historical import completed",
      data,
    }));
  }

  @Get(":importId")
  status(@CurrentUser() principal: Principal, @Param("importId") importId: string) {
    return this.imports.getStatus(principal, importId).then((data) => ({
      success: true,
      message: "Historical import status",
      data,
    }));
  }
}
