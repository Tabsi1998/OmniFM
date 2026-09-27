// OmniFM: the ffmpeg process lifecycle, stream end and playback recovery.
// Split out of src/bot/runtime-streams.js (#295).
import { log } from "../lib/logging.js";
import {
  applyJitter,
  isLikelyNetworkFailureLine,
  STREAM_RESTART_BASE_MS,
  STREAM_RESTART_MAX_MS,
  STREAM_PROCESS_FAILURE_WINDOW_MS,
  STREAM_ERROR_COOLDOWN_THRESHOLD,
  STREAM_ERROR_COOLDOWN_MS,
} from "../lib/helpers.js";
import {
  STREAM_FAILOVER_STABLE_AUDIO_MS,
  clearActiveFailover,
  clearFailoverFailureWindow,
} from "../lib/stream-failover-policy.js";
import { isRuntimeVoiceConnected } from "./runtime-live-state.js";
import { recordPlaybackPhase } from "./playback-phase.js";
import {
  IDLE_RESTART_EXP_STEPS,
  IDLE_RESTART_WINDOW_MS,
  STREAM_RESTART_RESCHEDULE_SLACK_MS,
  armRuntimeStreamHealthMonitor,
  classifyFfmpegExitDetail,
  clearRuntimeStreamHealthTimer,
  getRuntimeRecoveryDelayMs,
  getRuntimeStreamSnapshot,
  getRuntimeStreamStartFailureRetry,
  getTierConfig,
  isPermanentStreamRestartError,
  isRecoverableStreamRestartError,
  noteRuntimeRecoveryFailure,
  recordRuntimeStreamStartFailure,
  resolveStreamRestartReason,
} from "./runtime-streams.js";

export function trackRuntimeProcessLifecycle(runtime, guildId, state, process) {
  if (!process) return;
  // Every stream start bumps state.streamGeneration. A process that belongs to
  // an older generation was replaced by a newer stream; its late stderr, exit
  // and error events must not touch the bookkeeping of the current stream.
  const generation = Number(state.streamGeneration || 0) || 0;
  const isCurrentGeneration = () => (Number(state.streamGeneration || 0) || 0) === generation;
  let stderrBuffer = "";
  armRuntimeStreamHealthMonitor(runtime, guildId, state, process);

  if (process.stderr?.on) {
    process.stderr.on("data", (chunk) => {
      if (!isCurrentGeneration()) return;
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
      if (!(chunk?.length > 0)) return;
      const nowMs = Date.now();
      state.lastAudioPacketAt = nowMs;
      // Survives clearCurrentProcess: the failover decision needs to know when
      // the station last delivered audio, not when the health clock was reset.
      state.lastAudioHeardAt = nowMs;
      const startedAt = Number(state.lastStreamStartAt || 0) || 0;
      if (
        state.failoverWindowClearedForStream !== true
        && startedAt > 0
        && (nowMs - startedAt) >= STREAM_FAILOVER_STABLE_AUDIO_MS
      ) {
        // The station played long enough in one piece: earlier failures were
        // hiccups, not an outage, so the failover window starts from zero (#192).
        state.failoverWindowClearedForStream = true;
        clearFailoverFailureWindow(state);
      }
    });
  }

  process.on("close", (code) => {
    if (state.currentProcess === process) {
      clearRuntimeStreamHealthTimer(state);
      state.currentProcess = null;
    }
    if (!isCurrentGeneration()) return;
    state.lastProcessExitAt = Date.now();
    state.lastProcessExitCode = Number.isFinite(code) ? Number(code) : null;
    if (code && code !== 0) {
      state.lastStreamErrorAt = new Date().toISOString();
      const detail = state.lastProcessExitDetail ? ` detail=${state.lastProcessExitDetail}` : "";
      log("INFO", `[${runtime.config.name}] ffmpeg exited with code ${code} (guild=${guildId}${detail})`);
    }
  });
  process.on("error", (err) => {
    if (state.currentProcess === process) {
      clearRuntimeStreamHealthTimer(state);
      state.currentProcess = null;
    }
    if (!isCurrentGeneration()) return;
    log("ERROR", `[${runtime.config.name}] ffmpeg process error: ${err?.message || err}`);
    state.lastStreamErrorAt = new Date().toISOString();
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
  recordPlaybackPhase(runtime, guildId, state, `restart:${String(reason || "restart")}`);
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
