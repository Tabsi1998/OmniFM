import test from "node:test";
import assert from "node:assert/strict";
import { MongoClient } from "mongodb";
import { ADVERT_TITLE_REGEX, NOT_ADVERT_FILTER, isAdvertTitle, withoutAdvertTrack } from "../src/lib/advert-titles.js";
import { CHART_SIZE, chartWeek, rankChart } from "../src/lib/charts.js";
import { buildYearReview } from "../src/lib/year-review.js";
import { recordSongPlay } from "../src/song-plays-store.js";
import { appendSongHistory } from "../src/song-history-store.js";
import { weeklyChart } from "../src/services/charts.js";
import { nowPlayingTrackFields } from "../src/bot/now-playing/track-fields.js";
import fs from "node:fs";

// #548: the charts of week 45 had two adverts on top. An ad break's spot is
// no song: never counted, and the ones counted before never show.
const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());
const DAY = 86_400_000;
const NOW = Date.parse("2026-11-11T12:00:00.000Z"); // Wednesday of week 46

const ADVERTS = [
  "www.lutz.at - Ein bisschen Verbraucherinformationen ...",
  "www.mazda.at - Ein bisschen Verbraucherinformationen ...",
  { artist: "mazda.at", title: "Jetzt Probe fahren" },
  { artist: "XXXLutz", title: "Mehr unter lutz.at/angebote" },
  { artist: "Werbung", title: "Möbel Ludwig" },
  { artist: "Radio Tirol", title: "Advertisement" },
  "Hofer - https://www.hofer.at",
  "Werbung",
  "Radio Tirol - Werbepause",
  "Spar - Verbraucherinformation",
  "Advertisement - Coca-Cola",
  "Radio Tirol - Werbung",
  "marke.co.uk - Jetzt entdecken",
  "Mehr Infos: marke.at",
  "laut.fm - Jingle",
];

// Real songs and artists with dots, signs and lookalike words: none may fall out.
const SONGS = [
  "SUMMER CEM & BILLA JOE - KILLY MANJARO",
  "will.i.am & Britney Spears - Scream & Shout",
  "Inna - Mr. Saxobeat",
  "t.A.T.u. - All The Things She Said",
  "B.o.B - Airplanes",
  "Dr. Alban - It's My Life",
  "Ke$ha - TiK ToK",
  "P!nk - So What",
  "Panic! At The Disco - High Hopes",
  "a-ha - Take On Me",
  "Die Ärzte - Westerland",
  "Seiler und Speer - Ham kummst",
  "Wanda - Bologna",
  "Bewerbung - Kraftklub Cover",
  "Prozzäk - www.nevergetoveryou",
  "Die Werbung ist vorbei - Song",
  "Commercial - Song X",
  "Wir sind Helden - Guten Tag (Werbung)",
  "Pharrell Williams - Happy (From Despicable Me 2)",
  { artist: "R.E.M.", title: "Losing My Religion" },
  { artist: "Will Smith", title: "Men In Black" },
  { artist: "Band", title: "Commercial Break - Remastered", displayTitle: "Band - Commercial Break - Remastered" },
  { artist: "Band", title: "Werbung - Live", streamTitle: "Band - Werbung - Live" },
];

test("the adverts of week 45 and their kind are recognised", () => {
  for (const advert of ADVERTS) assert.equal(isAdvertTitle(advert), true, JSON.stringify(advert));
});

test("real songs, also with dots and signs, are no adverts", () => {
  for (const song of SONGS) assert.equal(isAdvertTitle(song), false, JSON.stringify(song));
  assert.equal(isAdvertTitle(""), false);
  assert.equal(isAdvertTitle({}), false);
});

test("now playing: an advert empties every track field, a song stays as it is", () => {
  const song = { artist: "Wanda", title: "Bologna", streamTitle: "Wanda - Bologna", displayTitle: "Wanda - Bologna" };
  assert.equal(withoutAdvertTrack(song), song);
  assert.deepEqual(
    withoutAdvertTrack({ artist: "XXXLutz", title: "Mehr unter lutz.at/angebote", streamTitle: null, displayTitle: "XXXLutz - Mehr unter lutz.at/angebote", source: "icy" }),
    { artist: null, title: null, streamTitle: null, displayTitle: null, source: "icy" },
  );
});

test("the song fields of a now-playing update: a spot is dropped, a song stays, the title is built from artist and title", () => {
  const runtime = { normalizeNowPlayingValue: (value, station) => {
    const text = String(value || "").trim();
    return text && text.toLowerCase() !== String(station?.name || "").toLowerCase() ? text : null;
  } };
  const station = { name: "Life Radio Tirol" };
  assert.deepEqual(nowPlayingTrackFields(runtime, station, { artist: "Wanda", title: "Bologna" }),
    { artist: "Wanda", title: "Bologna", streamTitle: null, displayTitle: "Wanda - Bologna" });
  assert.deepEqual(nowPlayingTrackFields(runtime, station, { streamTitle: "Wanda - Bologna" }),
    { artist: null, title: null, streamTitle: "Wanda - Bologna", displayTitle: "Wanda - Bologna" });
  assert.deepEqual(nowPlayingTrackFields(runtime, station, { streamTitle: "Life Radio Tirol" }),
    { artist: null, title: null, streamTitle: null, displayTitle: null });
  assert.deepEqual(nowPlayingTrackFields(runtime, station, { artist: "www.lutz.at", title: "Ein bisschen Verbraucherinformationen ...", streamTitle: "www.lutz.at - Ein bisschen Verbraucherinformationen ..." }),
    { artist: null, title: null, streamTitle: null, displayTitle: null });
});

test("both now-playing paths (poll and start) take their song fields from nowPlayingTrackFields", () => {
  for (const file of ["src/bot/now-playing/now-playing-methods.js", "src/bot/runtime-stream-play.js"]) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    assert.match(source, /nowPlayingTrackFields\((this|runtime), station, (snapshot|meta)\)/, file);
    assert.doesNotMatch(source, /normalizeNowPlayingValue\((snapshot|meta)\.(artist|title)\b/, `${file} builds no song field itself`);
  }
});

test("an advert is neither counted nor kept in the song history", async () => {
  const spot = { displayTitle: "www.lutz.at - Ein bisschen Verbraucherinformationen ..." };
  assert.deepEqual(await recordSongPlay("123456789012345678", spot), { ok: false, reason: "advert" });
  assert.deepEqual(appendSongHistory("123456789012345678", spot), { saved: false, reason: "advert" });
  assert.deepEqual(appendSongHistory("123456789012345678", { streamTitle: "mazda.at - Jetzt Probe fahren" }), { saved: false, reason: "advert" });
});

test("the charts drop adverts counted before and stay full", () => {
  const rows = [
    { trackKey: "lutz", displayTitle: "www.lutz.at - Ein bisschen Verbraucherinformationen ...", plays: 10_376, servers: 12 },
    { trackKey: "mazda", displayTitle: "www.mazda.at - Ein bisschen Verbraucherinformationen ...", plays: 1_063, servers: 6 },
    ...Array.from({ length: CHART_SIZE }, (_, index) => ({ trackKey: `song${index}`, displayTitle: `Band ${index} - Song`, plays: 600 - index, servers: 3 })),
  ];
  const before = [{ trackKey: "lutz", displayTitle: "www.lutz.at - Ein bisschen Verbraucherinformationen ...", plays: 9_000, servers: 12 }];
  const chart = rankChart(rows, before);
  assert.equal(chart.length, CHART_SIZE);
  assert.deepEqual(chart.slice(0, 2).map((entry) => [entry.rank, entry.displayTitle]), [[1, "Band 0 - Song"], [2, "Band 1 - Song"]]);
  assert.ok(chart.every((entry) => !isAdvertTitle(entry.displayTitle)));
});

test("the year review drops adverts from months stored before", () => {
  const review = buildYearReview([{
    month: "2026-11",
    songs: [
      { trackKey: "lutz", title: "www.lutz.at - Ein bisschen Verbraucherinformationen ...", plays: 900 },
      { trackKey: "song", title: "Wanda - Bologna", plays: 12 },
    ],
  }], { year: 2026 });
  assert.deepEqual(review.topSongs, [{ title: "Wanda - Bologna", plays: 12 }]);
});

test("MongoDB: adverts already stored neither show in the charts nor push songs out", { skip: !hasMongoConfig }, async (t) => {
  const client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  const database = client.db(`omnifm_adverts_test_${process.pid}`);
  t.after(async () => {
    await database.dropDatabase().catch(() => null);
    await client.close();
  });
  const day = new Date(Date.parse(chartWeek(NOW).start) + 2 * DAY);
  const servers = ["300000000000000001", "300000000000000002", "300000000000000003"];
  const row = (guildId, trackKey, displayTitle, count) => ({ guildId, day, trackKey, displayTitle, count, lastPlayedAt: day });
  await database.collection("song_plays").insertMany([
    // Far more adverts than the chart has places, all played more than any song.
    ...servers.flatMap((guildId) => Array.from({ length: CHART_SIZE * 4 }, (_, index) => row(guildId, `ad${index}`, `www.shop${index}.at - Angebot der Woche`, 500))),
    ...servers.map((guildId) => row(guildId, "summer cem|killy manjaro", "SUMMER CEM & BILLA JOE - KILLY MANJARO", 171)),
    ...servers.map((guildId) => row(guildId, "wanda|bologna", "Wanda - Bologna", 20)),
  ]);
  const chart = await weeklyChart(database, { now: NOW, cacheMs: 0, coverFor: async () => null, catalog: {} });
  assert.deepEqual(chart.songs.map((entry) => [entry.rank, entry.displayTitle, entry.plays]), [
    [1, "SUMMER CEM & BILLA JOE - KILLY MANJARO", 513],
    [2, "Wanda - Bologna", 60],
  ]);
});

test("MongoDB: the weekly recap's top songs leave adverts out", async (t) => {
  if (!hasMongoConfig) {
    t.skip("MongoDB is not configured for this test run");
    return;
  }
  const dbModule = await import("../src/lib/db.js");
  const songPlays = await import("../src/song-plays-store.js");
  await dbModule.connect();
  const database = dbModule.getDb();
  t.after(async () => {
    await database.dropDatabase().catch(() => null);
    await dbModule.close();
  });
  const guildId = "123456789012345678";
  const day = new Date(Date.UTC(2026, 10, 3));
  await database.collection(songPlays.SONG_PLAYS_COLLECTION).insertMany([
    ...Array.from({ length: 40 }, (_, index) => ({ guildId, day, trackKey: `ad${index}`, displayTitle: `www.shop${index}.at - Angebot`, count: 99, lastPlayedAt: day })),
    { guildId, day, trackKey: "wanda|bologna", displayTitle: "Wanda - Bologna", count: 4, lastPlayedAt: day },
  ]);
  const top = await songPlays.getTopSongPlays(guildId, { sinceMs: Date.UTC(2026, 10, 2), untilMs: Date.UTC(2026, 10, 9), limit: 5 });
  assert.deepEqual(top, [{ displayTitle: "Wanda - Bologna", count: 4 }]);
});

test("MongoDB reads the advert pattern exactly like JavaScript (case, umlauts, endings)", { skip: !hasMongoConfig }, async (t) => {
  const client = new MongoClient(process.env.MONGO_URL);
  await client.connect();
  const database = client.db(`omnifm_adverts_regex_${process.pid}`);
  t.after(async () => {
    await database.dropDatabase().catch(() => null);
    await client.close();
  });
  const titles = [
    ...ADVERTS.filter((entry) => typeof entry === "string"),
    ...SONGS.filter((entry) => typeof entry === "string"),
    "MÖBELHAUS - VERBRAUCHERINFORMATIONEN",
    "Jetzt bei mazda.at.",
    "WWW.LUTZ.AT - Angebot",
    "Ärzte - Bewerbungsgespräch",
    "Werbungsfrei - Band",
    "Werbung – Ö3",
  ];
  await database.collection("titles").insertMany(titles.map((displayTitle) => ({ displayTitle })));
  const kept = (await database.collection("titles").find(NOT_ADVERT_FILTER).toArray()).map((row) => row.displayTitle).sort();
  const matched = (await database.collection("titles").find({ displayTitle: ADVERT_TITLE_REGEX }).toArray()).map((row) => row.displayTitle).sort();
  assert.deepEqual(kept, titles.filter((title) => !isAdvertTitle(title)).sort());
  assert.deepEqual(matched, titles.filter((title) => isAdvertTitle(title)).sort());
  assert.ok(matched.includes("MÖBELHAUS - VERBRAUCHERINFORMATIONEN") && matched.includes("Radio Tirol - Werbung") && matched.includes("Werbung – Ö3"));
  assert.ok(kept.includes("Die Werbung ist vorbei - Song"));
  assert.ok(kept.includes("Prozzäk - www.nevergetoveryou") && kept.includes("Ärzte - Bewerbungsgespräch") && kept.includes("Werbungsfrei - Band"));
});
