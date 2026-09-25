// ============================================================
// OmniFM: the owner console's monitoring on the Node API (#288)
// ============================================================
// The Node twin of backend/services/monitoring.py and the monitoring routes
// of backend/routers/admin.py. The source is the same as FastAPI's: the
// health document the bots write into MongoDB (runtime_health "latest"),
// the per-server directory (runtime_guild_directory), incidents and logs.
// So every process of a split setup is seen, not only this one. The
// simulated demo telemetry of SEED_DEMO_DATA is left out: without live data
// the answer is the honest "waiting" state.
import { execFileSync } from "node:child_process";
import fs from "node:fs";

import { rootDir } from "./logging.js";
import { configSectionFrom } from "./owner-config.js";
import { isValidServerId, parseIntLike } from "./owner-licenses.js";

export const FAILOVER_HISTORY_EVENTS = Object.freeze([
  "stream_failover_activated",
  "stream_failover_exhausted",
  "stream_failback_completed",
  "stream_failback_abandoned",
]);
const BOT_IMAGES = ["/img/bot-1.png", "/img/bot-2.png", "/img/bot-3.png", "/img/bot-4.png"];
const BOT_COLORS = ["cyan", "green", "pink", "amber", "purple", "red"];
const TIER_PRICE_CENTS = { free: 0, pro: 299, ultimate: 499 };
const HEALTH_MAX_AGE_SEC = 30;

const clip = (value, max = 300) => {
  const text = String(value ?? "").trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
};
const isoOf = (value) => (value instanceof Date ? value.toISOString() : value ?? null);

// ---- settings like system_setting() / directory_setting() ----

const filled = (value) => value !== undefined && value !== null && value !== "";

/**
 * @param {any} raw @param {string} group @param {string} key @param {string|null} [envKey]
 * @param {any} [fallback] @param {Record<string, string|undefined>} [env]
 */
export function systemSetting(raw, group, key, envKey = null, fallback = "", env = process.env) {
  const stored = raw?.system?.[group] || {};
  if (key in stored && filled(stored[key])) return stored[key];
  if (envKey && filled(env[envKey])) return env[envKey];
  return fallback;
}

/**
 * @param {any} raw @param {string} directory @param {string} key @param {string|null} [envKey]
 * @param {any} [fallback] @param {Record<string, string|undefined>} [env]
 */
export function directorySetting(raw, directory, key, envKey = null, fallback = "", env = process.env) {
  const stored = raw?.system?.botDirectories?.[directory] || {};
  if (key in stored && filled(stored[key])) return stored[key];
  if (envKey && filled(env[envKey])) return env[envKey];
  return fallback;
}

export function configBool(value, fallback = false) {
  if (typeof value === "boolean") return value;
  if (!filled(value)) return fallback;
  return ["1", "true", "yes", "on"].includes(String(value).trim().toLowerCase());
}

export function stripeSecretKey(raw, env = process.env) {
  const stored = String(configSectionFrom(raw, "payments")?.stripe?.secretKey || "").trim();
  return stored || String(env.STRIPE_SECRET_KEY || env.STRIPE_API_KEY || "").trim();
}

export function isStripeEnabled(raw, env = process.env) {
  const stored = raw?.payments?.stripe || {};
  if ("enabled" in stored) return Boolean(stored.enabled);
  return Boolean(stripeSecretKey(raw, env));
}

export function isDiscordOauthConfigured(raw, env = process.env) {
  return Boolean(systemSetting(raw, "discordOAuth", "clientId", "DISCORD_CLIENT_ID", "", env)
    && systemSetting(raw, "discordOAuth", "clientSecret", "DISCORD_CLIENT_SECRET", "", env));
}

export function smtpConfigured(raw, env = process.env) {
  const host = String(systemSetting(raw, "smtp", "host", "SMTP_HOST", "", env) || "").trim();
  return configBool(systemSetting(raw, "smtp", "enabled", null, Boolean(host), env)) && Boolean(host);
}

export async function mongoIsReachable(db) {
  if (!db) return false;
  try {
    await db.command({ ping: 1 });
    return true;
  } catch {
    return false;
  }
}

let releaseInfo = null;
/** Version from package.json and the running commit, read once (read_release_info). */
export function readReleaseInfo() {
  if (releaseInfo) return { ...releaseInfo };
  let version;
  let commit;
  try {
    version = String(JSON.parse(fs.readFileSync(`${rootDir}/package.json`, "utf8")).version || "").trim();
  } catch {
    version = "";
  }
  try {
    commit = execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: rootDir, timeout: 3000, stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
  } catch {
    commit = "";
  }
  releaseInfo = { version: version || "unknown", commit: commit || "unknown" };
  return { ...releaseInfo };
}

// ---- the live data the bots write ----

/** The health document when it is at most 30 seconds old (read_runtime_health_fresh). */
export async function readRuntimeHealthFresh(db, { maxAgeSec = HEALTH_MAX_AGE_SEC, now = Date.now() } = {}) {
  if (!db) return null;
  let doc;
  try {
    doc = await db.collection("runtime_health").findOne({ _id: "latest" }, { projection: { _id: 0 } });
  } catch {
    return null;
  }
  const at = Date.parse(doc?.at || "");
  if (!doc || !Number.isFinite(at) || (now - at) / 1000 > maxAgeSec) return null;
  return doc;
}

/** One source of truth for the live numbers, zeros without a running bot. */
export function liveRuntimeTotals(doc) {
  if (!doc) return { botsOnline: 0, servers: 0, users: 0, voiceConnections: 0, listeners: 0, live: false };
  const online = (doc.nodes || []).filter((node) => node?.status === "online");
  const guildIds = new Set(online.flatMap((node) => (node.guildIds || []).map(String).filter((id) => id.trim())));
  const sum = (field) => online.reduce((total, node) => total + (Number.parseInt(String(node[field] || 0), 10) || 0), 0);
  return {
    botsOnline: online.length,
    servers: guildIds.size || sum("guilds"),
    users: sum("users"),
    voiceConnections: sum("voiceConnections"),
    listeners: sum("listeners"),
    live: true,
  };
}

function mergeGuildFields(guild, source) {
  if (!guild.name && source?.name) guild.name = source.name;
  guild.memberCount = Math.max(parseIntLike(guild.memberCount, 0), parseIntLike(source?.memberCount, 0));
  if (!guild.iconUrl && source?.iconUrl) guild.iconUrl = source.iconUrl;
  for (const field of ["roles", "voiceChannels", "textChannels"]) {
    if (!guild[field].length && Array.isArray(source?.[field])) guild[field] = source[field];
  }
}

/** The servers the running bots are in (_runtime_guild_directory). */
export async function runtimeGuildDirectory(db, healthDoc, { guildIds = null, withLists = false } = {}) {
  const wanted = guildIds ? new Set(guildIds.map((id) => String(id || "").trim())) : null;
  const guilds = {};
  for (const node of healthDoc?.nodes || []) {
    const botName = String(node.name || node.index || "Bot");
    const inline = {};
    for (const detail of node.guildDetails || []) {
      if (detail && typeof detail === "object") inline[String(detail.guildId || detail.id || "").trim()] = detail;
    }
    const memberIds = [...(node.guildIds || []).map((id) => String(id || "").trim()), ...Object.keys(inline)];
    for (const guildId of memberIds) {
      if (!isValidServerId(guildId) || (wanted && !wanted.has(guildId))) continue;
      const guild = guilds[guildId] || {
        id: guildId, name: null, memberCount: 0, iconUrl: null, roles: [], voiceChannels: [], textChannels: [], bots: [],
        discordUrl: `https://discord.com/channels/${guildId}`,
      };
      mergeGuildFields(guild, inline[guildId] || {});
      if (!guild.bots.includes(botName)) guild.bots.push(botName);
      guilds[guildId] = guild;
    }
  }
  const ids = Object.keys(guilds);
  if (db && ids.length) {
    try {
      const projection = withLists ? undefined : { roles: 0, voiceChannels: 0, textChannels: 0 };
      const rows = await db.collection("runtime_guild_directory").find({ _id: { $in: ids } }, projection ? { projection } : {}).toArray();
      for (const row of rows) if (guilds[String(row._id)]) mergeGuildFields(guilds[String(row._id)], row);
    } catch {
      // The directory is extra detail; membership alone still lists the server.
    }
  }
  for (const guild of Object.values(guilds)) {
    guild.name = String(guild.name || guild.id).slice(0, 120);
    guild.bots = [...new Set(guild.bots)].sort();
  }
  return guilds;
}

/** Servers the owner should look at: parked, backup station, muted, recovering (build_affected_servers). */
export function buildAffectedServers(nodes, nowMs = Date.now()) {
  const rows = [];
  for (const node of nodes || []) {
    for (const detail of node?.guildDetails || []) {
      if (!detail || typeof detail !== "object") continue;
      let state;
      let since;
      if (detail.parkedReason) [state, since] = ["parked", detail.parkedAt];
      else if (detail.failoverActive === true) [state, since] = ["failover", detail.failoverStartedAt];
      else if (detail.serverMuted === true) [state, since] = ["muted", detail.serverMutedAt];
      else if (detail.recovering === true) [state, since] = ["recovering", 0];
      else continue;
      const sinceMs = Math.max(0, parseIntLike(since, 0));
      rows.push({
        guildId: String(detail.guildId || detail.id || ""),
        guildName: clip(detail.name || detail.guildName || detail.guildId || "", 120),
        botName: clip(node.name || "OmniFM", 80),
        state,
        sinceMs,
        durationSec: sinceMs ? Math.max(0, Math.floor((nowMs - sinceMs) / 1000)) : null,
        stationName: clip(detail.stationName || detail.stationKey || "", 120),
        desiredStationName: clip(detail.desiredStationName || detail.desiredStationKey || "", 120),
        detail: clip(detail.parkedReason || detail.failoverReason || "", 200),
        failbackNextProbeAt: Math.max(0, parseIntLike(detail.failbackNextProbeAt, 0)),
      });
    }
  }
  return rows.sort((a, b) => (a.sinceMs || nowMs) - (b.sinceMs || nowMs));
}

export function formatRuntimeIncident(doc = {}) {
  let message = doc.message || doc.summary;
  if (!message && doc.eventKey) {
    const guild = doc.guildName || doc.guildId || "";
    message = guild ? `${guild}: ${doc.eventKey}` : String(doc.eventKey);
  }
  const runtime = doc.runtime && typeof doc.runtime === "object" ? doc.runtime : {};
  return {
    at: isoOf(doc.at || doc.timestamp),
    severity: String(doc.severity || doc.level || "info").toLowerCase(),
    source: doc.source || runtime.name || "runtime",
    message: clip(message || "Incident", 240),
    resolved: Boolean(doc.resolved) || Boolean(doc.acknowledgedAt),
  };
}

export function formatFailoverHistoryRow(doc = {}) {
  const payload = doc.payload && typeof doc.payload === "object" ? doc.payload : {};
  const event = String(doc.eventKey || "");
  const previous = payload.previousStationName || payload.previousStationKey || "";
  const backup = payload.failoverStationName || payload.failoverStationKey || "";
  const restored = payload.restoredStationName || payload.restoredStationKey || "";
  const [kind, from, to] = event === "stream_failback_completed" ? ["back", previous, restored]
    : event === "stream_failback_abandoned" ? ["stay", previous, backup]
      : event === "stream_failover_exhausted" ? ["exhausted", previous, ""]
        : ["switch", previous, backup];
  const durationMs = parseIntLike(payload.failoverDurationMs, 0);
  const runtime = doc.runtime && typeof doc.runtime === "object" ? doc.runtime : {};
  return {
    at: isoOf(doc.timestamp || doc.at),
    guildId: String(doc.guildId || ""),
    guildName: clip(doc.guildName || doc.guildId || "", 120),
    event,
    kind,
    from: clip(from, 120),
    to: clip(to, 120),
    reason: clip(payload.triggerError || payload.reason || "", 240),
    durationSec: durationMs > 0 ? Math.floor(durationMs / 1000) : null,
    runtime: clip(runtime.name || doc.source || "", 80),
  };
}

export async function readRuntimeLogs(db, limit = 500) {
  if (!db) return [];
  try {
    const rows = await db.collection("runtime_logs").find({}, { projection: { _id: 0 } }).sort({ $natural: -1 }).limit(Math.max(1, limit)).toArray();
    return rows.map((row) => ({
      at: row.at ?? null,
      level: row.level || "INFO",
      source: row.source || row.process || "runtime",
      message: clip(row.message || "", 240),
      process: row.process ?? null,
    }));
  } catch {
    return [];
  }
}

/** The configured bots: BOT_n_* from the environment, else the owner console (load_bots_from_env). */
export function loadConfiguredBots(raw, env = process.env) {
  const invite = (clientId) => `https://discord.com/oauth2/authorize?client_id=${clientId}&permissions=35186522836032&integration_type=0&scope=bot%20applications.commands`;
  const base = (index, name, clientId, tier, inviteUrl) => ({
    botId: `bot-${index}`,
    index,
    name,
    clientId: clientId || `0000000000000000${String(index).padStart(2, "0")}`,
    inviteUrl,
    requiredTier: tier,
    color: BOT_COLORS[(index - 1) % BOT_COLORS.length],
    avatarUrl: index <= BOT_IMAGES.length ? BOT_IMAGES[(index - 1) % BOT_IMAGES.length] : "",
    servers: 0, users: 0, connections: 0, listeners: 0,
    ready: false, userTag: null, uptimeSec: 0, guildDetails: [],
  });
  const bots = [];
  for (let index = 1; index <= 20; index += 1) {
    const token = String(env[`BOT_${index}_TOKEN`] || "").trim();
    const clientId = String(env[`BOT_${index}_CLIENT_ID`] || "").trim();
    if (!token && !clientId) continue;
    const tier = String(env[`BOT_${index}_TIER`] || "free").trim().toLowerCase();
    const name = String(env[`BOT_${index}_NAME`] || `OmniFM Bot ${index}`).trim();
    bots.push(base(index, name, clientId, tier, tier !== "free" ? null : (clientId ? invite(clientId) : "")));
  }
  if (bots.length) return bots;
  const discord = configSectionFrom(raw, "discord");
  const entries = [];
  if (String(discord.commander?.clientId || "").trim()) entries.push(["free", discord.commander]);
  for (const worker of discord.workers || []) {
    if (worker && typeof worker === "object" && String(worker.clientId || "").trim()) entries.push([String(worker.tier || "free").toLowerCase(), worker]);
  }
  return entries.map(([tier, bot], position) => {
    const index = position + 1;
    const clientId = String(bot.clientId || "").trim();
    const inviteUrl = String(bot.inviteUrl || "").trim() || (tier !== "free" ? null : (clientId ? invite(clientId) : ""));
    return base(index, String(bot.name || `OmniFM Bot ${index}`).trim(), clientId, tier, inviteUrl);
  });
}

/** Catalog stations per tier from MongoDB, else stations.json (_station_summary). */
export async function stationSummary(db, loadFileStations = () => ({})) {
  let free = 0;
  let pro = 0;
  const sample = [];
  const notCustom = { key: { $not: /^custom:/ } };
  if (db) {
    try {
      [free, pro] = await Promise.all([
        db.collection("stations").countDocuments({ ...notCustom, tier: "free" }),
        db.collection("stations").countDocuments({ ...notCustom, tier: "pro" }),
      ]);
      for (const doc of await db.collection("stations").find(notCustom, { projection: { _id: 0 } }).limit(60).toArray()) {
        sample.push({ key: doc.key, name: doc.name, tier: doc.tier || "free", genre: doc.genre || doc.category || null, url: doc.url });
      }
    } catch {
      // Fall back to the file below.
    }
  }
  if (!free && !pro) {
    for (const [key, station] of Object.entries(loadFileStations() || {})) {
      if (String(key).startsWith("custom:")) continue;
      const tier = String(station?.tier || "free").toLowerCase();
      if (tier === "free") free += 1;
      else if (tier === "pro") pro += 1;
      if (sample.length < 60) sample.push({ key, name: station?.name, tier, genre: station?.genre || station?.category || null, url: station?.url });
    }
  }
  return { free, pro, total: free + pro, sample };
}

export function commanderIndex(env = process.env) {
  return parseIntLike(env.COMMANDER_BOT_INDEX || "1", 1);
}

/** The integration switches the overview and /api/admin/integrations show. */
export async function integrationFlags(db, raw, env = process.env) {
  return {
    mongo: await mongoIsReachable(db),
    stripe: isStripeEnabled(raw, env) && Boolean(stripeSecretKey(raw, env)),
    discordOAuth: isDiscordOauthConfigured(raw, env),
    smtp: smtpConfigured(raw, env),
    recognition: configBool(systemSetting(raw, "audioRecognition", "enabled", "NOW_PLAYING_RECOGNITION_ENABLED", false, env)),
  };
}

/** GET /api/admin/monitoring: live when the bots report, else honestly waiting. */
export async function monitoringResponse(db, { now = Date.now() } = {}) {
  const generatedAt = new Date(now).toISOString();
  const doc = await readRuntimeHealthFresh(db, { now });
  const mongo = await mongoIsReachable(db);
  if (!doc) {
    return {
      generatedAt,
      simulated: false,
      live: false,
      waiting: true,
      process: null,
      health: { healthyNodes: 0, totalNodes: 0, uptimeSec: 0, apiLatencyMs: null, mongo, openIncidents: 0 },
      nodes: [],
      affectedServers: [],
      incidents: [],
      logs: [],
      message: "Warte auf Live-Daten vom OmniFM-Bot. Sobald der Node-Bot laeuft (echte Tokens im Owner-Menue) und Metriken meldet, erscheinen hier CPU/RAM/Ping, Voice, Guilds, Incidents und Live-Log in Echtzeit.",
    };
  }
  const processInfo = doc.process || {};
  const split = String(processInfo.resourceModel || "shared-process") === "split-processes";
  const nodes = (doc.nodes || []).map((node) => ({
    botId: node.botId ?? null,
    index: node.index ?? null,
    name: node.name ?? null,
    role: node.role ?? null,
    requiredTier: node.requiredTier || "free",
    status: node.status ?? null,
    pingMs: node.pingMs ?? null,
    guilds: node.guilds ?? 0,
    guildDetails: node.guildDetails || [],
    voiceConnections: node.voiceConnections ?? 0,
    listeners: node.listeners ?? 0,
    // Per-process figures only in split mode; a shared process would show one value for all.
    cpuPct: split ? node.cpuPct ?? null : null,
    ramMb: split ? node.ramMb ?? null : null,
    heapUsedMb: split ? node.heapUsedMb ?? null : null,
    uptimeSec: split ? node.uptimeSec ?? null : null,
    pid: split ? node.pid ?? null : null,
    host: split ? node.host ?? null : null,
    nodeVersion: split ? node.nodeVersion ?? null : null,
    resourceScope: split ? "node-process" : "shared-process",
  }));
  let incidents = [];
  if (db) {
    try {
      incidents = (await db.collection("runtime_incidents").find({}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(25).toArray()).map(formatRuntimeIncident);
    } catch {
      incidents = [];
    }
  }
  const logs = await readRuntimeLogs(db);
  return {
    generatedAt,
    simulated: false,
    live: true,
    process: processInfo,
    health: {
      healthyNodes: nodes.filter((node) => node.status === "online").length,
      totalNodes: nodes.length,
      uptimeSec: processInfo.uptimeSec ?? 0,
      apiLatencyMs: null,
      mongo,
      openIncidents: incidents.filter((incident) => !incident.resolved).length,
    },
    nodes,
    affectedServers: buildAffectedServers(doc.nodes || [], now),
    incidents,
    logs: logs.length ? logs : (doc.logs || []).slice(0, 500),
  };
}

/** GET /api/admin/workers: configured bots matched with what they report. */
export async function workersResponse(db, raw, env = process.env, { now = Date.now() } = {}) {
  const bots = loadConfiguredBots(raw, env);
  const doc = await readRuntimeHealthFresh(db, { now });
  const liveNodes = doc?.nodes || [];
  const liveProcess = doc?.process || {};
  const byId = new Map(liveNodes.filter((node) => node.botId).map((node) => [String(node.botId), node]));
  const byIndex = new Map(liveNodes.filter((node) => parseIntLike(node.index, 0) > 0).map((node) => [parseIntLike(node.index, 0), node]));
  const commander = commanderIndex(env);
  const matched = new Set();
  const row = (node, bot) => ({
    botId: node?.botId || bot?.botId || `runtime-${node?.index}`,
    index: bot ? bot.index : node.index,
    name: node?.name || bot?.name || `Bot ${node?.index}`,
    role: node?.role || (bot ? (bot.index === commander ? "commander" : "worker") : "worker"),
    requiredTier: bot ? bot.requiredTier : null,
    clientId: bot ? bot.clientId : node.botId,
    ready: node ? node.status === "online" : false,
    status: node?.status || "offline",
    servers: parseIntLike(node?.guilds ?? bot?.servers ?? 0, 0),
    listeners: parseIntLike(node?.listeners ?? bot?.listeners ?? 0, 0),
    connections: parseIntLike(node?.voiceConnections ?? bot?.connections ?? 0, 0),
    pingMs: node?.pingMs ?? null,
    guildDetails: node?.guildDetails || [],
    uptimeSec: parseIntLike(node?.uptimeSec ?? liveProcess.uptimeSec ?? 0, 0),
    cpuPct: node?.cpuPct ?? null,
    ramMb: node?.ramMb ?? null,
    heapUsedMb: node?.heapUsedMb ?? null,
    pid: node?.pid ?? null,
    host: node?.host ?? null,
    nodeVersion: node?.nodeVersion ?? null,
    resourceScope: node?.resourceScope || "shared-process",
    color: bot ? bot.color : null,
  });
  const workers = bots.map((bot) => {
    const node = byId.get(String(bot.clientId || "")) || byId.get(String(bot.botId || "")) || byIndex.get(parseIntLike(bot.index, 0));
    if (node) matched.add(`${node.botId || ""}|${parseIntLike(node.index, 0)}`);
    return row(node, bot);
  });
  // A just-started bot may report before the configuration is reloaded: keep it visible.
  for (const node of liveNodes) {
    if (!matched.has(`${node.botId || ""}|${parseIntLike(node.index, 0)}`)) workers.push(row(node, null));
  }
  workers.sort((a, b) => parseIntLike(a.index, 999) - parseIntLike(b.index, 999));
  return {
    workers,
    count: workers.length,
    commanderIndex: commander,
    live: Boolean(doc),
    generatedAt: doc?.at ?? null,
    resourceModel: doc?.process?.resourceModel ?? null,
  };
}

export { TIER_PRICE_CENTS };
