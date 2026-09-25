// ============================================================
// OmniFM: operator alert settings of the owner console (#260, #316)
// ============================================================
// The owner console stores them in owner_config.system.operatorAlerts. The
// bot bootstrap (src/entrypoints/from-owner-config.mjs) and the shell-script
// alerts (scripts/notify-operator.mjs) both turn them into the environment
// the webhook module reads, so a URL entered in the console reaches every
// alert, not only those of the bot.
import { MongoClient } from "mongodb";

export const OPERATOR_ALERT_SWITCHES = Object.freeze([
  ["workerOffline", "WORKER_OFFLINE"],
  ["failoverExhausted", "FAILOVER_EXHAUSTED"],
  ["playbackLoops", "PLAYBACK_LOOPS"],
  ["workerAutoheal", "WORKER_AUTOHEAL"],
  ["diskSpace", "DISK_SPACE"],
  ["backupFailed", "BACKUP_FAILED"],
  ["updates", "UPDATES"],
]);

function isSet(value) {
  return String(value ?? "").trim().length > 0;
}

/** Owner values win over backend/.env; unset owner values leave the env alone. */
export function applyOperatorAlertSettingsToEnv(operatorAlerts = {}, env = process.env) {
  const settings = operatorAlerts && typeof operatorAlerts === "object" ? operatorAlerts : {};
  if (isSet(settings.webhookUrl)) env.OPERATOR_WEBHOOK_URL = String(settings.webhookUrl).trim();
  if (isSet(settings.mention)) env.OPERATOR_WEBHOOK_MENTION = String(settings.mention).trim();
  for (const [field, kind] of OPERATOR_ALERT_SWITCHES) {
    if (Object.hasOwn(settings, field)) env[`OPERATOR_ALERT_${kind}`] = settings[field] === false ? "0" : "1";
  }
  return env;
}

/**
 * owner_config.system.operatorAlerts, or null when MongoDB is not configured
 * or not reachable in time: an alert must never hang on the database.
 */
export async function loadOwnerOperatorAlerts({ mongoUrl, dbName, timeoutMs = 5000 } = {}) {
  if (!isSet(mongoUrl) || !isSet(dbName)) return null;
  const client = new MongoClient(mongoUrl, { serverSelectionTimeoutMS: timeoutMs, connectTimeoutMS: timeoutMs });
  try {
    await client.connect();
    const doc = await client.db(dbName).collection("owner_config").findOne(
      { _id: "global" },
      { projection: { "system.operatorAlerts": 1 } },
    );
    return doc?.system?.operatorAlerts || null;
  } catch {
    return null;
  } finally {
    await client.close().catch(() => {});
  }
}
