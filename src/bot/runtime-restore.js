// Restore after a bot restart: the saved playback targets, the retries for
// servers and channels Discord cannot resolve yet, and the cooldown resume.
// Moved out of runtime-recovery.js (#210), which re-exports everything here.
import { log, logError } from "../lib/logging.js";
import { resolveReplacementStationForGuild, notifyRuntimeStationUnavailable } from "./runtime-streams.js";
import { applyJitter, waitMs } from "../lib/helpers.js";
import { clearBotGuild, getBotState } from "../bot-state.js";
import {
  toPositiveInt,
  parseStoredTimestampMs,
  clearRestoreBlockState,
  noteRuntimeRecoveryFailure,
  hasRecoverableRuntimeState,
  buildRuntimeLogContext,
  isPermanentRestoreResourceError,
  fetchRestoreGuild,
  fetchRestoreChannel,
} from "./runtime-recovery.js";

const RESTORE_RETRY_BASE_MS = Math.max(5_000, toPositiveInt(process.env.RESTORE_RETRY_BASE_MS, 15_000));

const RESTORE_RETRY_MAX_MS = Math.max(30_000, toPositiveInt(process.env.RESTORE_RETRY_MAX_MS, 5 * 60_000));

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

function clearRuntimeRestoreRetry(runtime, guildId) {
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

async function restoreRuntimeGuildEntry(runtime, guildId, data, stations, { source = "restore" } = {}) {
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

  const sleepUntilMs = parseStoredTimestampMs(data.sleepUntilMs);
  if (sleepUntilMs > 0 && sleepUntilMs <= nowMs) {
    clearRuntimeRestoreRetry(runtime, guildId);
    log("INFO", `[${runtime.config.name}] Sleep-Timer lief waehrend des Neustarts ab (guild=${guildId}); Stream bleibt aus.`);
    clearBotGuild(runtime.config.id, guildId);
    return { ok: false, permanent: true, resource: "sleep" };
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

  let restoredStation = runtime.resolveStationForGuild(guildId, data.stationKey, runtime.resolveGuildLanguage(guildId));
  let replacedStation = null;
  if (!restoredStation.ok) {
    const unavailableMessage = restoredStation.message || "station unavailable";
    const replacement = await resolveReplacementStationForGuild(runtime, guildId, data.stationKey);
    if (!replacement.ok) {
      clearRuntimeRestoreRetry(runtime, guildId);
      log("INFO", `[${runtime.config.name}] Station ${data.stationKey} nicht mehr vorhanden und kein Ersatz verfuegbar: ${unavailableMessage}`);
      void notifyRuntimeStationUnavailable(runtime, guildId, null, {
        previousStationKey: data.stationKey,
        previousStationName: data.stationName || data.stationKey,
        reason: unavailableMessage,
        stopped: true,
        channelId: data.channelId,
      }).catch(() => null);
      clearBotGuild(runtime.config.id, guildId);
      return { ok: false, permanent: true, resource: "station" };
    }
    log(
      "WARN",
      `[${runtime.config.name}] Station ${data.stationKey} nicht mehr verfuegbar (${unavailableMessage}); Restore nutzt ${replacement.key} (${replacement.source}).`
    );
    replacedStation = {
      previousStationKey: data.stationKey,
      previousStationName: data.stationName || data.stationKey,
      reason: unavailableMessage,
      source: replacement.source,
    };
    restoredStation = replacement;
    data = {
      ...data,
      desiredStationKey: replacement.key,
      desiredStationName: replacement.station?.name || replacement.key,
      failoverActive: false,
    };
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
  state.desiredStationKey = String(data.desiredStationKey || restoredStation.key).trim() || restoredStation.key;
  state.desiredStationName = String(data.desiredStationName || restoredStation.station.name || state.desiredStationKey).trim()
    || state.desiredStationKey;
  state.failoverActive = data.failoverActive === true && state.desiredStationKey !== restoredStation.key;
  state.failoverStartedAt = parseStoredTimestampMs(data.failoverStartedAt);
  state.failoverReason = String(data.failoverReason || "").trim() || null;
  state.failoverFromStationKey = String(data.failoverFromStationKey || "").trim() || null;
  state.failoverFromStationName = String(data.failoverFromStationName || "").trim() || null;
  state.failoverFailureStationKey = String(data.failoverFailureStationKey || "").trim() || null;
  state.failoverFailureCount = Math.max(0, Number.parseInt(String(data.failoverFailureCount || 0), 10) || 0);
  state.failoverFailureStartedAt = parseStoredTimestampMs(data.failoverFailureStartedAt);
  state.failoverLastFailureAt = parseStoredTimestampMs(data.failoverLastFailureAt);
  state.parkedReason = String(data.parkedReason || "").trim() || null;
  state.parkedAt = parseStoredTimestampMs(data.parkedAt);
  state.parkedDetail = String(data.parkedDetail || "").trim() || null;
  state.sleepUntilMs = sleepUntilMs > nowMs ? sleepUntilMs : 0;
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
    preserveDesiredStation: state.failoverActive === true,
  });
  clearRuntimeRestoreRetry(runtime, guildId);
  runtime.armSleepTimer?.(guildId);
  log("INFO", `[${runtime.config.name}] Wiederhergestellt: ${guild.name} -> ${restoredStation.station.name}`);
  if (replacedStation) {
    void notifyRuntimeStationUnavailable(runtime, guildId, state, {
      ...replacedStation,
      replacementStationKey: restoredStation.key,
      replacementStationName: restoredStation.station?.name || restoredStation.key,
    }).catch(() => null);
  }

  await waitMs(2000);
  return { ok: true };
}

async function restoreRuntimeState(runtime, stations) {
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

export {
  RESTORE_RETRY_BASE_MS,
  RESTORE_RETRY_MAX_MS,
  getRuntimeRestoreTimers,
  getRuntimeRestoreRetryCounts,
  clearRuntimeRestoreRetry,
  getRestoreRetryDelay,
  scheduleRuntimeRestoreResume,
  scheduleRuntimeRestoreRetry,
  restoreRuntimeGuildEntry,
  restoreRuntimeState,
};
