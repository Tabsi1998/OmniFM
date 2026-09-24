// Status and statistics: listener sampling, live playback snapshots, the
// status snapshot for dashboard and workers, and stream diagnostics.
// BotRuntime methods, moved out of runtime.js unchanged (#210) and mixed into
// BotRuntime.prototype there, so `this` is the runtime as before.
import { log } from "../../lib/logging.js";
import { buildTranscodeProfile } from "../../lib/helpers.js";
import { loadStations } from "../../stations-store.js";
import { recordGuildListenerSample, recordSessionListenerSample } from "../../listening-stats-store.js";
import { buildInviteUrl } from "../../bot-config.js";
import { buildResolvedVoiceGuardConfig } from "../../lib/voice-guard.js";
import {
  getRuntimeConnectedChannelId,
  isRuntimePlaybackActive,
  isRuntimeVoiceConnected,
} from "../runtime-live-state.js";
import {
  getTierConfig,
  LISTENER_STATS_POLL_MS,
} from "../runtime-shared.js";
import { derivePlaybackPhase } from "../playback-phase.js";

const statusMethods = {
  buildLocalLivePlaybackSnapshot(guildId) {
    const normalizedGuildId = String(guildId || "").trim();
    if (!normalizedGuildId) return [];
    const state = this.guildState.get(normalizedGuildId);
    if (!state?.currentStationKey || !isRuntimePlaybackActive(this, normalizedGuildId, state)) return [];
    const info = this.getGuildInfo(normalizedGuildId) || {};
    return [{
      runtime: this,
      state,
      stationKey: info.stationKey || state.currentStationKey || null,
      stationName: info.stationName || state.currentStationName || null,
      channelId: info.channelId || state.lastChannelId || null,
      listenerCount: this.getCurrentListenerCount(normalizedGuildId, state),
    }];
  },

  collectGuildIdsForListenerStats() {
    const guildIds = new Set();

    for (const [guildId, state] of this.guildState.entries()) {
      if (isRuntimePlaybackActive(this, guildId, state)) {
        guildIds.add(guildId);
      }
    }

    if (this.role === "commander" && this.workerManager) {
      for (const worker of this.workerManager.workers || []) {
        for (const [guildId, state] of worker.guildState.entries()) {
          if (isRuntimePlaybackActive(worker, guildId, state)) {
            guildIds.add(guildId);
          }
        }
      }
    }

    return [...guildIds.values()];
  },

  sampleListenerStatsForActiveGuilds() {
    const now = Date.now();
    const guildIds = this.collectGuildIdsForListenerStats();

    for (const guildId of guildIds) {
      const liveStreams = this.getLiveGuildPlaybackSnapshot(guildId);
      if (!liveStreams.length) continue;

      const totalListeners = liveStreams.reduce((sum, stream) => sum + (Number(stream.listenerCount) || 0), 0);
      recordGuildListenerSample(guildId, totalListeners, now);

      for (const stream of liveStreams) {
        recordSessionListenerSample(guildId, {
          botId: stream.runtime?.config?.id || "",
          listenerCount: stream.listenerCount,
          timestampMs: now,
        });
      }
    }
  },

  startListenerStatsSampler() {
    if (this.role !== "commander") return;
    this.stopListenerStatsSampler();

    const sample = () => {
      try {
        this.sampleListenerStatsForActiveGuilds();
      } catch (err) {
        log("WARN", `[${this.config.name}] Listener-Stats-Sampling fehlgeschlagen: ${err?.message || err}`);
      }
    };

    sample();
    this.listenerStatsTimer = setInterval(sample, LISTENER_STATS_POLL_MS);
    this.listenerStatsTimer?.unref?.();
  },

  stopListenerStatsSampler() {
    if (this.listenerStatsTimer) {
      clearInterval(this.listenerStatsTimer);
      this.listenerStatsTimer = null;
    }
  },

  getVoiceListenerCount(guildId, channelId) {
    const guild = this.client.guilds.cache.get(guildId);
    const normalizedChannelId = String(channelId || "").trim();
    if (!guild || !normalizedChannelId) return 0;
    const channel = guild.channels?.cache?.get(normalizedChannelId);
    if (!channel?.isVoiceBased?.() || !channel.members) return 0;
    let listeners = 0;
    for (const member of channel.members.values()) {
      if (!member?.user?.bot) listeners += 1;
    }
    return listeners;
  },

  getCurrentListenerCount(guildId, state) {
    const channelId = getRuntimeConnectedChannelId(this, guildId, state, {
      includeObserved: true,
      includeLastKnown: true,
    });
    return this.getVoiceListenerCount(guildId, channelId);
  },

  getLiveGuildPlaybackSnapshot(guildId) {
    const normalizedGuildId = String(guildId || "").trim();
    if (!normalizedGuildId) return [];

    const snapshots = this.buildLocalLivePlaybackSnapshot(normalizedGuildId);
    if (this.role === "commander" && this.workerManager) {
      for (const runtime of this.workerManager.getStreamingWorkers(normalizedGuildId)) {
        const state = runtime.getState(normalizedGuildId);
        const info = runtime.getGuildInfo(normalizedGuildId) || {};
        snapshots.push({
          runtime,
          state,
          stationKey: info.stationKey || state?.currentStationKey || null,
          stationName: info.stationName || state?.currentStationName || null,
          channelId: info.channelId || state?.lastChannelId || null,
          listenerCount: runtime.getCurrentListenerCount(normalizedGuildId, state),
        });
      }
      return snapshots;
    }

    return snapshots;
  },

  collectStats() {
    const servers = this.client.guilds.cache.size;
    const users = this.client.guilds.cache.reduce((sum, guild) => sum + (Number(guild.memberCount) || 0), 0);

    let connections = 0;
    let listeners = 0;
    for (const [guildId, state] of this.guildState.entries()) {
      if (isRuntimeVoiceConnected(this, guildId, state, { includeObserved: true })) connections += 1;
      if (isRuntimePlaybackActive(this, guildId, state)) {
        listeners += this.getCurrentListenerCount(guildId, state);
      }
    }

    return { servers, users, connections, listeners };
  },

  getPlayingGuildCount() {
    let count = 0;
    for (const [guildId, state] of this.guildState.entries()) {
      if (isRuntimePlaybackActive(this, guildId, state)) count += 1;
    }
    return count;
  },

  buildStatusSnapshot({ includeGuildDetails = false } = {}) {
    const stats = this.collectStats();
    const resolvedClientId = this.getApplicationId() || this.config.clientId;
    const isPremiumBot = this.config.requiredTier && this.config.requiredTier !== "free";
    const accentColor = this.config.requiredTier === "ultimate"
      ? "#FF2A5F"
      : this.config.requiredTier === "pro"
        ? "#FF6B00"
        : "#00E5FF";
    const status = {
      id: this.config.id,
      botId: this.config.id,
      index: Number(this.config.index || 0) || null,
      name: this.config.name,
      role: this.role,
      color: accentColor,
      clientId: isPremiumBot ? null : resolvedClientId,
      inviteUrl: isPremiumBot ? null : buildInviteUrl({ ...this.config, clientId: resolvedClientId }),
      requiredTier: this.config.requiredTier || "free",
      ready: this.client.isReady(),
      userTag: this.client.user?.tag || null,
      avatarUrl: this.client.user?.displayAvatarURL({ extension: "png", size: 256 }) || null,
      guilds: stats.servers,
      servers: stats.servers,
      users: stats.users,
      connections: stats.connections,
      listeners: stats.listeners,
      uptimeSec: Math.floor((Date.now() - this.startedAt) / 1000),
      error: this.startError ? String(this.startError.message || this.startError) : null,
    };

    if (!includeGuildDetails) return status;

    const guildDetails = [];
    for (const [guildId, state] of this.guildState.entries()) {
      const guild = this.client.guilds.cache.get(guildId);
      if (!guild) continue;
      const defaultVoiceGuardConfig = buildResolvedVoiceGuardConfig({});
      const playing = isRuntimePlaybackActive(this, guildId, state);
      const voiceConnected = isRuntimeVoiceConnected(this, guildId, state, { includeObserved: true });
      const connectedChannelId = getRuntimeConnectedChannelId(this, guildId, state, {
        includeObserved: true,
        includeLastKnown: true,
      }) || null;
      const detail = {
        guildId,
        guildName: guild.name,
        stationKey: state.currentStationKey || null,
        stationName: state.currentStationName || null,
        desiredStationKey: state.desiredStationKey || state.currentStationKey || null,
        desiredStationName: state.desiredStationName || state.currentStationName || null,
        failoverActive: state.failoverActive === true,
        playbackPhase: derivePlaybackPhase(state),
        failoverStartedAt: Number(state.failoverStartedAt || 0) || 0,
        failoverReason: state.failoverReason || null,
        failoverFromStationKey: state.failoverFromStationKey || null,
        failoverFromStationName: state.failoverFromStationName || null,
        channelId: connectedChannelId,
        channelName: connectedChannelId ? guild.channels.cache.get(connectedChannelId)?.name || null : null,
        listenerCount: this.getCurrentListenerCount(guildId, state),
        volume: state.volume,
        voiceConnected,
        playing,
        recovering: Boolean(
          state.currentStationKey
          && state.shouldReconnect === true
          && (
            !playing
            || state.reconnectTimer
            || state.streamRestartTimer
            || state.streamRestartInFlight
            || (Number(state.reconnectAttempts || 0) || 0) > 0
          )
        ),
        reconnectAttempts: Number(state.reconnectAttempts || 0) || 0,
        streamErrorCount: Number(state.streamErrorCount || 0) || 0,
        failoverFailureCount: Number(state.failoverFailureCount || 0) || 0,
        shouldReconnect: state.shouldReconnect === true,
        meta: state.currentMeta || null,
      };

      if (state.failoverActive === true) {
        detail.failbackNextProbeAt = Number(state.failbackNextProbeAt || 0) || 0;
        detail.failbackAttempts = Number(state.failbackAttempts || 0) || 0;
        detail.failbackLastResult = state.failbackLastResult || null;
      }
      if (state.parkedReason) {
        detail.parkedReason = state.parkedReason;
        detail.parkedAt = Number(state.parkedAt || 0) || 0;
        detail.parkedDetail = state.parkedDetail || null;
      }
      if (state.serverMuted === true) {
        detail.serverMuted = true;
        detail.serverMutedAt = Number(state.serverMutedAt || 0) || 0;
      }

      const reconnectCount = Number(state.reconnectCount || 0) || 0;
      if (reconnectCount > 0) detail.reconnectCount = reconnectCount;

      if (state.lastReconnectAt) detail.lastReconnectAt = state.lastReconnectAt;
      if (state.reconnectTimer) detail.reconnectPending = true;
      if (state.reconnectInFlight === true) detail.reconnectInFlight = true;
      if (state.streamRestartTimer) detail.streamRestartPending = true;
      if (state.streamRestartInFlight === true) detail.streamRestartInFlight = true;
      if (state.voiceConnectInFlight === true) detail.voiceConnectInFlight = true;
      if (state.lastStreamErrorAt) detail.lastStreamErrorAt = state.lastStreamErrorAt;
      if (state.lastHealthcheckFailureAt) detail.lastHealthcheckFailureAt = state.lastHealthcheckFailureAt;
      if (state.lastProcessExitCode !== null && state.lastProcessExitCode !== undefined) {
        detail.lastProcessExitCode = state.lastProcessExitCode;
      }
      if (state.lastProcessExitDetail) detail.lastProcessExitDetail = state.lastProcessExitDetail;

      const lastProcessExitAt = Number(state.lastProcessExitAt || 0) || 0;
      if (lastProcessExitAt > 0) detail.lastProcessExitAt = lastProcessExitAt;

      if (state.lastStreamEndReason) detail.lastStreamEndReason = state.lastStreamEndReason;

      const lastNetworkFailureAt = Number(state.lastNetworkFailureAt || 0) || 0;
      if (lastNetworkFailureAt > 0) detail.lastNetworkFailureAt = lastNetworkFailureAt;

      const voiceDisconnectObservedAt = Number(state.voiceDisconnectObservedAt || 0) || 0;
      if (voiceDisconnectObservedAt > 0) detail.voiceDisconnectObservedAt = voiceDisconnectObservedAt;

      if (state.lastStreamStartAt) {
        detail.lastStreamStartAt = new Date(Number(state.lastStreamStartAt)).toISOString();
      }

      if (state.activeScheduledEventId) detail.activeScheduledEventId = state.activeScheduledEventId;

      const activeScheduledEventStopAtMs = Number(state.activeScheduledEventStopAtMs || 0) || 0;
      if (activeScheduledEventStopAtMs > 0) {
        detail.activeScheduledEventStopAtMs = activeScheduledEventStopAtMs;
      }

      const reconnectCircuitTripCount = Number(state.reconnectCircuitTripCount || 0) || 0;
      if (reconnectCircuitTripCount > 0) detail.reconnectCircuitTripCount = reconnectCircuitTripCount;

      const reconnectCircuitOpenUntil = Number(state.reconnectCircuitOpenUntil || 0) || 0;
      if (reconnectCircuitOpenUntil > 0) detail.reconnectCircuitOpenUntil = reconnectCircuitOpenUntil;

      const restoreBlockedUntil = Number(state.restoreBlockedUntil || 0) || 0;
      if (restoreBlockedUntil > 0) detail.restoreBlockedUntil = restoreBlockedUntil;

      const restoreBlockedAt = Number(state.restoreBlockedAt || 0) || 0;
      if (restoreBlockedAt > 0) detail.restoreBlockedAt = restoreBlockedAt;

      const restoreBlockCount = Number(state.restoreBlockCount || 0) || 0;
      if (restoreBlockCount > 0) detail.restoreBlockCount = restoreBlockCount;

      if (state.restoreBlockReason) detail.restoreBlockReason = state.restoreBlockReason;

      const getNetworkRecoveryDelayMs =
        typeof this.getNetworkRecoveryDelayMs === "function"
          ? this.getNetworkRecoveryDelayMs.bind(this)
          : null;
      const networkRecoveryDelayMs = getNetworkRecoveryDelayMs ? (Number(getNetworkRecoveryDelayMs(guildId)) || 0) : 0;
      if (networkRecoveryDelayMs > 0) detail.networkRecoveryDelayMs = networkRecoveryDelayMs;
      const hasVoiceGuardDetails = state.voiceGuardAvailable === true
        || (Number(state.voiceGuardUnlockUntil || 0) || 0) > 0
        || (Number(state.voiceGuardCooldownUntil || 0) || 0) > 0
        || (Number(state.voiceGuardWindowStartedAt || 0) || 0) > 0
        || (Number(state.voiceGuardWindowMoveCount || 0) || 0) > 0
        || (Number(state.voiceGuardMoveCount || 0) || 0) > 0
        || (Number(state.voiceGuardReturnCount || 0) || 0) > 0
        || (Number(state.voiceGuardDisconnectCount || 0) || 0) > 0
        || (Number(state.voiceGuardEscalationCount || 0) || 0) > 0
        || Boolean(state.voiceGuardLastAction)
        || Boolean(state.voiceGuardLastActionReason)
        || Boolean(state.voiceGuardLastExpectedChannelId)
        || Boolean(state.voiceGuardLastActualChannelId);
      if (hasVoiceGuardDetails) {
        detail.voiceGuardAvailable = state.voiceGuardAvailable === true;
        detail.voiceGuardPolicy = state.voiceGuardPolicy || "default";
        detail.voiceGuardEffectivePolicy = state.voiceGuardEffectivePolicy || defaultVoiceGuardConfig.effectivePolicy;
        if (state.voiceGuardUnlockUntil > 0) detail.voiceGuardUnlockUntil = state.voiceGuardUnlockUntil;
        if (state.voiceGuardCooldownUntil > 0) detail.voiceGuardCooldownUntil = state.voiceGuardCooldownUntil;
        if (state.voiceGuardWindowStartedAt > 0) detail.voiceGuardWindowStartedAt = state.voiceGuardWindowStartedAt;
        if ((Number(state.voiceGuardWindowMoveCount || 0) || 0) > 0) detail.voiceGuardWindowMoveCount = Number(state.voiceGuardWindowMoveCount || 0) || 0;
        if ((Number(state.voiceGuardMoveCount || 0) || 0) > 0) detail.voiceGuardMoveCount = Number(state.voiceGuardMoveCount || 0) || 0;
        if ((Number(state.voiceGuardReturnCount || 0) || 0) > 0) detail.voiceGuardReturnCount = Number(state.voiceGuardReturnCount || 0) || 0;
        if ((Number(state.voiceGuardDisconnectCount || 0) || 0) > 0) detail.voiceGuardDisconnectCount = Number(state.voiceGuardDisconnectCount || 0) || 0;
        if ((Number(state.voiceGuardEscalationCount || 0) || 0) > 0) detail.voiceGuardEscalationCount = Number(state.voiceGuardEscalationCount || 0) || 0;
        if (state.voiceGuardLastAction) detail.voiceGuardLastAction = state.voiceGuardLastAction;
        if ((Number(state.voiceGuardLastActionAt || 0) || 0) > 0) detail.voiceGuardLastActionAt = Number(state.voiceGuardLastActionAt || 0) || 0;
        if (state.voiceGuardLastActionReason) detail.voiceGuardLastActionReason = state.voiceGuardLastActionReason;
        if (state.voiceGuardLastExpectedChannelId) detail.voiceGuardLastExpectedChannelId = state.voiceGuardLastExpectedChannelId;
        if (state.voiceGuardLastActualChannelId) detail.voiceGuardLastActualChannelId = state.voiceGuardLastActualChannelId;
      }

      guildDetails.push(detail);
    }

    return {
      ...status,
      guildDetails,
    };
  },

  getPublicStatus() {
    return this.buildStatusSnapshot();
  },

  getDashboardStatus() {
    return this.buildStatusSnapshot({ includeGuildDetails: true });
  },

  getStreamDiagnostics(guildId, state) {
    const tierConfig = getTierConfig(guildId);
    const stations = loadStations();
    const preset = stations.qualityPreset || "custom";
    const bitrateOverride = tierConfig.bitrate;
    const transcodeEnabled = String(process.env.TRANSCODE || "0") === "1" || preset !== "custom" || !!bitrateOverride;
    const profile = buildTranscodeProfile({ bitrateOverride, qualityPreset: preset });
    const streamLifetimeSec = state.lastStreamStartAt ? Math.floor((Date.now() - state.lastStreamStartAt) / 1000) : 0;

    return {
      preset,
      tier: tierConfig.tier,
      bitrateOverride,
      transcodeEnabled,
      transcodeMode: String(process.env.TRANSCODE_MODE || "opus").toLowerCase(),
      requestedBitrateKbps: profile.requestedKbps,
      profile: profile.isUltra ? "ultra-stable" : "stable",
      queue: profile.threadQueueSize,
      probeSize: profile.probeSize,
      analyzeUs: profile.analyzeDuration,
      streamLifetimeSec,
    };
  },

  /**
   * Get the current guild state info (for Commander queries).
   */
  getGuildInfo(guildId) {
    const state = this.guildState.get(guildId);
    if (!state) return null;
    const normalizedGuildId = String(guildId || "").trim();
    const connectedChannelId = getRuntimeConnectedChannelId(this, normalizedGuildId, state, {
      includeObserved: true,
      includeLastKnown: true,
    }) || null;
    return {
      playing: isRuntimePlaybackActive(this, normalizedGuildId, state),
      stationKey: state.currentStationKey,
      stationName: state.currentStationName,
      meta: state.currentMeta,
      volume: state.volume,
      channelId: connectedChannelId,
      listenerCount: this.getCurrentListenerCount(guildId, state),
      reconnectAttempts: state.reconnectAttempts || 0,
      shouldReconnect: state.shouldReconnect,
      streamErrorCount: state.streamErrorCount || 0,
      voiceGuard: this.getVoiceGuardRuntimeSummary(normalizedGuildId),
    };
  },
};

export { statusMethods };
