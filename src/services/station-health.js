// ============================================================
// OmniFM: Station Health Check Background Service
// Feature 11: Proaktive Verfügbarkeitsprüfung aller Stationen
//
// Aktivierung: STATION_HEALTH_ENABLED=1 in .env
// Intervall:   STATION_HEALTH_INTERVAL_MS=300000 (Standard: 5 Minuten)
// Timeout:     STATION_HEALTH_TIMEOUT_MS=8000    (Standard: 8 Sekunden)
//
// Ergebnis: Stationen mit Status "down" werden im Log gewarnt.
// Das Ergebnis ist über getStationHealthReport() abrufbar (z.B. für Dashboard/API).
// ============================================================

import { log } from "../lib/logging.js";
import { safeFetch } from "../lib/safe-outbound-http.js";
import { getDb, isConnected } from "../lib/db.js";
import { recordRuntimeIncident } from "./runtime-health-reporter.js";

const STATION_HEALTH_ENABLED = String(process.env.STATION_HEALTH_ENABLED ?? "1") !== "0";
const STATION_HEALTH_INTERVAL_MS = Math.max(
  2_000,
  Number.parseInt(String(process.env.STATION_HEALTH_INTERVAL_MS || "5000"), 10) || 5_000
);
const STATION_HEALTH_TIMEOUT_MS = Math.max(
  3_000,
  Number.parseInt(String(process.env.STATION_HEALTH_TIMEOUT_MS || "8000"), 10) || 8_000
);
// Kleine Round-Robin-Batches verhindern Lastspitzen. Mit den Defaults wird ein
// Katalog mit 120 Sendern in ungefähr fünf Minuten vollständig geprüft.
const STATION_HEALTH_BATCH_SIZE = Math.max(
  1,
  Math.min(10, Number.parseInt(String(process.env.STATION_HEALTH_BATCH_SIZE || "2"), 10) || 2)
);
const STATION_HEALTH_CONCURRENCY = Math.max(
  1,
  Math.min(STATION_HEALTH_BATCH_SIZE, Number.parseInt(String(process.env.STATION_HEALTH_CONCURRENCY || "2"), 10) || 2)
);
const HEAD_FALLBACK_STATUS_CODES = new Set([403, 405, 501]);

/** @type {Map<string, StationHealthEntry>} */
const healthReport = new Map();

let healthCheckTimer = null;
let initialTimer = null;
let isRunning = false;
let tickRunning = false;
let cursor = 0;
let completedInCycle = 0;

async function hydrateHealthReport() {
  if (!isConnected()) return;
  try {
    const rows = await getDb().collection("station_health").find({}, { projection: { _id: 0 } }).toArray();
    for (const row of rows) {
      const key = String(row?.key || "").trim();
      if (key) healthReport.set(key, row);
    }
  } catch (err) {
    log("WARN", `[StationHealth] Persistierten Status nicht geladen: ${err?.message || err}`);
  }
}

async function persistHealthEntry(entry) {
  if (!isConnected()) return;
  try {
    await getDb().collection("station_health").updateOne(
      { key: entry.key },
      { $set: { ...entry, checkedAt: new Date(entry.lastCheckedAt).toISOString(), updatedAt: new Date().toISOString() } },
      { upsert: true },
    );
  } catch (err) {
    log("WARN", `[StationHealth] Status für ${entry.key} nicht gespeichert: ${err?.message || err}`);
  }
}

function reportTransition(previous, entry) {
  const confirmedDown = entry.status === "down" && entry.consecutiveFailures === 2;
  const recovered = entry.status === "up" && previous.status === "down" && previous.consecutiveFailures >= 2;
  if (confirmedDown) {
    const detail = entry.error || "nicht erreichbar";
    log("WARN", `[StationHealth] Station "${entry.name}" (${entry.key}) ist DOWN: ${detail} (${entry.responseTimeMs}ms, 2x in Folge)`);
    recordRuntimeIncident({ severity: "warning", source: "station-health", message: `Sender ${entry.name} (${entry.key}) ist offline: ${detail}` }).catch(() => null);
  } else if (recovered) {
    log("INFO", `[StationHealth] Station "${entry.name}" (${entry.key}) ist wieder UP nach ${previous.consecutiveFailures} Fehlern (${entry.responseTimeMs}ms)`);
    recordRuntimeIncident({ severity: "info", source: "station-health", message: `Sender ${entry.name} (${entry.key}) ist wieder erreichbar`, resolved: true }).catch(() => null);
  }
}

/**
 * @typedef {Object} StationHealthEntry
 * @property {string} key
 * @property {string} name
 * @property {string} url
 * @property {'up'|'down'|'unknown'} status
 * @property {number} lastCheckedAt
 * @property {number|null} responseTimeMs
 * @property {string|null} error
 * @property {number} consecutiveFailures
 * @property {number} consecutiveSuccesses
 */

/**
 * Prüft eine einzelne Station per HTTP HEAD (oder GET mit sofortigem Abbruch).
 * @param {string} key
 * @param {string} name
 * @param {string} url
 * @returns {Promise<StationHealthEntry>}
 */
async function checkStation(key, name, url) {
  const startMs = Date.now();
  const previous = healthReport.get(key) || {
    key,
    name,
    url,
    status: "unknown",
    lastCheckedAt: 0,
    responseTimeMs: null,
    error: null,
    consecutiveFailures: 0,
    consecutiveSuccesses: 0,
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), STATION_HEALTH_TIMEOUT_MS);
    const fetchRangedGet = () => safeFetch(url, {
      method: "GET",
      signal: controller.signal,
      headers: {
        "User-Agent": "OmniFM-HealthCheck/1.0",
        "Range": "bytes=0-0",
      },
      redirect: "follow",
      timeoutMs: STATION_HEALTH_TIMEOUT_MS,
    });

    let response;
    try {
      // HEAD-Request zuerst – spart Bandbreite
      response = await safeFetch(url, {
        method: "HEAD",
        signal: controller.signal,
        headers: { "User-Agent": "OmniFM-HealthCheck/1.0" },
        redirect: "follow",
        timeoutMs: STATION_HEALTH_TIMEOUT_MS,
      });
      if (HEAD_FALLBACK_STATUS_CODES.has(Number(response?.status || 0))) {
        try {
          await response.body?.cancel?.();
        } catch {
          // ignore
        }
        response = await fetchRangedGet();
      }
    } catch (headErr) {
      // Some streams reject HEAD, so use a small ranged GET instead.
      if (!controller.signal.aborted) {
        response = await fetchRangedGet();
      } else {
        throw headErr;
      }
    } finally {
      clearTimeout(timeoutId);
    }

    const responseTimeMs = Date.now() - startMs;
    // HTTP 200, 206 (Partial Content), 301/302 (Redirect) = OK
    // 4xx/5xx = down
    const ok = response.status < 400 || response.status === 401; // 401 = Auth required aber Server läuft
    try {
      await response.body?.cancel?.();
    } catch {
      // ignore
    }

    const entry = {
      key,
      name,
      url,
      status: ok ? "up" : "down",
      ok,
      reachable: ok,
      discordOk: ok,
      lastCheckedAt: Date.now(),
      responseTimeMs,
      error: ok ? null : `HTTP ${response.status}`,
      consecutiveFailures: ok ? 0 : previous.consecutiveFailures + 1,
      consecutiveSuccesses: ok ? previous.consecutiveSuccesses + 1 : 0,
    };

    reportTransition(previous, entry);
    return entry;
  } catch (err) {
    const responseTimeMs = Date.now() - startMs;
    const isTimeout = err?.name === "AbortError" || String(err?.message || "").includes("abort");
    const errorMsg = isTimeout ? `Timeout nach ${STATION_HEALTH_TIMEOUT_MS}ms` : String(err?.message || err);

    const entry = {
      key,
      name,
      url,
      status: "down",
      ok: false,
      reachable: false,
      discordOk: false,
      lastCheckedAt: Date.now(),
      responseTimeMs,
      error: errorMsg,
      consecutiveFailures: previous.consecutiveFailures + 1,
      consecutiveSuccesses: 0,
    };

    reportTransition(previous, entry);
    return entry;
  }
}

/**
 * Führt alle Station-Checks mit begrenzter Parallelität durch.
 * @param {Array<{key: string, name: string, url: string}>} stations
 */
async function runHealthChecks(stations) {
  if (!stations.length) return;

  const queue = [...stations];
  const workers = [];

  const runWorker = async () => {
    while (queue.length > 0) {
      const station = queue.shift();
      if (!station) break;
      try {
        const result = await checkStation(station.key, station.name, station.url);
        healthReport.set(station.key, result);
        await persistHealthEntry(result);
      } catch (err) {
        log("WARN", `[StationHealth] Unerwarteter Fehler bei "${station.key}": ${err?.message || err}`);
      }
    }
  };

  for (let i = 0; i < Math.min(STATION_HEALTH_CONCURRENCY, stations.length); i++) {
    workers.push(runWorker());
  }

  await Promise.allSettled(workers);
}

/**
 * Startet den Background Health Check Service.
 * @param {() => {stations: Record<string, {name: string, url: string}>}} getStationsFn
 */
function startStationHealthService(getStationsFn) {
  if (!STATION_HEALTH_ENABLED) {
    log("INFO", "[StationHealth] Automatische Prüfung explizit deaktiviert (STATION_HEALTH_ENABLED=0)." );
    return stopStationHealthService;
  }
  if (isRunning) return stopStationHealthService;
  isRunning = true;

  const tick = async () => {
    if (tickRunning || !isRunning) return;
    tickRunning = true;
    try {
      const stationsData = getStationsFn?.() || {};
      const stationEntries = Object.entries(stationsData?.stations || {})
        .filter(([, s]) => s?.url && typeof s.url === "string")
        .map(([key, s]) => ({ key, name: String(s.name || key), url: String(s.url) }));

      if (stationEntries.length > 0) {
        const currentKeys = new Set(stationEntries.map((entry) => entry.key));
        for (const key of healthReport.keys()) {
          if (!currentKeys.has(key)) healthReport.delete(key);
        }
        if (cursor >= stationEntries.length) cursor = 0;
        const batch = [];
        for (let offset = 0; offset < Math.min(STATION_HEALTH_BATCH_SIZE, stationEntries.length); offset += 1) {
          batch.push(stationEntries[(cursor + offset) % stationEntries.length]);
        }
        cursor = (cursor + batch.length) % stationEntries.length;
        await runHealthChecks(batch);
        completedInCycle += batch.length;
        if (completedInCycle >= stationEntries.length) {
          completedInCycle %= stationEntries.length;
          const downCount = [...healthReport.values()].filter((e) => e.status === "down" && e.consecutiveFailures >= 2).length;
          const upCount = [...healthReport.values()].filter((e) => e.status === "up").length;
          log("INFO", `[StationHealth] Katalogrunde fertig: ${upCount} UP, ${downCount} bestätigt DOWN, ${stationEntries.length} gesamt.`);
        }
      }
    } catch (err) {
      log("WARN", `[StationHealth] Tick-Fehler: ${err?.message || err}`);
    } finally {
      tickRunning = false;
    }
  };

  hydrateHealthReport().catch(() => null);
  // Kurze Schonfrist, danach bewusst kleine gestaffelte Batches.
  initialTimer = setTimeout(() => {
    tick().catch(() => null);
    healthCheckTimer = setInterval(tick, STATION_HEALTH_INTERVAL_MS);
    healthCheckTimer?.unref?.();
  }, 10_000);
  initialTimer?.unref?.();

  log("INFO", `[StationHealth] Automatische Round-Robin-Prüfung aktiv (alle ${STATION_HEALTH_INTERVAL_MS / 1000}s ${STATION_HEALTH_BATCH_SIZE} Sender, Timeout ${STATION_HEALTH_TIMEOUT_MS}ms, Parallelität ${STATION_HEALTH_CONCURRENCY}).`);
  return stopStationHealthService;
}

/**
 * Stoppt den Background Health Check Service.
 */
function stopStationHealthService() {
  isRunning = false;
  tickRunning = false;
  if (initialTimer) {
    clearTimeout(initialTimer);
    initialTimer = null;
  }
  if (healthCheckTimer) {
    clearInterval(healthCheckTimer);
    healthCheckTimer = null;
  }
}

/**
 * Gibt den aktuellen Health-Report zurück.
 * @returns {StationHealthEntry[]}
 */
function getStationHealthReport() {
  return [...healthReport.values()];
}

/**
 * Gibt den Status einer einzelnen Station zurück.
 * @param {string} key
 * @returns {StationHealthEntry|null}
 */
function getStationHealth(key) {
  return healthReport.get(key) || null;
}

/**
 * Gibt true zurück wenn eine Station als "down" gilt (mind. 2 Fehler in Folge).
 * @param {string} key
 * @returns {boolean}
 */
function isStationDown(key) {
  const entry = healthReport.get(key);
  if (!entry) return false;
  return entry.status === "down" && entry.consecutiveFailures >= 2;
}

export {
  startStationHealthService,
  stopStationHealthService,
  getStationHealthReport,
  getStationHealth,
  isStationDown,
  STATION_HEALTH_ENABLED,
  STATION_HEALTH_INTERVAL_MS,
  STATION_HEALTH_BATCH_SIZE,
};
