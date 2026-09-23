import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  RECOVERY_SETTINGS,
  applyRecoverySettingsToEnv,
  describeRecoverySettings,
  getEffectiveRecoverySettings,
} from "../src/config/recovery-settings.js";

test("every recovery setting is unique, bounded and documented in .env.example", () => {
  const envExample = fs.readFileSync(new URL("../.env.example", import.meta.url), "utf8");
  const keys = new Set();
  for (const entry of RECOVERY_SETTINGS) {
    assert.equal(keys.has(entry.key), false, `duplicate ${entry.key}`);
    keys.add(entry.key);
    assert.ok(entry.min <= entry.default && entry.default <= entry.max, `${entry.key} default within bounds`);
    assert.ok(["ms", "count"].includes(entry.unit), `${entry.key} unit`);
    assert.ok(entry.label && entry.help, `${entry.key} explains itself`);
    assert.match(envExample, new RegExp(`^#? ?${entry.env}=`, "m"), `${entry.env} is documented`);
  }
  assert.ok(RECOVERY_SETTINGS.length >= 13);
});

test("owner values reach the environment clamped, invalid ones are skipped", () => {
  const env = {};
  const applied = applyRecoverySettingsToEnv({
    failoverMinFailures: 1,
    failbackCheckMs: 300000,
    voiceParkedRetryMs: "not a number",
    unknown: 5,
  }, env);
  assert.deepEqual(applied.sort(), ["STREAM_FAILBACK_CHECK_MS", "STREAM_FAILOVER_MIN_FAILURES"]);
  assert.equal(env.STREAM_FAILOVER_MIN_FAILURES, "2", "clamped to the minimum");
  assert.equal(env.STREAM_FAILBACK_CHECK_MS, "300000");
  assert.equal("VOICE_PARKED_RETRY_MS" in env, false);
});

test("the effective values say whether they are defaults", () => {
  const values = Object.fromEntries(getEffectiveRecoverySettings({ STREAM_FAILBACK_CHECK_MS: "300000" })
    .map((item) => [item.key, item]));
  assert.equal(values.failbackCheckMs.value, 300000);
  assert.equal(values.failbackCheckMs.isDefault, false);
  assert.equal(values.failoverMinFailures.value, 3);
  assert.equal(values.failoverMinFailures.isDefault, true);
});

test("/diag describes the effective values in plain words", () => {
  const lines = describeRecoverySettings({ STREAM_FAILBACK_CHECK_MS: "300000", STREAM_FAILOVER_MIN_FAILURES: "4" });
  assert.equal(lines.length, 4);
  assert.match(lines[0], /nach 4 Fehlern und 60 s ohne Ton/);
  assert.match(lines[1], /Prüfung alle 5 min \(bis 15 min\), 2× erreichbar/);
  assert.ok(lines.join("\n").length <= 1024, "fits into one embed field");
});
