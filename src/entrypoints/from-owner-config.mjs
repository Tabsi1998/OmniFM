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
  // FastAPI :8001 is the only production HTTP backend. The Node process is
  // exclusively the Discord voice runtime in this deployment.
  process.env.WEB_SERVER_ENABLED = "0";

  // Apply the Owner Console system settings to the Discord runtime. Mongo
  // connection settings remain boot configuration because they are required
  // before the Owner document can be read.
  const oauth = system.discordOAuth || {};
  const smtp = system.smtp || {};
  const recognition = system.audioRecognition || {};
  const history = system.songHistory || {};
  const directories = system.botDirectories || {};
  const setRuntimeEnv = (key, value) => {
    if (value !== undefined && value !== null && String(value).trim() !== "") process.env[key] = String(value).trim();
  };
  setRuntimeEnv("DISCORD_CLIENT_ID", oauth.clientId);
  setRuntimeEnv("DISCORD_CLIENT_SECRET", oauth.clientSecret);
  setRuntimeEnv("DISCORD_REDIRECT_URI", oauth.redirectUri);
  setRuntimeEnv("DISCORD_OAUTH_SCOPES", oauth.scopes);
  setRuntimeEnv("SMTP_HOST", smtp.host);
  setRuntimeEnv("SMTP_PORT", smtp.port);
  setRuntimeEnv("SMTP_SECURE", smtp.secure ? "1" : "0");
  setRuntimeEnv("SMTP_USER", smtp.user);
  setRuntimeEnv("SMTP_PASS", smtp.password);
  setRuntimeEnv("SMTP_FROM", smtp.from);
  setRuntimeEnv("NOW_PLAYING_RECOGNITION_ENABLED", recognition.enabled ? "1" : "0");
  setRuntimeEnv("ACOUSTID_API_KEY", recognition.apiKey);
  setRuntimeEnv("SONG_HISTORY_ENABLED", history.enabled === false ? "0" : "1");
  setRuntimeEnv("SONG_HISTORY_MAX_PER_GUILD", history.maxPerGuild);

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

  await import("../index.js");
}

main().catch((err) => {
  console.error(`[OmniFM] Bot-Bootstrap fehlgeschlagen: ${err?.stack || err}`);
  process.exit(1);
});
