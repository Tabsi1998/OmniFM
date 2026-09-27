// ============================================================
// OmniFM: Listening Stats Store (MongoDB + JSON Fallback)
// ============================================================
import fs from "node:fs";
import { fileStoresAllowed } from "./lib/store-policy.js";
import { getDb, isConnected } from "./lib/db.js";
import { log } from "./lib/logging.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";
import {
  emptyState,
  normalizeCount,
  normalizeDateOnly,
  normalizeGuildId,
  normalizeGuildStats,
  normalizeState,
  normalizeStoredConnectionEvent,
  normalizeStoredListenerSnapshot,
  normalizeStoredSession,
  normalizeText,
} from "./listening-stats/normalize.js";
import {
  MAX_SESSION_SAMPLES,
  SESSION_SAMPLE_MIN_INTERVAL_MS,
  buildConnectionTimelineBucketsFromEvents,
  buildDailyListeningBreakdown,
  summarizeSessionListeners,
} from "./listening-stats/session-math.js";

const STORE_FILE = resolveRuntimeDataPath("listening-stats.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;
export const MAX_FALLBACK_DAILY_STATS = 400;
export const MAX_FALLBACK_SESSION_HISTORY = 120;
export const MAX_FALLBACK_CONNECTION_EVENTS = 400;
export const MAX_FALLBACK_LISTENER_SNAPSHOTS = 2_880;
const LISTENER_SNAPSHOT_DEDUPE_MS = 120_000;

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

export function ensureState() {
  if (stateCache) return stateCache;
  stateCache = readStateFile(STORE_FILE) || readStateFile(BACKUP_FILE) || emptyState();
  return stateCache;
}

function saveStateToFile() {
  // In production MongoDB is the only copy (#292).
  if (isConnected() && getDb() && !fileStoresAllowed()) return;
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

export function todayDateString(timestampMs) {
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

export function getFallbackConnectionHealth(guildId, days = 7) {
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

export function getActiveListeningMsTotal() {
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

// ============================================================
// MongoDB Operations
// ============================================================
export function useMongo() {
  return isConnected() && getDb() !== null;
}

export async function mongoSafe(fn) {
  if (!useMongo()) return null;
  try {
    return await fn(getDb());
  } catch (err) {
    log("WARN", `MongoDB Stats-Operation fehlgeschlagen: ${err?.message || err}`);
    return null;
  }
}

// ---- Write to MongoDB, and to JSON outside production (#292) ----
async function persistGuildStats(guildId, stats) {
  saveStateToFile();

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
    saveStateToFile();
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
  saveStateToFile();

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

    saveStateToFile();
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
    saveStateToFile();
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
    saveStateToFile();
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

  saveStateToFile();
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

// Split into topic modules (#295); the public API stays here.
export { migrateJsonToMongo } from "./listening-stats/migration.js";
export {
  getGlobalStats,
  getGuildConnectionHealth,
  getGuildDailyStats,
  getGuildListenerTimeline,
  getGuildListeningStats,
  getGuildSessionHistory,
  getGuildSessionsSince,
  getTopGuildsByActivity,
} from "./listening-stats/queries.js";
export {
  buildDailyListeningBreakdown,
  buildSessionListenerSegments,
  summarizeSessionListeners,
} from "./listening-stats/session-math.js";
