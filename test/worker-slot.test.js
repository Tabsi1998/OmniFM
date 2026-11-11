import assert from "node:assert/strict";
import test from "node:test";

import { BotRuntime } from "../src/bot/runtime.js";
import { WorkerManager } from "../src/bot/worker-manager.js";
import { resolveBotTopology, resolveWorkerConfig, resolveWorkerSlot } from "../src/entrypoints/shared.js";
import { isWithinWorkerPlanLimit } from "../src/lib/helpers.js";
import { PLAN_LIMITS } from "../src/config/plan-features.js";

// The owner-config layout in production: BOT_1 is the commander, BOT_2 … BOT_17
// are the workers (from-owner-config.mjs). Each worker runs in its own process
// and only knows its BOT_PROCESS_INDEX (#520).
function splitEnv(botCount) {
  const env = { COMMANDER_BOT_INDEX: "1" };
  for (let n = 1; n <= botCount; n += 1) {
    env[`BOT_${n}_TOKEN`] = `token-${n}`;
    env[`BOT_${n}_CLIENT_ID`] = String(100000000000000000n + BigInt(n));
    env[`BOT_${n}_NAME`] = n === 1 ? "OmniFM DJ" : `OmniFM ${n - 1}`;
  }
  return env;
}

test("a worker process counts its plan slot the way the commander does (#520)", () => {
  const topology = resolveBotTopology(splitEnv(17));
  const manager = new WorkerManager(topology.workerConfigs.map((config) => ({ config, guildState: new Map() })));
  const commanderSlots = new Map(manager.workers.map((worker) => [worker.config.index, worker.workerSlot]));

  for (let botIndex = 2; botIndex <= 17; botIndex += 1) {
    const workerConfig = resolveWorkerConfig(topology.botConfigs, botIndex);
    assert.equal(resolveWorkerSlot(topology.workerConfigs, workerConfig), botIndex - 1, `BOT_${botIndex}`);
    assert.equal(resolveWorkerSlot(topology.workerConfigs, workerConfig), commanderSlots.get(botIndex), `BOT_${botIndex}`);
  }
});

test("the last worker a plan allows is let in, the next one is not (#520)", (t) => {
  const topology = resolveBotTopology(splitEnv(17));
  const slotOf = (botIndex) => {
    const config = resolveWorkerConfig(topology.botConfigs, botIndex);
    const runtime = new BotRuntime(config, { role: "worker", workerSlot: resolveWorkerSlot(topology.workerConfigs, config) });
    t.after(() => {
      runtime.unsubscribeNetworkRecovery?.();
      runtime.client.destroy();
    });
    return runtime.workerSlot;
  };
  const allowed = (botIndex, plan) => isWithinWorkerPlanLimit({
    role: "worker",
    workerSlot: slotOf(botIndex),
    botIndex,
    maxBots: PLAN_LIMITS[plan].maxBots,
  });

  // Free: two workers, "OmniFM 1" (BOT_2) and "OmniFM 2" (BOT_3).
  assert.equal(allowed(3, "free"), true);
  assert.equal(allowed(4, "free"), false);
  // Pro: eight workers, up to "OmniFM 8" (BOT_9).
  assert.equal(allowed(9, "pro"), true);
  assert.equal(allowed(10, "pro"), false);
  // Ultimate: sixteen workers, up to "OmniFM 16" (BOT_17).
  assert.equal(allowed(17, "ultimate"), true);
});

test("a worker without a slot from its entry point keeps the old fallback", (t) => {
  const runtime = new BotRuntime({ token: "t", clientId: "100000000000000002", index: 2, name: "OmniFM 1" }, { role: "worker" });
  t.after(() => {
    runtime.unsubscribeNetworkRecovery?.();
    runtime.client.destroy();
  });
  assert.equal(runtime.workerSlot, 2);
});
