import test, { after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #301: the year review per server. The listening sessions go after 180
// days and the song plays after 45, so each month is kept per server. The
// MongoDB parts skip without MONGO_URL.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-year-review-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

const {
  addSessionHours, buildYearReview, createMonthCounter, monthKeyOf, monthRange, monthSettled, monthsToCount, nextMonthKey,
} = await import("../src/lib/year-review.js");
const { catalogGenreOf } = await import("../src/services/year-review.js");

const HOUR = 3_600_000;
const MINUTE = 60_000;
const at = (iso) => Date.parse(iso);
const guildsToClean = [];

after(async () => {
  if (hasMongoConfig) {
    const { getDb, isConnected, close } = await import("../src/lib/db.js");
    if (isConnected()) {
      const filter = { guildId: { $in: guildsToClean } };
      await Promise.all(["listening_sessions", "song_plays", "daily_stats", "year_review_months"].map((name) => getDb().collection(name).deleteMany(filter).catch(() => null)));
    }
    await close().catch(() => null);
  }
  fs.rmSync(scratchDir, { recursive: true, force: true, maxRetries: 3 });
});

function snowflake() {
  return String(100000000000000000n + BigInt(Math.floor(Math.random() * 1e15)));
}

// ---- German months and hours ----

test("the German month: its key, its borders in UTC, summer and winter time", () => {
  assert.equal(monthKeyOf(at("2026-09-30T21:59:00Z")), "2026-09");
  assert.equal(monthKeyOf(at("2026-09-30T22:00:00Z")), "2026-10", "midnight in Germany is 22:00 UTC in summer");
  assert.equal(monthKeyOf(at("2026-12-31T23:30:00Z")), "2027-01", "and 23:00 UTC in winter");
  assert.deepEqual(monthRange("2026-10"), { start: at("2026-09-30T22:00:00Z"), end: at("2026-10-31T23:00:00Z") });
  assert.deepEqual(monthRange("2026-12"), { start: at("2026-11-30T23:00:00Z"), end: at("2026-12-31T23:00:00Z") });
  assert.equal(nextMonthKey("2026-12"), "2027-01");
  for (const broken of ["", "2026-13", "2026-00", "2026-9", "september"]) assert.equal(monthRange(broken), null, broken);
});

test("which months are counted: back to where the sessions reach, settled ones stay", () => {
  const now = at("2026-09-28T12:00:00Z");
  assert.deepEqual(monthsToCount(now), ["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
  assert.deepEqual(monthsToCount(now, new Set(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08"])), ["2026-09"]);
  assert.equal(monthSettled("2026-08", now), true, "August ended more than ten days ago");
  assert.equal(monthSettled("2026-09", now), false);
  assert.equal(monthSettled("2026-09", at("2026-10-10T21:59:00Z")), false);
  assert.equal(monthSettled("2026-09", at("2026-10-10T22:00:00Z")), true);
});

test("a session spreads its listening time over the German hours of the day", () => {
  const hours = new Array(24).fill(0);
  // 20:30-22:30 German summer time, two hours listened.
  addSessionHours(hours, { startMs: at("2026-09-28T18:30:00Z"), endMs: at("2026-09-28T20:30:00Z"), listeningMs: 2 * HOUR });
  assert.equal(hours[20], 30 * MINUTE);
  assert.equal(hours[21], 60 * MINUTE);
  assert.equal(hours[22], 30 * MINUTE);
  assert.equal(hours.reduce((sum, ms) => sum + ms, 0), 2 * HOUR);

  // Half of the time with people: every hour gets half.
  const half = new Array(24).fill(0);
  addSessionHours(half, { startMs: at("2026-09-28T18:00:00Z"), endMs: at("2026-09-28T20:00:00Z"), listeningMs: HOUR });
  assert.deepEqual([half[20], half[21]], [30 * MINUTE, 30 * MINUTE]);

  // Only the part inside the month counts.
  const clipped = new Array(24).fill(0);
  addSessionHours(clipped, { startMs: at("2026-09-30T21:00:00Z"), endMs: at("2026-09-30T23:00:00Z"), listeningMs: 2 * HOUR }, ...Object.values(monthRange("2026-09")));
  assert.equal(clipped[23], HOUR);
  assert.equal(clipped[0], 0);

  // The night the clocks go back: 02:00-03:00 happens twice and counts twice.
  const night = new Array(24).fill(0);
  addSessionHours(night, { startMs: at("2026-10-25T00:00:00Z"), endMs: at("2026-10-25T02:00:00Z"), listeningMs: 2 * HOUR });
  assert.equal(night[2], 2 * HOUR);
});

test("one month of every server: time inside the month, sessions started in it, stations, genres, longest", () => {
  const range = monthRange("2026-09");
  const counter = createMonthCounter(range, catalogGenreOf({ groove: { genre: "Chill" }, rock: { genre: "Rock" } }));
  const session = (guildId, stationKey, startIso, hours, listened = hours) => ({
    guildId, stationKey, stationName: stationKey.toUpperCase(), startedAt: new Date(startIso), endedAt: new Date(at(startIso) + hours * HOUR), humanListeningMs: listened * HOUR,
  });
  counter.add(session("A", "groove", "2026-09-05T18:00:00Z", 3));
  counter.add(session("A", "rock", "2026-09-06T18:00:00Z", 1));
  counter.add(session("A", "groove", "2026-09-07T18:00:00Z", 2, 1));
  counter.add(session("A", "custom:own", "2026-09-08T18:00:00Z", 1));
  // Started in August, half of it in September: half the time, no September session.
  counter.add(session("A", "rock", "2026-08-31T20:00:00Z", 4));
  // Nothing to count.
  counter.add({ guildId: "A", stationKey: "rock", startedAt: "kaputt", endedAt: new Date(), humanListeningMs: HOUR });
  counter.add(session("A", "rock", "2026-09-09T18:00:00Z", 1, 0));
  counter.add(session("A", "rock", "2026-10-02T18:00:00Z", 1));
  counter.add(session("", "rock", "2026-09-09T18:00:00Z", 1));
  counter.add({ ...session("B", "rock", "2026-09-10T08:00:00Z", 1), startedAt: "2026-09-10T08:00:00.000Z", endedAt: "2026-09-10T09:00:00.000Z" });

  const result = counter.result();
  assert.deepEqual([...result.keys()].sort(), ["A", "B"]);
  const a = result.get("A");
  assert.equal(a.listeningMs, (3 + 1 + 1 + 1 + 2) * HOUR);
  assert.equal(a.sessions, 4);
  assert.deepEqual(a.stations.map(({ key, ms }) => [key, ms / HOUR]), [["groove", 4], ["rock", 3], ["custom:own", 1]]);
  assert.deepEqual(a.genres.map(({ genre, ms }) => [genre, ms / HOUR]), [["Chill", 4], ["Rock", 3]]);
  assert.equal(a.hours.reduce((sum, ms) => sum + ms, 0), a.listeningMs);
  assert.equal(a.hours[20], 3.5 * HOUR, "20:00-21:00 German time on four evenings, one of them half");
  assert.deepEqual({ ...a.longest, startedAt: a.longest.startedAt.toISOString() }, { ms: 3 * HOUR, stationKey: "groove", stationName: "GROOVE", startedAt: "2026-09-05T18:00:00.000Z" });
  assert.equal(result.get("B").listeningMs, HOUR, "dates stored as text still count");
});

test("a year for a test server: twelve months of test data become one review", () => {
  const months = [];
  /** @type {Record<string, number>} */
  const dailyByMonth = {};
  for (let index = 1; index <= 12; index += 1) {
    const month = `2026-${String(index).padStart(2, "0")}`;
    const hours = new Array(24).fill(0);
    hours[20] = 10 * HOUR;
    hours[index % 24] = 2 * HOUR;
    months.push({
      month,
      listeningMs: (10 + index) * HOUR,
      sessions: 5,
      stations: [{ key: "groove", name: "Groove Salad", ms: 8 * HOUR }, { key: "rock", name: "Rock Antenne", ms: (2 + index) * HOUR }],
      genres: [{ genre: "Chill", ms: 8 * HOUR }, { genre: "Rock", ms: (2 + index) * HOUR }],
      hours,
      longest: { ms: (index === 7 ? 9 : 3) * HOUR, stationKey: "groove", stationName: "Groove Salad", startedAt: new Date(Date.UTC(2026, index - 1, 3, 19)) },
      songs: index >= 9 ? [{ trackKey: "a|one", title: "A - One", plays: 10 }, { trackKey: "b|two", title: "B - Two", plays: index }] : [],
      songsFrom: index >= 9 ? new Date(Date.UTC(2026, 8, 7)) : null,
    });
    dailyByMonth[month] = (12 + index) * HOUR;
  }
  months.push({ month: "2025-12", listeningMs: 999 * HOUR, stations: [{ key: "old", name: "Old", ms: 999 * HOUR }] });

  const review = buildYearReview(months, { year: 2026, dailyByMonth: { ...dailyByMonth, "2025-12": 999 * HOUR } });
  assert.equal(review.listeningHours, 12 * 12 + 78, "the daily stats give the whole year");
  assert.equal(review.sessions, 60);
  assert.deepEqual(review.months.map((month) => month.hours), Array.from({ length: 12 }, (_, index) => 13 + index));
  assert.deepEqual(review.topStations, [{ key: "groove", name: "Groove Salad", hours: 96 }, { key: "rock", name: "Rock Antenne", hours: 102 }].sort((x, y) => y.hours - x.hours));
  assert.deepEqual(review.topGenres, [{ genre: "Rock", share: 52 }, { genre: "Chill", share: 48 }]);
  assert.deepEqual(review.topSongs, [{ title: "A - One", plays: 40 }, { title: "B - Two", plays: 42 }].sort((x, y) => y.plays - x.plays));
  assert.equal(review.busiestHour, 20);
  assert.equal(review.longest.hours, 9);
  assert.equal(review.stationsFrom, "2026-01");
  assert.equal(review.songsFrom.toISOString(), "2026-09-07T00:00:00.000Z");

  // Without the daily stats the months give the time; a year without anything stays empty.
  assert.equal(buildYearReview(months, { year: 2026 }).listeningHours, 12 * 10 + 78);
  const empty = buildYearReview([], { year: 2027 });
  assert.equal(empty.listeningHours, 0);
  assert.equal(empty.busiestHour, null);
  assert.equal(empty.longest, null);
  assert.deepEqual(empty.topStations, []);
});

// ---- MongoDB ----

async function mongo() {
  const { connect, getDb } = await import("../src/lib/db.js");
  await connect();
  return getDb();
}

test("counted from the sessions and song plays in MongoDB, settled months are not counted again", { skip: !hasMongoConfig }, async () => {
  const db = await mongo();
  const { countYearReviewMonth, refreshYearReview, yearReviewFor, YEAR_REVIEW_COLLECTION } = await import("../src/year-review-store.js");
  const guildId = snowflake();
  guildsToClean.push(guildId);
  // Real time, so MongoDB's TTLs do not take the test data away in between.
  const now = Date.now();
  const month = monthKeyOf(now);
  const before = monthKeyOf(monthRange(month).start - HOUR);
  const inMonth = (key, hoursAfterStart) => monthRange(key).start + hoursAfterStart * HOUR;
  await db.collection("listening_sessions").insertMany([
    { guildId, stationKey: "groove", stationName: "Groove Salad", startedAt: new Date(inMonth(before, 30)), endedAt: new Date(inMonth(before, 32)), durationMs: 2 * HOUR, humanListeningMs: 2 * HOUR },
    { guildId, stationKey: "groove", stationName: "Groove Salad", startedAt: new Date(inMonth(month, 1)), endedAt: new Date(inMonth(month, 2)), durationMs: HOUR, humanListeningMs: HOUR },
    { guildId, stationKey: "bot-alone", stationName: "Nobody", startedAt: new Date(inMonth(month, 3)), endedAt: new Date(inMonth(month, 4)), durationMs: HOUR, humanListeningMs: 0 },
  ]);
  const today = new Date(Date.UTC(new Date(now).getUTCFullYear(), new Date(now).getUTCMonth(), new Date(now).getUTCDate()));
  await db.collection("song_plays").insertMany([
    { guildId, day: today, trackKey: "a|one", displayTitle: "A - One", count: 4, lastPlayedAt: new Date(now) },
    { guildId, day: today, trackKey: "b|two", displayTitle: "B - Two", count: 6, lastPlayedAt: new Date(now) },
  ]);
  const year = Number(month.slice(0, 4));
  await db.collection("daily_stats").insertMany([
    { guildId, date: `${year}-01-15`, totalListeningMs: 5 * HOUR },
    { guildId, date: `${month}-01`, totalListeningMs: HOUR },
  ]);

  // The runs are the markers of this database; start without them.
  await db.collection("year_review_runs").deleteMany({});
  const first = await refreshYearReview({ now, genreOf: catalogGenreOf({ groove: { genre: "Chill" } }) });
  assert.deepEqual(first.months.map((entry) => entry.month), monthsToCount(now));
  const current = await db.collection(YEAR_REVIEW_COLLECTION).findOne({ _id: `${guildId}:${month}` });
  assert.equal(current.listeningMs, HOUR);
  assert.equal(current.sessions, 1, "a session without people counts for nothing");
  assert.deepEqual(current.stations.map((station) => station.key), ["groove"]);
  assert.deepEqual(current.genres, [{ genre: "Chill", ms: HOUR }]);
  assert.deepEqual(current.songs.map((song) => [song.title, song.plays]), [["B - Two", 6], ["A - One", 4]]);
  assert.equal(current.settled, false);
  assert.ok(current.expiresAt > new Date(now + 390 * 86_400_000));
  const earlier = await db.collection(YEAR_REVIEW_COLLECTION).findOne({ _id: `${guildId}:${before}` });
  assert.equal(earlier.listeningMs, 2 * HOUR);

  // Later on the same day only the months that are not settled are counted again.
  const again = await refreshYearReview({ now: now + MINUTE, genreOf: () => "" });
  const settledMonths = monthsToCount(now).filter((key) => monthSettled(key, now));
  assert.deepEqual(again.months.map((entry) => entry.month), monthsToCount(now).filter((key) => !settledMonths.includes(key)));

  // A count only replaces what it finds again.
  assert.ok(await countYearReviewMonth(db, month, { now }) >= 1);
  assert.equal((await db.collection(YEAR_REVIEW_COLLECTION).findOne({ _id: `${guildId}:${month}` })).genres.length, 0);

  const review = await yearReviewFor(guildId, year);
  assert.equal(review.listeningHours, 6, "the year's time comes from the daily stats");
  assert.equal(review.topSongs[0].title, "B - Two");
  assert.equal(await yearReviewFor("not-a-server", year), null);
});

test("song plays stay 45 days now; an index with the old 21 days is changed, not refused", { skip: !hasMongoConfig }, async () => {
  const db = await mongo();
  const { recordSongPlay, resetSongPlaysStoreForTests } = await import("../src/song-plays-store.js");
  const guildId = snowflake();
  guildsToClean.push(guildId);
  await db.collection("song_plays").createIndex({ day: 1 }, { expireAfterSeconds: 45 * 86_400, name: "day_ttl" }).catch(() => null);
  await db.command({ collMod: "song_plays", index: { name: "day_ttl", expireAfterSeconds: 21 * 86_400 } });
  resetSongPlaysStoreForTests();
  assert.deepEqual(await recordSongPlay(guildId, { artist: "A", title: "One" }), { ok: true });
  const ttl = (await db.collection("song_plays").indexes()).find((index) => index.name === "day_ttl");
  assert.equal(ttl.expireAfterSeconds, 45 * 86_400);
});
