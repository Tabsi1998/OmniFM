// ============================================================
// OmniFM — DB-driven bot bootstrap
// Reads the Commander + Workers straight from the Owner Console
// config (MongoDB `owner_config.discord`) and boots the bot with
// them. No BOT_*_TOKEN env vars required — everything is managed
// dynamically from the Owner menu.
//
// Exit codes: 0 = started, 78 (EX_CONFIG) = no bot configured yet.
// Set DRY_RUN=1 to only print the resolved config (no Discord login).
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { MongoClient } from "mongodb";

const here = path.dirname(fileURLToPath(import.meta.url));

function readEnvFile(file) {
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

// MONGO_URL / DB_NAME come from the SAME source the Owner Console writes to.
const backendEnv = readEnvFile(path.resolve(here, "..", "..", "backend", ".env"));
// backend/.env is the one place for runtime tuning on a server (VOICE_*,
// STREAM_*, LOG_*, see .env.example). Values already present in the
// environment (systemd EnvironmentFile, shell) win; owner console settings are
// applied further down and win over both (#203).
for (const [key, value] of Object.entries(backendEnv)) {
  if (process.env[key] === undefined) process.env[key] = value;
}
const MONGO_URL = process.env.MONGO_URL || backendEnv.MONGO_URL || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || backendEnv.DB_NAME || "omnifm";

async function loadOwnerConfig() {
  const client = new MongoClient(MONGO_URL, { serverSelectionTimeoutMS: 8000 });
  try {
    await client.connect();
    const doc = (await client.db(DB_NAME).collection("owner_config").findOne({ _id: "global" })) || {};
    return doc;
  } finally {
    await client.close().catch(() => {});
  }
}

function isSet(v) {
  return String(v || "").trim().length > 0;
}

async function main() {
  let ownerConfig;
  try {
    ownerConfig = await loadOwnerConfig();
  } catch (err) {
    console.error(`[OmniFM] Konnte Owner-Config nicht laden (${MONGO_URL} / ${DB_NAME}): ${err.message}`);
    process.exit(1);
  }

  const discord = ownerConfig.discord || {};
  const system = ownerConfig.system || {};

  const commander = discord.commander || {};
  const workers = Array.isArray(discord.workers) ? discord.workers : [];

  const entries = [];
  if (isSet(commander.token) && isSet(commander.clientId)) {
    entries.push({ ...commander, tier: "free" });
  }
  for (const w of workers) {
    if (w && isSet(w.token) && isSet(w.clientId)) entries.push(w);
  }

  if (entries.length === 0) {
    console.error("[OmniFM] Kein Commander-Bot im Owner-Menü konfiguriert (Discord & Bots → Token + Client ID).");
    console.error("[OmniFM] Bot wird nicht gestartet. Trage Tokens im Owner-Menü ein und starte erneut.");
    process.exit(78); // EX_CONFIG
  }

  // Map Owner-config → the env contract loadBotConfigs() already understands.
  entries.forEach((b, i) => {
    const n = i + 1;
    process.env[`BOT_${n}_TOKEN`] = String(b.token).trim();
    process.env[`BOT_${n}_CLIENT_ID`] = String(b.clientId).trim();
    if (isSet(b.name)) process.env[`BOT_${n}_NAME`] = String(b.name).trim();
    if (isSet(b.tier)) process.env[`BOT_${n}_TIER`] = String(b.tier).trim().toLowerCase();
  });
  process.env.COMMANDER_BOT_INDEX = "1";
  process.env.MONGO_URL = MONGO_URL;
  process.env.DB_NAME = DB_NAME;
  // FastAPI :8001 stays the only public HTTP entry. With
  // OMNIFM_DASHBOARD_BACKEND=node it forwards /api/auth and /api/dashboard to
  // the Node API of the commander on 127.0.0.1 (#195); configured below, once
  // the OAuth settings are known.
  process.env.WEB_SERVER_ENABLED = "0";

  // Apply the Owner Console system settings to the Discord runtime. Mongo
  // connection settings remain boot configuration because they are required
  // before the Owner document can be read.
  const oauth = system.discordOAuth || {};
  const smtp = system.smtp || {};
  const recognition = system.audioRecognition || {};
  const history = system.songHistory || {};
  const stationHealth = system.stationHealth || {};
  const streamRecovery = system.streamRecovery || {};
  const directories = system.botDirectories || {};
  const operatorAlerts = system.operatorAlerts || {};
  const setRuntimeEnv = (key, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") process.env[key] = String(value).trim();
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
  applyOperatorAlertSettingsToEnv(operatorAlerts, process.env);
  setRuntimeEnv("NOW_PLAYING_RECOGNITION_ENABLED", recognition.enabled ? "1" : "0");
  setRuntimeEnv("ACOUSTID_API_KEY", recognition.apiKey);
  setRuntimeEnv("SONG_HISTORY_ENABLED", history.enabled === false ? "0" : "1");
  setRuntimeEnv("SONG_HISTORY_MAX_PER_GUILD", history.maxPerGuild);
  if (Object.hasOwn(stationHealth, "enabled")) setRuntimeEnv("STATION_HEALTH_ENABLED", stationHealth.enabled ? "1" : "0");
  setRuntimeEnv("STATION_HEALTH_INTERVAL_MS", stationHealth.intervalMs);
  setRuntimeEnv("STATION_HEALTH_BATCH_SIZE", stationHealth.batchSize);
  setRuntimeEnv("STATION_HEALTH_CONCURRENCY", stationHealth.concurrency);
  setRuntimeEnv("STATION_HEALTH_TIMEOUT_MS", stationHealth.timeoutMs);
  const { configureDashboardBackend } = await import("../lib/dashboard-backend.js");
  const dashboardBackend = configureDashboardBackend(process.env, { redirectUri: oauth.redirectUri });
  console.log(dashboardBackend.enabled
    ? `[OmniFM] Dashboard-API: Node im Commander auf 127.0.0.1:${dashboardBackend.port}, FastAPI leitet /api/auth und /api/dashboard weiter.`
    : "[OmniFM] Dashboard-API: FastAPI (OMNIFM_DASHBOARD_BACKEND ist nicht \"node\").");

  // Every recovery value of the owner console (#217), clamped like the runtime does.
  const { applyRecoverySettingsToEnv } = await import("../config/recovery-settings.js");
  applyRecoverySettingsToEnv(streamRecovery, process.env);

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

  console.log(`[OmniFM] Bot-Config aus Owner-Menü: Commander="${entries[0].name || "OmniFM Commander"}", Worker=${entries.length - 1}`);

  if (String(process.env.DRY_RUN || "") === "1") {
    console.log("[OmniFM] DRY_RUN — kein Discord-Login. Aufgelöste Bots:");
    entries.forEach((b, i) => console.log(`  BOT_${i + 1}: ${b.name || "(unbenannt)"} clientId=${b.clientId} tier=${b.tier || "free"} tokenLen=${String(b.token).length}`));
    process.exit(0);
  }

  const requestedMode = String(process.env.OMNIFM_DEPLOYMENT_MODE || "auto").trim().toLowerCase();
  const monolithRequested = ["monolith", "single", "legacy"].includes(requestedMode);
  const useSplitRuntime = requestedMode === "split" || (!monolithRequested && entries.length > 1);
  if (!useSplitRuntime) {
    console.log("[OmniFM] Bot-Laufzeit: Monolith (explizit oder nur ein Bot konfiguriert).");
    await import("../index.js");
    return;
  }

  process.env.OMNIFM_DEPLOYMENT_MODE = "split";
  console.log(`[OmniFM] Bot-Laufzeit: echter Prozess-Split (Commander + ${entries.length - 1} Worker).`);
  const { superviseSplitRuntime } = await import("./split-supervisor.js");
  await superviseSplitRuntime({
    botIndexes: entries.map((_, index) => index + 1),
    commanderIndex: 1,
  });
}

main().catch((err) => {
  console.error(`[OmniFM] Bot-Bootstrap fehlgeschlagen: ${err?.stack || err}`);
  process.exit(1);
});
