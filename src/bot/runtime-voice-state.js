// OmniFM: the bot's own voice state: flags, moves, resetting a voice session.
// Split out of src/bot/runtime-recovery.js (#295).
import { ChannelType } from "discord.js";
import { log } from "../lib/logging.js";
import { recordRuntimeIncident } from "../runtime-incidents-store.js";
import { recordStationStop } from "../listening-stats-store.js";
import { clearActiveFailover, clearFailoverFailureWindow } from "../lib/stream-failover-policy.js";
import { clearRuntimeRestoreRetry } from "./runtime-restore.js";
import { recordPlaybackPhase } from "./playback-phase.js";
import {
  clearRuntimeParkedState,
  clearRuntimeVoiceGuardWindow,
  clearTransientVoiceIssues,
  getExpectedRuntimeChannelId,
  getRuntimeVoiceGuardConfig,
  getTierConfig,
  isRuntimeVoiceGuardCooldownActive,
  noteTransientVoiceIssue,
  shouldProtectRuntimeVoiceChannel,
} from "./runtime-recovery.js";

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
          `[${runtime.config.name}] Unerwarteter Voice-Move erkannt guild=${guildId} expected=${expectedChannelId} actual=${newChannelId} - Kanal wird geschützt (${voiceGuardConfig.policy}).`
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
