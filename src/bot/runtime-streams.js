import { log } from "../lib/logging.js";
import {
  clipText,
  applyJitter,
  isLikelyNetworkFailureLine,
  STREAM_STABLE_RESET_MS,
  STREAM_RESTART_BASE_MS,
  STREAM_RESTART_MAX_MS,
  STREAM_PROCESS_FAILURE_WINDOW_MS,
  STREAM_ERROR_COOLDOWN_THRESHOLD,
  STREAM_ERROR_COOLDOWN_MS,
} from "../lib/helpers.js";
import { networkRecoveryCoordinator } from "../core/network-recovery.js";
import { createResource } from "../services/stream.js";
import { fetchStreamInfo } from "../services/now-playing.js";
import { getServerPlanConfig } from "../core/entitlements.js";
import { normalizeFailoverChain, buildFailoverCandidateChain } from "../lib/failover-chain.js";
import {
  clearActiveFailover,
  clearFailoverFailureWindow,
  evaluateFailoverEligibility,
  recordFailoverFailure,
} from "../lib/stream-failover-policy.js";
import { recordStationStart } from "../listening-stats-store.js";
import { dispatchRuntimeReliabilityWebhook } from "../lib/runtime-alerts.js";
import { dispatchRuntimeIncidentAlert } from "../lib/runtime-discord-alerts.js";
import { recordRuntimeIncident } from "../runtime-incidents-store.js";
import { isRuntimeVoiceConnected } from "./runtime-live-state.js";

function toPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? fallbackValue), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

const IDLE_RESTART_WINDOW_MS = toPositiveInt(process.env.STREAM_IDLE_RESTART_WINDOW_MS, 15 * 60_000);
const IDLE_RESTART_EXP_STEPS = toPositiveInt(process.env.STREAM_IDLE_RESTART_EXP_STEPS, 6);
const STREAM_HEALTHCHECK_ENABLED = String(process.env.STREAM_HEALTHCHECK_ENABLED ?? "1") !== "0";
const STREAM_HEALTHCHECK_POLL_MS = Math.max(5_000, toPositiveInt(process.env.STREAM_HEALTHCHECK_POLL_MS, 15_000));
const STREAM_HEALTHCHECK_GRACE_MS = Math.max(10_000, toPositiveInt(process.env.STREAM_HEALTHCHECK_GRACE_MS, 30_000));
const STREAM_HEALTHCHECK_STALL_MS = Math.max(
  STREAM_HEALTHCHECK_POLL_MS * 2,
  toPositiveInt(process.env.STREAM_HEALTHCHECK_STALL_MS, 45_000)
);
const STREAM_HEALTHCHECK_RESTART_MS = Math.max(750, toPositiveInt(process.env.STREAM_HEALTHCHECK_RESTART_MS, 1_250));
const STREAM_RESTART_RESCHEDULE_SLACK_MS = 1_000;

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

function shouldEmitRecoveredAlert({ errorCount = 0, reconnectAttempts = 0, reason = "" } = {}) {
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

async function emitRuntimeReliabilityAlert(runtime, guildId, eventKey, payload = {}) {
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

function getRuntimeStreamSnapshot(runtime, guildId, state = null, extra = {}) {
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

function getRuntimeRecoveryScope(runtime, guildId) {
  if (typeof runtime?.getNetworkRecoveryScope === "function") {
    return runtime.getNetworkRecoveryScope(guildId);
  }
  return null;
}

function classifyFfmpegExitDetail(line) {
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

function resolveStreamRestartReason({
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

function getStreamRestartErrorMessage(err) {
  return String(err?.message || err || "unknown").trim() || "unknown";
}

function isRecoverableStreamRestartError(err) {
  const code = String(err?.code || "").trim().toUpperCase();
  if (code === "OUTBOUND_REQUEST_FAILED" || code === "OUTBOUND_TIMEOUT") return true;

  const text = getStreamRestartErrorMessage(err).toLowerCase();
  if (isLikelyNetworkFailureLine(text)) return true;
  return /stream konnte nicht geladen werden:\s*(408|425|429|5\d\d)\b|ziel-url konnte nicht erreicht werden\.|ausgehende anfrage hat das zeitlimit/i.test(text);
}

function isPermanentStreamRestartError(err) {
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

function recordRuntimeStreamStartFailure(state, reason = "restart-error", stationKey = "") {
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

function getRuntimeStreamStartFailureRetry(runtime, guildId, state) {
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

function clearRuntimeStreamHealthTimer(state) {
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

function armRuntimeStreamHealthMonitor(runtime, guildId, state, process) {
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

export function trackRuntimeProcessLifecycle(runtime, guildId, state, process) {
  if (!process) return;
  let stderrBuffer = "";
  armRuntimeStreamHealthMonitor(runtime, guildId, state, process);

  if (process.stderr?.on) {
    process.stderr.on("data", (chunk) => {
      stderrBuffer += chunk.toString();
      const lines = stderrBuffer.split("\n");
      stderrBuffer = lines.pop() || "";
      for (const line of lines) {
        const trimmed = line.trim();
        const exitDetail = classifyFfmpegExitDetail(trimmed);
        if (exitDetail) {
          state.lastProcessExitDetail = exitDetail;
        }
        if (!isLikelyNetworkFailureLine(trimmed)) continue;
        state.lastNetworkFailureAt = Date.now();
      }
    });
  }

  if (process.stdout?.on) {
    process.stdout.on("data", (chunk) => {
      if (state.currentProcess !== process) return;
      if (chunk?.length > 0) {
        state.lastAudioPacketAt = Date.now();
      }
    });
  }

  process.on("close", (code) => {
    clearRuntimeStreamHealthTimer(state);
    if (state.currentProcess === process) {
      state.currentProcess = null;
    }
    state.lastProcessExitAt = Date.now();
    state.lastProcessExitCode = Number.isFinite(code) ? Number(code) : null;
    if (code && code !== 0) {
      state.lastStreamErrorAt = new Date().toISOString();
      const detail = state.lastProcessExitDetail ? ` detail=${state.lastProcessExitDetail}` : "";
      log("INFO", `[${runtime.config.name}] ffmpeg exited with code ${code} (guild=${guildId}${detail})`);
    }
  });
  process.on("error", (err) => {
    log("ERROR", `[${runtime.config.name}] ffmpeg process error: ${err?.message || err}`);
    state.lastStreamErrorAt = new Date().toISOString();
    clearRuntimeStreamHealthTimer(state);
    if (state.currentProcess === process) {
      state.currentProcess = null;
    }
  });
}

export function scheduleRuntimeStreamRestart(runtime, guildId, state, delayMs, reason = "restart") {
  const delay = applyJitter(Math.max(250, Number(delayMs) || 0), 0.15);
  const scheduledForAt = Date.now() + delay;
  const pendingScheduledAt = Number(state?.streamRestartScheduledAt || 0) || 0;
  const hasPendingTimer = Boolean(state?.streamRestartTimer && pendingScheduledAt > Date.now());
  if (hasPendingTimer && pendingScheduledAt <= (scheduledForAt + STREAM_RESTART_RESCHEDULE_SLACK_MS)) {
    log(
      "INFO",
      `[${runtime.config.name}] Stream-Restart beibehalten ${getRuntimeStreamSnapshot(runtime, guildId, state, {
        reason: `${String(reason || "restart")}:deduped`,
        delayMs: Math.max(0, pendingScheduledAt - Date.now()),
      })}`
    );
    return;
  }

  if (state.streamRestartTimer) {
    clearTimeout(state.streamRestartTimer);
  }

  state.streamRestartScheduledAt = scheduledForAt;
  state.streamRestartScheduledReason = String(reason || "restart");
  state.streamRestartScheduledDelayMs = delay;
  log("INFO", `[${runtime.config.name}] Stream-Restart geplant ${getRuntimeStreamSnapshot(runtime, guildId, state, { reason, delayMs: delay })}`);
  state.streamRestartTimer = setTimeout(() => {
    state.streamRestartTimer = null;
    state.streamRestartScheduledAt = 0;
    state.streamRestartScheduledReason = null;
    state.streamRestartScheduledDelayMs = 0;
    runtime.restartCurrentStation(state, guildId).catch((err) => {
      log("ERROR", `[${runtime.config.name}] Stream restart failed (${reason}): ${err?.message || err}`);
    });
  }, delay);
}

export async function handleRuntimeStreamEnd(runtime, guildId, state, reason) {
  if (!state.shouldReconnect || !state.currentStationKey) return;
  if (state.streamRestartInFlight) return;
  if (!isRuntimeVoiceConnected(runtime, guildId, state, { includeObserved: true })) return;

  const now = Date.now();
  if (runtime.isScheduledEventStopDue(state.activeScheduledEventStopAtMs, now)) {
    log(
      "INFO",
      `[${runtime.config.name}] Geplantes Event-Ende erreicht, Stream wird gestoppt (guild=${guildId}, event=${state.activeScheduledEventId || "-"})`
    );
    await runtime.stopInGuild(guildId);
    return;
  }
  const streamLifetimeMs = state.lastStreamStartAt ? (now - state.lastStreamStartAt) : 0;
  const earlyIdle = reason === "idle" && streamLifetimeMs > 0 && streamLifetimeMs < 5000;
  const recentProcessFailure = (state.lastProcessExitCode ?? 0) !== 0
    && state.lastProcessExitAt > 0
    && (now - state.lastProcessExitAt) <= STREAM_PROCESS_FAILURE_WINDOW_MS;
  const recentNetworkFailure = state.lastNetworkFailureAt > 0
    && (now - state.lastNetworkFailureAt) <= Math.max(60_000, STREAM_RESTART_MAX_MS);
  const treatAsError = reason === "error" || earlyIdle || recentProcessFailure;

  if (reason === "idle" && !earlyIdle) {
    const withinIdleWindow = state.lastIdleRestartAt > 0
      && (now - state.lastIdleRestartAt) <= IDLE_RESTART_WINDOW_MS;
    state.idleRestartStreak = withinIdleWindow ? (state.idleRestartStreak || 0) + 1 : 1;
    state.lastIdleRestartAt = now;
  } else {
    state.idleRestartStreak = 0;
    state.lastIdleRestartAt = 0;
  }

  if (treatAsError) {
    state.streamErrorCount = (state.streamErrorCount || 0) + 1;
  } else {
    state.streamErrorCount = 0;
  }

  const errorCount = state.streamErrorCount || 0;
  const idleRestartStreak = state.idleRestartStreak || 0;
  const tierConfig = getTierConfig(guildId);
  let delay = Math.max(1_000, tierConfig.reconnectMs);

  if (treatAsError) {
    const exp = Math.min(Math.max(errorCount - 1, 0), 8);
    delay = Math.min(STREAM_RESTART_MAX_MS, STREAM_RESTART_BASE_MS * Math.pow(2, exp));
  } else {
    delay = Math.max(delay, STREAM_RESTART_BASE_MS);
  }

  if (!treatAsError && reason === "idle" && idleRestartStreak > 1) {
    const idleExp = Math.min(idleRestartStreak - 1, IDLE_RESTART_EXP_STEPS);
    const idlePenalty = Math.min(
      STREAM_RESTART_MAX_MS,
      Math.max(delay, STREAM_RESTART_BASE_MS) * Math.pow(1.8, idleExp)
    );
    delay = Math.max(delay, idlePenalty);
  }

  if (recentNetworkFailure) {
    const penalty = Math.min(STREAM_RESTART_MAX_MS, STREAM_RESTART_BASE_MS * Math.pow(2, Math.min(errorCount + 1, 8)));
    delay = Math.max(delay, penalty);
  }

  if (errorCount >= STREAM_ERROR_COOLDOWN_THRESHOLD) {
    delay = Math.max(delay, STREAM_ERROR_COOLDOWN_MS);
    log(
      "INFO",
      `[${runtime.config.name}] Viele Stream-Fehler (${errorCount}) guild=${guildId}, Cooldown ${STREAM_ERROR_COOLDOWN_MS}ms`
    );
  }

  const networkCooldownMs = getRuntimeRecoveryDelayMs(runtime, guildId);
  if (networkCooldownMs > 0) {
    delay = Math.max(delay, networkCooldownMs);
  }

  const reasonLabel = resolveStreamRestartReason({
    reason,
    earlyIdle,
    recentProcessFailure,
    recentNetworkFailure,
    lastProcessExitDetail: state.lastProcessExitDetail,
    idleRestartStreak,
  });
  state.lastStreamEndReason = reasonLabel;
  log(
    "INFO",
    `[${runtime.config.name}] Stream ${reasonLabel} guild=${guildId} lifetimeMs=${streamLifetimeMs} idleStreak=${idleRestartStreak} errors=${errorCount} ffmpegExit=${state.lastProcessExitCode ?? "-"} ffmpegDetail=${state.lastProcessExitDetail || "-"}, restart in ${Math.round(delay)}ms`
  );

  runtime.scheduleStreamRestart(guildId, state, delay, reasonLabel);
}

export function armRuntimePlaybackRecovery(
  runtime,
  guildId,
  state,
  stations,
  key,
  err,
  { reason = "play-start-failed" } = {}
) {
  const stationName = stations?.stations?.[key]?.name || state.currentStationName || key;
  const errorMessage = err?.message || String(err || "unknown");
  const recoverableStartError = isRecoverableStreamRestartError(err);
  const permanentStartError = isPermanentStreamRestartError(err);

  const desiredChanged = String(state.desiredStationKey || "").trim().toLowerCase()
    !== String(key || "").trim().toLowerCase();
  if (desiredChanged) {
    clearActiveFailover(state);
    clearFailoverFailureWindow(state);
  }
  state.desiredStationKey = key;
  state.desiredStationName = stationName;
  const errorCount = recordRuntimeStreamStartFailure(state, reason, key);
  state.shouldReconnect = true;
  state.currentStationKey = key;
  state.currentStationName = stationName;
  state.currentMeta = null;
  state.nowPlayingSignature = null;
  runtime.clearCurrentProcess(state);
  runtime.clearNowPlayingTimer(state);
  runtime.updatePresence();
  runtime.persistState();

  if (recoverableStartError) {
    noteRuntimeRecoveryFailure(
      runtime,
      guildId,
      `${runtime.config.name} initial-stream-start`,
      `guild=${guildId} station=${key}: ${errorMessage}`
    );
  }

  if (permanentStartError) {
    state.shouldReconnect = false;
    log(
      "ERROR",
      `[${runtime.config.name}] Permanenter Stream-Startfehler fuer ${key}; automatische Wiederherstellung wird beendet: ${errorMessage}`
    );
    runtime.persistState();
    return {
      scheduled: false,
      delayMs: 0,
      message: errorMessage,
      stationName,
      permanent: true,
    };
  }

  const retry = getRuntimeStreamStartFailureRetry(runtime, guildId, state);
  const delay = retry.delayMs;

  if (isRuntimeVoiceConnected(runtime, guildId, state, { includeObserved: true })) {
    log(
      "WARN",
      `[${runtime.config.name}] Stream-Start fehlgeschlagen: ${errorMessage}. ` +
      `${getRuntimeStreamSnapshot(runtime, guildId, state, {
        reason,
        delayMs: delay,
        detail: `errorStreak=${errorCount}${retry.cooldownActive ? ":cooldown" : ""}`,
      })}`
    );
    runtime.scheduleStreamRestart(guildId, state, delay, reason);
    return { scheduled: true, delayMs: delay, message: errorMessage, stationName };
  }

  if (state.lastChannelId) {
    log(
      "WARN",
      `[${runtime.config.name}] Stream-Start fehlgeschlagen ohne lokale Voice-Verbindung: ${errorMessage}. ` +
      `${getRuntimeStreamSnapshot(runtime, guildId, state, { reason, delayMs: delay })}`
    );
    runtime.scheduleReconnect(guildId, { resetAttempts: true, reason });
    return { scheduled: true, delayMs: delay, message: errorMessage, stationName };
  }

  return { scheduled: false, delayMs: 0, message: errorMessage, stationName };
}

export async function playRuntimeStation(runtime, state, stations, key, guildId, options = {}) {
  const station = stations.stations[key];
  if (!station) throw new Error("Station nicht gefunden.");

  runtime.clearCurrentProcess(state);

  let bitrateOverride = null;
  if (guildId) {
    const tierConfig = getTierConfig(guildId);
    bitrateOverride = tierConfig.bitrate;
  }

  const { resource, process } = await createResource(
    station.url,
    state.volume,
    stations.qualityPreset,
    runtime.config.name,
    bitrateOverride,
    getRuntimeRecoveryScope(runtime, guildId)
  );

  state.currentProcess = process;
  runtime.trackProcessLifecycle(guildId, state, process);

  state.player.play(resource);
  state.currentStationKey = key;
  state.currentStationName = station.name || key;
  if (options?.preserveDesiredStation !== true || !state.desiredStationKey) {
    state.desiredStationKey = key;
    state.desiredStationName = station.name || key;
    clearActiveFailover(state);
  }
  state.currentMeta = null;
  state.nowPlayingSignature = null;
  state.lastStreamEndReason = null;
  state.lastStreamStartAt = Date.now();
  state.lastProcessExitDetail = null;
  state.lastProcessExitCode = null;
  state.lastProcessExitAt = 0;
  state.lastHealthcheckFailureAt = null;
  state.streamHealthStartedAt = state.lastStreamStartAt;
  state.lastAudioPacketAt = state.lastStreamStartAt;
  state.ignoreNextIdleEvent = false;
  runtime.armStreamStabilityReset(guildId, state);
  runtime.updatePresence();
  runtime.persistState();
  runtime.startNowPlayingLoop(guildId, state);
  runtime.syncVoiceChannelStatus(guildId, state.currentStationName || station.name || key).catch(() => null);
  recordStationStart(guildId, {
    stationKey: key,
    stationName: state.currentStationName || station.name || key,
    channelId: state.connection?.joinConfig?.channelId || state.lastChannelId || "",
    listenerCount: runtime.getCurrentListenerCount(guildId, state),
    timestampMs: state.lastStreamStartAt,
    botId: runtime.config.id || "",
    countAsStart: options?.countAsStart !== false,
    resumeSession: options?.resumeSession === true,
  });

  fetchStreamInfo(station.url)
    .then((meta) => {
      if (state.currentStationKey === key) {
        const prevMeta = state.currentMeta || {};
        const artist = runtime.normalizeNowPlayingValue(meta.artist, station, meta, 120);
        const title = runtime.normalizeNowPlayingValue(meta.title, station, meta, 120);
        const streamTitle = runtime.normalizeNowPlayingValue(meta.streamTitle, station, meta, 180);
        const displayTitle = runtime.normalizeNowPlayingValue(meta.displayTitle || meta.streamTitle, station, meta, 180)
          || ([artist, title].filter(Boolean).join(" - ") || null);
        const hasTrack = Boolean(displayTitle || artist || title);
        state.currentMeta = {
          ...prevMeta,
          name: runtime.normalizeNowPlayingValue(meta.name, station, meta, 120) || prevMeta.name || station.name || key,
          description: runtime.normalizeNowPlayingValue(meta.description, station, meta, 240) || prevMeta.description || null,
          streamTitle: streamTitle || prevMeta.streamTitle || null,
          artist: artist || prevMeta.artist || null,
          title: title || prevMeta.title || null,
          displayTitle: displayTitle || prevMeta.displayTitle || null,
          album: runtime.normalizeNowPlayingValue(meta.album, station, meta, 120) || prevMeta.album || null,
          artworkUrl: meta.artworkUrl || prevMeta.artworkUrl || null,
          metadataSource: meta.metadataSource || prevMeta.metadataSource || null,
          metadataStatus: hasTrack ? (meta.metadataStatus || "ok") : (meta.metadataStatus || prevMeta.metadataStatus || "empty"),
          recognitionProvider: meta.recognitionProvider || prevMeta.recognitionProvider || null,
          recognitionConfidence: Number.isFinite(Number(meta.recognitionConfidence))
            ? Number(meta.recognitionConfidence)
            : (Number.isFinite(Number(prevMeta.recognitionConfidence)) ? Number(prevMeta.recognitionConfidence) : null),
          musicBrainzRecordingId: meta.musicBrainzRecordingId || prevMeta.musicBrainzRecordingId || null,
          musicBrainzReleaseId: meta.musicBrainzReleaseId || prevMeta.musicBrainzReleaseId || null,
          updatedAt: new Date().toISOString(),
          trackDetectedAtMs: hasTrack ? Date.now() : (Number.parseInt(String(prevMeta.trackDetectedAtMs || 0), 10) || 0),
        };
        runtime.recordSongHistory(guildId, state, station, state.currentMeta);
      }
    })
    .catch(() => {
      // ignore metadata lookup errors
    });
}

async function restartRuntimeCurrentStationAttempt(runtime, state, guildId) {
  if (!state.shouldReconnect || !state.currentStationKey) return;
  if (runtime.isScheduledEventStopDue(state.activeScheduledEventStopAtMs)) {
    await runtime.stopInGuild(guildId);
    return;
  }

  const resolvedStation = runtime.getResolvedCurrentStation(guildId, state);
  const key = state.currentStationKey;
  const previousErrorCount = Number(state.streamErrorCount || 0) || 0;
  const previousReconnectAttempts = Number(state.reconnectAttempts || 0) || 0;
  const previousRestartReason = String(state.lastStreamEndReason || "").trim().toLowerCase();
  const previousLastStreamErrorAt = state.lastStreamErrorAt || null;
  if (!resolvedStation?.stations || !resolvedStation?.station) {
    runtime.clearNowPlayingTimer(state);
    state.currentStationKey = null;
    state.currentStationName = null;
    state.currentMeta = null;
    state.nowPlayingSignature = null;
    runtime.clearScheduledEventPlayback(state);
    runtime.updatePresence();
    runtime.persistState();
    return;
  }

  // NetworkRecovery exposes a penalty duration, not an absolute cooldown-until
  // timestamp. The failed-start retry plan incorporates that penalty below. Do
  // not defer here: a deferred retry would never perform a request that can
  // produce the success signal needed to clear the recovery scope.

  try {
    runtime.clearCurrentProcess(state);
    state.currentStationKey = resolvedStation.key;
    state.currentStationName = resolvedStation.station.name || resolvedStation.key;
    log("INFO", `[${runtime.config.name}] Stream-Restart startet ${getRuntimeStreamSnapshot(runtime, guildId, state, {
      reason: previousRestartReason || "restart",
    })}`);
    await runtime.playStation(state, resolvedStation.stations, resolvedStation.key, guildId, {
      countAsStart: false,
      resumeSession: true,
      preserveDesiredStation: state.failoverActive === true,
    });
    log("INFO", `[${runtime.config.name}] Stream restarted: ${resolvedStation.key}`);
    if (shouldEmitRecoveredAlert({
      errorCount: previousErrorCount,
      reconnectAttempts: previousReconnectAttempts,
      reason: previousRestartReason,
    })) {
      void emitRuntimeReliabilityAlert(runtime, guildId, "stream_recovered", {
        recoveredStationKey: resolvedStation.key,
        recoveredStationName: resolvedStation.station.name || resolvedStation.key,
        previousStationKey: key,
        restartReason: previousRestartReason || "restart",
        streamErrorCount: previousErrorCount,
        reconnectAttempts: previousReconnectAttempts,
        lastStreamErrorAt: previousLastStreamErrorAt,
        listenerCount: runtime.getCurrentListenerCount(guildId, state),
      }).catch(() => null);
    }
  } catch (err) {
    const errorMessage = getStreamRestartErrorMessage(err);
    const recoverableRestartError = isRecoverableStreamRestartError(err);
    const errorCount = recordRuntimeStreamStartFailure(state, "restart-error", resolvedStation.key);
    if (recoverableRestartError) {
      noteRuntimeRecoveryFailure(runtime, guildId, `${runtime.config.name} auto-restart`, `guild=${guildId} station=${key}: ${errorMessage}`);
    }
    log(recoverableRestartError ? "WARN" : "ERROR", `[${runtime.config.name}] Auto-restart error for ${key}: ${errorMessage}`);

    let configuredFailoverChain = [];
    let legacyFallbackStation = "";
    try {
      let settings = null;
      if (typeof runtime?.loadGuildSettingsCached === "function") {
        settings = await runtime.loadGuildSettingsCached(guildId);
      } else {
        const { getDb: getDatabase, isConnected: isDbConn } = await import("../lib/db.js");
        if (isDbConn() && getDatabase()) {
          settings = await getDatabase().collection("guild_settings").findOne(
            { guildId },
            { projection: { failoverChain: 1, fallbackStation: 1 } }
          );
        }
      }
      configuredFailoverChain = normalizeFailoverChain(settings?.failoverChain || []);
      legacyFallbackStation = String(settings?.fallbackStation || "").trim().toLowerCase();
    } catch {}

    const fallbackCandidates = buildFailoverCandidateChain({
      currentStationKey: resolvedStation.key,
      configuredChain: configuredFailoverChain,
      fallbackStation: legacyFallbackStation,
    });
    const failoverDecision = evaluateFailoverEligibility(state, {
      stationKey: resolvedStation.key,
      candidateCount: fallbackCandidates.length,
    });

    if (fallbackCandidates.length > 0 && !failoverDecision.eligible) {
      log(
        "INFO",
        `[${runtime.config.name}] Failover fuer ${resolvedStation.key} bleibt gesperrt ` +
        `(Grund=${failoverDecision.reason}, Fehler=${failoverDecision.failureCount}/${failoverDecision.requiredFailures}, ` +
        `instabil=${Math.round(failoverDecision.unstableForMs / 1000)}s/${Math.round(failoverDecision.requiredUnstableMs / 1000)}s).`
      );
    }

    for (const fallbackCandidate of failoverDecision.eligible ? fallbackCandidates : []) {
      const fallbackStation = runtime.resolveStationForGuild(guildId, fallbackCandidate);
      if (!fallbackStation?.ok || !fallbackStation?.stations || !fallbackStation?.station) {
        log("WARN", `[${runtime.config.name}] Skip unavailable failover candidate ${fallbackCandidate}`);
        continue;
      }

      try {
        if (!state.desiredStationKey) {
          state.desiredStationKey = resolvedStation.key;
          state.desiredStationName = resolvedStation.station.name || resolvedStation.key;
        }
        await runtime.playStation(state, fallbackStation.stations, fallbackStation.key, guildId, {
          countAsStart: false,
          resumeSession: false,
          preserveDesiredStation: true,
        });
        state.failoverActive = true;
        state.failoverStartedAt = Date.now();
        state.failoverReason = errorMessage;
        state.failoverFromStationKey = resolvedStation.key;
        state.failoverFromStationName = resolvedStation.station.name || resolvedStation.key;
        clearFailoverFailureWindow(state);
        runtime.persistState?.();
        log("INFO", `[${runtime.config.name}] Failover to ${fallbackStation.key} after restart failure`);
        void emitRuntimeReliabilityAlert(runtime, guildId, "stream_failover_activated", {
          previousStationKey: resolvedStation.key,
          previousStationName: resolvedStation.station.name || resolvedStation.key,
          failoverStationKey: fallbackStation.key,
          failoverStationName: fallbackStation.station.name || fallbackStation.key,
          attemptedCandidates: fallbackCandidates,
          triggerError: errorMessage,
          recoverableRestartError,
          streamErrorCount: errorCount,
          listenerCount: runtime.getCurrentListenerCount(guildId, state),
        }).catch(() => null);
        return;
      } catch (fallbackErr) {
        const fallbackMessage = getStreamRestartErrorMessage(fallbackErr);
        const recoverableFallbackError = isRecoverableStreamRestartError(fallbackErr);
        if (recoverableFallbackError) {
          noteRuntimeRecoveryFailure(
            runtime,
            guildId,
            `${runtime.config.name} failover-restart`,
            `guild=${guildId} station=${fallbackCandidate}: ${fallbackMessage}`
          );
        }
        log(
          recoverableFallbackError ? "WARN" : "ERROR",
          `[${runtime.config.name}] Failover candidate ${fallbackCandidate} failed: ${fallbackMessage}`
        );
      }
    }

    if (failoverDecision.eligible && fallbackCandidates.length > 0) {
      log(recoverableRestartError ? "WARN" : "ERROR", `[${runtime.config.name}] Exhausted failover chain after restart failure`);
      void emitRuntimeReliabilityAlert(runtime, guildId, "stream_failover_exhausted", {
        previousStationKey: resolvedStation.key,
        previousStationName: resolvedStation.station.name || resolvedStation.key,
        attemptedCandidates: fallbackCandidates,
        triggerError: errorMessage,
        recoverableRestartError,
        streamErrorCount: errorCount,
        lastStreamErrorAt: previousLastStreamErrorAt,
      }).catch(() => null);
    }

    if (isPermanentStreamRestartError(err) && fallbackCandidates.length === 0) {
      log(
        "ERROR",
        `[${runtime.config.name}] Permanenter Stream-Restartfehler fuer ${resolvedStation.key}; Wiedergabe wird beendet: ${errorMessage}`
      );
      if (typeof runtime.stopInGuild === "function") {
        try {
          await runtime.stopInGuild(guildId);
          return;
        } catch (stopErr) {
          log("WARN", `[${runtime.config.name}] Wiedergabe nach permanentem Streamfehler konnte nicht sauber beendet werden: ${getStreamRestartErrorMessage(stopErr)}`);
        }
      }
      state.shouldReconnect = false;
      state.currentStationKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      runtime.clearNowPlayingTimer?.(state);
      runtime.clearScheduledEventPlayback?.(state);
      runtime.updatePresence?.();
      runtime.persistState?.();
      return;
    }

    const retry = getRuntimeStreamStartFailureRetry(runtime, guildId, state);
    const retryDelay = retry.delayMs;
    if (isRuntimeVoiceConnected(runtime, guildId, state, { includeObserved: true })) {
      log(
        "INFO",
        `[${runtime.config.name}] Stream-Retry nach Restart-Fehler fuer ${resolvedStation.key} in ${Math.round(retryDelay)}ms ` +
        `(Fehlerreihe ${retry.errorCount}${retry.cooldownActive ? ", Cooldown aktiv" : ""})`
      );
      runtime.scheduleStreamRestart(guildId, state, retryDelay, "restart-error");
      runtime.persistState?.();
      return;
    }

    if (state.lastChannelId) {
      log(
        "INFO",
        `[${runtime.config.name}] Voice-Reconnect nach Restart-Fehler fuer guild=${guildId} wird geplant.`
      );
      runtime.scheduleReconnect?.(guildId, {
        resetAttempts: recoverableRestartError,
        reason: "restart-error",
      });
    }
    runtime.persistState?.();
  }
}

export async function restartRuntimeCurrentStation(runtime, state, guildId) {
  if (!state?.shouldReconnect || !state.currentStationKey) return;
  if (state.streamRestartInFlight) {
    log("INFO", `[${runtime.config.name}] Stream-Restart bereits aktiv ${getRuntimeStreamSnapshot(runtime, guildId, state, { reason: "restart-in-flight" })}`);
    return;
  }

  state.streamRestartInFlight = true;
  try {
    return await restartRuntimeCurrentStationAttempt(runtime, state, guildId);
  } finally {
    state.streamRestartInFlight = false;
  }
}
