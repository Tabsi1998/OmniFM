import { Client, GatewayIntentBits, MessageFlags } from "discord.js";
import { REST } from "@discordjs/rest";
import { createAudioPlayer, NoSubscriberBehavior, AudioPlayerStatus } from "@discordjs/voice";
import { log } from "../lib/logging.js";
import { NowPlayingQueue } from "../lib/now-playing-queue.js";
import { networkRecoveryCoordinator } from "../core/network-recovery.js";
import { setNowPlayingQueue } from "../services/now-playing.js";
import {
  saveBotState,
  clearBotGuild,
  isPersistableGuildState,
  getBotGuildVolume,
  getBotGuildChannelVolumes,
} from "../bot-state.js";
import { recordStationStop } from "../listening-stats-store.js";
import { deleteScheduledEventsByFilter } from "../scheduled-events-store.js";
import { recordRuntimeIncident } from "../services/runtime-health-reporter.js";
import { buildResolvedVoiceGuardConfig } from "../lib/voice-guard.js";
import {
  handleCommanderGuildJoined,
  handleCommanderGuildLeft,
  startServerDataRetention,
} from "../services/server-data-retention.js";
import { startYearReviewService } from "../services/year-review.js";
import { startDiscordShopSync } from "../premium/discord-shop.js";
import { startChartsPostService } from "../services/charts.js";
import { isRuntimeVoiceConnected } from "./runtime-live-state.js";
import { handleRuntimeAutocomplete, handleRuntimeInteraction } from "./runtime-interactions.js";
import { shouldHandleRuntimeIdleEvent } from "./runtime-streams.js";
import { restoreRuntimeState } from "./runtime-recovery.js";
import { nowPlayingMethods } from "./now-playing/now-playing-methods.js";
import { nowPlayingStatsMethods } from "./now-playing/stats-methods.js";
import { nowPlayingEmbedMethods } from "./now-playing/embed-methods.js";
import { nowPlayingControlMethods } from "./now-playing/control-methods.js";
import { menuMethods } from "./runtime-methods/menus.js";
import { permissionMethods } from "./runtime-methods/permissions.js";
import { statusMethods } from "./runtime-methods/status.js";
import { voiceMethods } from "./runtime-methods/voice.js";
import { onboardingMethods } from "./runtime-methods/onboarding.js";
import { favoriteMethods } from "./runtime-methods/favorites.js";
import { formMethods } from "./runtime-methods/forms.js";
import { shareMethods } from "./runtime-methods/share.js";
import { savedSongMethods } from "./runtime-methods/saved-songs.js";
import { personalDataMethods } from "./runtime-methods/personal-data.js";
import { sleepMethods } from "./runtime-methods/sleep.js";
import { pollMethods } from "./runtime-methods/polls.js";
import { botProfileMethods } from "./runtime-methods/bot-profile.js";
import { recordPlaybackPhase } from "./playback-phase.js";
import { syncAppEmojisSafely } from "../discord/ui/app-emojis.js";
import { guildSettingsMethods } from "./runtime-methods/guild-settings.js";
import { commandSyncMethods } from "./runtime-methods/command-sync.js";
import { runtimeDelegateMethods } from "./runtime-methods/delegates.js";
import { playbackControlMethods } from "./runtime-methods/playback-control.js";
import { liveViewMethods } from "./runtime-methods/live-view.js";
import { yearReviewMethods } from "./runtime-methods/year-review.js";
import { suggestionMethods } from "./runtime-methods/suggestions.js";
import { reportMethods } from "./runtime-methods/reports.js";
import { easterEggMethods } from "./runtime-methods/easter-eggs.js";
import { jingleMethods } from "./runtime-methods/jingles.js";
import { listeningHourMethods } from "./runtime-methods/listening-hours.js";
import { startStationSuggestionService } from "../services/station-suggestions.js";
import { startProblemReportService } from "../services/problem-reports.js";
import { startLinkedRolesService } from "../services/linked-roles.js";

// Method groups that live in their own modules (#210) are assigned to
// BotRuntime.prototype at the end of this file. TypeScript sees them
// through this base class, which is empty at runtime (#298).
/**
 * @typedef {typeof guildSettingsMethods & typeof commandSyncMethods & typeof runtimeDelegateMethods & typeof playbackControlMethods & typeof nowPlayingStatsMethods & typeof nowPlayingEmbedMethods & typeof nowPlayingControlMethods & typeof nowPlayingMethods & typeof menuMethods & typeof permissionMethods & typeof statusMethods & typeof voiceMethods & typeof onboardingMethods & typeof favoriteMethods & typeof formMethods & typeof shareMethods & typeof savedSongMethods & typeof personalDataMethods & typeof sleepMethods & typeof pollMethods & typeof botProfileMethods & typeof liveViewMethods & typeof yearReviewMethods & typeof suggestionMethods & typeof reportMethods & typeof easterEggMethods & typeof jingleMethods & typeof listeningHourMethods} RuntimeMixins
 */
/** @type {new () => RuntimeMixins} */
const RuntimeMixinBase = /** @type {any} */ (class {});

class BotRuntime extends RuntimeMixinBase {
  constructor(config, { role = "worker", workerManager = null } = {}) {
    super();
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
    // The servers' jingles in memory and the full-hour clock (#309).
    this.jingleCache = new Map();
    this.jingleClockTimer = null;
    // Listening time per person, only with consent (#302).
    /** @type {Set<string> | null} */
    this.listeningConsents = null;
    this.listeningConsentsAt = 0;
    this.listeningCountedAt = 0;
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
        // Servers OmniFM left 30 days ago lose their data (#285).
        startServerDataRetention(this);
        // The months of the year review, before the sessions are gone (#301).
        startYearReviewService();
        // Premium bought in Discord becomes the server's license (#320).
        startDiscordShopSync(this);
        // The weekly OmniFM charts go to the owner's channel (#300).
        startChartsPostService(this);
        // Station suggestions: hourly stream checks, answers to the senders (#303).
        startStationSuggestionService(this);
        // Problems, ideas and feedback go to the private team channel (#436).
        startProblemReportService(this);
        // Linked roles: values to Discord, the premium role in the support server (#302).
        startLinkedRolesService(this);
        this.enforcePremiumGuildScope("startup").catch((err) => {
          log("ERROR", `[${this.config.name}] Premium-Guild-Scope Prüfung fehlgeschlagen: ${err?.message || err}`);
        });
        this.refreshCommandsOnReady().catch((err) => {
          log("ERROR", `[${this.config.name}] Command-Registrierung fehlgeschlagen: ${err?.message || err}`);
        });
        this.startEventScheduler();
        this.startListenerStatsSampler();
        // Servers that left Ultimate get the default bot look back (#280).
        this.startBotProfileDowngradeWatcher();
        // Station polls that ran during a restart are evaluated now (#274).
        this.restoreStationPolls().catch((err) => {
          log("WARN", `[${this.config.name}] Umfragen konnten nicht wieder aufgenommen werden: ${err?.message || err}`);
        });
      } else {
        this.clearCommandsForWorker().catch((err) => {
          log("ERROR", `[${this.config.name}] Worker-Command-Cleanup fehlgeschlagen: ${err?.message || err}`);
        });
      }
      this.startVoiceStateReconciler();
      this.startJingleClock();
    });

    // Slash commands belong to the commander, but component interactions are
    // delivered to the application that created the message. Worker-owned
    // now-playing messages therefore have to be handled by the worker itself.
    this.client.on("interactionCreate", (interaction) => {
      const isComponent = interaction?.isButton?.() || interaction?.isStringSelectMenu?.() || interaction?.isModalSubmit?.();
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
          // Back on a server within its 30 days: its data stays (#285).
          handleCommanderGuildJoined(guild?.id).catch(() => null);
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
      if (this.role === "commander") {
        // Removed from the server: its owner hears when the data goes (#285).
        handleCommanderGuildLeft(this, guild).catch((err) => {
          log("WARN", `[${this.config.name}] Entfernen von ${guild?.id} nicht vermerkt: ${err?.message || err}`);
        });
      }
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
        sleepUntilMs: 0,
        sleepTimers: null,
        sleepWarning: null,
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
      // ein aufgelöstes "recovered"-Incident melden (einmalig pro Fehler).
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
    // The bot left the server: nothing of it stays, not even the volume (#285).
    clearBotGuild(this.config.id, guildId, { keepVolume: false });
  }

  async handleAutocomplete(interaction) {
    return handleRuntimeAutocomplete(this, interaction);
  }

  async handleInteraction(interaction) {
    return handleRuntimeInteraction(this, interaction);
  }

  // ---- Programmatic Worker Control Methods (called by Commander) ----

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

  // === State Persistence: Speichert aktuellen Zustand für Auto-Reconnect nach Restart ===
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
    this.stopJingleClock();
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
  guildSettingsMethods,
  commandSyncMethods,
  runtimeDelegateMethods,
  playbackControlMethods,
  nowPlayingStatsMethods,
  nowPlayingEmbedMethods,
  nowPlayingControlMethods,
  nowPlayingMethods,
  menuMethods,
  permissionMethods,
  statusMethods,
  voiceMethods,
  onboardingMethods,
  favoriteMethods,
  formMethods,
  shareMethods,
  savedSongMethods,
  personalDataMethods,
  sleepMethods,
  pollMethods,
  botProfileMethods,
  liveViewMethods,
  yearReviewMethods,
  suggestionMethods,
  reportMethods,
  easterEggMethods,
  jingleMethods,
  listeningHourMethods,
);

export { BotRuntime };
