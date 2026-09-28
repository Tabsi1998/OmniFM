// OmniFM: the methods that hand over to the stream, voice, event and reconnect modules.
// BotRuntime methods, split out of src/bot/runtime.js (#295); mixed into
// BotRuntime.prototype there, so `this` is the runtime as before.
import { recordRuntimeIncident } from "../../services/runtime-health-reporter.js";
import { automaticFallbackKeysForGuild } from "../automatic-fallback.js";
import {
  normalizeStationReference,
  resolveStationForGuild,
  getResolvedCurrentStation,
  clearScheduledEventPlayback,
  markScheduledEventPlayback,
  setScheduledEventPlaybackInGuild,
  clearScheduledEventPlaybackInGuild,
  getScheduledEventEndAtMs,
  formatDiscordTimestamp,
  normalizeClearableText,
  isScheduledEventStopDue,
  resolveGuildEmojiAliases,
  buildScheduledEventServerDescription,
  validateDiscordScheduledEventPermissions,
  buildScheduledEventSummary,
  buildScheduledEventEmbed,
  buildScheduledEventsListEmbed,
  parseEventWindowInput,
  queueImmediateScheduledEventTick,
  resolveGuildVoiceChannel,
  ensureStageChannelReady,
  deleteDiscordScheduledEventById,
  syncDiscordScheduledEvent,
  ensureVoiceConnectionForChannel,
  postScheduledEventAnnouncement,
  executeScheduledEvent,
  executeScheduledEventStop,
  tickScheduledEvents,
  startEventScheduler,
  stopEventScheduler,
  handleEventCommand,
} from "../runtime-events.js";
import {
  clearRuntimeCurrentProcess,
  armRuntimeStreamStabilityReset,
  trackRuntimeProcessLifecycle,
  scheduleRuntimeStreamRestart,
  armRuntimePlaybackRecovery,
  handleRuntimeStreamEnd,
  playRuntimeStation,
  restartRuntimeCurrentStation,
  armRuntimeFailbackProbe,
  runRuntimeFailbackProbe,
  clearRuntimeFailbackTimer,
} from "../runtime-streams.js";
import {
  handleRuntimeBotVoiceStateUpdate,
  resetRuntimeVoiceSession,
  clearRuntimeRestoreRetry,
  clearQueuedRuntimeVoiceReconcile,
  queueRuntimeVoiceStateReconcile,
  confirmRuntimeBotVoiceChannel,
  fetchRuntimeBotVoiceState,
  reconcileRuntimeGuildVoiceState,
  tickRuntimeVoiceStateHealth,
  startRuntimeVoiceStateReconciler,
  stopRuntimeVoiceStateReconciler,
  attachRuntimeConnectionHandlers,
  tryRuntimeReconnect,
  handleRuntimeNetworkRecovered,
  scheduleRuntimeReconnect,
} from "../runtime-recovery.js";

const runtimeDelegateMethods = {
  clearReconnectTimer(state) {
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    state.reconnectScheduledAt = 0;
    state.reconnectScheduledReason = null;
    state.reconnectScheduledDelayMs = 0;
    if (state.streamRestartTimer) {
      clearTimeout(state.streamRestartTimer);
      state.streamRestartTimer = null;
    }
    state.streamRestartScheduledAt = 0;
    state.streamRestartScheduledReason = null;
    state.streamRestartScheduledDelayMs = 0;
    this.clearStreamStabilityTimer(state);
    clearRuntimeFailbackTimer(state);
  },

  clearStreamStabilityTimer(state) {
    if (state.streamStableTimer) {
      clearTimeout(state.streamStableTimer);
      state.streamStableTimer = null;
    }
  },

  clearNowPlayingTimer(state) {
    if (state.nowPlayingRefreshTimer) {
      clearInterval(state.nowPlayingRefreshTimer);
      state.nowPlayingRefreshTimer = null;
    }
  },

  clearCurrentProcess(state) {
    return clearRuntimeCurrentProcess(this, state);
  },

  armStreamStabilityReset(guildId, state) {
    return armRuntimeStreamStabilityReset(this, guildId, state);
  },

  armFailbackProbe(guildId, state, options = {}) {
    return armRuntimeFailbackProbe(this, guildId, state, options);
  },

  runFailbackProbe(guildId, state) {
    return runRuntimeFailbackProbe(this, guildId, state);
  },

  trackProcessLifecycle(guildId, state, process) {
    return trackRuntimeProcessLifecycle(this, guildId, state, process);
  },

  scheduleStreamRestart(guildId, state, delayMs, reason = "restart") {
    return scheduleRuntimeStreamRestart(this, guildId, state, delayMs, reason);
  },

  armPlaybackRecovery(guildId, state, stations, key, err, options = {}) {
    return armRuntimePlaybackRecovery(this, guildId, state, stations, key, err, options);
  },

  async handleStreamEnd(guildId, state, reason) {
    return handleRuntimeStreamEnd(this, guildId, state, reason);
  },

  async playStation(state, stations, key, guildId, options = {}) {
    return playRuntimeStation(this, state, stations, key, guildId, options);
  },

  async restartCurrentStation(state, guildId) {
    return restartRuntimeCurrentStation(this, state, guildId);
  },

  async resolveBotMember(guild) {
    if (guild.members.me) return guild.members.me;
    return guild.members.fetchMe().catch(() => null);
  },

  handleBotVoiceStateUpdate(oldState, newState) {
    return handleRuntimeBotVoiceStateUpdate(this, oldState, newState);
  },

  resetVoiceSession(guildId, state, { preservePlaybackTarget = false, clearLastChannel = false } = {}) {
    return resetRuntimeVoiceSession(this, guildId, state, { preservePlaybackTarget, clearLastChannel });
  },

  clearRestoreRetry(guildId) {
    return clearRuntimeRestoreRetry(this, guildId);
  },

  clearQueuedVoiceReconcile(guildId) {
    return clearQueuedRuntimeVoiceReconcile(this, guildId);
  },

  queueVoiceStateReconcile(guildId, reason = "queued", delayMs = 1200) {
    return queueRuntimeVoiceStateReconcile(this, guildId, reason, delayMs);
  },

  async confirmBotVoiceChannel(guildId, expectedChannelId, { timeoutMs = 10_000, intervalMs = 800 } = {}) {
    return confirmRuntimeBotVoiceChannel(this, guildId, expectedChannelId, { timeoutMs, intervalMs });
  },

  async fetchBotVoiceState(guildId) {
    return fetchRuntimeBotVoiceState(this, guildId);
  },

  async reconcileGuildVoiceState(guildId, { reason = "periodic" } = {}) {
    return reconcileRuntimeGuildVoiceState(this, guildId, { reason });
  },

  async tickVoiceStateHealth() {
    return tickRuntimeVoiceStateHealth(this);
  },

  startVoiceStateReconciler() {
    return startRuntimeVoiceStateReconciler(this);
  },

  stopVoiceStateReconciler() {
    return stopRuntimeVoiceStateReconciler(this);
  },

  attachConnectionHandlers(guildId, connection) {
    return attachRuntimeConnectionHandlers(this, guildId, connection);
  },

  normalizeStationReference(...args) {
    return normalizeStationReference(this, ...args);
  },

  resolveStationForGuild(...args) {
    return resolveStationForGuild(this, ...args);
  },

  // #413: the fallback stations every plan gets when a stream fails.
  getAutomaticFallbackKeys(guildId, resolvedStation) {
    return automaticFallbackKeysForGuild(guildId, resolvedStation);
  },

  getResolvedCurrentStation(...args) {
    return getResolvedCurrentStation(this, ...args);
  },

  clearScheduledEventPlayback(...args) {
    return clearScheduledEventPlayback(this, ...args);
  },

  markScheduledEventPlayback(...args) {
    return markScheduledEventPlayback(this, ...args);
  },

  setScheduledEventPlaybackInGuild(...args) {
    return setScheduledEventPlaybackInGuild(this, ...args);
  },

  clearScheduledEventPlaybackInGuild(...args) {
    return clearScheduledEventPlaybackInGuild(this, ...args);
  },

  getScheduledEventEndAtMs(...args) {
    return getScheduledEventEndAtMs(this, ...args);
  },

  formatDiscordTimestamp(...args) {
    return formatDiscordTimestamp(this, ...args);
  },

  normalizeClearableText(...args) {
    return normalizeClearableText(this, ...args);
  },

  isScheduledEventStopDue(...args) {
    return isScheduledEventStopDue(this, ...args);
  },

  resolveGuildEmojiAliases(...args) {
    return resolveGuildEmojiAliases(this, ...args);
  },

  buildScheduledEventServerDescription(...args) {
    return buildScheduledEventServerDescription(this, ...args);
  },

  validateDiscordScheduledEventPermissions(...args) {
    return validateDiscordScheduledEventPermissions(this, ...args);
  },

  buildScheduledEventSummary(...args) {
    return buildScheduledEventSummary(this, ...args);
  },

  buildScheduledEventEmbed(...args) {
    return buildScheduledEventEmbed(this, ...args);
  },

  buildScheduledEventsListEmbed(...args) {
    return buildScheduledEventsListEmbed(this, ...args);
  },

  parseEventWindowInput(...args) {
    return parseEventWindowInput(this, ...args);
  },

  queueImmediateScheduledEventTick(...args) {
    return queueImmediateScheduledEventTick(this, ...args);
  },

  resolveGuildVoiceChannel(...args) {
    return resolveGuildVoiceChannel(this, ...args);
  },

  ensureStageChannelReady(...args) {
    return ensureStageChannelReady(this, ...args);
  },

  deleteDiscordScheduledEventById(...args) {
    return deleteDiscordScheduledEventById(this, ...args);
  },

  syncDiscordScheduledEvent(...args) {
    return syncDiscordScheduledEvent(this, ...args);
  },

  ensureVoiceConnectionForChannel(...args) {
    return ensureVoiceConnectionForChannel(this, ...args);
  },

  postScheduledEventAnnouncement(...args) {
    return postScheduledEventAnnouncement(this, ...args);
  },

  executeScheduledEvent(...args) {
    return executeScheduledEvent(this, ...args);
  },

  executeScheduledEventStop(...args) {
    return executeScheduledEventStop(this, ...args);
  },

  tickScheduledEvents() {
    return tickScheduledEvents(this);
  },

  startEventScheduler() {
    return startEventScheduler(this);
  },

  stopEventScheduler() {
    return stopEventScheduler(this);
  },

  handleEventCommand(...args) {
    return handleEventCommand(this, ...args);
  },

  async tryReconnect(guildId) {
    return tryRuntimeReconnect(this, guildId);
  },

  handleNetworkRecovered(recoveryEvent = null) {
    return handleRuntimeNetworkRecovered(this, recoveryEvent);
  },

  scheduleReconnect(guildId, options = {}) {
    // Reconnect-Incident (throttled, damit es das Monitoring nicht flutet).
    try {
      const state = this.guildState.get(guildId);
      const nowMs = Date.now();
      if (state && (!state.lastReconnectIncidentAt || (nowMs - state.lastReconnectIncidentAt) > 30000)) {
        state.lastReconnectIncidentAt = nowMs;
        recordRuntimeIncident({
          severity: "warning",
          source: this.config.name,
          message: `Voice-Reconnect wird ausgeführt (Guild ${guildId})${options?.reason ? ` – ${options.reason}` : ""}.`,
          resolved: false,
        }).catch(() => {});
      }
    } catch { /* noop */ }
    return scheduleRuntimeReconnect(this, guildId, options);
  },
};

export { runtimeDelegateMethods };
