import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// File stores resolve their paths at import time, so the scratch directory
// has to exist before the runtime modules are loaded.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-parked-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
process.env.OMNIFM_BOT_STATE_FILE = path.join(scratchDir, "bot-state.json");
process.env.VOICE_PARKED_RETRY_MS = String(15 * 60_000);
process.env.VOICE_RECONNECT_PERMISSION_CONFIRMATIONS = "3";

const recovery = await import("../src/bot/runtime-recovery.js");
const botState = await import("../src/bot-state.js");
const {
  tryRuntimeReconnect,
  parkRuntimeReconnectTarget,
  clearRuntimeParkedState,
  resetRuntimeVoiceSession,
} = recovery;

function createState(extra = {}) {
  return {
    player: { state: { status: "idle" }, stop() { this.state = { status: "idle" }; } },
    connection: null,
    currentStationKey: "alpha",
    currentStationName: "Alpha FM",
    desiredStationKey: "alpha",
    desiredStationName: "Alpha FM",
    lastChannelId: "222222222222222222",
    shouldReconnect: true,
    reconnectAttempts: 4,
    reconnectCircuitTripCount: 1,
    reconnectCircuitOpenUntil: 0,
    reconnectTimer: null,
    reconnectInFlight: false,
    voiceConnectInFlight: false,
    activeScheduledEventStopAtMs: 0,
    transientVoiceIssues: {},
    parkedReason: null,
    parkedAt: 0,
    parkedDetail: null,
    ...extra,
  };
}

function createRuntime(state, { channelPermissions = true } = {}) {
  const channel = {
    id: "222222222222222222",
    name: "radio",
    type: 2,
    isVoiceBased: () => true,
    permissionsFor: () => ({ has: () => channelPermissions }),
  };
  const guild = {
    id: "123456789012345678",
    name: "Guild One",
    channels: { cache: new Map([[channel.id, channel]]), fetch: async () => channel },
    voiceAdapterCreator: () => ({ sendPayload: () => true, destroy() {} }),
  };
  const scheduled = [];
  return {
    config: { id: "bot-1", name: "TestBot", clientId: "100000000000000001" },
    role: "worker",
    voiceGroup: "bot-test",
    client: {
      guilds: { cache: new Map([[guild.id, guild]]), fetch: async () => guild },
      isReady: () => true,
    },
    scheduled,
    getState() {
      return state;
    },
    isScheduledEventStopDue() {
      return false;
    },
    async resolveBotMember() {
      return { id: "bot" };
    },
    getNetworkRecoveryDelayMs() {
      return 0;
    },
    noteNetworkRecoveryFailure() {},
    noteNetworkRecoverySuccess() {},
    persistState() {},
    clearReconnectTimer(s) {
      if (s.reconnectTimer) {
        clearTimeout(s.reconnectTimer);
        s.reconnectTimer = null;
      }
    },
    clearNowPlayingTimer() {},
    clearCurrentProcess() {},
    clearQueuedVoiceReconcile() {},
    invalidateVoiceStatus() {},
    async syncVoiceChannelStatus() {
      return null;
    },
    updatePresence() {},
    clearScheduledEventPlayback() {},
    resetVoiceSession(guildId, s, options) {
      return resetRuntimeVoiceSession(this, guildId, s, options);
    },
    scheduleReconnect(guildId, options) {
      scheduled.push(options);
    },
  };
}

test("missing permissions park the target instead of deleting it", async () => {
  const state = createState({
    transientVoiceIssues: {
      "reconnect-permissions-missing": { count: 2, firstSeenAt: 1, lastSeenAt: 1, lastDetail: "" },
    },
  });
  const runtime = createRuntime(state, { channelPermissions: false });

  const result = await tryRuntimeReconnect(runtime, "123456789012345678");

  assert.equal(result.attempted, false);
  assert.equal(result.retryRecommended, true, "the caller keeps scheduling, at the parked cadence");
  assert.equal(result.reason, "permissions-parked");
  assert.equal(result.minDelayMs, 15 * 60_000);
  assert.equal(state.parkedReason, "permissions");
  assert.ok(state.parkedAt > 0);
  assert.match(String(state.parkedDetail), /permissions still missing/);
  assert.equal(state.currentStationKey, "alpha", "the station survives");
  assert.equal(state.lastChannelId, "222222222222222222", "the channel survives");
  assert.equal(state.shouldReconnect, true);
  assert.equal(state.reconnectAttempts, 0);
  assert.equal(state.reconnectCircuitTripCount, 0);
  assert.deepEqual(state.transientVoiceIssues, {}, "issue counters restart for the next cycle");
  assert.equal(state.reconnectInFlight, false);
});

test("parking keeps the first parkedAt across repeated parks and a manual clear resets everything", () => {
  const state = createState();
  const runtime = createRuntime(state);
  const originalSetTimeout = global.setTimeout;
  const timers = [];
  global.setTimeout = (fn, delay) => {
    const timer = { fn, delay, unref() {} };
    timers.push(timer);
    return timer;
  };
  try {
    parkRuntimeReconnectTarget(runtime, "123456789012345678", state, "circuit", "first");
    const firstParkedAt = state.parkedAt;
    assert.equal(state.parkedReason, "circuit");
    assert.equal(timers.length, 1, "a slow retry is scheduled");
    assert.ok(timers[0].delay >= 15 * 60_000);
    assert.equal(state.reconnectTimer, timers[0]);

    state.reconnectTimer = null;
    parkRuntimeReconnectTarget(runtime, "123456789012345678", state, "voice-ready", "second", { schedule: false });
    assert.equal(state.parkedReason, "voice-ready");
    assert.equal(state.parkedAt, firstParkedAt, "parkedAt marks the start of the whole parked period");
    assert.equal(state.parkedDetail, "second");
    assert.equal(timers.length, 1, "schedule: false leaves scheduling to the caller");

    assert.equal(clearRuntimeParkedState(state), true);
    assert.equal(state.parkedReason, null);
    assert.equal(state.parkedAt, 0);
    assert.equal(clearRuntimeParkedState(state), false);
  } finally {
    global.setTimeout = originalSetTimeout;
  }
});

test("dropping the playback target also clears the parked state", () => {
  const state = createState({ parkedReason: "permissions", parkedAt: 5, parkedDetail: "x" });
  const runtime = createRuntime(state);
  resetRuntimeVoiceSession(runtime, "123456789012345678", state, { preservePlaybackTarget: false, clearLastChannel: true });
  assert.equal(state.parkedReason, null);
  assert.equal(state.currentStationKey, null);
  assert.equal(state.lastChannelId, null);
});

test("the parked state is persisted with the target and normalized on load", () => {
  const guildStates = new Map([
    ["123456789012345678", {
      currentStationKey: "alpha",
      currentStationName: "Alpha FM",
      desiredStationKey: "alpha",
      lastChannelId: "222222222222222222",
      volume: 80,
      volumePreferenceSet: true,
      parkedReason: "Permissions",
      parkedAt: 1_700_000_000_000,
      parkedDetail: "permissions still missing after 6 checks",
    }],
    ["223456789012345678", {
      currentStationKey: "beta",
      lastChannelId: "333333333333333333",
      volume: 100,
      parkedReason: null,
    }],
  ]);
  botState.saveBotState("bot-1", guildStates);
  const loaded = botState.getBotState("bot-1");

  assert.equal(loaded["123456789012345678"].parkedReason, "permissions");
  assert.equal(loaded["123456789012345678"].parkedAt, 1_700_000_000_000);
  assert.equal(loaded["123456789012345678"].parkedDetail, "permissions still missing after 6 checks");
  assert.equal("parkedReason" in loaded["223456789012345678"], false, "unparked targets carry no parked fields");
});
