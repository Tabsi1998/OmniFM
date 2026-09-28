import { AudioPlayerStatus } from "@discordjs/voice";
import { log } from "../lib/logging.js";
import { recordRuntimeIncident } from "../runtime-incidents-store.js";
import { isLikelyNetworkFailureLine } from "../lib/helpers.js";
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
import { recordConnectionEvent } from "../listening-stats-store.js";
import { isRuntimeVoiceConnected } from "./runtime-live-state.js";
import { recordPlaybackPhase } from "./playback-phase.js";
import { scheduleRuntimeReconnect } from "./runtime-reconnect.js";

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
export const VOICE_RECONNECT_RESOURCE_CONFIRMATIONS = Math.max(2, toPositiveInt(process.env.VOICE_RECONNECT_RESOURCE_CONFIRMATIONS, 3));
export const VOICE_RECONNECT_PERMISSION_CONFIRMATIONS = Math.max(
  VOICE_RECONNECT_RESOURCE_CONFIRMATIONS,
  toPositiveInt(process.env.VOICE_RECONNECT_PERMISSION_CONFIRMATIONS, 6)
);
export const VOICE_RECONNECT_READY_FAILURE_CONFIRMATIONS = Math.max(
  2,
  toPositiveInt(process.env.VOICE_RECONNECT_READY_FAILURE_CONFIRMATIONS, 4)
);
export const VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS = Math.max(
  5,
  toPositiveInt(process.env.VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS, 30)
);
export const VOICE_RECONNECT_CIRCUIT_BREAKER_MS = Math.max(
  60_000,
  toPositiveInt(process.env.VOICE_RECONNECT_CIRCUIT_BREAKER_MS, 15 * 60_000)
);
export const VOICE_RECONNECT_MAX_CIRCUIT_TRIPS = Math.max(
  1,
  toPositiveInt(process.env.VOICE_RECONNECT_MAX_CIRCUIT_TRIPS, 3)
);
export const VOICE_NETWORK_ERROR_RETRY_MIN_MS = 15_000;
export const VOICE_NETWORK_ERROR_RETRY_JITTER = 0.6;
export const VOICE_RECONNECT_RESCHEDULE_SLACK_MS = 1_000;
// Retry cadence for a parked reconnect target (#190).
export const VOICE_PARKED_RETRY_MS = Math.max(60_000, toPositiveInt(process.env.VOICE_PARKED_RETRY_MS, 15 * 60_000));

const PERMANENT_RESTORE_GUILD_ERROR_CODES = new Set([10004, 50001]);
const PERMANENT_RESTORE_CHANNEL_ERROR_CODES = new Set([10003]);

function getVoiceMovePolicy() {
  return VOICE_GUARD_DEFAULT_POLICY;
}

export function getExpectedRuntimeChannelId(state) {
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

export function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

export function getRuntimeRecoveryDelayMs(runtime, guildId) {
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

export function noteRuntimeRecoverySuccess(runtime, guildId, source) {
  if (typeof runtime?.noteNetworkRecoverySuccess === "function") {
    runtime.noteNetworkRecoverySuccess(guildId, source);
    return;
  }
  networkRecoveryCoordinator.noteSuccess(source);
}

export function runtimeRecoveryScopeMatches(runtime, guildId, recoveryEvent = null) {
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

export function getRuntimeErrorMessage(err) {
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

export function isRecoverableVoiceConnectionError(err) {
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

export function clearTransientVoiceIssues(state, codes = []) {
  if (!state) return;
  if (!Array.isArray(codes) || codes.length === 0) {
    state.transientVoiceIssues = {};
    return;
  }
  for (const code of codes) {
    clearTransientVoiceIssue(state, code);
  }
}

export function noteTransientVoiceIssue(state, code, detail = "") {
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
    `Reconnect geparkt (${code}): ${text || "-"} - Ziel bleibt gespeichert, nächster Versuch in ${Math.round(VOICE_PARKED_RETRY_MS / 1000)}s`,
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

export function unparkRuntimeReconnectTarget(runtime, guildId, state, channelId) {
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
      `[${runtime.config.name}] ${logMessage} guild=${guildId} (${issue.count}/${needed}) - warte auf Bestätigung.`
    );
    runtime.queueVoiceStateReconcile(guildId, recheckReason || code, VOICE_TRANSIENT_RECHECK_MS);
  }
  return { ...issue, confirmed, threshold: needed };
}

// Split into topic modules (#295); the public API stays here.
export {
  attachRuntimeConnectionHandlers,
  handleRuntimeNetworkRecovered,
  scheduleRuntimeReconnect,
  tryRuntimeReconnect,
} from "./runtime-reconnect.js";
export {
  handleRuntimeBotVoiceStateUpdate,
  resetRuntimeVoiceSession,
} from "./runtime-voice-state.js";
