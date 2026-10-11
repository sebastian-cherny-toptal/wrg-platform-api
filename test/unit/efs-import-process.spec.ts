import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import type { fork } from "node:child_process";
import { test } from "node:test";
import { runEfsImportProcess } from "../../src/modules/imports/efs-import-process.js";

test("imports get a fresh 512 MB heap and receive only the durable job ID", async () => {
  const child = new EventEmitter();
  const spawn = ((
    _module: string,
    args: string[],
    options: { execArgv: string[] },
  ) => {
    assert.deepEqual(args, ["job-id"]);
    assert.ok(options.execArgv.includes("--max-old-space-size=512"));
    queueMicrotask(() => {
      child.emit("message", { saved: true });
      child.emit("exit", 0, null);
    });
    return child;
  }) as unknown as typeof fork;
  await runEfsImportProcess("job-id", spawn);
});

test("a fatal child termination is observable by the surviving parent", async () => {
  const child = new EventEmitter();
  const spawn = (() => {
    queueMicrotask(() => child.emit("exit", null, "SIGABRT"));
    return child;
  }) as unknown as typeof fork;
  await assert.rejects(
    runEfsImportProcess("job-id", spawn),
    /SIGABRT.*512 MB/u,
  );
});
