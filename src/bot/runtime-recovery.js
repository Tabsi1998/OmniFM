import { ChannelType, PermissionFlagsBits } from "discord.js";
import {
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";

import { log, logError } from "../lib/logging.js";
import { recordRuntimeIncident } from "../runtime-incidents-store.js";

import {
  applyJitter,
  isLikelyNetworkFailureLine,
  VOICE_RECONNECT_MAX_MS,
  VOICE_RECONNECT_EXP_STEPS,
} from "../lib/helpers.js";

import { getServerPlanConfig } from "../core/entitlements.js";
import { networkRecoveryCoordinator } from "../core/network-recovery.js";
import {
  VOICE_GUARD_DEFAULT_POLICY,
  VOICE_GUARD_MOVE_CONFIRMATIONS,
  VOICE_GUARD_RETURN_COOLDOWN_MS,
  VOICE_GUARD_WINDOW_MS,
  VOICE_GUARD_MAX_EVENTS_PER_WINDOW,
  VOICE_GUARD_ESCALATION,
  VOICE_GUARD_ESCALATION_COOLDOWN_MS,
} from "../lib/voice-guard.js";
import {
  recordStationStop,
  recordConnectionEvent,
} from "../listening-stats-store.js";
import { isRuntimeVoiceConnected } from "./runtime-live-state.js";
import { clearActiveFailover, clearFailoverFailureWindow } from "../lib/stream-failover-policy.js";
import {
  clearRuntimeRestoreRetry,
} from "./runtime-restore.js";
import { recordPlaybackPhase } from "./playback-phase.js";
// Moved to runtime-voice-reconcile.js (#210); re-exported for existing importers.
export {
  clearQueuedRuntimeVoiceReconcile,
  queueRuntimeVoiceStateReconcile,
  confirmRuntimeBotVoiceChannel,
  fetchRuntimeBotVoiceState,
  reconcileRuntimeGuildVoiceState,
  tickRuntimeVoiceStateHealth,
  startRuntimeVoiceStateReconciler,
  stopRuntimeVoiceStateReconciler,
} from "./runtime-voice-reconcile.js";
// Moved to runtime-restore.js (#210); re-exported for existing importers.
export {
  clearRuntimeRestoreRetry,
  restoreRuntimeGuildEntry,
  restoreRuntimeState,
} from "./runtime-restore.js";

export function toPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? fallbackValue), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

export const VOICE_TRANSIENT_RECHECK_MS = Math.max(2_000, toPositiveInt(process.env.VOICE_TRANSIENT_RECHECK_MS, 5_000));
const VOICE_RECONNECT_RESOURCE_CONFIRMATIONS = Math.max(2, toPositiveInt(process.env.VOICE_RECONNECT_RESOURCE_CONFIRMATIONS, 3));
const VOICE_RECONNECT_PERMISSION_CONFIRMATIONS = Math.max(
  VOICE_RECONNECT_RESOURCE_CONFIRMATIONS,
  toPositiveInt(process.env.VOICE_RECONNECT_PERMISSION_CONFIRMATIONS, 6)
);
const VOICE_RECONNECT_READY_FAILURE_CONFIRMATIONS = Math.max(
  2,
  toPositiveInt(process.env.VOICE_RECONNECT_READY_FAILURE_CONFIRMATIONS, 4)
);
const VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS = Math.max(
  5,
  toPositiveInt(process.env.VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS, 30)
);
const VOICE_RECONNECT_CIRCUIT_BREAKER_MS = Math.max(
  60_000,
  toPositiveInt(process.env.VOICE_RECONNECT_CIRCUIT_BREAKER_MS, 15 * 60_000)
);
const VOICE_RECONNECT_MAX_CIRCUIT_TRIPS = Math.max(
  1,
  toPositiveInt(process.env.VOICE_RECONNECT_MAX_CIRCUIT_TRIPS, 3)
);
const VOICE_NETWORK_ERROR_RETRY_MIN_MS = 15_000;
const VOICE_NETWORK_ERROR_RETRY_JITTER = 0.6;
const VOICE_RECONNECT_RESCHEDULE_SLACK_MS = 1_000;
// Retry cadence for a parked reconnect target (#190).
const VOICE_PARKED_RETRY_MS = Math.max(60_000, toPositiveInt(process.env.VOICE_PARKED_RETRY_MS, 15 * 60_000));

const PERMANENT_RESTORE_GUILD_ERROR_CODES = new Set([10004, 50001]);
const PERMANENT_RESTORE_CHANNEL_ERROR_CODES = new Set([10003]);

function getVoiceMovePolicy() {
  return VOICE_GUARD_DEFAULT_POLICY;
}

function getExpectedRuntimeChannelId(state) {
  const connectionChannelId = String(state?.connection?.joinConfig?.channelId || "").trim();
  if (connectionChannelId) return connectionChannelId;
  const lastChannelId = String(state?.lastChannelId || "").trim();
  return lastChannelId || null;
}

export function getRuntimeVoiceGuardConfig(state) {
  const hasExplicitVoiceGuardState = Boolean(
    state?.voiceGuardAvailable === true
    || state?.voiceGuardPolicy
    || state?.voiceGuardEffectivePolicy
  );
  if (!hasExplicitVoiceGuardState) {
    return {
      policy: getVoiceMovePolicy(),
      configuredPolicy: "default",
      moveConfirmations: Math.max(1, VOICE_GUARD_MOVE_CONFIRMATIONS),
      returnCooldownMs: Math.max(0, VOICE_GUARD_RETURN_COOLDOWN_MS),
      moveWindowMs: Math.max(5_000, VOICE_GUARD_WINDOW_MS),
      maxMovesPerWindow: Math.max(2, VOICE_GUARD_MAX_EVENTS_PER_WINDOW),
      escalation: String(VOICE_GUARD_ESCALATION).trim().toLowerCase() === "cooldown" ? "cooldown" : "disconnect",
      escalationCooldownMs: Math.max(60_000, VOICE_GUARD_ESCALATION_COOLDOWN_MS),
    };
  }
  const policy = String(state?.voiceGuardEffectivePolicy || getVoiceMovePolicy()).trim().toLowerCase();
  return {
    policy: policy === "allow" || policy === "disconnect" ? policy : "return",
    configuredPolicy: String(state?.voiceGuardPolicy || "default").trim().toLowerCase() || "default",
    moveConfirmations: Math.max(1, Number(state?.voiceGuardMoveConfirmations || VOICE_GUARD_MOVE_CONFIRMATIONS) || VOICE_GUARD_MOVE_CONFIRMATIONS),
    returnCooldownMs: Math.max(0, Number(state?.voiceGuardReturnCooldownMs || VOICE_GUARD_RETURN_COOLDOWN_MS) || VOICE_GUARD_RETURN_COOLDOWN_MS),
    moveWindowMs: Math.max(5_000, Number(state?.voiceGuardMoveWindowMs || VOICE_GUARD_WINDOW_MS) || VOICE_GUARD_WINDOW_MS),
    maxMovesPerWindow: Math.max(2, Number(state?.voiceGuardMaxMovesPerWindow || VOICE_GUARD_MAX_EVENTS_PER_WINDOW) || VOICE_GUARD_MAX_EVENTS_PER_WINDOW),
    escalation: String(state?.voiceGuardEscalation || VOICE_GUARD_ESCALATION).trim().toLowerCase() === "cooldown"
      ? "cooldown"
      : "disconnect",
    escalationCooldownMs: Math.max(
      60_000,
      Number(state?.voiceGuardEscalationCooldownMs || VOICE_GUARD_ESCALATION_COOLDOWN_MS) || VOICE_GUARD_ESCALATION_COOLDOWN_MS
    ),
  };
}

function isRuntimeVoiceGuardUnlocked(state, nowMs = Date.now()) {
  return (Number(state?.voiceGuardUnlockUntil || 0) || 0) > nowMs;
}

export function isRuntimeVoiceGuardCooldownActive(state, nowMs = Date.now()) {
  return (Number(state?.voiceGuardCooldownUntil || 0) || 0) > nowMs;
}

export function recordRuntimeVoiceGuardAction(state, action, {
  reason = null,
  expectedChannelId = null,
  actualChannelId = null,
  atMs = Date.now(),
} = {}) {
  if (!state) return;
  state.voiceGuardLastAction = String(action || "").trim() || null;
  state.voiceGuardLastActionAt = Number(atMs || Date.now()) || Date.now();
  state.voiceGuardLastActionReason = String(reason || "").trim() || null;
  state.voiceGuardLastExpectedChannelId = String(expectedChannelId || "").trim() || null;
  state.voiceGuardLastActualChannelId = String(actualChannelId || "").trim() || null;
}

export function noteRuntimeVoiceGuardMove(state, config, {
  expectedChannelId = null,
  actualChannelId = null,
  nowMs = Date.now(),
} = {}) {
  if (!state) {
    return { countInWindow: 0, exceededWindow: false };
  }
  const windowMs = Math.max(5_000, Number(config?.moveWindowMs || VOICE_GUARD_WINDOW_MS) || VOICE_GUARD_WINDOW_MS);
  const windowStartedAt = Number(state.voiceGuardWindowStartedAt || 0) || 0;
  if (!windowStartedAt || (nowMs - windowStartedAt) > windowMs) {
    state.voiceGuardWindowStartedAt = nowMs;
    state.voiceGuardWindowMoveCount = 0;
  }
  state.voiceGuardWindowMoveCount = (Number(state.voiceGuardWindowMoveCount || 0) || 0) + 1;
  state.voiceGuardMoveCount = (Number(state.voiceGuardMoveCount || 0) || 0) + 1;
  recordRuntimeVoiceGuardAction(state, "move-detected", {
    reason: "foreign-move-confirmed",
    expectedChannelId,
    actualChannelId,
    atMs: nowMs,
  });
  return {
    countInWindow: Number(state.voiceGuardWindowMoveCount || 0) || 0,
    exceededWindow: (Number(state.voiceGuardWindowMoveCount || 0) || 0) >= Math.max(2, Number(config?.maxMovesPerWindow || VOICE_GUARD_MAX_EVENTS_PER_WINDOW) || VOICE_GUARD_MAX_EVENTS_PER_WINDOW),
  };
}

export function clearRuntimeVoiceGuardWindow(state) {
  if (!state) return;
  state.voiceGuardWindowStartedAt = 0;
  state.voiceGuardWindowMoveCount = 0;
}

export function shouldProtectRuntimeVoiceChannel(state, expectedChannelId = getExpectedRuntimeChannelId(state), config = getRuntimeVoiceGuardConfig(state)) {
  const normalizedExpectedChannelId = String(expectedChannelId || "").trim();
  if (!normalizedExpectedChannelId) return false;
  if (config.policy === "allow") return false;
  if (isRuntimeVoiceGuardUnlocked(state)) return false;
  const playerStatus = String(state?.player?.state?.status || "").trim().toLowerCase();
  const hasActiveOrReservedSession = Boolean(
    state?.currentStationKey
    || state?.currentProcess
    || state?.connection
    || state?.reconnectTimer
    || state?.reconnectInFlight
    || state?.voiceConnectInFlight
    || (playerStatus && playerStatus !== String(AudioPlayerStatus.Idle).toLowerCase())
  );
  return Boolean(
    normalizedExpectedChannelId
    && hasActiveOrReservedSession
  );
}

export function parseStoredTimestampMs(value) {
  if (!value) return 0;
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function clearRestoreBlockState(state) {
  if (!state || (
    !state.restoreBlockedUntil
    && !state.restoreBlockedAt
    && !state.restoreBlockCount
    && !state.restoreBlockReason
  )) {
    return;
  }
  state.restoreBlockedUntil = 0;
  state.restoreBlockedAt = 0;
  state.restoreBlockCount = 0;
  state.restoreBlockReason = null;
}

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

function getRuntimeRecoveryDelayMs(runtime, guildId) {
  if (typeof runtime?.getNetworkRecoveryDelayMs === "function") {
    return runtime.getNetworkRecoveryDelayMs(guildId);
  }
  return networkRecoveryCoordinator.getRecoveryDelayMs();
}

export function noteRuntimeRecoveryFailure(runtime, guildId, source, detail = "") {
  if (typeof runtime?.noteNetworkRecoveryFailure === "function") {
    runtime.noteNetworkRecoveryFailure(guildId, source, detail);
    return;
  }
  networkRecoveryCoordinator.noteFailure(source, detail);
}

function noteRuntimeRecoverySuccess(runtime, guildId, source) {
  if (typeof runtime?.noteNetworkRecoverySuccess === "function") {
    runtime.noteNetworkRecoverySuccess(guildId, source);
    return;
  }
  networkRecoveryCoordinator.noteSuccess(source);
}

function runtimeRecoveryScopeMatches(runtime, guildId, recoveryEvent = null) {
  const recoveredScope = String(recoveryEvent?.scope || "").trim();
  if (!recoveredScope) return true;
  if (typeof runtime?.getNetworkRecoveryScope !== "function") return true;
  return runtime.getNetworkRecoveryScope(guildId) === recoveredScope;
}

export function hasRecoverableRuntimeState(state) {
  return Boolean(
    state?.currentStationKey
    && state?.lastChannelId
    && (
      state?.connection
      || state?.currentProcess
      || state?.reconnectTimer
      || state?.reconnectInFlight
      || state?.voiceConnectInFlight
      || state?.shouldReconnect
    )
  );
}

function getRuntimeErrorMessage(err) {
  return String(err?.message || err || "unknown").trim() || "unknown";
}

export function buildRuntimeLogContext(runtime, guildId, state = null, extra = {}) {
  return {
    bot: runtime?.config?.name || null,
    botId: runtime?.config?.id || null,
    guild: guildId || null,
    channel: state?.lastChannelId || null,
    station: state?.currentStationKey || null,
    stationName: state?.currentStationName || null,
    voiceConnected: isRuntimeVoiceConnected(runtime, guildId, state, { includeObserved: true }),
    voiceConnectionStatus: String(state?.connection?.state?.status || "").trim() || "none",
    playerStatus: String(state?.player?.state?.status || "").trim() || "unknown",
    processAlive: Boolean(state?.currentProcess),
    reconnectAttempts: Number(state?.reconnectAttempts || 0) || 0,
    reconnectCount: Number(state?.reconnectCount || 0) || 0,
    reconnectPending: Boolean(state?.reconnectTimer),
    reconnectInFlight: state?.reconnectInFlight === true,
    voiceConnectInFlight: state?.voiceConnectInFlight === true,
    streamRestartPending: Boolean(state?.streamRestartTimer),
    streamRestartInFlight: state?.streamRestartInFlight === true,
    restoreBlockCount: Number(state?.restoreBlockCount || 0) || 0,
    restoreBlockReason: state?.restoreBlockReason || null,
    ...extra,
  };
}

function getRuntimeConnectionStatus(state) {
  return String(state?.connection?.state?.status || "").trim() || "none";
}

export function getRuntimePlayerStatus(state) {
  return String(state?.player?.state?.status || "").trim() || "unknown";
}

function buildRuntimeRecoverySnapshot(runtime, guildId, state = null, extra = {}) {
  const detail = [
    `guild=${guildId || "-"}`,
    `station=${state?.currentStationKey || "-"}`,
    `channel=${state?.lastChannelId || "-"}`,
    `voiceLocal=${state?.connection ? 1 : 0}`,
    `voiceStatus=${getRuntimeConnectionStatus(state)}`,
    `player=${getRuntimePlayerStatus(state)}`,
    `process=${state?.currentProcess ? 1 : 0}`,
    `shouldReconnect=${state?.shouldReconnect === true ? 1 : 0}`,
    `attempts=${Number(state?.reconnectAttempts || 0) || 0}`,
  ];
  const reconnectCount = Number(state?.reconnectCount || 0) || 0;
  if (reconnectCount > 0) detail.push(`reconnects=${reconnectCount}`);
  if (state?.reconnectTimer) detail.push("timer=1");
  if (state?.reconnectInFlight === true) detail.push("reconnect=1");
  if (state?.voiceConnectInFlight === true) detail.push("voice=1");
  if (state?.streamRestartTimer) detail.push("stream=1");
  if (state?.streamRestartInFlight === true) detail.push("streamFlight=1");
  const restoreBlockedUntil = Number(state?.restoreBlockedUntil || 0) || 0;
  if (restoreBlockedUntil > Date.now()) {
    detail.push(`restoreBlockedFor=${Math.round((restoreBlockedUntil - Date.now()) / 1000)}s`);
  }
  const networkCooldownMs = typeof runtime?.getNetworkRecoveryDelayMs === "function"
    ? Number(runtime.getNetworkRecoveryDelayMs(guildId) || 0) || 0
    : 0;
  if (networkCooldownMs > 0) {
    detail.push(`networkCooldown=${Math.round(networkCooldownMs / 1000)}s`);
  }
  if (extra?.reason) detail.push(`reason=${extra.reason}`);
  if (extra?.expectedChannelId !== undefined) detail.push(`expected=${extra.expectedChannelId || "-"}`);
  if (extra?.actualChannelId !== undefined) detail.push(`actual=${extra.actualChannelId || "-"}`);
  if (extra?.issue) detail.push(`issue=${extra.issue}`);
  if (extra?.detail) detail.push(`detail=${extra.detail}`);
  return detail.join(" ");
}

export function logRuntimeRecoveryState(runtime, level, message, guildId, state = null, extra = {}) {
  log(level, `[${runtime.config.name}] ${message} ${buildRuntimeRecoverySnapshot(runtime, guildId, state, extra)}`);
}

function isRecoverableVoiceConnectionError(err) {
  return isLikelyNetworkFailureLine(getRuntimeErrorMessage(err));
}

export function shouldLogRecurringTransientIssue(issue) {
  const count = Number(issue?.count || 0);
  return count === 1 || (count % 5) === 0;
}

function getTransientVoiceIssues(state) {
  if (!state.transientVoiceIssues || typeof state.transientVoiceIssues !== "object") {
    state.transientVoiceIssues = {};
  }
  return state.transientVoiceIssues;
}

export function clearTransientVoiceIssue(state, code) {
  if (!state?.transientVoiceIssues || !code) return;
  delete state.transientVoiceIssues[code];
}

function clearTransientVoiceIssues(state, codes = []) {
  if (!state) return;
  if (!Array.isArray(codes) || codes.length === 0) {
    state.transientVoiceIssues = {};
    return;
  }
  for (const code of codes) {
    clearTransientVoiceIssue(state, code);
  }
}

function noteTransientVoiceIssue(state, code, detail = "") {
  const issues = getTransientVoiceIssues(state);
  const now = Date.now();
  const current = issues[code] || {
    count: 0,
    firstSeenAt: now,
    lastSeenAt: 0,
    lastDetail: "",
  };
  const next = {
    count: Number(current.count || 0) + 1,
    firstSeenAt: current.firstSeenAt || now,
    lastSeenAt: now,
    lastDetail: String(detail || ""),
  };
  issues[code] = next;
  return next;
}

export function clearRuntimeParkedState(state) {
  if (!state || (!state.parkedReason && !state.parkedAt && !state.parkedDetail)) return false;
  state.parkedReason = null;
  state.parkedAt = 0;
  state.parkedDetail = null;
  return true;
}

/**
 * Parks a reconnect target instead of deleting it (#190). The channel and the
 * station stay persisted, attempts and circuit counters reset, and the worker
 * keeps retrying at the slow VOICE_PARKED_RETRY_MS cadence until the join
 * succeeds or /play replaces the target. Nothing a 24/7 server configured is
 * thrown away because Discord or the permissions were broken for a few hours.
 */
export function parkRuntimeReconnectTarget(runtime, guildId, state, reason, detail = "", {
  logLevel = "WARN",
  schedule = true,
} = {}) {
  const code = String(reason || "unknown").trim().toLowerCase() || "unknown";
  const text = String(detail || "").trim().slice(0, 200);
  const nowMs = Date.now();
  const alreadyParked = Boolean(state.parkedReason);
  if (!alreadyParked) state.parkedAt = nowMs;
  state.parkedReason = code;
  state.parkedDetail = text || null;
  recordPlaybackPhase(runtime, guildId, state, `parked:${code}`);
  state.reconnectAttempts = 0;
  state.reconnectCircuitTripCount = 0;
  state.reconnectCircuitOpenUntil = 0;
  clearTransientVoiceIssues(state);
  if (state.connection) {
    try { state.connection.destroy(); } catch {}
    state.connection = null;
  }

  logRuntimeRecoveryState(
    runtime,
    logLevel,
    `Reconnect geparkt (${code}): ${text || "-"} - Ziel bleibt gespeichert, naechster Versuch in ${Math.round(VOICE_PARKED_RETRY_MS / 1000)}s`,
    guildId,
    state,
    { reason: `parked-${code}` }
  );
  recordConnectionEvent(guildId, {
    botId: runtime.config.id || "",
    eventType: "retry",
    channelId: String(state?.lastChannelId || "").trim(),
    details: `Auto reconnect parked (${code}): ${text}`.slice(0, 200),
  });
  if (!alreadyParked) {
    recordRuntimeIncident({
      guildId,
      guildName: runtime?.client?.guilds?.cache?.get?.(guildId)?.name || guildId,
      tier: getTierConfig(guildId).tier,
      eventKey: "voice_parked",
      severity: "warning",
      runtime: {
        id: String(runtime?.config?.id || "").trim(),
        name: String(runtime?.config?.name || "").trim(),
        role: String(runtime?.role || "").trim(),
      },
      payload: {
        reason: code,
        detail: text,
        channelId: String(state?.lastChannelId || "").trim(),
        stationKey: state?.currentStationKey || null,
        stationName: state?.currentStationName || null,
      },
    }).catch(() => null);
  }

  if (schedule) {
    scheduleRuntimeReconnect(runtime, guildId, {
      countAttempt: false,
      minDelayMs: VOICE_PARKED_RETRY_MS,
      reason: `parked-${code}`,
    });
  }
  runtime.persistState?.();
}

function unparkRuntimeReconnectTarget(runtime, guildId, state, channelId) {
  const parkedReason = state?.parkedReason || null;
  const parkedForMs = Number(state?.parkedAt || 0) > 0 ? Math.max(0, Date.now() - Number(state.parkedAt)) : 0;
  if (!clearRuntimeParkedState(state)) return false;
  recordPlaybackPhase(runtime, guildId, state, "unparked");
  log(
    "INFO",
    `[${runtime.config.name}] Reconnect nach Parken erfolgreich guild=${guildId} channel=${channelId || "-"} (grund=${parkedReason}, geparkt=${Math.round(parkedForMs / 1000)}s)`
  );
  recordRuntimeIncident({
    guildId,
    guildName: runtime?.client?.guilds?.cache?.get?.(guildId)?.name || guildId,
    tier: getTierConfig(guildId).tier,
    eventKey: "voice_unparked",
    severity: "success",
    runtime: {
      id: String(runtime?.config?.id || "").trim(),
      name: String(runtime?.config?.name || "").trim(),
      role: String(runtime?.role || "").trim(),
    },
    payload: {
      reason: parkedReason,
      parkedForMs,
      channelId: String(channelId || "").trim(),
      stationKey: state?.currentStationKey || null,
      stationName: state?.currentStationName || null,
    },
  }).catch(() => null);
  return true;
}

function getDiscordErrorCode(err) {
  const parsed = Number.parseInt(String(err?.code ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function isPermanentRestoreResourceError(err, resourceType) {
  const code = getDiscordErrorCode(err);
  if (!Number.isFinite(code)) return false;
  if (resourceType === "guild") return PERMANENT_RESTORE_GUILD_ERROR_CODES.has(code);
  if (resourceType === "channel") return PERMANENT_RESTORE_CHANNEL_ERROR_CODES.has(code);
  return false;
}

export async function fetchRestoreGuild(runtime, guildId) {
  const cachedGuild = runtime.client.guilds.cache.get(guildId);
  if (cachedGuild) {
    return { guild: cachedGuild, error: null, source: "cache" };
  }
  try {
    const guild = await runtime.client.guilds.fetch(guildId);
    return { guild, error: null, source: "api" };
  } catch (err) {
    return { guild: null, error: err, source: "api" };
  }
}

export async function fetchRestoreChannel(guild, channelId) {
  const cachedChannel = guild.channels.cache.get(channelId);
  if (cachedChannel) {
    return { channel: cachedChannel, error: null, source: "cache" };
  }
  try {
    const channel = await guild.channels.fetch(channelId);
    return { channel, error: null, source: "api" };
  } catch (err) {
    return { channel: null, error: err, source: "api" };
  }
}

export function confirmTransientVoiceIssue(runtime, guildId, state, code, detail, {
  threshold,
  recheckReason,
  logMessage,
} = {}) {
  const issue = noteTransientVoiceIssue(state, code, detail);
  const needed = Math.max(1, Number(threshold || 1) || 1);
  const confirmed = issue.count >= needed;
  if (!confirmed) {
    log(
      "WARN",
      `[${runtime.config.name}] ${logMessage} guild=${guildId} (${issue.count}/${needed}) - warte auf Bestaetigung.`
    );
    runtime.queueVoiceStateReconcile(guildId, recheckReason || code, VOICE_TRANSIENT_RECHECK_MS);
  }
  return { ...issue, confirmed, threshold: needed };
}

/**
 * Server mute and stage suppression keep the bot in the channel while nobody
 * hears it. Record the flag, tell the listeners in the now-playing embed and
 * ask to speak again on a stage (#193).
 */
function noteRuntimeBotVoiceFlags(runtime, guildId, state, newState) {
  if (!state || !newState?.channelId) return;
  const muted = newState.serverMute === true;
  if (Boolean(state.serverMuted) !== muted) {
    state.serverMuted = muted;
    state.serverMutedAt = muted ? Date.now() : 0;
    log(
      muted ? "WARN" : "INFO",
      `[${runtime.config?.name || "OmniFM"}] ${muted ? "Server-Stummschaltung erkannt" : "Server-Stummschaltung aufgehoben"} guild=${guildId} channel=${newState.channelId}`
    );
    recordRuntimeIncident({
      guildId,
      guildName: runtime?.client?.guilds?.cache?.get?.(guildId)?.name || guildId,
      tier: getTierConfig(guildId).tier,
      eventKey: muted ? "voice_server_muted" : "voice_server_unmuted",
      severity: muted ? "warning" : "success",
      runtime: {
        id: String(runtime?.config?.id || "").trim(),
        name: String(runtime?.config?.name || "").trim(),
        role: String(runtime?.role || "").trim(),
      },
      payload: {
        channelId: String(newState.channelId || "").trim(),
        stationKey: state.currentStationKey || null,
        stationName: state.currentStationName || null,
      },
    }).catch(() => null);
    if (state.currentStationKey && typeof runtime.updateNowPlayingEmbed === "function") {
      Promise.resolve(runtime.updateNowPlayingEmbed(guildId, state, { force: true })).catch(() => null);
    }
  }

  const channel = newState.channel || null;
  if (
    newState.suppress === true
    && state.currentStationKey
    && channel?.type === ChannelType.GuildStageVoice
    && typeof runtime.ensureStageChannelReady === "function"
  ) {
    const nowMs = Date.now();
    if (!state.lastStageSpeakerFixAt || (nowMs - state.lastStageSpeakerFixAt) > 30_000) {
      state.lastStageSpeakerFixAt = nowMs;
      log("INFO", `[${runtime.config?.name || "OmniFM"}] Stage-Sprecherrolle entzogen guild=${guildId} - fordere sie erneut an.`);
      Promise.resolve(runtime.ensureStageChannelReady(newState.guild, channel, { createInstance: false, ensureSpeaker: true }))
        .catch(() => null);
    }
  }
}

export function handleRuntimeBotVoiceStateUpdate(runtime, oldState, newState) {
  if (!runtime.client.user) return;
  if (newState.id !== runtime.client.user.id) return;

  const guildId = newState.guild.id;
  const state = runtime.getState(guildId);
  noteRuntimeBotVoiceFlags(runtime, guildId, state, newState);
  const oldChannelId = oldState.channelId;
  const newChannelId = newState.channelId;
  const expectedChannelId = getExpectedRuntimeChannelId(state);
  const voiceGuardConfig = getRuntimeVoiceGuardConfig(state);

  if (newChannelId) {
    if (
      shouldProtectRuntimeVoiceChannel(state, expectedChannelId, voiceGuardConfig)
      && expectedChannelId
      && newChannelId !== expectedChannelId
    ) {
      const issue = noteTransientVoiceIssue(
        state,
        "voice-channel-mismatch",
        `${expectedChannelId}:${newChannelId}:voice-state-update`
      );
      if (issue.count === 1 || (issue.count % 5) === 0) {
        log(
          "WARN",
          `[${runtime.config.name}] Unerwarteter Voice-Move erkannt guild=${guildId} expected=${expectedChannelId} actual=${newChannelId} - Kanal wird geschuetzt (${voiceGuardConfig.policy}).`
        );
      }
      runtime.queueVoiceStateReconcile(guildId, "voice-state-update-mismatch", 900);
      return;
    }

    clearTransientVoiceIssues(state);
    state.voiceDisconnectObservedAt = 0;
    if (expectedChannelId && newChannelId === expectedChannelId) {
      clearRuntimeVoiceGuardWindow(state);
      if (isRuntimeVoiceGuardCooldownActive(state)) {
        state.voiceGuardCooldownUntil = 0;
      }
    }
    if (state.lastChannelId !== newChannelId) {
      runtime.markNowPlayingTargetDirty(state, newChannelId);
      runtime.invalidateVoiceStatus?.(state);
    }
    state.lastChannelId = newChannelId;
    if (state.reconnectTimer) {
      runtime.clearReconnectTimer(state);
      state.reconnectAttempts = 0;
    }
    runtime.persistState();
    if (state.currentStationKey) {
      if (typeof runtime.syncVoiceChannelStatus === "function") {
        runtime.syncVoiceChannelStatus(guildId, state.currentStationName || state.currentStationKey).catch(() => null);
      }
    }
    runtime.queueVoiceStateReconcile(guildId, "voice-state-update", 1500);
    return;
  }

  if (!oldChannelId) return;

  const shouldAutoReconnect = Boolean(state.shouldReconnect && state.currentStationKey && state.lastChannelId);

  if (shouldAutoReconnect) {
    runtime.invalidateVoiceStatus?.(state);
    state.voiceDisconnectObservedAt = state.voiceDisconnectObservedAt || Date.now();
    const issue = noteTransientVoiceIssue(
      state,
      "voice-state-update-missing",
      `${oldChannelId}:${state.lastChannelId || oldChannelId}`
    );
    if (issue.count === 1 || (issue.count % 5) === 0) {
      const phase = state.voiceConnectInFlight || state.reconnectInFlight || state.reconnectTimer
        ? " (connect/reconnect aktiv)"
        : "";
      log(
        "WARN",
        `[${runtime.config.name}] Voice-State meldet Disconnect guild=${guildId} channel=${oldChannelId}${phase} - warte auf Reconcile (${issue.count}).`
      );
    }
    runtime.queueVoiceStateReconcile(guildId, "voice-state-update-missing", 1500);
    return;
  }

  runtime.resetVoiceSession(guildId, state, {
    preservePlaybackTarget: false,
    clearLastChannel: true,
  });
  log(
    "INFO",
    `[${runtime.config.name}] Voice left (Guild ${guildId}, Channel ${oldChannelId}). No reconnect.`
  );
}

export function resetRuntimeVoiceSession(
  runtime,
  guildId,
  state,
  { preservePlaybackTarget = false, clearLastChannel = false } = {}
) {
  if (!state) return;
  if (!preservePlaybackTarget) {
    clearRuntimeRestoreRetry(runtime, guildId);
  }
  runtime.clearQueuedVoiceReconcile(guildId);
  clearTransientVoiceIssues(state);
  runtime.invalidateVoiceStatus?.(state, { clearText: true });

  if (!preservePlaybackTarget && state.currentStationKey) {
    recordStationStop(guildId, { botId: runtime.config.id || "" });
  }

  if (state.connection) {
    try { state.connection.destroy(); } catch {}
    state.connection = null;
  }

  state.player.stop();
  runtime.clearCurrentProcess(state);
  runtime.clearReconnectTimer(state);
  runtime.clearNowPlayingTimer(state);
  if (typeof runtime.syncVoiceChannelStatus === "function") {
    runtime.syncVoiceChannelStatus(guildId, "").catch(() => null);
  }
  state.voiceDisconnectObservedAt = 0;

  if (!preservePlaybackTarget) {
    state.currentStationKey = null;
    state.currentStationName = null;
    state.desiredStationKey = null;
    state.desiredStationName = null;
    clearRuntimeParkedState(state);
    clearActiveFailover(state);
    clearFailoverFailureWindow(state);
    state.currentMeta = null;
    state.nowPlayingSignature = null;
    state.nowPlayingMessageId = null;
    state.nowPlayingChannelId = null;
    runtime.clearScheduledEventPlayback(state);
  }

  if (clearLastChannel) {
    state.lastChannelId = null;
  }

  if (!preservePlaybackTarget) {
    state.reconnectAttempts = 0;
    state.streamErrorCount = 0;
    state.idleRestartStreak = 0;
    state.lastIdleRestartAt = 0;
    state.lastProcessExitDetail = null;
    state.lastStreamEndReason = null;
  }

  runtime.updatePresence();
  runtime.persistState();
  recordPlaybackPhase(runtime, guildId, state, "voice-reset");
}

export function attachRuntimeConnectionHandlers(runtime, guildId, connection) {
  const state = runtime.getState(guildId);

  const markDisconnected = () => {
    if (state.connection === connection) {
      state.connection = null;
      runtime.invalidateVoiceStatus?.(state);
    }
  };

  connection.on(VoiceConnectionStatus.Disconnected, async () => {
    recordConnectionEvent(guildId, {
      botId: runtime.config.id || "",
      eventType: "disconnect",
      channelId: state.lastChannelId || "",
      details: "VoiceConnectionStatus.Disconnected",
    });
    if (!state.shouldReconnect) {
      markDisconnected();
      return;
    }

    try {
      await Promise.race([
        entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
        entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
      ]);
      log("INFO", `[${runtime.config.name}] Voice connection recovering for guild=${guildId}`);
    } catch {
      log("INFO", `[${runtime.config.name}] Voice connection recovery failed for guild=${guildId}, destroying`);
      markDisconnected();
      try { connection.destroy(); } catch {}
      runtime.scheduleReconnect(guildId, { reason: "voice-disconnected" });
    }
  });

  connection.on(VoiceConnectionStatus.Destroyed, () => {
    markDisconnected();
    if (state.shouldReconnect && state.currentStationKey && state.lastChannelId) {
      runtime.scheduleReconnect(guildId, { reason: "voice-destroyed" });
    }
  });

  connection.on("error", (err) => {
    const errorMessage = getRuntimeErrorMessage(err);
    const recoverableNetworkError = isRecoverableVoiceConnectionError(errorMessage);
    if (recoverableNetworkError) {
      noteRuntimeRecoveryFailure(runtime, guildId, `${runtime.config.name} voice-error`, `guild=${guildId}: ${errorMessage}`);
    }
    log(recoverableNetworkError ? "WARN" : "ERROR", `[${runtime.config.name}] VoiceConnection error: ${errorMessage}`);
    recordConnectionEvent(guildId, {
      botId: runtime.config.id || "",
      eventType: "error",
      channelId: state.lastChannelId || "",
      details: errorMessage.slice(0, 200),
    });
    if (!recoverableNetworkError || !state.shouldReconnect) {
      markDisconnected();
    }
    if (!state.shouldReconnect) return;
    runtime.scheduleReconnect(
      guildId,
      recoverableNetworkError
        ? {
            reason: "voice-network-error",
            minDelayMs: VOICE_NETWORK_ERROR_RETRY_MIN_MS,
            jitterFactor: VOICE_NETWORK_ERROR_RETRY_JITTER,
          }
        : { reason: "voice-error" }
    );
  });
}

export async function tryRuntimeReconnect(runtime, guildId) {
  const state = runtime.getState(guildId);
  if (state.reconnectInFlight || state.voiceConnectInFlight) {
    return { attempted: false, retryRecommended: true, reason: "busy" };
  }
  if (!state.shouldReconnect || !state.lastChannelId) {
    return { attempted: false, retryRecommended: false, reason: "inactive" };
  }
  if (runtime.isScheduledEventStopDue(state.activeScheduledEventStopAtMs)) {
    await runtime.stopInGuild(guildId);
    return { attempted: false, retryRecommended: false, reason: "scheduled-stop" };
  }

  state.reconnectInFlight = true;
  try {
    const networkCooldownMs = getRuntimeRecoveryDelayMs(runtime, guildId);
    if (networkCooldownMs > 0) {
      logRuntimeRecoveryState(runtime, "INFO", "Reconnect verschoben", guildId, state, {
        reason: "network-cooldown",
        detail: `${Math.round(networkCooldownMs)}ms`,
      });
      return {
        attempted: false,
        retryRecommended: true,
        minDelayMs: networkCooldownMs,
        reason: "network-cooldown",
      };
    }

    const { guild, error: guildError } = await fetchRestoreGuild(runtime, guildId);
    if (!guild) {
      if (isPermanentRestoreResourceError(guildError, "guild")) {
        clearTransientVoiceIssue(state, "reconnect-guild-missing");
        log("INFO", `[${runtime.config.name}] Reconnect-Ziel Guild ${guildId} ist nicht mehr verfuegbar. Verwerfe Playback-Target.`);
        runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
        return { attempted: false, retryRecommended: false, reason: "guild-missing-permanent" };
      }
      const issue = noteTransientVoiceIssue(
        state,
        "reconnect-guild-missing",
        `${guildId}:${getRuntimeErrorMessage(guildError)}`
      );
      if (shouldLogRecurringTransientIssue(issue)) {
        log(
          "WARN",
          `[${runtime.config.name}] Reconnect kann Guild noch nicht aufloesen guild=${guildId} ` +
          `(${issue.count}/${VOICE_RECONNECT_RESOURCE_CONFIRMATIONS}, detail=${getRuntimeErrorMessage(guildError)}) - retry folgt.`
        );
      }
      return { attempted: false, retryRecommended: true, reason: "guild-missing-transient" };
    }
    clearTransientVoiceIssue(state, "reconnect-guild-missing");

    const { channel, error: channelError } = await fetchRestoreChannel(guild, state.lastChannelId);
    if (!channel) {
      if (isPermanentRestoreResourceError(channelError, "channel")) {
        clearTransientVoiceIssue(state, "reconnect-channel-missing");
        log(
          "INFO",
          `[${runtime.config.name}] Reconnect-Ziel Channel ${state.lastChannelId || "-"} in guild=${guildId} existiert nicht mehr. Verwerfe Playback-Target.`
        );
        runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
        return { attempted: false, retryRecommended: false, reason: "channel-missing-permanent" };
      }
      const issue = noteTransientVoiceIssue(
        state,
        "reconnect-channel-missing",
        `${guildId}:${state.lastChannelId || "-"}:${getRuntimeErrorMessage(channelError)}`
      );
      if (shouldLogRecurringTransientIssue(issue)) {
        log(
          "WARN",
          `[${runtime.config.name}] Reconnect abgebrochen: Voice-Channel fehlt guild=${guildId} channel=${state.lastChannelId || "-"} ` +
          `(${issue.count}/${VOICE_RECONNECT_RESOURCE_CONFIRMATIONS}, detail=${getRuntimeErrorMessage(channelError)}) - retry folgt.`
        );
      }
      return { attempted: false, retryRecommended: true, reason: "channel-missing-transient" };
    }
    if (!channel.isVoiceBased()) {
      clearTransientVoiceIssue(state, "reconnect-channel-missing");
      log(
        "INFO",
        `[${runtime.config.name}] Reconnect-Ziel Channel ${state.lastChannelId || "-"} in guild=${guildId} ist kein Voice-/Stage-Channel mehr. Verwerfe Playback-Target.`
      );
      runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
      return { attempted: false, retryRecommended: false, reason: "channel-type-invalid" };
    }
    clearTransientVoiceIssue(state, "reconnect-channel-missing");

    const me = await runtime.resolveBotMember(guild);
    const perms = me ? channel.permissionsFor(me) : null;
    if (!me || !perms?.has(PermissionFlagsBits.Connect) || (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak))) {
      const missingBits = [];
      if (!me) missingBits.push("member-unresolved");
      if (!perms?.has(PermissionFlagsBits.Connect)) missingBits.push("connect");
      if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) missingBits.push("speak");
      const issue = noteTransientVoiceIssue(
        state,
        "reconnect-permissions-missing",
        `${guildId}:${channel.id}:${missingBits.join(",") || "unknown"}`
      );
      if (issue.count >= VOICE_RECONNECT_PERMISSION_CONFIRMATIONS) {
        parkRuntimeReconnectTarget(
          runtime,
          guildId,
          state,
          "permissions",
          `permissions still missing after ${issue.count} checks (channel=${channel.id}, detail=${missingBits.join(",") || "unknown"})`,
          { schedule: false }
        );
        return { attempted: false, retryRecommended: true, minDelayMs: VOICE_PARKED_RETRY_MS, reason: "permissions-parked" };
      }
      if (shouldLogRecurringTransientIssue(issue)) {
        log(
          "WARN",
          `[${runtime.config.name}] Reconnect abgebrochen: Rechte/Bot-Member fehlen guild=${guildId} channel=${channel.id} ` +
          `(${issue.count}/${VOICE_RECONNECT_PERMISSION_CONFIRMATIONS}, detail=${missingBits.join(",") || "unknown"}) - retry folgt.`
        );
      }
      return { attempted: false, retryRecommended: true, reason: "permissions-missing-transient" };
    }
    clearTransientVoiceIssue(state, "reconnect-permissions-missing");

    logRuntimeRecoveryState(runtime, "INFO", "Reconnect-Versuch startet", guildId, state, {
      reason: "reconnect-start",
      actualChannelId: channel.id,
    });

    if (state.connection) {
      try { state.connection.destroy(); } catch {}
      state.connection = null;
    }

    const originalAdapter = guild.voiceAdapterCreator;
    const botName = runtime.config.name;
    const wrappedAdapter = (methods) => {
      const adapter = originalAdapter(methods);
      const originalSendPayload = adapter.sendPayload.bind(adapter);
      adapter.sendPayload = (data) => {
        const result = originalSendPayload(data);
        if (!result) {
          log("WARN", `[${botName}] Reconnect sendPayload returned false for guild=${guildId}`);
        }
        return result;
      };
      return adapter;
    };

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: wrappedAdapter,
      group: runtime.voiceGroup,
      selfDeaf: true,
      debug: true,
    });

    connection.on("stateChange", (oldState, newState) => {
      const oldStatus = String(oldState?.status || "");
      const newStatus = String(newState?.status || "");
      if (!newStatus || oldStatus === newStatus) return;
      log("INFO", `[${botName}] ReconnectVoiceState: ${oldStatus} -> ${newStatus} guild=${guildId}`);
    });

    log("INFO", `[${runtime.config.name}] Rejoin Voice: guild=${guild.id} channel=${channel.id} group=${runtime.voiceGroup}`);
    state.connection = connection;

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
    } catch {
      logRuntimeRecoveryState(runtime, "WARN", "Reconnect Voice-Timeout", guildId, state, {
        reason: "voice-ready-timeout",
        actualChannelId: channel.id,
        detail: connection.state?.status || "unknown",
      });
      if (state.connection === connection) {
        state.connection = null;
      }
      noteRuntimeRecoveryFailure(runtime, guildId, `${runtime.config.name} reconnect-timeout`, `guild=${guildId}`);
      try { connection.destroy(); } catch {}
      const issue = noteTransientVoiceIssue(
        state,
        "reconnect-ready-timeout",
        `${guildId}:${channel.id}:${connection.state?.status || "unknown"}`
      );
      if (issue.count >= VOICE_RECONNECT_READY_FAILURE_CONFIRMATIONS) {
        parkRuntimeReconnectTarget(
          runtime,
          guildId,
          state,
          "voice-ready",
          `voice ready timeout repeated ${issue.count}x (channel=${channel.id}, state=${connection.state?.status || "unknown"})`,
          { logLevel: "ERROR", schedule: false }
        );
        return { attempted: false, retryRecommended: true, minDelayMs: VOICE_PARKED_RETRY_MS, reason: "voice-ready-parked" };
      }
      return { attempted: true, success: false, retryRecommended: true, reason: "voice-ready-timeout" };
    }

    const joinedVoiceState = await runtime.confirmBotVoiceChannel(guildId, channel.id, { timeoutMs: 10_000, intervalMs: 700 });
    if (!joinedVoiceState) {
      if (state.connection === connection) {
        state.connection = null;
      }
      logRuntimeRecoveryState(runtime, "WARN", "Reconnect bestaetigt lokalen Ready-State, aber Discord-Voice-State fehlt", guildId, state, {
        reason: "voice-confirmation-failed",
        actualChannelId: channel.id,
      });
      noteRuntimeRecoveryFailure(runtime, guildId, `${runtime.config.name} reconnect-ghost`, `guild=${guildId}`);
      try { connection.destroy(); } catch {}
      const issue = noteTransientVoiceIssue(
        state,
        "reconnect-voice-confirmation-failed",
        `${guildId}:${channel.id}`
      );
      if (issue.count >= VOICE_RECONNECT_READY_FAILURE_CONFIRMATIONS) {
        parkRuntimeReconnectTarget(
          runtime,
          guildId,
          state,
          "voice-confirmation",
          `voice state confirmation failed ${issue.count}x (channel=${channel.id})`,
          { logLevel: "ERROR", schedule: false }
        );
        return { attempted: false, retryRecommended: true, minDelayMs: VOICE_PARKED_RETRY_MS, reason: "voice-confirmation-parked" };
      }
      return { attempted: true, success: false, retryRecommended: true, reason: "voice-confirmation-failed" };
    }

    if (!state.shouldReconnect || !state.currentStationKey || !state.lastChannelId) {
      if (state.connection === connection) {
        state.connection = null;
      }
      try { connection.destroy(); } catch {}
      return { attempted: true, success: false, retryRecommended: false, reason: "target-cleared-during-reconnect" };
    }

    connection.subscribe(state.player);
    clearTransientVoiceIssues(state);
    state.reconnectAttempts = 0;
    state.reconnectCircuitTripCount = 0;
    state.reconnectCircuitOpenUntil = 0;
    unparkRuntimeReconnectTarget(runtime, guildId, state, channel.id);
    state.reconnectCount = (Number(state.reconnectCount || 0) || 0) + 1;
    state.lastReconnectAt = new Date().toISOString();
    state.voiceDisconnectObservedAt = 0;
    clearRestoreBlockState(state);
    runtime.clearReconnectTimer(state);
    runtime.attachConnectionHandlers(guildId, connection);
    noteRuntimeRecoverySuccess(runtime, guildId, `${runtime.config.name} rejoin-ready guild=${guildId}`);
    recordConnectionEvent(guildId, {
      botId: runtime.config.id || "",
      eventType: "reconnect",
      channelId: channel.id || "",
      details: "Voice reconnect ready",
    });
    if (channel.type === ChannelType.GuildStageVoice) {
      await runtime.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
    }
    runtime.queueVoiceStateReconcile(guildId, "voice-rejoin", 1200);

    if (state.currentStationKey) {
      try {
        await runtime.restartCurrentStation(state, guildId);
        logRuntimeRecoveryState(runtime, "INFO", "Reconnect erfolgreich", guildId, state, {
          reason: "reconnected",
          actualChannelId: channel.id,
        });
      } catch (err) {
        logError(`[${runtime.config.name}] Station restart after reconnect failed`, err, {
          context: buildRuntimeLogContext(runtime, guildId, state, {
            source: "reconnect-station-restart",
            voiceChannel: channel.id || null,
          }),
        });
      }
    }
    return { attempted: true, success: true, retryRecommended: false, reason: "reconnected" };
  } finally {
    state.reconnectInFlight = false;
    recordPlaybackPhase(runtime, guildId, state, "reconnect-done");
  }
}

export function handleRuntimeNetworkRecovered(runtime, recoveryEvent = null) {
  for (const [guildId, state] of runtime.guildState.entries()) {
    if (!state.shouldReconnect || !state.currentStationKey || !state.lastChannelId) continue;
    if (!runtimeRecoveryScopeMatches(runtime, guildId, recoveryEvent)) continue;
    if (state.reconnectInFlight || state.voiceConnectInFlight) continue;

    if (!state.connection) {
      if (state.reconnectTimer) {
        clearTimeout(state.reconnectTimer);
        state.reconnectTimer = null;
      }
      runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: "network-recovered" });
      continue;
    }

    if (state.player.state.status === AudioPlayerStatus.Idle && !state.streamRestartTimer && !state.streamRestartInFlight) {
      runtime.scheduleStreamRestart(guildId, state, 750, "network-recovered");
    }
  }
}

export function scheduleRuntimeReconnect(runtime, guildId, options = {}) {
  const state = runtime.getState(guildId);
  if (!state.shouldReconnect || !state.lastChannelId) return;
  if (runtime.isScheduledEventStopDue(state.activeScheduledEventStopAtMs)) {
    runtime.stopInGuild(guildId).catch(() => null);
    return;
  }
  if (options.resetAttempts) {
    state.reconnectAttempts = 0;
    state.reconnectCircuitTripCount = 0;
    state.reconnectCircuitOpenUntil = 0;
  }
  if (state.reconnectInFlight || state.voiceConnectInFlight) return;

  const shouldCountAttempt = options.countAttempt !== false;
  const currentAttempts = Number(state.reconnectAttempts || 0) || 0;
  const displayAttempt = shouldCountAttempt
    ? currentAttempts + 1
    : Math.max(1, currentAttempts);
  const tierConfig = getTierConfig(guildId);
  const baseDelay = Math.max(400, tierConfig.reconnectMs || 5_000);
  const parsedMinDelayMs = Number.parseInt(String(options.minDelayMs || 0), 10);
  const minDelayMs = Number.isFinite(parsedMinDelayMs) ? Math.max(0, parsedMinDelayMs) : 0;
  const parsedJitterFactor = Number.parseFloat(String(options.jitterFactor ?? ""));
  const jitterFactor = Number.isFinite(parsedJitterFactor)
    ? Math.max(0, Math.min(0.95, parsedJitterFactor))
    : 0.2;
  const exp = Math.min(Math.max(0, displayAttempt - 1), VOICE_RECONNECT_EXP_STEPS);
  let delay = Math.min(VOICE_RECONNECT_MAX_MS, baseDelay * Math.pow(1.8, exp));
  let logLevel = "INFO";
  let logMessage = null;
  let eventDetails = shouldCountAttempt
    ? `attempt=${displayAttempt} reason=${String(options.reason || "auto")}`
    : `attempt=hold:${currentAttempts} reason=${String(options.reason || "auto")}`;

  const networkCooldownMs = getRuntimeRecoveryDelayMs(runtime, guildId);
  if (!shouldCountAttempt && minDelayMs > 0) {
    delay = Math.max(networkCooldownMs, minDelayMs);
  } else {
    if (networkCooldownMs > 0) {
      delay = Math.max(delay, networkCooldownMs);
    }
    if (minDelayMs > 0) {
      delay = Math.max(delay, minDelayMs);
    }
  }
  const delayFloorMs = Math.max(networkCooldownMs, minDelayMs);

  const reason = String(options.reason || "auto");
  const nowMs = Date.now();
  let nextReconnectAttempts = Number(state.reconnectAttempts || 0) || 0;
  let nextCircuitTripCount = Number(state.reconnectCircuitTripCount || 0) || 0;
  let nextCircuitOpenUntil = Number(state.reconnectCircuitOpenUntil || 0) || 0;
  let shouldAbortReconnect = false;
  if (shouldCountAttempt && displayAttempt > VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS) {
    const circuitTripCount = nextCircuitTripCount + 1;
    if (circuitTripCount >= VOICE_RECONNECT_MAX_CIRCUIT_TRIPS) {
      nextReconnectAttempts = 0;
      nextCircuitTripCount = circuitTripCount;
      nextCircuitOpenUntil = 0;
      shouldAbortReconnect = true;
    } else {
      const circuitMultiplier = Math.min(4, Math.pow(2, Math.max(0, circuitTripCount - 1)));
      nextReconnectAttempts = 0;
      nextCircuitTripCount = circuitTripCount;
      delay = Math.max(delay, VOICE_RECONNECT_CIRCUIT_BREAKER_MS * circuitMultiplier);
      nextCircuitOpenUntil = nowMs + delay;
      logLevel = "WARN";
      logMessage =
        `[${runtime.config.name}] Reconnect-Circuit aktiv fuer guild=${guildId}: ` +
        `${displayAttempt - 1} Fehlversuche erreicht. Pausiere weitere Retries fuer ${Math.round(delay)}ms ` +
        `(reason=${reason}, trip=${circuitTripCount}).`;
      eventDetails =
        `attempt>${VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS} reason=${reason} ` +
        `circuit=open trip=${circuitTripCount}`;
    }
  } else {
    nextReconnectAttempts = shouldCountAttempt ? displayAttempt : nextReconnectAttempts;
    delay = !shouldCountAttempt && minDelayMs > 0
      ? Math.max(delayFloorMs, minDelayMs)
      : Math.max(delayFloorMs, applyJitter(delay, jitterFactor));
    logMessage = shouldCountAttempt
      ? `[${runtime.config.name}] Reconnecting guild=${guildId} in ${Math.round(delay)}ms ` +
        `(attempt ${displayAttempt}, plan=${tierConfig.tier}, reason=${reason})`
      : `[${runtime.config.name}] Reconnect-Pruefung guild=${guildId} in ${Math.round(delay)}ms ` +
        `(attempt ${Math.max(0, currentAttempts)}, plan=${tierConfig.tier}, reason=${reason})`;
  }

  const scheduledForAt = nowMs + delay;
  const pendingScheduledAt = Number(state.reconnectScheduledAt || 0) || 0;
  const hasPendingTimer = Boolean(state.reconnectTimer && pendingScheduledAt > nowMs);
  if (hasPendingTimer && pendingScheduledAt <= (scheduledForAt + VOICE_RECONNECT_RESCHEDULE_SLACK_MS)) {
    log(
      "INFO",
      `[${runtime.config.name}] Reconnect-Timer beibehalten guild=${guildId} ` +
      `(reason=${reason}, pendingIn=${Math.max(0, Math.round(pendingScheduledAt - nowMs))}ms)`
    );
    runtime.persistState?.();
    return;
  }

  state.reconnectAttempts = nextReconnectAttempts;
  state.reconnectCircuitTripCount = nextCircuitTripCount;
  state.reconnectCircuitOpenUntil = nextCircuitOpenUntil;

  if (shouldAbortReconnect) {
    parkRuntimeReconnectTarget(
      runtime,
      guildId,
      state,
      "circuit",
      `reconnect circuit exhausted after ${nextCircuitTripCount} trips (reason=${reason})`,
      { logLevel: "ERROR" }
    );
    return;
  }

  if (state.reconnectTimer) {
    clearTimeout(state.reconnectTimer);
    state.reconnectTimer = null;
  }

  recordConnectionEvent(guildId, {
    botId: runtime.config.id || "",
    eventType: "retry",
    channelId: state.lastChannelId || "",
    details: eventDetails,
  });

  log(logLevel, logMessage);
  state.reconnectScheduledAt = scheduledForAt;
  state.reconnectScheduledReason = reason;
  state.reconnectScheduledDelayMs = delay;
  state.reconnectTimer = setTimeout(async () => {
    state.reconnectTimer = null;
    state.reconnectScheduledAt = 0;
    state.reconnectScheduledReason = null;
    state.reconnectScheduledDelayMs = 0;
    if (!state.shouldReconnect) return;

    let result = null;
    try {
      result = await runtime.tryReconnect(guildId);
    } catch (err) {
      logError(`[${runtime.config.name}] Auto-Reconnect Tick fehlgeschlagen`, err, {
        context: buildRuntimeLogContext(runtime, guildId, state, {
          source: "reconnect-timer",
          reconnectReason: reason,
        }),
      });
    }
    if (result?.retryRecommended === false) {
      return;
    }
    if (state.shouldReconnect && !state.connection && !state.reconnectInFlight && !state.voiceConnectInFlight) {
      const nextOptions = { reason: "retry" };
      if (result?.attempted === false) {
        nextOptions.countAttempt = false;
        if (Number.isFinite(Number(result?.minDelayMs)) && Number(result.minDelayMs) > 0) {
          nextOptions.minDelayMs = Number(result.minDelayMs);
        }
      }
      if (state.parkedReason && !(Number(nextOptions.minDelayMs) > 0)) {
        // A parked target keeps the slow cadence until a join succeeds.
        nextOptions.countAttempt = false;
        nextOptions.minDelayMs = VOICE_PARKED_RETRY_MS;
        nextOptions.reason = `parked-${state.parkedReason}`;
      }
      runtime.scheduleReconnect(guildId, nextOptions);
    }
  }, delay);
  recordPlaybackPhase(runtime, guildId, state, `reconnect:${reason}`);

  runtime.persistState?.();
}
