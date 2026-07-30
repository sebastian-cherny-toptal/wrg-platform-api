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
import { DeployCheckController } from "../../src/modules/health/health.module.js";

@Module({ controllers: [DeployCheckController] })
class DeployCheckTestModule {}

describe("deploy-check endpoint", () => {
  it("serves GET /deploy-check outside the versioned API prefix", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      DeployCheckTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix("api", {
      exclude: [{ path: "deploy-check", method: RequestMethod.ALL }],
    });
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: "1",
    });

    try {
      await app.init();
      const response = await app.inject({
        method: "GET",
        url: "/deploy-check",
      });

      assert.equal(response.statusCode, 200);
      assert.equal(response.body, "Hello! Deployed something");
    } finally {
      await app.close();
    }
  });
});
