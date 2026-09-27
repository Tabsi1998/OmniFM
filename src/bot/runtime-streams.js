import { log } from "../lib/logging.js";
import {
  isLikelyNetworkFailureLine,
  STREAM_STABLE_RESET_MS,
  STREAM_RESTART_BASE_MS,
  STREAM_RESTART_MAX_MS,
  STREAM_ERROR_COOLDOWN_THRESHOLD,
  STREAM_ERROR_COOLDOWN_MS,
} from "../lib/helpers.js";
import { networkRecoveryCoordinator } from "../core/network-recovery.js";
import { getServerPlanConfig } from "../core/entitlements.js";
import {
  clearFailoverFailureWindow,
  recordFailoverFailure,
} from "../lib/stream-failover-policy.js";
import { dispatchRuntimeReliabilityWebhook } from "../lib/runtime-alerts.js";
import { dispatchRuntimeIncidentAlert } from "../lib/runtime-discord-alerts.js";
import { recordRuntimeIncident } from "../runtime-incidents-store.js";
import { isRuntimeVoiceConnected } from "./runtime-live-state.js";
import { AudioPlayerStatus } from "@discordjs/voice";

// Moved to runtime-failback.js (#210); re-exported for existing importers.
export {
  shouldHandleRuntimeIdleEvent,
  clearRuntimeFailbackTimer,
  getRuntimeFailbackDelayMs,
  isRuntimeFailbackPending,
  armRuntimeFailbackProbe,
  probeRuntimeStreamUrl,
  runRuntimeFailbackProbe,
  resolveReplacementStationForGuild,
  notifyRuntimeStationUnavailable,
  handleRuntimeStationUnavailable,
  keepRuntimeFailoverStation,
} from "./runtime-failback.js";

export function toPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? fallbackValue), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

export const IDLE_RESTART_WINDOW_MS = toPositiveInt(process.env.STREAM_IDLE_RESTART_WINDOW_MS, 15 * 60_000);
export const IDLE_RESTART_EXP_STEPS = toPositiveInt(process.env.STREAM_IDLE_RESTART_EXP_STEPS, 6);
const STREAM_HEALTHCHECK_ENABLED = String(process.env.STREAM_HEALTHCHECK_ENABLED ?? "1") !== "0";
const STREAM_HEALTHCHECK_POLL_MS = Math.max(5_000, toPositiveInt(process.env.STREAM_HEALTHCHECK_POLL_MS, 15_000));
const STREAM_HEALTHCHECK_GRACE_MS = Math.max(10_000, toPositiveInt(process.env.STREAM_HEALTHCHECK_GRACE_MS, 30_000));
const STREAM_HEALTHCHECK_STALL_MS = Math.max(
  STREAM_HEALTHCHECK_POLL_MS * 2,
  toPositiveInt(process.env.STREAM_HEALTHCHECK_STALL_MS, 45_000)
);
const STREAM_HEALTHCHECK_RESTART_MS = Math.max(750, toPositiveInt(process.env.STREAM_HEALTHCHECK_RESTART_MS, 1_250));
export const STREAM_RESTART_RESCHEDULE_SLACK_MS = 1_000;

export function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

export function shouldEmitRecoveredAlert({ errorCount = 0, reconnectAttempts = 0, reason = "" } = {}) {
  if ((Number(errorCount) || 0) > 0) return true;
  if ((Number(reconnectAttempts) || 0) > 0) return true;

  const normalizedReason = String(reason || "").trim().toLowerCase();
  if (!normalizedReason) return false;
  return !["provider-eof", "restart", "network-cooldown"].includes(normalizedReason);
}

function dispatchRuntimeIncidentChannelAlert(runtime, input) {
  const dispatch = typeof runtime?.dispatchIncidentAlert === "function"
    ? runtime.dispatchIncidentAlert.bind(runtime)
    : dispatchRuntimeIncidentAlert;
  return dispatch({
    ...input,
    runtime,
  });
}

export async function emitRuntimeReliabilityAlert(runtime, guildId, eventKey, payload = {}) {
  const guild = runtime?.client?.guilds?.cache?.get(guildId) || null;
  const tier = getTierConfig(guildId).tier;
  const runtimePayload = {
    runtime: {
      id: String(runtime?.config?.id || "").trim(),
      name: String(runtime?.config?.name || "").trim(),
      role: String(runtime?.role || "").trim(),
    },
    ...payload,
  };

  try {
    await recordRuntimeIncident({
      guildId,
      guildName: guild?.name || guildId,
      tier,
      eventKey,
      runtime: runtimePayload.runtime,
      payload: runtimePayload,
    });
  } catch {}

  void dispatchRuntimeIncidentChannelAlert(runtime, {
    guildId,
    guildName: guild?.name || guildId,
    tier,
    eventKey,
    payload: runtimePayload,
  }).catch(() => null);

  return dispatchRuntimeReliabilityWebhook({
    guildId,
    guildName: guild?.name || guildId,
    tier,
    eventKey,
    source: "runtime",
    payload: runtimePayload,
  });
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

function noteRuntimeRecoverySuccess(runtime, guildId, source) {
  if (typeof runtime?.noteNetworkRecoverySuccess === "function") {
    runtime.noteNetworkRecoverySuccess(guildId, source);
    return;
  }
  networkRecoveryCoordinator.noteSuccess(source);
}

export function getRuntimeStreamSnapshot(runtime, guildId, state = null, extra = {}) {
  const detail = [
    `guild=${guildId || "-"}`,
    `station=${state?.currentStationKey || "-"}`,
    `channel=${state?.lastChannelId || state?.connection?.joinConfig?.channelId || "-"}`,
    `voiceLocal=${state?.connection ? 1 : 0}`,
    `player=${String(state?.player?.state?.status || "").trim() || "unknown"}`,
    `process=${state?.currentProcess ? 1 : 0}`,
    `errors=${Number(state?.streamErrorCount || 0) || 0}`,
  ];
  if (state?.streamRestartTimer) detail.push("stream=1");
  if (state?.streamRestartInFlight === true) detail.push("streamFlight=1");
  if (state?.reconnectTimer) detail.push("reconnect=1");
  if (state?.reconnectInFlight === true) detail.push("reconnectFlight=1");
  if (state?.voiceConnectInFlight === true) detail.push("voiceFlight=1");
  if (extra?.reason) detail.push(`reason=${extra.reason}`);
  if (extra?.detail) detail.push(`detail=${extra.detail}`);
  if (Number.isFinite(Number(extra?.delayMs)) && Number(extra.delayMs) > 0) {
    detail.push(`delay=${Math.round(Number(extra.delayMs))}ms`);
  }
  return detail.join(" ");
}

export function getRuntimeRecoveryScope(runtime, guildId) {
  if (typeof runtime?.getNetworkRecoveryScope === "function") {
    return runtime.getNetworkRecoveryScope(guildId);
  }
  return null;
}

export function classifyFfmpegExitDetail(line) {
  const text = String(line || "").trim().toLowerCase();
  if (!text) return null;
  if (text.includes("broken pipe") || text.includes("error writing trailer of pipe:1") || text.includes("error closing file pipe:1")) {
    return "broken-pipe";
  }
  if (text.includes("http error")) return "http-error";
  if (text.includes("timed out") || text.includes("timeout")) return "timeout";
  if (text.includes("connection reset") || text.includes("connection refused")) return "connection-reset";
  if (text.includes("invalid data found when processing input")) return "invalid-input";
  if (isLikelyNetworkFailureLine(text)) return "network-failure";
  return null;
}

export function resolveStreamRestartReason({
  reason,
  earlyIdle = false,
  recentProcessFailure = false,
  recentNetworkFailure = false,
  lastProcessExitDetail = null,
  idleRestartStreak = 0,
} = {}) {
  if (reason === "error") return "audio-player-error";
  if (earlyIdle) return "idle-early";
  if (recentNetworkFailure) return "idle-after-network-failure";
  if (recentProcessFailure && lastProcessExitDetail === "broken-pipe") return "idle-after-broken-pipe";
  if (recentProcessFailure && lastProcessExitDetail) return `idle-after-${lastProcessExitDetail}`;
  if (recentProcessFailure) return "idle-after-ffmpeg-exit";
  if (reason === "idle" && idleRestartStreak > 1) return "provider-eof-repeat";
  if (reason === "idle") return "provider-eof";
  return String(reason || "restart");
}

export function getStreamRestartErrorMessage(err) {
  return String(err?.message || err || "unknown").trim() || "unknown";
}

export function isRecoverableStreamRestartError(err) {
  const code = String(err?.code || "").trim().toUpperCase();
  if (code === "OUTBOUND_REQUEST_FAILED" || code === "OUTBOUND_TIMEOUT") return true;

  const text = getStreamRestartErrorMessage(err).toLowerCase();
  if (isLikelyNetworkFailureLine(text)) return true;
  return /stream konnte nicht geladen werden:\s*(408|425|429|5\d\d)\b|ziel-url konnte nicht erreicht werden\.|ausgehende anfrage hat das zeitlimit/i.test(text);
}

export function isPermanentStreamRestartError(err) {
  const code = String(err?.code || "").trim().toUpperCase();
  if ([
    "OUTBOUND_URL_INVALID",
    "OUTBOUND_URL_TOO_LONG",
    "OUTBOUND_HTTPS_REQUIRED",
    "OUTBOUND_PROTOCOL_NOT_ALLOWED",
    "OUTBOUND_CREDENTIALS_NOT_ALLOWED",
    "OUTBOUND_HOST_INVALID",
    "OUTBOUND_ADDRESS_NOT_ALLOWED",
    "OUTBOUND_HOST_NOT_ALLOWED",
    "OUTBOUND_REDIRECT_NOT_ALLOWED",
    "OUTBOUND_REDIRECT_INVALID",
    "OUTBOUND_BODY_UNSUPPORTED",
  ].includes(code)) {
    return true;
  }

  const match = getStreamRestartErrorMessage(err).match(/stream konnte nicht geladen werden:\s*(\d{3})\b/i);
  if (!match) return false;
  const status = Number(match[1]);
  // 401/403 can be temporary provider-side authorization challenges. A missing
  // or explicitly retired stream, however, cannot recover without a new URL.
  return status === 404 || status === 410;
}

export function recordRuntimeStreamStartFailure(state, reason = "restart-error", stationKey = "") {
  const previousErrorCount = Math.max(0, Number(state?.streamErrorCount || 0) || 0);
  const errorCount = Math.min(10_000, previousErrorCount + 1);
  state.streamErrorCount = errorCount;
  state.lastStreamErrorAt = new Date().toISOString();
  state.lastStreamEndReason = String(reason || "restart-error");
  state.idleRestartStreak = 0;
  state.lastIdleRestartAt = 0;
  recordFailoverFailure(state, stationKey || state.currentStationKey);
  return errorCount;
}

export function getRuntimeStreamStartFailureRetry(runtime, guildId, state) {
  const errorCount = Math.max(1, Number(state?.streamErrorCount || 0) || 0);
  const exponent = Math.min(Math.max(errorCount - 1, 0), 8);
  let delayMs = Math.min(STREAM_RESTART_MAX_MS, STREAM_RESTART_BASE_MS * Math.pow(2, exponent));
  const cooldownActive = errorCount >= STREAM_ERROR_COOLDOWN_THRESHOLD;
  if (cooldownActive) {
    delayMs = Math.max(delayMs, STREAM_ERROR_COOLDOWN_MS);
  }

  const networkCooldownMs = Math.max(0, Number(getRuntimeRecoveryDelayMs(runtime, guildId)) || 0);
  delayMs = Math.max(delayMs, networkCooldownMs);

  return {
    errorCount,
    delayMs,
    cooldownActive,
    networkCooldownMs,
  };
}

export function clearRuntimeStreamHealthTimer(state) {
  if (state?.streamHealthTimer) {
    clearTimeout(state.streamHealthTimer);
    state.streamHealthTimer = null;
  }
}

export function clearRuntimeCurrentProcess(runtime, state) {
  clearRuntimeStreamHealthTimer(state);
  state.lastAudioPacketAt = 0;
  state.streamHealthStartedAt = 0;
  if (state.currentProcess) {
    try {
      state.currentProcess.kill("SIGKILL");
    } catch {
      // process may already be dead
    }
    state.currentProcess = null;
  }
}

export async function evaluateRuntimeStreamHealth(runtime, guildId, state, process, {
  nowMs = Date.now(),
  graceMs = STREAM_HEALTHCHECK_GRACE_MS,
  stallMs = STREAM_HEALTHCHECK_STALL_MS,
  restartDelayMs = STREAM_HEALTHCHECK_RESTART_MS,
} = {}) {
  if (!state || !process || state.currentProcess !== process) {
    return { ok: false, skipped: "process" };
  }
  if (!state.shouldReconnect || !state.currentStationKey || !isRuntimeVoiceConnected(runtime, guildId, state, { includeObserved: true })) {
    return { ok: false, skipped: "inactive" };
  }
  if (state.streamRestartTimer || state.reconnectTimer || state.reconnectInFlight || state.voiceConnectInFlight) {
    return { ok: false, skipped: "recovery" };
  }

  // A paused player stops pulling from ffmpeg, so no audio arrives by design.
  // Paused time must not count as a stall, otherwise /pause would cancel
  // itself after STREAM_HEALTHCHECK_STALL_MS (#189).
  const playerStatus = String(state.player?.state?.status || "").trim().toLowerCase();
  if (playerStatus === String(AudioPlayerStatus.Paused) || playerStatus === String(AudioPlayerStatus.AutoPaused)) {
    state.lastAudioPacketAt = nowMs;
    return { ok: true, skipped: "paused" };
  }

  const startedAt = Number(state.streamHealthStartedAt || state.lastStreamStartAt || 0) || nowMs;
  if ((nowMs - startedAt) < Math.max(0, Number(graceMs) || 0)) {
    return { ok: true, skipped: "grace" };
  }

  const lastPacketAt = Number(state.lastAudioPacketAt || 0) || startedAt;
  const silenceMs = Math.max(0, nowMs - lastPacketAt);
  if (silenceMs < Math.max(1_000, Number(stallMs) || 0)) {
    return { ok: true, silenceMs };
  }

  const reason = "stream-health-stalled";
  const failureAtIso = new Date(nowMs).toISOString();
  const stationName = state.currentStationName || state.currentStationKey;
  const healthError = `No audio data for ${Math.round(silenceMs)}ms`;
  state.ignoreNextIdleEvent = true;
  state.lastStreamErrorAt = failureAtIso;
  state.lastHealthcheckFailureAt = failureAtIso;
  state.lastStreamEndReason = reason;
  state.lastProcessExitDetail = "healthcheck-stall";
  state.lastProcessExitAt = nowMs;
  state.streamErrorCount = (Number(state.streamErrorCount || 0) || 0) + 1;

  noteRuntimeRecoveryFailure(
    runtime,
    guildId,
    `${runtime.config.name} stream-healthcheck`,
    `guild=${guildId} station=${state.currentStationKey || "-"} silenceMs=${Math.round(silenceMs)}`
  );

  log(
    "WARN",
    `[${runtime.config.name}] Stream-Healthcheck ausgelöst guild=${guildId} station=${state.currentStationKey || "-"} gapMs=${Math.round(silenceMs)}`
  );

  try {
    if (typeof process.kill === "function") {
      process.kill("SIGKILL");
    }
  } catch {}
  if (state.currentProcess === process) {
    state.currentProcess = null;
  }
  clearRuntimeStreamHealthTimer(state);

  try {
    await recordRuntimeIncident({
      guildId,
      guildName: runtime?.client?.guilds?.cache?.get?.(guildId)?.name || guildId,
      tier: getTierConfig(guildId).tier,
      eventKey: "stream_healthcheck_stalled",
      severity: "warning",
      runtime: {
        id: String(runtime?.config?.id || "").trim(),
        name: String(runtime?.config?.name || "").trim(),
        role: String(runtime?.role || "").trim(),
      },
      payload: {
        previousStationKey: state.currentStationKey,
        previousStationName: stationName,
        triggerError: healthError,
        streamErrorCount: state.streamErrorCount,
        reconnectAttempts: Number(state.reconnectAttempts || 0) || 0,
        listenerCount: typeof runtime?.getCurrentListenerCount === "function"
          ? runtime.getCurrentListenerCount(guildId, state)
          : 0,
        lastStreamErrorAt: failureAtIso,
      },
    });
  } catch {}

  void dispatchRuntimeIncidentChannelAlert(runtime, {
    guildId,
    guildName: runtime?.client?.guilds?.cache?.get?.(guildId)?.name || guildId,
    tier: getTierConfig(guildId).tier,
    eventKey: "stream_healthcheck_stalled",
    payload: {
      runtime: {
        id: String(runtime?.config?.id || "").trim(),
        name: String(runtime?.config?.name || "").trim(),
        role: String(runtime?.role || "").trim(),
      },
      previousStationKey: state.currentStationKey,
      previousStationName: stationName,
      triggerError: healthError,
      streamErrorCount: state.streamErrorCount,
      reconnectAttempts: Number(state.reconnectAttempts || 0) || 0,
      listenerCount: typeof runtime?.getCurrentListenerCount === "function"
        ? runtime.getCurrentListenerCount(guildId, state)
        : 0,
      lastStreamErrorAt: failureAtIso,
      silenceMs: Math.round(silenceMs),
    },
  }).catch(() => null);

  void dispatchRuntimeReliabilityWebhook({
    guildId,
    guildName: runtime?.client?.guilds?.cache?.get?.(guildId)?.name || guildId,
    tier: getTierConfig(guildId).tier,
    eventKey: "stream_healthcheck_stalled",
    source: "runtime",
    payload: {
      runtime: {
        id: String(runtime?.config?.id || "").trim(),
        name: String(runtime?.config?.name || "").trim(),
        role: String(runtime?.role || "").trim(),
      },
      previousStationKey: state.currentStationKey,
      previousStationName: stationName,
      triggerError: healthError,
      streamErrorCount: state.streamErrorCount,
      reconnectAttempts: Number(state.reconnectAttempts || 0) || 0,
      listenerCount: typeof runtime?.getCurrentListenerCount === "function"
        ? runtime.getCurrentListenerCount(guildId, state)
        : 0,
      lastStreamErrorAt: failureAtIso,
      silenceMs: Math.round(silenceMs),
    },
  }).catch(() => null);

  runtime.scheduleStreamRestart(
    guildId,
    state,
    Math.max(Number(restartDelayMs) || STREAM_HEALTHCHECK_RESTART_MS, getRuntimeRecoveryDelayMs(runtime, guildId)),
    reason
  );
  if (typeof runtime?.persistState === "function") {
    runtime.persistState();
  }

  return {
    ok: false,
    action: "restart",
    reason,
    silenceMs,
  };
}

export function armRuntimeStreamHealthMonitor(runtime, guildId, state, process) {
  clearRuntimeStreamHealthTimer(state);
  if (!STREAM_HEALTHCHECK_ENABLED || !process?.stdout?.on) return;

  state.streamHealthStartedAt = Date.now();
  state.lastAudioPacketAt = Date.now();

  const scheduleNextTick = () => {
    clearRuntimeStreamHealthTimer(state);
    state.streamHealthTimer = setTimeout(() => {
      state.streamHealthTimer = null;
      if (state.currentProcess !== process) return;

      evaluateRuntimeStreamHealth(runtime, guildId, state, process)
        .then((result) => {
          if (result?.action === "restart") return;
          if (state.currentProcess !== process) return;
          scheduleNextTick();
        })
        .catch((err) => {
          log("WARN", `[${runtime.config.name}] Stream-Healthcheck Fehler guild=${guildId}: ${err?.message || err}`);
          if (state.currentProcess === process) {
            scheduleNextTick();
          }
        });
    }, STREAM_HEALTHCHECK_POLL_MS);
    state.streamHealthTimer?.unref?.();
  };

  scheduleNextTick();
}

export function armRuntimeStreamStabilityReset(runtime, guildId, state) {
  runtime.clearStreamStabilityTimer(state);
  state.streamStableTimer = setTimeout(() => {
    state.streamStableTimer = null;
    if (!state.currentStationKey) return;
    state.streamErrorCount = 0;
    state.idleRestartStreak = 0;
    state.lastIdleRestartAt = 0;
    state.lastProcessExitCode = null;
    state.lastProcessExitDetail = null;
    state.lastProcessExitAt = 0;
    state.lastNetworkFailureAt = 0;
    clearFailoverFailureWindow(state);
    noteRuntimeRecoverySuccess(runtime, guildId, `${runtime.config.name} stable-stream guild=${guildId}`);
  }, STREAM_STABLE_RESET_MS);
}

// Split into topic modules (#295); the public API stays here.
export {
  armRuntimePlaybackRecovery,
  handleRuntimeStreamEnd,
  scheduleRuntimeStreamRestart,
  trackRuntimeProcessLifecycle,
} from "./runtime-stream-lifecycle.js";
export { playRuntimeStation, restartRuntimeCurrentStation } from "./runtime-stream-play.js";
