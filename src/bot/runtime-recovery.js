import { ChannelType, PermissionFlagsBits } from "discord.js";
import {
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";

import { log, logError } from "../lib/logging.js";
import {
  applyJitter,
  isLikelyNetworkFailureLine,
  waitMs,
  VOICE_RECONNECT_MAX_MS,
  VOICE_RECONNECT_EXP_STEPS,
} from "../lib/helpers.js";
import { clearBotGuild, getBotState } from "../bot-state.js";
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

function toPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? fallbackValue), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

const VOICE_STATE_RECONCILE_ENABLED = String(process.env.VOICE_STATE_RECONCILE_ENABLED ?? "1") !== "0";
const VOICE_STATE_RECONCILE_MS = Math.max(15_000, toPositiveInt(process.env.VOICE_STATE_RECONCILE_MS, 30_000));
const VOICE_TRANSIENT_RECHECK_MS = Math.max(2_000, toPositiveInt(process.env.VOICE_TRANSIENT_RECHECK_MS, 5_000));
const VOICE_STATE_MISSING_CONFIRMATIONS = Math.max(2, toPositiveInt(process.env.VOICE_STATE_MISSING_CONFIRMATIONS, 2));
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
const RESTORE_RETRY_BASE_MS = Math.max(5_000, toPositiveInt(process.env.RESTORE_RETRY_BASE_MS, 15_000));
const RESTORE_RETRY_MAX_MS = Math.max(30_000, toPositiveInt(process.env.RESTORE_RETRY_MAX_MS, 5 * 60_000));
const VOICE_NETWORK_ERROR_RETRY_MIN_MS = 15_000;
const VOICE_NETWORK_ERROR_RETRY_JITTER = 0.6;
const VOICE_RECONNECT_RESCHEDULE_SLACK_MS = 1_000;

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

function getRuntimeVoiceGuardConfig(state) {
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

function isRuntimeVoiceGuardCooldownActive(state, nowMs = Date.now()) {
  return (Number(state?.voiceGuardCooldownUntil || 0) || 0) > nowMs;
}

function recordRuntimeVoiceGuardAction(state, action, {
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

function noteRuntimeVoiceGuardMove(state, config, {
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

function clearRuntimeVoiceGuardWindow(state) {
  if (!state) return;
  state.voiceGuardWindowStartedAt = 0;
  state.voiceGuardWindowMoveCount = 0;
}

function shouldProtectRuntimeVoiceChannel(state, expectedChannelId = getExpectedRuntimeChannelId(state), config = getRuntimeVoiceGuardConfig(state)) {
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

function parseStoredTimestampMs(value) {
  if (!value) return 0;
  const numeric = Number.parseInt(String(value ?? ""), 10);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function clearRestoreBlockState(state) {
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

function noteRuntimeRecoveryFailure(runtime, guildId, source, detail = "") {
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

function hasRecoverableRuntimeState(state) {
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

function buildRuntimeLogContext(runtime, guildId, state = null, extra = {}) {
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

function getRuntimePlayerStatus(state) {
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

function logRuntimeRecoveryState(runtime, level, message, guildId, state = null, extra = {}) {
  log(level, `[${runtime.config.name}] ${message} ${buildRuntimeRecoverySnapshot(runtime, guildId, state, extra)}`);
}

function isRecoverableVoiceConnectionError(err) {
  return isLikelyNetworkFailureLine(getRuntimeErrorMessage(err));
}

function shouldLogRecurringTransientIssue(issue) {
  const count = Number(issue?.count || 0);
  return count === 1 || (count % 5) === 0;
}

function getTransientVoiceIssues(state) {
  if (!state.transientVoiceIssues || typeof state.transientVoiceIssues !== "object") {
    state.transientVoiceIssues = {};
  }
  return state.transientVoiceIssues;
}

function clearTransientVoiceIssue(state, code) {
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

function abortRuntimeReconnectTarget(runtime, guildId, state, reason, { logLevel = "WARN" } = {}) {
  const channelId = String(state?.lastChannelId || "").trim();
  const detail = String(reason || "unknown").trim().slice(0, 200) || "unknown";
  logRuntimeRecoveryState(runtime, logLevel, `Auto-Reconnect gestoppt: ${detail}`, guildId, state, {
    reason: "reconnect-abort",
  });
  recordConnectionEvent(guildId, {
    botId: runtime.config.id || "",
    eventType: "error",
    channelId,
    details: `Auto reconnect stopped: ${detail}`.slice(0, 200),
  });
  runtime.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
}

function getDiscordErrorCode(err) {
  const parsed = Number.parseInt(String(err?.code ?? ""), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function isPermanentRestoreResourceError(err, resourceType) {
  const code = getDiscordErrorCode(err);
  if (!Number.isFinite(code)) return false;
  if (resourceType === "guild") return PERMANENT_RESTORE_GUILD_ERROR_CODES.has(code);
  if (resourceType === "channel") return PERMANENT_RESTORE_CHANNEL_ERROR_CODES.has(code);
  return false;
}

function getRuntimeRestoreTimers(runtime) {
  if (!(runtime.pendingRestoreTimers instanceof Map)) {
    runtime.pendingRestoreTimers = new Map();
  }
  return runtime.pendingRestoreTimers;
}

function getRuntimeRestoreRetryCounts(runtime) {
  if (!(runtime.restoreRetryCounts instanceof Map)) {
    runtime.restoreRetryCounts = new Map();
  }
  return runtime.restoreRetryCounts;
}

export function clearRuntimeRestoreRetry(runtime, guildId) {
  const key = String(guildId || "").trim();
  if (!key) return;
  const timers = getRuntimeRestoreTimers(runtime);
  const retryCounts = getRuntimeRestoreRetryCounts(runtime);
  const timer = timers.get(key);
  if (timer) {
    clearTimeout(timer);
    timers.delete(key);
  }
  retryCounts.delete(key);
}

function getRestoreRetryDelay(runtime, guildId) {
  const key = String(guildId || "").trim();
  const retryCounts = getRuntimeRestoreRetryCounts(runtime);
  const attempt = Number(retryCounts.get(key) || 0) + 1;
  retryCounts.set(key, attempt);
  const exp = Math.min(Math.max(0, attempt - 1), 6);
  const baseDelay = Math.min(RESTORE_RETRY_MAX_MS, RESTORE_RETRY_BASE_MS * Math.pow(2, exp));
  return {
    attempt,
    delay: applyJitter(baseDelay, 0.2),
  };
}

function scheduleRuntimeRestoreResume(runtime, guildId, data, stations, delayMs, reason = "blocked") {
  const key = String(guildId || "").trim();
  if (!key) return false;
  const timers = getRuntimeRestoreTimers(runtime);
  if (timers.has(key)) return false;

  const safeDelayMs = Math.max(1_000, Number(delayMs || 0) || 1_000);
  log(
    "WARN",
    `[${runtime.config.name}] Restore fuer guild=${key} pausiert (${reason}) - retry in ${Math.round(safeDelayMs)}ms.`
  );

  const timer = setTimeout(() => {
    timers.delete(key);
    restoreRuntimeGuildEntry(runtime, key, data, stations, { source: "restore-blocked-resume", reason }).catch((err) => {
      const state = runtime.guildState?.get?.(key);
      logError(`[${runtime.config.name}] Restore-Resume fehlgeschlagen`, err, {
        context: buildRuntimeLogContext(runtime, key, state, {
          source: "restore-blocked-resume",
          resumeReason: reason,
          restoreChannel: data?.channelId || null,
          restoreStation: data?.stationKey || null,
        }),
      });
      if (state?.shouldReconnect && state?.currentStationKey && state?.lastChannelId) {
        runtime.scheduleReconnect?.(key, { reason: "restore-resume-error" });
      }
    });
  }, safeDelayMs);
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
  timers.set(key, timer);
  return true;
}

async function fetchRestoreGuild(runtime, guildId) {
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

async function fetchRestoreChannel(guild, channelId) {
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

function scheduleRuntimeRestoreRetry(runtime, guildId, data, stations, reason = "retry") {
  const key = String(guildId || "").trim();
  if (!key) return;
  const timers = getRuntimeRestoreTimers(runtime);
  if (timers.has(key)) return;

  const { attempt, delay } = getRestoreRetryDelay(runtime, key);
  log(
    "WARN",
    `[${runtime.config.name}] Restore fuer guild=${key} verschoben (${reason}) - retry in ${Math.round(delay)}ms (attempt ${attempt}).`
  );

  const timer = setTimeout(() => {
    timers.delete(key);
    restoreRuntimeGuildEntry(runtime, key, data, stations, { source: "restore-retry", reason }).catch((err) => {
      const state = runtime.guildState?.get?.(key);
      logError(`[${runtime.config.name}] Restore-Retry fehlgeschlagen`, err, {
        context: buildRuntimeLogContext(runtime, key, state, {
          source: "restore-retry",
          retryReason: reason,
          restoreChannel: data?.channelId || null,
          restoreStation: data?.stationKey || null,
        }),
      });
      if (state?.shouldReconnect && state?.currentStationKey && state?.lastChannelId) {
        runtime.scheduleReconnect?.(key, { reason: "restore-retry-error" });
      }
    });
  }, delay);
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
  timers.set(key, timer);
}

function syncObservedRuntimeChannel(runtime, state, actualChannelId) {
  const normalizedActualChannelId = String(actualChannelId || "").trim();
  if (!normalizedActualChannelId) return false;
  if (String(state?.lastChannelId || "").trim() === normalizedActualChannelId) {
    return false;
  }
  runtime.markNowPlayingTargetDirty(state, normalizedActualChannelId);
  state.lastChannelId = normalizedActualChannelId;
  runtime.persistState();
  return true;
}

function confirmTransientVoiceIssue(runtime, guildId, state, code, detail, {
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

export function handleRuntimeBotVoiceStateUpdate(runtime, oldState, newState) {
  if (!runtime.client.user) return;
  if (newState.id !== runtime.client.user.id) return;

  const guildId = newState.guild.id;
  const state = runtime.getState(guildId);
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
}

export function clearQueuedRuntimeVoiceReconcile(runtime, guildId) {
  const key = String(guildId || "").trim();
  const timer = runtime.pendingVoiceReconcileTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    runtime.pendingVoiceReconcileTimers.delete(key);
  }
}

export function queueRuntimeVoiceStateReconcile(runtime, guildId, reason = "queued", delayMs = 1200) {
  const key = String(guildId || "").trim();
  if (!key) return;
  runtime.clearQueuedVoiceReconcile(key);
  const timer = setTimeout(() => {
    runtime.pendingVoiceReconcileTimers.delete(key);
    runtime.reconcileGuildVoiceState(key, { reason }).catch((err) => {
      const state = runtime.guildState?.get?.(key);
      logError(`[${runtime.config.name}] Voice-State-Reconcile (${reason}) fehlgeschlagen`, err, {
        level: "WARN",
        context: buildRuntimeLogContext(runtime, key, state, {
          source: "voice-state-reconcile",
        }),
      });
    });
  }, Math.max(0, delayMs));
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
  runtime.pendingVoiceReconcileTimers.set(key, timer);
}

export async function confirmRuntimeBotVoiceChannel(
  runtime,
  guildId,
  expectedChannelId,
  { timeoutMs = 10_000, intervalMs = 800 } = {}
) {
  const normalizedGuildId = String(guildId || "").trim();
  const normalizedChannelId = String(expectedChannelId || "").trim();
  if (!normalizedGuildId || !normalizedChannelId) return false;

  const startedAt = Date.now();
  while ((Date.now() - startedAt) <= Math.max(intervalMs, timeoutMs)) {
    const { channelId } = await runtime.fetchBotVoiceState(normalizedGuildId);
    if (String(channelId || "").trim() === normalizedChannelId) {
      return true;
    }
    await waitMs(intervalMs);
  }
  return false;
}

export async function fetchRuntimeBotVoiceState(runtime, guildId) {
  const guild = runtime.client.guilds.cache.get(guildId) || await runtime.client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { guild: null, voiceState: null, channelId: null };

  try {
    const voiceState = await guild.voiceStates.fetch("@me", { force: true, cache: true });
    return { guild, voiceState, channelId: voiceState?.channelId || null };
  } catch {
    const cachedMember = guild.members?.me || null;
    const cachedChannelId = String(cachedMember?.voice?.channelId || "").trim();
    if (cachedChannelId) {
      return { guild, voiceState: cachedMember.voice || null, channelId: cachedChannelId };
    }

    const fetchedMember = await guild.members?.fetchMe?.().catch(() => null);
    const memberChannelId = String(fetchedMember?.voice?.channelId || "").trim();
    return {
      guild,
      voiceState: fetchedMember?.voice || null,
      channelId: memberChannelId || null,
    };
  }
}

export async function reconcileRuntimeGuildVoiceState(runtime, guildId, { reason = "periodic" } = {}) {
  if (!runtime.client.isReady()) return;
  const state = runtime.guildState.get(guildId);
  if (!state) return;
  if (!state.connection && !state.currentStationKey && !state.lastChannelId) return;
  const voiceGuardConfig = getRuntimeVoiceGuardConfig(state);

  const { channelId: actualChannelId } = await runtime.fetchBotVoiceState(guildId);
  const connectionChannelId = String(state.connection?.joinConfig?.channelId || "").trim() || null;
  let expectedChannelId = connectionChannelId || state.lastChannelId || null;

  if (actualChannelId && !expectedChannelId) {
    syncObservedRuntimeChannel(runtime, state, actualChannelId);
    expectedChannelId = String(actualChannelId || "").trim() || null;
  } else if (actualChannelId && connectionChannelId && actualChannelId === connectionChannelId) {
    if (syncObservedRuntimeChannel(runtime, state, actualChannelId)) {
      expectedChannelId = String(actualChannelId || "").trim() || null;
    }
  }

  const voiceOperationInFlight = Boolean(
    state.voiceConnectInFlight
    || state.reconnectInFlight
    || state.reconnectTimer
  );
  const shouldDeferVoiceMismatch = Boolean(
    state.voiceConnectInFlight
    || state.reconnectInFlight
    || (!actualChannelId && state.reconnectTimer)
  );
  if (shouldDeferVoiceMismatch && (!actualChannelId || (expectedChannelId && actualChannelId !== expectedChannelId))) {
    runtime.queueVoiceStateReconcile(guildId, `voice-op-inflight-${reason}`, 1500);
    return;
  }

  if (!actualChannelId) {
    const shouldReconnect = Boolean(state.shouldReconnect && state.currentStationKey && state.lastChannelId);
    if (!state.connection && !state.currentProcess && !shouldReconnect) return;
    if (!state.connection && shouldReconnect && voiceOperationInFlight) {
      return;
    }
    const issue = confirmTransientVoiceIssue(
      runtime,
      guildId,
      state,
      "voice-state-missing",
      `${expectedChannelId || "-"}:${reason}`,
      {
        threshold: VOICE_STATE_MISSING_CONFIRMATIONS,
        recheckReason: `voice-state-confirm-${reason}`,
        logMessage: `Voice-State abweichend erkannt (expected=${expectedChannelId || "-"}, reason=${reason})`,
      }
    );
    if (!issue.confirmed) {
      return;
    }
    clearTransientVoiceIssue(state, "voice-state-missing");
    log(
      "WARN",
      `[${runtime.config.name}] Voice-State abweichung bestaetigt (guild=${guildId}, expected=${expectedChannelId || "-"}, reason=${reason}).`
    );
    state.voiceDisconnectObservedAt = state.voiceDisconnectObservedAt || Date.now();
    runtime.resetVoiceSession(guildId, state, {
      preservePlaybackTarget: shouldReconnect,
      clearLastChannel: !shouldReconnect,
    });
    if (shouldReconnect) {
      runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: `voice-state-${reason}` });
    }
    return;
  }
  clearTransientVoiceIssue(state, "voice-state-missing");
  clearTransientVoiceIssue(state, "voice-state-update-missing");
  state.voiceDisconnectObservedAt = 0;

  if (expectedChannelId && actualChannelId !== expectedChannelId) {
    const protectedMove = shouldProtectRuntimeVoiceChannel(state, expectedChannelId, voiceGuardConfig);
    const issue = confirmTransientVoiceIssue(
      runtime,
      guildId,
      state,
      "voice-channel-mismatch",
      `${expectedChannelId}:${actualChannelId}:${reason}`,
      {
        threshold: protectedMove ? voiceGuardConfig.moveConfirmations : VOICE_STATE_MISSING_CONFIRMATIONS,
        recheckReason: `voice-channel-mismatch-confirm-${reason}`,
        logMessage: `Voice-Channel-Mismatch erkannt (expected=${expectedChannelId}, actual=${actualChannelId}, reason=${reason})`,
      }
    );
    if (!issue.confirmed) {
      return;
    }
    clearTransientVoiceIssue(state, "voice-channel-mismatch");
    if (protectedMove) {
      const movePolicy = voiceGuardConfig.policy;
      const nowMs = Date.now();
      const remainingGuardCooldownMs = Math.max(0, (Number(state.voiceGuardCooldownUntil || 0) || 0) - nowMs);
      const moveSummary = noteRuntimeVoiceGuardMove(state, voiceGuardConfig, {
        expectedChannelId,
        actualChannelId,
        nowMs,
      });
      log(
        "WARN",
        `[${runtime.config.name}] Fremdverschiebung bestaetigt guild=${guildId} expected=${expectedChannelId} actual=${actualChannelId} - Policy=${movePolicy}.`
      );
      if (moveSummary.exceededWindow) {
        state.voiceGuardEscalationCount = (Number(state.voiceGuardEscalationCount || 0) || 0) + 1;
        if (voiceGuardConfig.escalation === "cooldown") {
          state.voiceGuardCooldownUntil = nowMs + voiceGuardConfig.escalationCooldownMs;
          recordRuntimeVoiceGuardAction(state, "cooldown", {
            reason: "foreign-move-escalated",
            expectedChannelId,
            actualChannelId,
            atMs: nowMs,
          });
          runtime.persistState?.();
          runtime.queueVoiceStateReconcile(guildId, "voice-guard-cooldown", voiceGuardConfig.escalationCooldownMs);
          return;
        }

        state.voiceGuardDisconnectCount = (Number(state.voiceGuardDisconnectCount || 0) || 0) + 1;
        state.shouldReconnect = false;
        recordRuntimeVoiceGuardAction(state, "disconnect", {
          reason: "foreign-move-escalated",
          expectedChannelId,
          actualChannelId,
          atMs: nowMs,
        });
        runtime.resetVoiceSession(guildId, state, {
          preservePlaybackTarget: false,
          clearLastChannel: true,
        });
        return;
      }
      if (movePolicy === "disconnect") {
        state.voiceGuardDisconnectCount = (Number(state.voiceGuardDisconnectCount || 0) || 0) + 1;
        state.shouldReconnect = false;
        recordRuntimeVoiceGuardAction(state, "disconnect", {
          reason: "foreign-move-policy",
          expectedChannelId,
          actualChannelId,
          atMs: nowMs,
        });
        runtime.resetVoiceSession(guildId, state, {
          preservePlaybackTarget: false,
          clearLastChannel: true,
        });
        return;
      }

      state.voiceGuardReturnCount = (Number(state.voiceGuardReturnCount || 0) || 0) + 1;
      state.voiceGuardCooldownUntil = nowMs + voiceGuardConfig.returnCooldownMs;
      recordRuntimeVoiceGuardAction(state, "return", {
        reason: "foreign-move-policy",
        expectedChannelId,
        actualChannelId,
        atMs: nowMs,
      });
      if (state.connection) {
        try { state.connection.destroy(); } catch {}
      }
      const reconnectOptions = {
        resetAttempts: true,
        reason: "voice-channel-mismatch-guard",
      };
      if (remainingGuardCooldownMs > 0) {
        reconnectOptions.minDelayMs = remainingGuardCooldownMs;
      }
      runtime.scheduleReconnect(guildId, reconnectOptions);
      return;
    }

    syncObservedRuntimeChannel(runtime, state, actualChannelId);
    if (!state.currentProcess && state.player.state.status === AudioPlayerStatus.Idle && !state.reconnectTimer) {
      runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: "voice-channel-mismatch" });
      return;
    }
  } else {
    clearTransientVoiceIssue(state, "voice-channel-mismatch");
    if (expectedChannelId && actualChannelId === expectedChannelId) {
      clearRuntimeVoiceGuardWindow(state);
      if (isRuntimeVoiceGuardCooldownActive(state)) {
        state.voiceGuardCooldownUntil = 0;
      }
    }
  }

  if (
    actualChannelId
    && !state.connection
    && state.currentStationKey
    && state.lastChannelId
    && actualChannelId === state.lastChannelId
  ) {
    const issue = confirmTransientVoiceIssue(
      runtime,
      guildId,
      state,
      "voice-local-connection-missing",
      `${actualChannelId}:${reason}:${getRuntimePlayerStatus(state)}:${state.currentProcess ? 1 : 0}`,
      {
        threshold: VOICE_STATE_MISSING_CONFIRMATIONS,
        recheckReason: `voice-local-connection-confirm-${reason}`,
        logMessage: `Lokaler Voice-Handle fehlt trotz Discord-Voice-State (channel=${actualChannelId}, reason=${reason})`,
      }
    );
    if (!issue.confirmed) {
      return;
    }

    if (state.currentProcess || state.player.state.status !== AudioPlayerStatus.Idle) {
      if (issue.count === issue.threshold || shouldLogRecurringTransientIssue(issue)) {
        logRuntimeRecoveryState(
          runtime,
          "WARN",
          "Stale local voice state bestaetigt - Discord sieht den Bot noch im Channel, lokaler Handle fehlt",
          guildId,
          state,
          {
            expectedChannelId,
            actualChannelId,
            reason,
            issue: "voice-local-connection-missing",
          }
        );
      }
      runtime.queueVoiceStateReconcile(guildId, `voice-local-stale-${reason}`, Math.max(8_000, VOICE_TRANSIENT_RECHECK_MS));
      return;
    }

    clearTransientVoiceIssue(state, "voice-local-connection-missing");
    logRuntimeRecoveryState(
      runtime,
      "WARN",
      "Lokaler Voice-Handle fehlt und Wiedergabe ist nicht aktiv - Reconnect wird erzwungen",
      guildId,
      state,
      {
        expectedChannelId,
        actualChannelId,
        reason,
        issue: "voice-local-connection-missing",
      }
    );
    runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: `voice-local-stale-${reason}` });
    return;
  }
  clearTransientVoiceIssue(state, "voice-local-connection-missing");

  if (!state.connection && state.currentStationKey && state.lastChannelId) {
    if (voiceOperationInFlight) return;
    logRuntimeRecoveryState(
      runtime,
      "WARN",
      "Lokale Voice-Verbindung fehlt - Reconnect wird geplant",
      guildId,
      state,
      {
        expectedChannelId,
        actualChannelId,
        reason: `voice-no-local-connection-${reason}`,
      }
    );
    runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: `voice-no-local-connection-${reason}` });
    return;
  }

  if (
    state.currentStationKey
    && state.player.state.status === AudioPlayerStatus.Idle
    && !state.streamRestartTimer
    && !state.streamRestartInFlight
    && !state.reconnectTimer
  ) {
    runtime.scheduleStreamRestart(guildId, state, 750, `voice-health-${reason}`);
  }
  if (state.currentStationKey) {
    runtime.syncVoiceChannelStatus(guildId, state.currentStationName || state.currentStationKey).catch(() => null);
  }
}

export async function tickRuntimeVoiceStateHealth(runtime) {
  if (!VOICE_STATE_RECONCILE_ENABLED) return;
  if (!runtime.client.isReady()) return;

  for (const guildId of runtime.guildState.keys()) {
    // eslint-disable-next-line no-await-in-loop
    await runtime.reconcileGuildVoiceState(guildId, { reason: "timer" });
  }
}

export function startRuntimeVoiceStateReconciler(runtime) {
  if (!VOICE_STATE_RECONCILE_ENABLED) return;
  if (runtime.voiceHealthTimer) return;

  const run = () => {
    runtime.tickVoiceStateHealth().catch((err) => {
      logError(`[${runtime.config.name}] Voice-State-Reconcile Fehler`, err, {
        context: {
          bot: runtime?.config?.name || null,
          botId: runtime?.config?.id || null,
          source: "voice-health-timer",
        },
      });
    });
  };

  run();
  runtime.voiceHealthTimer = setInterval(run, VOICE_STATE_RECONCILE_MS);
}

export function stopRuntimeVoiceStateReconciler(runtime) {
  if (runtime.voiceHealthTimer) {
    clearInterval(runtime.voiceHealthTimer);
    runtime.voiceHealthTimer = null;
  }
  for (const guildId of runtime.pendingVoiceReconcileTimers.keys()) {
    runtime.clearQueuedVoiceReconcile(guildId);
  }
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
        abortRuntimeReconnectTarget(
          runtime,
          guildId,
          state,
          `permissions still missing after ${issue.count} checks (channel=${channel.id}, detail=${missingBits.join(",") || "unknown"})`
        );
        return { attempted: false, retryRecommended: false, reason: "permissions-missing-confirmed" };
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
        abortRuntimeReconnectTarget(
          runtime,
          guildId,
          state,
          `voice ready timeout repeated ${issue.count}x (channel=${channel.id}, state=${connection.state?.status || "unknown"})`,
          { logLevel: "ERROR" }
        );
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
        abortRuntimeReconnectTarget(
          runtime,
          guildId,
          state,
          `voice state confirmation failed ${issue.count}x (channel=${channel.id})`,
          { logLevel: "ERROR" }
        );
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
    abortRuntimeReconnectTarget(
      runtime,
      guildId,
      state,
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
      runtime.scheduleReconnect(guildId, nextOptions);
    }
  }, delay);

  runtime.persistState?.();
}

export async function restoreRuntimeGuildEntry(runtime, guildId, data, stations, { source = "restore" } = {}) {
  void stations;
  const nowMs = Date.now();
  const restoreBlockedUntil = parseStoredTimestampMs(data?.restoreBlockedUntil);
  const restoreBlockedAt = parseStoredTimestampMs(data?.restoreBlockedAt);
  const restoreBlockCount = Math.max(0, Number.parseInt(String(data?.restoreBlockCount || 0), 10) || 0);
  const restoreBlockReason = String(data?.restoreBlockReason || "").trim() || null;
  const existingState = runtime.guildState.get(guildId);
  if (
    existingState?.currentStationKey === data.stationKey
    && existingState?.lastChannelId === data.channelId
    && hasRecoverableRuntimeState(existingState)
  ) {
    clearRuntimeRestoreRetry(runtime, guildId);
    return { ok: true, skipped: true, reason: "already-active" };
  }

  if (restoreBlockedUntil > nowMs) {
    clearRuntimeRestoreRetry(runtime, guildId);
    const remainingMs = Math.max(1_000, restoreBlockedUntil - nowMs);
    scheduleRuntimeRestoreResume(runtime, guildId, data, stations, remainingMs, "cooldown");
    return {
      ok: false,
      blocked: true,
      retryScheduled: true,
      remainingMs,
      reason: restoreBlockReason || "restore-cooldown",
    };
  }

  const { guild, error: guildError } = await fetchRestoreGuild(runtime, guildId);
  if (!guild) {
    if (isPermanentRestoreResourceError(guildError, "guild")) {
      clearRuntimeRestoreRetry(runtime, guildId);
      log("INFO", `[${runtime.config.name}] Guild ${guildId} ist nicht mehr verfuegbar. Entferne gespeicherten Restore-State.`);
      clearBotGuild(runtime.config.id, guildId);
      return { ok: false, permanent: true, resource: "guild" };
    }
    log(
      "WARN",
      `[${runtime.config.name}] Guild ${guildId} fuer Restore derzeit nicht aufloesbar: ${guildError?.message || "unbekannter Fehler"}`
    );
    scheduleRuntimeRestoreRetry(runtime, guildId, data, stations, "guild-unresolved");
    return { ok: false, transient: true, resource: "guild" };
  }

  const allowedForRestore = await runtime.enforceGuildAccessForGuild(guild, source);
  if (!allowedForRestore) {
    clearRuntimeRestoreRetry(runtime, guildId);
    return { ok: false, blocked: true };
  }

  const { channel, error: channelError } = await fetchRestoreChannel(guild, data.channelId);
  if (!channel) {
    if (isPermanentRestoreResourceError(channelError, "channel")) {
      clearRuntimeRestoreRetry(runtime, guildId);
      log("INFO", `[${runtime.config.name}] Channel ${data.channelId} in ${guild.name} existiert nicht mehr. Entferne gespeicherten Restore-State.`);
      clearBotGuild(runtime.config.id, guildId);
      return { ok: false, permanent: true, resource: "channel" };
    }
    log(
      "WARN",
      `[${runtime.config.name}] Channel ${data.channelId} in ${guild.name} fuer Restore derzeit nicht aufloesbar: ${channelError?.message || "unbekannter Fehler"}`
    );
    scheduleRuntimeRestoreRetry(runtime, guildId, data, stations, "channel-unresolved");
    return { ok: false, transient: true, resource: "channel" };
  }

  if (!channel.isVoiceBased()) {
    clearRuntimeRestoreRetry(runtime, guildId);
    log("INFO", `[${runtime.config.name}] Channel ${data.channelId} in ${guild.name} ist kein Voice-/Stage-Channel mehr.`);
    clearBotGuild(runtime.config.id, guildId);
    return { ok: false, permanent: true, resource: "channel-type" };
  }

  const restoredStation = runtime.resolveStationForGuild(guildId, data.stationKey, runtime.resolveGuildLanguage(guildId));
  if (!restoredStation.ok) {
    clearRuntimeRestoreRetry(runtime, guildId);
    log("INFO", `[${runtime.config.name}] Station ${data.stationKey} nicht mehr vorhanden: ${restoredStation.message}`);
    clearBotGuild(runtime.config.id, guildId);
    return { ok: false, permanent: true, resource: "station" };
  }

  log("INFO", `[${runtime.config.name}] Reconnect: ${guild.name} / #${channel.name} / ${restoredStation.station.name}`);

  const state = runtime.getState(guildId);
  if (typeof runtime.refreshVoiceGuardSettings === "function") {
    await runtime.refreshVoiceGuardSettings(guildId).catch(() => null);
  }
  state.restoreBlockCount = restoreBlockCount;
  state.restoreBlockedAt = restoreBlockedAt;
  state.restoreBlockedUntil = restoreBlockedUntil > nowMs ? restoreBlockedUntil : 0;
  state.restoreBlockReason = restoreBlockReason;
  const restoredChannelVolume = data?.channelVolumes?.[String(data.channelId || "").trim()];
  state.volume = restoredChannelVolume ?? data.volume ?? state.volume ?? 100;
  state.channelVolumes = {
    ...(state.channelVolumes || {}),
    ...(data.channelVolumes || {}),
  };
  state.volumePreferenceSet = Number.isFinite(Number(state.volume));
  state.shouldReconnect = true;
  state.lastChannelId = data.channelId;
  state.currentStationKey = restoredStation.key;
  state.currentStationName = restoredStation.station.name || restoredStation.key;
  runtime.markScheduledEventPlayback(
    state,
    data.scheduledEventId || null,
    data.scheduledEventStopAtMs || 0
  );
  runtime.persistState?.();

  try {
    await runtime.ensureVoiceConnectionForChannel(guildId, channel.id, state, { source });
  } catch (err) {
    clearRuntimeRestoreRetry(runtime, guildId);
    logError(`[${runtime.config.name}] Voice-Verbindung zu ${guild.name} fehlgeschlagen`, err, {
      context: buildRuntimeLogContext(runtime, guildId, state, {
        source,
        guildName: guild.name,
        channelName: channel.name,
        voiceChannel: channel.id || null,
      }),
    });
    noteRuntimeRecoveryFailure(runtime, guildId, `${runtime.config.name} restore-voice-timeout`, `guild=${guildId}`);
    runtime.scheduleReconnect(guildId, { reason: "restore-ready-timeout" });
    return { ok: false, reconnectScheduled: true };
  }

  clearRestoreBlockState(state);
  await runtime.playStation(state, restoredStation.stations, restoredStation.key, guildId, {
    countAsStart: false,
    resumeSession: true,
  });
  clearRuntimeRestoreRetry(runtime, guildId);
  log("INFO", `[${runtime.config.name}] Wiederhergestellt: ${guild.name} -> ${restoredStation.station.name}`);

  await waitMs(2000);
  return { ok: true };
}

export async function restoreRuntimeState(runtime, stations) {
  void stations;
  const saved = getBotState(runtime.config.id);
  if (!saved || Object.keys(saved).length === 0) {
    log("INFO", `[${runtime.config.name}] Kein gespeicherter State gefunden (bot-id: ${runtime.config.id}).`);
    return;
  }

  const restorableEntries = Object.entries(saved).filter(([_, data]) => data?.stationKey && data?.channelId);
  if (restorableEntries.length === 0) {
    log("INFO", `[${runtime.config.name}] Nur gespeicherte Guild-Einstellungen gefunden (kein aktives Restore-Ziel).`);
    return;
  }

  log("INFO", `[${runtime.config.name}] Stelle ${restorableEntries.length} Verbindung(en) wieder her...`);

  for (const [guildId, data] of restorableEntries) {
    try {
      await restoreRuntimeGuildEntry(runtime, guildId, data, stations, { source: "restore" });
    } catch (err) {
      const state = runtime.guildState.get(guildId);
      logError(`[${runtime.config.name}] Restore fehlgeschlagen`, err, {
        context: buildRuntimeLogContext(runtime, guildId, state, {
          source: "restore",
          restoreChannel: data?.channelId || null,
          restoreStation: data?.stationKey || null,
        }),
      });
      if (state?.shouldReconnect && state.lastChannelId && state.currentStationKey) {
        runtime.scheduleReconnect(guildId, { reason: "restore-error" });
      }
    }
  }
}
