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
import { probeStreamAudio, stationOutageText, stationRecoveryText } from "../lib/stream-audio-probe.js";
import { getDb, isConnected } from "../lib/db.js";
import { createStationOutageAlerter } from "./operator-alerts.js";
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
    log("WARN", `[StationHealth] Station "${entry.name}" (${entry.key}) ist ${entry.reachable ? "NICHT SPIELBAR" : "DOWN"}: ${detail} (${entry.responseTimeMs}ms, 2x in Folge)`);
    recordRuntimeIncident({ severity: "warning", source: "station-health", message: stationOutageText(`${entry.name} (${entry.key})`, entry) }).catch(() => null);
  } else if (recovered) {
    log("INFO", `[StationHealth] Station "${entry.name}" (${entry.key}) ist wieder UP nach ${previous.consecutiveFailures} Fehlern (${entry.responseTimeMs}ms)`);
    recordRuntimeIncident({ severity: "info", source: "station-health", message: stationRecoveryText(`${entry.name} (${entry.key})`), resolved: true }).catch(() => null);
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
 * @property {boolean} [ok]                 same as playableAudio
 * @property {boolean} [reachable]          the server answered (401/403 included), #538
 * @property {boolean | null} [authorized]  false on 401/403, null without an answer
 * @property {boolean} [playableAudio]      the stream sends audio the bot can play
 * @property {boolean} [discordOk]          same as playableAudio
 * @property {number | null} [httpStatus]
 * @property {string | null} [format]       mp3, aac, opus …; html, hls … when it is not audio
 * @property {string} [reasonCode]          see StreamAudioProbe
 * @property {string | null} [streamName]      what the stream calls itself (icy-name), #325
 * @property {{ from: string, to: string, at: number } | null} [streamNameChange]
 * @property {number | null} [downSince]    first failed check of the current outage, #550
 * @property {boolean} [outageAlerted]      the operator webhook was told about this outage, #550
 */

const STREAM_NAME_CHANGE_KEEP_MS = 24 * 60 * 60_000;

/** The name a stream sends about itself (icy-name), or "". */
function readStreamName(icyName) {
  const value = String(icyName || "").replace(/\s+/g, " ").trim();
  return value.slice(0, 120);
}

/**
 * #325: a stream that suddenly calls itself something else (the "police
 * scanner" case) is kept for a day as { from, to, at } for the owner cockpit.
 */
function trackStreamName(previous, streamName, url, now = Date.now()) {
  // A new URL (the owner or the catalog changed the stream) starts over.
  if (previous?.url && url && previous.url !== url) return { streamName: streamName || null, streamNameChange: null };
  const known = previous?.streamName || null;
  if (streamName && known && streamName !== known) {
    return { streamName, streamNameChange: { from: known, to: streamName, at: now } };
  }
  const change = previous?.streamNameChange;
  return {
    streamName: streamName || known,
    streamNameChange: change && now - Number(change.at || 0) < STREAM_NAME_CHANGE_KEEP_MS ? change : null,
  };
}

/**
 * Prüft eine einzelne Station mit der kleinen GET-Audio-Probe (#538): "up"
 * und in Discord spielbar ist nur, was wirklich Audio sendet. Ein HEAD 200,
 * eine HTML-Seite oder ein 401 reichen nicht.
 * @param {string} key
 * @param {string} name
 * @param {string} url
 * @param {{ fetchImpl?: Function, previous?: StationHealthEntry, now?: number }} [options]
 * @returns {Promise<StationHealthEntry>}
 */
async function checkStation(key, name, url, { fetchImpl, previous: known, now } = {}) {
  const previous = known || healthReport.get(key) || {
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

  const probe = await probeStreamAudio(url, {
    timeoutMs: STATION_HEALTH_TIMEOUT_MS,
    userAgent: "OmniFM-HealthCheck/1.0",
    ...(fetchImpl ? { fetchImpl } : {}),
  });
  const ok = probe.playableAudio;
  const checkedAt = now ?? Date.now();

  /** @type {StationHealthEntry} */
  const entry = {
    key,
    name,
    url,
    status: ok ? "up" : "down",
    ok,
    reachable: probe.reachable,
    authorized: probe.authorized,
    playableAudio: ok,
    discordOk: ok,
    httpStatus: probe.httpStatus,
    format: probe.format,
    reasonCode: probe.reasonCode,
    lastCheckedAt: checkedAt,
    responseTimeMs: probe.responseTimeMs,
    error: probe.error,
    consecutiveFailures: ok ? 0 : previous.consecutiveFailures + 1,
    consecutiveSuccesses: ok ? previous.consecutiveSuccesses + 1 : 0,
    downSince: ok ? null : (previous.consecutiveFailures > 0 && previous.downSince) || checkedAt,
    // Stays set until the operator alert has named the return (#550).
    outageAlerted: previous.outageAlerted === true,
    ...trackStreamName(previous, ok ? readStreamName(probe.icyName) : "", url),
  };

  reportTransition(previous, entry);
  return entry;
}

async function recordStationHealth(entry) {
  healthReport.set(entry.key, entry);
  await persistHealthEntry(entry);
}

// Only the process that runs the health check (the commander in split mode,
// src/index.js otherwise) reports outages: workers never start this service.
const stationAlerter = createStationOutageAlerter();

/** One operator alert for the outages and returns since the last one (#550). */
async function reportStationAlerts(alerter = stationAlerter) {
  const marks = await alerter.flush([...healthReport.values()]);
  for (const { key, outageAlerted } of marks) {
    const entry = healthReport.get(key);
    if (!entry) continue;
    entry.outageAlerted = outageAlerted;
    if (!isConnected()) continue;
    try {
      // eslint-disable-next-line no-await-in-loop -- a handful of marks after an alert
      await getDb().collection("station_health").updateOne({ key }, { $set: { outageAlerted } });
    } catch (err) {
      log("WARN", `[StationHealth] Alarm-Stand für ${key} nicht gespeichert: ${err?.message || err}`);
    }
  }
  return marks;
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
        // eslint-disable-next-line no-await-in-loop -- one station after the other, gentle on the stream hosts
        const result = await checkStation(station.key, station.name, station.url);
        // eslint-disable-next-line no-await-in-loop -- one station after the other, gentle on the stream hosts
        await recordStationHealth(result);
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
      /** @type {{ stations?: Record<string, { name: string, url: string }> }} */
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
          await reportStationAlerts();
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
  checkStation,
  hydrateHealthReport,
  recordStationHealth,
  reportStationAlerts,
  trackStreamName,
  startStationHealthService,
  stopStationHealthService,
  getStationHealthReport,
  getStationHealth,
  isStationDown,
  STATION_HEALTH_ENABLED,
  STATION_HEALTH_INTERVAL_MS,
  STATION_HEALTH_BATCH_SIZE,
};
