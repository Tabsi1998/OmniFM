import test, { after } from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { CHART_MIN_SERVERS, chartWeek, rankChart, splitDisplayTitle } from "../src/lib/charts.js";
import { buildChartsMessage, chartPostDue, chartsPostSettings, weeklyChart } from "../src/services/charts.js";
import { checkDiscordLimits } from "../src/discord/ui/index.js";

// #300: the OmniFM charts. A song only counts when it ran on enough servers;
// nothing in the answer points to a single server.
const DAY = 86_400_000;
const NOW = Date.parse("2026-09-30T12:00:00.000Z"); // a Wednesday
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());
let nextGuild = 300000000000000000n;
const guild = () => String(nextGuild++);

test("the chart week is the last completed calendar week, with its ISO number", () => {
  const week = chartWeek(NOW);
  assert.deepEqual([week.id, week.start, week.end], ["2026-W39", "2026-09-21T00:00:00.000Z", "2026-09-28T00:00:00.000Z"]);
  assert.equal(chartWeek(NOW, 2).id, "2026-W38");
  // Monday 28 December 2026 starts week 53; its Thursday is still in 2026.
  assert.equal(chartWeek(Date.parse("2027-01-06T08:00:00.000Z")).id, "2026-W53");
  assert.equal(chartWeek(Date.parse("2027-01-13T08:00:00.000Z")).id, "2027-W01");
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
  assert.equal(chart[1].previousRank, 1);
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

test("the weekly post fits Discord's limits with ten songs and covers", () => {
  const entries = Array.from({ length: 20 }, (_, index) => ({
    rank: index + 1,
    displayTitle: `Artist ${index + 1} - A Rather Long Song Title Number ${index + 1}`,
    plays: 1000 - index * 10,
    servers: 12,
    movement: index % 2 ? "up" : "new",
    previousRank: index % 2 ? index + 3 : null,
    cover: "https://is1-ssl.mzstatic.com/image/thumb/cover/600x600bb.jpg",
  }));
  const payload = buildChartsMessage({ week: chartWeek(NOW), entries }, { language: "de" });
  assert.deepEqual(checkDiscordLimits(payload).problems, []);
  const text = JSON.stringify(payload);
  assert.match(text, /KW 39/);
  assert.match(text, /Artist 10 - /, "places 4 to 10 are listed");
  assert.doesNotMatch(text, /Artist 11 - /, "the website has the rest");
});

let client = null;
let database = null;
after(async () => {
  if (database) await database.dropDatabase().catch(() => null);
  if (client) await client.close().catch(() => null);
});

test("counted from MongoDB: only songs of enough servers, no server in the answer", { skip: !hasMongoConfig }, async () => {
  client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  database = client.db(`omnifm_charts_test_${process.pid}`);
  const plays = database.collection("song_plays");
  const week = chartWeek(NOW);
  const day = new Date(Date.parse(week.start) + 2 * DAY);
  const everywhere = [guild(), guild(), guild(), guild()];
  const lonely = guild();
  await plays.insertMany([
    ...everywhere.map((guildId, index) => ({ guildId, day, trackKey: "band|everywhere", displayTitle: "Band - Everywhere", count: 5 + index, lastPlayedAt: day })),
    // One server playing a song all week long must not show up.
    { guildId: lonely, day, trackKey: "solo|only here", displayTitle: "Solo - Only Here", count: 900, lastPlayedAt: day },
    // Last week's plays sit outside the chart week.
    ...everywhere.map((guildId) => ({ guildId, day: new Date(Date.parse(week.end) + DAY), trackKey: "later|song", displayTitle: "Later - Song", count: 50, lastPlayedAt: day })),
  ]);
  const chart = await weeklyChart(database, { now: NOW, cacheMs: 0, coverFor: async () => null });
  assert.deepEqual(chart.entries.map((entry) => [entry.displayTitle, entry.plays, entry.servers, entry.movement]), [["Band - Everywhere", 26, 4, "new"]]);
  const text = JSON.stringify(chart);
  for (const guildId of [...everywhere, lonely]) assert.ok(!text.includes(guildId), "no server ID in the answer");
  assert.ok(!text.includes("Only Here"), "the song of one server is not there");
});
