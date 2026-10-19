import "reflect-metadata";
import { Module, VersioningType } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { NestFactory } from "@nestjs/core";
import { JwtModule, JwtService } from "@nestjs/jwt";
import { PassportModule } from "@nestjs/passport";
import {
  FastifyAdapter,
  type NestFastifyApplication,
} from "@nestjs/platform-fastify";
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { nativeCompatibilityRoutes } from "../../src/config/native-routes.js";
import { PrismaService } from "../../src/database/prisma.service.js";
import {
  JwtAuthGuard,
  JwtStrategy,
} from "../../src/modules/auth/auth.module.js";
import {
  ServerStatsAdminGuard,
  ServerStatsController,
} from "../../src/modules/server-stats/server-stats.module.js";
import {
  parseServerStatsQuery,
  ServerStatsService,
} from "../../src/modules/server-stats/server-stats.service.js";

const now = new Date("2026-10-19T18:00:00Z");
const sample = {
  heapUsedMb: 80,
  heapTotalMb: 95,
  heapLimitMb: 3048,
  heapUsedPercent: 2.6,
  rssMb: 180,
  externalMb: 5,
  arrayBuffersMb: 1,
  uptimeSeconds: 60,
  activeRequests: 0,
  gcCount: 1,
  gcDurationMs: 10,
  gcLongestPauseMs: 10,
};
const secret = "server-stats-tests-only-secret-32-characters";
const prismaStub = {
  user: {
    findUnique: () =>
      Promise.resolve({ status: "ACTIVE", organizationId: null }),
  },
};
let historyCalls = 0;
const historyStub = {
  history: (input: unknown) => {
    historyCalls++;
    return parseServerStatsQuery(input, now);
  },
};
@Module({
  imports: [PassportModule, JwtModule.register({ secret })],
  controllers: [ServerStatsController],
  providers: [
    JwtAuthGuard,
    JwtStrategy,
    ServerStatsAdminGuard,
    {
      provide: ConfigService,
      useValue: {
        get: (key: string) => (key === "JWT_ACCESS_SECRET" ? secret : false),
      },
    },
    { provide: PrismaService, useValue: prismaStub },
    { provide: ServerStatsService, useValue: historyStub },
  ],
})
class StatsTestModule {}

describe("server stats history", () => {
  it("validates dates, timezone offsets, intervals, filters, and maximum ranges", () => {
    const defaults = parseServerStatsQuery({}, now);
    assert.equal(defaults.timeStart.toISOString(), "2026-10-19T17:00:00.000Z");
    assert.equal(defaults.interval, "30s");
    assert.equal(
      parseServerStatsQuery(
        { timeEnd: "2026-10-19T20:00:00+02:00" },
        now,
      ).timeEnd.toISOString(),
      now.toISOString(),
    );
    for (const query of [
      { timeStart: "bad" },
      { timeStart: "2026-10-19T17:00:00" },
      { timeStart: "2026-10-20T00:00:00Z" },
      { timeStart: "2026-09-01T00:00:00Z" },
      { interval: "1m; DROP TABLE" },
      { interval: ["30s", "1h"] },
      { processStartId: "invalid" },
      { instanceId: "x".repeat(256) },
      { unexpected: "yes" },
    ])
      assert.throws(() => parseServerStatsQuery(query, now));
  });

  it("samples every 30 seconds and cancels collection on shutdown", (context) => {
    context.mock.timers.enable({ apis: ["setInterval"] });
    const stats = new ServerStatsService({} as PrismaService);
    const capture = context.mock.method(stats, "capture", async () => {
      await Promise.resolve();
    });
    try {
      stats.start(() => sample);
      stats.start(() => sample);
      assert.equal(capture.mock.callCount(), 1);
      context.mock.timers.tick(29999);
      assert.equal(capture.mock.callCount(), 1);
      context.mock.timers.tick(1);
      assert.equal(capture.mock.callCount(), 2);
      stats.stop();
      context.mock.timers.tick(60000);
      assert.equal(capture.mock.callCount(), 2);
    } finally {
      stats.stop();
    }
  });

  it("allows only one write in flight and recovers after a database failure", async () => {
    let release: (() => void) | undefined;
    let calls = 0;
    const stats = new ServerStatsService({
      $transaction: () => {
        calls++;
        return new Promise<void>((_resolve, reject) => {
          release = () => {
            reject(new Error("offline"));
          };
        });
      },
    } as unknown as PrismaService);
    const first = stats.capture(sample, now);
    await stats.capture(sample, now);
    assert.equal(calls, 1);
    assert.ok(release);
    release();
    await first;
    const next = stats.capture(sample, now);
    assert.equal(calls, 2);
    release();
    await next;
  });

  it("rejects oversized responses instead of returning incomplete graphs", async () => {
    const stats = new ServerStatsService({
      $transaction: () =>
        Promise.resolve(Array.from({ length: 10001 }, () => ({}))),
    } as unknown as PrismaService);
    await assert.rejects(stats.history({}, now), /coarser interval/);
  });

  it("protects the exact native URL with JWT authentication and admin authorization", async () => {
    const app = await NestFactory.create<NestFastifyApplication>(
      StatsTestModule,
      new FastifyAdapter(),
      { logger: false },
    );
    app.setGlobalPrefix("api", { exclude: nativeCompatibilityRoutes });
    app.enableVersioning({ type: VersioningType.URI, defaultVersion: "1" });
    try {
      await app.init();
      historyCalls = 0;
      assert.equal(
        (await app.inject({ method: "GET", url: "/admin/serverStats" }))
          .statusCode,
        401,
      );
      const jwt = app.get(JwtService);
      const token = (roles: string[]) =>
        jwt.sign({
          sub: "test-user",
          organizationId: null,
          permissions: [],
          roles,
        });
      const request = (accessToken: string, suffix = "") =>
        app.inject({
          method: "GET",
          url: `/admin/serverStats${suffix}`,
          headers: { authorization: `Bearer ${accessToken}` },
        });
      assert.equal((await request("invalid-token")).statusCode, 401);
      assert.equal((await request(token(["client"]))).statusCode, 403);
      assert.equal(historyCalls, 0);
      assert.equal((await request(token(["admin"]))).statusCode, 200);
      assert.equal(
        (await request(token(["super_admin"]), "?interval=15m")).statusCode,
        200,
      );
      assert.equal(
        (await request(token(["admin"]), "?interval=bad")).statusCode,
        400,
      );
    } finally {
      await app.close();
    }
  });
});
