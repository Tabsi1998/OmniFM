// ============================================================
// OmniFM: the numbers of the weekly digest (#278)
// ============================================================
// Plain data in, plain data out, so a normal, an empty and a first week can
// be tested without a bot or a database. The week is the last seven full
// days (yesterday and the six before), the week before is compared with it.

const DAY_MS = 24 * 60 * 60 * 1000;

/** @param {any} value */
function toMs(value, fallback = Date.now()) {
  const ms = value instanceof Date ? value.getTime() : (typeof value === "number" ? value : Date.parse(String(value || "")));
  return Number.isFinite(ms) ? ms : fallback;
}

function startOfLocalDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** "YYYY-MM-DD" in local time, like the daily stats store writes it. */
export function localDateKey(ms) {
  const date = new Date(ms);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function number(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function sumDays(rows) {
  return rows.reduce((total, row) => ({
    listeningMs: total.listeningMs + number(row.totalListeningMs),
    sessions: total.sessions + number(row.totalSessions),
    starts: total.starts + number(row.totalStarts),
    peakListeners: Math.max(total.peakListeners, number(row.peakListeners)),
    activeDays: total.activeDays + (number(row.totalListeningMs) || number(row.totalStarts) ? 1 : 0),
  }), { listeningMs: 0, sessions: 0, starts: 0, peakListeners: 0, activeDays: 0 });
}

/** Change in percent, rounded; null when there is nothing to compare with. */
export function percentChange(current, previous) {
  if (!(previous > 0)) return null;
  return Math.round(((current - previous) / previous) * 100);
}

function hexColor(value) {
  const match = /^#?([0-9a-f]{6})$/i.exec(String(value || "").trim());
  return match ? Number.parseInt(match[1], 16) : null;
}

function httpsUrl(value) {
  const text = String(value || "").trim();
  return /^https:\/\/\S+$/i.test(text) ? text : null;
}

/**
 * The week of a digest sent at `now`: the seven full days before today,
 * and the seven before those for the comparison. Local midnights.
 * @param {Date|number|string} [now]
 */
export function weeklyDigestRange(now = new Date()) {
  const endMs = startOfLocalDay(toMs(now));
  // Half a day more before flooring keeps 23- and 25-hour days (DST) right.
  const startMs = startOfLocalDay(endMs - 7 * DAY_MS + DAY_MS / 2);
  const previousStartMs = startOfLocalDay(startMs - 7 * DAY_MS + DAY_MS / 2);
  return { startMs, endMs, previousStartMs };
}

/**
 * @param {object} [input]
 * @param {Record<string, any>[]} [input.dailyStats]  rows { date, totalListeningMs, totalSessions, totalStarts, peakListeners }
 * @param {Record<string, any>[]} [input.sessions]    finished sessions { stationKey, stationName, startedAt, humanListeningMs, peakListeners }
 * @param {Record<string, any>[]} [input.snapshots]   { timestamp, listeners }
 * @param {Record<string, any>[]} [input.songPlays]   { displayTitle, count }, most played first
 * @param {Record<string, any>} [input.stations]      the catalog: key -> { name, logo, color }
 * @param {Record<string, any>} [input.allTime]       { totalListeningMs, totalSessions }
 * @param {Date|number|string} [input.now]
 */
export function buildWeeklyDigestReport({
  dailyStats = [],
  sessions = [],
  snapshots = [],
  songPlays = [],
  stations = {},
  allTime = {},
  now = new Date(),
} = {}) {
  const { startMs, endMs, previousStartMs } = weeklyDigestRange(now);
  const startKey = localDateKey(startMs);
  const endKey = localDateKey(endMs);
  const previousKey = localDateKey(previousStartMs);

  const rows = (Array.isArray(dailyStats) ? dailyStats : []).filter((row) => row && typeof row.date === "string");
  const weekRows = rows.filter((row) => row.date >= startKey && row.date < endKey);
  const previousRows = rows.filter((row) => row.date >= previousKey && row.date < startKey);
  const firstWeek = !rows.some((row) => row.date < startKey);

  const inWeek = (value) => {
    const ms = toMs(value, Number.NaN);
    return ms >= startMs && ms < endMs;
  };

  // Top stations by listening time of the sessions that started this week.
  const byStation = new Map();
  let sessionPeak = null;
  for (const session of Array.isArray(sessions) ? sessions : []) {
    if (!session || !inWeek(session.startedAt)) continue;
    const key = String(session.stationKey || session.stationName || "").trim();
    const listeningMs = number(session.humanListeningMs);
    if (key && listeningMs) {
      const entry = byStation.get(key) || { key, fallbackName: session.stationName || key, listeningMs: 0 };
      entry.listeningMs += listeningMs;
      byStation.set(key, entry);
    }
    const peak = number(session.peakListeners);
    if (peak && (!sessionPeak || peak > sessionPeak.listeners)) {
      sessionPeak = { atMs: toMs(session.startedAt), listeners: peak };
    }
  }
  const topStations = [...byStation.values()]
    .sort((a, b) => b.listeningMs - a.listeningMs || a.key.localeCompare(b.key))
    .slice(0, 3)
    .map((entry) => {
      const station = stations?.[entry.key] || {};
      return {
        key: entry.key,
        name: String(station.name || entry.fallbackName || entry.key),
        listeningMs: entry.listeningMs,
        logoUrl: httpsUrl(station.logo),
        color: hexColor(station.color),
      };
    });

  // The busiest moment: the snapshot with the most listeners, else a session's peak.
  let peakTime = null;
  for (const snapshot of Array.isArray(snapshots) ? snapshots : []) {
    const listeners = number(snapshot?.listeners);
    if (!listeners || !inWeek(snapshot.timestamp)) continue;
    if (!peakTime || listeners > peakTime.listeners) peakTime = { atMs: toMs(snapshot.timestamp), listeners };
  }
  if (!peakTime && sessionPeak) peakTime = sessionPeak;

  const week = sumDays(weekRows);
  week.peakListeners = Math.max(week.peakListeners, peakTime?.listeners || 0);
  const previousWeek = firstWeek ? null : sumDays(previousRows);
  const topSongs = (Array.isArray(songPlays) ? songPlays : [])
    .filter((song) => song && number(song.count) >= 2 && String(song.displayTitle || "").trim())
    .slice(0, 3)
    .map((song) => ({ displayTitle: String(song.displayTitle).trim(), count: number(song.count) }));

  return {
    range: { startMs, endMs },
    week,
    previousWeek,
    changes: {
      listeningMs: previousWeek ? percentChange(week.listeningMs, previousWeek.listeningMs) : null,
      peakListeners: previousWeek ? percentChange(week.peakListeners, previousWeek.peakListeners) : null,
      sessions: previousWeek ? percentChange(week.sessions, previousWeek.sessions) : null,
    },
    peakTime,
    topStations,
    topSongs,
    allTime: {
      listeningMs: number(allTime?.totalListeningMs),
      sessions: number(allTime?.totalSessions),
    },
    firstWeek,
    empty: !week.listeningMs && !week.starts && !week.sessions && topStations.length === 0,
  };
}
