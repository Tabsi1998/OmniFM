// ============================================================
// OmniFM: the settings every OmniFM process starts from
// ============================================================
// backend/.env is the one file of an installation; the owner console
// (MongoDB owner_config) carries everything the owner sets in the browser.
// The bot (from-owner-config.mjs) and the public API (api.js, #290) start
// from the same two sources, so both know the same SMTP server, alert
// webhook, bot list secrets and website address.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const here = path.dirname(fileURLToPath(import.meta.url));
export const BACKEND_ENV_FILE = path.resolve(here, "..", "..", "backend", ".env");

export function readEnvFile(file) {
  const out = {};
  try {
    const text = fs.readFileSync(file, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
    }
  } catch { /* file may not exist */ }
  return out;
}

/**
 * backend/.env into the environment. Values already present (systemd
 * EnvironmentFile, shell) win; owner console settings are applied later and
 * win over both (#203). Returns the file's values.
 */
export function loadBackendEnv(env = process.env, file = BACKEND_ENV_FILE) {
  const backendEnv = readEnvFile(file);
  for (const [key, value] of Object.entries(backendEnv)) {
    if (env[key] === undefined) env[key] = value;
  }
  return backendEnv;
}

export function mongoTarget(env = process.env, backendEnv = {}) {
  return {
    url: env.MONGO_URL || backendEnv.MONGO_URL || "mongodb://localhost:27017",
    dbName: env.DB_NAME || backendEnv.DB_NAME || "omnifm",
  };
}

export async function loadOwnerConfig({ url, dbName }) {
  const client = new MongoClient(url, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    // The owner document has the string id "global", not an ObjectId.
    const ownerConfig = /** @type {import("mongodb").Collection<any>} */ (client.db(dbName).collection("owner_config"));
    return (await ownerConfig.findOne({ _id: "global" })) || {};
  } finally {
    await client.close().catch(() => {});
  }
}

/**
 * The owner console's system section into the environment the runtime and
 * the API read: Discord login, SMTP, operator alerts, recognition, song
 * history, station health, stream recovery and the bot lists. Empty values
 * change nothing.
 */
export async function applyOwnerSystemEnv(system = {}, env = process.env) {
  const oauth = system.discordOAuth || {};
  const smtp = system.smtp || {};
  const recognition = system.audioRecognition || {};
  const history = system.songHistory || {};
  const stationHealth = system.stationHealth || {};
  const streamRecovery = system.streamRecovery || {};
  const directories = system.botDirectories || {};
  const operatorAlerts = system.operatorAlerts || {};
  const setRuntimeEnv = (key, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") env[key] = String(value).trim();
  };
  setRuntimeEnv("DISCORD_CLIENT_ID", oauth.clientId);
  setRuntimeEnv("DISCORD_CLIENT_SECRET", oauth.clientSecret);
  // DISCORD_REDIRECT_URI is made from the website's address (discord-oauth-settings.js).
  setRuntimeEnv("DISCORD_OAUTH_SCOPES", oauth.scopes);
  setRuntimeEnv("SMTP_HOST", smtp.host);
  setRuntimeEnv("SMTP_PORT", smtp.port);
  setRuntimeEnv("SMTP_SECURE", smtp.secure ? "1" : "0");
  setRuntimeEnv("SMTP_USER", smtp.user);
  setRuntimeEnv("SMTP_PASS", smtp.password);
  setRuntimeEnv("SMTP_FROM", smtp.from);
  // Operator alerts (#260): webhook, mention and one switch per alert kind,
  // the same mapping scripts/notify-operator.mjs uses (#316).
  const { applyOperatorAlertSettingsToEnv } = await import("../services/operator-alert-settings.js");
  applyOperatorAlertSettingsToEnv(operatorAlerts, env);
  setRuntimeEnv("NOW_PLAYING_RECOGNITION_ENABLED", recognition.enabled ? "1" : "0");
  setRuntimeEnv("ACOUSTID_API_KEY", recognition.apiKey);
  setRuntimeEnv("SONG_HISTORY_ENABLED", history.enabled === false ? "0" : "1");
  setRuntimeEnv("SONG_HISTORY_MAX_PER_GUILD", history.maxPerGuild);
  if (Object.hasOwn(stationHealth, "enabled")) setRuntimeEnv("STATION_HEALTH_ENABLED", stationHealth.enabled ? "1" : "0");
  setRuntimeEnv("STATION_HEALTH_INTERVAL_MS", stationHealth.intervalMs);
  setRuntimeEnv("STATION_HEALTH_BATCH_SIZE", stationHealth.batchSize);
  setRuntimeEnv("STATION_HEALTH_CONCURRENCY", stationHealth.concurrency);
  setRuntimeEnv("STATION_HEALTH_TIMEOUT_MS", stationHealth.timeoutMs);

  // Every recovery value of the owner console (#217), clamped like the runtime does.
  const { applyRecoverySettingsToEnv } = await import("../config/recovery-settings.js");
  applyRecoverySettingsToEnv(streamRecovery, env);

  const directoryEnv = [
    [directories.discordBotList || {}, "DISCORDBOTLIST", ["slug", "webhookSecret"]],
    [directories.botsGG || {}, "BOTSGG", []],
    [directories.topGG || {}, "TOPGG", ["webhookSecret"]],
  ];
  for (const [directory, prefix, extraFields] of directoryEnv) {
    if (Object.hasOwn(directory, "enabled")) setRuntimeEnv(`${prefix}_ENABLED`, directory.enabled ? "1" : "0");
    setRuntimeEnv(`${prefix}_TOKEN`, directory.token);
    setRuntimeEnv(`${prefix}_BOT_ID`, directory.botId);
    setRuntimeEnv(`${prefix}_STATS_SCOPE`, directory.statsScope);
    if (extraFields.includes("slug")) setRuntimeEnv(`${prefix}_SLUG`, directory.slug);
    if (extraFields.includes("webhookSecret")) setRuntimeEnv(`${prefix}_WEBHOOK_SECRET`, directory.webhookSecret);
  }
}

/**
 * Links leaving the server (login, share links, dashboard buttons, legal
 * texts) need the public address, not the LAN one of the installation.
 */
export async function preferPublicAddress(system = {}, env = process.env) {
  const { preferPublicWebsiteUrl } = await import("../lib/public-origin.js");
  const change = preferPublicWebsiteUrl(env, { storedRedirectUri: system.discordOAuth?.redirectUri });
  if (change) {
    console.log(`[OmniFM] PUBLIC_WEB_URL "${change.from || "-"}" ist nur lokal erreichbar; Links nutzen ${change.to}.`);
  }
  return change;
}
