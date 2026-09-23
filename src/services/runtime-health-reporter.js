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
import { log, getRecentLogs } from "../lib/logging.js";

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
            serverMuted: live.serverMuted === true,
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

export function startRuntimeHealthReporter(runtimes, {
  intervalMs = 5000,
  resourceModel = String(process.env.OMNIFM_DEPLOYMENT_MODE || "").toLowerCase() === "split"
    ? "split-processes"
    : "shared-process",
} = {}) {
  processCpuPct(); // prime CPU delta

  const write = async () => {
    if (!isConnected()) return;
    try {
      const localMetrics = collectLocalProcessMetrics();
      const nodes = buildRuntimeHealthNodes(runtimes, {
        resourceModel,
        localProcessMetrics: localMetrics,
      });
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
        logs: getRecentLogs(500),
        healthyNodes: nodes.filter((n) => n.status === "online").length,
        totalNodes: nodes.length,
      };
      const database = getDb();
      await database.collection("runtime_health").replaceOne({ _id: "latest" }, doc, { upsert: true });
    } catch (err) {
      log("ERROR", `[health-reporter] Metrik-Schreiben fehlgeschlagen: ${err?.message || err}`);
    }
  };

  write();
  const timer = setInterval(write, Math.max(2000, intervalMs));
  timer.unref?.();
  log("INFO", `[health-reporter] Aktiv – meldet echte Metriken alle ${Math.round(Math.max(2000, intervalMs) / 1000)}s an MongoDB.`);
  return () => clearInterval(timer);
}

// Schreibt ein ECHTES Incident (z. B. Stream-Fehler, FFmpeg-Neustart, Reconnect)
// in MongoDB `runtime_incidents` – genau die Collection, die das Owner-Dashboard liest.
export async function recordRuntimeIncident({ severity = "info", source = "runtime", message = "", resolved = false } = {}) {
  if (!isConnected()) return;
  try {
    const database = getDb();
    await database.collection("runtime_incidents").insertOne({
      at: new Date().toISOString(),
      severity: String(severity).toLowerCase(),
      source: String(source || "runtime").slice(0, 60),
      message: String(message || "").slice(0, 240),
      resolved: !!resolved,
    });
    // Best-effort: Collection klein halten (neueste ~200 behalten).
    const count = await database.collection("runtime_incidents").countDocuments();
    if (count > 250) {
      const cutoff = await database.collection("runtime_incidents")
        .find({}, { projection: { at: 1 } }).sort({ at: -1 }).skip(200).limit(1).toArray();
      if (cutoff.length) {
        await database.collection("runtime_incidents").deleteMany({ at: { $lt: cutoff[0].at } });
      }
    }
  } catch { /* noop */ }
}
