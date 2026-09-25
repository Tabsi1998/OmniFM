#!/usr/bin/env node
// Operator alerts of the shell scripts (#316): the nightly backup and
// update.sh. The webhook comes from the owner console (MongoDB owner_config),
// backend/.env is the fallback. Without a webhook the script says so and
// exits 0: a missing alert channel never fails a backup or an update.
//
//   node scripts/notify-operator.mjs backup-failed "<step>" ["<step>" ...]
//   node scripts/notify-operator.mjs update-ok <from> <to> [detail]
//   node scripts/notify-operator.mjs update-failed <from> <to> [detail]
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

import { applyOperatorAlertSettingsToEnv, loadOwnerOperatorAlerts } from "../src/services/operator-alert-settings.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [event, ...args] = process.argv.slice(2);
const KINDS = { "backup-failed": "BACKUP_FAILED", "update-ok": "UPDATES", "update-failed": "UPDATES" };

if (!KINDS[event]) {
  console.error("Usage: node scripts/notify-operator.mjs backup-failed|update-ok|update-failed ...");
  process.exit(2);
}

dotenv.config({ path: path.join(ROOT, "backend", ".env"), quiet: true });
applyOperatorAlertSettingsToEnv(
  await loadOwnerOperatorAlerts({ mongoUrl: process.env.MONGO_URL, dbName: process.env.DB_NAME }),
  process.env,
);

// Imported after the environment is final: the webhook module reads its
// settings when it is first imported.
const { OPERATOR_WEBHOOK_ENABLED, notifyBackupFailed } = await import("../src/services/operator-webhook.js");
const { alertEnabled, alertUpdateResult } = await import("../src/services/operator-alerts.js");

if (!OPERATOR_WEBHOOK_ENABLED) {
  console.log("[INFO] No operator webhook configured (owner console or OPERATOR_WEBHOOK_URL); no alert sent.");
} else if (!alertEnabled(KINDS[event])) {
  console.log(`[INFO] Operator alerts for ${event} are switched off.`);
} else if (event === "backup-failed") {
  await notifyBackupFailed(args, os.hostname());
  console.log("[OK] Operator alert sent.");
} else {
  const [from, to, detail] = args;
  await alertUpdateResult({ ok: event === "update-ok", from, to, detail, host: os.hostname() });
  console.log("[OK] Operator alert sent.");
}
