// ============================================================
// OmniFM: Listening Stats Store (MongoDB + JSON Fallback)
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getDb, isConnected } from "./lib/db.js";
import { log } from "./lib/logging.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STORE_FILE = path.resolve(__dirname, "..", "listening-stats.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;
const MAX_FALLBACK_DAILY_STATS = 400;
const MAX_FALLBACK_SESSION_HISTORY = 120;
const MAX_FALLBACK_CONNECTION_EVENTS = 400;
const MAX_FALLBACK_LISTENER_SNAPSHOTS = 2_880;
const LISTENER_SNAPSHOT_DEDUPE_MS = 120_000;

// ============================================================
// JSON Fallback (legacy, used when MongoDB is unavailable)
// ============================================================
function emptyState() {
  return {
    version: 3,
    guilds: {},
    dailyStats: {},
    sessionHistory: {},
    connectionEvents: {},
    listenerSnapshots: {},
  };
}

function normalizeGuildId(guildId) {
  const value = String(guildId || "").trim();
  return /^\d{17,22}$/.test(value) ? value : null;
}

function normalizeText(value, maxLen = 160) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLen) : null;
}

function normalizeCount(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeTimestamp(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function normalizeBucketMap(source, maxEntries = 200) {
  const input = source && typeof source === "object" ? source : {};
  const output = {};
  for (const [key, rawValue] of Object.entries(input)) {
    const normalizedKey = normalizeText(key, 120);
    if (!normalizedKey) continue;
    output[normalizedKey] = normalizeCount(rawValue);
  }
  return Object.fromEntries(
    Object.entries(output)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, maxEntries)
  );
}

function normalizeTextMap(source, maxEntries = 200) {
  const input = source && typeof source === "object" ? source : {};
  const output = {};
  for (const [key, rawValue] of Object.entries(input)) {
    const normalizedKey = normalizeText(key, 120);
    const normalizedValue = normalizeText(rawValue, 120);
    if (!normalizedKey || !normalizedValue) continue;
    output[normalizedKey] = normalizedValue;
  }
  return Object.fromEntries(Object.entries(output).slice(0, maxEntries));
}

function normalizeHourMap(source) {
  const output = {};
  for (let h = 0; h < 24; h++) output[String(h)] = 0;
  const input = source && typeof source === "object" ? source : {};
  for (const [rawH, rawV] of Object.entries(input)) {
    const hour = Number.parseInt(String(rawH || ""), 10);
    if (Number.isFinite(hour) && hour >= 0 && hour <= 23) {
      output[String(hour)] = normalizeCount(rawV);
    }
  }
  return output;
}

function normalizeDayOfWeekMap(source) {
  const output = {};
  for (let d = 0; d < 7; d++) output[String(d)] = 0;
  const input = source && typeof source === "object" ? source : {};
  for (const [rawD, rawV] of Object.entries(input)) {
    const day = Number.parseInt(String(rawD || ""), 10);
    if (Number.isFinite(day) && day >= 0 && day <= 6) {
      output[String(day)] = normalizeCount(rawV);
    }
  }
  return output;
}

function normalizeIsoDate(value) {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeDateOnly(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

function normalizeGuildStats(raw, guildId) {
  const s = raw && typeof raw === "object" ? raw : {};
  return {
    guildId,
    // Core counters
    totalStarts: normalizeCount(s.totalStarts),
    totalStops: normalizeCount(s.totalStops),
    totalListeningMs: normalizeCount(s.totalListeningMs),
    totalSessions: normalizeCount(s.totalSessions),
    peakListeners: normalizeCount(s.peakListeners),
    peakConcurrentStreams: normalizeCount(s.peakConcurrentStreams),
    // Timestamps
    lastStartedAt: normalizeTimestamp(s.lastStartedAt),
    lastStoppedAt: normalizeTimestamp(s.lastStoppedAt),
    lastCommandAt: normalizeTimestamp(s.lastCommandAt),
    firstSeenAt: normalizeTimestamp(s.firstSeenAt),
    // Breakdown maps
    stationStarts: normalizeBucketMap(s.stationStarts, 200),
    stationListeningMs: normalizeBucketMap(s.stationListeningMs, 200),
    stationNames: normalizeTextMap(s.stationNames, 200),
    voiceChannels: normalizeBucketMap(s.voiceChannels, 120),
    commands: normalizeBucketMap(s.commands, 120),
    hours: normalizeHourMap(s.hours),
    daysOfWeek: normalizeDayOfWeekMap(s.daysOfWeek),
    // Connection health
    totalConnections: normalizeCount(s.totalConnections),
    totalReconnects: normalizeCount(s.totalReconnects),
    totalReconnectRetries: normalizeCount(s.totalReconnectRetries),
    totalConnectionDisconnects: normalizeCount(s.totalConnectionDisconnects),
    totalConnectionErrors: normalizeCount(s.totalConnectionErrors),
    avgSessionMs: normalizeCount(s.avgSessionMs),
    longestSessionMs: normalizeCount(s.longestSessionMs),
  };
}

function normalizeStoredDailyStat(raw) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const date = normalizeDateOnly(entry.date);
  if (!date) return null;
  return {
    date,
    totalStarts: normalizeCount(entry.totalStarts),
    totalListeningMs: normalizeCount(entry.totalListeningMs),
    totalSessions: normalizeCount(entry.totalSessions),
    peakListeners: normalizeCount(entry.peakListeners),
  };
}

function normalizeStoredSession(raw, guildId) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const startedAt = normalizeIsoDate(entry.startedAt);
  const endedAt = normalizeIsoDate(entry.endedAt);
  const stationKey = normalizeText(entry.stationKey, 120) || "unknown";
  if (!startedAt || !endedAt) return null;
  return {
    guildId,
    botId: normalizeText(entry.botId, 120) || "",
    stationKey,
    stationName: normalizeText(entry.stationName, 120) || stationKey,
    channelId: normalizeText(entry.channelId, 120) || "",
    startedAt,
    endedAt,
    durationMs: normalizeCount(entry.durationMs),
    humanListeningMs: normalizeCount(entry.humanListeningMs),
    peakListeners: normalizeCount(entry.peakListeners),
    avgListeners: normalizeCount(entry.avgListeners),
  };
}

function normalizeStoredConnectionEvent(raw, guildId) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const timestamp = normalizeIsoDate(entry.timestamp);
  const eventType = normalizeText(entry.eventType, 40) || "unknown";
  if (!timestamp) return null;
  return {
    guildId,
    botId: normalizeText(entry.botId, 120) || "",
    eventType,
    channelId: normalizeText(entry.channelId, 120) || "",
    details: normalizeText(entry.details, 500) || "",
    timestamp,
  };
}

function normalizeStoredListenerSnapshot(raw, guildId) {
  const entry = raw && typeof raw === "object" ? raw : {};
  const timestamp = normalizeIsoDate(entry.timestamp);
  if (!timestamp) return null;
  return {
    guildId,
    listeners: normalizeCount(entry.listeners),
    timestamp,
  };
}

function normalizePerGuildArrayMap(source, normalizer, maxPerGuild) {
  const input = source && typeof source === "object" ? source : {};
  const output = {};
  for (const [rawGuildId, rawEntries] of Object.entries(input)) {
    const gid = normalizeGuildId(rawGuildId);
    if (!gid) continue;
    const entries = Array.isArray(rawEntries) ? rawEntries : [];
    output[gid] = entries
      .map((entry) => normalizer(entry, gid))
      .filter(Boolean)
      .slice(0, maxPerGuild);
  }
  return output;
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const guilds = {};
  const rawGuilds = source.guilds && typeof source.guilds === "object" ? source.guilds : {};
  for (const [rawGuildId, rawGuildStats] of Object.entries(rawGuilds)) {
    const gid = normalizeGuildId(rawGuildId);
    if (!gid) continue;
    guilds[gid] = normalizeGuildStats(rawGuildStats, gid);
  }
  return {
    version: 3,
    guilds,
    dailyStats: normalizePerGuildArrayMap(source.dailyStats, normalizeStoredDailyStat, MAX_FALLBACK_DAILY_STATS),
    sessionHistory: normalizePerGuildArrayMap(source.sessionHistory, normalizeStoredSession, MAX_FALLBACK_SESSION_HISTORY),
    connectionEvents: normalizePerGuildArrayMap(source.connectionEvents, normalizeStoredConnectionEvent, MAX_FALLBACK_CONNECTION_EVENTS),
    listenerSnapshots: normalizePerGuildArrayMap(source.listenerSnapshots, normalizeStoredListenerSnapshot, MAX_FALLBACK_LISTENER_SNAPSHOTS),
  };
}

// ---- JSON file I/O ----
function readStateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

let stateCache = null;

function ensureState() {
  if (stateCache) return stateCache;
  stateCache = readStateFile(STORE_FILE) || readStateFile(BACKUP_FILE) || emptyState();
  return stateCache;
}

function saveStateToFile() {
  const state = ensureState();
  const tmpFile = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(state, null, 2) + "\n";
  try {
    if (fs.existsSync(STORE_FILE)) {
      try { fs.copyFileSync(STORE_FILE, BACKUP_FILE); } catch {}
    }
    fs.writeFileSync(tmpFile, payload, "utf8");
    try { fs.renameSync(tmpFile, STORE_FILE); } catch { fs.writeFileSync(STORE_FILE, payload, "utf8"); }
  } finally {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
  }
}

function isSplitRuntimeProcess() {
  const role = String(process.env.BOT_PROCESS_ROLE || "").trim().toLowerCase();
  return role === "commander" || role === "worker";
}

function shouldWriteJsonFallback({ force = false } = {}) {
  if (force) return true;
  return !(isSplitRuntimeProcess() && useMongo());
}

function saveStateToJsonFallback(options = {}) {
  if (!shouldWriteJsonFallback(options)) return false;
  saveStateToFile();
  return true;
}

function ensureGuildStatsLocal(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return null;
  const state = ensureState();
  if (!state.guilds[gid]) state.guilds[gid] = normalizeGuildStats({}, gid);
  return state.guilds[gid];
}

function ensureGuildArrayState(groupKey, guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return null;
  const state = ensureState();
  if (!state[groupKey] || typeof state[groupKey] !== "object") {
    state[groupKey] = {};
  }
  if (!Array.isArray(state[groupKey][gid])) {
    state[groupKey][gid] = [];
  }
  return state[groupKey][gid];
}

function incrementBucket(map, key, amount = 1, maxLen = 120) {
  const k = normalizeText(key, maxLen);
  if (!k) return;
  map[k] = normalizeCount(map[k]) + Math.max(1, normalizeCount(amount) || 1);
}

function buildStationBucketKey(stationKey, stationName) {
  return normalizeText(stationName, 120) || normalizeText(stationKey, 120) || "unknown";
}

function resolveHourBucket(timestampMs) {
  const value = Number.isFinite(Number(timestampMs)) && Number(timestampMs) > 0 ? Number(timestampMs) : Date.now();
  return new Date(value).getHours();
}

function resolveDayOfWeekBucket(timestampMs) {
  const value = Number.isFinite(Number(timestampMs)) && Number(timestampMs) > 0 ? Number(timestampMs) : Date.now();
  return new Date(value).getDay();
}

function todayDateString(timestampMs) {
  const d = new Date(Number.isFinite(Number(timestampMs)) && Number(timestampMs) > 0 ? Number(timestampMs) : Date.now());
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function appendLimitedEntry(target, entry, maxEntries, { newestFirst = false } = {}) {
  if (!Array.isArray(target) || !entry) return;
  if (newestFirst) {
    target.unshift(entry);
    if (target.length > maxEntries) target.splice(maxEntries);
    return;
  }
  target.push(entry);
  if (target.length > maxEntries) {
    target.splice(0, target.length - maxEntries);
  }
}

function upsertFallbackDailyStat(guildId, date, patch = {}) {
  const stats = ensureGuildArrayState("dailyStats", guildId);
  if (!stats) return null;
  const safeDate = normalizeDateOnly(date);
  if (!safeDate) return null;
  let entry = stats.find((item) => item.date === safeDate);
  if (!entry) {
    entry = {
      date: safeDate,
      totalStarts: 0,
      totalListeningMs: 0,
      totalSessions: 0,
      peakListeners: 0,
    };
    stats.push(entry);
  }
  entry.totalStarts = normalizeCount((entry.totalStarts || 0) + normalizeCount(patch.totalStarts));
  entry.totalListeningMs = normalizeCount((entry.totalListeningMs || 0) + normalizeCount(patch.totalListeningMs));
  entry.totalSessions = normalizeCount((entry.totalSessions || 0) + normalizeCount(patch.totalSessions));
  entry.peakListeners = Math.max(normalizeCount(entry.peakListeners), normalizeCount(patch.peakListeners));
  stats.sort((a, b) => b.date.localeCompare(a.date));
  if (stats.length > MAX_FALLBACK_DAILY_STATS) stats.splice(MAX_FALLBACK_DAILY_STATS);
  return entry;
}

function appendFallbackSessionHistory(guildId, session) {
  const sessions = ensureGuildArrayState("sessionHistory", guildId);
  if (!sessions) return;
  const entry = normalizeStoredSession(session, normalizeGuildId(guildId));
  if (!entry) return;
  appendLimitedEntry(sessions, entry, MAX_FALLBACK_SESSION_HISTORY, { newestFirst: true });
}

function appendFallbackConnectionEvent(guildId, event) {
  const events = ensureGuildArrayState("connectionEvents", guildId);
  if (!events) return;
  const entry = normalizeStoredConnectionEvent(event, normalizeGuildId(guildId));
  if (!entry) return;
  appendLimitedEntry(events, entry, MAX_FALLBACK_CONNECTION_EVENTS, { newestFirst: true });
}

function appendFallbackListenerSnapshot(guildId, snapshot) {
  const snapshots = ensureGuildArrayState("listenerSnapshots", guildId);
  if (!snapshots) return { saved: false, reason: "invalid-guild" };
  const entry = normalizeStoredListenerSnapshot(snapshot, normalizeGuildId(guildId));
  if (!entry) return { saved: false, reason: "invalid-entry" };

  const last = snapshots[snapshots.length - 1] || null;
  const nextAtMs = Date.parse(entry.timestamp);
  const lastAtMs = last ? Date.parse(last.timestamp) : 0;
  const unchanged = last && last.listeners === entry.listeners;
  if (unchanged && nextAtMs > 0 && lastAtMs > 0 && (nextAtMs - lastAtMs) < LISTENER_SNAPSHOT_DEDUPE_MS) {
    return { saved: false, reason: "deduped", entry: last };
  }

  appendLimitedEntry(snapshots, entry, MAX_FALLBACK_LISTENER_SNAPSHOTS);
  return { saved: true, entry };
}

function getFallbackConnectionHealth(guildId, days = 7) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return { connects: 0, reconnects: 0, retries: 0, disconnects: 0, errors: 0, events: [], timeline: [] };
  const events = (ensureState().connectionEvents?.[gid] || []).filter((entry) => {
    const at = Date.parse(entry.timestamp);
    return at >= (Date.now() - (days * 86400_000));
  });
  const counts = { connects: 0, reconnects: 0, retries: 0, disconnects: 0, errors: 0 };
  for (const ev of events) {
    if (ev.eventType === "connect") counts.connects += 1;
    else if (ev.eventType === "reconnect") counts.reconnects += 1;
    else if (ev.eventType === "retry") counts.retries += 1;
    else if (ev.eventType === "disconnect") counts.disconnects += 1;
    else if (ev.eventType === "error") counts.errors += 1;
  }
  return {
    ...counts,
    events: events.slice(0, 100),
    timeline: buildConnectionTimelineBucketsFromEvents(events, days),
  };
}

function buildConnectionTimelineBuckets(rows = [], days = 7, nowMs = Date.now()) {
  const safeDays = Math.max(1, Math.min(90, Number.parseInt(String(days || 7), 10) || 7));
  const buckets = [];
  const bucketMap = new Map();

  for (let offset = safeDays - 1; offset >= 0; offset -= 1) {
    const date = todayDateString(nowMs - (offset * 86400_000));
    const bucket = {
      date,
      connects: 0,
      reconnects: 0,
      retries: 0,
      disconnects: 0,
      errors: 0,
    };
    buckets.push(bucket);
    bucketMap.set(date, bucket);
  }

  for (const row of Array.isArray(rows) ? rows : []) {
    const timestampMs = Date.parse(row?.timestamp);
    const derivedDate = Number.isFinite(timestampMs) ? todayDateString(timestampMs) : "";
    const date = normalizeDateOnly(row?.date) || normalizeDateOnly(derivedDate);
    const bucket = date ? bucketMap.get(date) : null;
    if (!bucket) continue;
    const count = normalizeCount(row?.count ?? 1);
    if (row?.eventType === "connect") bucket.connects += count;
    else if (row?.eventType === "reconnect") bucket.reconnects += count;
    else if (row?.eventType === "retry") bucket.retries += count;
    else if (row?.eventType === "disconnect") bucket.disconnects += count;
    else if (row?.eventType === "error") bucket.errors += count;
  }

  return buckets;
}

function buildConnectionTimelineBucketsFromEvents(events = [], days = 7, nowMs = Date.now()) {
  return buildConnectionTimelineBuckets(
    (Array.isArray(events) ? events : []).map((event) => ({
      date: todayDateString(Date.parse(event?.timestamp)),
      eventType: String(event?.eventType || ""),
      count: 1,
    })),
    days,
    nowMs
  );
}

function getActiveListeningMsTotal() {
  const now = Date.now();
  let total = 0;
  for (const session of activeSessions.values()) {
    const summary = summarizeSessionListeners({
      samples: session.listenerSamples || [],
      startedAtMs: session.startedAt,
      endedAtMs: now,
    });
    total += summary.humanListeningMs || 0;
  }
  return total;
}

const SESSION_SAMPLE_MIN_INTERVAL_MS = 30_000;
const MAX_SESSION_SAMPLES = 4_320;

function normalizeSampleEntries(samples, startedAtMs, endedAtMs) {
  const startMs = normalizeTimestamp(startedAtMs) || Date.now();
  const endMs = Math.max(startMs, normalizeTimestamp(endedAtMs) || startMs);
  const entries = [];

  for (const sample of Array.isArray(samples) ? samples : []) {
    const timestamp = Math.min(endMs, Math.max(startMs, normalizeTimestamp(sample?.t) || startMs));
    const listeners = normalizeCount(sample?.n);
    const previous = entries[entries.length - 1];
    if (previous && previous.t === timestamp) {
      previous.n = listeners;
    } else {
      entries.push({ t: timestamp, n: listeners });
    }
  }

  entries.sort((a, b) => a.t - b.t);

  const collapsed = [];
  for (const entry of entries) {
    const previous = collapsed[collapsed.length - 1];
    if (previous && previous.t === entry.t) {
      previous.n = entry.n;
    } else {
      collapsed.push(entry);
    }
  }

  if (!collapsed.length) {
    return [{ t: startMs, n: 0 }];
  }

  if (collapsed[0].t > startMs) {
    collapsed.unshift({ t: startMs, n: collapsed[0].n });
  } else if (collapsed[0].t < startMs) {
    collapsed[0] = { ...collapsed[0], t: startMs };
  }

  return collapsed;
}

export function buildSessionListenerSegments({
  samples = [],
  startedAtMs = Date.now(),
  endedAtMs = Date.now(),
} = {}) {
  const startMs = normalizeTimestamp(startedAtMs) || Date.now();
  const endMs = Math.max(startMs, normalizeTimestamp(endedAtMs) || startMs);
  if (endMs <= startMs) return [];

  const normalizedSamples = normalizeSampleEntries(samples, startMs, endMs);
  const segments = [];

  for (let index = 0; index < normalizedSamples.length; index += 1) {
    const current = normalizedSamples[index];
    const next = normalizedSamples[index + 1];
    const segmentStartMs = Math.min(endMs, Math.max(startMs, current.t));
    const segmentEndMs = next
      ? Math.min(endMs, Math.max(segmentStartMs, next.t))
      : endMs;
    if (segmentEndMs <= segmentStartMs) continue;

    segments.push({
      startAtMs: segmentStartMs,
      endAtMs: segmentEndMs,
      durationMs: segmentEndMs - segmentStartMs,
      listeners: normalizeCount(current.n),
    });
  }

  return segments;
}

export function summarizeSessionListeners({
  samples = [],
  startedAtMs = Date.now(),
  endedAtMs = Date.now(),
} = {}) {
  const startMs = normalizeTimestamp(startedAtMs) || Date.now();
  const endMs = Math.max(startMs, normalizeTimestamp(endedAtMs) || startMs);
  const segments = buildSessionListenerSegments({ samples, startedAtMs: startMs, endedAtMs: endMs });
  const durationMs = Math.max(0, endMs - startMs);

  let humanListeningMs = 0;
  let weightedListenerMs = 0;
  let peakListeners = 0;

  for (const segment of segments) {
    peakListeners = Math.max(peakListeners, normalizeCount(segment.listeners));
    weightedListenerMs += segment.durationMs * normalizeCount(segment.listeners);
    if (segment.listeners > 0) {
      humanListeningMs += segment.durationMs;
    }
  }

  return {
    durationMs,
    peakListeners,
    humanListeningMs: Math.min(humanListeningMs, durationMs),
    avgListeners: durationMs > 0 ? Math.round(weightedListenerMs / durationMs) : 0,
    segments,
  };
}

export function buildDailyListeningBreakdown({
  samples = [],
  startedAtMs = Date.now(),
  endedAtMs = Date.now(),
} = {}) {
  const summary = summarizeSessionListeners({ samples, startedAtMs, endedAtMs });
  const days = new Map();

  for (const segment of summary.segments) {
    let cursorMs = segment.startAtMs;
    while (cursorMs < segment.endAtMs) {
      const cursorDate = new Date(cursorMs);
      const nextMidnightMs = new Date(
        cursorDate.getFullYear(),
        cursorDate.getMonth(),
        cursorDate.getDate() + 1,
        0, 0, 0, 0
      ).getTime();
      const sliceEndMs = Math.min(segment.endAtMs, nextMidnightMs);
      const sliceDurationMs = Math.max(0, sliceEndMs - cursorMs);
      const date = todayDateString(cursorMs);
      const current = days.get(date) || {
        date,
        totalListeningMs: 0,
        peakListeners: 0,
      };

      if (segment.listeners > 0) {
        current.totalListeningMs += sliceDurationMs;
      }
      current.peakListeners = Math.max(current.peakListeners, segment.listeners);
      days.set(date, current);
      cursorMs = sliceEndMs;
    }
  }

  if (!days.size) {
    const date = todayDateString(startedAtMs);
    days.set(date, { date, totalListeningMs: 0, peakListeners: 0 });
  }

  return [...days.values()].sort((a, b) => a.date.localeCompare(b.date));
}

// ============================================================
// MongoDB Operations
// ============================================================
function useMongo() {
  return isConnected() && getDb() !== null;
}

async function mongoSafe(fn) {
  if (!useMongo()) return null;
  try {
    return await fn(getDb());
  } catch (err) {
    log("WARN", `MongoDB Stats-Operation fehlgeschlagen: ${err?.message || err}`);
    return null;
  }
}

// ---- Write to MongoDB and the local JSON fallback when it is safe ----
async function persistGuildStats(guildId, stats) {
  saveStateToJsonFallback();

  // Write to MongoDB if available
  await mongoSafe(async (db) => {
    const doc = { ...stats };
    delete doc._id;
    await db.collection("guild_stats").updateOne(
      { guildId },
      { $set: doc, $setOnInsert: { createdAt: new Date() } },
      { upsert: true }
    );
  });
}

// ============================================================
// Active Sessions Tracking (in-memory for active, MongoDB for completed)
// ============================================================
const activeSessions = new Map(); // key: `${guildId}:${botId}` -> session object

export function startListeningSession(guildId, {
  botId = "",
  stationKey = "",
  stationName = "",
  channelId = "",
  listenerCount = 0,
  resume = false,
} = {}) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return null;

  const sessionKey = `${gid}:${botId || "default"}`;
  const now = Date.now();
  const normalizedBotId = String(botId || "").trim();
  const normalizedStationKey = normalizeText(stationKey, 120) || "unknown";
  const normalizedStationName = normalizeText(stationName, 120) || normalizeText(stationKey, 120) || "unknown";
  const normalizedChannelId = String(channelId || "").trim();
  const normalizedListenerCount = normalizeCount(listenerCount);

  if (resume) {
    const existing = activeSessions.get(sessionKey);
    if (existing) {
      existing.stationKey = normalizedStationKey;
      existing.stationName = normalizedStationName;
      existing.channelId = normalizedChannelId;
      existing.peakListeners = Math.max(normalizeCount(existing.peakListeners), normalizedListenerCount);

      const lastSample = existing.listenerSamples?.[existing.listenerSamples.length - 1] || null;
      if (!lastSample || lastSample.n !== normalizedListenerCount || (now - lastSample.t) >= SESSION_SAMPLE_MIN_INTERVAL_MS) {
        existing.listenerSamples.push({ t: now, n: normalizedListenerCount });
        if (existing.listenerSamples.length > MAX_SESSION_SAMPLES) {
          existing.listenerSamples = existing.listenerSamples.slice(-MAX_SESSION_SAMPLES);
        }
      }
      return existing;
    }
  }

  // End any existing session for this bot+guild
  endListeningSession(gid, { botId });

  const session = {
    guildId: gid,
    botId: normalizedBotId,
    stationKey: normalizedStationKey,
    stationName: normalizedStationName,
    channelId: normalizedChannelId,
    startedAt: now,
    peakListeners: normalizedListenerCount,
    listenerSamples: [{ t: now, n: normalizedListenerCount }],
  };

  activeSessions.set(sessionKey, session);
  return session;
}

export function updateSessionListeners(guildId, { botId = "", listenerCount = 0 } = {}) {
  return recordSessionListenerSample(guildId, { botId, listenerCount });
}

export function recordSessionListenerSample(guildId, {
  botId = "",
  listenerCount = 0,
  timestampMs = Date.now(),
} = {}) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return;

  const sessionKey = `${gid}:${botId || "default"}`;
  const session = activeSessions.get(sessionKey);
  if (!session) return;

  const count = normalizeCount(listenerCount);
  const sampleAtMs = Number(timestampMs) || Date.now();
  session.peakListeners = Math.max(session.peakListeners, count);

  // Capture changes immediately and otherwise keep a regular sample cadence.
  const lastSample = session.listenerSamples[session.listenerSamples.length - 1];
  if (!lastSample || lastSample.n !== count || (sampleAtMs - lastSample.t) >= SESSION_SAMPLE_MIN_INTERVAL_MS) {
    session.listenerSamples.push({ t: sampleAtMs, n: count });
    if (session.listenerSamples.length > MAX_SESSION_SAMPLES) {
      session.listenerSamples = session.listenerSamples.slice(-MAX_SESSION_SAMPLES);
    }
  }
}

export async function endListeningSession(guildId, { botId = "" } = {}) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return null;

  const sessionKey = `${gid}:${botId || "default"}`;
  const session = activeSessions.get(sessionKey);
  if (!session) return null;

  activeSessions.delete(sessionKey);

  const endedAt = Date.now();
  const samples = session.listenerSamples || [];
  const summary = summarizeSessionListeners({
    samples,
    startedAtMs: session.startedAt,
    endedAtMs: endedAt,
  });
  const dailyBreakdown = buildDailyListeningBreakdown({
    samples,
    startedAtMs: session.startedAt,
    endedAtMs: endedAt,
  });
  const durationMs = summary.durationMs;
  const humanListeningMs = summary.humanListeningMs;
  const avgListeners = summary.avgListeners;
  const peakListeners = Math.max(session.peakListeners || 0, summary.peakListeners || 0);

  const completedSession = {
    guildId: gid,
    botId: session.botId,
    stationKey: session.stationKey,
    stationName: session.stationName,
    channelId: session.channelId,
    startedAt: new Date(session.startedAt).toISOString(),
    endedAt: new Date(endedAt).toISOString(),
    durationMs,
    humanListeningMs,
    peakListeners,
    avgListeners,
  };

  // Update aggregate stats with human listening time only (not bot-alone time)
  const stats = ensureGuildStatsLocal(gid);
  if (stats) {
    stats.totalListeningMs += humanListeningMs;
    stats.totalSessions += 1;
    stats.totalStops += 1;
    stats.lastStoppedAt = endedAt;
    stats.longestSessionMs = Math.max(stats.longestSessionMs || 0, humanListeningMs);
    stats.peakListeners = Math.max(stats.peakListeners || 0, peakListeners);
    // Rolling average session duration (based on human listening time)
    if (stats.totalSessions > 0) {
      stats.avgSessionMs = Math.round(stats.totalListeningMs / stats.totalSessions);
    }
    const stationListeningIncrement = Math.max(0, Number(humanListeningMs || 0) || 0);
    if (stationListeningIncrement > 0) {
      const stationListeningKey = normalizeText(session.stationKey, 120) || "unknown";
      stats.stationListeningMs[stationListeningKey] =
        normalizeCount(stats.stationListeningMs[stationListeningKey]) + stationListeningIncrement;
    }
  }

  appendFallbackSessionHistory(gid, completedSession);
  for (const day of dailyBreakdown) {
    upsertFallbackDailyStat(gid, day.date, {
      totalListeningMs: day.totalListeningMs,
      totalSessions: day.date === todayDateString(session.startedAt) ? 1 : 0,
      peakListeners: day.peakListeners,
    });
  }

  // Save to MongoDB
  await mongoSafe(async (db) => {
    // Store completed session (without raw samples for space)
    await db.collection("listening_sessions").insertOne(completedSession);

    for (const day of dailyBreakdown) {
      const isStartDay = day.date === todayDateString(session.startedAt);
      // eslint-disable-next-line no-await-in-loop
      await db.collection("daily_stats").updateOne(
        { guildId: gid, date: day.date },
        {
          $inc: {
            totalStarts: 0,
            totalListeningMs: day.totalListeningMs,
            totalSessions: isStartDay ? 1 : 0,
          },
          $max: { peakListeners: day.peakListeners },
          $setOnInsert: { guildId: gid, date: day.date, createdAt: new Date() },
        },
        { upsert: true }
      );
    }
  });

  if (stats) {
    await persistGuildStats(gid, stats);
  } else {
    saveStateToJsonFallback();
  }

  return completedSession;
}

export function getActiveSessionsForGuild(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return [];
  const result = [];
  const now = Date.now();
  for (const [key, session] of activeSessions.entries()) {
    if (session.guildId === gid) {
      const summary = summarizeSessionListeners({
        samples: session.listenerSamples || [],
        startedAtMs: session.startedAt,
        endedAtMs: now,
      });
      const lastSample = session.listenerSamples?.[session.listenerSamples.length - 1] || null;
      result.push({
        ...session,
        currentDurationMs: summary.durationMs,
        currentHumanListeningMs: summary.humanListeningMs,
        currentAvgListeners: summary.avgListeners,
        currentListeners: lastSample ? lastSample.n : 0,
      });
    }
  }
  return result;
}

// ============================================================
// Public API - Recording Functions
// ============================================================
export function recordCommandUsage(guildId, commandName, timestampMs = Date.now()) {
  const stats = ensureGuildStatsLocal(guildId);
  if (!stats) return { saved: false, reason: "invalid-guild" };
  incrementBucket(stats.commands, String(commandName || "").trim().toLowerCase(), 1, 80);
  stats.lastCommandAt = Number(timestampMs) || Date.now();
  saveStateToJsonFallback();

  // Async MongoDB write
  mongoSafe(async (db) => {
    const dateStr = todayDateString(timestampMs);
    const cmd = String(commandName || "").trim().toLowerCase();
    await db.collection("guild_stats").updateOne(
      { guildId: normalizeGuildId(guildId) },
      {
        $inc: { [`commands.${cmd}`]: 1 },
        $set: { lastCommandAt: Number(timestampMs) || Date.now() },
        $setOnInsert: { guildId: normalizeGuildId(guildId), createdAt: new Date() },
      },
      { upsert: true }
    );
  });

  return { saved: true };
}

export function recordStationStart(guildId, {
  stationKey = "",
  stationName = "",
  channelId = "",
  listenerCount = 0,
  timestampMs = Date.now(),
  botId = "",
  countAsStart = true,
  resumeSession = false,
} = {}) {
  const stats = ensureGuildStatsLocal(guildId);
  if (!stats) return { saved: false, reason: "invalid-guild" };

  const atMs = Number(timestampMs) || Date.now();
  const gid = normalizeGuildId(guildId);

  const stationBucketKey = buildStationBucketKey(stationKey, stationName);
  if (countAsStart) {
    // Core counters
    stats.totalStarts += 1;
    stats.lastStartedAt = atMs;
    if (!stats.firstSeenAt) stats.firstSeenAt = atMs;

    // Station breakdown
    incrementBucket(stats.stationStarts, stationBucketKey, 1, 120);
    if (stationKey) {
      const skText = normalizeText(stationKey, 120);
      if (skText && stationName) {
        stats.stationNames[skText] = normalizeText(stationName, 120) || skText;
      }
    }

    // Channel tracking
    incrementBucket(stats.voiceChannels, channelId, 1, 40);

    // Time distribution
    const hourBucket = String(resolveHourBucket(atMs));
    stats.hours[hourBucket] = normalizeCount(stats.hours[hourBucket]) + 1;
    const dayBucket = String(resolveDayOfWeekBucket(atMs));
    stats.daysOfWeek[dayBucket] = normalizeCount(stats.daysOfWeek[dayBucket]) + 1;

    // Peak listeners
    stats.peakListeners = Math.max(stats.peakListeners, normalizeCount(listenerCount));
    upsertFallbackDailyStat(gid, todayDateString(atMs), {
      totalStarts: 1,
      peakListeners: normalizeCount(listenerCount),
    });

    saveStateToJsonFallback();
  }

  // Start a listening session
  startListeningSession(guildId, {
    botId,
    stationKey,
    stationName,
    channelId,
    listenerCount,
    resume: resumeSession,
  });

  if (countAsStart) {
    // Async MongoDB write
    mongoSafe(async (db) => {
      const dateStr = todayDateString(atMs);
      const hourBucket = String(resolveHourBucket(atMs));
      const dayBucket = String(resolveDayOfWeekBucket(atMs));
      await db.collection("daily_stats").updateOne(
        { guildId: gid, date: dateStr },
        {
          $inc: { totalStarts: 1 },
          $max: { peakListeners: normalizeCount(listenerCount) },
          $setOnInsert: { guildId: gid, date: dateStr, createdAt: new Date(), totalListeningMs: 0, totalSessions: 0 },
        },
        { upsert: true }
      );
      await db.collection("guild_stats").updateOne(
        { guildId: gid },
        {
          $inc: { totalStarts: 1, [`stationStarts.${stationBucketKey}`]: 1, [`hours.${hourBucket}`]: 1, [`daysOfWeek.${dayBucket}`]: 1 },
          $max: { peakListeners: normalizeCount(listenerCount) },
          $set: { lastStartedAt: atMs },
          $setOnInsert: { guildId: gid, createdAt: new Date(), firstSeenAt: atMs },
        },
        { upsert: true }
      );
    });
  }

  return { saved: true };
}

export function recordStationStop(guildId, { botId = "" } = {}) {
  return endListeningSession(guildId, { botId });
}

export function recordGuildListenerSample(guildId, listenerCount, timestampMs = Date.now()) {
  const stats = ensureGuildStatsLocal(guildId);
  if (!stats) return { saved: false, reason: "invalid-guild" };
  const count = normalizeCount(listenerCount);
  const atMs = Number(timestampMs) || Date.now();
  const previousPeak = stats.peakListeners || 0;
  stats.peakListeners = Math.max(stats.peakListeners, count);
  const fallbackSnapshot = appendFallbackListenerSnapshot(guildId, {
    guildId: normalizeGuildId(guildId),
    listeners: count,
    timestamp: new Date(atMs).toISOString(),
  });
  if ((stats.peakListeners || 0) !== previousPeak || fallbackSnapshot?.saved !== false) {
    saveStateToJsonFallback();
  }

  mongoSafe(async (db) => {
    const gid = normalizeGuildId(guildId);
    if (fallbackSnapshot?.saved !== false) {
      await db.collection("listener_snapshots").insertOne({
        guildId: gid,
        listeners: count,
        timestamp: new Date(atMs),
      });
    }
    await db.collection("guild_stats").updateOne(
      { guildId: gid },
      {
        $max: { peakListeners: count },
        $setOnInsert: { guildId: gid, createdAt: new Date() },
      },
      { upsert: true }
    );
  });

  return { saved: true, deduped: fallbackSnapshot?.reason === "deduped" };
}

export function recordListenerSample(guildId, listenerCount, timestampMs = Date.now()) {
  return recordGuildListenerSample(guildId, listenerCount, timestampMs);
}

export function recordConnectionEvent(guildId, {
  botId = "",
  eventType = "connect",
  channelId = "",
  details = "",
} = {}) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return;
  const atMs = Date.now();

  const stats = ensureGuildStatsLocal(guildId);
  if (stats) {
    if (eventType === "connect") stats.totalConnections = (stats.totalConnections || 0) + 1;
    else if (eventType === "reconnect") stats.totalReconnects = (stats.totalReconnects || 0) + 1;
    else if (eventType === "retry") stats.totalReconnectRetries = (stats.totalReconnectRetries || 0) + 1;
    else if (eventType === "disconnect") stats.totalConnectionDisconnects = (stats.totalConnectionDisconnects || 0) + 1;
    else if (eventType === "error") stats.totalConnectionErrors = (stats.totalConnectionErrors || 0) + 1;
    appendFallbackConnectionEvent(gid, {
      guildId: gid,
      botId: String(botId || "").trim(),
      eventType: String(eventType || "unknown").trim(),
      channelId: String(channelId || "").trim(),
      details: normalizeText(details, 500) || "",
      timestamp: new Date(atMs).toISOString(),
    });
    saveStateToJsonFallback();
  }

  mongoSafe(async (db) => {
    await db.collection("connection_events").insertOne({
      guildId: gid,
      botId: String(botId || "").trim(),
      eventType: String(eventType || "unknown").trim(),
      channelId: String(channelId || "").trim(),
      details: normalizeText(details, 500) || "",
      timestamp: new Date(atMs),
    });
  });
}

// ============================================================
// Public API - Read Functions
// ============================================================
function mergeActiveSessionsIntoListeningStats(stats, activeSessions = []) {
  const result = stats ? JSON.parse(JSON.stringify(stats)) : normalizeGuildStats({});
  result.stationListeningMs = { ...(result.stationListeningMs || {}) };
  result.stationNames = { ...(result.stationNames || {}) };

  let activeListeningMs = 0;
  let peakListeners = Number(result.peakListeners || 0) || 0;

  for (const session of activeSessions) {
    const stationKey = normalizeText(session?.stationKey, 120);
    const stationName = normalizeText(session?.stationName, 120);
    const currentHumanListeningMs = Math.max(0, Number(session?.currentHumanListeningMs || 0) || 0);
    const sessionPeak = Math.max(
      0,
      Number(session?.peakListeners || 0) || 0,
      Number(session?.currentListeners || 0) || 0
    );

    activeListeningMs += currentHumanListeningMs;
    peakListeners = Math.max(peakListeners, sessionPeak);

    if (stationKey) {
      result.stationListeningMs[stationKey] = (Number(result.stationListeningMs[stationKey] || 0) || 0) + currentHumanListeningMs;
      if (stationName) {
        result.stationNames[stationKey] = stationName;
      }
    }
  }

  result.activeSessions = activeSessions.length;
  result.activeListeningMs = activeListeningMs;
  result.currentTotalListeningMs = (Number(result.totalListeningMs || 0) || 0) + activeListeningMs;
  result.peakListeners = peakListeners;
  return result;
}

function mergeActiveSessionsIntoDailyStats(rows = [], activeSessions = [], nowMs = Date.now()) {
  const byDate = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = String(row?.date || "").trim();
    if (!date) continue;
    byDate.set(date, {
      date,
      totalStarts: Number(row?.totalStarts || 0) || 0,
      totalListeningMs: Number(row?.totalListeningMs || 0) || 0,
      totalSessions: Number(row?.totalSessions || 0) || 0,
      peakListeners: Number(row?.peakListeners || 0) || 0,
    });
  }

  for (const session of Array.isArray(activeSessions) ? activeSessions : []) {
    const breakdown = buildDailyListeningBreakdown({
      samples: session?.listenerSamples || [],
      startedAtMs: Number(session?.startedAt || 0) || nowMs,
      endedAtMs: nowMs,
    });
    for (const day of breakdown) {
      const key = String(day?.date || "").trim();
      if (!key) continue;
      const current = byDate.get(key) || {
        date: key,
        totalStarts: 0,
        totalListeningMs: 0,
        totalSessions: 0,
        peakListeners: 0,
      };
      current.totalListeningMs += Number(day?.totalListeningMs || 0) || 0;
      current.peakListeners = Math.max(current.peakListeners || 0, Number(day?.peakListeners || 0) || 0);
      byDate.set(key, current);
    }
  }

  return [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function getGuildListeningStats(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return null;
  const state = ensureState();
  const stats = state.guilds[gid];
  const activeSess = getActiveSessionsForGuild(gid);
  return mergeActiveSessionsIntoListeningStats(
    stats ? JSON.parse(JSON.stringify(stats)) : normalizeGuildStats({}, gid),
    activeSess
  );
}

export function getTopGuildsByActivity(limit = 5) {
  const safeLimit = Math.max(1, Math.min(20, Number.parseInt(String(limit || 5), 10) || 5));
  const state = ensureState();
  return Object.values(state.guilds)
    .sort((a, b) => b.totalStarts - a.totalStarts || b.peakListeners - a.peakListeners || String(a.guildId).localeCompare(String(b.guildId)))
    .slice(0, safeLimit)
    .map((stats) => JSON.parse(JSON.stringify(stats)));
}

// ---- MongoDB-only queries for enhanced stats ----
export async function getGuildDailyStats(guildId, days = 30) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return [];
  const safeDays = Math.min(days, 365);
  const activeSess = getActiveSessionsForGuild(gid);
  const nowMs = Date.now();

  const result = await mongoSafe(async (db) => {
    return db.collection("daily_stats")
      .find({ guildId: gid })
      .sort({ date: -1 })
      .limit(safeDays)
      .toArray();
  });

  if (result) {
    return mergeActiveSessionsIntoDailyStats(result.map((doc) => ({
      date: doc.date,
      totalStarts: doc.totalStarts || 0,
      totalListeningMs: doc.totalListeningMs || 0,
      totalSessions: doc.totalSessions || 0,
      peakListeners: doc.peakListeners || 0,
    })), activeSess, nowMs).slice(0, safeDays);
  }

  return mergeActiveSessionsIntoDailyStats((ensureState().dailyStats?.[gid] || [])
    .slice()
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, Math.min(safeDays, MAX_FALLBACK_DAILY_STATS))
    .map((entry) => ({ ...entry })), activeSess, nowMs).slice(0, safeDays);
}

export async function getGuildSessionHistory(guildId, limit = 20) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return [];

  const result = await mongoSafe(async (db) => {
    return db.collection("listening_sessions")
      .find({ guildId: gid })
      .sort({ startedAt: -1 })
      .limit(Math.min(limit, 100))
      .project({ _id: 0 })
      .toArray();
  });

  if (result) {
    return result || [];
  }

  return (ensureState().sessionHistory?.[gid] || [])
    .slice()
    .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")))
    .slice(0, Math.min(limit, MAX_FALLBACK_SESSION_HISTORY))
    .map((entry) => ({ ...entry }));
}

export async function getGuildConnectionHealth(guildId, days = 7) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return { connects: 0, reconnects: 0, retries: 0, disconnects: 0, errors: 0, events: [], timeline: [] };

  const result = await mongoSafe(async (db) => {
    const since = new Date(Date.now() - days * 86400_000);
    const [events, counts, timelineCounts] = await Promise.all([
      db.collection("connection_events")
        .find({ guildId: gid, timestamp: { $gte: since } })
        .sort({ timestamp: -1 })
        .limit(100)
        .project({ _id: 0 })
        .toArray(),
      db.collection("connection_events").aggregate([
        { $match: { guildId: gid, timestamp: { $gte: since } } },
        {
          $group: {
            _id: "$eventType",
            count: { $sum: 1 },
          },
        },
      ]).toArray(),
      db.collection("connection_events").aggregate([
        { $match: { guildId: gid, timestamp: { $gte: since } } },
        {
          $project: {
            eventType: 1,
            date: {
              $dateToString: {
                format: "%Y-%m-%d",
                date: "$timestamp",
              },
            },
          },
        },
        {
          $group: {
            _id: {
              date: "$date",
              eventType: "$eventType",
            },
            count: { $sum: 1 },
          },
        },
        { $sort: { "_id.date": 1 } },
      ]).toArray(),
    ]);

    const summary = { connects: 0, reconnects: 0, retries: 0, disconnects: 0, errors: 0 };
    for (const row of counts) {
      if (row._id === "connect") summary.connects = normalizeCount(row.count);
      else if (row._id === "reconnect") summary.reconnects = normalizeCount(row.count);
      else if (row._id === "retry") summary.retries = normalizeCount(row.count);
      else if (row._id === "disconnect") summary.disconnects = normalizeCount(row.count);
      else if (row._id === "error") summary.errors = normalizeCount(row.count);
    }

    return {
      ...summary,
      events,
      timeline: buildConnectionTimelineBuckets(
        timelineCounts.map((row) => ({
          date: row?._id?.date,
          eventType: row?._id?.eventType,
          count: row?.count,
        })),
        days
      ),
    };
  });

  return result || getFallbackConnectionHealth(guildId, days);
}

export async function getGuildListenerTimeline(guildId, hours = 24) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return [];

  const result = await mongoSafe(async (db) => {
    const since = new Date(Date.now() - hours * 3600_000);
    return db.collection("listener_snapshots")
      .find({ guildId: gid, timestamp: { $gte: since } })
      .sort({ timestamp: 1 })
      .project({ _id: 0, listeners: 1, timestamp: 1 })
      .toArray();
  });

  if (result) {
    return result || [];
  }

  const sinceMs = Date.now() - (hours * 3600_000);
  return (ensureState().listenerSnapshots?.[gid] || [])
    .filter((entry) => Date.parse(entry.timestamp) >= sinceMs)
    .slice()
    .sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")))
    .map((entry) => ({ ...entry }));
}

export async function getGlobalStats() {
  const activeListeningMs = getActiveListeningMsTotal();
  // First try MongoDB
  const mongoResult = await mongoSafe(async (db) => {
    const pipeline = [
      {
        $group: {
          _id: null,
          totalGuilds: { $sum: 1 },
          totalStarts: { $sum: "$totalStarts" },
          totalListeningMs: { $sum: "$totalListeningMs" },
          totalSessions: { $sum: "$totalSessions" },
          globalPeakListeners: { $max: "$peakListeners" },
        },
      },
    ];
    const result = await db.collection("guild_stats").aggregate(pipeline).toArray();
    return result[0] || null;
  });

  if (mongoResult) {
    const completedListeningMs = mongoResult.totalListeningMs || 0;
    const currentTotalListeningMs = completedListeningMs + activeListeningMs;
    return {
      totalGuilds: mongoResult.totalGuilds || 0,
      totalStarts: mongoResult.totalStarts || 0,
      totalListeningMs: currentTotalListeningMs,
      completedListeningMs,
      activeListeningMs,
      totalSessions: mongoResult.totalSessions || 0,
      globalPeakListeners: mongoResult.globalPeakListeners || 0,
      totalListeningHours: Math.round(currentTotalListeningMs / 3_600_000 * 10) / 10,
    };
  }

  // JSON fallback
  const state = ensureState();
  const guilds = Object.values(state.guilds);
  const completedListeningMs = guilds.reduce((sum, g) => sum + (g.totalListeningMs || 0), 0);
  const currentTotalListeningMs = completedListeningMs + activeListeningMs;
  return {
    totalGuilds: guilds.length,
    totalStarts: guilds.reduce((sum, g) => sum + (g.totalStarts || 0), 0),
    totalListeningMs: currentTotalListeningMs,
    completedListeningMs,
    activeListeningMs,
    totalSessions: guilds.reduce((sum, g) => sum + (g.totalSessions || 0), 0),
    globalPeakListeners: Math.max(0, ...guilds.map((g) => g.peakListeners || 0)),
    totalListeningHours: Math.round(currentTotalListeningMs / 3_600_000 * 10) / 10,
  };
}

// ============================================================
// Migration: Import JSON data to MongoDB on first connect
// ============================================================
export async function migrateJsonToMongo() {
  if (!useMongo()) return { migrated: false, reason: "mongodb-not-connected" };

  const db = getDb();
  const existingCount = await db.collection("guild_stats").countDocuments();
  if (existingCount > 0) return { migrated: false, reason: "data-exists" };

  const state = ensureState();
  const guilds = Object.values(state.guilds);
  if (guilds.length === 0) return { migrated: false, reason: "no-json-data" };

  let migrated = 0;
  for (const guildStats of guilds) {
    try {
      const doc = { ...guildStats };
      delete doc._id;
      doc.createdAt = new Date();
      doc.migratedFromJson = true;
      await db.collection("guild_stats").updateOne(
        { guildId: doc.guildId },
        { $set: doc },
        { upsert: true }
      );
      const gid = doc.guildId;
      const dailyStats = state.dailyStats?.[gid] || [];
      const sessionHistory = state.sessionHistory?.[gid] || [];
      const connectionEvents = state.connectionEvents?.[gid] || [];
      const listenerSnapshots = state.listenerSnapshots?.[gid] || [];

      for (const day of dailyStats) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection("daily_stats").updateOne(
          { guildId: gid, date: day.date },
          {
            $set: {
              guildId: gid,
              date: day.date,
              totalStarts: day.totalStarts || 0,
              totalListeningMs: day.totalListeningMs || 0,
              totalSessions: day.totalSessions || 0,
              peakListeners: day.peakListeners || 0,
              createdAt: new Date(),
            },
          },
          { upsert: true }
        );
      }

      if (sessionHistory.length) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection("listening_sessions").insertMany(
          sessionHistory.map((entry) => ({
            ...entry,
            guildId: gid,
            startedAt: new Date(entry.startedAt),
            endedAt: new Date(entry.endedAt),
          })),
          { ordered: false }
        ).catch(() => null);
      }

      if (connectionEvents.length) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection("connection_events").insertMany(
          connectionEvents.map((entry) => ({
            ...entry,
            guildId: gid,
            timestamp: new Date(entry.timestamp),
          })),
          { ordered: false }
        ).catch(() => null);
      }

      if (listenerSnapshots.length) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection("listener_snapshots").insertMany(
          listenerSnapshots.map((entry) => ({
            ...entry,
            guildId: gid,
            timestamp: new Date(entry.timestamp),
          })),
          { ordered: false }
        ).catch(() => null);
      }
      migrated++;
    } catch (err) {
      log("WARN", `Migration Guild ${guildStats.guildId} fehlgeschlagen: ${err?.message || err}`);
    }
  }

  log("INFO", `JSON -> MongoDB Migration: ${migrated}/${guilds.length} Guilds migriert.`);
  return { migrated: true, count: migrated, total: guilds.length };
}

// ============================================================
// Reset guild stats (in-memory + optionally called after DB wipe)
// ============================================================
export function resetGuildStats(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return;

  // Clear in-memory state
  const state = ensureState();
  if (state.guilds && state.guilds[gid]) {
    delete state.guilds[gid];
  }
  for (const key of ["dailyStats", "sessionHistory", "connectionEvents", "listenerSnapshots"]) {
    if (state[key] && state[key][gid]) {
      delete state[key][gid];
    }
  }

  // Clear any active sessions for this guild
  for (const [key, session] of activeSessions.entries()) {
    if (session.guildId === gid) {
      activeSessions.delete(key);
    }
  }

  saveStateToJsonFallback({ force: true });
  log("INFO", `Stats fuer Guild ${gid} zurueckgesetzt (inkl. Fallback-Daten).`);
}

export function __resetListeningStatsStoreForTests({ deleteFiles = false } = {}) {
  stateCache = null;
  activeSessions.clear();
  if (deleteFiles) {
    try { if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE); } catch {}
    try { if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE); } catch {}
  }
}
