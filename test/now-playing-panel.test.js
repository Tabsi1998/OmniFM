import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ButtonStyle, MessageFlags } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-np-panel-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const { BotRuntime } = await import("../src/bot/runtime.js");
const { buildNowPlayingPanel } = await import("../src/bot/now-playing/now-playing-panel.js");
const ui = await import("../src/discord/ui/index.js");

const t = (de) => de;

function input(overrides = {}) {
  return {
    t,
    applicationId: "app-worker-1",
    workerName: "OmniFM 1",
    planTier: "pro",
    station: { name: "Groove Salad", key: "groove-salad", genre: "Ambient", tier: "free" },
    track: {
      hasTrack: true,
      headline: "Cafe del Mar",
      artist: "Energy 52",
      artworkUrl: "https://is1.example/cover.jpg",
      sourceNote: "",
      sourceLabel: "ICY",
      metadataHint: "",
    },
    playback: { phase: "playing", paused: false, listeners: 5, bitrate: "128k", volume: 80, channelId: "123456789012345678" },
    notices: {},
    recent: ["A - One", "B - Two", "C - Three", "D - Four"],
    searchQuery: "Energy 52 Cafe del Mar",
    pollSeconds: 15,
    ...overrides,
  };
}

function tree(payload) {
  return payload.components[0].toJSON();
}

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  if (node.type === 10) out.push(node.content);
  for (const child of node.components || []) texts(child, out);
  if (node.accessory) texts(node.accessory, out);
  return out;
}

function buttons(node) {
  return (node.components || []).filter((component) => component.type === 1).flatMap((row) => row.components);
}

test("while playing: cover, title, artist, station line, last songs, controls and search links", () => {
  const payload = buildNowPlayingPanel(input());
  assert.equal(payload.flags, MessageFlags.IsComponentsV2, "public in the channel");
  const box = tree(payload);
  assert.equal(box.accent_color, 0xFF6B00, "the plan colour (Pro orange)");
  const head = box.components[0];
  assert.equal(head.type, 9, "a section with the cover next to it");
  assert.equal(head.accessory.media.url, "https://is1.example/cover.jpg");
  const all = texts(box).join("\n");
  assert.match(all, /LIVE · Jetzt auf Sendung · OmniFM 1/);
  assert.match(all, /## Cafe del Mar\nEnergy 52/);
  assert.match(all, /\*\*Groove Salad\*\* · Ambient/);
  assert.match(all, /5 hören · .* 128k · 🔊 80% · <#123456789012345678>/);
  assert.match(all, /Zuletzt: A - One · B - Two · C - Three/);
  assert.doesNotMatch(all, /D - Four/, "three earlier songs at most");
  const controls = buttons(box);
  assert.deepEqual(controls.slice(0, 5).map((control) => control.custom_id), ["np:toggle", "np:stop", "np:voldown", "np:volup", "omnifm:stations:open"]);
  assert.equal(controls[0].label, "Pause");
  assert.deepEqual(controls.slice(5).map((control) => control.label), ["Merken", "Teilen", "Spotify", "YouTube", "Problem melden"]);
  assert.equal(controls.at(-1).custom_id, "np:report", "reporting a problem (#273) sits in the last row");
  assert.equal(controls[5].custom_id, "np:save", "saving a song (#272) sits with the song links");
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);
});

test("paused: the header says so and the first button resumes", () => {
  const box = tree(buildNowPlayingPanel(input({ playback: { ...input().playback, paused: true, phase: "paused" } })));
  assert.match(texts(box)[0], /Pausiert/);
  const [toggle] = buttons(box);
  assert.equal(toggle.label, "Weiter");
  assert.equal(toggle.style, ButtonStyle.Success);
});

test("reconnecting and parked are said in words", () => {
  assert.match(texts(tree(buildNowPlayingPanel(input({ playback: { ...input().playback, phase: "recovering" } }))))[0], /Verbindet neu/);
  assert.match(texts(tree(buildNowPlayingPanel(input({ playback: { ...input().playback, phase: "parked" } }))))[0], /Wartet auf den Sender/);
});

test("a backup station: the hint and one click back or keep", () => {
  const box = tree(buildNowPlayingPanel(input({
    station: { name: "Beta FM", key: "beta", genre: "Pop", tier: "free" },
    notices: { failover: { active: true, desiredName: "Alpha FM", currentName: "Beta FM" } },
  })));
  assert.match(texts(box).join("\n"), /Ersatzsender aktiv: \*\*Alpha FM\*\*/);
  const ids = buttons(box).map((control) => control.custom_id).filter(Boolean);
  assert.ok(ids.includes("np:failback") && ids.includes("np:keepstation"));
  assert.match(buttons(box).find((control) => control.custom_id === "np:keepstation").label, /Beta FM behalten/);
});

test("without a title: amber, the station as heading, the hint, no search links", () => {
  const box = tree(buildNowPlayingPanel(input({
    track: { hasTrack: false, metadataHint: "Dieser Sender sendet keine Titel.", sourceLabel: "" },
    searchQuery: null,
  })));
  assert.equal(box.accent_color, ui.UI_COLORS.warning);
  const all = texts(box).join("\n");
  assert.match(all, /## Groove Salad/);
  assert.match(all, /Dieser Sender sendet keine Titel/);
  assert.ok(!buttons(box).some((control) => control.url), "no link buttons");
});

test("a station colour wins over the plan colour", () => {
  const box = tree(buildNowPlayingPanel(input({ station: { ...input().station, color: 0x3366ff } })));
  assert.equal(box.accent_color, 0x3366ff);
});

test("the fullest panel stays within Discord's limits", () => {
  const long = "x".repeat(400);
  const payload = buildNowPlayingPanel(input({
    station: { name: long, key: long, genre: long, tier: "ultimate" },
    track: { hasTrack: true, headline: long, artist: long, album: long, artworkUrl: "https://e/x.jpg", sourceNote: long, sourceLabel: long },
    notices: { serverMuted: true, failover: { active: true, desiredName: long, currentName: long } },
    recent: [long, long, long],
    musicBrainzUrl: "https://musicbrainz.org/release/x",
  }));
  assert.deepEqual(ui.checkDiscordLimits(payload).problems, []);
});

test("the panel uses the sending worker's own app emojis", (t2) => {
  t2.after(() => ui.clearAppEmojis());
  ui.registerAppEmojis("app-worker-1", [
    { logicalName: "equalizer", id: "11", name: "omnifm_equalizer_v1", animated: true },
    { logicalName: "pause", id: "12", name: "omnifm_pause_v1" },
  ]);
  const box = tree(buildNowPlayingPanel(input()));
  assert.match(texts(box)[0], /<a:omnifm_equalizer_v1:11> LIVE/);
  assert.equal(buttons(box)[0].emoji.id, "12");
});

function createRuntime() {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { id: "bot-np", name: "OmniFM 1" };
  runtime.client = { user: { id: "bot-np", displayAvatarURL: () => "https://cdn.example/avatar.png" }, guilds: { cache: new Map() } };
  runtime.guildState = new Map();
  runtime.resolveGuildLanguage = () => "de";
  runtime.getApplicationId = () => "app-worker-1";
  return runtime;
}

test("the runtime builds the panel from station, metadata and playback", () => {
  const payload = createRuntime().buildNowPlayingMessagePayload(
    "guild-np",
    { name: "Groove Salad", key: "groove-salad", genre: "Ambient", tier: "free", color: "#112233" },
    { displayTitle: "Energy 52 - Cafe del Mar", artist: "Energy 52", title: "Cafe del Mar", metadataSource: "icy", metadataStatus: "ok" },
    { stationKey: "groove-salad", phase: "playing", listenerCount: 3, volume: 70, channelId: "555" },
  );
  assert.equal(payload.flags, MessageFlags.IsComponentsV2);
  assert.deepEqual(payload.allowedMentions, { parse: [] });
  const box = tree(payload);
  assert.equal(box.accent_color, 0x112233);
  assert.equal(box.components[0].accessory.media.url, "https://cdn.example/avatar.png", "no cover: the bot avatar");
  assert.match(texts(box).join("\n"), /## Cafe del Mar\nEnergy 52/);
});

function fakeChannel(existing) {
  const sent = [];
  return {
    sent,
    channel: {
      id: "text-1",
      name: "radio",
      messages: { fetch: async () => existing },
      send: async (payload) => { sent.push(payload); return { id: "new-message" }; },
    },
  };
}

test("an old embed panel is replaced by the new panel, not left as a duplicate", async () => {
  const runtime = createRuntime();
  runtime.logNowPlayingIssue = () => {};
  let deleted = false;
  let edited = false;
  const old = { flags: { has: () => false }, delete: async () => { deleted = true; }, edit: async () => { edited = true; } };
  const { channel, sent } = fakeChannel(old);
  const state = { nowPlayingMessageId: "old-message", nowPlayingChannelId: "text-1" };
  const panel = buildNowPlayingPanel(input());
  assert.equal(await runtime.upsertNowPlayingMessage("guild-np", state, panel, channel), true);
  assert.equal(deleted, true);
  assert.equal(edited, false);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].flags, MessageFlags.IsComponentsV2);
  assert.equal(sent[0].embeds, undefined);
  assert.equal(state.nowPlayingMessageId, "new-message");
});

test("a panel that is already Components V2 is edited in place", async () => {
  const runtime = createRuntime();
  runtime.logNowPlayingIssue = () => {};
  const edits = [];
  const current = { flags: { has: (flag) => flag === MessageFlags.IsComponentsV2 }, edit: async (payload) => { edits.push(payload); } };
  const { channel, sent } = fakeChannel(current);
  const state = { nowPlayingMessageId: "panel-message", nowPlayingChannelId: "text-1" };
  assert.equal(await runtime.upsertNowPlayingMessage("guild-np", state, buildNowPlayingPanel(input()), channel), true);
  assert.equal(edits.length, 1);
  assert.equal(sent.length, 0);
  assert.equal(state.nowPlayingMessageId, "panel-message");
});
