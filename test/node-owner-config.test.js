import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const config = await import("../src/lib/owner-config.js");
const { MASK } = { MASK: config.SECRET_MASK };

test("the defaults are the same file FastAPI reads", () => {
  const shared = JSON.parse(fs.readFileSync(new URL("../src/config/owner-config-defaults.json", import.meta.url), "utf8"));
  assert.deepEqual(Object.keys(config.DEFAULT_OWNER_CONFIG), Object.keys(shared));
  assert.deepEqual(config.DEFAULT_OWNER_CONFIG.company, shared.company);
  assert.ok(config.DEFAULT_OWNER_CONFIG.system.streamRecovery.stableResetMs > 0, "streamRecovery comes from the recovery settings");
  assert.deepEqual(config.OWNER_CONFIG_SECTIONS, ["company", "plans", "discord", "system", "payments", "marketing"]);
});

test("secrets leave masked, and a mask sent back never replaces the stored secret", () => {
  const masked = config.maskConfigSecrets({ discordOAuth: { clientId: "123", clientSecret: "real" }, workers: [{ name: "w1", token: "t1" }, { name: "w2", token: "" }] });
  assert.deepEqual(masked.discordOAuth, { clientId: "123", clientSecret: MASK, clientSecretSet: true });
  assert.deepEqual(masked.workers[1], { name: "w2", token: "" }, "an empty secret is not reported as set");

  const raw = { discord: { commander: { token: "cmd-secret", clientId: "1" }, workers: [{ clientId: "a", token: "ta" }, { clientId: "b", token: "tb" }] } };
  const saved = config.mergedSectionForSave(raw, "discord", {
    commander: { token: MASK, tokenSet: true, clientId: "1" },
    // reordered, and a new worker with a mask it must not inherit
    workers: [{ clientId: "b", token: MASK }, { clientId: "a", token: "" }, { clientId: "c", token: MASK }],
  });
  assert.equal(saved.commander.token, "cmd-secret");
  assert.equal("tokenSet" in saved.commander, false, "the Set flag is not stored");
  assert.deepEqual(saved.workers.map((worker) => worker.token), ["tb", "ta", ""], "matched by clientId, never by position");
});

test("settings from the environment show until the owner saves them, like FastAPI", () => {
  const env = { SMTP_HOST: "mail.example", SMTP_PORT: "2525", STRIPE_SECRET_KEY: "sk_live_x", TOPGG_TOKEN: "tg", STATION_HEALTH_BATCH_SIZE: "5.5" };
  const system = config.effectiveSystemConfig({}, env);
  assert.equal(system.smtp.host, "mail.example");
  assert.equal(system.smtp.port, 2525);
  assert.equal(system.smtp.enabled, true, "an SMTP host from the environment switches mail on");
  assert.equal(system.botDirectories.topGG.token, "tg");
  assert.equal(system.stationHealth.batchSize, 2, "5.5 is no whole number, the default stays");
  const stored = config.effectiveSystemConfig({ system: { smtp: { host: "own.example" } } }, env);
  assert.equal(stored.smtp.host, "own.example", "what the owner saved wins");

  const payments = config.effectivePaymentsConfig({}, env);
  assert.deepEqual([payments.stripe.secretKey, payments.stripe.enabled, payments.stripe.mode], ["sk_live_x", true, "live"]);
  const response = config.ownerConfigResponse({}, env);
  assert.equal(response.payments.stripe.secretKey, MASK);
  assert.equal(response.env.stripeEnvKey, true);
});

test("stream recovery values are clamped to the bounds the bot uses", () => {
  const saved = config.mergedSectionForSave({}, "system", { streamRecovery: { stableResetMs: 1, failoverMinFailures: "abc", unknown: 5 } });
  assert.ok(saved.streamRecovery.stableResetMs > 1, "clamped up to the minimum");
  assert.equal("failoverMinFailures" in saved.streamRecovery, false);
  assert.equal("unknown" in saved.streamRecovery, false);
});
