import {
  Module,
  RequestMethod,
  VersioningType,
} from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PingController } from "../../src/modules/health/health.module.js";

@Module({ controllers: [PingController] })
class PingTestModule {}

describe("ping endpoint", () => {
  it("serves GET /ping outside the versioned API prefix", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      PingTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix("api", {
      exclude: [{ path: "ping", method: RequestMethod.ALL }],
    });
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: "1",
    });

    try {
      await app.init();
      const response = await app.inject({ method: "GET", url: "/ping" });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body, "pong");
    } finally {
      await app.close();
    }
  });
});
