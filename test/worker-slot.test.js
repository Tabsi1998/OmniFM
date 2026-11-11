import assert from "node:assert/strict";
import test from "node:test";

import { BotRuntime } from "../src/bot/runtime.js";
import { WorkerManager } from "../src/bot/worker-manager.js";
import { setLicenseProvider } from "../src/core/entitlements.js";
import { createWorkerRuntime, resolveBotTopology } from "../src/entrypoints/shared.js";

// The owner-config layout in production: BOT_1 is the commander, BOT_2 … BOT_17
// are the workers (from-owner-config.mjs). Each worker runs in its own process
// and only knows its BOT_PROCESS_INDEX (#520).
function splitEnv(botCount, processIndex = null) {
  const env = { COMMANDER_BOT_INDEX: "1" };
  for (let n = 1; n <= botCount; n += 1) {
    env[`BOT_${n}_TOKEN`] = `token-${n}`;
    env[`BOT_${n}_CLIENT_ID`] = String(100000000000000000n + BigInt(n));
    env[`BOT_${n}_NAME`] = n === 1 ? "OmniFM DJ" : `OmniFM ${n - 1}`;
  }
  if (processIndex !== null) env.BOT_PROCESS_INDEX = String(processIndex);
  return env;
}

function startWorker(t, botIndex) {
  const { runtime } = createWorkerRuntime(splitEnv(17, botIndex), BotRuntime);
  t.after(() => {
    runtime.unsubscribeNetworkRecovery?.();
    runtime.client.destroy();
  });
  return runtime;
}

const PLAN_OF = { "200000000000000001": "free", "200000000000000002": "pro", "200000000000000003": "ultimate" };
const SERVER = Object.fromEntries(Object.entries(PLAN_OF).map(([id, plan]) => [plan, id]));

test.before(() => {
  setLicenseProvider((serverId) => (PLAN_OF[serverId] && PLAN_OF[serverId] !== "free"
    ? { plan: PLAN_OF[serverId], active: true, seats: 1 }
    : null));
});
test.after(() => setLicenseProvider(null));

test("a worker process counts its plan slot the way the commander does (#520)", (t) => {
  const topology = resolveBotTopology(splitEnv(17));
  const manager = new WorkerManager(topology.workerConfigs.map((config) => ({ config, guildState: new Map() })));
  const commanderSlots = new Map(manager.workers.map((worker) => [worker.config.index, worker.workerSlot]));

  for (let botIndex = 2; botIndex <= 17; botIndex += 1) {
    const runtime = startWorker(t, botIndex);
    assert.equal(runtime.workerSlot, botIndex - 1, `BOT_${botIndex}`);
    assert.equal(runtime.workerSlot, commanderSlots.get(botIndex), `BOT_${botIndex}`);
  }
});

test("the last worker a plan allows lets the server in, the next one does not (#520)", (t) => {
  const allowed = (botIndex, plan) => startWorker(t, botIndex).getGuildAccess(SERVER[plan]).withinBotLimit;

  // Free: two workers, "OmniFM 1" (BOT_2) and "OmniFM 2" (BOT_3).
  assert.equal(allowed(3, "free"), true);
  assert.equal(allowed(4, "free"), false);
  // Pro: eight workers, up to "OmniFM 8" (BOT_9).
  assert.equal(allowed(9, "pro"), true);
  assert.equal(allowed(10, "pro"), false);
  // Ultimate: sixteen workers, up to "OmniFM 16" (BOT_17).
  assert.equal(allowed(17, "ultimate"), true);
});

test("the commander's BOT number cannot start as a worker", () => {
  assert.throws(() => createWorkerRuntime(splitEnv(3, 1), BotRuntime), /als Commander konfiguriert/);
});

test("a worker without a slot takes none, not its BOT number", (t) => {
  const runtime = new BotRuntime({ token: "t", clientId: "100000000000000002", index: 2, name: "OmniFM 1" }, { role: "worker" });
  t.after(() => {
    runtime.unsubscribeNetworkRecovery?.();
    runtime.client.destroy();
  });
  assert.equal(runtime.workerSlot, null);
});
