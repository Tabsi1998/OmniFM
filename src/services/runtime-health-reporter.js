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
    let ping = null;
    try { ping = ready ? Math.max(0, Math.round(client.ws.ping)) : null; } catch { ping = null; }
    return {
      botId: String(rt?.config?.clientId || rt?.config?.id || rt?.config?.index || ""),
      index: Number(rt?.config?.index || 0),
      name: rt?.config?.name || `Bot ${rt?.config?.index || "?"}`,
      role: rt?.role === "commander" ? "commander" : "worker",
      status: ready ? "online" : "offline",
      pingMs: ping,
      guilds,
      voiceConnections: voice,
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
        },
        nodes,
        logs: getRecentLogs(40),
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
