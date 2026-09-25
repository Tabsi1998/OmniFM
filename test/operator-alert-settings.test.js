import test from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";

import { applyOperatorAlertSettingsToEnv, loadOwnerOperatorAlerts } from "../src/services/operator-alert-settings.js";
import { buildUpdateAlert } from "../src/services/operator-alerts.js";

test("owner alert settings become the environment the webhook module reads", () => {
  const env = { OPERATOR_WEBHOOK_URL: "https://discord.com/api/webhooks/1/from-env" };
  applyOperatorAlertSettingsToEnv({
    webhookUrl: " https://discord.com/api/webhooks/2/from-console ",
    mention: "<@1>",
    diskSpace: false,
    updates: true,
  }, env);
  assert.equal(env.OPERATOR_WEBHOOK_URL, "https://discord.com/api/webhooks/2/from-console");
  assert.equal(env.OPERATOR_WEBHOOK_MENTION, "<@1>");
  assert.equal(env.OPERATOR_ALERT_DISK_SPACE, "0");
  assert.equal(env.OPERATOR_ALERT_UPDATES, "1");
  assert.equal(env.OPERATOR_ALERT_BACKUP_FAILED, undefined, "unset switches stay untouched");
});

test("an empty console value keeps the backend/.env fallback", () => {
  const env = { OPERATOR_WEBHOOK_URL: "https://discord.com/api/webhooks/1/from-env" };
  applyOperatorAlertSettingsToEnv({ webhookUrl: "" }, env);
  applyOperatorAlertSettingsToEnv(null, env);
  assert.equal(env.OPERATOR_WEBHOOK_URL, "https://discord.com/api/webhooks/1/from-env");
});

test("without MongoDB the settings are simply absent, fast", async () => {
  assert.equal(await loadOwnerOperatorAlerts({ mongoUrl: "", dbName: "x" }), null);
  const started = Date.now();
  assert.equal(await loadOwnerOperatorAlerts({ mongoUrl: "mongodb://127.0.0.1:1", dbName: "x", timeoutMs: 300 }), null);
  assert.ok(Date.now() - started < 5000);
});

test("the webhook entered in the owner console is read from MongoDB", async (t) => {
  const mongoUrl = String(process.env.MONGO_URL || "").trim();
  if (!mongoUrl) {
    t.skip("MongoDB is not configured for this test run");
    return;
  }
  const dbName = `omnifm_alert_settings_${process.pid}`;
  const client = new MongoClient(mongoUrl);
  await client.connect();
  t.after(async () => {
    await client.db(dbName).dropDatabase().catch(() => {});
    await client.close();
  });
  await client.db(dbName).collection("owner_config").insertOne({
    _id: "global",
    system: { operatorAlerts: { webhookUrl: "https://discord.com/api/webhooks/3/console", backupFailed: false } },
    discord: { commander: { token: "never-read-here" } },
  });
  const settings = await loadOwnerOperatorAlerts({ mongoUrl, dbName });
  assert.deepEqual(settings, { webhookUrl: "https://discord.com/api/webhooks/3/console", backupFailed: false });
});

test("the update alert says what runs now, or where the update stopped", () => {
  const ok = buildUpdateAlert({ ok: true, from: "abc1234", to: "def5678", detail: "Discord-Bot läuft.", host: "radio" });
  assert.equal(ok.key, "update-ok:def5678");
  assert.match(ok.embed.description, /def5678.*abc1234/);
  assert.equal(ok.embed.fields[0].value, "Discord-Bot läuft.");

  const failed = buildUpdateAlert({ ok: false, from: "abc1234", detail: "git pull fehlgeschlagen (Exit-Code 1)" });
  assert.equal(failed.key, "update-failed");
  assert.equal(failed.embed.fields[0].name, "Letzter Schritt");
});
