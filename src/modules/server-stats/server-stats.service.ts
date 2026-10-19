import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
} from "@nestjs/common";
import { Prisma } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { z } from "zod";
import type { HeapMonitor } from "../../common/logging/heap-monitor.js";
import { PrismaService } from "../../database/prisma.service.js";

const RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const SERVER_STATS_INTERVAL_MS = 30000;
const MAX_POINTS = 10000;
const intervals = { "30s": 30, "1m": 60, "5m": 300, "15m": 900, "1h": 3600 };
const querySchema = z
  .object({
    timeStart: z.iso.datetime({ offset: true }).optional(),
    timeEnd: z.iso.datetime({ offset: true }).optional(),
    interval: z.enum(["30s", "1m", "5m", "15m", "1h"]).default("30s"),
    instanceId: z.string().min(1).max(255).optional(),
    processStartId: z.uuid().optional(),
  })
  .strict();

export function parseServerStatsQuery(input: unknown, now = new Date()) {
  const result = querySchema.safeParse(input);
  if (!result.success)
    throw new BadRequestException(z.prettifyError(result.error));
  const timeEnd = result.data.timeEnd ? new Date(result.data.timeEnd) : now;
  const timeStart = result.data.timeStart
    ? new Date(result.data.timeStart)
    : new Date(timeEnd.getTime() - 3600000);
  if (
    timeEnd <= timeStart ||
    timeEnd.getTime() - timeStart.getTime() > RETENTION_MS
  ) {
    throw new BadRequestException(
      "timeStart must precede timeEnd; maximum range is 30 days",
    );
  }
  return { ...result.data, timeStart, timeEnd };
}

type HistorySample = ReturnType<HeapMonitor["historySample"]>;

export interface ServerStatsPoint {
  capturedAt: Date;
  instanceId: string;
  processStartId: string;
  processStartedAt: Date;
  sampleCount: number;
  uptimeSeconds: number;
  heapUsedMbAvg: number;
  heapUsedMbMax: number;
  heapTotalMbMax: number;
  heapLimitMb: number;
  heapUsedPercentAvg: number;
  heapUsedPercentMax: number;
  rssMbAvg: number;
  rssMbMax: number;
  externalMbMax: number;
  arrayBuffersMbMax: number;
  activeRequestsMax: number;
  gcCount: number;
  gcDurationMs: number;
  gcLongestPauseMs: number;
}

@Injectable()
export class ServerStatsService {
  private readonly log = new Logger(ServerStatsService.name);
  private readonly processStartId = randomUUID();
  private readonly processStartedAt = new Date(
    Date.now() - process.uptime() * 1000,
  );
  private readonly instanceId = hostname();
  private timer: NodeJS.Timeout | undefined;
  private writing = false;

  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  start(source: () => HistorySample): void {
    if (this.timer) return;
    this.log.log({
      event: "server_stats_started",
      instanceId: this.instanceId,
      processStartId: this.processStartId,
      processStartedAt: this.processStartedAt,
      intervalSeconds: 30,
      retentionDays: 30,
    });
    const tick = () => {
      void this.capture(source());
    };
    tick();
    this.timer = setInterval(tick, SERVER_STATS_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  onModuleDestroy(): void {
    this.stop();
  }

  async capture(sample: HistorySample, now = new Date()): Promise<void> {
    // One in-flight transaction, no queued samples or retry buffer.
    if (this.writing) {
      this.log.warn({
        event: "server_stats_skipped",
        reason: "write_in_progress",
      });
      return;
    }
    this.writing = true;
    try {
      await this.prisma.$transaction(
        async (tx) => {
          await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
          await tx.serverStat.create({
            data: {
              ...sample,
              capturedAt: now,
              instanceId: this.instanceId,
              processStartId: this.processStartId,
              processStartedAt: this.processStartedAt,
            },
          });
          const cutoff = new Date(now.getTime() - RETENTION_MS);
          // Bound each cleanup batch and avoid competing replicas locking the same rows.
          await tx.$executeRaw`DELETE FROM "ServerStat" WHERE "id" IN (
          SELECT "id" FROM "ServerStat" WHERE "capturedAt" < ${cutoff}
          ORDER BY "capturedAt" LIMIT 1000 FOR UPDATE SKIP LOCKED
        )`;
        },
        { maxWait: 1000, timeout: 7000 },
      );
    } catch {
      this.log.warn({
        event: "server_stats_write_failed",
        message: "sample skipped; heap logs remain available",
      });
    } finally {
      this.writing = false;
    }
  }

  async history(input: unknown, now = new Date()) {
    const query = parseServerStatsQuery(input, now);
    const seconds = intervals[query.interval];
    const cutoff = new Date(now.getTime() - RETENTION_MS);
    const rows = await this.prisma.$transaction(
      async (tx) => {
        await tx.$executeRaw`SET LOCAL statement_timeout = '5000ms'`;
        return tx.$queryRaw<ServerStatsPoint[]>(Prisma.sql`
        SELECT to_timestamp(floor(extract(epoch FROM "capturedAt") / ${seconds}) * ${seconds}) AS "capturedAt",
          "instanceId", "processStartId", "processStartedAt",
          count(*)::integer AS "sampleCount", max("uptimeSeconds")::integer AS "uptimeSeconds",
          avg("heapUsedMb")::double precision AS "heapUsedMbAvg", max("heapUsedMb") AS "heapUsedMbMax",
          max("heapTotalMb") AS "heapTotalMbMax", max("heapLimitMb") AS "heapLimitMb",
          avg("heapUsedPercent")::double precision AS "heapUsedPercentAvg", max("heapUsedPercent") AS "heapUsedPercentMax",
          avg("rssMb")::double precision AS "rssMbAvg", max("rssMb") AS "rssMbMax",
          max("externalMb") AS "externalMbMax", max("arrayBuffersMb") AS "arrayBuffersMbMax",
          max("activeRequests")::integer AS "activeRequestsMax", sum("gcCount")::integer AS "gcCount",
          sum("gcDurationMs")::double precision AS "gcDurationMs", max("gcLongestPauseMs") AS "gcLongestPauseMs"
        FROM "ServerStat"
        WHERE "capturedAt" >= ${query.timeStart} AND "capturedAt" < ${query.timeEnd}
          AND "capturedAt" >= ${cutoff}
          ${query.instanceId ? Prisma.sql`AND "instanceId" = ${query.instanceId}` : Prisma.empty}
          ${query.processStartId ? Prisma.sql`AND "processStartId" = ${query.processStartId}::uuid` : Prisma.empty}
        GROUP BY 1, "instanceId", "processStartId", "processStartedAt"
        ORDER BY 1, "instanceId", "processStartId" LIMIT ${MAX_POINTS + 1}
      `);
      },
      { maxWait: 1000, timeout: 7000 },
    );
    if (rows.length > MAX_POINTS) {
      throw new BadRequestException(
        "More than 10000 points: use a coarser interval, narrower time range, or instanceId/processStartId filter",
      );
    }
    return {
      timeStart: query.timeStart,
      timeEnd: query.timeEnd,
      interval: query.interval,
      sampleIntervalSeconds: 30,
      retentionDays: 30,
      units: { memory: "MiB", duration: "ms", timestamp: "UTC" },
      points: rows,
    };
  }
}
