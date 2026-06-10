import test from "node:test";
import assert from "node:assert/strict";

import {
  STORE_CONCURRENCY_REGISTRY,
  getStoreConcurrencyReport,
  isSplitRuntime,
  logStoreConcurrencyReport,
} from "../src/lib/store-concurrency.js";

test("store concurrency registry documents mutating runtime stores", () => {
  const requiredStores = [
    "bot-state",
    "song-history",
    "dashboard",
    "premium",
    "custom-stations",
    "scheduled-events",
    "command-permissions",
    "listening-stats",
    "stations",
    "coupons",
    "provider-directory",
    "incidents",
    "guild-languages",
  ];

  const documentedStores = new Set(STORE_CONCURRENCY_REGISTRY.map((entry) => entry.store));
  for (const store of requiredStores) {
    assert.equal(documentedStores.has(store), true, `${store} must be documented`);
  }

  for (const entry of STORE_CONCURRENCY_REGISTRY) {
    assert.equal(Boolean(entry.scope), true, `${entry.store} needs a scope`);
    assert.equal(Boolean(entry.runtimeOwner), true, `${entry.store} needs an owner`);
    assert.equal(Boolean(entry.splitSafety), true, `${entry.store} needs split-safety classification`);
    assert.equal(Boolean(entry.protection), true, `${entry.store} needs a protection note`);
  }
});

test("split startup report warns when Mongo is unavailable", () => {
  assert.equal(isSplitRuntime({ BOT_PROCESS_ROLE: "worker" }), true);

  const report = getStoreConcurrencyReport({
    env: { BOT_PROCESS_ROLE: "worker" },
    mongoConnected: false,
    requireMongo: true,
  });

  assert.equal(report.splitRuntime, true);
  assert.equal(report.warnings.some((warning) => warning.code === "split_mongo_required"), true);
  assert.equal(report.warnings.find((warning) => warning.code === "split_mongo_required")?.severity, "critical");
});

test("store concurrency logger emits startup warning details", () => {
  const lines = [];
  const report = logStoreConcurrencyReport({
    env: { OMNIFM_DEPLOYMENT_MODE: "split" },
    mongoConnected: false,
    requireMongo: true,
    log(level, message) {
      lines.push({ level, message });
    },
  });

  assert.equal(report.splitRuntime, true);
  assert.equal(lines.some((line) => line.level === "INFO" && line.message.includes("topology=split")), true);
  assert.equal(lines.some((line) => line.level === "ERROR" && line.message.includes("split_mongo_required")), true);
});
