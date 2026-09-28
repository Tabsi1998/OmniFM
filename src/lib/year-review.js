// ============================================================
// OmniFM: the year review per server (#301), the rules
// ============================================================
// Pure: the German month of a moment, which months still need counting,
// how a listening session spreads over the hours of the day, one month of
// every server from its sessions, and a server's year from its months.
// Servers only, never people.
import { getZonedPartsFromUtcMs, zonedDateTimeToUtcMs } from "./event-time.js";

export const REVIEW_TIME_ZONE = "Europe/Berlin";
/** How far back MongoDB keeps the listening sessions a month is counted from. */
export const SESSION_KEEP_DAYS = 180;
/** A month is counted again until this many days after its end; then it stays as it is. */
export const MONTH_SETTLE_DAYS = 10;
export const TOP_STATIONS = 25;
export const TOP_GENRES = 10;
export const TOP_SONGS = 50;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const MONTH_KEY = /^(\d{4})-(\d{2})$/;

/** "2026-09": the German month of a moment. */
export function monthKeyOf(ms) {
  const { year, month } = getZonedPartsFromUtcMs(ms, REVIEW_TIME_ZONE);
  return `${year}-${String(month).padStart(2, "0")}`;
}

export function nextMonthKey(key) {
  const [year, month] = String(key).split("-").map(Number);
  return month === 12 ? `${year + 1}-01` : `${year}-${String(month + 1).padStart(2, "0")}`;
}

/**
 * The German month in UTC milliseconds, start included, end not.
 * @returns {{ start: number, end: number } | null}
 */
export function monthRange(key) {
  const match = MONTH_KEY.exec(String(key || ""));
  if (!match || Number(match[2]) < 1 || Number(match[2]) > 12) return null;
  const midnightOfFirst = (monthKey) => {
    const [year, month] = monthKey.split("-").map(Number);
    return zonedDateTimeToUtcMs({ year, month, day: 1, hour: 0, minute: 0, second: 0 }, REVIEW_TIME_ZONE);
  };
  return { start: midnightOfFirst(key), end: midnightOfFirst(nextMonthKey(key)) };
}

/** Settled: counted after its end with everything in, never counted again. */
export function monthSettled(key, now = Date.now()) {
  const range = monthRange(key);
  return Boolean(range) && now >= range.end + MONTH_SETTLE_DAYS * DAY_MS;
}

/**
 * The months to count now: from the oldest month the listening sessions
 * still reach into up to the current one, without the settled ones.
 * @param {number} now
 * @param {Set<string>} settled
 */
export function monthsToCount(now = Date.now(), settled = new Set()) {
  const last = monthKeyOf(now);
  const months = [];
  for (let key = monthKeyOf(now - SESSION_KEEP_DAYS * DAY_MS); ; key = nextMonthKey(key)) {
    if (!settled.has(key)) months.push(key);
    if (key === last) return months;
  }
}

const hourFormat = new Intl.DateTimeFormat("en-US", { timeZone: REVIEW_TIME_ZONE, hour: "numeric", hourCycle: "h23" });
const hourCache = new Map();

/** The German hour of the day (0-23) of the UTC hour starting at the moment. */
function germanHour(utcHourStart) {
  let hour = hourCache.get(utcHourStart);
  if (hour === undefined) {
    hour = Number(hourFormat.formatToParts(new Date(utcHourStart)).find((part) => part.type === "hour")?.value || 0) % 24;
    if (hourCache.size > 50_000) hourCache.clear();
    hourCache.set(utcHourStart, hour);
  }
  return hour;
}

/**
 * Spreads the listening time of a session evenly over its duration and adds
 * each part to the German hour of the day it falls into. Only the part
 * between `from` and `to` counts. German hours begin with UTC hours (the
 * offset is one or two whole hours), so the steps are UTC hours.
 * @param {number[]} hours 24 buckets
 * @param {{ startMs: number, endMs: number, listeningMs: number }} session
 */
export function addSessionHours(hours, { startMs, endMs, listeningMs }, from = -Infinity, to = Infinity) {
  const duration = endMs - startMs;
  if (!(duration > 0) || !(listeningMs > 0)) return;
  const perMs = listeningMs / duration;
  const stop = Math.min(endMs, to);
  for (let cursor = Math.max(startMs, from); cursor < stop;) {
    const hourStart = Math.floor(cursor / HOUR_MS) * HOUR_MS;
    const segmentEnd = Math.min(stop, hourStart + HOUR_MS);
    hours[germanHour(hourStart)] += (segmentEnd - cursor) * perMs;
    cursor = segmentEnd;
  }
}

function msOf(value) {
  if (value === null || value === undefined || value === "") return null;
  const ms = value instanceof Date ? value.getTime() : typeof value === "number" ? value : Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

const byMs = (a, b) => b.ms - a.ms;

/**
 * Counts one month of every server, session by session: listening time of
 * people (the part of a session inside the month), the sessions that
 * started in it, stations and their genres, the hours of the day and the
 * longest session.
 * @param {{ start: number, end: number }} range from monthRange()
 * @param {(stationKey: string) => string} [genreOf]
 */
export function createMonthCounter(range, genreOf = () => "") {
  const guilds = new Map();
  return {
    /** @param {{ guildId?: string, stationKey?: string, stationName?: string, startedAt?: any, endedAt?: any, humanListeningMs?: number }} session */
    add(session) {
      const startMs = msOf(session?.startedAt);
      const endMs = msOf(session?.endedAt);
      const listeningMs = Number(session?.humanListeningMs) || 0;
      const guildId = String(session?.guildId || "");
      if (!guildId || startMs === null || endMs === null || endMs <= startMs || listeningMs <= 0) return;
      if (endMs <= range.start || startMs >= range.end) return;
      const inMonthMs = listeningMs * ((Math.min(endMs, range.end) - Math.max(startMs, range.start)) / (endMs - startMs));
      let guild = guilds.get(guildId);
      if (!guild) {
        guild = { listeningMs: 0, sessions: 0, stations: new Map(), genres: new Map(), hours: new Array(24).fill(0), longest: null };
        guilds.set(guildId, guild);
      }
      guild.listeningMs += inMonthMs;
      const key = String(session.stationKey || "").slice(0, 120);
      const name = String(session.stationName || key).slice(0, 120);
      if (key) {
        const station = guild.stations.get(key) || { key, name, ms: 0 };
        station.ms += inMonthMs;
        if (name) station.name = name;
        guild.stations.set(key, station);
        const genre = String(genreOf(key) || "").trim().slice(0, 60);
        if (genre) guild.genres.set(genre, (guild.genres.get(genre) || 0) + inMonthMs);
      }
      addSessionHours(guild.hours, { startMs, endMs, listeningMs }, range.start, range.end);
      // Sessions count in the month they started in.
      if (startMs >= range.start) {
        guild.sessions += 1;
        if (!guild.longest || listeningMs > guild.longest.ms) {
          guild.longest = { ms: Math.round(listeningMs), stationKey: key || null, stationName: name || null, startedAt: new Date(startMs) };
        }
      }
    },
    /** @returns {Map<string, { listeningMs: number, sessions: number, stations: any[], genres: any[], hours: number[], longest: any }>} */
    result() {
      return new Map([...guilds].map(([guildId, guild]) => [guildId, {
        listeningMs: Math.round(guild.listeningMs),
        sessions: guild.sessions,
        stations: [...guild.stations.values()].sort(byMs).slice(0, TOP_STATIONS).map((station) => ({ ...station, ms: Math.round(station.ms) })),
        genres: [...guild.genres].map(([genre, ms]) => ({ genre, ms: Math.round(ms) })).sort(byMs).slice(0, TOP_GENRES),
        hours: guild.hours.map((ms) => Math.round(ms)),
        longest: guild.longest,
      }]));
    },
  };
}

const hoursOf = (ms) => Math.round((Number(ms) || 0) / HOUR_MS);

/**
 * A server's year from its months: listening time (from the daily stats when
 * given, they are kept for good), top stations, genres and songs, the
 * busiest hour of the day, the longest session, and from which month on
 * stations and songs were counted.
 * @param {Array<Record<string, any>>} months stored months of the server, any order
 * @param {{ year: number, dailyByMonth?: Record<string, number> | null, top?: number }} options
 */
export function buildYearReview(months, { year, dailyByMonth = null, top = 5 }) {
  const mine = months.filter((month) => String(month?.month || "").startsWith(`${year}-`))
    .sort((a, b) => String(a.month).localeCompare(String(b.month)));
  const stations = new Map();
  const genres = new Map();
  const songs = new Map();
  const hours = new Array(24).fill(0);
  let longest = null;
  let sessions = 0;
  for (const month of mine) {
    sessions += Number(month.sessions) || 0;
    for (const station of month.stations || []) {
      const entry = stations.get(station.key) || { key: station.key, name: station.name, ms: 0 };
      entry.ms += Number(station.ms) || 0;
      entry.name = station.name || entry.name;
      stations.set(station.key, entry);
    }
    for (const genre of month.genres || []) genres.set(genre.genre, (genres.get(genre.genre) || 0) + (Number(genre.ms) || 0));
    for (const song of month.songs || []) {
      const entry = songs.get(song.trackKey) || { title: song.title, plays: 0 };
      entry.plays += Number(song.plays) || 0;
      entry.title = song.title || entry.title;
      songs.set(song.trackKey, entry);
    }
    (month.hours || []).forEach((ms, hour) => { if (hour < 24) hours[hour] += Number(ms) || 0; });
    if (month.longest && (!longest || month.longest.ms > longest.ms)) longest = month.longest;
  }
  const perMonth = Array.from({ length: 12 }, (_, index) => {
    const key = `${year}-${String(index + 1).padStart(2, "0")}`;
    const stored = mine.find((month) => month.month === key);
    const ms = dailyByMonth ? Number(dailyByMonth[key]) || 0 : Number(stored?.listeningMs) || 0;
    return { month: key, hours: hoursOf(ms) };
  });
  const totalMs = dailyByMonth
    ? Object.entries(dailyByMonth).filter(([key]) => key.startsWith(`${year}-`)).reduce((sum, [, ms]) => sum + (Number(ms) || 0), 0)
    : mine.reduce((sum, month) => sum + (Number(month.listeningMs) || 0), 0);
  const genreTotal = [...genres.values()].reduce((sum, ms) => sum + ms, 0);
  const busiest = hours.reduce((best, ms, hour) => (ms > hours[best] ? hour : best), 0);
  return {
    year,
    listeningHours: hoursOf(totalMs),
    sessions,
    months: perMonth,
    topStations: [...stations.values()].sort(byMs).slice(0, top).map((station) => ({ key: station.key, name: station.name, hours: hoursOf(station.ms) })),
    topGenres: [...genres].sort((a, b) => b[1] - a[1]).slice(0, top)
      .map(([genre, ms]) => ({ genre, share: genreTotal ? Math.round((ms / genreTotal) * 100) : 0 })),
    topSongs: [...songs.values()].sort((a, b) => b.plays - a.plays || String(a.title).localeCompare(String(b.title))).slice(0, top),
    busiestHour: hours[busiest] > 0 ? busiest : null,
    // Listening time per German hour of the day, in hours (#301 part 2).
    hoursOfDay: hours.map((ms) => Math.round((ms / HOUR_MS) * 10) / 10),
    longest: longest ? { hours: Math.round((longest.ms / HOUR_MS) * 10) / 10, stationName: longest.stationName, startedAt: longest.startedAt } : null,
    stationsFrom: mine.find((month) => (month.stations || []).length)?.month || null,
    songsFrom: mine.find((month) => (month.songs || []).length)?.songsFrom || null,
  };
}
