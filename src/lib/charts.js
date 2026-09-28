// ============================================================
// OmniFM: the OmniFM charts (#300), what they show
// ============================================================
// The most played songs of a week across every server, from the song plays
// the weekly recap counts already (one counter per server, day and song, no
// person). A song only enters the charts when it ran on at least
// CHART_MIN_SERVERS servers, so no entry points to a single server. The
// week is a calendar week, Monday to Monday in UTC: the days the song plays
// are counted in.

export const CHART_MIN_SERVERS = 3;
export const CHART_SIZE = 20;
const DAY_MS = 86_400_000;

/** ISO week of the week starting on this Monday: the Thursday decides the year. */
function isoWeekOf(mondayMs) {
  const thursday = new Date(mondayMs + 3 * DAY_MS);
  const year = thursday.getUTCFullYear();
  const ordinal = Math.floor((thursday.getTime() - Date.UTC(year, 0, 1)) / DAY_MS) + 1;
  return { year, week: Math.floor((ordinal - 1) / 7) + 1 };
}

/**
 * A completed calendar week: `weeksBack` 1 is the last one, 2 the one before.
 * @param {number} [now]
 * @param {number} [weeksBack]
 */
export function chartWeek(now = Date.now(), weeksBack = 1) {
  const date = new Date(now);
  const today = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  const weekday = (new Date(today).getUTCDay() + 6) % 7;
  const start = today - weekday * DAY_MS - weeksBack * 7 * DAY_MS;
  const { year, week } = isoWeekOf(start);
  return {
    year,
    week,
    id: `${year}-W${String(week).padStart(2, "0")}`,
    start: new Date(start).toISOString(),
    end: new Date(start + 7 * DAY_MS).toISOString(),
  };
}

function ranked(rows, { minServers, size }) {
  return rows
    .filter((row) => Number(row?.servers) >= minServers && Number(row?.plays) > 0 && String(row?.displayTitle || "").trim())
    .sort((a, b) => b.plays - a.plays || b.servers - a.servers || String(a.displayTitle).localeCompare(String(b.displayTitle)))
    .slice(0, size);
}

/**
 * The chart of a week from its rows ({ trackKey, displayTitle, plays,
 * servers }), with the movement against the week before: "new" when the
 * song was not in that chart, else "up", "down" or "same".
 */
export function rankChart(rows = [], previousRows = [], { minServers = CHART_MIN_SERVERS, size = CHART_SIZE } = {}) {
  const previousRank = new Map(ranked(previousRows, { minServers, size }).map((row, index) => [row.trackKey, index + 1]));
  return ranked(rows, { minServers, size }).map((row, index) => {
    const rank = index + 1;
    const before = previousRank.get(row.trackKey) ?? null;
    return {
      rank,
      displayTitle: String(row.displayTitle).trim(),
      plays: Number(row.plays),
      servers: Number(row.servers),
      movement: movementOf(before, rank),
      previousRank: before,
    };
  });
}

export const STATION_CHART_SIZE = 10;
const HOUR_MS = 3_600_000;

function movementOf(before, rank) {
  if (before === null) return "new";
  return before > rank ? "up" : before < rank ? "down" : "same";
}

function rankedStations(rows, catalog, { minServers, size }) {
  return rows
    // At least one listening hour: a station many servers run with nobody
    // listening is no "most listened" station (it showed as "0 hours").
    .filter((row) => catalog[row?.stationKey] && Number(row?.servers) >= minServers && Number(row?.listeningMs) >= HOUR_MS)
    .sort((a, b) => b.listeningMs - a.listeningMs || b.servers - a.servers || String(a.stationKey).localeCompare(String(b.stationKey)))
    .slice(0, size);
}

/**
 * The most listened stations of a week from their rows ({ stationKey,
 * listeningMs, servers }): listening time of people, not of a bot alone.
 * Only stations of the public catalogue (`catalog`, key -> station) count,
 * never a server's own stream; name, genre, colour and logo come from the
 * catalogue, and the stream address when the website may play it.
 */
export function rankStations(rows = [], previousRows = [], catalog = {}, { minServers = CHART_MIN_SERVERS, size = STATION_CHART_SIZE } = {}) {
  const previousRank = new Map(rankedStations(previousRows, catalog, { minServers, size }).map((row, index) => [row.stationKey, index + 1]));
  return rankedStations(rows, catalog, { minServers, size }).map((row, index) => {
    const rank = index + 1;
    const station = catalog[row.stationKey];
    const before = previousRank.get(row.stationKey) ?? null;
    return {
      rank,
      key: row.stationKey,
      name: String(station.name || row.stationKey),
      genre: station.genre ? String(station.genre) : null,
      color: /^#[0-9a-f]{6}$/i.test(String(station.color || "")) ? String(station.color) : null,
      logo: /^https:\/\//.test(String(station.logo || "")) ? String(station.logo) : null,
      tier: String(station.tier || "free"),
      url: station.url ? String(station.url) : null,
      hours: Math.round((Number(row.listeningMs) / HOUR_MS) * 10) / 10,
      servers: Number(row.servers),
      movement: movementOf(before, rank),
      previousRank: before,
    };
  });
}

/** "Artist - Title" split for the cover search; without a dash all of it is the title. */
export function splitDisplayTitle(displayTitle = "") {
  const text = String(displayTitle || "").trim();
  const at = text.indexOf(" - ");
  if (at <= 0) return { artist: "", title: text };
  return { artist: text.slice(0, at).trim(), title: text.slice(at + 3).trim() };
}
