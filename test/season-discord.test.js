import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The seasonal decoration in Discord (#426), each season with a made-up date:
// the panel's line and colour, the voice channel status, the bot's status
// and the New Year greeting.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-season-discord-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const look = await import("../src/bot/season-look.js");
const greeting = await import("../src/bot/season-greeting.js");
const { seasonForServer } = await import("../src/lib/seasons.js");
const { buildNowPlayingPanel } = await import("../src/bot/now-playing/now-playing-panel.js");
const { renderVoiceStatusTemplate, VOICE_STATUS_PLACEHOLDERS } = await import("../src/lib/voice-status-template.js");
const { setOwnerSettingsForTests } = await import("../src/lib/owner-settings-cache.js");

const GUILD = "123456789012345678";
const de = (german) => german;
const en = (_german, english) => english;
const at = (iso, options = {}) => seasonForServer({ now: new Date(iso), guildId: GUILD, ...options });

function panelInput(overrides = {}) {
  return {
    t: de,
    applicationId: null,
    workerName: "OmniFM 1",
    planTier: "pro",
    station: { name: "Groove Salad", key: "groove-salad", genre: "Ambient", tier: "free", color: 0x123456 },
    track: { hasTrack: true, headline: "Cafe del Mar", artist: "Energy 52", sourceLabel: "ICY" },
    playback: { phase: "playing", paused: false, listeners: 5, bitrate: "128k", volume: 80, channelId: "223456789012345678" },
    notices: {},
    ...overrides,
  };
}

function panelTexts(payload) {
  const out = [];
  const walk = (node) => {
    if (!node || typeof node !== "object") return;
    if (node.type === 10) out.push(node.content);
    for (const child of node.components || []) walk(child);
  };
  walk(payload.components[0].toJSON());
  return out.join("\n");
}

test("the panel's line and colour for every season", () => {
  const cases = [
    ["2026-03-29T12:00:00Z", "🌷 **Bald ist Ostern**", look.SEASON_COLORS.easter],
    ["2026-04-05T12:00:00Z", "🥚 **Frohe Ostern** 🌷", look.SEASON_COLORS.easter],
    ["2026-10-27T12:00:00Z", "🕸️ **Bald ist Halloween** 🕷️", look.SEASON_COLORS.halloween],
    ["2026-10-31T12:00:00Z", "🎃 **Happy Halloween!** 🕷️", look.SEASON_COLORS.halloween],
    ["2026-12-06T12:00:00Z", "🕯️🕯️⚪⚪ **2. Advent**", look.SEASON_COLORS.advent],
    ["2026-12-24T12:00:00Z", "🎄 **Frohe Weihnachten** ❄️", look.SEASON_COLORS.christmas],
    ["2026-12-28T12:00:00Z", "❄️ ❄️ ❄️", look.SEASON_COLORS.winter],
    ["2027-01-01T12:00:00Z", "🥂 **Frohes neues Jahr 2027!** 🎆", look.SEASON_COLORS.newyear],
  ];
  for (const [iso, line, color] of cases) {
    const result = look.seasonPanelLook(at(iso), { t: de });
    assert.deepEqual([result.line, result.color], [line, color], iso);
  }
  assert.equal(look.seasonPanelLook(at("2026-12-20T12:00:00Z"), { t: en }).line, "🕯️🕯️🕯️🕯️ **Advent, week 4**");
  assert.equal(look.seasonPanelLook(null, { t: de }), null);
});

test("New Year's Eve counts down with a Discord timestamp to the server's midnight", () => {
  const now = new Date("2026-12-31T20:00:00Z");
  const vienna = look.seasonPanelLook(at(now.toISOString()), { t: de, nowMs: now.getTime() });
  const midnight = Date.parse("2026-12-31T23:00:00Z") / 1000;
  assert.equal(vienna.line, `🎆 **2027 beginnt <t:${midnight}:R>**`);
  const newYork = look.seasonPanelLook(at(now.toISOString(), { timeZone: "America/New_York" }), { t: en, nowMs: now.getTime() });
  assert.equal(newYork.line, `🎆 **2027 starts <t:${Date.parse("2027-01-01T05:00:00Z") / 1000}:R>**`);

  const noCountdown = look.seasonPanelLook(at(now.toISOString(), { server: { parts: { countdown: false } } }), { t: de, nowMs: now.getTime() });
  assert.deepEqual(noCountdown, { color: look.SEASON_COLORS.newyear, line: null });
});

test("the panel: season line on top and season colour, the server's own colour first, switched off like today", () => {
  const advent = at("2026-12-06T12:00:00Z");
  const payload = buildNowPlayingPanel(panelInput({ season: advent }));
  const json = payload.components[0].toJSON();
  assert.equal(json.accent_color, look.SEASON_COLORS.advent);
  assert.ok(panelTexts(payload).startsWith("🕯️🕯️⚪⚪ **2. Advent**"), panelTexts(payload).slice(0, 80));

  const ownColour = buildNowPlayingPanel(panelInput({ season: advent, design: { accentColor: 0xFF00AA } }));
  assert.equal(ownColour.components[0].toJSON().accent_color, 0xFF00AA, "the panel designer's colour wins");

  const off = buildNowPlayingPanel(panelInput({ season: at("2026-12-06T12:00:00Z", { server: { parts: { panel: false } } }) }));
  const today = buildNowPlayingPanel(panelInput());
  assert.deepEqual(off.components[0].toJSON(), today.components[0].toJSON(), "panel part off: exactly today's panel");
  assert.equal(today.components[0].toJSON().accent_color, 0x123456);
});

test("the signature changes with a new candle and at midnight, not with the countdown's seconds", () => {
  const first = look.seasonSignature(at("2026-12-06T12:00:00Z"));
  assert.equal(look.seasonSignature(at("2026-12-06T20:00:00Z")), first);
  assert.notEqual(look.seasonSignature(at("2026-12-13T12:00:00Z")), first);
  assert.equal(look.seasonSignature(at("2026-12-31T20:00:00Z")), look.seasonSignature(at("2026-12-31T22:30:00Z")));
  assert.notEqual(look.seasonSignature(at("2026-12-31T22:30:00Z")), look.seasonSignature(at("2026-12-31T23:30:00Z")));
  assert.equal(look.seasonSignature(null), "");
});

test("the voice channel status: the season's emoji in front, or where {season} stands", () => {
  assert.ok(VOICE_STATUS_PLACEHOLDERS.includes("season"));
  const values = { station: "Groove Salad", season: look.seasonVoiceEmoji(at("2026-12-24T12:00:00Z")) };
  assert.equal(renderVoiceStatusTemplate("", values), "🎄 🔊 | 24/7 Groove Salad");
  assert.equal(renderVoiceStatusTemplate("{station} {season}", values), "Groove Salad 🎄");
  assert.equal(renderVoiceStatusTemplate("", { station: "Groove Salad" }), "🔊 | 24/7 Groove Salad", "outside a season: as today");
  assert.equal(renderVoiceStatusTemplate("{station}[ · {season}]", { station: "Groove Salad" }), "Groove Salad");
  assert.equal(look.seasonVoiceEmoji(at("2026-12-24T12:00:00Z", { server: { parts: { voiceStatus: false } } })), "");
  assert.equal(look.seasonVoiceEmoji(at("2026-12-31T20:00:00Z")), "🎆");
  assert.equal(look.seasonVoiceEmoji(at("2026-10-31T20:00:00Z")), "🎃");
  assert.equal(look.seasonVoiceEmoji(at("2026-10-27T20:00:00Z")), "🕸️");
});

test("the bot's status: the season in front, the owner's main switch only", () => {
  const activity = { type: 2, name: "OmniFM radio | 3 listeners" };
  setOwnerSettingsForTests({});
  assert.equal(look.withSeasonPresence(activity, look.globalSeason(new Date("2026-12-24T12:00:00Z"))).name, "🎄 Merry Christmas · OmniFM radio | 3 listeners");
  assert.equal(look.withSeasonPresence(activity, look.globalSeason(new Date("2026-09-28T12:00:00Z"))), activity);
  assert.equal(look.withSeasonPresence(activity, look.globalSeason(new Date("2026-10-31T12:00:00Z"))).name, "🎃 Happy Halloween · OmniFM radio | 3 listeners");
  setOwnerSettingsForTests({ seasons: { enabled: { christmas: false }, test: { preview: "advent-2", guildIds: [GUILD] } } });
  assert.equal(look.globalSeason(new Date("2026-12-24T12:00:00Z")), null, "switched off for everybody; the test mode never reaches the status");
  assert.equal(look.serverSeason(GUILD, {}, new Date("2026-09-28T12:00:00Z")).candles, 2, "the test mode reaches the server");
  assert.equal(look.serverSeason("999999999999999999", {}, new Date("2026-12-24T12:00:00Z")), null);
  const long = look.withSeasonPresence({ name: "x".repeat(130) }, look.globalSeason(new Date("2026-12-06T12:00:00Z")));
  assert.equal(long.name.length, 120);
  setOwnerSettingsForTests({});
});

function fakeDb() {
  const ids = new Set();
  return {
    ids,
    collection: () => ({
      insertOne: async (doc) => {
        if (ids.has(doc._id)) throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
        ids.add(doc._id);
      },
    }),
  };
}

function fakeChannel(id) {
  const sent = [];
  return { id, sent, send: async (payload) => { sent.push(payload); return { id: `m${sent.length}` }; } };
}

test("the New Year greeting: once per server and year, only in the panel's channel, only while OmniFM plays", async () => {
  const midnight = new Date("2026-12-31T23:03:00Z"); // 00:03 in Vienna
  const season = at(midnight.toISOString());
  const panel = fakeChannel("223456789012345678");
  const other = fakeChannel("323456789012345678");
  const state = { currentStationKey: "groove-salad", nowPlayingChannelId: panel.id };
  const runtime = { guildState: new Map([[GUILD, state]]), resolveGuildLanguage: () => "de" };
  const db = fakeDb();
  const send = (channel, options = {}) => greeting.sendNewYearGreeting(runtime, {
    guildId: GUILD, channel, season, now: midnight, db, isPlaying: () => true, ...options,
  });

  assert.equal(await send(other), false, "never into another channel");
  assert.equal(await send(panel, { isPlaying: () => false }), false, "not while OmniFM is silent");
  assert.equal(await send(panel), true);
  assert.equal(await send(panel), false, "only once");
  assert.equal(await greeting.sendNewYearGreeting({ guildState: new Map([[GUILD, state]]) }, {
    guildId: GUILD, channel: panel, season, now: midnight, db, isPlaying: () => true,
  }), false, "a second bot on the same server stays quiet");
  assert.equal(panel.sent.length, 1);
  assert.equal(other.sent.length, 0);
  const content = JSON.stringify(panel.sent[0].components);
  assert.match(content, /Frohes neues Jahr 2027!/);
  assert.deepEqual(panel.sent[0].allowedMentions, { parse: [] });

  const late = new Date("2027-01-01T09:00:00Z");
  assert.equal(greeting.isGreetingTime(at(late.toISOString()), late), false, "a bot that starts at ten stays quiet");
  assert.equal(greeting.isGreetingTime(at(midnight.toISOString(), { server: { parts: { newYearGreeting: false } } }), midnight), false);
  assert.equal(greeting.isGreetingTime(at("2026-12-31T20:00:00Z"), new Date("2026-12-31T20:00:00Z")), false, "not during the countdown");
  assert.equal(await greeting.claimGreeting(null, { guildId: GUILD, year: 2027 }), false, "without MongoDB nobody greets");

  const preview = at("2026-09-28T12:00:00Z", { owner: { test: { preview: "newyear-greeting", guildIds: [GUILD] } } });
  assert.equal(greeting.isGreetingTime(preview, new Date("2026-09-28T12:00:00Z")), true, "the owner's test greets at once");
  assert.equal(await send(panel, { season: preview, now: new Date("2026-09-28T12:00:00Z") }), true);
  assert.ok(db.ids.has(`newyear:${GUILD}:2027:preview`), "a test never uses up the real greeting");
});
