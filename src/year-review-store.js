// ============================================================
// OmniFM: the year review per server (#301), its months
// ============================================================
// The listening sessions go after 180 days and the song plays after 45, so
// a review in December would miss the spring. Each month is kept here per
// server instead: listening time, stations, genres, songs, hours of the day
// and the longest session. A month is counted again until ten days after
// its end, then it stays as it is; a month goes 400 days after its end.
// Servers only, never people. MongoDB only.
import { getDb, isConnected } from "./lib/db.js";
import { TOP_SONGS, buildYearReview, createMonthCounter, monthRange, monthSettled, monthsToCount } from "./lib/year-review.js";
import { SONG_PLAYS_COLLECTION } from "./song-plays-store.js";

export const YEAR_REVIEW_COLLECTION = "year_review_months";
const RUNS_COLLECTION = "year_review_runs";
const KEEP_AFTER_MONTH_MS = 400 * 86_400_000;

let indexesReady = null;

function database() {
  return isConnected() ? getDb() : null;
}

async function ensureIndexes(db) {
  if (!indexesReady) {
    indexesReady = Promise.all([
      db.collection(YEAR_REVIEW_COLLECTION).createIndex({ guildId: 1, month: 1 }, { name: "guild_month" }),
      db.collection(YEAR_REVIEW_COLLECTION).createIndex({ expiresAt: 1 }, { name: "ttl", expireAfterSeconds: 0 }),
    ]).catch((error) => {
      indexesReady = null;
      throw error;
    });
  }
  return indexesReady;
}

/**
 * The most played songs of every server in a month, from the song plays
 * (days in UTC, like they are stored), with the first day that had any.
 * @returns {Promise<Map<string, { songs: Array<{ trackKey: string, title: string, plays: number }>, songsFrom: Date | null }>>}
 */
async function monthSongs(db, month) {
  const [year, number] = month.split("-").map(Number);
  const rows = await db.collection(SONG_PLAYS_COLLECTION).aggregate([
    { $match: { day: { $gte: new Date(Date.UTC(year, number - 1, 1)), $lt: new Date(Date.UTC(year, number, 1)) } } },
    { $sort: { lastPlayedAt: 1 } },
    { $group: { _id: { guildId: "$guildId", trackKey: "$trackKey" }, plays: { $sum: "$count" }, title: { $last: "$displayTitle" }, firstDay: { $min: "$day" } } },
    { $sort: { plays: -1, title: 1 } },
    { $group: { _id: "$_id.guildId", songs: { $push: { trackKey: "$_id.trackKey", title: "$title", plays: "$plays" } }, songsFrom: { $min: "$firstDay" } } },
    { $project: { songs: { $slice: ["$songs", TOP_SONGS] }, songsFrom: 1 } },
  ], { allowDiskUse: true }).toArray();
  return new Map(rows.map((row) => [String(row._id), { songs: row.songs, songsFrom: row.songsFrom || null }]));
}

/**
 * Counts one German month of every server from the sessions and song plays
 * still there and stores it. Returns how many servers it has.
 * @param {any} db
 * @param {string} month "2026-09"
 * @param {{ now?: number, genreOf?: (stationKey: string) => string }} [options]
 */
export async function countYearReviewMonth(db, month, { now = Date.now(), genreOf = () => "" } = {}) {
  const range = monthRange(month);
  if (!range) return 0;
  await ensureIndexes(db);
  const counter = createMonthCounter(range, genreOf);
  const sessions = db.collection("listening_sessions").find(
    { startedAt: { $lt: new Date(range.end) }, endedAt: { $gt: new Date(range.start) }, humanListeningMs: { $gt: 0 } },
    { projection: { _id: 0, guildId: 1, stationKey: 1, stationName: 1, startedAt: 1, endedAt: 1, humanListeningMs: 1 } },
  );
  for await (const session of sessions) counter.add(session);
  const counted = counter.result();
  const songs = await monthSongs(db, month);
  const settled = monthSettled(month, now);
  const guildIds = new Set([...counted.keys(), ...songs.keys()]);
  const writes = [...guildIds].map((guildId) => {
    const listening = counted.get(guildId) || { listeningMs: 0, sessions: 0, stations: [], genres: [], hours: new Array(24).fill(0), longest: null };
    const played = songs.get(guildId) || { songs: [], songsFrom: null };
    return {
      replaceOne: {
        filter: { _id: `${guildId}:${month}` },
        replacement: {
          guildId,
          month,
          ...listening,
          songs: played.songs,
          songsFrom: played.songsFrom,
          settled,
          countedAt: new Date(now),
          expiresAt: new Date(range.end + KEEP_AFTER_MONTH_MS),
        },
        upsert: true,
      },
    };
  });
  for (let index = 0; index < writes.length; index += 500) {
    // eslint-disable-next-line no-await-in-loop -- in blocks of 500
    await db.collection(YEAR_REVIEW_COLLECTION).bulkWrite(writes.slice(index, index + 500), { ordered: false });
  }
  return guildIds.size;
}

/**
 * Counts every month that is not settled yet: on the first run every month
 * the sessions still reach back to, afterwards the current one and the one
 * before until it is settled.
 * @param {{ now?: number, genreOf?: (stationKey: string) => string }} [options]
 */
export async function refreshYearReview({ now = Date.now(), genreOf = () => "" } = {}) {
  const db = database();
  if (!db) return { months: [] };
  const runs = db.collection(RUNS_COLLECTION);
  const settled = new Set((await runs.find({ settled: true }, { projection: { _id: 1 } }).toArray()).map((run) => String(run._id)));
  const months = monthsToCount(now, settled);
  const counted = [];
  for (const month of months) {
    // eslint-disable-next-line no-await-in-loop -- one month after the other
    const servers = await countYearReviewMonth(db, month, { now, genreOf });
    // eslint-disable-next-line no-await-in-loop
    await runs.updateOne({ _id: month }, { $set: { settled: monthSettled(month, now), countedAt: new Date(now), servers } }, { upsert: true });
    counted.push({ month, servers });
  }
  return { months: counted };
}

/**
 * The year of one server: its months, and the listening time per month
 * from the daily stats (kept for good, so the whole year is in).
 * @param {string} guildId
 * @param {number} year
 */
export async function yearReviewFor(guildId, year) {
  const db = database();
  const gid = /^\d{17,22}$/.test(String(guildId || "")) ? String(guildId) : "";
  if (!db || !gid) return null;
  const [months, days] = await Promise.all([
    db.collection(YEAR_REVIEW_COLLECTION).find({ guildId: gid, month: { $gte: `${year}-01`, $lte: `${year}-12` } }).toArray(),
    db.collection("daily_stats").find({ guildId: gid, date: { $gte: `${year}-01-01`, $lte: `${year}-12-31` } }, { projection: { _id: 0, date: 1, totalListeningMs: 1 } }).toArray(),
  ]);
  /** @type {Record<string, number>} */
  const dailyByMonth = {};
  for (const day of days) {
    const month = String(day.date).slice(0, 7);
    dailyByMonth[month] = (dailyByMonth[month] || 0) + (Number(day.totalListeningMs) || 0);
  }
  return buildYearReview(months, { year, dailyByMonth: days.length ? dailyByMonth : null });
}

export function resetYearReviewStoreForTests() {
  indexesReady = null;
}
