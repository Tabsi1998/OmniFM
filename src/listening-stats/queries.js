// OmniFM: listening stats: what the dashboard and /stats read.
// Split out of src/listening-stats-store.js (#295).
import {
  MAX_FALLBACK_DAILY_STATS,
  MAX_FALLBACK_SESSION_HISTORY,
  ensureState,
  getActiveListeningMsTotal,
  getActiveSessionsForGuild,
  getFallbackConnectionHealth,
  mongoSafe,
} from "../listening-stats-store.js";
import {
  normalizeCount,
  normalizeGuildId,
  normalizeGuildStats,
  normalizeText,
} from "./normalize.js";
import { buildConnectionTimelineBuckets, buildDailyListeningBreakdown } from "./session-math.js";

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

// Stored sessions carry dates (older ones text); callers get text as before.
function withTextDates(session) {
  const copy = { ...session };
  for (const field of ["startedAt", "endedAt"]) {
    if (copy[field] instanceof Date) copy[field] = copy[field].toISOString();
  }
  return copy;
}

/** Finished sessions that started since `sinceMs`, newest first (weekly digest, #278). */
export async function getGuildSessionsSince(guildId, sinceMs, { limit = 5000 } = {}) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return [];
  const sinceIso = new Date(Number(sinceMs) || 0).toISOString();
  const max = Math.max(1, Math.min(20000, Number(limit) || 5000));

  const result = await mongoSafe(async (db) => {
    // A comparison only matches its own type: dates and not yet converted text.
    const rows = await db.collection("listening_sessions")
      .find({ guildId: gid, $or: [{ startedAt: { $gte: new Date(sinceIso) } }, { startedAt: { $gte: sinceIso } }] })
      .sort({ startedAt: -1 })
      .limit(max)
      .project({ _id: 0, stationKey: 1, stationName: 1, startedAt: 1, humanListeningMs: 1, peakListeners: 1 })
      .toArray();
    return rows.map(withTextDates);
  });
  if (result) return result;

  return (ensureState().sessionHistory?.[gid] || [])
    .filter((entry) => String(entry?.startedAt || "") >= sinceIso)
    .sort((a, b) => String(b.startedAt || "").localeCompare(String(a.startedAt || "")))
    .map((entry) => ({ ...entry }));
}

export async function getGuildSessionHistory(guildId, limit = 20) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return [];

  const result = await mongoSafe(async (db) => {
    const rows = await db.collection("listening_sessions")
      .find({ guildId: gid })
      .sort({ startedAt: -1 })
      .limit(Math.min(limit, 100))
      .project({ _id: 0 })
      .toArray();
    return rows.map(withTextDates);
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
