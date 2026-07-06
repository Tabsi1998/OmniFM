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
import { fetchWithValidatedRedirects } from "../lib/safe-fetch.js";

function envFlagEnabled(name, fallback = "0") {
  return ["1", "true", "yes", "on"].includes(String(process.env[name] || fallback).trim().toLowerCase());
}

function parseEnvInt(name, fallback, min, max = Number.MAX_SAFE_INTEGER) {
  const parsed = Number.parseInt(String(process.env[name] || fallback), 10);
  const value = Number.isFinite(parsed) ? parsed : fallback;
  return Math.max(min, Math.min(max, value));
}

function getStationHealthConfig() {
  return {
    enabled: envFlagEnabled("STATION_HEALTH_ENABLED"),
    intervalMs: parseEnvInt("STATION_HEALTH_INTERVAL_MS", 300_000, 60_000),
    timeoutMs: parseEnvInt("STATION_HEALTH_TIMEOUT_MS", 8_000, 3_000),
    // Maximale Anzahl gleichzeitiger Checks (verhindert Ueberlastung bei vielen Stationen)
    concurrency: parseEnvInt("STATION_HEALTH_CONCURRENCY", 5, 1, 20),
  };
}

/** @type {Map<string, StationHealthEntry>} */
const healthReport = new Map();

let healthCheckTimer = null;
let healthCheckStartupTimer = null;
let isRunning = false;

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
  const { timeoutMs } = getStationHealthConfig();
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
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    let response;
    try {
      // HEAD-Request zuerst – spart Bandbreite
      ({ response } = await fetchWithValidatedRedirects(url, {
        method: "HEAD",
        signal: controller.signal,
        headers: { "User-Agent": "OmniFM-HealthCheck/1.0" },
      }));
    } catch (headErr) {
      // Manche Streams unterstützen kein HEAD → GET mit sofortigem Abbruch
      if (!controller.signal.aborted) {
        ({ response } = await fetchWithValidatedRedirects(url, {
          method: "GET",
          signal: controller.signal,
          headers: {
            "User-Agent": "OmniFM-HealthCheck/1.0",
            "Range": "bytes=0-0",
          },
        }));
        // Sofort abbrechen – wir wollen nur den Status-Code
        controller.abort();
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

    const entry = {
      key,
      name,
      url,
      status: ok ? "up" : "down",
      lastCheckedAt: Date.now(),
      responseTimeMs,
      error: ok ? null : `HTTP ${response.status}`,
      consecutiveFailures: ok ? 0 : previous.consecutiveFailures + 1,
      consecutiveSuccesses: ok ? previous.consecutiveSuccesses + 1 : 0,
    };

    if (!ok && entry.consecutiveFailures >= 2) {
      log("WARN", `[StationHealth] Station "${name}" (${key}) ist DOWN: HTTP ${response.status} (${responseTimeMs}ms, ${entry.consecutiveFailures}x in Folge)`);
    } else if (ok && previous.status === "down" && previous.consecutiveFailures >= 2) {
      log("INFO", `[StationHealth] Station "${name}" (${key}) ist wieder UP nach ${previous.consecutiveFailures} Fehlern (${responseTimeMs}ms)`);
    }

    return entry;
  } catch (err) {
    const responseTimeMs = Date.now() - startMs;
    const isTimeout = err?.name === "AbortError" || String(err?.message || "").includes("abort");
    const errorMsg = isTimeout ? `Timeout nach ${timeoutMs}ms` : String(err?.message || err);

    const entry = {
      key,
      name,
      url,
      status: "down",
      lastCheckedAt: Date.now(),
      responseTimeMs,
      error: errorMsg,
      consecutiveFailures: previous.consecutiveFailures + 1,
      consecutiveSuccesses: 0,
    };

    if (entry.consecutiveFailures >= 2) {
      log("WARN", `[StationHealth] Station "${name}" (${key}) nicht erreichbar: ${errorMsg} (${entry.consecutiveFailures}x in Folge)`);
    }

    return entry;
  }
}

/**
 * Führt alle Station-Checks mit begrenzter Parallelität durch.
 * @param {Array<{key: string, name: string, url: string}>} stations
 */
async function runHealthChecks(stations) {
  if (!stations.length) return;

  const { concurrency } = getStationHealthConfig();
  const queue = [...stations];
  const workers = [];

  const runWorker = async () => {
    while (queue.length > 0) {
      const station = queue.shift();
      if (!station) break;
      try {
        const result = await checkStation(station.key, station.name, station.url);
        healthReport.set(station.key, result);
      } catch (err) {
        log("WARN", `[StationHealth] Unerwarteter Fehler bei "${station.key}": ${err?.message || err}`);
      }
    }
  };

  for (let i = 0; i < Math.min(concurrency, stations.length); i++) {
    workers.push(runWorker());
  }

  await Promise.allSettled(workers);
}

/**
 * Startet den Background Health Check Service.
 * @param {() => {stations: Record<string, {name: string, url: string}>}} getStationsFn
 */
function startStationHealthService(getStationsFn) {
  const config = getStationHealthConfig();
  if (!config.enabled) return;
  if (isRunning) return;
  isRunning = true;

  const tick = async () => {
    try {
      const stationsData = getStationsFn?.() || {};
      const stationEntries = Object.entries(stationsData?.stations || {})
        .filter(([, s]) => s?.url && typeof s.url === "string")
        .map(([key, s]) => ({ key, name: String(s.name || key), url: String(s.url) }));

      if (stationEntries.length > 0) {
        log("INFO", `[StationHealth] Prüfe ${stationEntries.length} Stationen...`);
        await runHealthChecks(stationEntries);
        const downCount = [...healthReport.values()].filter((e) => e.status === "down").length;
        const upCount = [...healthReport.values()].filter((e) => e.status === "up").length;
        log("INFO", `[StationHealth] Fertig: ${upCount} UP, ${downCount} DOWN von ${stationEntries.length} Stationen.`);
      }
    } catch (err) {
      log("WARN", `[StationHealth] Tick-Fehler: ${err?.message || err}`);
    }
  };

  // Erster Check nach 30 Sekunden (Bot-Startup abwarten)
  healthCheckStartupTimer = setTimeout(() => {
    tick();
    healthCheckTimer = setInterval(tick, config.intervalMs);
    healthCheckTimer?.unref?.();
  }, 30_000);
  healthCheckStartupTimer?.unref?.();

  log("INFO", `[StationHealth] Service gestartet (Intervall: ${config.intervalMs / 1000}s, Timeout: ${config.timeoutMs}ms, Parallelitaet: ${config.concurrency})`);
}

/**
 * Stoppt den Background Health Check Service.
 */
function stopStationHealthService() {
  isRunning = false;
  if (healthCheckStartupTimer) {
    clearTimeout(healthCheckStartupTimer);
    healthCheckStartupTimer = null;
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
  getStationHealthConfig,
  getStationHealthReport,
  getStationHealth,
  isStationDown,
};
