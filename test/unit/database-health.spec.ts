import { Module, RequestMethod, VersioningType } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { PrismaService } from "../../src/database/prisma.service.js";
import { DatabaseHealthController } from "../../src/modules/health/health.module.js";

let databaseAvailable = true;
const prismaStub = {
  $queryRaw: () =>
    databaseAvailable
      ? Promise.resolve([{ "?column?": 1 }])
      : Promise.reject(new Error("Database unavailable")),
};

interface HealthBody {
  status: "healthy" | "unhealthy";
  database: "connected" | "disconnected";
  timestamp: string;
  dbState?: unknown;
}

function parseHealthBody(body: string): HealthBody {
  return JSON.parse(body) as HealthBody;
}

@Module({
  controllers: [DatabaseHealthController],
  providers: [{ provide: PrismaService, useValue: prismaStub }],
})
class DatabaseHealthTestModule {}

describe("database health endpoint", () => {
  it("serves GET /health outside the versioned API prefix", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      DatabaseHealthTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix("api", {
      exclude: [{ path: "health", method: RequestMethod.ALL }],
    });
    app.enableVersioning({
      type: VersioningType.URI,
      defaultVersion: "1",
    });

    try {
      await app.init();

      databaseAvailable = true;
      const healthy = await app.inject({ method: "GET", url: "/health" });
      assert.equal(healthy.statusCode, 200);
      const healthyBody = parseHealthBody(healthy.body);
      assert.equal(healthyBody.status, "healthy");
      assert.equal(healthyBody.database, "connected");
      assert.ok(!Number.isNaN(Date.parse(healthyBody.timestamp)));

      databaseAvailable = false;
      const unhealthy = await app.inject({ method: "GET", url: "/health" });
      assert.equal(unhealthy.statusCode, 503);
      const unhealthyBody = parseHealthBody(unhealthy.body);
      assert.equal(unhealthyBody.status, "unhealthy");
      assert.equal(unhealthyBody.database, "disconnected");
      assert.ok(!Number.isNaN(Date.parse(unhealthyBody.timestamp)));
      assert.equal("dbState" in unhealthyBody, false);
    } finally {
      databaseAvailable = true;
      await app.close();
    }
  });
});
