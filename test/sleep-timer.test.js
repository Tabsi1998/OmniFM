import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { MessageFlags } from "discord.js";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-sleep-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const sleep = await import("../src/bot/runtime-methods/sleep.js");
const { BotRuntime } = await import("../src/bot/runtime.js");
const { saveBotState, getBotState } = await import("../src/bot-state.js");
const { restoreRuntimeGuildEntry } = await import("../src/bot/runtime-restore.js");
const { WorkerBridgeService } = await import("../src/bot/worker-bridge-service.js");
const { PLAYBACK_COMMANDS } = await import("../src/bot/commands/playback-commands.js");
const { buildNowPlayingPanel } = await import("../src/bot/now-playing/now-playing-panel.js");
const { buildCommandsJson } = await import("../src/commands.js");

const GUILD = "123456789012345678";
const MIN = 60_000;

function texts(node, out = []) {
  if (!node || typeof node !== "object") return out;
  const json = typeof node.toJSON === "function" ? node.toJSON() : node;
  if (json.type === 10) out.push(json.content);
  for (const child of json.components || []) texts(child, out);
  if (json.accessory) texts(json.accessory, out);
  return out;
}
const allText = (payload) => payload.components.flatMap((component) => texts(component)).join("\n");
const customIds = (payload) => JSON.stringify(payload.components.map((component) => component.toJSON())).match(/np:[a-z]+/g) || [];

// Promises chained on timers need a turn of the real event loop.
const flush = () => new Promise((resolve) => setImmediate(resolve));

// Mocked timers do not run a timeout set during the same tick, and the fade
// sets one per second: advance a second at a time.
async function advance(t, ms) {
  for (let passed = 0; passed < ms; passed += 1000) t.mock.timers.tick(Math.min(1000, ms - passed));
  await flush();
  await flush();
}

function buildWorker() {
  const volumes = [];
  const sent = [];
  const edits = [];
  const stops = [];
  const runtime = Object.create(BotRuntime.prototype);
  runtime.config = { name: "OmniFM 1", id: "bot-1" };
  const state = {
    currentStationKey: "groovesalad",
    volume: 80,
    player: { state: { resource: { volume: { setVolumeLogarithmic: (value) => volumes.push(Math.round(value * 100)) } } } },
  };
  const message = { id: "warn-1", edit: async (payload) => { edits.push(payload); } };
  const channel = { id: "chan-1", send: async (payload) => { sent.push(payload); return message; }, messages: { fetch: async () => message } };
  runtime.guildState = new Map([[GUILD, state]]);
  runtime.persistState = () => {};
  runtime.updateNowPlayingEmbed = async () => {};
  runtime.resolveGuildLanguage = () => "de";
  runtime.resolveInteractionLanguage = () => "de";
  runtime.resolveNowPlayingChannel = async () => channel;
  runtime.client = { guilds: { cache: new Map([[GUILD, { channels: { cache: new Map([["chan-1", channel]]) } }]]) } };
  runtime.stopInGuild = async (guildId) => {
    stops.push(guildId);
    runtime.clearSleepTimer(guildId);
    state.currentStationKey = null;
    return { ok: true };
  };
  return { runtime, state, volumes, sent, edits, stops };
}

function buttonClick(action, { allowed = true } = {}) {
  const calls = [];
  return {
    calls,
    guildId: GUILD,
    customId: `np:${action}`,
    reply: async (payload) => { calls.push(["reply", payload]); },
    update: async (payload) => { calls.push(["update", payload]); },
    deferReply: async () => { calls.push(["deferReply"]); },
    __allowed: allowed,
  };
}

test("durations: whole minutes up to 12 hours, 'off' and nonsense are 0", () => {
  assert.equal(sleep.normalizeSleepMinutes("30"), 30);
  assert.equal(sleep.normalizeSleepMinutes(120), 120);
  assert.equal(sleep.normalizeSleepMinutes("off"), 0);
  assert.equal(sleep.normalizeSleepMinutes("-5"), 0);
  assert.equal(sleep.normalizeSleepMinutes("x"), 0);
  assert.equal(sleep.normalizeSleepMinutes(9999), 720);
});

test("the timer runs out: warning a minute before, ten steps down, stop, good night", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const { runtime, state, volumes, sent, edits, stops } = buildWorker();

  const result = await runtime.setSleepTimerInGuild(GUILD, 30);
  assert.deepEqual(result, { ok: true, sleepUntilMs: 30 * MIN, workerName: "OmniFM 1" });

  t.mock.timers.tick(29 * MIN - 1);
  await flush();
  assert.equal(sent.length, 0, "no warning before the last minute");
  t.mock.timers.tick(1);
  await flush();
  assert.equal(sent.length, 1);
  assert.match(allText(sent[0]), /Gleich ist Schluss/);
  assert.deepEqual(customIds(sent[0]), ["np:sleepextend", "np:sleepoff"]);
  assert.equal(sent[0].flags, MessageFlags.IsComponentsV2);

  t.mock.timers.tick(50_000); // 29:50 - the fade starts
  for (let step = 0; step < 10; step += 1) t.mock.timers.tick(1000);
  await flush();
  await flush();
  assert.deepEqual(volumes, [72, 64, 56, 48, 40, 32, 24, 16, 8, 0]);
  assert.deepEqual(stops, [GUILD]);
  assert.equal(state.volume, 80, "the volume setting stays for the next start");
  assert.equal(state.sleepUntilMs, 0);
  assert.match(allText(edits[0]), /Gute Nacht/);
});

test("'+30 min' during the fade brings the volume back and moves the end", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const { runtime, state, volumes, stops } = buildWorker();
  runtime.checkCommandRolePermission = () => ({ ok: true });
  await runtime.setSleepTimerInGuild(GUILD, 30);
  t.mock.timers.tick(29 * MIN + 50_000); // the fade starts
  for (let step = 0; step < 3; step += 1) t.mock.timers.tick(1000);
  await flush();
  assert.deepEqual(volumes, [72, 64, 56]);

  const click = buttonClick("sleepextend");
  runtime.createInteractionTranslator = () => ({ t: (de) => de, language: "de" });
  await runtime.handleNowPlayingControl(click);
  assert.equal(click.calls[0][0], "update");
  assert.match(allText(click.calls[0][1]), /Verlängert/);
  assert.equal(volumes.at(-1), 80, "back to the set volume");
  assert.equal(state.sleepUntilMs, 60 * MIN, "30 more minutes from the planned end");

  t.mock.timers.tick(10_000);
  await flush();
  assert.equal(stops.length, 0, "not stopped at the old end");
  await advance(t, 30 * MIN);
  assert.deepEqual(stops, [GUILD]);
});

test("'timer off' keeps the radio playing; without the /perm right nothing changes", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const { runtime, state, stops } = buildWorker();
  runtime.createInteractionTranslator = () => ({ t: (de) => de, language: "de" });
  await runtime.setSleepTimerInGuild(GUILD, 15);

  runtime.checkCommandRolePermission = () => ({ ok: false, message: "Nur DJs." });
  const denied = buttonClick("sleepoff");
  await runtime.handleNowPlayingControl(denied);
  assert.equal(denied.calls[0][0], "reply");
  assert.match(allText(denied.calls[0][1]), /Nur DJs\./);
  assert.equal(state.sleepUntilMs, 15 * MIN);

  runtime.checkCommandRolePermission = () => ({ ok: true });
  const off = buttonClick("sleepoff");
  await runtime.handleNowPlayingControl(off);
  assert.match(allText(off.calls[0][1]), /Sleep-Timer aus/);
  t.mock.timers.tick(20 * MIN);
  await flush();
  assert.equal(stops.length, 0);
  assert.equal(state.currentStationKey, "groovesalad");
});

test("a restart keeps the time; a time that passed meanwhile keeps the stream off", async (t) => {
  const future = Date.now() + 45 * MIN;
  saveBotState("bot-sleep", new Map([[GUILD, { currentStationKey: "groovesalad", lastChannelId: "223456789012345678", sleepUntilMs: future }]]));
  assert.equal(getBotState("bot-sleep")[GUILD].sleepUntilMs, future);
  saveBotState("bot-sleep", new Map([[GUILD, { currentStationKey: "groovesalad", lastChannelId: "223456789012345678", sleepUntilMs: Date.now() - 1 }]]));
  assert.equal("sleepUntilMs" in getBotState("bot-sleep")[GUILD], false, "a time in the past is not kept");

  const past = await restoreRuntimeGuildEntry(
    { config: { name: "OmniFM 1", id: "bot-1" }, guildState: new Map() },
    GUILD,
    { channelId: "223456789012345678", stationKey: "groovesalad", sleepUntilMs: Date.now() - 1000 },
    {}
  );
  assert.deepEqual(past, { ok: false, permanent: true, resource: "sleep" });

  // After the restart the new process arms the kept time again.
  t.mock.timers.enable({ apis: ["setTimeout", "Date"], now: 0 });
  const { runtime, state, stops } = buildWorker();
  state.sleepUntilMs = 20 * MIN;
  assert.equal(runtime.armSleepTimer(GUILD), true);
  await advance(t, 20 * MIN);
  assert.deepEqual(stops, [GUILD]);
});

test("split mode: the commander's request reaches the worker process", async () => {
  const calls = [];
  const service = new WorkerBridgeService({
    config: { id: "bot-2" },
    setSleepTimerInGuild: async (...args) => { calls.push(args); return { ok: true, sleepUntilMs: 1 }; },
  }, { bridge: {}, doorbell: { isDoorbellConnected: () => false, onDoorbell: () => () => {} } });
  const result = await service.executeCommand({ type: "setSleepTimer", payload: { guildId: GUILD, minutes: "45" } });
  assert.deepEqual(calls, [[GUILD, "45"]]);
  assert.equal(result.ok, true);
});

test("/sleep asks the streaming workers and says when it ends", async () => {
  const replies = [];
  const worker = { config: { name: "OmniFM 1" }, setSleepTimerInGuild: async () => ({ ok: true, sleepUntilMs: 1_800_000_000_000 }) };
  const commander = Object.create(BotRuntime.prototype);
  commander.role = "commander";
  commander.workerManager = { getStreamingWorkers: () => [worker], getWorkerByIndex: () => null };
  commander.respondInteraction = async (_interaction, payload) => { replies.push(payload); };
  const interaction = { guildId: GUILD, options: { getString: () => "30", getInteger: () => null } };
  await PLAYBACK_COMMANDS.sleep({ runtime: commander, interaction, t: (de) => de, language: "de", state: {} });
  assert.match(allText(replies[0]), /Sleep-Timer an[\s\S]*OmniFM 1[\s\S]*<t:1800000000:R>[\s\S]*<t:1800000000:t>/);

  commander.workerManager.getStreamingWorkers = () => [];
  await PLAYBACK_COMMANDS.sleep({ runtime: commander, interaction, t: (de) => de, language: "de", state: {} });
  assert.match(allText(replies[1]), /Gerade läuft nichts/);

  const command = buildCommandsJson().find((entry) => entry.name === "sleep");
  assert.deepEqual(command.options[0].choices.map((choice) => choice.value), ["15", "30", "45", "60", "90", "120", "off"]);
  assert.equal(command.options[0].name_localizations?.de, "dauer");
});

test("the panel shows when the radio falls asleep", () => {
  const payload = buildNowPlayingPanel({
    t: (de) => de,
    station: { name: "Groove Salad" },
    track: { hasTrack: false },
    playback: { phase: "playing", sleepUntilMs: 1_800_000_000_000 },
  });
  assert.match(allText(payload), /😴 Schläft um <t:1800000000:t>/);
});
