import {
  Client,
  GatewayIntentBits,
  ChannelType,
  Routes,
  MessageFlags,
} from "discord.js";
import { REST } from "@discordjs/rest";
import { createAudioPlayer, NoSubscriberBehavior, AudioPlayerStatus } from "@discordjs/voice";
import { log } from "../lib/logging.js";
import {
  resolveCommandRegistrationMode,
  usesGlobalCommandRegistration,
  usesGuildCommandRegistration,
} from "../discord/commandRegistrationMode.js";
import { NowPlayingQueue } from "../lib/now-playing-queue.js";
import { applyVolumeTransformerLevel } from "../lib/helpers.js";
import { networkRecoveryCoordinator } from "../core/network-recovery.js";
import { setNowPlayingQueue } from "../services/now-playing.js";
import {
  saveBotState,
  clearBotGuild,
  isPersistableGuildState,
  setBotGuildVolume,
  getBotGuildVolume,
  getBotGuildChannelVolumes,
} from "../bot-state.js";
import { serverHasCapability } from "../core/entitlements.js";
import { recordStationStop } from "../listening-stats-store.js";
import { deleteScheduledEventsByFilter } from "../scheduled-events-store.js";
import { recordRuntimeIncident } from "../services/runtime-health-reporter.js";
import { syncGuildCommandsSafe } from "../discord/syncGuildCommandsSafe.js";
import { EMPTY_COMMANDS_HASH, defaultCommandFingerprintStore } from "../discord/commandFingerprints.js";
import { buildCommandBuilders } from "../commands.js";
import { loadGuildSettings } from "../lib/guild-settings.js";
import { buildResolvedVoiceGuardConfig, formatVoiceGuardDurationMs } from "../lib/voice-guard.js";
import { isRuntimePlaybackActive, isRuntimeVoiceConnected } from "./runtime-live-state.js";
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
} from "./runtime-events.js";
import { handleRuntimeAutocomplete, handleRuntimeInteraction } from "./runtime-interactions.js";
import {
  clearRuntimeCurrentProcess,
  armRuntimeStreamStabilityReset,
  trackRuntimeProcessLifecycle,
  scheduleRuntimeStreamRestart,
  armRuntimePlaybackRecovery,
  handleRuntimeStreamEnd,
  playRuntimeStation,
  restartRuntimeCurrentStation,
  shouldHandleRuntimeIdleEvent,
  armRuntimeFailbackProbe,
  runRuntimeFailbackProbe,
  clearRuntimeFailbackTimer,
} from "./runtime-streams.js";
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
  restoreRuntimeState,
} from "./runtime-recovery.js";
import { nowPlayingMethods } from "./now-playing/now-playing-methods.js";
import { menuMethods } from "./runtime-methods/menus.js";
import { permissionMethods } from "./runtime-methods/permissions.js";
import { statusMethods } from "./runtime-methods/status.js";
import { voiceMethods } from "./runtime-methods/voice.js";
import { onboardingMethods } from "./runtime-methods/onboarding.js";
import { recordPlaybackPhase } from "./playback-phase.js";
import { syncAppEmojisSafely } from "../discord/ui/app-emojis.js";

class BotRuntime {
  constructor(config, { role = "worker", workerManager = null } = {}) {
    this.config = config;
    this.role = role; // "commander" or "worker"
    this.workerSlot = role === "worker" ? (Number(config?.index || 0) || null) : null;
    this.workerManager = workerManager;
    this.voiceGroup = `bot-${this.config.clientId}`;
    this.rest = new REST({ version: "10" }).setToken(this.config.token);
    this.client = new Client({
      intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates]
    });
    this.guildState = new Map();
    this.nowPlayingQueue = new NowPlayingQueue(5);
    setNowPlayingQueue(this.nowPlayingQueue);
    this.startedAt = Date.now();
    this.readyAt = null;
    this.startError = null;
    this.eventSchedulerTimer = null;
    this.voiceHealthTimer = null;
    this.listenerStatsTimer = null;
    this.pendingVoiceReconcileTimers = new Map();
    this.guildOperationLocks = new Map();
    this.interactiveUiSessions = new Map();
    this.guildSettingsCache = new Map();
    this.scheduledEventInFlight = new Set();
    this.lastPersistLoggedActiveCount = null;
    this.shuttingDown = false;
    this.unsubscribeNetworkRecovery = networkRecoveryCoordinator.onRecovered((event) => {
      if (this.shuttingDown) return;
      this.handleNetworkRecovered(event);
    });

    this.client.once("clientReady", () => {
      this.readyAt = Date.now();
      log("INFO", `[${this.config.name}] Eingeloggt als ${this.client.user.tag} (role=${this.role})`);
      const runtimeAppId = this.getApplicationId();
      if (runtimeAppId && runtimeAppId !== String(this.config.clientId || "")) {
        log(
          "INFO",
          `[${this.config.name}] CLIENT_ID mismatch erkannt (env=${this.config.clientId}, runtime=${runtimeAppId}). Command-Sync nutzt runtime-ID.`
        );
      }
      this.updatePresence();
      this.startPresenceRotation();
      // The OmniFM icons as this application's own emojis (#265); until they
      // are there, messages use the Unicode fallback.
      void syncAppEmojisSafely(this.client, this.config.name);
      if (this.role === "commander") {
        this.enforcePremiumGuildScope("startup").catch((err) => {
          log("ERROR", `[${this.config.name}] Premium-Guild-Scope Pruefung fehlgeschlagen: ${err?.message || err}`);
        });
        this.refreshCommandsOnReady().catch((err) => {
          log("ERROR", `[${this.config.name}] Command-Registrierung fehlgeschlagen: ${err?.message || err}`);
        });
        this.startEventScheduler();
        this.startListenerStatsSampler();
      } else {
        this.clearCommandsForWorker().catch((err) => {
          log("ERROR", `[${this.config.name}] Worker-Command-Cleanup fehlgeschlagen: ${err?.message || err}`);
        });
      }
      this.startVoiceStateReconciler();
    });

    // Slash commands belong to the commander, but component interactions are
    // delivered to the application that created the message. Worker-owned
    // now-playing messages therefore have to be handled by the worker itself.
    this.client.on("interactionCreate", (interaction) => {
      const isComponent = interaction?.isButton?.() || interaction?.isStringSelectMenu?.();
      if (this.role !== "commander" && !isComponent) return;
      const task = this.role === "commander"
        ? this.handleInteraction(interaction)
        : this.handleComponentInteraction(interaction);
      task.catch(async (err) => {
          const commandName = interaction?.isChatInputCommand?.() ? `/${interaction.commandName}` : interaction?.type || "unknown";
          const guildId = String(interaction?.guildId || "-");
          const userId = String(interaction?.user?.id || interaction?.member?.user?.id || "-");
          log(
            "ERROR",
            `[${this.config.name}] interaction error command=${commandName} guild=${guildId} user=${userId}: ${err?.stack || err}`
          );
          try {
            if (!interaction.isRepliable || !interaction.isRepliable()) return;
            const { t } = this.createInteractionTranslator(interaction);
            const errorMessage = t(
              "Es ist ein Fehler aufgetreten. Bitte versuche es erneut.",
              "An error occurred. Please try again."
            );
            if (interaction.deferred || interaction.replied) {
              await interaction.editReply({ content: errorMessage });
            } else {
              await interaction.reply({ content: errorMessage, flags: MessageFlags.Ephemeral });
            }
          } catch {
            // ignore secondary reply failures
          }
      });
    });

    this.client.on("voiceStateUpdate", (oldState, newState) => {
      if (this.shuttingDown) return;
      this.handleBotVoiceStateUpdate(oldState, newState);
    });

    if (this.role === "commander") {
      this.client.on("guildCreate", (guild) => {
        this.handleGuildJoin(guild).then((allowed) => {
          if (!allowed) return;
          this.sendGuildOnboardingMessage(guild).catch((err) => {
            log("WARN", `[${this.config.name}] Onboarding-Nachricht fehlgeschlagen: ${err?.message || err}`);
          });
          if (this.isGuildCommandSyncEnabled()) {
            this.syncGuildCommands("join", { guildId: guild?.id }).catch((err) => {
              log("ERROR", `[${this.config.name}] Guild-Command-Sync (join) fehlgeschlagen: ${err?.message || err}`);
            });
          }
        }).catch((err) => {
          log("ERROR", `[${this.config.name}] guildCreate handling error: ${err?.message || err}`);
        });
      });
    }

    this.client.on("guildDelete", (guild) => {
      this.resetGuildRuntimeState(guild?.id);
    });
  }

  /**
   * The playback state of one server, created on first use.
   * @param {string} guildId
   * @returns {import("../lib/types.js").GuildPlaybackState}
   */
  getState(guildId) {
    if (!this.guildState.has(guildId)) {
      const savedVolume = getBotGuildVolume(this.config.id, guildId);
      const channelVolumes = getBotGuildChannelVolumes(this.config.id, guildId);
      const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play }
      });
      const defaultVoiceGuardConfig = buildResolvedVoiceGuardConfig({});
      const state = {
        player,
        connection: null,
        currentStationKey: null,
        currentStationName: null,
        desiredStationKey: null,
        desiredStationName: null,
        failoverActive: false,
        failoverStartedAt: 0,
        failoverReason: null,
        failoverFromStationKey: null,
        failoverFromStationName: null,
        failoverFailureStationKey: null,
        failoverFailureCount: 0,
        failoverFailureStartedAt: 0,
        failoverLastFailureAt: 0,
        streamGeneration: 0,
        failbackTimer: null,
        failbackAttempts: 0,
        failbackSuccessCount: 0,
        failbackNextProbeAt: 0,
        failbackLastProbeAt: 0,
        failbackLastResult: null,
        parkedReason: null,
        parkedAt: 0,
        parkedDetail: null,
        serverMuted: false,
        serverMutedAt: 0,
        lastStageSpeakerFixAt: 0,
        currentMeta: null,
        lastChannelId: null,
        volume: savedVolume ?? 100,
        volumePreferenceSet: savedVolume !== null,
        channelVolumes,
        currentProcess: null,
        streamStableTimer: null,
        streamHealthTimer: null,
        lastStreamErrorAt: null,
        lastHealthcheckFailureAt: null,
        reconnectCount: 0,
        lastReconnectAt: null,
        reconnectAttempts: 0,
        reconnectCircuitTripCount: 0,
        reconnectCircuitOpenUntil: 0,
        reconnectTimer: null,
        reconnectScheduledAt: 0,
        reconnectScheduledReason: null,
        reconnectScheduledDelayMs: 0,
        streamRestartTimer: null,
        streamRestartInFlight: false,
        streamRestartScheduledAt: 0,
        streamRestartScheduledReason: null,
        streamRestartScheduledDelayMs: 0,
        shouldReconnect: false,
        streamErrorCount: 0,
        idleRestartStreak: 0,
        lastIdleRestartAt: 0,
        lastStreamStartAt: null,
        lastProcessExitCode: null,
        lastProcessExitDetail: null,
        lastProcessExitAt: 0,
        lastNetworkFailureAt: 0,
        lastStreamEndReason: null,
        streamHealthStartedAt: 0,
        lastAudioPacketAt: 0,
        lastAudioHeardAt: 0,
        failoverWindowClearedForStream: false,
        ignoreNextIdleEvent: false,
        nowPlayingRefreshTimer: null,
        nowPlayingMessageId: null,
        nowPlayingChannelId: null,
        nowPlayingSignature: null,
        nowPlayingLastErrorAt: 0,
        voiceStatusText: "",
        voiceStatusChannelId: "",
        voiceStatusNeedsSync: false,
        lastVoiceStatusSyncAt: 0,
        lastVoiceStatusErrorAt: 0,
        activeScheduledEventId: null,
        activeScheduledEventStopAtMs: 0,
        transientVoiceIssues: {},
        voiceConnectInFlight: false,
        reconnectInFlight: false,
        voiceDisconnectObservedAt: 0,
        restoreBlockedUntil: 0,
        restoreBlockedAt: 0,
        restoreBlockCount: 0,
        restoreBlockReason: null,
        voiceGuardAvailable: true,
        voiceGuardPolicy: "default",
        voiceGuardEffectivePolicy: defaultVoiceGuardConfig.effectivePolicy,
        voiceGuardMoveConfirmations: defaultVoiceGuardConfig.defaults.moveConfirmations,
        voiceGuardReturnCooldownMs: defaultVoiceGuardConfig.defaults.returnCooldownMs,
        voiceGuardMoveWindowMs: defaultVoiceGuardConfig.defaults.moveWindowMs,
        voiceGuardMaxMovesPerWindow: defaultVoiceGuardConfig.defaults.maxMovesPerWindow,
        voiceGuardEscalation: defaultVoiceGuardConfig.defaults.escalation,
        voiceGuardEscalationCooldownMs: defaultVoiceGuardConfig.defaults.escalationCooldownMs,
        voiceGuardUnlockUntil: 0,
        voiceGuardCooldownUntil: 0,
        voiceGuardWindowStartedAt: 0,
        voiceGuardWindowMoveCount: 0,
        voiceGuardMoveCount: 0,
        voiceGuardReturnCount: 0,
        voiceGuardDisconnectCount: 0,
        voiceGuardEscalationCount: 0,
        voiceGuardLastAction: null,
        voiceGuardLastActionAt: 0,
        voiceGuardLastActionReason: null,
        voiceGuardLastExpectedChannelId: null,
        voiceGuardLastActualChannelId: null,
      };

      // Every player status change is a candidate for a new playback phase (#210).
      player.on("stateChange", () => {
        recordPlaybackPhase(this, guildId, state, "player");
      });

      player.on(AudioPlayerStatus.Idle, (oldState) => {
        if (this.shuttingDown) return;
        if (!shouldHandleRuntimeIdleEvent(state, oldState)) return;
        this.handleStreamEnd(guildId, state, "idle").catch((err) => {
          log("ERROR", `[${this.config.name}] handleStreamEnd idle failed: ${err?.message || err}`);
        });
      });

      player.on("error", (err) => {
        if (this.shuttingDown) return;
        state.lastStreamErrorAt = new Date().toISOString();
        log("ERROR", `[${this.config.name}] AudioPlayer error: ${err?.message || err}`);
        // Echtes Incident ins Owner-Dashboard (Stream-/FFmpeg-Fehler, Auto-Recovery folgt).
        recordRuntimeIncident({
          severity: "warning",
          source: this.config.name,
          message: `Stream-/FFmpeg-Fehler – Auto-Recovery aktiv: ${err?.message || err}`,
          resolved: false,
        }).catch(() => {});
        this.handleStreamEnd(guildId, state, "error").catch((streamErr) => {
          log("ERROR", `[${this.config.name}] handleStreamEnd error failed: ${streamErr?.message || streamErr}`);
        });
      });

      // Erholung nach Fehler: wenn nach einem Stream-Fehler wieder abgespielt wird,
      // ein aufgeloestes "recovered"-Incident melden (einmalig pro Fehler).
      player.on(AudioPlayerStatus.Playing, () => {
        if (this.shuttingDown) return;
        if (!state.lastStreamErrorAt) return;
        const errAt = new Date(state.lastStreamErrorAt).getTime();
        state.lastStreamErrorAt = null;
        if (!Number.isFinite(errAt) || (Date.now() - errAt) > 120000) return;
        recordRuntimeIncident({
          severity: "info",
          source: this.config.name,
          message: "Stream nach Fehler automatisch wiederhergestellt (auto-recovered).",
          resolved: true,
        }).catch(() => {});
      });

      this.guildState.set(guildId, state);
    }

    return this.guildState.get(guildId);
  }

  async runSerializedGuildOperation(guildId, _action, handler) {
    const normalizedGuildId = String(guildId || "").trim();
    if (!normalizedGuildId || typeof handler !== "function") {
      return typeof handler === "function" ? handler() : null;
    }
    if (!(this.guildOperationLocks instanceof Map)) {
      this.guildOperationLocks = new Map();
    }

    const previous = this.guildOperationLocks.get(normalizedGuildId) || Promise.resolve();
    let releaseCurrent = null;
    const current = new Promise((resolve) => {
      releaseCurrent = resolve;
    });
    this.guildOperationLocks.set(normalizedGuildId, current);

    try {
      await previous.catch(() => null);
      return await handler();
    } finally {
      if (this.guildOperationLocks.get(normalizedGuildId) === current) {
        this.guildOperationLocks.delete(normalizedGuildId);
      }
      try {
        releaseCurrent?.();
      } catch {
        // ignore
      }
    }
  }

  getNetworkRecoveryScope(guildId = null) {
    const runtimeKey = String(this.config.id || this.config.clientId || this.config.name || "runtime").trim() || "runtime";
    const normalizedGuildId = String(guildId || "").trim();
    return normalizedGuildId
      ? `${runtimeKey}:guild:${normalizedGuildId}`
      : `${runtimeKey}:global`;
  }

  getCachedGuildSettings(guildId) {
    const key = String(guildId || "").trim();
    if (!key) return {};
    const cached = this.guildSettingsCache.get(key);
    return cached?.value && typeof cached.value === "object" ? cached.value : {};
  }

  async loadGuildSettingsCached(guildId, { force = false, maxAgeMs = 30_000 } = {}) {
    const key = String(guildId || "").trim();
    if (!key) return {};
    const cached = this.guildSettingsCache.get(key);
    if (!force && cached && (Date.now() - cached.loadedAt) <= Math.max(0, Number(maxAgeMs || 0) || 0)) {
      return cached.value;
    }
    const value = await loadGuildSettings(key);
    this.guildSettingsCache.set(key, {
      loadedAt: Date.now(),
      value: value && typeof value === "object" ? value : {},
    });
    return this.guildSettingsCache.get(key)?.value || {};
  }

  invalidateGuildSettingsCache(guildId) {
    const key = String(guildId || "").trim();
    if (!key) return;
    this.guildSettingsCache.delete(key);
  }

  async refreshVoiceGuardSettings(guildId, { force = false } = {}) {
    const state = this.getState(guildId);
    const settings = await this.loadGuildSettingsCached(guildId, { force });
    const featureEnabled = serverHasCapability(guildId, "voice_guard");
    const resolved = buildResolvedVoiceGuardConfig(settings?.voiceGuard || {}, { featureEnabled });
    state.voiceGuardAvailable = resolved.available === true;
    state.voiceGuardPolicy = resolved.policy;
    state.voiceGuardEffectivePolicy = resolved.effectivePolicy;
    state.voiceGuardMoveConfirmations = resolved.defaults.moveConfirmations;
    state.voiceGuardReturnCooldownMs = resolved.defaults.returnCooldownMs;
    state.voiceGuardMoveWindowMs = resolved.defaults.moveWindowMs;
    state.voiceGuardMaxMovesPerWindow = resolved.defaults.maxMovesPerWindow;
    state.voiceGuardEscalation = resolved.defaults.escalation;
    state.voiceGuardEscalationCooldownMs = resolved.defaults.escalationCooldownMs;
    if (resolved.available !== true) {
      state.voiceGuardUnlockUntil = 0;
      state.voiceGuardCooldownUntil = 0;
    }
    return resolved;
  }

  async refreshVoiceGuardSettingsForGuild(guildId, { force = false } = {}) {
    const runtimes = new Set([this]);
    if (this.workerManager?.workers?.length) {
      for (const worker of this.workerManager.workers) {
        runtimes.add(worker);
      }
    }
    const results = [];
    for (const runtime of runtimes) {
      if (typeof runtime?.invalidateGuildSettingsCache === "function") {
        runtime.invalidateGuildSettingsCache(guildId);
      }
      if (typeof runtime?.refreshVoiceGuardSettings !== "function") {
        results.push(null);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      results.push(await runtime.refreshVoiceGuardSettings(guildId, { force }).catch(() => null));
    }
    return results;
  }

  getVoiceGuardRuntimeSummary(guildId) {
    const state = this.getState(guildId);
    const now = Date.now();
    const defaultVoiceGuardConfig = buildResolvedVoiceGuardConfig({});
    return {
      available: state.voiceGuardAvailable === true,
      policy: state.voiceGuardPolicy || "default",
      effectivePolicy: state.voiceGuardEffectivePolicy || defaultVoiceGuardConfig.effectivePolicy,
      unlocked: Number(state.voiceGuardUnlockUntil || 0) > now,
      unlockUntil: Number(state.voiceGuardUnlockUntil || 0) > 0 ? Number(state.voiceGuardUnlockUntil || 0) : 0,
      cooldownUntil: Number(state.voiceGuardCooldownUntil || 0) > 0 ? Number(state.voiceGuardCooldownUntil || 0) : 0,
      moveWindowCount: Math.max(0, Number(state.voiceGuardWindowMoveCount || 0) || 0),
      moveCount: Math.max(0, Number(state.voiceGuardMoveCount || 0) || 0),
      returnCount: Math.max(0, Number(state.voiceGuardReturnCount || 0) || 0),
      disconnectCount: Math.max(0, Number(state.voiceGuardDisconnectCount || 0) || 0),
      escalationCount: Math.max(0, Number(state.voiceGuardEscalationCount || 0) || 0),
      lastAction: state.voiceGuardLastAction || null,
      lastActionAt: Number(state.voiceGuardLastActionAt || 0) || 0,
      lastActionReason: state.voiceGuardLastActionReason || null,
      lastExpectedChannelId: state.voiceGuardLastExpectedChannelId || null,
      lastActualChannelId: state.voiceGuardLastActualChannelId || null,
      moveConfirmations: Math.max(1, Number(state.voiceGuardMoveConfirmations || 0) || 1),
      returnCooldownMs: Math.max(0, Number(state.voiceGuardReturnCooldownMs || 0) || 0),
      moveWindowMs: Math.max(0, Number(state.voiceGuardMoveWindowMs || 0) || 0),
      maxMovesPerWindow: Math.max(0, Number(state.voiceGuardMaxMovesPerWindow || 0) || 0),
      escalation: state.voiceGuardEscalation || null,
      escalationCooldownMs: Math.max(0, Number(state.voiceGuardEscalationCooldownMs || 0) || 0),
    };
  }

  setVoiceGuardTemporaryUnlock(guildId, durationMs, reason = "manual-unlock") {
    const state = this.getState(guildId);
    const safeDurationMs = Math.max(60_000, Math.min(24 * 60 * 60_000, Number(durationMs || 0) || 0));
    state.voiceGuardUnlockUntil = Date.now() + safeDurationMs;
    state.voiceGuardLastAction = "manual-unlock";
    state.voiceGuardLastActionAt = Date.now();
    state.voiceGuardLastActionReason = String(reason || "manual-unlock").trim() || "manual-unlock";
    this.persistState({ forceLog: false });
    return {
      unlockUntil: state.voiceGuardUnlockUntil,
      durationMs: safeDurationMs,
      label: formatVoiceGuardDurationMs(safeDurationMs),
    };
  }

  clearVoiceGuardTemporaryUnlock(guildId, reason = "manual-lock") {
    const state = this.getState(guildId);
    state.voiceGuardUnlockUntil = 0;
    state.voiceGuardLastAction = "manual-lock";
    state.voiceGuardLastActionAt = Date.now();
    state.voiceGuardLastActionReason = String(reason || "manual-lock").trim() || "manual-lock";
    this.persistState({ forceLog: false });
    return {
      unlockUntil: 0,
    };
  }

  async clearVoiceGuardTemporaryUnlockForGuild(guildId, reason = "manual-lock") {
    const runtimes = new Set([this]);
    if (this.workerManager?.workers?.length) {
      for (const worker of this.workerManager.workers) {
        runtimes.add(worker);
      }
    }
    const results = [];
    for (const runtime of runtimes) {
      if (typeof runtime?.clearVoiceGuardTemporaryUnlock !== "function") {
        results.push(null);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      results.push(await runtime.clearVoiceGuardTemporaryUnlock(guildId, reason).catch(() => null));
    }
    return results;
  }

  noteNetworkRecoveryFailure(guildId, source, detail = "") {
    networkRecoveryCoordinator.noteFailure(source, detail, {
      scope: this.getNetworkRecoveryScope(guildId),
    });
  }

  noteNetworkRecoverySuccess(guildId, source) {
    networkRecoveryCoordinator.noteSuccess(source, {
      scope: this.getNetworkRecoveryScope(guildId),
    });
  }

  getNetworkRecoveryDelayMs(guildId) {
    return networkRecoveryCoordinator.getRecoveryDelayMs({
      scope: this.getNetworkRecoveryScope(guildId),
    });
  }

  resetGuildRuntimeState(guildId) {
    if (!guildId) return;
    this.clearQueuedVoiceReconcile(guildId);
    const state = this.guildState.get(guildId);
    if (state) {
      this.invalidateVoiceStatus(state, { clearText: true });
    }
    this.syncVoiceChannelStatus(guildId, "").catch(() => null);
    if (state) {
      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      state.player.stop();
      this.clearCurrentProcess(state);
      if (state.connection) {
        try { state.connection.destroy(); } catch {}
      }
      this.guildState.delete(guildId);
    }
    // Fix: guildOperationLocks Memory Leak – beim Guild-Leave aufraumen
    if (this.guildOperationLocks instanceof Map) {
      this.guildOperationLocks.delete(guildId);
    }
    // Fix: guildSettingsCache beim Guild-Leave aufraumen
    if (this.guildSettingsCache instanceof Map) {
      this.guildSettingsCache.delete(guildId);
    }
    deleteScheduledEventsByFilter({ guildId, botId: this.config.id });
    clearBotGuild(this.config.id, guildId);
  }

  getCommandRegistrationMode() {
    return resolveCommandRegistrationMode(process.env);
  }

  async refreshCommandsOnReady() {
    const mode = this.getCommandRegistrationMode();
    const usesGuild = usesGuildCommandRegistration(mode);
    const usesGlobal = usesGlobalCommandRegistration(mode);

    log(
      "INFO",
      `[${this.config.name}] Command-Registrierungsmodus: ${mode} (guild=${usesGuild} global=${usesGlobal}).`
    );

    if (usesGlobal) {
      await this.syncGlobalCommands("startup");
    } else if (this.shouldCleanGlobalCommandsOnBoot()) {
      await this.clearGlobalCommands("startup-cleanup");
    }

    if (usesGuild) {
      if (this.isGuildCommandCleanupEnabled()) {
        log(
          "INFO",
          `[${this.config.name}] CLEAN_GUILD_COMMANDS_ON_BOOT=1 erkannt, Cleanup wird im Schutzmodus uebersprungen. Es erfolgt ein direkter Voll-Sync.`
        );
      }
      await this.syncGuildCommands("startup");
    } else if (this.shouldCleanGuildCommandsOnBoot()) {
      await this.cleanupGuildCommands();
    }
  }

  isGuildCommandSyncEnabled() {
    return usesGuildCommandRegistration(this.getCommandRegistrationMode());
  }

  isGlobalCommandSyncEnabled() {
    return usesGlobalCommandRegistration(this.getCommandRegistrationMode());
  }

  buildGuildCommandPayload() {
    return buildCommandBuilders().map((builder) => builder.toJSON());
  }

  getApplicationId() {
    return String(this.client.user?.id || this.config.clientId || "").trim();
  }

  shouldCleanGlobalCommandsOnBoot() {
    return String(process.env.CLEAN_GLOBAL_COMMANDS_ON_BOOT ?? "1") !== "0";
  }

  shouldCleanGuildCommandsOnBoot() {
    return String(process.env.CLEAN_GUILD_COMMANDS_ON_BOOT ?? "0") !== "0";
  }

  isGuildCommandCleanupEnabled() {
    if (!this.isGuildCommandSyncEnabled()) return false;
    return this.shouldCleanGuildCommandsOnBoot();
  }

  isWorkerGuildCommandCleanupEnabled() {
    return String(process.env.CLEAN_WORKER_GUILD_COMMANDS_ON_BOOT ?? "1") !== "0";
  }

  async syncGuildCommands(source = "sync", options = {}) {
    if (!this.isGuildCommandSyncEnabled()) return;
    const payload = this.buildGuildCommandPayload();
    const targetGuildIds = Array.isArray(options?.guildIds)
      ? options.guildIds
      : options?.guildId
        ? [options.guildId]
        : null;
    await syncGuildCommandsSafe({
      client: this.client,
      rest: this.rest,
      routes: Routes,
      commands: payload,
      guildIds: targetGuildIds,
      botToken: this.config.token,
      botLabel: `${this.config.name}`,
      source,
      logFn: (level, message) => log(level, message),
      fingerprints: this.commandFingerprints || defaultCommandFingerprintStore,
      force: options?.force === true,
    });
  }

  async syncGlobalCommands(source = "sync") {
    if (!this.isGlobalCommandSyncEnabled()) return;
    const applicationId = this.getApplicationId();
    if (!applicationId) {
      log("ERROR", `[${this.config.name}] Global-Command-Sync uebersprungen: Application ID fehlt.`);
      return;
    }
    const payload = this.buildGuildCommandPayload();
    log("INFO", `[${this.config.name}] Global-Command-Sync startet (source=${source}, commands=${payload.length}).`);
    await this.rest.put(Routes.applicationCommands(applicationId), { body: payload });
    log("INFO", `[${this.config.name}] Global-Command-Sync abgeschlossen (source=${source}).`);
  }

  async clearGlobalCommands(source = "cleanup") {
    if (!this.shouldCleanGlobalCommandsOnBoot()) return;
    const applicationId = this.getApplicationId();
    if (!applicationId) return;
    await this.rest.put(Routes.applicationCommands(applicationId), { body: [] }).catch((err) => {
      log("WARN", `[${this.config.name}] Global-Command-Cleanup fehlgeschlagen (source=${source}): ${err?.message || err}`);
    });
  }

  async clearGuildCommandsForWorker() {
    if (this.role !== "worker") return;
    if (!this.isWorkerGuildCommandCleanupEnabled()) return;
    const allGuildIds = [...this.client.guilds.cache.keys()];
    if (!allGuildIds.length) return;
    const applicationId = this.getApplicationId();
    if (!applicationId) return;
    // Servers already cleared in an earlier start need no PUT again (#215).
    const fingerprints = this.commandFingerprints || defaultCommandFingerprintStore;
    const known = await fingerprints.load(applicationId, allGuildIds).catch(() => new Map());
    const guildIds = allGuildIds.filter((guildId) => known.get(guildId) !== EMPTY_COMMANDS_HASH);
    if (!guildIds.length) {
      log("INFO", `[${this.config.name}] Worker-Guild-Commands bereits leer (Guilds: ${allGuildIds.length}).`);
      return;
    }
    const cleared = [];
    for (const guildId of guildIds) {
      // eslint-disable-next-line no-await-in-loop
      await this.rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] })
        .then(() => cleared.push(guildId))
        .catch((err) => {
          log("WARN", `[${this.config.name}] Worker-Command-Cleanup fehlgeschlagen fuer Guild ${guildId}: ${err?.message || err}`);
        });
    }
    await fingerprints.save(applicationId, cleared, EMPTY_COMMANDS_HASH).catch(() => null);
    log("INFO", `[${this.config.name}] Worker-Guild-Commands bereinigt (Guilds: ${cleared.length}/${guildIds.length}, schon leer: ${allGuildIds.length - guildIds.length}).`);
  }

  async clearCommandsForWorker() {
    if (this.role !== "worker") return;
    await this.clearGlobalCommands("worker-startup");
    await this.clearGuildCommandsForWorker();
  }

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
  }

  clearStreamStabilityTimer(state) {
    if (state.streamStableTimer) {
      clearTimeout(state.streamStableTimer);
      state.streamStableTimer = null;
    }
  }

  clearNowPlayingTimer(state) {
    if (state.nowPlayingRefreshTimer) {
      clearInterval(state.nowPlayingRefreshTimer);
      state.nowPlayingRefreshTimer = null;
    }
  }

  clearCurrentProcess(state) {
    return clearRuntimeCurrentProcess(this, state);
  }

  armStreamStabilityReset(guildId, state) {
    return armRuntimeStreamStabilityReset(this, guildId, state);
  }

  armFailbackProbe(guildId, state, options = {}) {
    return armRuntimeFailbackProbe(this, guildId, state, options);
  }

  runFailbackProbe(guildId, state) {
    return runRuntimeFailbackProbe(this, guildId, state);
  }

  trackProcessLifecycle(guildId, state, process) {
    return trackRuntimeProcessLifecycle(this, guildId, state, process);
  }

  scheduleStreamRestart(guildId, state, delayMs, reason = "restart") {
    return scheduleRuntimeStreamRestart(this, guildId, state, delayMs, reason);
  }

  armPlaybackRecovery(guildId, state, stations, key, err, options = {}) {
    return armRuntimePlaybackRecovery(this, guildId, state, stations, key, err, options);
  }

  async handleStreamEnd(guildId, state, reason) {
    return handleRuntimeStreamEnd(this, guildId, state, reason);
  }

  async playStation(state, stations, key, guildId, options = {}) {
    return playRuntimeStation(this, state, stations, key, guildId, options);
  }

  async restartCurrentStation(state, guildId) {
    return restartRuntimeCurrentStation(this, state, guildId);
  }

  async cleanupGuildCommands() {
    if (!this.isGuildCommandCleanupEnabled()) return;
    const applicationId = this.getApplicationId();
    if (!applicationId) {
      log("ERROR", `[${this.config.name}] Guild-Command-Cleanup uebersprungen: Application ID fehlt.`);
      return;
    }

    const guildIds = [...this.client.guilds.cache.keys()];
    if (!guildIds.length) return;

    let cleaned = 0;
    let failed = 0;
    log("INFO", `[${this.config.name}] Bereinige Guild-Commands in ${guildIds.length} Servern...`);

    const clearedGuildIds = [];
    for (const guildId of guildIds) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] });
        cleaned += 1;
        clearedGuildIds.push(guildId);
      } catch (err) {
        failed += 1;
        log(
          "ERROR",
          `[${this.config.name}] Guild-Command-Cleanup fehlgeschlagen (guild=${guildId}): ${err?.message || err}`
        );
      }
    }

    log(
      "INFO",
      `[${this.config.name}] Guild-Command-Cleanup fertig: ok=${cleaned}, failed=${failed}.`
    );
    // A later sync must write the list again into these servers (#215).
    await (this.commandFingerprints || defaultCommandFingerprintStore)
      .save(applicationId, clearedGuildIds, EMPTY_COMMANDS_HASH).catch(() => null);
  }

  async resolveBotMember(guild) {
    if (guild.members.me) return guild.members.me;
    return guild.members.fetchMe().catch(() => null);
  }

  handleBotVoiceStateUpdate(oldState, newState) {
    return handleRuntimeBotVoiceStateUpdate(this, oldState, newState);
  }

  resetVoiceSession(guildId, state, { preservePlaybackTarget = false, clearLastChannel = false } = {}) {
    return resetRuntimeVoiceSession(this, guildId, state, { preservePlaybackTarget, clearLastChannel });
  }

  clearRestoreRetry(guildId) {
    return clearRuntimeRestoreRetry(this, guildId);
  }

  clearQueuedVoiceReconcile(guildId) {
    return clearQueuedRuntimeVoiceReconcile(this, guildId);
  }

  queueVoiceStateReconcile(guildId, reason = "queued", delayMs = 1200) {
    return queueRuntimeVoiceStateReconcile(this, guildId, reason, delayMs);
  }

  async confirmBotVoiceChannel(guildId, expectedChannelId, { timeoutMs = 10_000, intervalMs = 800 } = {}) {
    return confirmRuntimeBotVoiceChannel(this, guildId, expectedChannelId, { timeoutMs, intervalMs });
  }

  async fetchBotVoiceState(guildId) {
    return fetchRuntimeBotVoiceState(this, guildId);
  }

  async reconcileGuildVoiceState(guildId, { reason = "periodic" } = {}) {
    return reconcileRuntimeGuildVoiceState(this, guildId, { reason });
  }

  async tickVoiceStateHealth() {
    return tickRuntimeVoiceStateHealth(this);
  }

  startVoiceStateReconciler() {
    return startRuntimeVoiceStateReconciler(this);
  }

  stopVoiceStateReconciler() {
    return stopRuntimeVoiceStateReconciler(this);
  }

  attachConnectionHandlers(guildId, connection) {
    return attachRuntimeConnectionHandlers(this, guildId, connection);
  }

  normalizeStationReference(...args) {
    return normalizeStationReference(this, ...args);
  }

  resolveStationForGuild(...args) {
    return resolveStationForGuild(this, ...args);
  }

  getResolvedCurrentStation(...args) {
    return getResolvedCurrentStation(this, ...args);
  }

  clearScheduledEventPlayback(...args) {
    return clearScheduledEventPlayback(this, ...args);
  }

  markScheduledEventPlayback(...args) {
    return markScheduledEventPlayback(this, ...args);
  }

  setScheduledEventPlaybackInGuild(...args) {
    return setScheduledEventPlaybackInGuild(this, ...args);
  }

  clearScheduledEventPlaybackInGuild(...args) {
    return clearScheduledEventPlaybackInGuild(this, ...args);
  }

  getScheduledEventEndAtMs(...args) {
    return getScheduledEventEndAtMs(this, ...args);
  }

  formatDiscordTimestamp(...args) {
    return formatDiscordTimestamp(this, ...args);
  }

  normalizeClearableText(...args) {
    return normalizeClearableText(this, ...args);
  }

  isScheduledEventStopDue(...args) {
    return isScheduledEventStopDue(this, ...args);
  }

  resolveGuildEmojiAliases(...args) {
    return resolveGuildEmojiAliases(this, ...args);
  }

  buildScheduledEventServerDescription(...args) {
    return buildScheduledEventServerDescription(this, ...args);
  }

  validateDiscordScheduledEventPermissions(...args) {
    return validateDiscordScheduledEventPermissions(this, ...args);
  }

  buildScheduledEventSummary(...args) {
    return buildScheduledEventSummary(this, ...args);
  }

  buildScheduledEventEmbed(...args) {
    return buildScheduledEventEmbed(this, ...args);
  }

  buildScheduledEventsListEmbed(...args) {
    return buildScheduledEventsListEmbed(this, ...args);
  }

  parseEventWindowInput(...args) {
    return parseEventWindowInput(this, ...args);
  }

  queueImmediateScheduledEventTick(...args) {
    return queueImmediateScheduledEventTick(this, ...args);
  }

  resolveGuildVoiceChannel(...args) {
    return resolveGuildVoiceChannel(this, ...args);
  }

  ensureStageChannelReady(...args) {
    return ensureStageChannelReady(this, ...args);
  }

  deleteDiscordScheduledEventById(...args) {
    return deleteDiscordScheduledEventById(this, ...args);
  }

  syncDiscordScheduledEvent(...args) {
    return syncDiscordScheduledEvent(this, ...args);
  }

  ensureVoiceConnectionForChannel(...args) {
    return ensureVoiceConnectionForChannel(this, ...args);
  }

  postScheduledEventAnnouncement(...args) {
    return postScheduledEventAnnouncement(this, ...args);
  }

  executeScheduledEvent(...args) {
    return executeScheduledEvent(this, ...args);
  }

  executeScheduledEventStop(...args) {
    return executeScheduledEventStop(this, ...args);
  }

  tickScheduledEvents(...args) {
    return tickScheduledEvents(this, ...args);
  }

  startEventScheduler(...args) {
    return startEventScheduler(this, ...args);
  }

  stopEventScheduler(...args) {
    return stopEventScheduler(this, ...args);
  }

  handleEventCommand(...args) {
    return handleEventCommand(this, ...args);
  }

  async tryReconnect(guildId) {
    return tryRuntimeReconnect(this, guildId);
  }

  handleNetworkRecovered(recoveryEvent = null) {
    return handleRuntimeNetworkRecovered(this, recoveryEvent);
  }

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
          message: `Voice-Reconnect wird ausgefuehrt (Guild ${guildId})${options?.reason ? ` – ${options.reason}` : ""}.`,
          resolved: false,
        }).catch(() => {});
      }
    } catch { /* noop */ }
    return scheduleRuntimeReconnect(this, guildId, options);
  }

  async handleAutocomplete(interaction) {
    return handleRuntimeAutocomplete(this, interaction);
  }

  async handleInteraction(interaction) {
    return handleRuntimeInteraction(this, interaction);
  }

  // ---- Programmatic Worker Control Methods (called by Commander) ----

  /**
   * Programmatic play - used by Commander to tell a Worker to stream.
   * Returns { ok, error? }
   */
  async playInGuild(guildId, channelId, stationKey, stationsData, volume = undefined, options = {}) {
    return BotRuntime.prototype.runSerializedGuildOperation.call(this, guildId, "play", async () => {
      const state = this.getState(guildId);
      try {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return { ok: false, error: "Worker ist nicht auf diesem Server." };

        if (typeof this.refreshVoiceGuardSettings === "function") {
          await this.refreshVoiceGuardSettings(guildId).catch(() => null);
        }
        this.clearRestoreRetry(guildId);
        const parsedVolume = Number.parseInt(String(volume ?? ""), 10);
        const savedChannelVolume = getBotGuildVolume(this.config.id, guildId, channelId);
        const resolvedVolume = Number.isFinite(parsedVolume)
          ? Math.max(0, Math.min(100, parsedVolume))
          : (savedChannelVolume !== null
            ? savedChannelVolume
            : (Number.isFinite(Number(state.volume)) ? Math.max(0, Math.min(100, Number(state.volume))) : 100));
        state.volume = resolvedVolume;
        state.volumePreferenceSet = true;
        state.channelVolumes = { ...(state.channelVolumes || {}), [channelId]: resolvedVolume };
        state.shouldReconnect = true;
        state.lastChannelId = channelId;
        if (options?.scheduledEventId) {
          this.markScheduledEventPlayback(state, options.scheduledEventId, options?.scheduledEventStopAtMs || 0);
        } else {
          this.clearScheduledEventPlayback(state);
        }

        const connectionInfo = await this.ensureVoiceConnectionForChannel(
          guildId,
          channelId,
          state,
          { source: options?.scheduledEventId ? "event" : "play" }
        );
        const { channel } = connectionInfo;

        if (channel.type === ChannelType.GuildStageVoice) {
          await this.ensureStageChannelReady(guild, channel, {
            topic: options?.stageTopic || null,
            guildScheduledEventId: options?.guildScheduledEventId || null,
            createInstance: options?.createStageInstance !== false,
            ensureSpeaker: true,
          });
        }

        await this.playStation(state, stationsData, stationKey, guildId, {
          countAsStart: true,
          resumeSession: false,
        });
        this.updatePresence();

        return { ok: true, workerName: this.config.name };
      } catch (err) {
        const isVoiceTimeout = String(err?.message || "").includes("Voice-Verbindung");
        if (isVoiceTimeout && state.lastChannelId) {
          log("WARN", `[${this.config.name}] playInGuild voice timeout: guild=${guildId} channel=${channelId} - scheduling reconnect`);
          state.shouldReconnect = true;
          state.currentStationKey = stationKey;
          state.currentStationName = stationsData?.stations?.[stationKey]?.name || stationKey;
          if (state.connection) {
            try { state.connection.destroy(); } catch {}
            state.connection = null;
          }
          this.scheduleReconnect(guildId, { resetAttempts: true, reason: "play-voice-timeout" });
          return {
            ok: true,
            workerName: this.config.name,
            recovering: true,
            error: err?.message || String(err),
          };
        }

        const recovery = this.armPlaybackRecovery(
          guildId,
          state,
          stationsData,
          stationKey,
          err,
          { reason: "play-start-failed" }
        );
        if (recovery.scheduled) {
          return {
            ok: true,
            workerName: this.config.name,
            recovering: true,
            error: recovery.message,
          };
        }
        this.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
        log("ERROR", `[${this.config.name}] playInGuild error: ${err?.message || err}`);
        return { ok: false, error: err?.message || String(err) };
      }
    });
  }

  /**
   * Programmatic stop - used by Commander to stop a Worker in a guild.
   */
  async stopInGuild(guildId) {
    return BotRuntime.prototype.runSerializedGuildOperation.call(this, guildId, "stop", async () => {
      const state = this.guildState.get(guildId);
      if (!state) return { ok: false, error: "Kein State für diesen Server." };

      this.clearRestoreRetry(guildId);
      state.shouldReconnect = false;
      this.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
      recordPlaybackPhase(this, guildId, state, "stop");

      return { ok: true };
    });
  }

  /**
   * Programmatic pause.
   */
  async pauseInGuild(guildId) {
    return BotRuntime.prototype.runSerializedGuildOperation.call(this, guildId, "pause", async () => {
      const state = this.guildState.get(guildId);
      if (!state?.currentStationKey) return { ok: false, error: "Es laeuft nichts." };
      state.player.pause(true);
      return { ok: true };
    });
  }

  /**
   * Programmatic resume.
   */
  async resumeInGuild(guildId) {
    return BotRuntime.prototype.runSerializedGuildOperation.call(this, guildId, "resume", async () => {
      const state = this.guildState.get(guildId);
      if (!state?.currentStationKey) return { ok: false, error: "Es laeuft nichts." };
      state.player.unpause();
      return { ok: true };
    });
  }

  /**
   * Programmatic volume set.
   */
  async setVolumeInGuild(guildId, value) {
    return BotRuntime.prototype.runSerializedGuildOperation.call(this, guildId, "set-volume", async () => {
      const parsedValue = Number.parseInt(String(value ?? ""), 10);
      if (!Number.isFinite(parsedValue)) {
        return { ok: false, error: "Ungueltige Lautstaerke." };
      }

      const normalizedValue = Math.max(0, Math.min(100, parsedValue));
      const state = this.getState(guildId);
      state.volume = normalizedValue;
      state.volumePreferenceSet = true;
      const channelId = String(state.connection?.joinConfig?.channelId || state.lastChannelId || "").trim();
      if (channelId) state.channelVolumes = { ...(state.channelVolumes || {}), [channelId]: normalizedValue };
      setBotGuildVolume(this.config.id, guildId, normalizedValue, channelId || null);

      const resource = state.player.state.resource;
      const appliedLive = applyVolumeTransformerLevel(resource?.volume, normalizedValue);

      this.persistState({ forceLog: false });
      if (state.currentStationKey && isRuntimePlaybackActive(this, guildId, state) && typeof this.updateNowPlayingEmbed === "function") {
        setTimeout(() => {
          this.updateNowPlayingEmbed(guildId, state, { force: true }).catch((err) => {
            log("WARN", `[${this.config.name}] Now-Playing-Update nach Lautstaerkewechsel fehlgeschlagen: ${err?.message || err}`);
          });
        }, 0);
      }
      return {
        ok: true,
        value: normalizedValue,
        appliedLive,
        playing: isRuntimePlaybackActive(this, guildId, state),
      };
    });
  }

  async start() {
    try {
      await this.client.login(this.config.token);
      return true;
    } catch (err) {
      this.startError = err;
      log("ERROR", `[${this.config.name}] Login fehlgeschlagen: ${err?.message || err}`);
      return false;
    }
  }

  // === State Persistence: Speichert aktuellen Zustand fuer Auto-Reconnect nach Restart ===
  persistState({ forceLog = false } = {}) {
    const persistableCount = [...this.guildState.entries()].filter(
      ([_, s]) => isPersistableGuildState(s)
    ).length;
    const activeCount = [...this.guildState.entries()].filter(
      ([guildId, s]) => isPersistableGuildState(s) && isRuntimeVoiceConnected(this, guildId, s, { includeObserved: true })
    ).length;
    saveBotState(this.config.id, this.guildState);
    const previousPersistableCount = Number.isFinite(this.lastPersistLoggedPersistableCount)
      ? this.lastPersistLoggedPersistableCount
      : null;
    const previousActiveCount = Number.isFinite(this.lastPersistLoggedActiveCount)
      ? this.lastPersistLoggedActiveCount
      : null;
    const shouldLog =
      forceLog
      || previousPersistableCount === null
      || previousPersistableCount !== persistableCount
      || previousActiveCount !== activeCount;
    this.lastPersistLoggedPersistableCount = persistableCount;
    this.lastPersistLoggedActiveCount = activeCount;
    if (shouldLog && (persistableCount > 0 || (previousPersistableCount || 0) > 0)) {
      log(
        "INFO",
        `[${this.config.name}] State gespeichert (${persistableCount} Wiederherstellungsziel(e), ${activeCount} aktive Verbindung(en)).`
      );
    }
  }

  async restoreState(stations) {
    return restoreRuntimeState(this, stations);
  }

  beginShutdown() {
    this.shuttingDown = true;
  }

  async stop() {
    this.beginShutdown();
    if (typeof this.unsubscribeNetworkRecovery === "function") {
      this.unsubscribeNetworkRecovery();
      this.unsubscribeNetworkRecovery = null;
    }
    this.stopEventScheduler();
    this.stopVoiceStateReconciler();
    this.stopListenerStatsSampler();
    const sessionStopPromises = [];

    for (const [guildId, state] of this.guildState.entries()) {
      const preservePlaybackTarget = Boolean(state.currentStationKey && state.lastChannelId);
      this.invalidateVoiceStatus(state, { clearText: true });
      this.syncVoiceChannelStatus(guildId, "").catch(() => null);
      // End all active listening sessions on shutdown
      if (state.currentStationKey) {
        sessionStopPromises.push(recordStationStop(guildId, { botId: this.config.id || "" }));
      }
      state.shouldReconnect = preservePlaybackTarget;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      state.player?.removeAllListeners?.(AudioPlayerStatus.Idle);
      state.player?.removeAllListeners?.("error");
      state.ignoreNextIdleEvent = true;
      state.player.stop();
      this.clearCurrentProcess(state);
      if (state.connection) {
        try { state.connection.destroy(); } catch { /* ignore */ }
        state.connection = null;
      }
      if (!preservePlaybackTarget) {
        state.currentStationKey = null;
        state.currentStationName = null;
        state.lastChannelId = null;
      }
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      state.streamErrorCount = 0;
    }

    if (sessionStopPromises.length) {
      await Promise.allSettled(sessionStopPromises);
    }

    this.persistState({ forceLog: false });

    try {
      this.client.destroy();
    } catch {
      // ignore
    }
  }
}

// Method groups that live in their own modules (#210).
Object.assign(
  BotRuntime.prototype,
  nowPlayingMethods,
  menuMethods,
  permissionMethods,
  statusMethods,
  voiceMethods,
  onboardingMethods,
);

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
};


export { BotRuntime };
