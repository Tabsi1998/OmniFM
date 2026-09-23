// ============================================================
// OmniFM — Runtime Health Reporter
// Schreibt ECHTE Metriken des laufenden Node-Prozesses in MongoDB
// (Collection `runtime_health`, Dokument _id="latest"). Das Owner-
// Dashboard liest daraus. Ohne laufenden Bot bleibt das Dokument leer
// und das Dashboard zeigt ehrlich "keine Live-Daten".
//
// Im produktiven Split-Modus laufen Commander und Worker in getrennten
// Prozessen. Worker liefern eigene Ressourcen über die MongoDB-Bridge.
// Im expliziten Legacy-Monolith bleiben CPU/RAM ehrlich prozessweit.
// ============================================================

import os from "node:os";
import { getDb, isConnected } from "../lib/db.js";
import { log, getRecentLogsSince } from "../lib/logging.js";

let lastCpu = process.cpuUsage();
let lastTime = Date.now();

function processCpuPct() {
  const now = Date.now();
  const cur = process.cpuUsage();
  const elapsedMs = Math.max(1, now - lastTime);
  const usedMicros = (cur.user - lastCpu.user) + (cur.system - lastCpu.system);
  lastCpu = cur;
  lastTime = now;
  const cores = Math.max(1, (os.cpus() || []).length || 1);
  const pct = (usedMicros / 1000) / (elapsedMs * cores) * 100;
  return Math.max(0, Math.min(100, Math.round(pct)));
}

function collectLocalProcessMetrics() {
  const memory = process.memoryUsage();
  return {
    pid: process.pid,
    host: os.hostname(),
    cpuPct: processCpuPct(),
    memoryRssMb: Math.round((memory.rss / (1024 * 1024)) * 10) / 10,
    memoryHeapUsedMb: Math.round((memory.heapUsed / (1024 * 1024)) * 10) / 10,
    uptimeSec: Math.max(0, Math.round(process.uptime())),
    cores: (os.cpus() || []).length || 1,
    nodeVersion: process.version,
  };
}

function finiteMetric(value) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function buildRuntimeHealthNodes(runtimes, {
  resourceModel = "shared-process",
  localProcessMetrics = {},
} = {}) {
  return runtimes.map((rt) => {
    const client = rt?.client;
    const ready = !!client?.isReady?.();
    let voice = 0;
    try { voice = client?.voice?.adapters?.size || 0; } catch { voice = 0; }
    let guilds = 0;
    try { guilds = ready ? client.guilds.cache.size : 0; } catch { guilds = 0; }
    let guildIds = [];
    try { guildIds = ready ? [...client.guilds.cache.keys()].map(String) : []; } catch { guildIds = []; }
    let runtimeDetails = [];
    try { runtimeDetails = rt?.getDashboardStatus?.()?.guildDetails || []; } catch { runtimeDetails = []; }
    const runtimeDetailByGuild = new Map(runtimeDetails.map((detail) => [String(detail.guildId || detail.id || ""), detail]));
    let guildDetails = [];
    if (ready) {
      try {
        guildDetails = [...client.guilds.cache.values()].map((guild) => {
          const includeDirectory = rt?.role === "commander";
          let roles = [];
          let channels = [];
          try {
            roles = includeDirectory ? [...(guild.roles?.cache?.values?.() || [])]
              .filter((role) => String(role.id) !== String(guild.id) && !role.managed)
              .sort((a, b) => Number(b.position || 0) - Number(a.position || 0))
              .slice(0, 100)
              .map((role) => ({
                id: String(role.id),
                name: String(role.name || role.id).slice(0, 100),
                color: role.hexColor && role.hexColor !== "#000000" ? role.hexColor : "#94a3b8",
                position: Number(role.position || 0),
              })) : [];
          } catch { roles = []; }
          try { channels = includeDirectory ? [...(guild.channels?.cache?.values?.() || [])] : []; } catch { channels = []; }
          const live = runtimeDetailByGuild.get(String(guild.id)) || {};
          const mapChannel = (channel) => ({
            id: String(channel.id),
            name: String(channel.name || channel.id).slice(0, 100),
            position: Number(channel.position || 0),
          });
          return {
            id: String(guild.id),
            guildId: String(guild.id),
            name: String(guild.name || guild.id).slice(0, 120),
            memberCount: Math.max(0, Number(guild.memberCount || 0) || 0),
            iconUrl: guild.iconURL?.({ extension: "png", size: 128 }) || null,
            roles,
            voiceChannels: channels.filter((channel) => channel.isVoiceBased?.()).map(mapChannel),
            textChannels: channels.filter((channel) => channel.isTextBased?.() && !channel.isThread?.()).map(mapChannel),
            stationKey: live.stationKey || null,
            stationName: live.stationName || null,
            desiredStationKey: live.desiredStationKey || live.stationKey || null,
            desiredStationName: live.desiredStationName || live.stationName || null,
            failoverActive: live.failoverActive === true,
            failoverStartedAt: Math.max(0, Number(live.failoverStartedAt || 0) || 0),
            failoverReason: live.failoverReason || null,
            failoverFromStationKey: live.failoverFromStationKey || null,
            failoverFromStationName: live.failoverFromStationName || null,
            channelId: live.channelId || null,
            channelName: live.channelName || null,
            listenerCount: Math.max(0, Number(live.listenerCount || 0) || 0),
            volume: Number.isFinite(Number(live.volume)) ? Number(live.volume) : null,
            voiceConnected: live.voiceConnected === true,
            playing: live.playing === true,
            recovering: live.recovering === true,
            lastStreamStartAt: live.lastStreamStartAt || null,
            reconnectAttempts: Math.max(0, Number(live.reconnectAttempts || 0) || 0),
            streamErrorCount: Math.max(0, Number(live.streamErrorCount || 0) || 0),
            failoverFailureCount: Math.max(0, Number(live.failoverFailureCount || 0) || 0),
            failbackNextProbeAt: Math.max(0, Number(live.failbackNextProbeAt || 0) || 0),
            parkedReason: live.parkedReason || null,
            parkedAt: Math.max(0, Number(live.parkedAt || 0) || 0),
            serverMuted: live.serverMuted === true,
            serverMutedAt: Math.max(0, Number(live.serverMutedAt || 0) || 0),
          };
        });
      } catch { guildDetails = []; }
    }
    let ping = null;
    try { ping = ready ? Math.max(0, Math.round(client.ws.ping)) : null; } catch { ping = null; }
    let stats = {};
    try { stats = rt?.collectStats?.() || {}; } catch { stats = {}; }
    let runtimeMetrics = {};
    if (resourceModel === "split-processes") {
      if (rt?.remote === true) {
        try { runtimeMetrics = rt?.getRuntimeMetrics?.() || {}; } catch { runtimeMetrics = {}; }
      } else {
        runtimeMetrics = localProcessMetrics;
      }
    }
    return {
      botId: String(rt?.config?.clientId || rt?.config?.id || rt?.config?.index || ""),
      runtimeId: String(rt?.config?.id || ""),
      index: Number(rt?.config?.index || 0),
      name: rt?.config?.name || `Bot ${rt?.config?.index || "?"}`,
      role: rt?.role === "commander" ? "commander" : "worker",
      requiredTier: rt?.config?.requiredTier || "free",
      status: ready ? "online" : "offline",
      pingMs: ping,
      guilds: Number(stats.servers ?? guilds) || 0,
      guildIds,
      guildDetails,
      users: Number(stats.users || 0) || 0,
      voiceConnections: Number(stats.connections ?? voice) || 0,
      listeners: Number(stats.listeners || 0) || 0,
      userTag: ready ? (client.user?.tag || client.user?.username || null) : null,
      cpuPct: resourceModel === "split-processes" ? finiteMetric(runtimeMetrics.cpuPct) : null,
      ramMb: resourceModel === "split-processes" ? finiteMetric(runtimeMetrics.memoryRssMb ?? runtimeMetrics.ramMb) : null,
      heapUsedMb: resourceModel === "split-processes" ? finiteMetric(runtimeMetrics.memoryHeapUsedMb) : null,
      uptimeSec: resourceModel === "split-processes" ? finiteMetric(runtimeMetrics.uptimeSec) : null,
      pid: resourceModel === "split-processes" ? finiteMetric(runtimeMetrics.pid) : null,
      host: resourceModel === "split-processes" ? (runtimeMetrics.host || null) : null,
      nodeVersion: resourceModel === "split-processes" ? (runtimeMetrics.nodeVersion || null) : null,
      resourceScope: resourceModel === "split-processes" ? "node-process" : "shared-process",
    };
  });
}

const GUILD_DIRECTORY_LIST_FIELDS = ["roles", "voiceChannels", "textChannels"];
const GUILD_DIRECTORY_REFRESH_MS = 30 * 60_000;
const GUILD_DIRECTORY_STALE_MS = 7 * 24 * 60 * 60_000;

function isLiveGuildDetail(detail) {
  return Boolean(
    detail.playing
    || detail.voiceConnected
    || detail.recovering
    || detail.failoverActive
    || detail.parkedReason
    || detail.serverMuted
    || detail.stationKey
    || detail.channelId
  );
}

/**
 * Splits the server directory off the health nodes. Before, every bot wrote
 * every server with roles and channels into the health document every 5 s
 * (#206). Now a node keeps guildIds for membership and guildDetails only for
 * servers with playback, a connection or a problem; name, member count, icon,
 * roles and channels go to runtime_guild_directory, written on change.
 */
export function splitGuildDirectory(nodes = []) {
  const directory = new Map();
  const slimNodes = nodes.map((node) => {
    const liveDetails = [];
    for (const detail of node.guildDetails || []) {
      const guildId = String(detail?.guildId || detail?.id || "");
      if (!guildId) continue;
      const entry = directory.get(guildId) || {
        name: null,
        memberCount: 0,
        iconUrl: null,
        roles: [],
        voiceChannels: [],
        textChannels: [],
      };
      if (!entry.name && detail.name) entry.name = detail.name;
      entry.memberCount = Math.max(entry.memberCount, Number(detail.memberCount || 0) || 0);
      if (!entry.iconUrl && detail.iconUrl) entry.iconUrl = detail.iconUrl;
      for (const field of GUILD_DIRECTORY_LIST_FIELDS) {
        if (!entry[field].length && Array.isArray(detail[field]) && detail[field].length) entry[field] = detail[field];
      }
      directory.set(guildId, entry);
      if (isLiveGuildDetail(detail)) {
        const slim = { ...detail };
        for (const field of GUILD_DIRECTORY_LIST_FIELDS) delete slim[field];
        delete slim.memberCount;
        delete slim.iconUrl;
        liveDetails.push(slim);
      }
    }
    return { ...node, guildDetails: liveDetails };
  });
  return { nodes: slimNodes, directory };
}

/**
 * Writes one document per server into runtime_guild_directory, only when its
 * roles or channels changed, plus a full refresh every 30 minutes that also
 * removes servers not seen for a week.
 */
export function createGuildDirectoryWriter({
  getDatabase = getDb,
  refreshMs = GUILD_DIRECTORY_REFRESH_MS,
  staleMs = GUILD_DIRECTORY_STALE_MS,
} = {}) {
  const signatures = new Map();
  let lastFullAt = 0;
  return async function writeGuildDirectory(directory, now = Date.now()) {
    const full = now - lastFullAt >= refreshMs;
    const changed = [];
    for (const [guildId, entry] of directory) {
      const signature = JSON.stringify(entry);
      if (!full && signatures.get(guildId) === signature) continue;
      changed.push({ guildId, entry, signature });
    }
    const collection = getDatabase().collection("runtime_guild_directory");
    const at = new Date(now).toISOString();
    if (changed.length) {
      await collection.bulkWrite(changed.map(({ guildId, entry }) => ({
        replaceOne: { filter: { _id: guildId }, replacement: { ...entry, at }, upsert: true },
      })), { ordered: false });
      for (const { guildId, signature } of changed) signatures.set(guildId, signature);
    }
    if (full) {
      lastFullAt = now;
      await collection.deleteMany({ at: { $lt: new Date(now - staleMs).toISOString() } });
    }
    return changed.length;
  };
}

/**
 * Sends the log lines of this process to the capped collection runtime_logs,
 * only lines that were not sent yet. Every process (commander, each worker,
 * the monolith) ships its own lines, so the owner console sees all of them;
 * before, only the commander's last 500 lines were rewritten every 5 s (#206).
 */
export function createRuntimeLogShipper({
  processLabel = "runtime",
  getDatabase = getDb,
  connected = isConnected,
  readLogs = getRecentLogsSince,
} = {}) {
  let lastSeq = 0;
  let running = false;
  return async function shipRuntimeLogs() {
    if (running || !connected()) return 0;
    const entries = readLogs(lastSeq);
    if (!entries.length) return 0;
    running = true;
    try {
      const host = os.hostname();
      await getDatabase().collection("runtime_logs").insertMany(entries.map((entry) => ({
        at: entry.at,
        level: entry.level,
        source: entry.source,
        message: entry.message,
        process: processLabel,
        pid: process.pid,
        host,
      })), { ordered: true });
      lastSeq = entries[entries.length - 1].seq;
      return entries.length;
    } catch {
      // Keep lastSeq: the lines are sent with the next tick. Never log here,
      // a failing insert must not produce new lines to ship.
      return 0;
    } finally {
      running = false;
    }
  };
}

export function startRuntimeLogShipper({ processLabel = "runtime", intervalMs = 5000 } = {}) {
  const ship = createRuntimeLogShipper({ processLabel });
  const timer = setInterval(() => { ship().catch(() => null); }, Math.max(2000, intervalMs));
  timer.unref?.();
  return () => clearInterval(timer);
}

export function startRuntimeHealthReporter(runtimes, {
  intervalMs = 5000,
  resourceModel = String(process.env.OMNIFM_DEPLOYMENT_MODE || "").toLowerCase() === "split"
    ? "split-processes"
    : "shared-process",
  processLabel = resourceModel === "split-processes" ? "commander" : "runtime",
} = {}) {
  processCpuPct(); // prime CPU delta
  const writeGuildDirectory = createGuildDirectoryWriter();

  const write = async () => {
    if (!isConnected()) return;
    try {
      const localMetrics = collectLocalProcessMetrics();
      const { nodes, directory } = splitGuildDirectory(buildRuntimeHealthNodes(runtimes, {
        resourceModel,
        localProcessMetrics: localMetrics,
      }));
      const reportedNodes = nodes.filter((node) => node.pid != null);
      const aggregateCpuPct = reportedNodes.reduce((sum, node) => sum + (finiteMetric(node.cpuPct) || 0), 0);
      const aggregateRamMb = reportedNodes.reduce((sum, node) => sum + (finiteMetric(node.ramMb) || 0), 0);
      const splitProcesses = resourceModel === "split-processes";
      const doc = {
        _id: "latest",
        at: new Date().toISOString(),
        pid: process.pid,
        host: os.hostname(),
        process: {
          cpuPct: splitProcesses ? Math.round(aggregateCpuPct * 10) / 10 : localMetrics.cpuPct,
          ramMb: splitProcesses ? Math.round(aggregateRamMb * 10) / 10 : localMetrics.memoryRssMb,
          totalCpuPct: splitProcesses ? Math.round(aggregateCpuPct * 10) / 10 : localMetrics.cpuPct,
          totalRamMb: splitProcesses ? Math.round(aggregateRamMb * 10) / 10 : localMetrics.memoryRssMb,
          uptimeSec: localMetrics.uptimeSec,
          cores: localMetrics.cores,
          nodeVersion: localMetrics.nodeVersion,
          processCount: splitProcesses ? reportedNodes.length : 1,
          resourceModel,
        },
        nodes,
        healthyNodes: nodes.filter((n) => n.status === "online").length,
        totalNodes: nodes.length,
      };
      const database = getDb();
      await database.collection("runtime_health").replaceOne({ _id: "latest" }, doc, { upsert: true });
      await writeGuildDirectory(directory);
    } catch (err) {
      log("ERROR", `[health-reporter] Metrik-Schreiben fehlgeschlagen: ${err?.message || err}`);
    }
  };

  write();
  const timer = setInterval(write, Math.max(2000, intervalMs));
  timer.unref?.();
  const stopLogShipper = startRuntimeLogShipper({ processLabel, intervalMs });
  log("INFO", `[health-reporter] Aktiv – meldet echte Metriken alle ${Math.round(Math.max(2000, intervalMs) / 1000)}s an MongoDB.`);
  return () => {
    clearInterval(timer);
    stopLogShipper();
  };
}

// Schreibt ein ECHTES Incident (z. B. Stream-Fehler, FFmpeg-Neustart, Reconnect)
// in MongoDB `runtime_incidents` – genau die Collection, die das Owner-Dashboard liest.
const OWNER_INCIDENT_KEEP = 500;
const OWNER_INCIDENT_PRUNE_EVERY_MS = 10 * 60_000;
let lastOwnerIncidentPruneAt = 0;

/**
 * Keeps the newest OWNER_INCIDENT_KEEP process-level incidents. Server-level
 * incidents (with guildId) belong to the dashboards and expire by TTL only.
 */
export async function pruneOwnerRuntimeIncidents(database, keep = OWNER_INCIDENT_KEEP) {
  const ownerOnly = { guildId: { $exists: false } };
  const cutoff = await database.collection("runtime_incidents")
    .find(ownerOnly, { projection: { at: 1 } })
    .sort({ at: -1 })
    .skip(Math.max(1, keep))
    .limit(1)
    .toArray();
  if (!cutoff.length) return 0;
  const result = await database.collection("runtime_incidents").deleteMany({ ...ownerOnly, at: { $lte: cutoff[0].at } });
  return Number(result?.deletedCount || 0) || 0;
}

export async function recordRuntimeIncident({ severity = "info", source = "runtime", message = "", resolved = false } = {}) {
  if (!isConnected()) return;
  try {
    const database = getDb();
    const now = new Date();
    await database.collection("runtime_incidents").insertOne({
      at: now.toISOString(),
      // The TTL index on timestamp (90 days) now covers these rows as well.
      timestamp: now,
      severity: String(severity).toLowerCase(),
      source: String(source || "runtime").slice(0, 60),
      message: String(message || "").slice(0, 240),
      resolved: !!resolved,
    });
    // Counting the collection after every insert cost two extra queries per
    // incident, several per second during reconnect storms (#206). Trim at
    // most every ten minutes instead.
    if (Date.now() - lastOwnerIncidentPruneAt > OWNER_INCIDENT_PRUNE_EVERY_MS) {
      lastOwnerIncidentPruneAt = Date.now();
      await pruneOwnerRuntimeIncidents(database);
    }
  } catch { /* noop */ }
}
