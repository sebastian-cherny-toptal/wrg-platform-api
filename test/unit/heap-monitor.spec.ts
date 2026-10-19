import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { HeapProfiler } from "node:inspector";
import { describe, it } from "node:test";
import Fastify from "fastify";
import type { FastifyReply, FastifyRequest } from "fastify";
import {
  HeapMonitor,
  readHeapMemory,
  topHeapAllocations,
} from "../../src/common/logging/heap-monitor.js";

function fixture(allocationSampling = false, warnPercent = 80) {
  const logs: Record<string, unknown>[] = [];
  const server = Fastify({
    logger: {
      stream: {
        write(line: string) {
          logs.push(JSON.parse(line) as Record<string, unknown>);
        },
      },
    },
  });
  const monitor = new HeapMonitor(server.log, {
    intervalMs: 1000,
    warnPercent,
    requestGrowthMb: 50,
    allocationSampling,
  });
  server.addHook("onRequest", (request, reply, done) => {
    monitor.beginRequest(request, reply);
    done();
  });
  server.addHook("onResponse", (request, reply, done) => {
    request.log.info({ memory: monitor.endRequest(request) });
    done();
  });
  server.addHook("onReady", async () => {
    await monitor.start();
  });
  server.addHook("onClose", (_instance, done) => {
    monitor.stop();
    done();
  });
  server.get("/work/:id", () => ({ ok: true }));
  return { server, monitor, logs };
}

describe("heap diagnostics", () => {
  it("reads real process memory and the configured V8 limit", () => {
    const memory = readHeapMemory();
    assert.ok(memory.heapUsedMb > 0);
    assert.ok(memory.heapLimitMb > memory.heapUsedMb);
    assert.ok(memory.rssMb > 0);
  });

  it("logs memory, cleans up completed requests, and excludes request values", async () => {
    const { server, monitor, logs } = fixture();
    try {
      const response = await server.inject("/work/private-id?token=do-not-log");
      assert.equal(response.statusCode, 200);
      monitor.report();
      const statuses = logs.filter((log) => log.event === "heap_status");
      assert.ok(statuses.length >= 2);
      assert.equal(statuses.at(-1)?.activeRequests, 0);
      assert.deepEqual(statuses.at(-1)?.activeRequestSample, []);
      assert.ok(logs.some((log) => log.memory !== undefined));
      assert.ok(!JSON.stringify(statuses).includes("do-not-log"));
    } finally {
      await server.close();
    }
  });

  it("removes aborted requests exactly once and logs only bounded route metadata", async () => {
    const { server, monitor, logs } = fixture();
    await server.ready();
    const raw = new EventEmitter();
    const request = {
      id: "r1",
      method: "GET",
      routeOptions: { url: "/work/:id" },
      body: { secret: "do-not-log" },
    } as unknown as FastifyRequest;
    const reply = { raw } as unknown as FastifyReply;
    try {
      monitor.beginRequest(request, reply);
      monitor.report();
      assert.equal(logs.at(-1)?.activeRequests, 1);
      assert.ok(!JSON.stringify(logs.at(-1)).includes("do-not-log"));
      raw.emit("close");
      assert.equal(monitor.endRequest(request), undefined);
      monitor.report();
      assert.equal(logs.at(-1)?.activeRequests, 0);
      assert.equal(raw.listenerCount("close"), 0);
    } finally {
      await server.close();
    }
  });

  it("caps allocation output and preserves callers without source URL secrets", () => {
    const node = (
      name: string,
      selfSize: number,
    ): HeapProfiler.SamplingHeapProfileNode => ({
      callFrame: {
        functionName: name,
        scriptId: "1",
        url: "file:///app/report.js?secret=hidden",
        lineNumber: 9,
        columnNumber: 0,
      },
      selfSize,
      children: [],
    });
    const root = node("root", 0);
    root.children = Array.from({ length: 30 }, (_, index) =>
      node(`allocator${index}`, (index + 1) * 1024 * 1024),
    );
    const summary = topHeapAllocations({ head: root });
    assert.equal(summary.topAllocations.length, 20);
    assert.equal(summary.topAllocations[0]?.estimatedLiveMb, 30);
    assert.equal(summary.estimatedLiveMb, 465);
    assert.match(
      summary.topAllocations[0].stack.join(" "),
      /root.*allocator29/,
    );
    assert.ok(!JSON.stringify(summary).includes("hidden"));
  });

  it("emits periodic readings and warnings above the configured pressure threshold", async () => {
    const { server, logs } = fixture(false, 0);
    try {
      await server.ready();
      await new Promise((resolve) => setTimeout(resolve, 1100));
      const readings = logs.filter((log) => log.event === "heap_status");
      assert.ok(readings.length >= 2);
      assert.ok(readings.every((log) => log.level === 40));
      assert.ok(!logs.some((log) => log.event === "heap_allocations"));
    } finally {
      await server.close();
    }
  });

  it("counts requests beyond the metadata cap and releases them on disconnect", async () => {
    const { server, monitor, logs } = fixture();
    await server.ready();
    const responses: EventEmitter[] = [];
    try {
      for (let index = 0; index < 150; index++) {
        const raw = new EventEmitter();
        responses.push(raw);
        monitor.beginRequest(
          {
            id: String(index),
            method: "GET",
            routeOptions: { url: "/work/:id" },
          } as FastifyRequest,
          { raw } as unknown as FastifyReply,
        );
      }
      monitor.report();
      assert.equal(logs.at(-1)?.activeRequests, 150);
      assert.equal((logs.at(-1)?.activeRequestSample as unknown[]).length, 10);
      for (const raw of responses) raw.emit("close");
      monitor.report();
      assert.equal(logs.at(-1)?.activeRequests, 0);
    } finally {
      await server.close();
    }
  });

  it("starts the real allocation sampler and emits a profile without an inspector port", async () => {
    const { server, monitor, logs } = fixture(true);
    try {
      await server.ready();
      const retained = Array.from({ length: 30000 }, (_, index) => ({
        index,
        text: `allocation-${index}`,
      }));
      await new Promise<void>((resolve) => setImmediate(resolve));
      monitor.report();
      await new Promise<void>((resolve) => setImmediate(resolve));
      assert.equal(retained.length, 30000);
      assert.ok(logs.some((log) => log.event === "heap_sampling_started"));
      assert.ok(logs.some((log) => log.event === "heap_allocations"));
      assert.ok(!logs.some((log) => log.event === "heap_sampling_error"));
    } finally {
      await server.close();
    }
  });
});
