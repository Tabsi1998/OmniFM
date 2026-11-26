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
