import {
  Controller,
  Get,
  InternalServerErrorException,
  Module,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  resolveHttpErrorBody,
  resolveHttpErrorMessage,
  resolveHttpErrorStatus,
  ServerErrorLoggingFilter,
} from "../../src/common/http/server-error-exception.filter.js";

@Controller()
class ErrorTestController {
  @Get("unexpected")
  unexpected(): never {
    throw new Error("database exploded");
  }

  @Get("explicit")
  explicit(): never {
    throw new InternalServerErrorException("Historical import failed");
  }
}

@Module({ controllers: [ErrorTestController] })
class ErrorTestModule {}

describe("server error exception filter", () => {
  it("resolves status and message from HttpException and Error", () => {
    assert.equal(
      resolveHttpErrorStatus(new InternalServerErrorException("import failed")),
      500,
    );
    assert.equal(resolveHttpErrorStatus(new Error("boom")), 500);
    assert.equal(
      resolveHttpErrorMessage(new InternalServerErrorException("import failed")),
      "import failed",
    );
    assert.equal(resolveHttpErrorMessage(new Error("database exploded")), "database exploded");
  });

  it("returns generic client message for unexpected 500 errors", () => {
    assert.deepEqual(resolveHttpErrorBody(new Error("database exploded"), 500), {
      statusCode: 500,
      message: "Internal server error",
    });
  });

  it("preserves explicit HttpException response bodies", () => {
    assert.deepEqual(
      resolveHttpErrorBody(new InternalServerErrorException("import failed"), 500),
      {
        statusCode: 500,
        message: "import failed",
        error: "Internal Server Error",
      },
    );
  });

  it("logs and responds when an unexpected server error is thrown", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      ErrorTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.useGlobalFilters(new ServerErrorLoggingFilter());

    try {
      await app.init();
      const response = await app.inject({ method: "GET", url: "/unexpected" });
      assert.equal(response.statusCode, 500);
      assert.deepEqual(JSON.parse(response.body), {
        statusCode: 500,
        message: "Internal server error",
      });
    } finally {
      await app.close();
    }
  });

  it("returns explicit 500 messages from HttpException", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      ErrorTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.useGlobalFilters(new ServerErrorLoggingFilter());

    try {
      await app.init();
      const response = await app.inject({ method: "GET", url: "/explicit" });
      assert.equal(response.statusCode, 500);
      assert.deepEqual(JSON.parse(response.body), {
        statusCode: 500,
        message: "Historical import failed",
        error: "Internal Server Error",
      });
    } finally {
      await app.close();
    }
  });
});
