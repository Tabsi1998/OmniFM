import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// #605: voice connections that hang in signalling/connecting are rebuilt, and
// the restore target of a server that should keep playing survives the stuck
// connection, the shutdown and the first saves of the restarted worker.
// File stores resolve their paths at import time, so the scratch directory
// has to exist before the runtime modules are loaded.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-605-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
process.env.OMNIFM_BOT_STATE_FILE = path.join(scratchDir, "bot-state.json");
process.on("exit", () => {
  try {
    fs.rmSync(scratchDir, { recursive: true, force: true, maxRetries: 3 });
  } catch {
    // left for the system's temp cleanup
  }
});

const { BotRuntime } = await import("../src/bot/runtime.js");
const { getBotState, saveBotState } = await import("../src/bot-state.js");
const {
  attachRuntimeConnectionHandlers,
  reconcileRuntimeGuildVoiceState,
} = await import("../src/bot/runtime-recovery.js");

/** A stand-in for a @discordjs/voice connection that emits its state changes. */
function createConnection(channelId) {
  const connection = new EventEmitter();
  connection.joinConfig = { channelId };
  connection.state = { status: "ready" };
  connection.destroyCount = 0;
  connection.setStatus = (status) => {
    const oldState = connection.state;
    connection.state = { status };
    connection.emit("stateChange", oldState, connection.state);
    if (oldState.status !== status) connection.emit(status, oldState, connection.state);
  };
  connection.destroy = () => {
    connection.destroyCount += 1;
    connection.setStatus("destroyed");
  };
  return connection;
}

function createRuntime(botId) {
  const runtime = new BotRuntime(
    { id: botId, name: `OmniFM ${botId}`, clientId: "100000000000000605", token: "test-token" },
    { role: "worker", workerSlot: 1 }
  );
  // No Discord in these tests: the voice channel status stays untouched.
  runtime.syncVoiceChannelStatus = async () => {};
  return runtime;
}

function disposeRuntime(runtime) {
  for (const state of runtime.guildState.values()) {
    if (state.reconnectTimer) clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }
  for (const timer of runtime.pendingRestoreTimers?.values?.() || []) clearTimeout(timer);
  runtime.pendingRestoreTimers?.clear?.();
  runtime.unsubscribeNetworkRecovery?.();
  runtime.unsubscribeNetworkRecovery = null;
  runtime.client.destroy().catch?.(() => null);
}

/** A worker that can restore guild-1 / voice-1 without Discord. */
function prepareRestore(runtime, { reachableGuildIds = ["guild-1"] } = {}) {
  const calls = { connect: [], play: [] };
  const channel = { id: "voice-1", name: "radio", type: 2, isVoiceBased: () => true };
  for (const guildId of reachableGuildIds) {
    runtime.client.guilds.cache.set(guildId, {
      id: guildId,
      name: `Guild ${guildId}`,
      channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
    });
  }
  runtime.client.guilds.fetch = async () => {
    const err = new Error("temporary gateway outage");
    err.code = "ECONNRESET";
    throw err;
  };
  runtime.enforceGuildAccessForGuild = async () => true;
  runtime.refreshVoiceGuardSettings = async () => null;
  runtime.resolveGuildLanguage = () => "de";
  runtime.resolveStationForGuild = (_guildId, key) => ({
    ok: true,
    key,
    station: { name: "Station A" },
    stations: { stations: { [key]: { name: "Station A" } } },
  });
  runtime.markScheduledEventPlayback = () => {};
  runtime.armSleepTimer = () => {};
  runtime.ensureVoiceConnectionForChannel = async (guildId, channelId) => {
    calls.connect.push({ guildId, channelId });
    return { connection: null };
  };
  runtime.playStation = async (state, _stations, key, guildId) => {
    calls.play.push({ guildId, key });
    state.currentStationKey = key;
  };
  return calls;
}

function saveTargets(botId, guildIds) {
  saveBotState(botId, new Map(guildIds.map((guildId) => [guildId, {
    currentStationKey: "station-a",
    currentStationName: "Station A",
    lastChannelId: "voice-1",
    volume: 80,
  }])));
}

test("a connection stuck in signalling is rebuilt through the reconnect path after the timeout", (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const reconnects = [];
  const connection = createConnection("voice-1");
  const state = {
    connection,
    currentStationKey: "station-a",
    currentStationName: "Station A",
    lastChannelId: "voice-1",
    shouldReconnect: true,
    player: { state: { status: "playing" } },
    transientVoiceIssues: {},
  };
  const runtime = {
    config: { id: "bot-605", name: "OmniFM 605" },
    client: { isReady: () => true },
    guildState: new Map([["guild-1", state]]),
    getState: () => state,
    // Discord still lists the bot in its channel: only the connection hangs.
    fetchBotVoiceState: async () => ({ guild: {}, voiceState: {}, channelId: "voice-1" }),
    markNowPlayingTargetDirty() {},
    persistState() {},
    queueVoiceStateReconcile() {},
    invalidateVoiceStatus() {},
    scheduleReconnect(guildId, options) {
      reconnects.push({ guildId, reason: options?.reason || "" });
    },
    scheduleStreamRestart() {},
    syncVoiceChannelStatus: async () => {},
  };

  attachRuntimeConnectionHandlers(runtime, "guild-1", connection);
  connection.setStatus("connecting");
  connection.setStatus("signalling");

  return (async () => {
    t.mock.timers.tick(10_000);
    await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });
    assert.equal(connection.destroyCount, 0, "a short signalling phase is left alone");
    assert.equal(reconnects.length, 0);

    t.mock.timers.tick(50_000);
    await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });
    assert.equal(connection.destroyCount, 1, "the stuck connection is destroyed");
    assert.equal(state.connection, null);
    assert.ok(reconnects.length >= 1, "a reconnect is scheduled");
    assert.ok(reconnects.every((row) => row.guildId === "guild-1"));
    assert.equal(state.currentStationKey, "station-a", "the restore target stays");
    assert.equal(state.lastChannelId, "voice-1");
  })();
});

test("a connection that comes back to ready in time is not rebuilt", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: 1_800_000_000_000 });
  const connection = createConnection("voice-1");
  const state = {
    connection,
    currentStationKey: "station-a",
    lastChannelId: "voice-1",
    shouldReconnect: true,
    player: { state: { status: "playing" } },
    transientVoiceIssues: {},
  };
  const runtime = {
    config: { id: "bot-605", name: "OmniFM 605" },
    client: { isReady: () => true },
    guildState: new Map([["guild-1", state]]),
    getState: () => state,
    fetchBotVoiceState: async () => ({ guild: {}, voiceState: {}, channelId: "voice-1" }),
    markNowPlayingTargetDirty() {},
    persistState() {},
    queueVoiceStateReconcile() {},
    scheduleReconnect() {
      throw new Error("scheduleReconnect should not run");
    },
    scheduleStreamRestart() {},
    syncVoiceChannelStatus: async () => {},
  };

  attachRuntimeConnectionHandlers(runtime, "guild-1", connection);
  connection.setStatus("signalling");
  t.mock.timers.tick(30_000);
  connection.setStatus("ready");
  t.mock.timers.tick(60_000);
  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

  assert.equal(connection.destroyCount, 0);
  assert.equal(state.connection, connection);
});

test("shutdown persists the target of a stuck connection and plans no rejoin after it", async () => {
  const runtime = createRuntime("bot-605-shutdown");
  try {
    const state = runtime.getState("guild-1");
    state.currentStationKey = "station-a";
    state.currentStationName = "Station A";
    state.lastChannelId = "voice-1";
    state.shouldReconnect = true;
    const connection = createConnection("voice-1");
    state.connection = connection;
    runtime.attachConnectionHandlers("guild-1", connection);
    connection.setStatus("connecting");
    connection.setStatus("signalling");

    runtime.beginShutdown();
    await runtime.stop();

    assert.equal(connection.destroyCount, 1);
    const saved = getBotState("bot-605-shutdown")["guild-1"];
    assert.equal(saved?.stationKey, "station-a");
    assert.equal(saved?.channelId, "voice-1");
    assert.equal(state.reconnectTimer, null, "no reconnect (and no voice join) after the final save");
  } finally {
    disposeRuntime(runtime);
  }
});

test("after a restart an early save keeps the saved target and the restore brings the server back", async () => {
  const botId = "bot-605-restart";
  saveTargets(botId, ["guild-1"]);
  const runtime = createRuntime(botId);
  try {
    runtime.client.user = { id: "605605605605605605", setPresence() {} };
    // The bot's own voice state reaches the fresh worker before the restore:
    // Discord drops the channel the stuck connection left behind.
    runtime.handleBotVoiceStateUpdate(
      { channelId: "voice-1" },
      { id: "605605605605605605", channelId: null, guild: { id: "guild-1" } }
    );

    const afterEarlySave = getBotState(botId)["guild-1"];
    assert.equal(afterEarlySave?.stationKey, "station-a", "the early save keeps the target");
    assert.equal(afterEarlySave?.channelId, "voice-1");

    const calls = prepareRestore(runtime);
    await runtime.restoreState({});

    assert.deepEqual(calls.connect, [{ guildId: "guild-1", channelId: "voice-1" }]);
    assert.deepEqual(calls.play, [{ guildId: "guild-1", key: "station-a" }]);
    assert.equal(getBotState(botId)["guild-1"]?.stationKey, "station-a");
  } finally {
    disposeRuntime(runtime);
  }
});

test("an intentional stop clears only the stopped server's target, not the ones still being restored", async () => {
  const botId = "bot-605-stop";
  saveTargets(botId, ["guild-1", "guild-2"]);
  const runtime = createRuntime(botId);
  try {
    // guild-2 cannot be resolved yet: its restore waits for a retry.
    prepareRestore(runtime, { reachableGuildIds: ["guild-1"] });
    await runtime.restoreState({});

    await runtime.stopInGuild("guild-1");

    const saved = getBotState(botId);
    assert.equal(saved["guild-1"]?.stationKey, undefined, "the stopped server keeps no target");
    assert.equal(saved["guild-2"]?.stationKey, "station-a", "the server waiting for its restore keeps its target");
    assert.equal(saved["guild-2"]?.channelId, "voice-1");
  } finally {
    disposeRuntime(runtime);
  }
});
