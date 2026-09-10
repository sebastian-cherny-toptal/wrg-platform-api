import {
  BadRequestException,
  Controller,
  HttpCode,
  Inject,
  Post,
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

async function multipartPayload(request: FastifyRequest): Promise<{
  fields: Record<string, string>;
  files: Record<string, UploadedPart>;
}> {
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

  @Post("commit")
  @HttpCode(200)
  @ApiConsumes("multipart/form-data")
  async submit(
    @CurrentUser() principal: Principal,
    @Req() request: FastifyRequest,
  ) {
    const { fields, files } = await multipartPayload(request);
    let metadata: unknown;
    try {
      metadata = JSON.parse(fields.metadata ?? "");
    } catch {
      throw new BadRequestException(
        "Valid historical import metadata is required",
      );
    }
    const data = await this.imports.submit(principal, metadata, {
      ...(files.eaFile ? { eaFile: files.eaFile } : {}),
      ...(files.efsFile ? { efsFile: files.efsFile } : {}),
      ...(files.rankingFile ? { rankingFile: files.rankingFile } : {}),
    });
    return {
      success: true,
      message: "Historical import completed",
      data,
    };
  }
}
