// OmniFM: listening stats: the shapes of the stored data, normalized.
// Split out of src/listening-stats-store.js (#295).
import {
  MAX_FALLBACK_CONNECTION_EVENTS,
  MAX_FALLBACK_DAILY_STATS,
  MAX_FALLBACK_LISTENER_SNAPSHOTS,
  MAX_FALLBACK_SESSION_HISTORY,
} from "../listening-stats-store.js";

// ============================================================
// JSON Fallback (legacy, used when MongoDB is unavailable)
// ============================================================
export function emptyState() {
  return {
    version: 3,
    guilds: {},
    dailyStats: {},
    sessionHistory: {},
    connectionEvents: {},
    listenerSnapshots: {},
  };
}

export function normalizeGuildId(guildId) {
  const value = String(guildId || "").trim();
  return /^\d{17,22}$/.test(value) ? value : null;
}

export function normalizeText(value, maxLen = 160) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLen) : null;
}

export function normalizeCount(value) {
  const parsed = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function normalizeTimestamp(value) {
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

export function normalizeDateOnly(value) {
  const text = String(value || "").trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : null;
}

export function normalizeGuildStats(raw, guildId) {
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

export function normalizeStoredSession(raw, guildId) {
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

export function normalizeStoredConnectionEvent(raw, guildId) {
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

export function normalizeStoredListenerSnapshot(raw, guildId) {
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

export function normalizeState(input) {
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
