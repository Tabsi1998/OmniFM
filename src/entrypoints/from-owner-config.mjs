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
import {
  applyOwnerSystemEnv,
  loadBackendEnv,
  loadOwnerConfig,
  mongoTarget,
  preferPublicAddress,
} from "./owner-env.mjs";

// MONGO_URL / DB_NAME come from the SAME source the Owner Console writes to.
// backend/.env is the one place for runtime tuning on a server (VOICE_*,
// STREAM_*, LOG_*, see .env.example); owner console settings win (#203).
const backendEnv = loadBackendEnv();
const { url: MONGO_URL, dbName: DB_NAME } = mongoTarget(process.env, backendEnv);

function isSet(v) {
  return String(v || "").trim().length > 0;
}

async function main() {
  let ownerConfig;
  try {
    ownerConfig = await loadOwnerConfig({ url: MONGO_URL, dbName: DB_NAME });
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
  // The public entry on :8001 (src/entrypoints/api.js, #290) forwards
  // /api/auth, /api/dashboard and the other paths that need the bots to the
  // Node API of the commander on 127.0.0.1 (#195); configured below, once
  // the OAuth settings are known.
  process.env.WEB_SERVER_ENABLED = "0";

  // Apply the Owner Console system settings to the Discord runtime. Mongo
  // connection settings remain boot configuration because they are required
  // before the Owner document can be read.
  await applyOwnerSystemEnv(system, process.env);
  await preferPublicAddress(system, process.env);
  const { configureCommanderApi } = await import("../lib/commander-api.js");
  const commanderApi = configureCommanderApi(process.env, { redirectUri: system.discordOAuth?.redirectUri });
  console.log(`[OmniFM] Dashboard-API: Node im Commander auf 127.0.0.1:${commanderApi.port}; der öffentliche Eingang leitet weiter.`);

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
