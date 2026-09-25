import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ChannelType } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-voice-status-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const template = await import("../src/lib/voice-status-template.js");
const { normalizeGuildSettings } = await import("../src/lib/guild-settings.js");
const { BotRuntime } = await import("../src/bot/runtime.js");

const { renderVoiceStatusTemplate: render } = template;
const SONG = { station: "Groove Salad", title: "Cafe del Mar", artist: "Energy 52", listeners: 5, genre: "Ambient", bot: "OmniFM 1" };

test("every placeholder is filled", () => {
  assert.equal(
    render("{emoji} {station} | {artist} - {title} | {listeners} | {bot}", SONG),
    "🌙 Groove Salad | Energy 52 - Cafe del Mar | 5 | OmniFM 1"
  );
  assert.equal(render("{STATION}", SONG), "Groove Salad", "names ignore case");
});

test("an empty template is the default, and the caller's default wins over the built-in one", () => {
  assert.equal(render("", SONG), "🔊 | 24/7 Groove Salad");
  assert.equal(render("   ", SONG, { fallbackTemplate: "📻 {station}" }), "📻 Groove Salad");
});

test("missing metadata disappears together with its separator", () => {
  const noSong = { station: "Groove Salad", genre: "Techno" };
  assert.equal(render("{emoji} {station} | {artist} - {title}", noSong), "🎛️ Groove Salad");
  assert.equal(render("{station} | {title} | {listeners} hören", { station: "S", listeners: 3 }), "S | 3 hören");
  assert.equal(render("{title} ({artist})", { title: "T" }), "T");
  assert.equal(render("Jetzt: {title}", { station: "S", title: "" }), "Jetzt");
  assert.equal(render("Jay-Z 24/7 {station}", { station: "S" }), "Jay-Z 24/7 S", "dashes and slashes inside words stay");
});

test("a part in square brackets shows only with all its values", () => {
  assert.equal(render("{station}[ · {listeners} hören]", SONG), "Groove Salad · 5 hören");
  assert.equal(render("{station}[ · {listeners} hören]", { ...SONG, listeners: 0 }), "Groove Salad", "0 listeners count as no value");
  assert.equal(render("[{artist} – ]{title}", { title: "Solo" }), "Solo");
});

test("nothing left means the default, not an empty status", () => {
  assert.equal(render("{artist} - {title}", { station: "Groove Salad" }), "🔊 | 24/7 Groove Salad");
});

test("the text is cut to the limit, emoji as whole characters", () => {
  const long = render("{title} {title} {title}", { title: "x".repeat(60) });
  assert.equal(Array.from(long).length, 100);
  assert.ok(long.endsWith("…"));
  assert.equal(render("🎵🎵🎵🎵", {}, { maxLength: 3 }), "🎵🎵…");
});

test("unknown placeholders are refused with their names and render as nothing", () => {
  assert.deepEqual(template.validateVoiceStatusTemplate("{station} {mood} {Mood} {x}"), {
    ok: false, template: "{station} {mood} {Mood} {x}", unknown: ["mood", "x"],
  });
  assert.equal(template.validateVoiceStatusTemplate("{emoji} {station}").ok, true);
  assert.equal(render("{station} {mood}", SONG), "Groove Salad");
});

test("templates are stored as one trimmed line, at most 120 characters", () => {
  assert.equal(template.normalizeVoiceStatusTemplate("  a\n\tb   c  "), "a b c");
  assert.equal(Array.from(template.normalizeVoiceStatusTemplate("y".repeat(300))).length, 120);
  assert.equal(normalizeGuildSettings({ voiceStatusTemplate: "  {station}  " }).voiceStatusTemplate, "{station}");
  assert.equal("voiceStatusTemplate" in normalizeGuildSettings({ voiceStatusTemplate: "   " }), false);
});

test("genres get fitting emoji, the rest a radio", () => {
  assert.equal(template.emojiForGenre("Hip Hop & Rap"), "🎤");
  assert.equal(template.emojiForGenre("Hardstyle & Hardcore"), "🔥");
  assert.equal(template.emojiForGenre("Pop & Charts"), "🎵");
  assert.equal(template.emojiForGenre("Weltraum-Hörspiel"), "📻");
  assert.equal(template.voiceStatusTemplateIsLive("{station} {title}"), true);
  assert.equal(template.voiceStatusTemplateIsLive("{emoji} {station}"), false);
});

// ---- the bot: the server's template, the song on air, only changes go out ----

function buildWorker({ settings = {}, meta = {} } = {}) {
  const channelId = "123456789012345678";
  const puts = [];
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { name: "OmniFM 1" };
  runtime.client = {
    guilds: {
      cache: new Map([["guild-1", {
        channels: { cache: new Map([[channelId, { id: channelId, type: ChannelType.GuildVoice }]]), fetch: async () => null },
      }]]),
    },
  };
  runtime.rest = { put: async (route, { body }) => { puts.push(body.status); }, delete: async () => {} };
  runtime.loadGuildSettingsCached = async () => settings;
  runtime.getResolvedCurrentStation = () => ({ station: { name: "Groove Salad", genre: "Ambient" } });
  runtime.getCurrentListenerCount = () => 4;
  const state = {
    connection: { joinConfig: { channelId } },
    lastChannelId: channelId,
    currentStationKey: "groovesalad",
    currentStationName: "Groove Salad",
    currentMeta: meta,
  };
  runtime.guildState = new Map([["guild-1", state]]);
  return { runtime, state, puts };
}

test("the bot sets the server's template with the song on air and follows a new song", async () => {
  const { runtime, state, puts } = buildWorker({
    settings: { voiceStatusTemplate: "{emoji} {station}[ · {artist} - {title}][ · {listeners} hören]" },
    meta: { artist: "Energy 52", title: "Cafe del Mar" },
  });
  await runtime.syncVoiceChannelStatus("guild-1", "Groove Salad");
  assert.deepEqual(puts, ["🌙 Groove Salad · Energy 52 - Cafe del Mar · 4 hören"]);

  await runtime.syncVoiceChannelStatus("guild-1", "Groove Salad");
  assert.equal(puts.length, 1, "the same text does not go out twice");

  state.currentMeta = { artist: "Bent", title: "Magic Love" };
  await runtime.syncVoiceChannelStatus("guild-1", "Groove Salad");
  assert.equal(puts.at(-1), "🌙 Groove Salad · Bent - Magic Love · 4 hören");
});

test("without a template of its own the server keeps today's text", async () => {
  const { runtime, puts } = buildWorker({ meta: { artist: "Energy 52", title: "Cafe del Mar" } });
  await runtime.syncVoiceChannelStatus("guild-1", "Groove Salad");
  assert.deepEqual(puts, [BotRuntime.prototype.renderVoiceStatusText.call(runtime, "Groove Salad")]);
  assert.match(puts[0], /Groove Salad/);
});
