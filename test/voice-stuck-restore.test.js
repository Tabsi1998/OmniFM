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

const START_MS = 1_800_000_000_000;

/** A stand-in for a @discordjs/voice connection that emits its state changes. */
function createConnection(channelId, status = "ready") {
  const connection = new EventEmitter();
  connection.joinConfig = { channelId };
  connection.state = { status };
  connection.destroyCount = 0;
  connection.setStatus = (next) => {
    const oldState = connection.state;
    connection.state = { status: next };
    connection.emit("stateChange", oldState, connection.state);
    if (oldState.status !== next) connection.emit(next, oldState, connection.state);
  };
  connection.destroy = () => {
    connection.destroyCount += 1;
    connection.setStatus("destroyed");
  };
  return connection;
}

function createPlayingState(connection, extra = {}) {
  return {
    connection,
    currentStationKey: "station-a",
    currentStationName: "Station A",
    lastChannelId: "voice-1",
    shouldReconnect: true,
    player: { state: { status: "playing" } },
    transientVoiceIssues: {},
    ...extra,
  };
}

/** The voice reconcile's view of one server; Discord lists the bot in voice-1. */
function createReconcileRuntime(state) {
  const reconnects = [];
  const runtime = {
    config: { id: "bot-605", name: "OmniFM 605" },
    client: { isReady: () => true },
    guildState: new Map([["guild-1", state]]),
    getState: () => state,
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
  return { runtime, reconnects };
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

/**
 * A worker that can restore its servers without Discord. Reachable servers
 * have voice-1; the others are not resolvable yet (a retry waits). A server in
 * goneChannelGuildIds answers Unknown Channel (10003).
 */
function prepareRestore(runtime, { reachableGuildIds = ["guild-1"], goneChannelGuildIds = [], onConnect = null } = {}) {
  const calls = { connect: [], play: [] };
  const channel = { id: "voice-1", name: "radio", type: 2, isVoiceBased: () => true };
  for (const guildId of reachableGuildIds) {
    runtime.client.guilds.cache.set(guildId, {
      id: guildId,
      name: `Guild ${guildId}`,
      channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
    });
  }
  for (const guildId of goneChannelGuildIds) {
    runtime.client.guilds.cache.set(guildId, {
      id: guildId,
      name: `Guild ${guildId}`,
      channels: {
        cache: new Map(),
        fetch: async () => {
          const err = new Error("Unknown Channel");
          err.code = 10003;
          throw err;
        },
      },
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
    await onConnect?.(guildId);
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

// ---- Stuck connections ----

test("a connection stuck in signalling is rebuilt through the reconnect path after the timeout", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: START_MS });
  const connection = createConnection("voice-1");
  const state = createPlayingState(connection);
  const { runtime, reconnects } = createReconcileRuntime(state);

  attachRuntimeConnectionHandlers(runtime, "guild-1", connection);
  connection.setStatus("connecting");
  connection.setStatus("signalling");

  t.mock.timers.tick(10_000);
  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });
  assert.equal(connection.destroyCount, 0, "a short signalling phase is left alone");
  assert.equal(reconnects.length, 0);

  t.mock.timers.tick(50_000);
  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });
  assert.equal(connection.destroyCount, 1, "the stuck connection is destroyed");
  assert.equal(state.connection, null);
  assert.ok(reconnects.some((row) => row.guildId === "guild-1" && row.reason === "voice-stuck-signalling"));
  assert.equal(state.currentStationKey, "station-a", "the restore target stays");
  assert.equal(state.lastChannelId, "voice-1");
});

test("ready in between restarts the clock: a new short signalling phase is not rebuilt", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: START_MS });
  const connection = createConnection("voice-1");
  const state = createPlayingState(connection);
  const { runtime, reconnects } = createReconcileRuntime(state);

  attachRuntimeConnectionHandlers(runtime, "guild-1", connection);
  connection.setStatus("signalling");
  t.mock.timers.tick(30_000);
  connection.setStatus("ready");
  t.mock.timers.tick(10_000);
  connection.setStatus("signalling");
  t.mock.timers.tick(20_000);
  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

  assert.equal(connection.destroyCount, 0);
  assert.equal(state.connection, connection);
  assert.equal(reconnects.length, 0);
});

test("a stuck connection is left alone while a connect runs or the server should not play", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: START_MS });
  for (const extra of [{ voiceConnectInFlight: true }, { reconnectInFlight: true }, { shouldReconnect: false }]) {
    const connection = createConnection("voice-1");
    const state = createPlayingState(connection, extra);
    const { runtime, reconnects } = createReconcileRuntime(state);
    attachRuntimeConnectionHandlers(runtime, "guild-1", connection);
    connection.setStatus("signalling");
    t.mock.timers.tick(120_000);
    // eslint-disable-next-line no-await-in-loop -- one case after the other on the mocked clock
    await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

    assert.equal(connection.destroyCount, 0, JSON.stringify(extra));
    assert.equal(state.connection, connection, JSON.stringify(extra));
    assert.equal(reconnects.length, 0, JSON.stringify(extra));
  }
});

test("the clock belongs to the connection: an earlier connection's wait does not make a new one look stuck", async (t) => {
  t.mock.timers.enable({ apis: ["Date"], now: START_MS });
  // A join without the handlers (as /play's own join) hangs and is noticed.
  const failedJoin = createConnection("voice-1", "signalling");
  const state = createPlayingState(failedJoin);
  const { runtime, reconnects } = createReconcileRuntime(state);
  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

  // 50 s later a new join replaces it and is still signalling.
  t.mock.timers.tick(50_000);
  const newJoin = createConnection("voice-1", "signalling");
  state.connection = newJoin;
  await reconcileRuntimeGuildVoiceState(runtime, "guild-1", { reason: "timer" });

  assert.equal(newJoin.destroyCount, 0);
  assert.equal(state.connection, newJoin);
  assert.equal(reconnects.length, 0);
});

// ---- Shutdown ----

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

test("a shutdown during the restore joins no further server and keeps their targets", async () => {
  const botId = "bot-605-restore-shutdown";
  saveTargets(botId, ["guild-1", "guild-2"]);
  const runtime = createRuntime(botId);
  try {
    runtime.holdSavedRestoreTargets();
    const calls = prepareRestore(runtime, {
      reachableGuildIds: ["guild-1", "guild-2"],
      onConnect: () => runtime.beginShutdown(),
    });
    await runtime.restoreState({});
    await runtime.stop();

    assert.deepEqual(calls.connect.map((row) => row.guildId), ["guild-1"], "guild-2 is not joined");
    const saved = getBotState(botId);
    assert.equal(saved["guild-1"]?.stationKey, "station-a");
    assert.equal(saved["guild-2"]?.stationKey, "station-a", "the server not reached stays saved");
  } finally {
    disposeRuntime(runtime);
  }
});

test("stop() ends a restore retry that is still waiting", async () => {
  const botId = "bot-605-retry-shutdown";
  saveTargets(botId, ["guild-1"]);
  const runtime = createRuntime(botId);
  try {
    runtime.holdSavedRestoreTargets();
    // guild-1 cannot be resolved yet: a retry waits.
    prepareRestore(runtime, { reachableGuildIds: [] });
    await runtime.restoreState({});
    assert.equal(runtime.pendingRestoreTimers?.size, 1);

    await runtime.stop();

    assert.equal(runtime.pendingRestoreTimers.size, 0);
    assert.equal(getBotState(botId)["guild-1"]?.stationKey, "station-a");
  } finally {
    disposeRuntime(runtime);
  }
});

// ---- Restore targets across a restart ----

test("after a restart an early save keeps the saved target and the restore brings the server back", async () => {
  const botId = "bot-605-restart";
  saveTargets(botId, ["guild-1"]);
  const runtime = createRuntime(botId);
  try {
    runtime.holdSavedRestoreTargets();
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

test("a runtime that never restores (the commander) holds no saved targets", () => {
  const botId = "bot-605-commander";
  saveTargets(botId, ["guild-1"]);
  const runtime = createRuntime(botId);
  try {
    runtime.getState("guild-1");
    runtime.persistState();

    assert.equal(getBotState(botId)["guild-1"]?.stationKey, undefined);
  } finally {
    disposeRuntime(runtime);
  }
});

test("an intentional stop clears only the stopped server's target, not the ones still being restored", async () => {
  const botId = "bot-605-stop";
  saveTargets(botId, ["guild-1", "guild-2"]);
  const runtime = createRuntime(botId);
  try {
    runtime.holdSavedRestoreTargets();
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

test("the restore skips a server stopped or played anew while it ran", async () => {
  const botId = "bot-605-skip";
  saveTargets(botId, ["guild-1", "guild-2", "guild-3"]);
  const runtime = createRuntime(botId);
  try {
    runtime.holdSavedRestoreTargets();
    const calls = prepareRestore(runtime, {
      reachableGuildIds: ["guild-1", "guild-2", "guild-3"],
      onConnect: async (guildId) => {
        if (guildId !== "guild-1") return;
        // While guild-1 connects: guild-2 is stopped, guild-3 gets another station.
        await runtime.stopInGuild("guild-2");
        const replayed = runtime.getState("guild-3");
        replayed.currentStationKey = "station-b";
        replayed.currentStationName = "Station B";
        replayed.lastChannelId = "voice-1";
        replayed.shouldReconnect = true;
      },
    });
    await runtime.restoreState({});
    // The next save (in the worker the stream start saves) writes the memory.
    runtime.persistState();

    assert.deepEqual(calls.connect.map((row) => row.guildId), ["guild-1"]);
    const saved = getBotState(botId);
    assert.equal(saved["guild-2"]?.stationKey, undefined, "the stop holds");
    assert.equal(saved["guild-3"]?.stationKey, "station-b", "the new station holds");
    assert.equal(runtime.guildState.get("guild-3")?.currentStationKey, "station-b");
  } finally {
    disposeRuntime(runtime);
  }
});

test("a target the restore gives up for good stays gone after the next save", async () => {
  const botId = "bot-605-gone";
  saveTargets(botId, ["guild-1"]);
  const runtime = createRuntime(botId);
  try {
    runtime.holdSavedRestoreTargets();
    prepareRestore(runtime, { reachableGuildIds: [], goneChannelGuildIds: ["guild-1"] });
    await runtime.restoreState({});
    runtime.persistState();

    assert.equal(getBotState(botId)["guild-1"]?.stationKey, undefined);
  } finally {
    disposeRuntime(runtime);
  }
});

test("lost access or leaving the server ends a held target for good", () => {
  const botId = "bot-605-release";
  saveTargets(botId, ["guild-1", "guild-2", "guild-3"]);
  const runtime = createRuntime(botId);
  try {
    runtime.holdSavedRestoreTargets();
    runtime.restrictGuildAccess("guild-1");
    runtime.resetGuildRuntimeState("guild-2");
    runtime.persistState();

    const saved = getBotState(botId);
    assert.equal(saved["guild-1"]?.stationKey, undefined, "lost access");
    assert.equal(saved["guild-2"]?.stationKey, undefined, "left the server");
    assert.equal(saved["guild-3"]?.stationKey, "station-a", "the others stay held");
  } finally {
    disposeRuntime(runtime);
  }
});
