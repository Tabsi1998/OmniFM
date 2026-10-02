// OmniFM: playing a station and restarting the current one.
// Split out of src/bot/runtime-streams.js (#295).
import { log } from "../lib/logging.js";
import { createResource } from "../services/stream.js";
import { fetchStreamInfo } from "../services/now-playing.js";
import { normalizeFailoverChain, buildFailoverCandidateChain } from "../lib/failover-chain.js";
import {
  clearActiveFailover,
  clearFailoverFailureWindow,
  evaluateFailoverEligibility,
} from "../lib/stream-failover-policy.js";
import { recordStationStart } from "../listening-stats-store.js";
import { isRuntimeVoiceConnected } from "./runtime-live-state.js";
import {
  armRuntimeFailbackProbe,
  clearRuntimeFailbackTimer,
  handleRuntimeStationUnavailable,
} from "./runtime-failback.js";
import { recordPlaybackPhase } from "./playback-phase.js";
import { alertFailoverExhausted } from "../services/operator-alerts.js";
import {
  clearRuntimeStreamHealthTimer,
  emitRuntimeReliabilityAlert,
  getRuntimeRecoveryScope,
  getRuntimeStreamSnapshot,
  getRuntimeStreamStartFailureRetry,
  getStreamRestartErrorMessage,
  getTierConfig,
  isPermanentStreamRestartError,
  isRecoverableStreamRestartError,
  noteRuntimeRecoveryFailure,
  recordRuntimeStreamStartFailure,
  shouldEmitRecoveredAlert,
} from "./runtime-streams.js";

export async function playRuntimeStation(runtime, state, stations, key, guildId, options = {}) {
  const station = stations.stations[key];
  if (!station) throw new Error("Station nicht gefunden.");

  // The running stream keeps playing until the new source is actually ready.
  // Only then is it swapped and the old process killed. This makes a station
  // switch gapless and, more importantly, the replaced resource never reaches
  // the player as an Idle event that would schedule a second restart (#188).
  let bitrateOverride = null;
  if (guildId) {
    const tierConfig = getTierConfig(guildId);
    bitrateOverride = tierConfig.bitrate;
  }

  const nextGeneration = (Number(state.streamGeneration || 0) || 0) + 1;
  const resourceMetadata = { generation: nextGeneration, stationKey: key };
  const createStreamResource = typeof runtime.createStreamResource === "function"
    ? runtime.createStreamResource.bind(runtime)
    : createResource;
  const { resource, process, mixer = null } = await createStreamResource(
    station.url,
    state.volume,
    stations.qualityPreset,
    runtime.config.name,
    bitrateOverride,
    getRuntimeRecoveryScope(runtime, guildId),
    { metadata: resourceMetadata }
  );
  if (resource && (resource.metadata === null || resource.metadata === undefined)) {
    resource.metadata = resourceMetadata;
  }

  const staleProcess = state.currentProcess;
  state.streamGeneration = nextGeneration;
  clearRuntimeFailbackTimer(state);
  clearRuntimeStreamHealthTimer(state);
  state.currentProcess = process;
  // The server's jingle mixes in here (#309); null when ffmpeg sends Opus.
  state.jingleMixer = mixer || null;
  runtime.trackProcessLifecycle(guildId, state, process);

  state.player.play(resource);
  if (staleProcess && staleProcess !== process) {
    try {
      staleProcess.kill("SIGKILL");
    } catch {
      // process may already be dead
    }
  }

  // A restart that was still pending for the replaced stream is obsolete.
  if (state.streamRestartTimer) {
    clearTimeout(state.streamRestartTimer);
    state.streamRestartTimer = null;
  }
  state.streamRestartScheduledAt = 0;
  state.streamRestartScheduledReason = null;
  state.streamRestartScheduledDelayMs = 0;

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
  state.failoverWindowClearedForStream = false;
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
  armRuntimeFailbackProbe(runtime, guildId, state);
  // Someone started or switched the station: the server's jingle plays over
  // it (#309). Restarts, fallbacks and restores never pass `jingle`.
  if (options?.jingle === true && state.jingleMixer && typeof runtime.playGuildJingle === "function") {
    runtime.playGuildJingle(guildId, { reason: "switch" }).catch((err) => {
      log("WARN", `[${runtime.config.name}] Jingle guild=${guildId}: ${err?.message || err}`);
    });
  }

  const fetchInfo = typeof runtime.fetchStreamInfo === "function"
    ? runtime.fetchStreamInfo.bind(runtime)
    : fetchStreamInfo;
  fetchInfo(station.url)
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
    await handleRuntimeStationUnavailable(runtime, guildId, state, { source: "restart" });
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

    // #413: after the server's own chain, every plan gets automatic fallbacks.
    const automaticKeys = typeof runtime.getAutomaticFallbackKeys === "function"
      ? await Promise.resolve(runtime.getAutomaticFallbackKeys(guildId, resolvedStation)).catch(() => [])
      : [];
    const fallbackCandidates = buildFailoverCandidateChain({
      currentStationKey: resolvedStation.key,
      configuredChain: configuredFailoverChain,
      fallbackStation: legacyFallbackStation,
      automaticKeys,
    });
    const failoverDecision = evaluateFailoverEligibility(state, {
      stationKey: resolvedStation.key,
      candidateCount: fallbackCandidates.length,
      lastAudioAt: Number(state.lastAudioHeardAt || 0) || 0,
    });

    if (fallbackCandidates.length > 0 && !failoverDecision.eligible) {
      log(
        "INFO",
        `[${runtime.config.name}] Failover für ${resolvedStation.key} bleibt gesperrt ` +
        `(Grund=${failoverDecision.reason}, Fehler=${failoverDecision.failureCount}/${failoverDecision.requiredFailures}, ` +
        `instabil=${Math.round(failoverDecision.unstableForMs / 1000)}s/${Math.round(failoverDecision.requiredUnstableMs / 1000)}s, ` +
        `ohneAudio=${Math.round(failoverDecision.silentForMs / 1000)}s).`
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
        // eslint-disable-next-line no-await-in-loop -- one fallback station after the other, the first that plays wins
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
        state.failbackAttempts = 0;
        state.failbackSuccessCount = 0;
        armRuntimeFailbackProbe(runtime, guildId, state);
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
      void alertFailoverExhausted({
        stationKey: resolvedStation.key,
        stationName: resolvedStation.station.name || resolvedStation.key,
        guildName: runtime.client?.guilds?.cache?.get(guildId)?.name || guildId,
        runtimeName: runtime.config.name,
      }).catch(() => null);
    }

    if (isPermanentStreamRestartError(err) && fallbackCandidates.length === 0) {
      log(
        "ERROR",
        `[${runtime.config.name}] Permanenter Stream-Restartfehler für ${resolvedStation.key}; Wiedergabe wird beendet: ${errorMessage}`
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
        `[${runtime.config.name}] Stream-Retry nach Restart-Fehler für ${resolvedStation.key} in ${Math.round(retryDelay)}ms ` +
        `(Fehlerreihe ${retry.errorCount}${retry.cooldownActive ? ", Cooldown aktiv" : ""})`
      );
      runtime.scheduleStreamRestart(guildId, state, retryDelay, "restart-error");
      runtime.persistState?.();
      return;
    }

    if (state.lastChannelId) {
      log(
        "INFO",
        `[${runtime.config.name}] Voice-Reconnect nach Restart-Fehler für guild=${guildId} wird geplant.`
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
    recordPlaybackPhase(runtime, guildId, state, "restart-done");
  }
}
