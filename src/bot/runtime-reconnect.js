// OmniFM: voice connection handlers, reconnect attempts and their schedule.
// Split out of src/bot/runtime-recovery.js (#295).
import { ChannelType, PermissionFlagsBits } from "discord.js";
import {
  joinVoiceChannel,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";
import { log, logError } from "../lib/logging.js";
import { applyJitter, VOICE_RECONNECT_MAX_MS, VOICE_RECONNECT_EXP_STEPS } from "../lib/helpers.js";
import { recordConnectionEvent } from "../listening-stats-store.js";
import { recordPlaybackPhase } from "./playback-phase.js";
import {
  VOICE_NETWORK_ERROR_RETRY_JITTER,
  VOICE_NETWORK_ERROR_RETRY_MIN_MS,
  VOICE_PARKED_RETRY_MS,
  VOICE_RECONNECT_CIRCUIT_BREAKER_ATTEMPTS,
  VOICE_RECONNECT_CIRCUIT_BREAKER_MS,
  VOICE_RECONNECT_MAX_CIRCUIT_TRIPS,
  VOICE_RECONNECT_PERMISSION_CONFIRMATIONS,
  VOICE_RECONNECT_READY_FAILURE_CONFIRMATIONS,
  VOICE_RECONNECT_RESCHEDULE_SLACK_MS,
  VOICE_RECONNECT_RESOURCE_CONFIRMATIONS,
  buildRuntimeLogContext,
  clearRestoreBlockState,
  clearTransientVoiceIssue,
  clearTransientVoiceIssues,
  fetchRestoreChannel,
  fetchRestoreGuild,
  getRuntimeErrorMessage,
  getRuntimeRecoveryDelayMs,
  getTierConfig,
  isPermanentRestoreResourceError,
  isRecoverableVoiceConnectionError,
  logRuntimeRecoveryState,
  noteRuntimeRecoveryFailure,
  noteRuntimeRecoverySuccess,
  noteTransientVoiceIssue,
  parkRuntimeReconnectTarget,
  runtimeRecoveryScopeMatches,
  shouldLogRecurringTransientIssue,
  unparkRuntimeReconnectTarget,
} from "./runtime-recovery.js";

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
