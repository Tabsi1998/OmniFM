import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// The runtime modules resolve their file stores at import time, so the
// scratch directory has to be in place before the first import.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-runtime-streams-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
process.env.STREAM_FAILBACK_CHECK_MS = "30000";
process.env.STREAM_FAILBACK_MAX_MS = "600000";
process.env.STREAM_FAILBACK_CONFIRMATIONS = "2";

const streams = await import("../src/bot/runtime-streams.js");
const {
  playRuntimeStation,
  evaluateRuntimeStreamHealth,
  shouldHandleRuntimeIdleEvent,
  runRuntimeFailbackProbe,
  armRuntimeFailbackProbe,
  isRuntimeFailbackPending,
  getRuntimeFailbackDelayMs,
  clearRuntimeFailbackTimer,
  clearRuntimeCurrentProcess,
} = streams;

const STATIONS = {
  qualityPreset: "custom",
  defaultStationKey: "alpha",
  locked: false,
  fallbackKeys: [],
  stations: {
    alpha: { name: "Alpha FM", url: "https://alpha.example.test/stream", tier: "free" },
    beta: { name: "Beta FM", url: "https://beta.example.test/stream", tier: "free" },
  },
};

function createFakePlayer() {
  const player = new EventEmitter();
  player.state = { status: "idle" };
  player.played = [];
  player.play = (resource) => {
    player.played.push(resource);
    player.state = { status: "playing", resource };
  };
  player.stop = () => {
    player.state = { status: "idle" };
  };
  player.pause = () => {
    player.state = { ...player.state, status: "paused" };
  };
  return player;
}

function createFakeProcess(label) {
  const proc = new EventEmitter();
  proc.label = label;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.killed = false;
  proc.kill = (signal) => {
    proc.killed = true;
    proc.killSignal = signal;
    return true;
  };
  return proc;
}

function createState(extra = {}) {
  return {
    player: createFakePlayer(),
    connection: { joinConfig: { channelId: "222222222222222222" } },
    currentStationKey: null,
    currentStationName: null,
    desiredStationKey: null,
    desiredStationName: null,
    failoverActive: false,
    failoverStartedAt: 0,
    failoverReason: null,
    failoverFromStationKey: null,
    failoverFromStationName: null,
    failoverFailureStationKey: null,
    failoverFailureCount: 0,
    failoverFailureStartedAt: 0,
    failoverLastFailureAt: 0,
    streamGeneration: 0,
    failbackTimer: null,
    failbackAttempts: 0,
    failbackSuccessCount: 0,
    failbackNextProbeAt: 0,
    failbackLastProbeAt: 0,
    failbackLastResult: null,
    currentMeta: null,
    lastChannelId: "222222222222222222",
    volume: 100,
    currentProcess: null,
    streamStableTimer: null,
    streamHealthTimer: null,
    lastStreamErrorAt: null,
    lastHealthcheckFailureAt: null,
    reconnectTimer: null,
    streamRestartTimer: null,
    streamRestartInFlight: false,
    streamRestartScheduledAt: 0,
    streamRestartScheduledReason: null,
    streamRestartScheduledDelayMs: 0,
    shouldReconnect: true,
    streamErrorCount: 0,
    idleRestartStreak: 0,
    lastIdleRestartAt: 0,
    lastStreamStartAt: null,
    lastProcessExitCode: null,
    lastProcessExitDetail: null,
    lastProcessExitAt: 0,
    lastNetworkFailureAt: 0,
    lastStreamEndReason: null,
    streamHealthStartedAt: 0,
    lastAudioPacketAt: 0,
    ignoreNextIdleEvent: false,
    nowPlayingSignature: null,
    reconnectInFlight: false,
    voiceConnectInFlight: false,
    reconnectAttempts: 0,
    ...extra,
  };
}

function createFakeRuntime(overrides = {}) {
  const calls = { scheduleStreamRestart: [], persist: 0, created: [] };
  let processCounter = 0;
  const runtime = {
    config: { id: "bot-1", name: "TestBot", clientId: "100000000000000001" },
    role: "worker",
    client: { guilds: { cache: new Map() }, user: null },
    calls,
    async createStreamResource(url, volume, preset, botName, bitrate, scope, options = {}) {
      processCounter += 1;
      const process = createFakeProcess(`p${processCounter}`);
      calls.created.push({ url, options, currentProcessAtCall: this.__stateForCreate?.currentProcess || null });
      return { resource: { url, metadata: options?.metadata || null }, process };
    },
    async fetchStreamInfo() {
      return {};
    },
    trackProcessLifecycle(guildId, state, process) {
      return streams.trackRuntimeProcessLifecycle(this, guildId, state, process);
    },
    clearCurrentProcess(state) {
      return clearRuntimeCurrentProcess(this, state);
    },
    armStreamStabilityReset() {},
    updatePresence() {},
    persistState() {
      calls.persist += 1;
    },
    startNowPlayingLoop() {},
    async syncVoiceChannelStatus() {
      return null;
    },
    getCurrentListenerCount() {
      return 0;
    },
    scheduleStreamRestart(guildId, state, delayMs, reason) {
      calls.scheduleStreamRestart.push({ guildId, delayMs, reason });
    },
    resolveGuildLanguage() {
      return "de";
    },
    getNetworkRecoveryScope() {
      return "test-scope";
    },
    getNetworkRecoveryDelayMs() {
      return 0;
    },
    noteNetworkRecoveryFailure() {},
    noteNetworkRecoverySuccess() {},
    isScheduledEventStopDue() {
      return false;
    },
    normalizeNowPlayingValue(value) {
      return value ? String(value) : null;
    },
    recordSongHistory() {},
    resolveStationForGuild(guildId, key) {
      const station = STATIONS.stations[key];
      if (!station) return { ok: false, message: `Station ${key} wurde nicht gefunden.` };
      return { ok: true, key, station, stations: STATIONS, isCustom: false };
    },
    playStation(state, stations, key, guildId, options = {}) {
      return playRuntimeStation(this, state, stations, key, guildId, options);
    },
    ...overrides,
  };
  return runtime;
}

function cleanup(state) {
  clearRuntimeFailbackTimer(state);
  if (state.streamRestartTimer) {
    clearTimeout(state.streamRestartTimer);
    state.streamRestartTimer = null;
  }
  clearRuntimeCurrentProcess({ config: { name: "cleanup" } }, state);
}

test("station switch loads the new source before the old stream is killed and never restarts twice", async () => {
  const runtime = createFakeRuntime();
  const state = createState();
  const guildId = "123456789012345678";

  await playRuntimeStation(runtime, state, STATIONS, "alpha", guildId, { countAsStart: true });
  const firstProcess = state.currentProcess;
  const firstResource = state.player.played[0];
  assert.equal(state.currentStationKey, "alpha");
  assert.equal(state.streamGeneration, 1);
  assert.equal(firstResource.metadata.generation, 1);

  // A restart that was pending for the first stream must be dropped by the switch.
  state.streamRestartTimer = setTimeout(() => {}, 60_000);
  state.streamRestartTimer.unref?.();
  state.streamRestartScheduledAt = Date.now() + 60_000;

  let firstProcessKilledDuringCreate = null;
  runtime.createStreamResource = async function (url, volume, preset, botName, bitrate, scope, options = {}) {
    firstProcessKilledDuringCreate = firstProcess.killed;
    const process = createFakeProcess("p2");
    return { resource: { url, metadata: options?.metadata || null }, process };
  };

  await playRuntimeStation(runtime, state, STATIONS, "beta", guildId, { countAsStart: true });

  assert.equal(firstProcessKilledDuringCreate, false, "old ffmpeg must keep running while the new source loads");
  assert.equal(firstProcess.killed, true, "old ffmpeg is killed after the swap");
  assert.equal(firstProcess.killSignal, "SIGKILL");
  assert.notEqual(state.currentProcess, firstProcess);
  assert.equal(state.currentProcess.killed, false);
  assert.equal(state.currentStationKey, "beta");
  assert.equal(state.streamGeneration, 2);
  assert.equal(state.player.played.length, 2);
  assert.equal(state.player.played[1].metadata.generation, 2);
  assert.equal(state.streamRestartTimer, null, "pending restart of the replaced stream is cleared");
  assert.equal(state.streamRestartScheduledAt, 0);

  // The Idle event that the replaced resource would emit belongs to generation 1.
  assert.equal(shouldHandleRuntimeIdleEvent(state, { status: "playing", resource: firstResource }), false);
  assert.equal(shouldHandleRuntimeIdleEvent(state, { status: "playing", resource: state.player.played[1] }), true);
  assert.equal(shouldHandleRuntimeIdleEvent(state, { status: "playing" }), true, "resources without metadata are handled as before");

  // Late bookkeeping of the replaced process does not leak into the current stream.
  const healthTimerBefore = state.streamHealthTimer;
  assert.ok(healthTimerBefore, "the new stream has a health monitor");
  firstProcess.emit("close", 1);
  assert.equal(state.lastProcessExitCode, null);
  assert.equal(state.lastStreamErrorAt, null);
  assert.equal(state.currentProcess?.label, "p2");
  assert.equal(state.streamHealthTimer, healthTimerBefore, "health monitor of the current stream survives the stale exit");

  cleanup(state);
});

test("a failed switch leaves the current stream playing", async () => {
  const runtime = createFakeRuntime();
  const state = createState();
  const guildId = "123456789012345678";

  await playRuntimeStation(runtime, state, STATIONS, "alpha", guildId);
  const firstProcess = state.currentProcess;

  runtime.createStreamResource = async () => {
    throw new Error("Stream konnte nicht geladen werden: 503");
  };

  await assert.rejects(playRuntimeStation(runtime, state, STATIONS, "beta", guildId), /503/);
  assert.equal(firstProcess.killed, false);
  assert.equal(state.currentProcess, firstProcess);
  assert.equal(state.currentStationKey, "alpha");
  assert.equal(state.streamGeneration, 1);
  assert.equal(state.player.played.length, 1);

  cleanup(state);
});

test("ignoreNextIdleEvent still suppresses exactly one idle event", () => {
  const state = createState({ ignoreNextIdleEvent: true, streamGeneration: 3 });
  assert.equal(shouldHandleRuntimeIdleEvent(state, { status: "playing" }), false);
  assert.equal(state.ignoreNextIdleEvent, false);
  assert.equal(shouldHandleRuntimeIdleEvent(state, { status: "playing" }), true);
});

test("stream healthcheck leaves a paused stream alone but still restarts a stalled one", async () => {
  const runtime = createFakeRuntime();
  const nowMs = Date.now();
  const guildId = "123456789012345678";

  const pausedProcess = createFakeProcess("paused");
  const paused = createState({
    currentStationKey: "alpha",
    currentStationName: "Alpha FM",
    currentProcess: pausedProcess,
    streamHealthStartedAt: nowMs - 300_000,
    lastStreamStartAt: nowMs - 300_000,
    lastAudioPacketAt: nowMs - 120_000,
  });
  paused.player.state = { status: "paused", resource: {} };

  const pausedResult = await evaluateRuntimeStreamHealth(runtime, guildId, paused, pausedProcess, { nowMs });
  assert.deepEqual(pausedResult, { ok: true, skipped: "paused" });
  assert.equal(pausedProcess.killed, false);
  assert.equal(paused.lastAudioPacketAt, nowMs, "paused time is not counted as silence");
  assert.equal(runtime.calls.scheduleStreamRestart.length, 0);

  const autoPausedProcess = createFakeProcess("autopaused");
  const autoPaused = createState({
    currentStationKey: "alpha",
    currentProcess: autoPausedProcess,
    streamHealthStartedAt: nowMs - 300_000,
    lastAudioPacketAt: nowMs - 120_000,
  });
  autoPaused.player.state = { status: "autopaused", resource: {} };
  const autoPausedResult = await evaluateRuntimeStreamHealth(runtime, guildId, autoPaused, autoPausedProcess, { nowMs });
  assert.equal(autoPausedResult.skipped, "paused");
  assert.equal(autoPausedProcess.killed, false);

  const stalledProcess = createFakeProcess("stalled");
  const stalled = createState({
    currentStationKey: "alpha",
    currentStationName: "Alpha FM",
    currentProcess: stalledProcess,
    streamHealthStartedAt: nowMs - 300_000,
    lastStreamStartAt: nowMs - 300_000,
    lastAudioPacketAt: nowMs - 120_000,
  });
  stalled.player.state = { status: "playing", resource: {} };
  const stalledResult = await evaluateRuntimeStreamHealth(runtime, guildId, stalled, stalledProcess, { nowMs });
  assert.equal(stalledResult.action, "restart");
  assert.equal(stalledProcess.killed, true);
  assert.equal(runtime.calls.scheduleStreamRestart.length, 1);
  assert.equal(runtime.calls.scheduleStreamRestart[0].reason, "stream-health-stalled");
});

test("failback returns to the preferred station after two successful probes", async () => {
  const probes = [];
  const runtime = createFakeRuntime({
    async probeStreamUrl(url) {
      probes.push(url);
      return { ok: true, bytes: 2048 };
    },
  });
  const guildId = "123456789012345678";
  const state = createState({
    currentStationKey: "beta",
    currentStationName: "Beta FM",
    desiredStationKey: "alpha",
    desiredStationName: "Alpha FM",
    failoverActive: true,
    failoverStartedAt: Date.now() - 600_000,
    failoverFromStationKey: "alpha",
    failoverFromStationName: "Alpha FM",
    currentProcess: createFakeProcess("fallback"),
  });
  state.player.state = { status: "playing", resource: {} };

  assert.equal(isRuntimeFailbackPending(state), true);

  const first = await runRuntimeFailbackProbe(runtime, guildId, state);
  assert.equal(first.ok, true);
  assert.equal(first.confirmed, false);
  assert.equal(state.failbackSuccessCount, 1);
  assert.ok(state.failbackTimer, "a confirmation probe is scheduled");
  assert.ok(state.failbackNextProbeAt > Date.now());
  clearRuntimeFailbackTimer(state);

  const second = await runRuntimeFailbackProbe(runtime, guildId, state);
  assert.equal(second.switched, true);
  assert.equal(second.stationKey, "alpha");
  assert.deepEqual(probes, [STATIONS.stations.alpha.url, STATIONS.stations.alpha.url]);
  assert.equal(state.currentStationKey, "alpha");
  assert.equal(state.desiredStationKey, "alpha");
  assert.equal(state.failoverActive, false);
  assert.equal(state.failoverFromStationKey, null);
  assert.equal(state.failbackTimer, null);
  assert.equal(state.failbackAttempts, 0);
  assert.equal(state.streamRestartInFlight, false);
  assert.equal(state.player.played.at(-1).metadata.stationKey, "alpha");

  cleanup(state);
});

test("failback backs off while the preferred station stays down and resets on the next success", async () => {
  let probeResult = { ok: false, reason: "http-503" };
  const runtime = createFakeRuntime({
    async probeStreamUrl() {
      return probeResult;
    },
  });
  const guildId = "123456789012345678";
  const state = createState({
    currentStationKey: "beta",
    desiredStationKey: "alpha",
    failoverActive: true,
    currentProcess: createFakeProcess("fallback"),
  });
  state.player.state = { status: "playing", resource: {} };

  const first = await runRuntimeFailbackProbe(runtime, guildId, state);
  assert.equal(first.ok, false);
  assert.equal(state.failbackAttempts, 1);
  assert.equal(state.failbackLastResult, "http-503");
  assert.equal(state.currentStationKey, "beta");
  assert.equal(state.failoverActive, true);
  assert.ok(state.failbackTimer);
  clearRuntimeFailbackTimer(state);

  assert.equal(getRuntimeFailbackDelayMs(0, { checkMs: 30_000, maxMs: 600_000 }), 30_000);
  assert.equal(getRuntimeFailbackDelayMs(3, { checkMs: 30_000, maxMs: 600_000 }), 240_000);
  assert.equal(getRuntimeFailbackDelayMs(9, { checkMs: 30_000, maxMs: 600_000 }), 600_000);

  probeResult = { ok: true, bytes: 1 };
  const recovered = await runRuntimeFailbackProbe(runtime, guildId, state);
  assert.equal(recovered.confirmed, false);
  assert.equal(state.failbackSuccessCount, 1);
  probeResult = { ok: false, reason: "no-audio-data" };
  clearRuntimeFailbackTimer(state);
  await runRuntimeFailbackProbe(runtime, guildId, state);
  assert.equal(state.failbackSuccessCount, 0, "one failed probe resets the confirmation streak");
  assert.equal(state.failbackAttempts, 2);

  cleanup(state);
});

test("failback gives up when the preferred station is no longer available and keeps the current one", async () => {
  const runtime = createFakeRuntime({
    async probeStreamUrl() {
      throw new Error("probe must not run for an unresolvable station");
    },
  });
  const guildId = "123456789012345678";
  const state = createState({
    currentStationKey: "beta",
    currentStationName: "Beta FM",
    desiredStationKey: "gone",
    desiredStationName: "Gone FM",
    failoverActive: true,
    currentProcess: createFakeProcess("fallback"),
  });
  state.player.state = { status: "playing", resource: {} };

  const result = await runRuntimeFailbackProbe(runtime, guildId, state);
  assert.equal(result.abandoned, true);
  assert.equal(state.failoverActive, false);
  assert.equal(state.desiredStationKey, "beta");
  assert.equal(state.desiredStationName, "Beta FM");
  assert.equal(state.failbackLastResult, "abandoned");
  assert.equal(state.failbackTimer, null);
  assert.equal(isRuntimeFailbackPending(state), false);

  cleanup(state);
});

test("failback probe waits while a restart or reconnect is in flight", async () => {
  let probes = 0;
  const runtime = createFakeRuntime({
    async probeStreamUrl() {
      probes += 1;
      return { ok: true, bytes: 10 };
    },
  });
  const guildId = "123456789012345678";
  const state = createState({
    currentStationKey: "beta",
    desiredStationKey: "alpha",
    failoverActive: true,
    reconnectInFlight: true,
  });

  const result = await runRuntimeFailbackProbe(runtime, guildId, state);
  assert.equal(result.skipped, "recovery");
  assert.equal(probes, 0);
  assert.ok(state.failbackTimer, "the probe is rescheduled instead of dropped");
  cleanup(state);
});

test("failback probe waits while the stream is paused", async () => {
  let probes = 0;
  const runtime = createFakeRuntime({
    async probeStreamUrl() {
      probes += 1;
      return { ok: true, bytes: 10 };
    },
  });
  const state = createState({
    currentStationKey: "beta",
    desiredStationKey: "alpha",
    failoverActive: true,
    currentProcess: createFakeProcess("fallback"),
  });
  state.player.state = { status: "paused", resource: {} };

  const result = await runRuntimeFailbackProbe(runtime, "123456789012345678", state);
  assert.equal(result.skipped, "paused");
  assert.equal(probes, 0);
  assert.equal(state.currentStationKey, "beta");
  assert.ok(state.failbackTimer);
  cleanup(state);
});

test("armRuntimeFailbackProbe only arms while a failover is active", () => {
  const runtime = createFakeRuntime();
  const idle = createState({ currentStationKey: "alpha", desiredStationKey: "alpha" });
  assert.equal(armRuntimeFailbackProbe(runtime, "1", idle), false);
  assert.equal(idle.failbackTimer, null);

  const active = createState({ currentStationKey: "beta", desiredStationKey: "alpha", failoverActive: true });
  assert.equal(armRuntimeFailbackProbe(runtime, "1", active), true);
  assert.ok(active.failbackTimer);
  assert.ok(active.failbackNextProbeAt >= Date.now() + 1_000);
  clearRuntimeFailbackTimer(active);
  assert.equal(active.failbackTimer, null);
  assert.equal(active.failbackNextProbeAt, 0);
});
