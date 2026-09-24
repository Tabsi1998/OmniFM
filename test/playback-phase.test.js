import test from "node:test";
import assert from "node:assert/strict";

import {
  EXPECTED_TRANSITIONS,
  PLAYBACK_PHASES,
  derivePlaybackPhase,
  describePlaybackPhaseHistory,
  isExpectedTransition,
  notePlaybackPhase,
} from "../src/bot/playback-phase.js";

const player = (status) => ({ state: { status } });

test("the phase follows from the fields the runtime keeps", () => {
  assert.equal(derivePlaybackPhase(null), "idle");
  assert.equal(derivePlaybackPhase({}), "idle");
  assert.equal(derivePlaybackPhase({ currentStationKey: "alpha", voiceConnectInFlight: true }), "connecting");
  assert.equal(derivePlaybackPhase({ currentStationKey: "alpha", connection: {}, player: player("buffering") }), "starting");
  assert.equal(derivePlaybackPhase({ currentStationKey: "alpha", connection: {}, player: player("playing") }), "playing");
  assert.equal(derivePlaybackPhase({ currentStationKey: "alpha", connection: {}, player: player("paused") }), "paused");
  assert.equal(derivePlaybackPhase({ currentStationKey: "alpha", connection: {}, player: player("autopaused") }), "paused");
  assert.equal(derivePlaybackPhase({ currentStationKey: "alpha", connection: {}, player: player("playing"), streamRestartTimer: {} }), "recovering");
  assert.equal(derivePlaybackPhase({ shouldReconnect: true, currentStationKey: "alpha", connection: null, player: player("idle") }), "recovering");
  assert.equal(derivePlaybackPhase({ shouldReconnect: true, currentStationKey: "alpha", parkedReason: "permissions", reconnectTimer: {} }), "parked", "parked wins over a pending retry");
});

test("every phase has a transition table and the table only names known phases", () => {
  assert.deepEqual(Object.keys(EXPECTED_TRANSITIONS).sort(), [...PLAYBACK_PHASES].sort());
  for (const targets of Object.values(EXPECTED_TRANSITIONS)) {
    for (const target of targets) assert.ok(PLAYBACK_PHASES.includes(target), target);
  }
  assert.equal(isExpectedTransition("playing", "recovering"), true);
  assert.equal(isExpectedTransition("idle", "paused"), false, "nothing can be paused without playing first");
  assert.equal(isExpectedTransition("parked", "paused"), false);
});

test("a normal session records its transitions with reasons", () => {
  const state = { shouldReconnect: true, currentStationKey: "alpha", voiceConnectInFlight: true };
  const first = notePlaybackPhase(state, "play", 1_000);
  assert.deepEqual(first, { from: "idle", to: "connecting", at: 1_000, reason: "play", unexpected: false });

  state.voiceConnectInFlight = false;
  state.connection = {};
  state.player = player("buffering");
  notePlaybackPhase(state, "stream-start", 2_000);
  state.player = player("playing");
  notePlaybackPhase(state, "audio", 3_000);
  assert.equal(notePlaybackPhase(state, "audio", 3_500), null, "no change, no entry");

  state.streamRestartTimer = {};
  notePlaybackPhase(state, "stream-end", 4_000);
  delete state.streamRestartTimer;
  notePlaybackPhase(state, "restarted", 5_000);

  assert.equal(state.playbackPhase, "playing");
  assert.equal(state.playbackPhaseSince, 5_000);
  assert.deepEqual(state.playbackPhaseHistory.map((entry) => `${entry.from}>${entry.to}`),
    ["idle>connecting", "connecting>starting", "starting>playing", "playing>recovering", "recovering>playing"]);
  assert.ok(state.playbackPhaseHistory.every((entry) => entry.unexpected === false));
});

test("an unexpected transition is flagged and the history stays short", () => {
  const state = { playbackPhase: "idle", currentStationKey: "alpha", connection: {}, player: player("paused") };
  const transition = notePlaybackPhase(state, "odd", 1_000);
  assert.equal(transition.unexpected, true);

  for (let i = 0; i < 30; i += 1) {
    state.player = player(i % 2 ? "playing" : "paused");
    notePlaybackPhase(state, `toggle-${i}`, 2_000 + i);
  }
  assert.equal(state.playbackPhaseHistory.length, 12);
  const lines = describePlaybackPhaseHistory(state, { limit: 2 });
  assert.equal(lines.length, 2);
  assert.match(lines[1], /^paused → playing \(toggle-29\) <t:2:R>$/);
});

test("the runtime records a phase when it plans a stream restart", async () => {
  const { scheduleRuntimeStreamRestart } = await import("../src/bot/runtime-streams.js");
  const state = {
    shouldReconnect: true,
    currentStationKey: "alpha",
    connection: {},
    player: { state: { status: "playing" } },
    playbackPhase: "playing",
  };
  const runtime = {
    config: { name: "OmniFM Phase" },
    client: { guilds: { cache: new Map() } },
    restartCurrentStation: async () => {},
  };
  scheduleRuntimeStreamRestart(runtime, "guild-1", state, 60_000, "provider-eof");
  clearTimeout(state.streamRestartTimer);
  assert.equal(state.playbackPhase, "recovering");
  const last = state.playbackPhaseHistory.at(-1);
  assert.equal(last.reason, "restart:provider-eof");
  assert.equal(last.unexpected, false);
});

test("parking records the parked phase", async () => {
  const { parkRuntimeReconnectTarget } = await import("../src/bot/runtime-recovery.js");
  const state = { shouldReconnect: true, currentStationKey: "alpha", lastChannelId: "voice-1", playbackPhase: "recovering" };
  const runtime = {
    config: { id: "bot-phase", name: "OmniFM Phase" },
    client: { guilds: { cache: new Map() } },
    persistState() {},
    scheduleReconnect() {},
    getState: () => state,
  };
  parkRuntimeReconnectTarget(runtime, "guild-1", state, "permissions", "missing connect", { schedule: false });
  assert.equal(state.playbackPhase, "parked");
  assert.equal(state.playbackPhaseHistory.at(-1).reason, "parked:permissions");
});
