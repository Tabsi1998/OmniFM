// ============================================================
// OmniFM — Runtime Health Reporter
// Schreibt ECHTE Metriken des laufenden Node-Prozesses in MongoDB
// (Collection `runtime_health`, Dokument _id="latest"). Das Owner-
// Dashboard liest daraus. Ohne laufenden Bot bleibt das Dokument leer
// und das Dashboard zeigt ehrlich "keine Live-Daten".
//
// Wichtig / ehrlich: Commander + alle Worker laufen in EINEM Node-
// Prozess auf EINEM Server. CPU/RAM sind daher prozessweit (geteilt).
// Getrennt pro Bot sind nur: Discord-Ping, Guild-Anzahl, Voice-Verbindungen.
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

function nodeMetrics(runtimes) {
  return runtimes.map((rt) => {
    const client = rt?.client;
    const ready = !!client?.isReady?.();
    let voice = 0;
    try { voice = client?.voice?.adapters?.size || 0; } catch { voice = 0; }
    let guilds = 0;
    try { guilds = ready ? client.guilds.cache.size : 0; } catch { guilds = 0; }
    let guildIds = [];
    try { guildIds = ready ? [...client.guilds.cache.keys()].map(String) : []; } catch { guildIds = []; }
    let guildDetails = [];
    try {
      guildDetails = ready
        ? [...client.guilds.cache.values()].map((guild) => ({
          id: String(guild.id),
          name: String(guild.name || guild.id).slice(0, 120),
          memberCount: Math.max(0, Number(guild.memberCount || 0) || 0),
          iconUrl: guild.iconURL?.({ extension: "png", size: 128 }) || null,
        }))
        : [];
    } catch { guildDetails = []; }
    let ping = null;
    try { ping = ready ? Math.max(0, Math.round(client.ws.ping)) : null; } catch { ping = null; }
    let stats = {};
    try { stats = rt?.collectStats?.() || {}; } catch { stats = {}; }
    return {
      botId: String(rt?.config?.clientId || rt?.config?.id || rt?.config?.index || ""),
      index: Number(rt?.config?.index || 0),
      name: rt?.config?.name || `Bot ${rt?.config?.index || "?"}`,
      role: rt?.role === "commander" ? "commander" : "worker",
      status: ready ? "online" : "offline",
      pingMs: ping,
      guilds: Number(stats.servers ?? guilds) || 0,
      guildIds,
      guildDetails,
      users: Number(stats.users || 0) || 0,
      voiceConnections: Number(stats.connections ?? voice) || 0,
      listeners: Number(stats.listeners || 0) || 0,
      userTag: ready ? (client.user?.tag || client.user?.username || null) : null,
    };
  });
}

export function startRuntimeHealthReporter(runtimes, { intervalMs = 5000 } = {}) {
  processCpuPct(); // prime CPU delta

  const write = async () => {
    if (!isConnected()) return;
    try {
      const nodes = nodeMetrics(runtimes);
      const doc = {
        _id: "latest",
        at: new Date().toISOString(),
        pid: process.pid,
        host: os.hostname(),
        process: {
          cpuPct: processCpuPct(),
          ramMb: Math.round(process.memoryUsage().rss / (1024 * 1024)),
          uptimeSec: Math.round(process.uptime()),
          cores: (os.cpus() || []).length || 1,
          nodeVersion: process.version,
          resourceModel: "shared-process",
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
