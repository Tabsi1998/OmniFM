#!/usr/bin/env node
// Called by scripts/scheduled-backup.sh when a step failed: posts one alert
// to the operator webhook (OPERATOR_WEBHOOK_URL), if one is configured.
//
//   node scripts/notify-backup-failed.mjs "<failed step>" ["<failed step>" ...]
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
dotenv.config({ path: path.join(ROOT, "backend", ".env"), quiet: true });

// Imported after the environment is loaded: the webhook module reads its
// settings when it is first imported.
const { OPERATOR_WEBHOOK_ENABLED, notifyBackupFailed } = await import("../src/services/operator-webhook.js");

if (!OPERATOR_WEBHOOK_ENABLED) {
  console.log("[INFO] No operator webhook configured (OPERATOR_WEBHOOK_URL); no alert sent.");
} else {
  await notifyBackupFailed(process.argv.slice(2), os.hostname());
  console.log("[OK] Operator alert sent.");
}
