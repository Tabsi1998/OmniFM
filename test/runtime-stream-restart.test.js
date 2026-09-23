import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// Scenarios of #207 that the other recovery suites do not cover yet: how a
// stream end plans its restart, the order and the end of the failover chain,
// and a restore in the middle of a failover.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-stream-restart-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
process.env.STREAM_RESTART_BASE_MS = "1000";
process.env.STREAM_RESTART_MAX_MS = "120000";
process.env.STREAM_ERROR_COOLDOWN_THRESHOLD = "5";
process.env.STREAM_ERROR_COOLDOWN_MS = "60000";
process.env.STREAM_PROCESS_FAILURE_WINDOW_MS = "12000";
process.env.STREAM_FAILOVER_MIN_FAILURES = "2";
process.env.STREAM_FAILOVER_MIN_UNSTABLE_MS = "10000";
process.env.STREAM_FAILBACK_ENABLED = "0";

const { handleRuntimeStreamEnd, restartRuntimeCurrentStation } = await import("../src/bot/runtime-streams.js");
const { restoreRuntimeGuildEntry } = await import("../src/bot/runtime-recovery.js");
const { getServerPlanConfig } = await import("../src/core/entitlements.js");

const GUILD_ID = "guild-restart";
const PLAN_DELAY_MS = Math.max(1_000, Number(getServerPlanConfig(GUILD_ID).reconnectMs) || 0);

function createEndRuntime({ scheduledStopDue = false, networkDelayMs = 0 } = {}) {
  const restarts = [];
  const stops = [];
  return {
    restarts,
    stops,
    config: { name: "OmniFM Restart", id: "bot-restart" },
    client: { guilds: { cache: new Map() } },
    isScheduledEventStopDue: () => scheduledStopDue,
    getNetworkRecoveryDelayMs: () => networkDelayMs,
    scheduleStreamRestart(guildId, state, delayMs, reason) {
      restarts.push({ delayMs, reason });
    },
    async stopInGuild(guildId) {
      stops.push(guildId);
    },
  };
}

function playingState(extra = {}) {
  return {
    shouldReconnect: true,
    currentStationKey: "alpha",
    connection: { joinConfig: { channelId: "voice-1" } },
    lastStreamStartAt: Date.now() - 60_000,
    streamErrorCount: 0,
    ...extra,
  };
}

test("a stream that ends after a long run restarts after the plan delay and forgets old errors", async () => {
  const runtime = createEndRuntime();
  const state = playingState({ streamErrorCount: 3 });
  await handleRuntimeStreamEnd(runtime, GUILD_ID, state, "idle");
  assert.deepEqual(runtime.restarts, [{ delayMs: PLAN_DELAY_MS, reason: "provider-eof" }]);
  assert.equal(state.streamErrorCount, 0);
  assert.equal(state.idleRestartStreak, 1);
});

test("an end within five seconds counts as an error and backs off exponentially", async () => {
  const runtime = createEndRuntime();
  const state = playingState();
  for (let i = 0; i < 3; i += 1) {
    state.lastStreamStartAt = Date.now() - 2_000;
    await handleRuntimeStreamEnd(runtime, GUILD_ID, state, "idle");
  }
  assert.deepEqual(runtime.restarts.map((entry) => entry.delayMs), [1_000, 2_000, 4_000]);
  assert.ok(runtime.restarts.every((entry) => entry.reason === "idle-early"));
  assert.equal(state.streamErrorCount, 3);
});

test("repeated normal ends within the idle window get a growing penalty", async () => {
  const runtime = createEndRuntime();
  const state = playingState();
  for (let i = 0; i < 3; i += 1) {
    state.lastStreamStartAt = Date.now() - 60_000;
    await handleRuntimeStreamEnd(runtime, GUILD_ID, state, "idle");
  }
  const delays = runtime.restarts.map((entry) => entry.delayMs);
  assert.equal(delays[0], PLAN_DELAY_MS);
  assert.ok(delays[1] > delays[0] && delays[2] > delays[1], `delays grow: ${delays.join(", ")}`);
  assert.deepEqual(runtime.restarts.map((entry) => entry.reason), ["provider-eof", "provider-eof-repeat", "provider-eof-repeat"]);
});

test("many errors in a row switch to the cooldown", async () => {
  const runtime = createEndRuntime();
  const state = playingState({ streamErrorCount: 4 });
  await handleRuntimeStreamEnd(runtime, GUILD_ID, state, "error");
  assert.equal(state.streamErrorCount, 5);
  assert.ok(runtime.restarts[0].delayMs >= 60_000, `cooldown delay ${runtime.restarts[0].delayMs}`);
  assert.equal(runtime.restarts[0].reason, "audio-player-error");
});

test("a recent ffmpeg exit and a network penalty both stretch the restart delay", async () => {
  const exitRuntime = createEndRuntime();
  const exitState = playingState({ lastProcessExitCode: 1, lastProcessExitAt: Date.now() - 1_000, lastProcessExitDetail: "broken-pipe" });
  await handleRuntimeStreamEnd(exitRuntime, GUILD_ID, exitState, "idle");
  assert.equal(exitRuntime.restarts[0].reason, "idle-after-broken-pipe");
  assert.equal(exitState.streamErrorCount, 1, "a process failure counts as an error");

  const networkRuntime = createEndRuntime({ networkDelayMs: 30_000 });
  await handleRuntimeStreamEnd(networkRuntime, GUILD_ID, playingState(), "idle");
  assert.ok(networkRuntime.restarts[0].delayMs >= 30_000, "the network cooldown is the lower bound");
});

test("a stream end restarts nothing without a target or a connection and stops at a scheduled end", async () => {
  const runtime = createEndRuntime();
  await handleRuntimeStreamEnd(runtime, GUILD_ID, playingState({ shouldReconnect: false }), "idle");
  await handleRuntimeStreamEnd(runtime, GUILD_ID, playingState({ connection: null }), "idle");
  await handleRuntimeStreamEnd(runtime, GUILD_ID, playingState({ streamRestartInFlight: true }), "idle");
  assert.deepEqual(runtime.restarts, []);

  const eventRuntime = createEndRuntime({ scheduledStopDue: true });
  await handleRuntimeStreamEnd(eventRuntime, GUILD_ID, playingState({ activeScheduledEventStopAtMs: Date.now() - 1 }), "idle");
  assert.deepEqual(eventRuntime.stops, [GUILD_ID]);
  assert.deepEqual(eventRuntime.restarts, []);
});

const CHAIN_STATIONS = {
  stations: {
    alpha: { name: "Alpha FM" },
    beta: { name: "Beta FM" },
    gamma: { name: "Gamma FM" },
    delta: { name: "Delta FM" },
  },
};

function createFailoverRuntime({ chain, failing, unavailable = [] }) {
  const played = [];
  const alerts = [];
  const restarts = [];
  const runtime = {
    played,
    alerts,
    restarts,
    config: { name: "OmniFM Failover", id: "bot-failover" },
    role: "worker",
    client: { guilds: { cache: new Map() } },
    isScheduledEventStopDue: () => false,
    getNetworkRecoveryDelayMs: () => 0,
    noteNetworkRecoveryFailure() {},
    getResolvedCurrentStation: (guildId, state) => ({
      key: state.currentStationKey,
      station: CHAIN_STATIONS.stations[state.currentStationKey],
      stations: CHAIN_STATIONS,
    }),
    clearCurrentProcess() {},
    async playStation(state, stations, key) {
      played.push(key);
      if (failing.includes(key)) throw new Error(`Stream konnte nicht geladen werden: ${key} 503`);
      state.currentStationKey = key;
      state.currentStationName = CHAIN_STATIONS.stations[key].name;
    },
    loadGuildSettingsCached: async () => ({ failoverChain: chain }),
    resolveStationForGuild: (guildId, key) => (unavailable.includes(key)
      ? { ok: false, message: "not in plan" }
      : { ok: true, key, station: CHAIN_STATIONS.stations[key], stations: CHAIN_STATIONS }),
    getCurrentListenerCount: () => 0,
    dispatchIncidentAlert: async (input) => { alerts.push(input.eventKey); },
    scheduleStreamRestart(guildId, state, delayMs, reason) {
      restarts.push({ delayMs, reason });
    },
    persistState() {},
  };
  return runtime;
}

function unstableState() {
  const now = Date.now();
  return {
    shouldReconnect: true,
    currentStationKey: "alpha",
    currentStationName: "Alpha FM",
    desiredStationKey: "alpha",
    desiredStationName: "Alpha FM",
    connection: { joinConfig: { channelId: "voice-1" } },
    lastChannelId: "voice-1",
    failoverFailureStationKey: "alpha",
    failoverFailureCount: 2,
    failoverFailureStartedAt: now - 60_000,
    failoverLastFailureAt: now - 1_000,
  };
}

test("failover walks the chain in order, skips unavailable and failing candidates", async () => {
  const runtime = createFailoverRuntime({ chain: ["beta", "gamma", "delta"], failing: ["alpha", "gamma"], unavailable: ["beta"] });
  const state = unstableState();
  await restartRuntimeCurrentStation(runtime, state, GUILD_ID);

  assert.deepEqual(runtime.played, ["alpha", "gamma", "delta"], "beta is not in the plan, gamma fails, delta plays");
  assert.equal(state.currentStationKey, "delta");
  assert.equal(state.desiredStationKey, "alpha");
  assert.equal(state.failoverActive, true);
  assert.equal(state.failoverFromStationKey, "alpha");
  assert.equal(state.failoverFailureCount, 0, "the failure window starts over on the backup");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(runtime.alerts, ["stream_failover_activated"]);
  assert.deepEqual(runtime.restarts, []);
});

test("an exhausted chain reports it and keeps retrying the preferred station", async () => {
  const runtime = createFailoverRuntime({ chain: ["beta", "gamma"], failing: ["alpha", "beta", "gamma"] });
  const state = unstableState();
  await restartRuntimeCurrentStation(runtime, state, GUILD_ID);

  assert.deepEqual(runtime.played, ["alpha", "beta", "gamma"]);
  assert.equal(state.failoverActive, undefined, "no backup took over");
  assert.equal(state.currentStationKey, "alpha");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(runtime.alerts, ["stream_failover_exhausted"]);
  assert.equal(runtime.restarts.length, 1);
  assert.equal(runtime.restarts[0].reason, "restart-error");
});

function createRestoreRuntime(state) {
  const plays = [];
  const channel = { id: "voice-1", name: "Radio", isVoiceBased: () => true };
  const guild = {
    id: GUILD_ID,
    name: "Guild Restore",
    channels: { cache: new Map([["voice-1", channel]]), fetch: async () => channel },
  };
  return {
    plays,
    config: { name: "OmniFM Restore", id: "bot-restore-failover" },
    guildState: new Map(),
    client: { guilds: { cache: new Map([[GUILD_ID, guild]]), fetch: async () => guild } },
    getState(guildId) {
      this.guildState.set(guildId, state);
      return state;
    },
    enforceGuildAccessForGuild: async () => true,
    resolveGuildLanguage: () => "de",
    resolveStationForGuild: (guildId, key) => ({ ok: true, key, station: CHAIN_STATIONS.stations[key], stations: CHAIN_STATIONS }),
    markScheduledEventPlayback() {},
    persistState() {},
    ensureVoiceConnectionForChannel: async (guildId, channelId, passedState) => {
      passedState.connection = { joinConfig: { channelId } };
    },
    playStation: async (passedState, stations, key, guildId, options) => {
      plays.push({ key, preserveDesiredStation: options?.preserveDesiredStation === true });
      passedState.currentStationKey = key;
    },
  };
}

async function withInstantTimers(fn) {
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback) => {
    callback();
    return { unref() {} };
  };
  try {
    return await fn();
  } finally {
    global.setTimeout = originalSetTimeout;
  }
}

test("a restore during a failover plays the backup and keeps the preferred station", async () => {
  const state = { volume: 100 };
  const runtime = createRestoreRuntime(state);
  const result = await withInstantTimers(() => restoreRuntimeGuildEntry(runtime, GUILD_ID, {
    channelId: "voice-1",
    stationKey: "beta",
    stationName: "Beta FM",
    desiredStationKey: "alpha",
    desiredStationName: "Alpha FM",
    failoverActive: true,
    failoverStartedAt: new Date(Date.now() - 600_000).toISOString(),
    failoverFromStationKey: "alpha",
    failoverReason: "Stream konnte nicht geladen werden: 503",
  }));

  assert.deepEqual(result, { ok: true });
  assert.deepEqual(runtime.plays, [{ key: "beta", preserveDesiredStation: true }]);
  assert.equal(state.failoverActive, true);
  assert.equal(state.desiredStationKey, "alpha");
  assert.equal(state.failoverFromStationKey, "alpha");
  assert.ok(state.failoverStartedAt > 0);
});

test("a restore drops a stale failover flag when the backup is the preferred station", async () => {
  const state = { volume: 100 };
  const runtime = createRestoreRuntime(state);
  await withInstantTimers(() => restoreRuntimeGuildEntry(runtime, GUILD_ID, {
    channelId: "voice-1",
    stationKey: "beta",
    desiredStationKey: "beta",
    failoverActive: true,
  }));
  assert.equal(state.failoverActive, false);
  assert.deepEqual(runtime.plays, [{ key: "beta", preserveDesiredStation: false }]);
});

test("a restore inside its cooldown waits and schedules the resume", async () => {
  const state = { volume: 100 };
  const runtime = createRestoreRuntime(state);
  const timers = [];
  const originalSetTimeout = global.setTimeout;
  global.setTimeout = (callback, delay) => {
    timers.push(delay);
    return { unref() {} };
  };
  try {
    const result = await restoreRuntimeGuildEntry(runtime, GUILD_ID, {
      channelId: "voice-1",
      stationKey: "alpha",
      restoreBlockedUntil: Date.now() + 90_000,
      restoreBlockReason: "worker-autoheal",
    });
    assert.equal(result.blocked, true);
    assert.equal(result.reason, "worker-autoheal");
    assert.deepEqual(runtime.plays, []);
    assert.equal(timers.length, 1);
    assert.ok(timers[0] > 80_000 && timers[0] <= 90_000);
  } finally {
    global.setTimeout = originalSetTimeout;
    runtime.pendingRestoreTimers?.clear();
  }
});
