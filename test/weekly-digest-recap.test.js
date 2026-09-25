import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageFlags } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-weekly-recap-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
process.env.DB_NAME = `omnifm_weekly_recap_${process.pid}_${Date.now()}`;

const { buildWeeklyDigestReport, weeklyDigestRange, localDateKey, percentChange } = await import("../src/lib/weekly-digest-report.js");
const { buildWeeklyDigestPayload, formatDigestDuration, formatDigestChange } = await import("../src/bot/weekly-digest-panel.js");
const { sendWeeklyDigest } = await import("../src/services/weekly-digest-service.js");
const songPlays = await import("../src/song-plays-store.js");
const ui = await import("../src/discord/ui/index.js");

const de = (german) => german;
const HOUR = 3_600_000;
// Sent on Monday 29 Sep 2026, 09:00 local time: the week is Mon 22 – Sun 28.
const NOW = new Date(2026, 8, 29, 9, 0, 0);
const day = (offset) => new Date(2026, 8, 29 + offset, 12, 0, 0);
const key = (offset) => localDateKey(day(offset).getTime());

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === 10) out.push(json.content);
  for (const child of json.components || []) texts(child, out);
  if (json.accessory) texts(json.accessory, out);
  return out;
}

function nodes(node, type, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === type) out.push(json);
  for (const child of json.components || []) nodes(child, type, out);
  if (json.accessory) nodes(json.accessory, type, out);
  return out;
}

const allText = (payload) => payload.components.flatMap((component) => texts(component)).join("\n");

const STATIONS = {
  groovesalad: { name: "Groove Salad", logo: "https://api.somafm.com/logos/512/groovesalad512.png", color: "#14B8A6" },
  techno: { name: "Techno Bunker", color: "#EF4444" },
};

function normalWeekInput() {
  return {
    now: NOW,
    dailyStats: [
      { date: key(-1), totalListeningMs: 5 * HOUR, totalSessions: 4, totalStarts: 5, peakListeners: 9 },
      { date: key(-3), totalListeningMs: 3 * HOUR, totalSessions: 2, totalStarts: 2, peakListeners: 6 },
      { date: key(0), totalListeningMs: 9 * HOUR, totalSessions: 9, totalStarts: 9, peakListeners: 30 }, // today: not in the week
      { date: key(-9), totalListeningMs: 4 * HOUR, totalSessions: 3, totalStarts: 3, peakListeners: 10 }, // the week before
    ],
    sessions: [
      { stationKey: "groovesalad", startedAt: day(-1).toISOString(), humanListeningMs: 4 * HOUR, peakListeners: 9 },
      { stationKey: "techno", startedAt: day(-3).toISOString(), humanListeningMs: 3 * HOUR, peakListeners: 6 },
      { stationKey: "groovesalad", startedAt: day(-2).toISOString(), humanListeningMs: HOUR, peakListeners: 2 },
      { stationKey: "custom:x", stationName: "Vereinsradio", startedAt: day(-4).toISOString(), humanListeningMs: 10 * 60_000 },
      { stationKey: "techno", startedAt: day(-10).toISOString(), humanListeningMs: 9 * HOUR }, // the week before
    ],
    snapshots: [
      { timestamp: new Date(2026, 8, 26, 21, 0).toISOString(), listeners: 12 },
      { timestamp: new Date(2026, 8, 27, 20, 0).toISOString(), listeners: 8 },
      { timestamp: new Date(2026, 8, 29, 8, 0).toISOString(), listeners: 40 }, // today
    ],
    songPlays: [
      { displayTitle: "Energy 52 - Cafe del Mar", count: 4 },
      { displayTitle: "Bent - Magic Love", count: 2 },
      { displayTitle: "Once Only", count: 1 },
    ],
    stations: STATIONS,
    allTime: { totalListeningMs: 120 * HOUR, totalSessions: 300 },
  };
}

test("the week is the seven full days before today, the week before is compared", () => {
  const range = weeklyDigestRange(NOW);
  assert.equal(new Date(range.startMs).toString(), new Date(2026, 8, 22, 0, 0, 0).toString());
  assert.equal(new Date(range.endMs).toString(), new Date(2026, 8, 29, 0, 0, 0).toString());
  assert.equal(new Date(range.previousStartMs).toString(), new Date(2026, 8, 15, 0, 0, 0).toString());
  // Across the change to winter time the days stay whole.
  const autumn = weeklyDigestRange(new Date(2026, 9, 26, 9, 0, 0));
  assert.equal(new Date(autumn.startMs).getHours(), 0);
  assert.equal(new Date(autumn.startMs).getDate(), 19);
});

test("a normal week: totals, comparison, busiest moment, top stations and songs", () => {
  const report = buildWeeklyDigestReport(normalWeekInput());
  assert.equal(report.firstWeek, false);
  assert.equal(report.empty, false);
  assert.deepEqual(report.week, { listeningMs: 8 * HOUR, sessions: 6, starts: 7, peakListeners: 12, activeDays: 2 });
  assert.equal(report.changes.listeningMs, 100, "8 h against 4 h");
  assert.equal(report.changes.peakListeners, 20, "12 against 10");
  assert.deepEqual(report.peakTime, { atMs: new Date(2026, 8, 26, 21, 0).getTime(), listeners: 12 });
  assert.deepEqual(report.topStations.map((station) => [station.name, station.listeningMs / HOUR]), [
    ["Groove Salad", 5], ["Techno Bunker", 3], ["Vereinsradio", 1 / 6],
  ]);
  assert.equal(report.topStations[0].logoUrl, STATIONS.groovesalad.logo);
  assert.equal(report.topStations[0].color, 0x14B8A6);
  assert.deepEqual(report.topSongs.map((song) => song.displayTitle), ["Energy 52 - Cafe del Mar", "Bent - Magic Love"], "one play is no top song");
  assert.equal(percentChange(5, 0), null);
});

test("the recap message shows tiles, the comparison, logos and the team numbers", () => {
  const payload = buildWeeklyDigestPayload({
    t: de,
    guildName: "Club",
    report: buildWeeklyDigestReport(normalWeekInput()),
    urls: { dashboard: "https://omnifm.xyz/?page=dashboard" },
  });
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  const body = allText(payload);
  assert.match(body, /## .* Wochenrückblick/);
  assert.match(body, /Club · <t:\d+:d> – <t:\d+:d>/);
  assert.match(body, /### 🎧 8 h\n-# Hörzeit · ▲ 100 % zur Vorwoche/);
  assert.match(body, /### 👥 12\n-# Meiste Hörer gleichzeitig · ▲ 20 % zur Vorwoche/);
  assert.match(body, /### ⏰ <t:\d+:f>\n-# Spitzenzeit mit 12 Hörern/);
  assert.match(body, /### 📅 2 \/ 7/);
  assert.match(body, /\*\*1\. Groove Salad\*\*\n-# 5 h Hörzeit/);
  assert.match(body, /1\. Energy 52 - Cafe del Mar \(4×\)\n2\. Bent - Magic Love \(2×\)/);
  assert.match(body, /Sessions 6 · Starts 7 · Seit Beginn 120 h/);
  assert.equal(nodes(payload.components[0], 11)[0].media.url, STATIONS.groovesalad.logo, "the logo of the top station");
  assert.equal(payload.components[0].toJSON().accent_color, 0x14B8A6, "the accent of the week's favourite");
  assert.equal(nodes(payload.components[0], 2)[0].url, "https://omnifm.xyz/?page=dashboard");
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);
});

test("the public recap leaves out the technical numbers and the dashboard", () => {
  const payload = buildWeeklyDigestPayload({
    t: de,
    guildName: "Club",
    report: buildWeeklyDigestReport(normalWeekInput()),
    audience: "public",
    urls: { dashboard: "https://omnifm.xyz/?page=dashboard" },
  });
  const body = allText(payload);
  assert.match(body, /Hörzeit/);
  assert.doesNotMatch(body, /Sessions|Starts|Seit Beginn/);
  assert.equal(nodes(payload.components[0], 2).length, 0);
});

test("an empty week says so in one friendly line", () => {
  const report = buildWeeklyDigestReport({ now: NOW, dailyStats: [{ date: key(-20), totalListeningMs: HOUR }] });
  assert.equal(report.empty, true);
  assert.equal(report.firstWeek, false);
  const body = allText(buildWeeklyDigestPayload({ t: de, guildName: "Club", report }));
  assert.match(body, /Diese Woche lief auf \*\*Club\*\* kein Radio/);
  assert.doesNotMatch(body, /###/);
});

test("the first week has no comparison and says why", () => {
  const input = normalWeekInput();
  input.dailyStats = input.dailyStats.filter((row) => row.date >= key(-7));
  const report = buildWeeklyDigestReport(input);
  assert.equal(report.firstWeek, true);
  assert.equal(report.previousWeek, null);
  assert.deepEqual(report.changes, { listeningMs: null, peakListeners: null, sessions: null });
  const body = allText(buildWeeklyDigestPayload({ t: de, guildName: "Club", report }));
  assert.match(body, /### 🎧 8 h\n-# Hörzeit\n/);
  assert.doesNotMatch(body, /[▲▼±] \d+ %/);
  assert.match(body, /Erste Woche mit OmniFM/);
});

test("durations and changes read naturally", () => {
  assert.equal(formatDigestDuration(0), "0 min");
  assert.equal(formatDigestDuration(45 * 60_000), "45 min");
  assert.equal(formatDigestDuration(12.5 * HOUR), "12 h 30 min");
  assert.equal(formatDigestChange(-5, de), "▼ 5 % zur Vorwoche");
  assert.equal(formatDigestChange(0, de), "± 0 % zur Vorwoche");
  assert.equal(formatDigestChange(null, de), "");
});

function fakeRuntime(sent) {
  const channel = { name: "radio", send: async (payload) => { sent.push(payload); } };
  const guild = { name: "Club", channels: { cache: new Map([["523456789012345678", channel]]) } };
  return { client: { guilds: { cache: new Map([["123456789012345678", guild]]) }, application: { id: null } } };
}

test("a public digest skips an empty week, the team still gets it", async () => {
  const sent = [];
  const runtime = fakeRuntime(sent);
  const config = { enabled: true, channelId: "523456789012345678", language: "de" };
  assert.deepEqual(await sendWeeklyDigest(runtime, "123456789012345678", { ...config, audience: "public" }, { now: NOW }), { sent: false, skipped: "empty" });
  assert.equal(sent.length, 0);
  assert.deepEqual(await sendWeeklyDigest(runtime, "123456789012345678", config, { now: NOW }), { sent: true });
  assert.match(allText(sent[0]), /Diese Woche lief auf \*\*Club\*\* kein Radio/);
});

test("song plays are counted per server and day in MongoDB", async (t) => {
  if (!String(process.env.MONGO_URL || "").trim()) {
    t.skip("MongoDB is not configured for this test run");
    return;
  }
  const dbModule = await import("../src/lib/db.js");
  await dbModule.connect();
  const database = dbModule.getDb();
  t.after(async () => {
    await database.dropDatabase().catch(() => null);
    await dbModule.close();
  });
  const guildId = "123456789012345678";
  const monday = new Date(Date.UTC(2026, 8, 22, 12));
  await Promise.all([
    songPlays.recordSongPlay(guildId, { artist: "Energy 52", title: "Cafe del Mar" }, { now: monday }),
    songPlays.recordSongPlay(guildId, { artist: "ENERGY 52", title: "Café del Mar!" }, { now: monday }),
  ]);
  await songPlays.recordSongPlay(guildId, { displayTitle: "Energy 52 - Cafe del Mar", artist: "Energy 52", title: "Cafe del Mar" }, { now: new Date(Date.UTC(2026, 8, 24, 12)) });
  await songPlays.recordSongPlay(guildId, { displayTitle: "Bent - Magic Love" }, { now: monday });
  await songPlays.recordSongPlay("223456789012345678", { displayTitle: "Other Server" }, { now: monday });
  await songPlays.recordSongPlay(guildId, { displayTitle: "Too Old" }, { now: new Date(Date.UTC(2026, 8, 10, 12)) });

  const top = await songPlays.getTopSongPlays(guildId, { sinceMs: Date.UTC(2026, 8, 22), untilMs: Date.UTC(2026, 8, 29) });
  assert.deepEqual(top, [
    { displayTitle: "Energy 52 - Cafe del Mar", count: 3 },
    { displayTitle: "Bent - Magic Love", count: 1 },
  ]);
  const indexes = await database.collection(songPlays.SONG_PLAYS_COLLECTION).indexes();
  assert.equal(indexes.find((index) => index.name === "day_ttl")?.expireAfterSeconds, 21 * 24 * 60 * 60, "documents expire after 21 days");
});
