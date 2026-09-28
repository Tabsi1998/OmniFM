import test, { after } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { CHART_MIN_SERVERS, chartWeek, rankChart, rankStations, splitDisplayTitle } from "../src/lib/charts.js";
import { buildChartsMessage, chartPostDue, chartsPostSettings, weeklyChart } from "../src/services/charts.js";
import { checkDiscordLimits } from "../src/discord/ui/index.js";

// #300: the OmniFM charts, stations first, then songs. Only what ran on
// enough servers counts; nothing in the answer points to a single server.
const DAY = 86_400_000;
const HOUR = 3_600_000;
const NOW = Date.parse("2026-09-30T12:00:00.000Z"); // a Wednesday
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());
let nextGuild = 300000000000000000n;
const guild = () => String(nextGuild++);
const CATALOG = {
  groovesalad: { name: "Groove Salad", url: "https://ice4.somafm.com/groovesalad-128-mp3", tier: "free", genre: "Ambient", color: "#14B8A6", logo: "https://api.somafm.com/logos/512/groovesalad512.png" },
  einslive: { name: "1LIVE", url: "https://example.com/1live.mp3", tier: "pro", genre: "Pop", color: "#FF6B00" },
  deepspace: { name: "Deep Space One", url: "https://example.com/deep.mp3", tier: "free", genre: "Ambient" },
};

test("the chart week is the last completed calendar week, with its ISO number", () => {
  const week = chartWeek(NOW);
  assert.deepEqual([week.id, week.start, week.end], ["2026-W39", "2026-09-21T00:00:00.000Z", "2026-09-28T00:00:00.000Z"]);
  assert.equal(chartWeek(NOW, 2).id, "2026-W38");
  // Monday 28 December 2026 starts week 53; its Thursday is still in 2026.
  assert.equal(chartWeek(Date.parse("2027-01-06T08:00:00.000Z")).id, "2026-W53");
  assert.equal(chartWeek(Date.parse("2027-01-13T08:00:00.000Z")).id, "2027-W01");
});

test("stations: only catalogue stations of enough servers, by listening time", () => {
  const rows = [
    { stationKey: "groovesalad", listeningMs: 30 * HOUR, servers: 5 },
    { stationKey: "einslive", listeningMs: 90 * HOUR, servers: CHART_MIN_SERVERS - 1 },
    { stationKey: "custom:myserver", listeningMs: 500 * HOUR, servers: 9 },
    { stationKey: "deepspace", listeningMs: 12.34 * HOUR, servers: CHART_MIN_SERVERS },
    // Run on many servers, but hardly anyone listened: not a most listened station.
    { stationKey: "einslive", listeningMs: 20 * 60_000, servers: 9 },
  ];
  const chart = rankStations(rows, [{ stationKey: "deepspace", listeningMs: 50 * HOUR, servers: 4 }], CATALOG);
  assert.deepEqual(chart.map((entry) => [entry.rank, entry.key, entry.hours, entry.movement]), [
    [1, "groovesalad", 30, "new"],
    [2, "deepspace", 12.3, "down"],
  ]);
  assert.equal(chart[0].logo, CATALOG.groovesalad.logo);
  assert.equal(chart[0].url, CATALOG.groovesalad.url, "the website can play it");
  assert.equal(chart[1].logo, null);
});

test("songs from fewer servers than the threshold never enter, however often they ran", () => {
  const rows = [
    { trackKey: "a", displayTitle: "Solo - Only Here", plays: 5000, servers: 1 },
    { trackKey: "b", displayTitle: "Duo - Two Servers", plays: 4000, servers: CHART_MIN_SERVERS - 1 },
    { trackKey: "c", displayTitle: "Band - Everywhere", plays: 30, servers: CHART_MIN_SERVERS },
    { trackKey: "d", displayTitle: "Band - Also Here", plays: 30, servers: CHART_MIN_SERVERS + 2 },
  ];
  const chart = rankChart(rows, [{ trackKey: "c", displayTitle: "Band - Everywhere", plays: 50, servers: 4 }]);
  assert.deepEqual(chart.map((entry) => [entry.rank, entry.displayTitle, entry.movement]), [
    [1, "Band - Also Here", "new"],
    [2, "Band - Everywhere", "down"],
  ]);
});

test("a display title splits into artist and title for the cover search", () => {
  assert.deepEqual(splitDisplayTitle("Daft Punk - One More Time"), { artist: "Daft Punk", title: "One More Time" });
  assert.deepEqual(splitDisplayTitle("Just A Title"), { artist: "", title: "Just A Title" });
});

test("the post is due from Monday 10:00 German time and needs a channel", () => {
  assert.equal(chartPostDue(Date.parse("2026-09-28T07:59:00.000Z")), false, "Monday 09:59 in Berlin");
  assert.equal(chartPostDue(Date.parse("2026-09-28T08:00:00.000Z")), true, "Monday 10:00 in Berlin");
  assert.equal(chartPostDue(Date.parse("2026-10-01T03:00:00.000Z")), true, "later in the week");
  assert.deepEqual(chartsPostSettings({ charts: { postEnabled: true, channelId: "abc" } }), { enabled: false, channelId: "", language: "de" });
  assert.equal(chartsPostSettings({ charts: { postEnabled: true, channelId: "123456789012345678", language: "en" } }).enabled, true);
});

test("the weekly post shows five stations and three songs within Discord's limits", () => {
  const stations = Array.from({ length: 10 }, (_, index) => ({
    rank: index + 1, key: `station${index}`, name: `Station ${index + 1}`, genre: "Pop", hours: 300 - index * 10.5, servers: 20,
    movement: index % 2 ? "up" : "new", previousRank: index % 2 ? index + 3 : null, logo: "https://api.somafm.com/logos/512/x.png",
  }));
  const songs = Array.from({ length: 20 }, (_, index) => ({
    rank: index + 1, displayTitle: `Artist ${index + 1} - Song ${index + 1}`, plays: 1000 - index * 10, servers: 12, movement: "same", previousRank: index + 1,
  }));
  const payload = buildChartsMessage({ week: chartWeek(NOW), stations, songs }, { language: "de" });
  assert.deepEqual(checkDiscordLimits(payload).problems, []);
  const text = JSON.stringify(payload);
  assert.match(text, /KW 39/);
  assert.match(text, /Meistgehörte Sender/);
  assert.match(text, /Station 5\*\*/);
  assert.doesNotMatch(text, /Station 6\*\*/, "five stations in the post");
  assert.match(text, /Artist 3 - Song 3/);
  assert.doesNotMatch(text, /Artist 4 - Song 4/, "three songs in the post");
  assert.match(text, /Hörstunden/);
});

let client = null;
let database = null;
after(async () => {
  if (database) await database.dropDatabase().catch(() => null);
  if (client) await client.close().catch(() => null);
});

test("counted from MongoDB: stations and songs of enough servers, no server in the answer", { skip: !hasMongoConfig }, async () => {
  client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  database = client.db(`omnifm_charts_test_${process.pid}`);
  const week = chartWeek(NOW);
  const weekStart = Date.parse(week.start);
  const day = new Date(weekStart + 2 * DAY);
  const everywhere = [guild(), guild(), guild(), guild()];
  const lonely = guild();
  const iso = (ms) => new Date(ms).toISOString();
  // Sessions keep start and end as text, like the store writes them.
  const session = (guildId, stationKey, startMs, endMs, humanListeningMs) => ({
    guildId, stationKey, stationName: stationKey, startedAt: iso(startMs), endedAt: iso(endMs), durationMs: endMs - startMs, humanListeningMs,
  });
  await database.collection("listening_sessions").insertMany([
    ...everywhere.map((guildId) => session(guildId, "groovesalad", weekStart + DAY, weekStart + DAY + 2 * HOUR, 2 * HOUR)),
    // Half of this session falls into the week before: only half of it counts.
    session(everywhere[0], "groovesalad", weekStart - 2 * HOUR, weekStart + 2 * HOUR, 4 * HOUR),
    // A server's own stream on many servers never shows.
    ...everywhere.map((guildId) => session(guildId, "custom:ourstream", weekStart + DAY, weekStart + 2 * DAY, 20 * HOUR)),
    // A catalogue station of one server does not show either.
    session(lonely, "einslive", weekStart + DAY, weekStart + 3 * DAY, 40 * HOUR),
    { guildId: lonely, stationKey: "deepspace", startedAt: "kaputt", endedAt: iso(weekStart + DAY), humanListeningMs: 99 * HOUR },
  ]);
  await database.collection("song_plays").insertMany([
    ...everywhere.map((guildId, index) => ({ guildId, day, trackKey: "band|everywhere", displayTitle: "Band - Everywhere", count: 5 + index, lastPlayedAt: day })),
    { guildId: lonely, day, trackKey: "solo|only here", displayTitle: "Solo - Only Here", count: 900, lastPlayedAt: day },
  ]);
  const chart = await weeklyChart(database, { now: NOW, cacheMs: 0, coverFor: async () => null, catalog: CATALOG });
  assert.deepEqual(chart.stations.map((entry) => [entry.key, entry.hours, entry.servers]), [["groovesalad", 10, 4]]);
  assert.deepEqual(chart.songs.map((entry) => [entry.displayTitle, entry.plays, entry.servers]), [["Band - Everywhere", 26, 4]]);
  const text = JSON.stringify(chart);
  for (const guildId of [...everywhere, lonely]) assert.ok(!text.includes(guildId), "no server ID in the answer");
  for (const hidden of ["ourstream", "Only Here", "einslive"]) assert.ok(!text.includes(hidden), `${hidden} is not in the charts`);
});
