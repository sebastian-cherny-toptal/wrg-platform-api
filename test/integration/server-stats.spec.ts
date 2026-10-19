import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { ServerStatsService } from "../../src/modules/server-stats/server-stats.service.js";
import { PrismaService } from "../../src/database/prisma.service.js";

// Only an explicitly supplied isolated test database; schema must be migrated first.
const connectionString = process.env.SERVER_STATS_TEST_DATABASE_URL;
test(
  "server stats persists to PostgreSQL, cleans expired samples, and aggregates without merging process runs",
  { skip: !connectionString },
  async () => {
    const previousUrl = process.env.DATABASE_URL;
    process.env.DATABASE_URL = connectionString;
    const prisma = new PrismaService();
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    const now = new Date("2026-10-19T18:10:00Z");
    const stats = new ServerStatsService(prisma);
    const sample = {
      heapUsedMb: 100,
      heapTotalMb: 150,
      heapLimitMb: 3048,
      heapUsedPercent: 3.3,
      rssMb: 200,
      externalMb: 5,
      arrayBuffersMb: 1,
      uptimeSeconds: 60,
      activeRequests: 2,
      gcCount: 1,
      gcDurationMs: 10,
      gcLongestPauseMs: 10,
    };
    let processStartId: string | undefined;
    const otherProcess = randomUUID();
    try {
      await prisma.$connect();
      await stats.capture(sample, new Date("2026-10-19T18:00:05Z"));
      const history = await stats.history(
        { timeStart: "2026-10-19T18:00:00Z", timeEnd: now.toISOString() },
        now,
      );
      const first = history.points.find((point) => point.heapUsedMbAvg === 100);
      assert.ok(
        first,
        "capture must persist an actual sample (write failures are otherwise swallowed)",
      );
      processStartId = first.processStartId;
      const stored = await prisma.serverStat.findFirstOrThrow({
        where: { processStartId },
      });
      await prisma.serverStat.createMany({
        data: [
          {
            ...stored,
            id: randomUUID(),
            capturedAt: new Date("2026-10-19T18:00:35Z"),
            heapUsedMb: 300,
            gcDurationMs: 20,
            gcLongestPauseMs: 20,
          },
          {
            ...stored,
            id: randomUUID(),
            processStartId: otherProcess,
            processStartedAt: new Date("2026-10-19T18:00:45Z"),
            capturedAt: new Date("2026-10-19T18:00:50Z"),
            heapUsedMb: 50,
          },
          {
            ...stored,
            id: randomUUID(),
            capturedAt: new Date("2026-09-18T18:00:00Z"),
          },
        ],
      });
      const query = {
        timeStart: "2026-10-19T18:00:00Z",
        timeEnd: "2026-10-19T18:01:00Z",
        interval: "1m",
      };
      const grouped = await stats.history(query, now);
      assert.equal(grouped.points.length, 2);
      const point = grouped.points.find(
        (row) => row.processStartId === processStartId,
      );
      assert.ok(point);
      assert.equal(point.heapUsedMbAvg, 200);
      assert.equal(point.heapUsedMbMax, 300);
      assert.equal(point.gcCount, 2);
      assert.equal(point.gcDurationMs, 30);
      assert.equal(point.gcLongestPauseMs, 20);
      assert.equal(point.sampleCount, 2);
      assert.equal(point.capturedAt.toISOString(), "2026-10-19T18:00:00.000Z");
      assert.equal(
        (await stats.history({ ...query, processStartId }, now)).points.length,
        1,
      );
      assert.equal(
        (await stats.history({ ...query, instanceId: "x' OR 1=1 --" }, now))
          .points.length,
        0,
      );
      assert.equal(
        (
          await stats.history(
            { ...query, timeStart: query.timeEnd, timeEnd: now.toISOString() },
            now,
          )
        ).points.length,
        0,
      );
      await stats.capture(sample, now);
      assert.equal(
        await prisma.serverStat.count({
          where: {
            processStartId,
            capturedAt: { lt: new Date("2026-09-19T18:10:00Z") },
          },
        }),
        0,
      );
      assert.equal(
        await prisma.serverStat.count({
          where: { processStartId, capturedAt: now },
        }),
        1,
      );
    } finally {
      await prisma.serverStat.deleteMany({
        where: {
          processStartId: {
            in: [otherProcess, ...(processStartId ? [processStartId] : [])],
          },
        },
      });
      await prisma.$disconnect();
    }
  },
);
