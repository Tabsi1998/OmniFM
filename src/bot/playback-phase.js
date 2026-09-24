// Playback phases of one server (#210).
//
// The playback state is a loose object that many modules change: player
// events, the stream restart, reconnects, failback, parking, stop. Bugs such as
// #188 came from transitions nobody expected. This module names the phases,
// derives the current one from the state, lists the transitions that are
// expected, and keeps a short history per server, so /diag and the logs can
// show how a server got where it is and flag a transition that should not
// happen.
//
// Phases:
//   idle        no playback target
//   connecting  joining the voice channel
//   starting    the stream of a station is starting
//   playing     audio flows (also while a backup station plays, see failoverActive)
//   paused      paused by a listener
//   recovering  a restart or reconnect is scheduled or running
//   parked      the target is paused after repeated failures, retried slowly

import { log } from "../lib/logging.js";
import { recordUnexpectedPlaybackTransition } from "../services/operator-alerts.js";

const PLAYBACK_PHASES = Object.freeze(["idle", "connecting", "starting", "playing", "paused", "recovering", "parked"]);

const EXPECTED_TRANSITIONS = Object.freeze({
  idle: ["connecting", "starting", "playing"],
  connecting: ["starting", "playing", "recovering", "parked", "idle"],
  starting: ["playing", "recovering", "parked", "idle", "paused"],
  playing: ["starting", "paused", "recovering", "parked", "idle"],
  paused: ["playing", "starting", "recovering", "idle"],
  recovering: ["connecting", "starting", "playing", "recovering", "parked", "idle"],
  parked: ["connecting", "starting", "playing", "recovering", "idle"],
});

const HISTORY_LIMIT = 12;

function playerStatus(state) {
  return String(state?.player?.state?.status || "").trim().toLowerCase();
}

/** The phase the state is in right now, derived from the fields the runtime already keeps. */
function derivePlaybackPhase(state) {
  if (!state || typeof state !== "object") return "idle";
  const hasTarget = Boolean(state.currentStationKey) || state.shouldReconnect === true;
  if (!hasTarget) return "idle";
  if (state.parkedReason) return "parked";
  if (state.voiceConnectInFlight === true) return "connecting";
  if (state.reconnectInFlight === true || state.reconnectTimer || state.streamRestartInFlight === true || state.streamRestartTimer) {
    return "recovering";
  }
  const status = playerStatus(state);
  if (status === "paused" || status === "autopaused") return "paused";
  if (status === "playing") return "playing";
  if (status === "buffering") return "starting";
  if (state.shouldReconnect === true && !state.connection) return "recovering";
  return "starting";
}

function isExpectedTransition(from, to) {
  if (from === to) return true;
  return (EXPECTED_TRANSITIONS[from] || []).includes(to);
}

/**
 * Records the current phase on the state. Returns the transition when the
 * phase changed, else null. `unexpected` is true for a transition outside the
 * table, which the caller may log.
 */
function notePlaybackPhase(state, reason = "", now = Date.now()) {
  if (!state || typeof state !== "object") return null;
  const to = derivePlaybackPhase(state);
  const from = PLAYBACK_PHASES.includes(state.playbackPhase) ? state.playbackPhase : "idle";
  if (from === to && state.playbackPhase) return null;
  const transition = {
    from,
    to,
    at: now,
    reason: String(reason || "").slice(0, 80),
    unexpected: !isExpectedTransition(from, to),
  };
  state.playbackPhase = to;
  state.playbackPhaseSince = now;
  const history = Array.isArray(state.playbackPhaseHistory) ? state.playbackPhaseHistory : [];
  history.push(transition);
  state.playbackPhaseHistory = history.slice(-HISTORY_LIMIT);
  return transition;
}

/**
 * notePlaybackPhase for the runtime: a transition outside the table is logged
 * as a warning with the server, so it shows up in the owner console logs.
 */
function recordPlaybackPhase(runtime, guildId, state, reason = "") {
  const transition = notePlaybackPhase(state, reason);
  if (transition?.unexpected) {
    log(
      "WARN",
      `[${runtime?.config?.name || "OmniFM"}] Unerwarteter Wiedergabe-Übergang guild=${guildId || "-"}: ` +
      `${transition.from} -> ${transition.to} (${transition.reason || "-"})`
    );
    // A few of these in a short time mean the playback goes round in circles (#260).
    recordUnexpectedPlaybackTransition(guildId, transition, { runtimeName: runtime?.config?.name });
  }
  return transition;
}

/** One line per recent transition, newest last, for /diag. */
function describePlaybackPhaseHistory(state, { limit = 5, t = (de) => de } = {}) {
  const history = Array.isArray(state?.playbackPhaseHistory) ? state.playbackPhaseHistory.slice(-limit) : [];
  return history.map((entry) => {
    const when = `<t:${Math.floor(Number(entry.at || 0) / 1000)}:R>`;
    const flag = entry.unexpected ? t(" (unerwartet)", " (unexpected)") : "";
    return `${entry.from} → ${entry.to}${entry.reason ? ` (${entry.reason})` : ""} ${when}${flag}`;
  });
}

export {
  EXPECTED_TRANSITIONS,
  PLAYBACK_PHASES,
  derivePlaybackPhase,
  describePlaybackPhaseHistory,
  isExpectedTransition,
  notePlaybackPhase,
  recordPlaybackPhase,
};
