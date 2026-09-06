import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  buildSplitProcessSpecs,
  getSplitRestartDelay,
} from "../src/entrypoints/split-supervisor.js";
import { buildWorkerRuntimeMetrics } from "../src/bot/worker-bridge-service.js";

test("split supervisor creates one commander and one process per worker", () => {
  const specs = buildSplitProcessSpecs([3, 1, 2, 2], 1);

  assert.deepEqual(specs.map((spec) => spec.id), ["commander", "worker-2", "worker-3"]);
  assert.equal(path.basename(specs[0].entry), "commander.js");
  assert.equal(path.basename(specs[1].entry), "worker.js");
  assert.deepEqual(specs[1].env, { BOT_PROCESS_INDEX: "2" });
});

test("split supervisor rejects an unconfigured commander", () => {
  assert.throws(() => buildSplitProcessSpecs([2, 3], 1), /Commander BOT_1/);
});

test("split process restart backoff is bounded", () => {
  assert.equal(getSplitRestartDelay(1), 1_000);
  assert.equal(getSplitRestartDelay(4), 8_000);
  assert.equal(getSplitRestartDelay(99), 30_000);
});

test("worker bridge publishes process-specific resource metrics", () => {
  const metrics = buildWorkerRuntimeMetrics({ startedAt: Date.now() - 5_000 });

  assert.equal(metrics.pid, process.pid);
  assert.equal(metrics.resourceScope, "node-process");
  assert.equal(typeof metrics.cpuPct, "number");
  assert.equal(metrics.memoryRssMb > 0, true);
  assert.equal(metrics.uptimeSec >= 0, true);
  assert.equal(typeof metrics.host, "string");
  assert.match(metrics.nodeVersion, /^v\d+/);
});
