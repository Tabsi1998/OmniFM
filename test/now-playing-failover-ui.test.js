import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-np-failover-ui-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const { BotRuntime } = await import("../src/bot/runtime.js");
const { buildNowPlayingSignature } = await import("../src/lib/now-playing-target.js");
const { handleRuntimeBotVoiceStateUpdate } = await import("../src/bot/runtime-recovery.js");
const { buildUserFacingRuntimeStatus } = await import("../src/lib/user-facing-status.js");
const { keepRuntimeFailoverStation, clearRuntimeFailbackTimer } = await import("../src/bot/runtime-streams.js");

function createRuntime(guildState = new Map()) {
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { id: "bot-ui", name: "OmniFM UI" };
  runtime.client = { user: { id: "bot-ui", displayAvatarURL: () => null }, guilds: { cache: new Map() } };
  runtime.guildState = guildState;
  runtime.resolveGuildLanguage = () => "de";
  runtime.persistState = () => {};
  return runtime;
}

function failoverState(extra = {}) {
  return {
    player: { state: { status: "playing" } },
    currentStationKey: "beta",
    currentStationName: "Beta FM",
    desiredStationKey: "alpha",
    desiredStationName: "Alpha FM",
    failoverActive: true,
    failbackTimer: null,
    failbackNextProbeAt: 0,
    ...extra,
  };
}

function customIds(rows) {
  return rows.flatMap((row) => row.components.map((component) => component.data.custom_id).filter(Boolean));
}

test("now-playing buttons offer failback and keeping the backup only while a failover is active", () => {
  const state = failoverState();
  const runtime = createRuntime(new Map([["guild-1", state]]));

  const rows = BotRuntime.prototype.buildTrackLinkComponents.call(runtime, "guild-1", { name: "Beta FM" }, {});
  assert.deepEqual(customIds(rows), ["np:toggle", "np:stop", "np:voldown", "np:volup", "omnifm:stations:open", "np:failback", "np:keepstation"]);
  const labels = rows[1].components.map((component) => component.data.label);
  assert.match(labels[0], /Alpha FM/);
  assert.match(labels[1], /Beta FM behalten/);

  state.failoverActive = false;
  const plain = BotRuntime.prototype.buildTrackLinkComponents.call(runtime, "guild-1", { name: "Beta FM" }, {});
  assert.equal(customIds(plain).includes("np:failback"), false);
});

test("the now-playing embed explains a backup station and a server mute", () => {
  const runtime = createRuntime();
  const embed = BotRuntime.prototype.buildNowPlayingEmbed.call(
    runtime,
    "guild-1",
    { name: "Beta FM", genre: "Pop", tier: "free" },
    { displayTitle: "Artist - Track", artist: "Artist", title: "Track", metadataSource: "icy", metadataStatus: "ok" },
    { stationKey: "beta", serverMuted: true, failover: { active: true, desiredName: "Alpha FM" } }
  );
  const description = embed.data.description;
  assert.match(description, /stummgeschaltet/);
  assert.match(description, /Ersatzsender aktiv: \*\*Alpha FM\*\*/);

  const quiet = BotRuntime.prototype.buildNowPlayingEmbed.call(
    runtime,
    "guild-1",
    { name: "Alpha FM", genre: "Pop", tier: "free" },
    { displayTitle: "Artist - Track", artist: "Artist", title: "Track" },
    { stationKey: "alpha" }
  );
  assert.doesNotMatch(quiet.data.description, /Ersatzsender|stummgeschaltet/);
});

test("the now-playing signature changes with the failover and the mute state", () => {
  const meta = { displayTitle: "A - B" };
  const base = buildNowPlayingSignature("beta", meta, { lastChannelId: "voice-1" }, "text-1");
  const failover = buildNowPlayingSignature("beta", meta, { lastChannelId: "voice-1", failoverActive: true, desiredStationKey: "alpha" }, "text-1");
  const muted = buildNowPlayingSignature("beta", meta, { lastChannelId: "voice-1", serverMuted: true }, "text-1");
  assert.notEqual(base, failover);
  assert.notEqual(base, muted);
  assert.notEqual(failover, muted);
});

test("a server mute is detected, recorded once and re-renders the embed", async () => {
  const state = {
    currentStationKey: "alpha",
    currentStationName: "Alpha FM",
    lastChannelId: "voice-1",
    connection: { joinConfig: { channelId: "voice-1" } },
    player: { state: { status: "playing" } },
    transientVoiceIssues: {},
    serverMuted: false,
  };
  const renders = [];
  const runtime = {
    client: { user: { id: "bot-1" }, guilds: { cache: new Map() } },
    config: { id: "bot-1", name: "OmniFM Mute" },
    getState: () => state,
    queueVoiceStateReconcile() {},
    markNowPlayingTargetDirty() {},
    invalidateVoiceStatus() {},
    persistState() {},
    clearReconnectTimer() {},
    syncVoiceChannelStatus: async () => null,
    updateNowPlayingEmbed: async (guildId, passedState, options) => {
      renders.push({ guildId, muted: passedState.serverMuted, force: options?.force });
    },
  };

  const mutedState = { id: "bot-1", guild: { id: "guild-1" }, channelId: "voice-1", serverMute: true };
  handleRuntimeBotVoiceStateUpdate(runtime, { channelId: "voice-1" }, mutedState);
  handleRuntimeBotVoiceStateUpdate(runtime, { channelId: "voice-1" }, mutedState);
  assert.equal(state.serverMuted, true);
  assert.ok(state.serverMutedAt > 0);
  assert.deepEqual(renders, [{ guildId: "guild-1", muted: true, force: true }], "one render per change, not per event");

  handleRuntimeBotVoiceStateUpdate(runtime, { channelId: "voice-1" }, { ...mutedState, serverMute: false });
  assert.equal(state.serverMuted, false);
  assert.equal(renders.length, 2);
});

test("/status explains a mute and a backup station in plain words", () => {
  const t = (de) => de;
  const muted = buildUserFacingRuntimeStatus({ ready: true, connected: true, serverMuted: true, stationName: "Alpha FM" }, { t });
  assert.equal(muted.code, "muted");
  assert.match(muted.nextStep, /Server-Stummschaltung aufheben/);

  const failover = buildUserFacingRuntimeStatus({
    ready: true,
    connected: true,
    failoverActive: true,
    stationName: "Beta FM",
    desiredStationName: "Alpha FM",
    failbackNextProbeAt: 1_800_000_000_000,
  }, { t });
  assert.equal(failover.code, "failover");
  assert.match(failover.summary, /Alpha FM ist gerade nicht erreichbar/);
  assert.match(failover.summary, /Beta FM/);
  assert.match(failover.summary, /<t:1800000000:R>/);
  assert.match(failover.nextStep, /Buttons/);
});

test("keeping the backup station makes it the preferred one and stops failback", () => {
  const state = failoverState();
  const runtime = createRuntime();
  const kept = keepRuntimeFailoverStation(runtime, "guild-1", state);
  assert.equal(kept.ok, true);
  assert.equal(kept.previousDesiredStationKey, "alpha");
  assert.equal(state.desiredStationKey, "beta");
  assert.equal(state.desiredStationName, "Beta FM");
  assert.equal(state.failoverActive, false);
  assert.equal(keepRuntimeFailoverStation(runtime, "guild-1", state).ok, false, "nothing left to keep");
  clearRuntimeFailbackTimer(state);
});

test("the failback button switches back after a single successful probe", async () => {
  const state = failoverState({ connection: { joinConfig: { channelId: "voice-1" } }, shouldReconnect: true, lastChannelId: "voice-1" });
  const replies = [];
  let playedKey = null;
  const runtime = createRuntime(new Map([["guild-1", state]]));
  runtime.createInteractionTranslator = () => ({ t: (de) => de });
  runtime.resolveStationForGuild = (guildId, key) => ({
    ok: true,
    key,
    station: { name: "Alpha FM", url: "https://alpha.example.test/stream" },
    stations: { stations: {} },
  });
  runtime.probeStreamUrl = async () => ({ ok: true, bytes: 512 });
  runtime.playStation = async (passedState, stations, key) => {
    playedKey = key;
    passedState.currentStationKey = key;
    passedState.currentStationName = "Alpha FM";
    passedState.failoverActive = false;
  };
  runtime.getCurrentListenerCount = () => 0;
  runtime.updateNowPlayingEmbed = async () => {};

  const handled = await BotRuntime.prototype.handleNowPlayingControl.call(runtime, {
    guildId: "guild-1",
    customId: "np:failback",
    deferReply: async () => {},
    editReply: async (payload) => { replies.push(payload.content); },
  });
  assert.equal(handled, true);
  assert.equal(playedKey, "alpha");
  assert.match(replies.at(-1), /Zurück auf Alpha FM/);
  clearRuntimeFailbackTimer(state);
});

test("now-playing buttons follow the /perm rule of their slash command", async () => {
  const calls = [];
  const replies = [];
  const runtime = createRuntime(new Map([["guild-1", { player: { state: { status: "playing" } }, volume: 50 }]]));
  runtime.createInteractionTranslator = () => ({ t: (de) => de });
  runtime.checkCommandRolePermission = (interaction, command) => {
    calls.push(command);
    return command === "stop"
      ? { ok: false, message: "Du darfst `/stop` nicht nutzen." }
      : { ok: true };
  };
  runtime.stopInGuild = async () => { calls.push("stopped"); return { ok: true }; };
  runtime.pauseInGuild = async () => { calls.push("paused"); return { ok: true }; };
  runtime.setVolumeInGuild = async () => { calls.push("volume"); return { ok: true }; };
  runtime.updateNowPlayingEmbed = async () => {};

  const press = (customId) => BotRuntime.prototype.handleNowPlayingControl.call(runtime, {
    guildId: "guild-1",
    customId,
    deferReply: async () => {},
    editReply: async (payload) => { replies.push(payload.content); },
  });

  await press("np:stop");
  assert.deepEqual(calls, ["stop"], "a denied stop never reaches stopInGuild");
  assert.match(replies.at(-1), /nicht nutzen/);

  await press("np:toggle");
  await press("np:volup");
  assert.deepEqual(calls, ["stop", "pause", "paused", "setvolume", "volume"]);
});
