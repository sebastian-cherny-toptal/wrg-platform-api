import type { FastifyBaseLogger, FastifyReply, FastifyRequest } from "fastify";
import type { HeapProfiler } from "node:inspector";
import { Session } from "node:inspector/promises";
import { hostname } from "node:os";
import { PerformanceObserver } from "node:perf_hooks";
import { getHeapSpaceStatistics, getHeapStatistics } from "node:v8";

const MIB = 1024 * 1024;
const mb = (bytes: number): number => Math.round((bytes / MIB) * 100) / 100;

export function readHeapMemory() {
  const memory = process.memoryUsage();
  const heapLimit = getHeapStatistics().heap_size_limit;
  return {
    heapUsedMb: mb(memory.heapUsed),
    heapTotalMb: mb(memory.heapTotal),
    heapLimitMb: mb(heapLimit),
    heapUsedPercent: Math.round((memory.heapUsed / heapLimit) * 1000) / 10,
    rssMb: mb(memory.rss),
    externalMb: mb(memory.external),
    arrayBuffersMb: mb(memory.arrayBuffers),
  };
}

interface Allocation {
  estimatedLiveMb: number;
  stack: string[];
}

/** Bounded output: allocation locations and callers, never object values. */
export function topHeapAllocations(profile: HeapProfiler.SamplingHeapProfile) {
  const top: Allocation[] = [];
  const pending = [{ node: profile.head, callers: [] as string[] }];
  let totalBytes = 0;
  while (pending.length) {
    const current = pending.pop();
    if (!current) break;
    const { node, callers } = current;
    const frame = node.callFrame;
    // Strip URL queries/fragments; source paths are enough to locate code.
    const location =
      `${frame.functionName || "(anonymous)"} (${frame.url.split(/[?#]/, 1)[0] ?? ""}:${frame.lineNumber + 1}:${frame.columnNumber + 1})`.slice(
        0,
        500,
      );
    const stack = [...callers.slice(-4), location];
    totalBytes += node.selfSize;
    if (node.selfSize > 0) {
      top.push({ estimatedLiveMb: mb(node.selfSize), stack });
      top.sort((a, b) => b.estimatedLiveMb - a.estimatedLiveMb);
      if (top.length > 20) top.pop();
    }
    for (const child of node.children)
      pending.push({ node: child, callers: stack });
  }
  return { estimatedLiveMb: mb(totalBytes), topAllocations: top };
}

interface Options {
  intervalMs: number;
  warnPercent: number;
  requestGrowthMb: number;
  allocationSampling: boolean;
}

interface ActiveRequest {
  startedAt: number;
  method: string;
  route: string;
  requestId: string;
}

interface RequestMemory {
  heapUsedMb: number;
  metadata: ActiveRequest;
  detach: () => void;
}

export class HeapMonitor {
  private readonly log: FastifyBaseLogger;
  private readonly requests = new WeakMap<FastifyRequest, RequestMemory>();
  private readonly active = new Set<ActiveRequest>();
  private activeCount = 0;
  private timer: NodeJS.Timeout | undefined;
  private observer: PerformanceObserver | undefined;
  private session: Session | undefined;
  private samplingBusy = false;
  private gc = { count: 0, durationMs: 0, longestPauseMs: 0 };
  private previousHeapMb: number | undefined;

  constructor(
    log: FastifyBaseLogger,
    private readonly options: Options,
  ) {
    this.log = log.child({
      component: "heap_monitor",
      instance: hostname(),
      processId: process.pid,
    });
  }

  async start(): Promise<void> {
    this.observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        this.gc.count++;
        this.gc.durationMs += entry.duration;
        this.gc.longestPauseMs = Math.max(
          this.gc.longestPauseMs,
          entry.duration,
        );
      }
    });
    this.observer.observe({ entryTypes: ["gc"] });
    if (this.options.allocationSampling) {
      const session = new Session();
      try {
        session.connect();
        await session.post("HeapProfiler.startSampling", {
          samplingInterval: MIB,
        });
        this.session = session;
        this.log.info(
          { event: "heap_sampling_started", samplingIntervalBytes: MIB },
          "heap allocation sampling enabled",
        );
      } catch {
        session.disconnect();
        this.log.warn(
          { event: "heap_sampling_error" },
          "could not start heap allocation sampling; memory monitoring remains enabled",
        );
      }
    }
    this.report();
    this.timer = setInterval(() => {
      this.report();
    }, this.options.intervalMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.observer?.disconnect();
    this.session?.disconnect();
    this.session = undefined;
    this.active.clear();
  }

  beginRequest(request: FastifyRequest, reply: FastifyReply): void {
    const onClose = () => {
      this.endRequest(request);
    };
    const metadata: ActiveRequest = {
      startedAt: Date.now(),
      method: request.method,
      route: (request.routeOptions.url ?? "unmatched").slice(0, 200),
      requestId: request.id.slice(0, 128),
    };
    const state: RequestMemory = {
      heapUsedMb: mb(process.memoryUsage().heapUsed),
      metadata,
      detach: () => {
        reply.raw.removeListener("close", onClose);
      },
    };
    this.requests.set(request, state);
    this.activeCount++;
    // Bound retained metadata even when requests hang. Never retain payloads here.
    if (this.active.size < 100) this.active.add(metadata);
    reply.raw.once("close", onClose);
  }

  endRequest(request: FastifyRequest) {
    const state = this.requests.get(request);
    if (!state) return undefined;
    this.requests.delete(request);
    this.active.delete(state.metadata);
    this.activeCount--;
    state.detach();
    const memory = readHeapMemory();
    const result = {
      ...memory,
      heapStartMb: state.heapUsedMb,
      heapDeltaMb:
        Math.round((memory.heapUsedMb - state.heapUsedMb) * 100) / 100,
      activeRequests: this.activeCount,
    };
    if (result.heapDeltaMb >= this.options.requestGrowthMb) {
      this.log.warn(
        {
          event: "heap_request_growth",
          ...state.metadata,
          durationMs: Date.now() - state.metadata.startedAt,
          ...result,
        },
        "process heap grew during request; concurrent work and GC also affect this delta",
      );
    }
    return result;
  }

  report(): void {
    const memory = readHeapMemory();
    const record = {
      event: "heap_status",
      uptimeSeconds: Math.round(process.uptime()),
      ...memory,
      heapDeltaMb:
        this.previousHeapMb === undefined
          ? 0
          : Math.round((memory.heapUsedMb - this.previousHeapMb) * 100) / 100,
      activeRequests: this.activeCount,
      activeRequestSample: [...this.active].slice(0, 10).map((state) => ({
        requestId: state.requestId,
        method: state.method,
        route: state.route,
        ageMs: Date.now() - state.startedAt,
      })),
      gc: {
        count: this.gc.count,
        durationMs: Math.round(this.gc.durationMs),
        longestPauseMs: Math.round(this.gc.longestPauseMs),
      },
      spaces: getHeapSpaceStatistics().map((space) => ({
        name: space.space_name,
        usedMb: mb(space.space_used_size),
        sizeMb: mb(space.space_size),
      })),
    };
    this.previousHeapMb = memory.heapUsedMb;
    this.gc = { count: 0, durationMs: 0, longestPauseMs: 0 };
    if (memory.heapUsedPercent >= this.options.warnPercent) {
      this.log.warn(record, "heap memory pressure");
    } else {
      this.log.info(record, "heap memory status");
    }
    // Avoid materializing a profile when the process is already near its limit.
    if (
      this.session &&
      memory.heapUsedPercent < this.options.warnPercent &&
      !this.samplingBusy
    ) {
      void this.reportAllocations(this.session);
    }
  }

  private async reportAllocations(session: Session): Promise<void> {
    this.samplingBusy = true;
    try {
      const { profile } = await session.post("HeapProfiler.getSamplingProfile");
      if (this.session !== session) return;
      this.log.info(
        { event: "heap_allocations", ...topHeapAllocations(profile) },
        "estimated live allocations sampled since profiler startup",
      );
    } catch {
      if (this.session)
        this.log.warn(
          { event: "heap_sampling_error" },
          "could not read heap allocation profile",
        );
    } finally {
      this.samplingBusy = false;
    }
  }
}
