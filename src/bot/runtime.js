// ============================================================
// OmniFM: BotRuntime Class
// ============================================================
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  Client,
  GatewayIntentBits,
  ChannelType,
  PermissionsBitField,
  PermissionFlagsBits,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  StringSelectMenuBuilder,
  ButtonStyle,
  Events,
  ActivityType,
  Routes,
  GuildScheduledEventPrivacyLevel,
  GuildScheduledEventEntityType,
  MessageFlags,
} from "discord.js";
import { REST } from "@discordjs/rest";
import {
  joinVoiceChannel,
  createAudioPlayer,
  NoSubscriberBehavior,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";

import { log } from "../lib/logging.js";
import {
  resolveCommandRegistrationMode,
  usesGlobalCommandRegistration,
  usesGuildCommandRegistration,
} from "../discord/commandRegistrationMode.js";
import { expandDiscordEmojiAliases } from "../lib/discord-emojis.js";
import { NowPlayingQueue } from "../lib/now-playing-queue.js";
import { buildNowPlayingSignature, getNowPlayingCandidateIds } from "../lib/now-playing-target.js";
import {
  TIERS,
  TIER_RANK,
  clipText,
  applyVolumeTransformerLevel,
  applyJitter,
  buildTranscodeProfile,
  isWithinWorkerPlanLimit,
  splitTextForDiscord,
  sanitizeUrlForLog,
  NOW_PLAYING_ENABLED,
  NOW_PLAYING_POLL_MS,
  SONG_HISTORY_ENABLED,
  SONG_HISTORY_MAX_PER_GUILD,
  SONG_HISTORY_DEDUPE_WINDOW_MS,
  EVENT_SCHEDULER_ENABLED,
  EVENT_SCHEDULER_POLL_MS,
  EVENT_SCHEDULER_RETRY_MS,
  normalizeDuration,
  isValidEmailAddress,
  calculatePrice,
  calculateUpgradePrice,
  durationPricingInEuro,
  formatEuroCentsDe,
  sanitizeOfferCode,
  translateOfferReason,
  isProTrialEnabled,
  NOW_PLAYING_COVER_ENABLED,
} from "../lib/helpers.js";
import {
  resolveLanguageFromDiscordLocale,
  languagePick,
  translatePermissionStoreMessage,
  translateScheduledEventStoreMessage,
  translateCustomStationErrorMessage,
  getFeatureRequirementMessage,
} from "../lib/language.js";
import {
  REPEAT_MODES,
  EVENT_TIME_ZONE_SUGGESTIONS,
  EVENT_FALLBACK_TIME_ZONE,
  buildEventDateTimeFromParts,
  formatDateTime,
  normalizeRepeatMode,
  getRepeatLabel,
  normalizeEventTimeZone,
  isWorkdayInTimeZone,
  buildDiscordScheduledEventRecurrenceRule,
  computeNextEventRunAtMs,
  renderEventAnnouncement,
  renderStageTopic,
} from "../lib/event-time.js";
import { networkRecoveryCoordinator } from "../core/network-recovery.js";
import {
  fetchStreamSnapshot,
  setNowPlayingQueue,
  normalizeTrackSearchText,
} from "../services/now-playing.js";
import { loadStations, normalizeKey, resolveStation, getFallbackKey, filterStationsByTier, buildScopedStationsData } from "../stations-store.js";
import {
  saveBotState,
  clearBotGuild,
  isPersistableGuildState,
  setBotGuildVolume,
  getBotGuildVolume,
} from "../bot-state.js";
import {
  addCustomStation,
  removeCustomStation,
  listCustomStations,
  getGuildStations,
  addGuildStation,
  removeGuildStation,
  countGuildStations,
  MAX_STATIONS_PER_GUILD,
  buildCustomStationReference,
  parseCustomStationReference,
  validateCustomStationUrl,
} from "../custom-stations.js";
import { getTier, checkFeatureAccess, getMaxBots, requireFeature, getServerPlanConfig, serverHasCapability } from "../core/entitlements.js";
import {
  getCommandPermission,
  setCommandPermission,
  removeCommandPermission,
  listCommandPermissions,
  resetCommandPermissions,
  getGuildCommandPermissionRules,
  getSupportedPermissionCommands,
  setCommandRolePermission,
  removeCommandRolePermission,
  evaluateCommandPermission,
} from "../command-permissions-store.js";
import {
  getPermissionCommandChoices,
  normalizePermissionCommandName,
  isPermissionManagedCommand,
} from "../config/command-permissions.js";
import {
  getGuildLanguage,
  setGuildLanguage,
  resetGuildLanguage,
} from "../guild-language-store.js";
import {
  addSongEntry,
  getHistory as getGuildSongHistory,
  appendSongHistory,
  getSongHistory,
} from "../song-history-store.js";
import {
  recordCommandUsage,
  recordStationStop,
  recordGuildListenerSample,
  recordSessionListenerSample,
  recordConnectionEvent,
  getGuildListeningStats,
  getTopGuildsByActivity,
  getActiveSessionsForGuild,
} from "../listening-stats-store.js";
import {
  listAllEvents,
  addEvent,
  removeEvent,
  updateEventRunAtMs,
  getEvent,
  listScheduledEvents,
  createScheduledEvent,
  deleteScheduledEvent,
  patchScheduledEvent,
  getScheduledEvent,
  deleteScheduledEventsByFilter,
} from "../scheduled-events-store.js";
import { PLANS, BRAND } from "../config/plans.js";
import { normalizeLanguage, getDefaultLanguage } from "../i18n.js";
import { buildVoiceChannelAccessMessage } from "../lib/user-facing-setup.js";
import { premiumStationEmbed, customStationEmbed, botLimitEmbed } from "../ui/upgradeEmbeds.js";
import { syncGuildCommandsSafe } from "../discord/syncGuildCommandsSafe.js";
import { buildCommandBuilders } from "../commands.js";
import { buildInviteUrl } from "../bot-config.js";
import { loadGuildSettings } from "../lib/guild-settings.js";
import {
  buildResolvedVoiceGuardConfig,
  formatVoiceGuardDurationMs,
} from "../lib/voice-guard.js";
import {
  getLicenseById,
  linkServerToLicense,
  unlinkServerFromLicense,
  getServerLicense,
} from "../premium-store.js";
import {
  previewCheckoutOffer,
} from "../coupon-store.js";
import {
  DASHBOARD_URL,
  WEBSITE_URL,
  SUPPORT_URL,
  INVITE_COMPONENT_PREFIX,
  INVITE_COMPONENT_ID_OPEN,
  INVITE_COMPONENT_ID_REFRESH,
  INVITE_COMPONENT_ID_SELECT,
  INVITE_COMPONENT_ID_CLOSE,
  WORKERS_COMPONENT_PREFIX,
  WORKERS_COMPONENT_ID_OPEN,
  WORKERS_COMPONENT_ID_REFRESH,
  WORKERS_COMPONENT_ID_PAGE_PREFIX,
  PLAY_COMPONENT_PREFIX,
  PLAY_COMPONENT_ID_OPEN,
  STATIONS_COMPONENT_PREFIX,
  STATIONS_COMPONENT_ID_OPEN,
  withLanguageParam,
} from "./runtime-links.js";
import {
  buildRuntimeHelpMessage,
  buildRuntimeSetupMessagePayload,
  buildRuntimeWorkersStatusPayload,
} from "./runtime-message-builders.js";
import { buildRuntimePresenceActivity } from "./runtime-presence.js";
import {
  handleRuntimePanelInteraction,
} from "./runtime-panels.js";
import {
  getRuntimeConnectedChannelId,
  isRuntimePlaybackActive,
  isRuntimeVoiceConnected,
} from "./runtime-live-state.js";
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
import {
  handleRuntimeAutocomplete,
  handleRuntimeInteraction,
} from "./runtime-interactions.js";
import {
  clearRuntimeCurrentProcess,
  armRuntimeStreamStabilityReset,
  trackRuntimeProcessLifecycle,
  scheduleRuntimeStreamRestart,
  armRuntimePlaybackRecovery,
  handleRuntimeStreamEnd,
  playRuntimeStation,
  restartRuntimeCurrentStation,
} from "./runtime-streams.js";
import {
  resolveRuntimeGuildVoiceChannel,
  ensureRuntimeStageChannelReady,
  ensureRuntimeVoiceConnectionForChannel,
} from "./runtime-voice.js";
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

// Helper: wraps getServerPlanConfig + adds 'tier' alias for backward compatibility
function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

// Helper: wraps getServerLicense for backward compatibility
function getLicense(guildId) {
  return getServerLicense(guildId);
}

function toPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? fallbackValue), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

const VOICE_CHANNEL_STATUS_ENABLED = String(process.env.VOICE_CHANNEL_STATUS_ENABLED ?? "1") !== "0";
const VOICE_CHANNEL_STATUS_TEMPLATE =
  String(process.env.VOICE_CHANNEL_STATUS_TEMPLATE || "\uD83D\uDD0A | 24/7 {station}").trim()
  || "\uD83D\uDD0A | 24/7 {station}";
const VOICE_CHANNEL_STATUS_MAX_LENGTH = Math.max(1, Math.min(100, toPositiveInt(process.env.VOICE_CHANNEL_STATUS_MAX_LENGTH, 80)));
const VOICE_CHANNEL_STATUS_REFRESH_MS = Math.max(60_000, toPositiveInt(process.env.VOICE_CHANNEL_STATUS_REFRESH_MS, 15 * 60_000));
const ONBOARDING_MESSAGE_ENABLED = String(process.env.ONBOARDING_MESSAGE_ENABLED ?? "1") !== "0";
const LISTENER_STATS_POLL_MS = Math.max(15_000, toPositiveInt(process.env.LISTENER_STATS_POLL_MS, 30_000));
const PREMIUM_GUILD_ACCESS_MODE = String(process.env.PREMIUM_GUILD_ACCESS_MODE || "restrict").trim().toLowerCase() === "leave"
  ? "leave"
  : "restrict";


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

    // Only commander handles interactions (slash commands)
    if (this.role === "commander") {
      this.client.on("interactionCreate", (interaction) => {
        this.handleInteraction(interaction).catch(async (err) => {
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
    }

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

  getState(guildId) {
    if (!this.guildState.has(guildId)) {
      const savedVolume = getBotGuildVolume(this.config.id, guildId);
      const player = createAudioPlayer({
        behaviors: { noSubscriber: NoSubscriberBehavior.Play }
      });
      const defaultVoiceGuardConfig = buildResolvedVoiceGuardConfig({});
      const state = {
        player,
        connection: null,
        currentStationKey: null,
        currentStationName: null,
        currentMeta: null,
        lastChannelId: null,
        volume: savedVolume ?? 100,
        volumePreferenceSet: savedVolume !== null,
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

      player.on(AudioPlayerStatus.Idle, () => {
        if (this.shuttingDown) return;
        if (state.ignoreNextIdleEvent === true) {
          state.ignoreNextIdleEvent = false;
          return;
        }
        this.handleStreamEnd(guildId, state, "idle").catch((err) => {
          log("ERROR", `[${this.config.name}] handleStreamEnd idle failed: ${err?.message || err}`);
        });
      });

      player.on("error", (err) => {
        if (this.shuttingDown) return;
        state.lastStreamErrorAt = new Date().toISOString();
        log("ERROR", `[${this.config.name}] AudioPlayer error: ${err?.message || err}`);
        this.handleStreamEnd(guildId, state, "error").catch((streamErr) => {
          log("ERROR", `[${this.config.name}] handleStreamEnd error failed: ${streamErr?.message || streamErr}`);
        });
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

  pruneInteractiveUiSessions(now = Date.now()) {
    if (!(this.interactiveUiSessions instanceof Map)) {
      this.interactiveUiSessions = new Map();
      return;
    }
    for (const [sessionId, session] of this.interactiveUiSessions.entries()) {
      if (!session || Number(session.expiresAt || 0) <= now) {
        this.interactiveUiSessions.delete(sessionId);
      }
    }
  }

  createInteractiveUiSession(type, {
    guildId = null,
    userId = null,
    ttlMs = 15 * 60_000,
    data = {},
  } = {}) {
    this.pruneInteractiveUiSessions();
    const createdAt = Date.now();
    const id = `${createdAt.toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const session = {
      id,
      type: String(type || "").trim(),
      guildId: String(guildId || "").trim() || null,
      userId: String(userId || "").trim() || null,
      data: data && typeof data === "object" ? { ...data } : {},
      createdAt,
      updatedAt: createdAt,
      expiresAt: createdAt + Math.max(30_000, Number(ttlMs) || 0),
    };
    this.interactiveUiSessions.set(id, session);
    return session;
  }

  getInteractiveUiSession(sessionId, {
    type = null,
    guildId = null,
    userId = null,
  } = {}) {
    this.pruneInteractiveUiSessions();
    const normalizedId = String(sessionId || "").trim();
    if (!normalizedId) return null;
    const session = this.interactiveUiSessions.get(normalizedId);
    if (!session) return null;
    if (type && session.type !== String(type)) return null;
    if (guildId && session.guildId !== String(guildId)) return null;
    if (userId && session.userId && session.userId !== String(userId)) return null;
    return session;
  }

  updateInteractiveUiSession(sessionId, patch = {}) {
    const session = this.getInteractiveUiSession(sessionId);
    if (!session) return null;
    const nextData = patch.data && typeof patch.data === "object"
      ? { ...session.data, ...patch.data }
      : session.data;
    const updated = {
      ...session,
      ...patch,
      data: nextData,
      updatedAt: Date.now(),
    };
    this.interactiveUiSessions.set(session.id, updated);
    return updated;
  }

  deleteInteractiveUiSession(sessionId) {
    const normalizedId = String(sessionId || "").trim();
    if (!normalizedId) return false;
    return this.interactiveUiSessions.delete(normalizedId);
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
  }

  isPremiumOnlyBot() {
    const requiredTier = String(this.config.requiredTier || "free").toLowerCase();
    return requiredTier !== "free";
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

  getGuildAccessEnforcementMode() {
    return PREMIUM_GUILD_ACCESS_MODE;
  }

  restrictGuildAccess(guildId) {
    if (!guildId) return;
    const state = this.guildState.get(guildId);
    if (state) {
      state.shouldReconnect = false;
      this.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
      return;
    }
    clearBotGuild(this.config.id, guildId);
  }

  async enforceGuildAccessForGuild(guild, source = "scope") {
    if (!this.isPremiumOnlyBot()) return true;
    if (!guild?.id) return false;

    const access = this.getGuildAccess(guild.id);
    if (access.allowed) return true;

    const reason = !access.tierAllowed ? "tier" : "maxBots";
    const context = `reason=${reason}, source=${source}, guildTier=${access.guildTier}, required=${access.requiredTier}, botIndex=${access.botIndex}, workerSlot=${access.workerSlot || "-"}, maxBots=${access.maxBots}`;
    const mode = this.getGuildAccessEnforcementMode();
    if (mode !== "leave") {
      log(
        "WARN",
        `[${this.config.name}] Guild-Zugriff verweigert fuer ${guild.name} (${guild.id}) - Runtime gestoppt, Auto-Leave deaktiviert (mode=${mode}; ${context}).`
      );
      this.restrictGuildAccess(guild.id);
      return false;
    }

    log(
      "WARN",
      `[${this.config.name}] Verlasse Guild ${guild.name} (${guild.id}) - Zugriff verweigert (${context}, mode=${mode})`
    );
    this.resetGuildRuntimeState(guild.id);
    try {
      await guild.leave();
    } catch (err) {
      log("ERROR", `[${this.config.name}] Konnte Guild ${guild.id} nicht verlassen: ${err?.message || err}`);
    }
    return false;
  }

  async enforcePremiumGuildScope(source = "scope") {
    if (!this.isPremiumOnlyBot()) return;
    for (const guild of this.client.guilds.cache.values()) {
      // eslint-disable-next-line no-await-in-loop
      await this.enforceGuildAccessForGuild(guild, source);
    }
  }

  async handleGuildJoin(guild) {
    return this.enforceGuildAccessForGuild(guild, "join");
  }

  canSendOnboardingToChannel(channel, me) {
    if (!channel) return false;
    if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) return false;
    if (!me) return false;
    const perms = channel.permissionsFor(me);
    return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages));
  }

  async resolveOnboardingChannel(guild) {
    if (!guild) return null;
    const me = await this.resolveBotMember(guild);
    if (!me) return null;
    const systemChannel = guild.systemChannel || null;
    if (this.canSendOnboardingToChannel(systemChannel, me)) {
      return systemChannel;
    }

    if (!guild.channels?.cache?.size) {
      await guild.channels.fetch().catch(() => null);
    }

    const textChannels = [...guild.channels.cache.values()].filter((channel) => {
      return this.canSendOnboardingToChannel(channel, me);
    });
    if (!textChannels.length) return null;

    const scoreChannel = (channel) => {
      const name = String(channel.name || "").toLowerCase();
      let score = 0;
      if (name.includes("system")) score += 400;
      if (name.includes("mod") || name.includes("moderator")) score += 320;
      if (name.includes("admin") || name.includes("staff")) score += 300;
      if (name.includes("setup") || name.includes("config")) score += 280;
      if (name.includes("bot") || name.includes("command") || name.includes("kommando")) score += 220;
      if (name.includes("general") || name.includes("allgemein")) score += 150;
      score -= Number(channel.rawPosition || 0);
      return score;
    };

    textChannels.sort((a, b) => scoreChannel(b) - scoreChannel(a));
    return textChannels[0] || null;
  }

  buildSetupMessagePayload({ guild = null, language = null, guildId = null } = {}) {
    return buildRuntimeSetupMessagePayload(this, { guild, language, guildId });
  }

  buildOnboardingMessagePayload(guild) {
    const language = this.resolveGuildLanguage(guild?.id);
    return this.buildSetupMessagePayload({ guild, language, guildId: guild?.id });
  }

  buildSetupMessage(interaction) {
    return this.buildSetupMessagePayload({
      guild: interaction?.guild || null,
      language: this.resolveInteractionLanguage(interaction),
      guildId: interaction?.guildId,
    });
  }

  async sendGuildOnboardingMessage(guild) {
    if (!ONBOARDING_MESSAGE_ENABLED) return;
    if (!guild?.id) return;

    const channel = await this.resolveOnboardingChannel(guild);
    if (!channel) return;
    const payload = this.buildOnboardingMessagePayload(guild);
    await channel.send(payload);
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
    const guildIds = [...this.client.guilds.cache.keys()];
    if (!guildIds.length) return;
    const applicationId = this.getApplicationId();
    if (!applicationId) return;
    for (const guildId of guildIds) {
      // eslint-disable-next-line no-await-in-loop
      await this.rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] }).catch((err) => {
        log("WARN", `[${this.config.name}] Worker-Command-Cleanup fehlgeschlagen fuer Guild ${guildId}: ${err?.message || err}`);
      });
    }
    log("INFO", `[${this.config.name}] Worker-Guild-Commands bereinigt (Guilds: ${guildIds.length}).`);
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

  stopListenerStatsSampler() {
    if (this.listenerStatsTimer) {
      clearInterval(this.listenerStatsTimer);
      this.listenerStatsTimer = null;
    }
  }

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
  }

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
  }

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
  }

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
  }

  logNowPlayingIssue(guildId, state, message) {
    const now = Date.now();
    const cooldownMs = 120_000;
    if (state.nowPlayingLastErrorAt && now - state.nowPlayingLastErrorAt < cooldownMs) return;
    state.nowPlayingLastErrorAt = now;
    log("INFO", `[${this.config.name}] NowPlaying guild=${guildId}: ${message}`);
  }

  markNowPlayingTargetDirty(state, preferredChannelId = null) {
    const normalizedPreferredChannelId = String(preferredChannelId || "").trim();
    const currentTargetChannelId = String(state?.nowPlayingChannelId || "").trim();
    if (normalizedPreferredChannelId && currentTargetChannelId === normalizedPreferredChannelId) {
      return false;
    }

    state.nowPlayingMessageId = null;
    state.nowPlayingSignature = null;
    if (!normalizedPreferredChannelId || currentTargetChannelId !== normalizedPreferredChannelId) {
      state.nowPlayingChannelId = null;
    }
    return true;
  }

  canSendNowPlayingToChannel(channel, me) {
    if (!channel || typeof channel.send !== "function") return false;
    if (!me) return false;
    if (channel.isThread?.() && channel.archived) return false;
    const perms = channel.permissionsFor?.(me);
    return Boolean(perms?.has(PermissionFlagsBits.ViewChannel) && perms?.has(PermissionFlagsBits.SendMessages));
  }

  async fetchGuildChannelById(guild, channelId) {
    const normalizedChannelId = String(channelId || "").trim();
    if (!normalizedChannelId) return null;
    return guild.channels.cache.get(normalizedChannelId)
      || await guild.channels.fetch(normalizedChannelId).catch(() => null);
  }

  scoreNowPlayingFallbackChannel(channel) {
    const name = String(channel?.name || "").toLowerCase();
    let score = 0;
    if (name.includes("now-playing") || name.includes("nowplaying")) score += 500;
    if (name.includes("music") || name.includes("radio") || name.includes("musik")) score += 420;
    if (name.includes("bot") || name.includes("command") || name.includes("kommando")) score += 260;
    if (name.includes("general") || name.includes("allgemein")) score += 180;
    if (channel?.type === ChannelType.GuildText || channel?.type === ChannelType.GuildAnnouncement) score += 120;
    score -= Number(channel?.rawPosition || 0);
    return score;
  }

  normalizeNowPlayingValue(value, station, meta = null, maxLength = 240) {
    const normalized = clipText(String(value || "").trim(), maxLength);
    if (!normalized) return null;

    const lower = normalized.toLowerCase();
    const blockedValues = new Set(["-", "--", "n/a", "na", "none", "null", "undefined", "unknown"]);
    if (blockedValues.has(lower)) return null;

    const knownStationTexts = [
      station?.name,
      meta?.name,
      meta?.description,
    ]
      .map((item) => String(item || "").trim().toLowerCase())
      .filter(Boolean);

    if (knownStationTexts.includes(lower)) return null;
    return normalized;
  }

  isFreshNowPlayingTrack(meta) {
    const detectedAtMs = Number.parseInt(String(meta?.trackDetectedAtMs || 0), 10);
    if (!Number.isFinite(detectedAtMs) || detectedAtMs <= 0) return false;
    return (Date.now() - detectedAtMs) <= (NOW_PLAYING_POLL_MS * 4);
  }

  buildTrackSearchQuery(station, meta) {
    const artist = normalizeTrackSearchText(this.normalizeNowPlayingValue(meta?.artist, station, meta, 100));
    const title = normalizeTrackSearchText(this.normalizeNowPlayingValue(meta?.title, station, meta, 120));
    const displayTitle = normalizeTrackSearchText(this.normalizeNowPlayingValue(meta?.displayTitle || meta?.streamTitle, station, meta, 180));
    const query = artist && title ? `${artist} ${title}` : displayTitle;
    return clipText(query || "", 180) || null;
  }

  buildTrackLinkComponentsLegacy(guildId, station, meta) {
    const query = this.buildTrackSearchQuery(station, meta);
    if (!query) return [];

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("▶ YouTube")
        .setEmoji("\u25b6")
        .setURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("♫ Spotify")
        .setURL(`https://open.spotify.com/search/${encodeURIComponent(query)}`)
    );

    return [row];
  }

  buildTrackLinkComponents(guildId, station, meta) {
    const query = this.buildTrackSearchQuery(station, meta);
    if (!query) return [];
    const language = this.resolveGuildLanguage(guildId);
    const isDe = language === "de";

    const buttons = [
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(isDe ? "YouTube-Suche" : "YouTube search")
        .setURL(`https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`)
        .setEmoji("\u{1f4fa}"),
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel(isDe ? "Spotify-Suche" : "Spotify search")
        .setURL(`https://open.spotify.com/search/${encodeURIComponent(query)}`)
        .setEmoji("\u{1f3b5}"),
    ];

    const musicBrainzUrl = meta?.musicBrainzReleaseId
      ? `https://musicbrainz.org/release/${encodeURIComponent(meta.musicBrainzReleaseId)}`
      : (meta?.musicBrainzRecordingId
        ? `https://musicbrainz.org/recording/${encodeURIComponent(meta.musicBrainzRecordingId)}`
        : null);

    if (musicBrainzUrl) {
      buttons.push(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel("MusicBrainz")
          .setURL(musicBrainzUrl)
          .setEmoji("\u{1f9e0}")
      );
    }

    const row = new ActionRowBuilder().addComponents(...buttons);
    return [row];
  }

  buildNowPlayingSourceSummary(language, meta, hasTrack) {
    const isDe = language === "de";
    const metadataSource = String(meta?.metadataSource || "").trim().toLowerCase();
    const metadataStatus = String(meta?.metadataStatus || (hasTrack ? "ok" : "empty")).trim().toLowerCase();
    const recognitionConfidence = Number.parseFloat(String(meta?.recognitionConfidence ?? ""));

    let sourceLabel = isDe ? "Unbekannt" : "Unknown";
    let sourceDetail = sourceLabel;
    let sourceNote = null;

    if (metadataSource === "icy") {
      sourceLabel = isDe ? "Sender-Metadaten" : "Station metadata";
      sourceDetail = sourceLabel;
    } else if (metadataSource === "recognition") {
      sourceLabel = isDe ? "Audio-Fingerprint" : "Audio fingerprint";
      sourceDetail = [
        meta?.recognitionProvider || "AcoustID",
        Number.isFinite(recognitionConfidence) ? `${Math.round(recognitionConfidence * 100)}%` : "",
      ].filter(Boolean).join(" | ") || sourceLabel;
      sourceNote = isDe
        ? "Per Audio-Fingerprint erkannt."
        : "Matched via audio fingerprint.";
    } else if (metadataSource === "icy+recognition") {
      sourceLabel = isDe ? "Metadaten + Fingerprint" : "Metadata + fingerprint";
      sourceDetail = [
        isDe ? "Sender-Metadaten ergänzt" : "Station metadata enriched",
        meta?.recognitionProvider || "AcoustID",
        Number.isFinite(recognitionConfidence) ? `${Math.round(recognitionConfidence * 100)}%` : "",
      ].filter(Boolean).join(" | ");
      sourceNote = isDe
        ? "Senderdaten wurden per Audio-Fingerprint ergänzt."
        : "Station data was enriched via audio fingerprint.";
    } else if (metadataSource === "stream") {
      sourceLabel = isDe ? "Stream-Info" : "Stream info";
      sourceDetail = sourceLabel;
    }

    let metadataHint = null;
    if (!hasTrack) {
      metadataHint = metadataStatus === "unsupported"
        ? (isDe
          ? "Dieser Stream sendet aktuell keine lesbaren Songdaten."
          : "This stream is not sending readable track data right now.")
        : (isDe
          ? "Dieser Sender liefert aktuell keine verwertbaren Songdaten."
          : "This station is not providing usable track data right now.");
    }

    return { metadataSource, sourceLabel, sourceDetail, sourceNote, metadataHint };
  }

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
  }

  getCurrentListenerCount(guildId, state) {
    const channelId = getRuntimeConnectedChannelId(this, guildId, state, {
      includeObserved: true,
      includeLastKnown: true,
    });
    return this.getVoiceListenerCount(guildId, channelId);
  }

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
  }

  formatStatsHourBucket(hour, language = "de") {
    const normalizedHour = Number.parseInt(String(hour || 0), 10);
    const safeHour = Number.isFinite(normalizedHour) ? Math.max(0, Math.min(23, normalizedHour)) : 0;
    const nextHour = (safeHour + 1) % 24;
    if (language === "de") {
      return `${String(safeHour).padStart(2, "0")}:00-${String(nextHour).padStart(2, "0")}:00`;
    }
    return `${String(safeHour).padStart(2, "0")}:00-${String(nextHour).padStart(2, "0")}:00`;
  }

  formatDurationMs(ms, language = "de") {
    const totalMinutes = Math.floor(ms / 60_000);
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours > 0) {
      return language === "de" ? `${hours}h ${minutes}m` : `${hours}h ${minutes}m`;
    }
    return language === "de" ? `${minutes}m` : `${minutes}m`;
  }

  buildListeningStatsEmbed(guildId, language = "de") {
    const t = (de, en) => languagePick(language, de, en);
    const guild = this.client.guilds.cache.get(guildId) || null;
    const stats = getGuildListeningStats(guildId);
    const liveStreams = this.getLiveGuildPlaybackSnapshot(guildId);
    const totalLiveListeners = liveStreams.reduce((sum, item) => sum + (Number(item.listenerCount) || 0), 0);
    const topStationEntry = Object.entries(stats?.stationStarts || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0] || null;
    const topHourEntry = Object.entries(stats?.hours || {})
      .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0] || null;
    const topDayEntry = Object.entries(stats?.daysOfWeek || {})
      .sort((a, b) => b[1] - a[1] || Number(a[0]) - Number(b[0]))[0] || null;
    const dayNames = language === "de"
      ? ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"]
      : ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    const topChannels = Object.entries(stats?.voiceChannels || {})
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 3)
      .map(([channelId, count]) => {
        const name = guild?.channels?.cache?.get(channelId)?.name || channelId;
        return `#${name}: ${count}`;
      });
    const topGuild = getTopGuildsByActivity(1)[0] || null;
    const topGuildName = topGuild
      ? (this.client.guilds.cache.get(topGuild.guildId)?.name || topGuild.guildId)
      : null;
    const liveStationsText = liveStreams.length
      ? liveStreams.map((item) => {
        const stationName = clipText(item.stationName || item.stationKey || "-", 80);
        const voiceLabel = item.channelId ? `<#${item.channelId}>` : t("unbekannt", "unknown");
        return `**${stationName}** - ${voiceLabel} - ${item.listenerCount} ${t("Zuhörer", "listeners")}`;
      }).join("\n")
      : t("Aktuell läuft auf diesem Server kein Stream.", "No stream is currently running on this server.");

    // Calculate total listening time (including active sessions)
    const totalListeningMs = stats?.currentTotalListeningMs || stats?.totalListeningMs || 0;
    const totalListeningText = totalListeningMs > 0
      ? this.formatDurationMs(totalListeningMs, language)
      : t("Noch keine Daten", "No data yet");

    // Connection health
    const totalConnections = stats?.totalConnections || 0;
    const totalReconnects = stats?.totalReconnects || 0;
    const totalDisconnects = stats?.totalConnectionDisconnects || 0;
    const totalErrors = stats?.totalConnectionErrors || 0;
    const successfulConnections = totalConnections + totalReconnects;
    const reliability = (successfulConnections + totalDisconnects + totalErrors) > 0
      ? Math.round((successfulConnections / (successfulConnections + totalDisconnects + totalErrors)) * 100)
      : 100;

    // Session stats
    const avgSessionText = stats?.avgSessionMs > 0
      ? this.formatDurationMs(stats.avgSessionMs, language)
      : "-";
    const longestSessionText = stats?.longestSessionMs > 0
      ? this.formatDurationMs(stats.longestSessionMs, language)
      : "-";

    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle(t("Listening-Stats", "Listening stats"))
      .setDescription(
        t(
          `Server: **${guild?.name || guildId}**\nLive-Zuhörer jetzt: **${totalLiveListeners}**`,
          `Server: **${guild?.name || guildId}**\nLive listeners now: **${totalLiveListeners}**`
        )
      )
      .addFields(
        {
          name: t("Live gerade", "Live now"),
          value: clipText(liveStationsText, 900),
          inline: false,
        },
        {
          name: t("Gesamte Hörzeit", "Total listening time"),
          value: totalListeningText,
          inline: true,
        },
        {
          name: t("Sessions gesamt", "Total sessions"),
          value: String(stats?.totalSessions || 0),
          inline: true,
        },
        {
          name: t("Peak-Zuhörer", "Peak listeners"),
          value: String(Number(stats?.peakListeners || 0)),
          inline: true,
        },
        {
          name: t("Meist gespielte Station", "Most played station"),
          value: topStationEntry
            ? `${clipText(topStationEntry[0], 100)} (${topStationEntry[1]}x)`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        },
        {
          name: t("Peak-Stunde", "Peak hour"),
          value: topHourEntry && Number(topHourEntry[1]) > 0
            ? `${this.formatStatsHourBucket(topHourEntry[0], language)} (${topHourEntry[1]})`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        },
        {
          name: t("Aktivster Tag", "Busiest day"),
          value: topDayEntry && Number(topDayEntry[1]) > 0
            ? `${dayNames[Number(topDayEntry[0])] || "?"} (${topDayEntry[1]})`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        },
        {
          name: t("Aktivste Voice-Channels", "Most active voice channels"),
          value: topChannels.length ? clipText(topChannels.join("\n"), 900) : t("Noch keine Daten", "No data yet"),
          inline: false,
        },
        {
          name: t("Session-Daten", "Session data"),
          value: t(
            `Durchschnitt: **${avgSessionText}** | Längste: **${longestSessionText}**`,
            `Average: **${avgSessionText}** | Longest: **${longestSessionText}**`
          ),
          inline: false,
        },
        {
          name: t("Verbindung", "Connection"),
          value: t(
            `Verbindungen: **${totalConnections}** | Reconnects: **${totalReconnects}** | Zuverlässigkeit: **${reliability}%**`,
            `Connections: **${totalConnections}** | Reconnects: **${totalReconnects}** | Reliability: **${reliability}%**`
          ),
          inline: false,
        },
        {
          name: t("Server gesamt", "Server totals"),
          value: t(
            `Starts ohne Recovery: **${Number(stats?.totalStarts || 0)}**\nLetzter Start: ${stats?.lastStartedAt ? this.formatDiscordTimestamp(stats.lastStartedAt, "R") : "-"}`,
            `Starts without recovery: **${Number(stats?.totalStarts || 0)}**\nLast start: ${stats?.lastStartedAt ? this.formatDiscordTimestamp(stats.lastStartedAt, "R") : "-"}`
          ),
          inline: true,
        },
        {
          name: t("Top-Server global", "Top server global"),
          value: topGuild
            ? `${clipText(topGuildName, 80)} (${topGuild.totalStarts} ${t("Starts", "starts")})`
            : t("Noch keine Daten", "No data yet"),
          inline: true,
        }
      )
      .setFooter({
        text: t("OmniFM Analytics | /stats", "OmniFM analytics | /stats"),
      })
      .setTimestamp(new Date());

    return embed;
  }

  buildSongHistoryEmbed(history, guildId, playbackRuntime, language = "de") {
    const t = (de, en) => languagePick(language, de, en);
    const lines = history.map((entry, index) => {
      const unix = Number.isFinite(entry.timestampMs) ? Math.floor(entry.timestampMs / 1000) : null;
      const when = unix ? `<t:${unix}:R>` : "-";
      const title = clipText(entry.displayTitle || entry.streamTitle || "-", 150);
      const station = entry.stationName ? clipText(entry.stationName, 80) : null;
      return `${index + 1}. ${when} - **${title}**${station ? `\n${t("Station", "Station")}: ${station}` : ""}`;
    });

    const latest = history[0] || null;
    const embed = new EmbedBuilder()
      .setColor(0x3BA55D)
      .setTitle(t("🕘 Song-History", "🕘 Song history"))
      .setDescription(clipText(lines.join("\n\n"), 3800))
      .setFooter({
        text: playbackRuntime
          ? `${playbackRuntime.config?.name || BRAND.name} | ${t("letzte", "latest")} ${history.length}`
          : `${BRAND.name} | ${t("letzte", "latest")} ${history.length}`,
      })
      .setTimestamp(new Date());

    if (latest?.artworkUrl) {
      embed.setThumbnail(latest.artworkUrl);
    }

    return {
      embeds: [embed],
      components: latest
        ? this.buildTrackLinkComponents(guildId, { name: latest.stationName || latest.stationKey || "-" }, latest)
        : [],
    };
  }

  async resolveNowPlayingChannel(guildId, state) {
    const guild = this.client.guilds.cache.get(guildId);
    if (!guild) return null;

    const me = await this.resolveBotMember(guild);
    if (!me) return null;

    const uniqueCandidateIds = getNowPlayingCandidateIds(state, guild);

    for (const candidateId of uniqueCandidateIds) {
      const channel = await this.fetchGuildChannelById(guild, candidateId);
      if (this.canSendNowPlayingToChannel(channel, me)) {
        return channel;
      }
    }

    if (!guild.channels?.cache?.size) {
      await guild.channels.fetch().catch(() => null);
    }

    const fallbackChannels = [...guild.channels.cache.values()].filter((channel) => {
      if (channel.type !== ChannelType.GuildText && channel.type !== ChannelType.GuildAnnouncement) {
        return false;
      }
      return this.canSendNowPlayingToChannel(channel, me);
    });

    fallbackChannels.sort((a, b) => this.scoreNowPlayingFallbackChannel(b) - this.scoreNowPlayingFallbackChannel(a));
    return fallbackChannels[0] || null;
  }

  buildNowPlayingEmbedLegacy(guildId, station, meta, context = {}) {
    const language = this.resolveGuildLanguage(guildId);
    const isDe = language === "de";
    const tierConfig = getTierConfig(guildId);
    const stationName = clipText(station?.name || meta?.name || "-", 120) || "-";
    const artist = clipText(this.normalizeNowPlayingValue(meta?.artist, station, meta, 120), 120);
    const title = clipText(this.normalizeNowPlayingValue(meta?.title, station, meta, 140), 140);
    const album = clipText(this.normalizeNowPlayingValue(meta?.album, station, meta, 140), 140);
    const trackLabel = clipText(
      this.normalizeNowPlayingValue(meta?.displayTitle || meta?.streamTitle, station, meta, 180)
      || ([artist, title].filter(Boolean).join(" - ")),
      140
    );
    const headline = clipText(title || trackLabel || "", 110) || trackLabel;
    const streamInfo = this.normalizeNowPlayingValue(meta?.description, station, meta, 240);
    const hasTrack = Boolean(trackLabel);
    const listenerCount = Math.max(0, Number.parseInt(String(context?.listenerCount || 0), 10) || 0);
    const voiceChannelId = String(context?.channelId || "").trim();
    const workerName = clipText(String(context?.workerName || this.config.name || BRAND.name), 60) || BRAND.name;
    const metadataStatus = String(meta?.metadataStatus || (hasTrack ? "ok" : "empty")).trim().toLowerCase();
    const metadataHint = hasTrack
      ? null
      : (metadataStatus === "unsupported"
        ? (isDe
          ? "Dieser Stream sendet aktuell keine auslesbaren Song-Metadaten."
          : "This stream is not sending readable track metadata right now.")
        : (isDe
          ? "Dieser Sender liefert aktuell keine verwertbaren Song-Metadaten."
          : "This station is not providing usable track metadata right now."));
    const embed = new EmbedBuilder()
      .setColor(hasTrack ? 0x1DB954 : 0xF1C40F)
      .setTitle(isDe ? "🎵 Jetzt live" : "🎵 Live now")
      .setDescription(
        hasTrack
          ? `**${headline}**`
          : `⚠️ ${metadataHint}`
      )
      .addFields(
        {
          name: isDe ? "📻 Sender" : "📻 Station",
          value: stationName,
          inline: true,
        },
        {
          name: isDe ? "🔊 Qualität" : "🔊 Quality",
          value: tierConfig.bitrate || "-",
          inline: true,
        },
        {
          name: isDe ? "👥 Zuhörer" : "👥 Listeners",
          value: String(listenerCount),
          inline: true,
        },
        {
          name: isDe ? "🎙 Voice" : "🎙 Voice",
          value: voiceChannelId ? `<#${voiceChannelId}>` : (isDe ? "unbekannt" : "unknown"),
          inline: true,
        }
      )
      .setAuthor({
        name: `${workerName} • ${BRAND.name}`,
      })
      .setFooter({
        text: isDe
          ? `↻ Auto-Update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`
          : `↻ Auto update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`,
      })
      .setTimestamp(new Date(meta?.updatedAt || Date.now()));

    if (artist) {
      embed.addFields({ name: isDe ? "🎤 Künstler" : "🎤 Artist", value: artist, inline: true });
    }
    if (title) {
      embed.addFields({ name: isDe ? "📝 Titel" : "📝 Title", value: title, inline: true });
    }
    if (streamInfo) {
      embed.addFields({ name: isDe ? "ℹ Stream-Info" : "ℹ Stream info", value: streamInfo, inline: false });
    }
    if (!hasTrack) {
      embed.addFields({
        name: isDe ? "🧭 Hinweis" : "🧭 Note",
        value: isDe
          ? "Der Stream laeuft normal weiter. Sobald der Radiosender wieder Metadaten liefert, aktualisiert OmniFM die Einbettung automatisch."
          : "The stream continues normally. As soon as the station sends metadata again, OmniFM updates the embed automatically.",
        inline: false,
      });
    }
    if (meta?.artworkUrl) {
      embed.setThumbnail(meta.artworkUrl);
    }

    const sourceSummary = this.buildNowPlayingSourceSummary(language, meta, hasTrack);
    const visibleListenerCount = listenerCount >= 2 ? String(listenerCount) : null;
    const descriptionLines = [];
    if (hasTrack) {
      descriptionLines.push(`**${headline}**`);
      if (sourceSummary.sourceNote) {
        descriptionLines.push(`_${sourceSummary.sourceNote}_`);
      }
    } else {
      descriptionLines.push(`\u26a0\ufe0f ${sourceSummary.metadataHint}`);
    }

    const summaryLines = [
      `**${isDe ? "\u{1f4fb} Sender" : "\u{1f4fb} Station"}**: ${stationName}`,
      `**${isDe ? "\u{1f50a} Qualit\u00e4t" : "\u{1f50a} Quality"}**: ${tierConfig.bitrate || "-"}`,
      `**${isDe ? "\u{1f9e0} Quelle" : "\u{1f9e0} Source"}**: ${sourceSummary.sourceDetail || sourceSummary.sourceLabel}`,
    ];
    const stableFields = [
      {
        name: isDe ? "\u{1f4ca} Stream" : "\u{1f4ca} Stream",
        value: summaryLines.join("\n"),
        inline: false,
      },
    ];

    const trackLines = [];
    if (artist) {
      trackLines.push(`**${isDe ? "\u{1f3a4} K\u00fcnstler" : "\u{1f3a4} Artist"}**: ${artist}`);
    }
    if (title) {
      trackLines.push(`**${isDe ? "\u{1f4dd} Titel" : "\u{1f4dd} Title"}**: ${title}`);
    }
    if (album) {
      trackLines.push(`**\u{1f4bf} Album**: ${album}`);
    }
    if (trackLines.length) {
      stableFields.push({
        name: hasTrack ? (isDe ? "\u{1f3b6} Track-Infos" : "\u{1f3b6} Track details") : (isDe ? "\u{1f3b6} Erkannt" : "\u{1f3b6} Recognized"),
        value: trackLines.join("\n"),
        inline: false,
      });
    }

    const voiceLines = [];
    if (voiceChannelId) {
      voiceLines.push(`**${isDe ? "\u{1f39b} L\u00e4uft in" : "\u{1f39b} Running in"}**: <#${voiceChannelId}>`);
    }
    if (visibleListenerCount) {
      voiceLines.push(`**${isDe ? "\u{1f465} H\u00f6ren gerade" : "\u{1f465} Listening now"}**: ${visibleListenerCount}`);
    }
    if (voiceLines.length) {
      stableFields.push({
        name: isDe ? "\u{1f50a} Wiedergabe" : "\u{1f50a} Playback",
        value: voiceLines.join("\n"),
        inline: false,
      });
    }

    if (streamInfo) {
      stableFields.push({
        name: isDe ? "\u2139\ufe0f Stream-Info" : "\u2139\ufe0f Stream info",
        value: streamInfo,
        inline: false,
      });
    }
    if (!hasTrack) {
      stableFields.push({
        name: isDe ? "\u{1f9ed} Hinweis" : "\u{1f9ed} Note",
        value: isDe
          ? "Der Stream l\u00e4uft normal weiter. OmniFM versucht weiterhin zuerst Sender-Metadaten und danach den Fingerprint-Fallback."
          : "The stream continues normally. OmniFM keeps trying station metadata first and then the fingerprint fallback.",
        inline: false,
      });
    }

    const stableFooterParts = [
      workerName,
      isDe ? `Auto-Update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s` : `Auto update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`,
    ];
    if (sourceSummary.metadataSource.includes("recognition")) {
      stableFooterParts.push(isDe ? "Fingerprint-Fallback" : "Fingerprint fallback");
    }

    embed
      .setColor(!hasTrack ? 0xF1C40F : (sourceSummary.metadataSource.includes("recognition") ? 0x5865F2 : 0x1DB954))
      .setTitle(isDe ? "\u{1f3b5} Jetzt live" : "\u{1f3b5} Live now")
      .setDescription(descriptionLines.join("\n"))
      .setAuthor({
        name: workerName,
        iconURL: this.client.user?.displayAvatarURL?.({ extension: "png", size: 128 }) || undefined,
      })
      .setFooter({
        text: stableFooterParts.join(" | "),
      });

    const existingFieldCount = Array.isArray(embed.data?.fields) ? embed.data.fields.length : 0;
    if (existingFieldCount > 0) {
      embed.spliceFields(0, existingFieldCount, ...stableFields);
    } else if (stableFields.length > 0) {
      embed.addFields(...stableFields);
    }

    return embed;
  }

  buildNowPlayingEmbed(guildId, station, meta, context = {}) {
    const language = this.resolveGuildLanguage(guildId);
    const isDe = language === "de";
    const tierConfig = getTierConfig(guildId);
    const stationName = clipText(station?.name || meta?.name || "-", 120) || "-";
    const artist = clipText(this.normalizeNowPlayingValue(meta?.artist, station, meta, 120), 120);
    const title = clipText(this.normalizeNowPlayingValue(meta?.title, station, meta, 140), 140);
    const album = clipText(this.normalizeNowPlayingValue(meta?.album, station, meta, 140), 140);
    const trackLabel = clipText(
      this.normalizeNowPlayingValue(meta?.displayTitle || meta?.streamTitle, station, meta, 180)
      || ([artist, title].filter(Boolean).join(" - ")),
      140
    );
    const headline = clipText(title || trackLabel || "", 110) || trackLabel;
    const streamInfo = this.normalizeNowPlayingValue(meta?.description, station, meta, 240);
    const hasTrack = Boolean(trackLabel);
    const listenerCount = Math.max(0, Number.parseInt(String(context?.listenerCount || 0), 10) || 0);
    const parsedVolume = Number.parseInt(String(context?.volume ?? ""), 10);
    const visibleVolume = Number.isFinite(parsedVolume)
      ? `${Math.max(0, Math.min(100, parsedVolume))}%`
      : null;
    const voiceChannelId = String(context?.channelId || "").trim();
    const workerName = clipText(String(context?.workerName || this.config.name || BRAND.name), 60) || BRAND.name;
    const metadataSource = String(meta?.metadataSource || "").trim().toLowerCase();
    const metadataStatus = String(meta?.metadataStatus || (hasTrack ? "ok" : "empty")).trim().toLowerCase();
    const recognitionConfidence = Number.parseFloat(String(meta?.recognitionConfidence ?? ""));
    const sourceLabel = metadataSource.includes("recognition")
      ? (isDe ? "Audio-Fingerprint" : "Audio fingerprint")
      : (metadataSource === "icy"
        ? (isDe ? "Sender-Metadaten" : "Station metadata")
        : (metadataSource === "stream"
          ? (isDe ? "Stream-Info" : "Stream info")
          : (isDe ? "Unbekannt" : "Unknown")));
    const sourceDetail = metadataSource.includes("recognition")
      ? [
          meta?.recognitionProvider || "AcoustID",
          Number.isFinite(recognitionConfidence) ? `${Math.round(recognitionConfidence * 100)}%` : "",
        ].filter(Boolean).join(" | ")
      : sourceLabel;
    const metadataHint = hasTrack
      ? null
      : (metadataStatus === "unsupported"
        ? (isDe
          ? "Dieser Stream sendet aktuell keine auslesbaren Songdaten."
          : "This stream is not sending readable track metadata right now.")
        : (isDe
          ? "Dieser Sender liefert aktuell keine verwertbaren Songdaten."
          : "This station is not providing usable track metadata right now."));
    const footerParts = [
      isDe
        ? `↻ Auto-Update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`
        : `↻ Auto update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`,
    ];
    if (metadataSource.includes("recognition")) {
      footerParts.push(isDe ? "Fingerprint aktiv" : "Fingerprint active");
    }

    const embed = new EmbedBuilder()
      .setColor(hasTrack ? 0x1DB954 : 0xF1C40F)
      .setTitle(isDe ? "🎵 Jetzt live" : "🎵 Live now")
      .setDescription(
        hasTrack
          ? `**${headline}**`
          : `⚠️ ${metadataHint}`
      )
      .addFields(
        {
          name: isDe ? "📻 Sender" : "📻 Station",
          value: stationName,
          inline: true,
        },
        {
          name: isDe ? "🔊 Qualität" : "🔊 Quality",
          value: tierConfig.bitrate || "-",
          inline: true,
        },
        {
          name: isDe ? "👥 Zuhörer" : "👥 Listeners",
          value: String(listenerCount),
          inline: true,
        },
        {
          name: "🎙 Voice",
          value: voiceChannelId ? `<#${voiceChannelId}>` : (isDe ? "unbekannt" : "unknown"),
          inline: true,
        },
        {
          name: isDe ? "🧠 Quelle" : "🧠 Source",
          value: sourceDetail || sourceLabel,
          inline: true,
        }
      )
      .setAuthor({
        name: `${workerName} • ${BRAND.name}`,
      })
      .setFooter({
        text: footerParts.join(" | "),
      })
      .setTimestamp(new Date(meta?.updatedAt || Date.now()));

    if (artist) {
      embed.addFields({ name: isDe ? "🎤 Artist" : "🎤 Artist", value: artist, inline: true });
    }
    if (title) {
      embed.addFields({ name: isDe ? "📝 Titel" : "📝 Title", value: title, inline: true });
    }
    if (album) {
      embed.addFields({ name: isDe ? "💿 Album" : "💿 Album", value: album, inline: true });
    }
    if (streamInfo) {
      embed.addFields({ name: isDe ? "ℹ Stream-Info" : "ℹ Stream info", value: streamInfo, inline: false });
    }
    if (!hasTrack) {
      embed.addFields({
        name: isDe ? "🧭 Hinweis" : "🧭 Note",
        value: isDe
          ? "Der Stream läuft normal weiter. Sobald der Radiosender wieder Metadaten liefert oder die Audio-Erkennung greift, aktualisiert OmniFM die Einbettung automatisch."
          : "The stream continues normally. As soon as the station sends metadata again or audio recognition succeeds, OmniFM updates the embed automatically.",
        inline: false,
      });
    }
    if (meta?.artworkUrl) {
      embed.setThumbnail(meta.artworkUrl);
    }

    const sourceSummary = this.buildNowPlayingSourceSummary(language, meta, hasTrack);
    const visibleListenerCount = listenerCount >= 2 ? String(listenerCount) : null;
    const descriptionLines = [];
    if (hasTrack) {
      descriptionLines.push(`**${headline}**`);
      if (sourceSummary.sourceNote) {
        descriptionLines.push(`_${sourceSummary.sourceNote}_`);
      }
    } else {
      descriptionLines.push(`\u26a0\ufe0f ${sourceSummary.metadataHint}`);
    }

    const stableFields = [
      {
        name: isDe ? "\u{1f4fb} Sender" : "\u{1f4fb} Station",
        value: stationName,
        inline: true,
      },
      {
        name: isDe ? "\u{1f50a} Qualit\u00e4t" : "\u{1f50a} Quality",
        value: tierConfig.bitrate || "-",
        inline: true,
      },
      {
        name: isDe ? "\u{1f9e0} Quelle" : "\u{1f9e0} Source",
        value: sourceSummary.sourceDetail || sourceSummary.sourceLabel,
        inline: true,
      },
    ];

    if (voiceChannelId) {
      stableFields.push({
        name: isDe ? "\u{1f39b} L\u00e4uft in" : "\u{1f39b} Running in",
        value: `<#${voiceChannelId}>`,
        inline: true,
      });
    }
    if (visibleListenerCount) {
      stableFields.push({
        name: isDe ? "\u{1f465} H\u00f6ren gerade" : "\u{1f465} Listening now",
        value: visibleListenerCount,
        inline: true,
      });
    }
    if (visibleVolume) {
      stableFields.push({
        name: isDe ? "\u{1f50a} Lautst\u00e4rke" : "\u{1f50a} Volume",
        value: visibleVolume,
        inline: true,
      });
    }
    if (artist) {
      stableFields.push({
        name: isDe ? "\u{1f3a4} K\u00fcnstler" : "\u{1f3a4} Artist",
        value: artist,
        inline: true,
      });
    }
    if (title) {
      stableFields.push({
        name: isDe ? "\u{1f4dd} Titel" : "\u{1f4dd} Title",
        value: title,
        inline: true,
      });
    }
    if (album) {
      stableFields.push({
        name: "\u{1f4bf} Album",
        value: album,
        inline: true,
      });
    }
    if (streamInfo) {
      stableFields.push({
        name: isDe ? "\u2139\ufe0f Stream-Info" : "\u2139\ufe0f Stream info",
        value: streamInfo,
        inline: false,
      });
    }
    if (!hasTrack) {
      stableFields.push({
        name: isDe ? "\u{1f9ed} Hinweis" : "\u{1f9ed} Note",
        value: isDe
          ? "Der Stream l\u00e4uft normal weiter. OmniFM versucht weiterhin zuerst Sender-Metadaten und danach den Fingerprint-Fallback."
          : "The stream continues normally. OmniFM keeps trying station metadata first and then the fingerprint fallback.",
        inline: false,
      });
    }

    const stableFooterParts = [
      workerName,
      isDe ? `Auto-Update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s` : `Auto update ${Math.round(NOW_PLAYING_POLL_MS / 1000)}s`,
    ];
    if (sourceSummary.metadataSource.includes("recognition")) {
      stableFooterParts.push(isDe ? "Fingerprint-Fallback" : "Fingerprint fallback");
    }

    embed
      .setColor(!hasTrack ? 0xF1C40F : (sourceSummary.metadataSource.includes("recognition") ? 0x5865F2 : 0x1DB954))
      .setTitle(isDe ? "\u{1f3b5} Jetzt live" : "\u{1f3b5} Live now")
      .setDescription(descriptionLines.join("\n"))
      .setAuthor({
        name: workerName,
        iconURL: this.client.user?.displayAvatarURL?.({ extension: "png", size: 128 }) || undefined,
      })
      .setFooter({
        text: stableFooterParts.join(" | "),
      });

    const existingFieldCount = Array.isArray(embed.data?.fields) ? embed.data.fields.length : 0;
    if (existingFieldCount > 0) {
      embed.spliceFields(0, existingFieldCount, ...stableFields);
    } else if (stableFields.length > 0) {
      embed.addFields(...stableFields);
    }

    return embed;
  }

  buildNowPlayingMessagePayload(guildId, station, meta, context = {}) {
    return {
      embeds: [this.buildNowPlayingEmbed(guildId, station, meta, context)],
      components: this.buildTrackLinkComponents(guildId, station, meta),
      allowedMentions: { parse: [] },
    };
  }

  recordSongHistory(guildId, state, station, meta) {
    if (!SONG_HISTORY_ENABLED) return;
    if (!meta) return;

    const displayTitle = clipText(meta.displayTitle || meta.streamTitle || "", 220);
    if (!displayTitle) return;

    try {
      appendSongHistory(guildId, {
        botId: this.config.id,
        stationKey: state.currentStationKey || null,
        stationName: station?.name || state.currentStationName || null,
        displayTitle,
        streamTitle: clipText(meta.streamTitle || "", 220) || null,
        artist: clipText(meta.artist || "", 120) || null,
        title: clipText(meta.title || "", 120) || null,
        artworkUrl: clipText(meta.artworkUrl || "", 600) || null,
        timestampMs: Date.now(),
      }, {
        maxPerGuild: SONG_HISTORY_MAX_PER_GUILD,
        dedupeWindowMs: SONG_HISTORY_DEDUPE_WINDOW_MS,
      });
    } catch (err) {
      this.logNowPlayingIssue(guildId, state, `SongHistory: ${clipText(err?.message || String(err), 180)}`);
    }
  }

  async upsertNowPlayingMessage(guildId, state, payload, channelOverride = null) {
    const channel = channelOverride || await this.resolveNowPlayingChannel(guildId, state);
    if (!channel) return false;

    if (state.nowPlayingChannelId && state.nowPlayingChannelId !== channel.id) {
      state.nowPlayingMessageId = null;
    }
    state.nowPlayingChannelId = channel.id;

    const messagePayload = {
      embeds: [],
      allowedMentions: { parse: [] },
      components: [],
    };
    if (Array.isArray(payload?.embeds)) {
      messagePayload.embeds = payload.embeds;
    }
    if (Array.isArray(payload?.components)) {
      messagePayload.components = payload.components;
    }

    if (state.nowPlayingMessageId && channel.messages?.fetch) {
      const existing = await channel.messages.fetch(state.nowPlayingMessageId).catch(() => null);
      if (existing?.edit) {
        try {
          await existing.edit(messagePayload);
          return true;
        } catch (err) {
          this.logNowPlayingIssue(
            guildId,
            state,
            `Edit fehlgeschlagen in #${channel.name || channel.id}: ${clipText(err?.message || String(err), 160)}`
          );
          state.nowPlayingMessageId = null;
        }
      }
    }

    try {
      const sent = await channel.send(messagePayload);
      if (sent?.id) {
        state.nowPlayingMessageId = sent.id;
      }
      return true;
    } catch (err) {
      this.logNowPlayingIssue(
        guildId,
        state,
        `Senden fehlgeschlagen in #${channel.name || channel.id}: ${clipText(err?.message || String(err), 160)}`
      );
      return false;
    }
  }

  async updateNowPlayingEmbed(guildId, state, { force = false } = {}) {
    if (!NOW_PLAYING_ENABLED) return;
    if (!state.currentStationKey) return;
    if (!isRuntimePlaybackActive(this, guildId, state)) return;
    const channel = await this.resolveNowPlayingChannel(guildId, state);
    if (!channel) {
      this.logNowPlayingIssue(guildId, state, "Kein geeigneter Kanal fuer die Live-Einbettung gefunden.");
      return;
    }

    const stationKey = state.currentStationKey;
    const resolvedStation = this.getResolvedCurrentStation(guildId, state);
    const station = resolvedStation?.station || null;
    if (!station?.url) return;

    try {
      const snapshot = await fetchStreamSnapshot(station.url, { includeCover: NOW_PLAYING_COVER_ENABLED });
      if (state.currentStationKey !== stationKey) return;

      const previousMeta = state.currentMeta || {};
      const artist = this.normalizeNowPlayingValue(snapshot.artist, station, snapshot, 120);
      const title = this.normalizeNowPlayingValue(snapshot.title, station, snapshot, 120);
      const streamTitle = this.normalizeNowPlayingValue(snapshot.streamTitle, station, snapshot, 180);
      const displayTitle = this.normalizeNowPlayingValue(snapshot.displayTitle || snapshot.streamTitle, station, snapshot, 180)
        || ([artist, title].filter(Boolean).join(" - ") || null);
      const hasFreshTrack = Boolean(displayTitle || artist || title);
      const keepPreviousTrack = !hasFreshTrack && this.isFreshNowPlayingTrack(previousMeta);
      const sameTrackAsPrevious = Boolean(
        displayTitle
        && String(previousMeta.displayTitle || "").trim()
        && displayTitle.toLowerCase() === String(previousMeta.displayTitle || "").trim().toLowerCase()
      );

      const nextMeta = {
        name: this.normalizeNowPlayingValue(snapshot.name, station, snapshot, 120) || previousMeta?.name || station.name || stationKey,
        description: this.normalizeNowPlayingValue(snapshot.description, station, snapshot, 240) || previousMeta?.description || null,
        streamTitle: streamTitle || (keepPreviousTrack ? previousMeta.streamTitle || null : null),
        artist: artist || (keepPreviousTrack ? previousMeta.artist || null : null),
        title: title || (keepPreviousTrack ? previousMeta.title || null : null),
        displayTitle: displayTitle || (keepPreviousTrack ? previousMeta.displayTitle || null : null),
        artworkUrl: snapshot.artworkUrl || ((keepPreviousTrack || sameTrackAsPrevious) ? previousMeta.artworkUrl || null : null),
        album: this.normalizeNowPlayingValue(snapshot.album, station, snapshot, 120) || (keepPreviousTrack ? previousMeta.album || null : null),
        metadataSource: snapshot.metadataSource || previousMeta.metadataSource || null,
        metadataStatus: hasFreshTrack
          ? (snapshot.metadataStatus || "ok")
          : (keepPreviousTrack ? previousMeta.metadataStatus || "ok" : (snapshot.metadataStatus || "empty")),
        recognitionProvider: snapshot.recognitionProvider || (keepPreviousTrack ? previousMeta.recognitionProvider || null : null),
        recognitionConfidence: Number.isFinite(Number(snapshot.recognitionConfidence))
          ? Number(snapshot.recognitionConfidence)
          : (keepPreviousTrack && Number.isFinite(Number(previousMeta.recognitionConfidence))
            ? Number(previousMeta.recognitionConfidence)
            : null),
        musicBrainzRecordingId: snapshot.musicBrainzRecordingId || (keepPreviousTrack ? previousMeta.musicBrainzRecordingId || null : null),
        musicBrainzReleaseId: snapshot.musicBrainzReleaseId || (keepPreviousTrack ? previousMeta.musicBrainzReleaseId || null : null),
        updatedAt: new Date().toISOString(),
        trackDetectedAtMs: hasFreshTrack
          ? Date.now()
          : (keepPreviousTrack ? Number.parseInt(String(previousMeta.trackDetectedAtMs || 0), 10) || 0 : 0),
      };
      state.currentMeta = nextMeta;
      this.recordSongHistory(guildId, state, station, nextMeta);

      const signature = buildNowPlayingSignature(stationKey, nextMeta, state, channel.id);

      if (!force && signature === state.nowPlayingSignature) {
        return;
      }

      const listenerCount = this.getCurrentListenerCount(guildId, state);
      const voiceChannelId = getRuntimeConnectedChannelId(this, guildId, state, {
        includeObserved: true,
        includeLastKnown: true,
      }) || null;
      const payload = this.buildNowPlayingMessagePayload(guildId, station, nextMeta, {
        channelId: voiceChannelId,
        listenerCount,
        volume: state.volume,
        workerName: this.config.name,
      });
      const sent = await this.upsertNowPlayingMessage(guildId, state, payload, channel);
      if (sent) {
        state.nowPlayingSignature = signature;
      }
    } catch (err) {
      this.logNowPlayingIssue(guildId, state, clipText(err?.message || String(err), 200));
    }
  }

  startNowPlayingLoop(guildId, state) {
    this.clearNowPlayingTimer(state);
    state.nowPlayingSignature = null;
    if (!NOW_PLAYING_ENABLED || !state.currentStationKey) return;

    const taskId = `guild-${guildId}-nowplaying`;
    const update = async () => {
      try {
        await this.updateNowPlayingEmbed(guildId, state);
      } catch (err) {
        this.logNowPlayingIssue(guildId, state, clipText(err?.message || String(err), 200));
      }
    };

    // Enqueue first update immediately
    this.nowPlayingQueue.enqueue(taskId, update);

    // Schedule recurring updates with jitter to spread load
    const scheduleNextUpdate = () => {
      if (!state.currentStationKey) return; // Stop if station changed

      const jitterMs = applyJitter(NOW_PLAYING_POLL_MS, 0.2); // ±20% jitter
      state.nowPlayingRefreshTimer = setTimeout(() => {
        this.nowPlayingQueue.enqueue(taskId, update);
        scheduleNextUpdate(); // Reschedule next
      }, jitterMs);
    };

    scheduleNextUpdate();
  }

  clearCurrentProcess(state) {
    return clearRuntimeCurrentProcess(this, state);
  }

  armStreamStabilityReset(guildId, state) {
    return armRuntimeStreamStabilityReset(this, guildId, state);
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

    for (const guildId of guildIds) {
      try {
        await this.rest.put(Routes.applicationGuildCommands(applicationId, guildId), { body: [] });
        cleaned += 1;
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
  }

  async resolveBotMember(guild) {
    if (guild.members.me) return guild.members.me;
    return guild.members.fetchMe().catch(() => null);
  }

  async validateVoiceChannelAccess(guild, channel, { language = null, workerName = "" } = {}) {
    const resolvedLanguage = normalizeLanguage(language || this.resolveGuildLanguage(guild?.id), getDefaultLanguage());
    const isDe = resolvedLanguage === "de";
    const t = (de, en) => (isDe ? de : en);

    if (!guild || !channel) {
      return {
        ok: false,
        message: buildVoiceChannelAccessMessage({ issue: "channel_unavailable", t, workerName }),
      };
    }

    const me = await this.resolveBotMember(guild);
    if (!me) {
      return {
        ok: false,
        message: t(
          "OmniFM konnte sein Bot-Mitglied auf diesem Server gerade nicht laden. Bitte versuche es erneut.",
          "OmniFM could not load its bot member on this server right now. Please try again."
        ),
      };
    }

    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.Connect)) {
      return {
        ok: false,
        message: buildVoiceChannelAccessMessage({
          issue: "connect_missing",
          channelLabel: channel.toString(),
          workerName,
          t,
        }),
      };
    }
    if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
      return {
        ok: false,
        message: buildVoiceChannelAccessMessage({
          issue: "speak_missing",
          channelLabel: channel.toString(),
          workerName,
          t,
        }),
      };
    }

    return { ok: true, me };
  }

  async listVoiceChannels(guild) {
    let channels = [...guild.channels.cache.values()];
    if (!channels.length) {
      await guild.channels.fetch().catch(() => null);
      channels = [...guild.channels.cache.values()];
    }

    return channels
      .filter(
        (channel) =>
          channel &&
          channel.isVoiceBased() &&
          (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)
      )
      .sort((a, b) => {
        const posDiff = (a.rawPosition || 0) - (b.rawPosition || 0);
        if (posDiff !== 0) return posDiff;
        return a.name.localeCompare(b.name, "de");
      });
  }

  renderVoiceStatusText(stationName) {
    const station = clipText(String(stationName || "").trim(), 60) || "Radio";
    const botName = clipText(String(this.config?.name || BRAND.name || "OmniFM"), 24);
    const raw = VOICE_CHANNEL_STATUS_TEMPLATE
      .replace(/\{station\}/gi, station)
      .replace(/\{bot\}/gi, botName)
      .trim();
    if (!raw) return "";
    return clipText(raw, VOICE_CHANNEL_STATUS_MAX_LENGTH);
  }

  invalidateVoiceStatus(state, { clearText = false } = {}) {
    if (!state) return;
    state.voiceStatusNeedsSync = true;
    state.voiceStatusChannelId = "";
    state.lastVoiceStatusSyncAt = 0;
    state.lastVoiceStatusErrorAt = 0;
    if (clearText) {
      state.voiceStatusText = "";
    }
  }

  shouldRefreshVoiceStatus(state, desired, channelId, { force = false } = {}) {
    if (!state) return false;
    if (force) return true;
    if (state.voiceStatusNeedsSync) return true;
    if (String(state.voiceStatusChannelId || "") !== String(channelId || "").trim()) return true;
    if (String(state.voiceStatusText || "") !== String(desired || "")) return true;
    if (!desired) return false;
    const lastSyncAt = Number(state.lastVoiceStatusSyncAt || 0);
    return !lastSyncAt || (Date.now() - lastSyncAt) >= VOICE_CHANNEL_STATUS_REFRESH_MS;
  }

  async syncVoiceChannelStatus(guildId, stationName = "", { force = false } = {}) {
    if (!VOICE_CHANNEL_STATUS_ENABLED) return;
    const state = this.guildState.get(guildId);
    if (!state) return;

    const channelId = String(getRuntimeConnectedChannelId(this, guildId, state, {
      includeObserved: true,
      includeLastKnown: true,
    }) || "").trim();
    if (!/^\d{17,22}$/.test(channelId)) return;
    const desired = stationName ? this.renderVoiceStatusText(stationName) : "";
    if (!this.shouldRefreshVoiceStatus(state, desired, channelId, { force })) return;
    const guild = this.client.guilds.cache.get(guildId) || null;
    const channel = (guild?.channels?.cache?.get(channelId))
      || await guild?.channels?.fetch?.(channelId).catch(() => null)
      || null;
    if (!channel || channel.type !== ChannelType.GuildVoice) {
      state.voiceStatusText = "";
      state.voiceStatusChannelId = "";
      state.voiceStatusNeedsSync = false;
      state.lastVoiceStatusSyncAt = 0;
      return;
    }

    try {
      const route = `/channels/${channelId}/voice-status`;
      if (desired) {
        await this.rest.put(route, { body: { status: desired } });
      } else {
        try {
          await this.rest.delete(route);
        } catch {
          await this.rest.put(route, { body: { status: "" } });
        }
      }
      state.voiceStatusText = desired;
      state.voiceStatusChannelId = desired ? channelId : "";
      state.voiceStatusNeedsSync = false;
      state.lastVoiceStatusSyncAt = Date.now();
      state.lastVoiceStatusErrorAt = 0;
    } catch (err) {
      const now = Date.now();
      state.voiceStatusNeedsSync = true;
      if (!state.lastVoiceStatusErrorAt || now - state.lastVoiceStatusErrorAt > 60_000) {
        log("WARN", `[${this.config.name}] Voice-Status konnte nicht gesetzt werden (guild=${guildId}): ${err?.message || err}`);
      }
      state.lastVoiceStatusErrorAt = now;
    }
  }

  buildPresenceActivity() {
    return buildRuntimePresenceActivity(this);
  }

  updatePresence() {
    if (!this.client.user) return;
    const activity = this.buildPresenceActivity();
    try {
      this.client.user.setPresence({
        status: "online",
        activities: [activity]
      });
    } catch (err) {
      log("ERROR", `[${this.config.name}] Presence update fehlgeschlagen: ${err?.message || err}`);
    }
  }

  startPresenceRotation() {
    if (this._presenceInterval) return;
    this._presenceInterval = setInterval(() => this.updatePresence(), 30000);
  }

  stopPresenceRotation() {
    if (this._presenceInterval) {
      clearInterval(this._presenceInterval);
      this._presenceInterval = null;
    }
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

  hasGuildManagePermissions(interaction) {
    if (!interaction) return false;
    if (interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) return true;
    return interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild) || false;
  }

  isGuildOwner(interaction) {
    const ownerId = String(interaction?.guild?.ownerId || "").trim();
    const userId = String(interaction?.user?.id || "").trim();
    return Boolean(ownerId && userId && ownerId === userId);
  }

  hasPermissionAdminBypass(interaction) {
    return this.isGuildOwner(interaction) || this.hasGuildManagePermissions(interaction);
  }

  resolveGuildLanguage(guildId) {
    const guildKey = String(guildId || "").trim();
    const guildOverride = guildKey ? getGuildLanguage(guildKey) : null;
    if (guildOverride) return guildOverride;

    const guild = guildKey ? this.client.guilds.cache.get(guildKey) : null;
    return resolveLanguageFromDiscordLocale(guild?.preferredLocale, getDefaultLanguage());
  }

  resolveInteractionLanguage(interaction) {
    const guildId = String(interaction?.guildId || "").trim();
    const guildOverride = guildId ? getGuildLanguage(guildId) : null;
    if (guildOverride) return guildOverride;

    const localeCandidates = [
      interaction?.locale,
      interaction?.guildLocale,
      interaction?.guild?.preferredLocale,
    ];
    const hasGerman = localeCandidates.some((locale) => {
      return resolveLanguageFromDiscordLocale(locale, "en") === "de";
    });
    return hasGerman ? "de" : "en";
  }

  createInteractionTranslator(interaction) {
    const language = this.resolveInteractionLanguage(interaction);
    const isDe = language === "de";
    return {
      language,
      isDe,
      t: (de, en) => (isDe ? de : en),
    };
  }

  getStreamingRuntimeSelectionMessage(reason, language = "de") {
    const isDe = String(language || "de").toLowerCase() === "de";
    const messages = {
      none: isDe
        ? "Auf diesem Server streamt gerade kein Worker. Starte zuerst `/play`."
        : "No worker is currently streaming on this server. Start `/play` first.",
      multiple: isDe
        ? "Mehrere Worker streamen aktuell. Tritt dem Ziel-Voice-Channel bei, damit ich den richtigen Stream waehle."
        : "Multiple workers are currently streaming. Join the target voice channel so I can select the correct stream.",
      multiple_in_channel: isDe
        ? "In deinem Voice-Channel sind mehrere Worker aktiv. Stoppe einen davon oder waehle einen eindeutigen Ziel-Channel."
        : "Multiple workers are active in your voice channel. Stop one of them or choose a unique target channel.",
      requested_missing: isDe
        ? "Der gewählte Worker streamt aktuell nicht auf diesem Server."
        : "The selected worker is not currently streaming on this server.",
    };
    return messages[reason] || messages.none;
  }

  async resolveStreamingRuntimeForInteraction(interaction) {
    const guildId = String(interaction?.guildId || "").trim();
    if (!guildId) {
      return { runtime: null, state: null, reason: "none" };
    }

    if (this.role !== "commander" || !this.workerManager) {
      return { runtime: this, state: this.getState(guildId), reason: null };
    }

    if (typeof this.workerManager.refreshRemoteStates === "function") {
      await this.workerManager.refreshRemoteStates().catch(() => null);
    }

    const requestedBotIndex = this.getIntegerOptionFlexible(interaction, ["bot"]);
    const requestedSlotIndex = requestedBotIndex === null
      ? this.getIntegerOptionFlexible(interaction, ["worker"])
      : null;
    const requestedWorkerIndex = requestedBotIndex ?? requestedSlotIndex;
    if (requestedWorkerIndex !== null) {
      const resolvedWorker = this.workerManager.resolveWorker(requestedWorkerIndex, {
        prefer: requestedBotIndex !== null ? "botIndex" : "slot",
      });
      const streamingWorkers = this.workerManager.getStreamingWorkers(guildId);
      const isStreamingWorker = resolvedWorker?.worker && streamingWorkers.includes(resolvedWorker.worker);
      if (!resolvedWorker?.worker || !isStreamingWorker) {
        return {
          runtime: null,
          state: null,
          reason: "requested_missing",
          requestedWorkerIndex,
          requestedWorkerSlot: Number(resolvedWorker?.workerSlot || 0) || null,
        };
      }
      return {
        runtime: resolvedWorker.worker,
        state: resolvedWorker.worker.getState(guildId),
        reason: null,
        requestedWorkerIndex,
        requestedWorkerSlot: Number(resolvedWorker.workerSlot || 0) || null,
      };
    }

    const workers = this.workerManager.getStreamingWorkers(guildId);
    if (!workers.length) {
      return { runtime: null, state: null, reason: "none" };
    }

    const guild = interaction.guild
      || this.client.guilds.cache.get(guildId)
      || await this.client.guilds.fetch(guildId).catch(() => null);
    const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
    const userChannelId = String(member?.voice?.channelId || "").trim();

    if (userChannelId) {
      const matchingWorkers = workers.filter((worker) => {
        const info = worker.getGuildInfo(guildId);
        return String(info?.channelId || "").trim() === userChannelId;
      });
      if (matchingWorkers.length === 1) {
        const runtime = matchingWorkers[0];
        return { runtime, state: runtime.getState(guildId), reason: null };
      }
      if (matchingWorkers.length > 1) {
        return { runtime: null, state: null, reason: "multiple_in_channel" };
      }
    }

    if (workers.length === 1) {
      const runtime = workers[0];
      return { runtime, state: runtime.getState(guildId), reason: null };
    }

    return { runtime: null, state: null, reason: "multiple" };
  }

  getIntegerOptionFlexible(interaction, optionNames = []) {
    const resolver = interaction?.options;
    if (!resolver || !Array.isArray(optionNames) || optionNames.length === 0) return null;

    const parseValue = (value) => {
      if (Number.isInteger(value)) return value;
      const parsed = Number.parseInt(String(value ?? "").trim(), 10);
      return Number.isInteger(parsed) ? parsed : null;
    };

    for (const rawName of optionNames) {
      const name = String(rawName || "").trim();
      if (!name) continue;

      try {
        const direct = resolver.getInteger(name, false);
        const parsedDirect = parseValue(direct);
        if (parsedDirect !== null) return parsedDirect;
      } catch {
        // ignore option type mismatch
      }

      try {
        const asString = resolver.getString(name, false);
        const parsedString = parseValue(asString);
        if (parsedString !== null) return parsedString;
      } catch {
        // ignore option type mismatch
      }

      try {
        const raw = resolver.get(name, false);
        const parsedRaw = parseValue(raw?.value);
        if (parsedRaw !== null) return parsedRaw;
      } catch {
        // ignore missing option
      }
    }

    const rawData = Array.isArray(resolver.data) ? resolver.data : [];
    for (const rawName of optionNames) {
      const name = String(rawName || "").trim();
      if (!name) continue;
      const option = rawData.find((entry) => String(entry?.name || "").trim() === name);
      const parsed = parseValue(option?.value);
      if (parsed !== null) return parsed;
    }

    return null;
  }

  getWorkerRequiredTierBySlot(slot) {
    const idx = Number.parseInt(String(slot || ""), 10);
    if (!Number.isFinite(idx) || idx <= 2) return "free";
    if (idx <= 8) return "pro";
    return "ultimate";
  }

  formatTierLabel(tier, language) {
    const normalized = String(tier || "free").toLowerCase();
    if (normalized === "ultimate") return "Ultimate";
    if (normalized === "pro") return "Pro";
    return language === "de" ? "Free" : "Free";
  }

  async isWorkerAlreadyInvited(guild, worker) {
    if (!guild || !worker) return false;
    const clientId = String(worker.getApplicationId?.() || worker.config?.clientId || "").trim();
    if (!/^\d{17,22}$/.test(clientId)) return false;

    if (worker.client?.isReady?.() && worker.client.guilds.cache.has(guild.id)) {
      return true;
    }
    if (guild.members?.cache?.has(clientId)) {
      return true;
    }
    const member = await guild.members.fetch(clientId).catch(() => null);
    return Boolean(member);
  }

  async collectInviteWorkerState(guild) {
    const guildId = String(guild?.id || "").trim();
    const guildTier = getTier(guildId);
    const maxIndex = this.workerManager.getMaxWorkerIndex(guildTier);
    const workers = [];
    const statuses = this.workerManager.getAllStatuses();

    for (const status of statuses) {
      const slot = Number(status?.index || 0);
      if (!slot) continue;
      const worker = this.workerManager.getWorkerByIndex(slot, { prefer: "slot" });
      const requiredTier = this.getWorkerRequiredTierBySlot(slot);
      const tierLocked = slot > maxIndex;
      const resolvedClientId = String(worker?.getApplicationId?.() || worker?.config?.clientId || status?.clientId || "").trim();
      const inviteUrl = resolvedClientId && worker
        ? buildInviteUrl({ ...worker.config, clientId: resolvedClientId })
        : null;
      const alreadyInvited = worker ? await this.isWorkerAlreadyInvited(guild, worker) : false;

      workers.push({
        slot,
        botIndex: Number(status?.botIndex || worker?.config?.index || 0) || null,
        name: worker?.config?.name || status?.name || `Worker ${slot}`,
        requiredTier,
        tierLocked,
        online: Boolean(status?.online),
        inviteUrl,
        alreadyInvited,
        selectable: !tierLocked && !alreadyInvited && Boolean(inviteUrl),
      });
    }

    workers.sort((a, b) => a.slot - b.slot);
    const selectableWorkers = workers.filter((worker) => worker.selectable);
    const invitedWorkers = workers.filter((worker) => worker.alreadyInvited && !worker.tierLocked);
    const lockedWorkers = workers.filter((worker) => worker.tierLocked);
    return {
      guildTier,
      maxIndex,
      workers,
      selectableWorkers,
      invitedWorkers,
      lockedWorkers,
    };
  }

  formatWorkerBadge(worker) {
    const botIndexLabel = worker.botIndex ? `, BOT_${worker.botIndex}` : "";
    return `#${worker.slot}${botIndexLabel}`;
  }

  formatWorkerList(items = [], maxLines = 8, moreLabel = "weitere") {
    if (!Array.isArray(items) || !items.length) return "-";
    const lines = items.slice(0, maxLines).map((item) => {
      return `\`${this.formatWorkerBadge(item)}\` ${item.name}`;
    });
    if (items.length > maxLines) {
      lines.push(`+${items.length - maxLines} ${moreLabel}`);
    }
    return lines.join("\n");
  }

  async buildInviteMenuPayload(interaction, { selectedWorkerSlot = null, hint = "" } = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
    const guild = interaction.guild || this.client.guilds.cache.get(interaction.guildId) || null;
    if (!guild) {
      return {
        content: t("Server konnte nicht gefunden werden.", "Could not resolve server."),
        embeds: [],
        components: [],
      };
    }

    const inviteState = await this.collectInviteWorkerState(guild);
    const moreLabel = t("weitere", "more");
    const selectedWorker = inviteState.selectableWorkers.find((worker) => worker.slot === Number(selectedWorkerSlot))
      || inviteState.selectableWorkers[0]
      || null;

    const embed = new EmbedBuilder()
      .setColor(BRAND.color)
      .setTitle(t("Worker-Bots einladen", "Invite worker bots"))
      .setDescription(
        t(
          `Plan: **${this.formatTierLabel(inviteState.guildTier, language)}** | Verfügbare Worker: **1-${inviteState.maxIndex}**\nWähle einen Worker unten aus und nutze den Invite-Button.`,
          `Plan: **${this.formatTierLabel(inviteState.guildTier, language)}** | Available workers: **1-${inviteState.maxIndex}**\nSelect a worker below and use the invite button.`
        )
      )
      .addFields(
        {
          name: t("Bereits eingeladen", "Already invited"),
          value: this.formatWorkerList(inviteState.invitedWorkers, 8, moreLabel),
          inline: true,
        },
        {
          name: t("Jetzt auswaehlbar", "Selectable now"),
          value: this.formatWorkerList(inviteState.selectableWorkers, 8, moreLabel),
          inline: true,
        },
        {
          name: t("Gesperrt durch Plan", "Locked by plan"),
          value: this.formatWorkerList(inviteState.lockedWorkers, 8, moreLabel),
          inline: false,
        }
      );

    if (selectedWorker) {
      embed.setFooter({
        text: t(
          `Ausgewaehlt: ${selectedWorker.name} (${this.formatWorkerBadge(selectedWorker)})`,
          `Selected: ${selectedWorker.name} (${this.formatWorkerBadge(selectedWorker)})`
        ),
      });
    } else {
      embed.setFooter({
        text: t(
          "Kein Worker auswaehlbar. Entweder schon eingeladen oder Plan-Limit erreicht.",
          "No worker is selectable. Workers are already invited or plan-limited."
        ),
      });
    }

    if (hint) {
      embed.addFields({
        name: t("Hinweis", "Note"),
        value: clipText(String(hint), 900),
        inline: false,
      });
    }

    const rows = [];
    const selectOptions = inviteState.selectableWorkers.slice(0, 25).map((worker) => ({
      label: clipText(`${worker.name}`, 90),
      description: clipText(`${this.formatWorkerBadge(worker)} - ${this.formatTierLabel(worker.requiredTier, language)}`, 90),
      value: String(worker.slot),
      default: selectedWorker ? worker.slot === selectedWorker.slot : false,
    }));

    if (selectOptions.length > 0) {
      const selectMenu = new StringSelectMenuBuilder()
        .setCustomId(INVITE_COMPONENT_ID_SELECT)
        .setPlaceholder(t("Worker-Bot auswaehlen", "Select worker bot"))
        .addOptions(selectOptions);
      rows.push(new ActionRowBuilder().addComponents(selectMenu));
    }

    const buttons = new ActionRowBuilder();
    if (selectedWorker?.inviteUrl) {
      buttons.addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(
            t(
              `Invite ${selectedWorker.name}`,
              `Invite ${selectedWorker.name}`
            )
          )
          .setURL(selectedWorker.inviteUrl)
      );
    } else {
      buttons.addComponents(
        new ButtonBuilder()
          .setCustomId(`${INVITE_COMPONENT_PREFIX}noop`)
          .setStyle(ButtonStyle.Secondary)
          .setLabel(t("Kein Invite verfügbar", "No invite available"))
          .setDisabled(true)
      );
    }

    buttons.addComponents(
      new ButtonBuilder()
        .setCustomId(INVITE_COMPONENT_ID_REFRESH)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("Aktualisieren", "Refresh")),
      new ButtonBuilder()
        .setCustomId(INVITE_COMPONENT_ID_CLOSE)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("Schliessen", "Close"))
    );
    rows.push(buttons);

    return {
      embeds: [embed],
      components: rows,
    };
  }

  async handleInviteComponentInteraction(interaction) {
    const { t, language } = this.createInteractionTranslator(interaction);
    if (this.role !== "commander" || !this.workerManager) {
      if (interaction.isRepliable?.()) {
        await interaction.reply({ content: t("Nur der Commander kann dieses Menue bedienen.", "Only the commander can use this menu."), flags: MessageFlags.Ephemeral });
      }
      return true;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content: t("Dieses Menue funktioniert nur auf Servern.", "This menu only works in servers."),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (interaction.customId === INVITE_COMPONENT_ID_CLOSE) {
      await interaction.update({
        content: t("Invite-Menue geschlossen.", "Invite menu closed."),
        embeds: [],
        components: [],
      });
      return true;
    }

    if (interaction.customId === INVITE_COMPONENT_ID_REFRESH || interaction.customId === INVITE_COMPONENT_ID_OPEN) {
      await interaction.deferUpdate();
      const payload = await this.buildInviteMenuPayload(interaction);
      await interaction.editReply(payload);
      return true;
    }

    if (interaction.customId === INVITE_COMPONENT_ID_SELECT && interaction.isStringSelectMenu()) {
      await interaction.deferUpdate();
      const selectedSlot = Number.parseInt(String(interaction.values?.[0] || ""), 10);
      const payload = await this.buildInviteMenuPayload(interaction, {
        selectedWorkerSlot: Number.isFinite(selectedSlot) ? selectedSlot : null,
      });
      await interaction.editReply(payload);
      return true;
    }

    if (interaction.customId.startsWith(INVITE_COMPONENT_PREFIX)) {
      await interaction.reply({
        content: t("Diese Aktion ist nicht mehr gültig. Bitte aktualisiere das Menü.", "This action is no longer valid. Please refresh the menu."),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    return false;
  }

  async buildWorkersStatusPayload(interaction, { hint = "", page = 0 } = {}) {
    return buildRuntimeWorkersStatusPayload(this, interaction, { hint, page });
  }

  async handleWorkersComponentInteraction(interaction) {
    const { t } = this.createInteractionTranslator(interaction);
    if (this.role !== "commander" || !this.workerManager) {
      if (interaction.isRepliable?.()) {
        await interaction.reply({
          content: t("Nur der Commander kann dieses Menue bedienen.", "Only the commander can use this menu."),
          flags: MessageFlags.Ephemeral,
        });
      }
      return true;
    }

    if (!interaction.guildId) {
      await interaction.reply({
        content: t("Dieses Menue funktioniert nur auf Servern.", "This menu only works in servers."),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    if (interaction.customId === WORKERS_COMPONENT_ID_REFRESH || interaction.customId === WORKERS_COMPONENT_ID_OPEN) {
      await interaction.deferUpdate();
      const payload = await this.buildWorkersStatusPayload(interaction);
      await interaction.editReply(payload);
      return true;
    }

    if (interaction.customId.startsWith(WORKERS_COMPONENT_ID_PAGE_PREFIX)) {
      const rawPage = interaction.customId.slice(WORKERS_COMPONENT_ID_PAGE_PREFIX.length);
      const nextPage = Number.parseInt(rawPage, 10);
      if (!Number.isFinite(nextPage) || nextPage < 0) {
        await interaction.reply({
          content: t("Diese Aktion ist nicht mehr gueltig. Bitte aktualisiere die Ansicht.", "This action is no longer valid. Please refresh the view."),
          flags: MessageFlags.Ephemeral,
        });
        return true;
      }
      await interaction.deferUpdate();
      const payload = await this.buildWorkersStatusPayload(interaction, { page: nextPage });
      await interaction.editReply(payload);
      return true;
    }

    if (interaction.customId.startsWith(WORKERS_COMPONENT_PREFIX)) {
      await interaction.reply({
        content: t("Diese Aktion ist nicht mehr gültig. Bitte aktualisiere die Ansicht.", "This action is no longer valid. Please refresh the view."),
        flags: MessageFlags.Ephemeral,
      });
      return true;
    }

    return false;
  }

  async handleComponentInteraction(interaction) {
    if (!interaction || (!interaction.isButton?.() && !interaction.isStringSelectMenu?.())) return false;
    const customId = String(interaction.customId || "");
    try {
      if (customId.startsWith(INVITE_COMPONENT_PREFIX)) {
        return this.handleInviteComponentInteraction(interaction);
      }
      if (customId.startsWith(WORKERS_COMPONENT_PREFIX)) {
        return this.handleWorkersComponentInteraction(interaction);
      }
      if (
        customId === PLAY_COMPONENT_ID_OPEN
        || customId === STATIONS_COMPONENT_ID_OPEN
        || customId.startsWith(PLAY_COMPONENT_PREFIX)
        || customId.startsWith(STATIONS_COMPONENT_PREFIX)
      ) {
        return handleRuntimePanelInteraction(this, interaction);
      }
      return false;
    } catch (err) {
      const { t } = this.createInteractionTranslator(interaction);
      log(
        "ERROR",
        `[${this.config.name}] Component interaction error (customId=${customId || "-"}) guild=${interaction?.guildId || "-"}: ${err?.stack || err}`
      );
      const payload = {
        content: t(
          "Aktion fehlgeschlagen. Bitte aktualisiere die Ansicht und versuche es erneut.",
          "Action failed. Please refresh the view and try again."
        ),
        flags: MessageFlags.Ephemeral,
      };
      try {
        if (interaction.deferred || interaction.replied) {
          await interaction.followUp(payload);
        } else {
          await interaction.reply(payload);
        }
      } catch {
        // ignore secondary reply failures
      }
      return true;
    }
  }

  buildHelpMessage(interaction) {
    return buildRuntimeHelpMessage(this, interaction);
  }

  getInteractionRoleIds(interaction) {
    const ids = new Set();
    const rawRoles = interaction?.member?.roles;

    if (rawRoles?.cache && typeof rawRoles.cache.keys === "function") {
      for (const roleId of rawRoles.cache.keys()) {
        const id = String(roleId || "").trim();
        if (/^\d{17,22}$/.test(id)) ids.add(id);
      }
    } else if (Array.isArray(rawRoles)) {
      for (const roleId of rawRoles) {
        const id = String(roleId || "").trim();
        if (/^\d{17,22}$/.test(id)) ids.add(id);
      }
    } else if (Array.isArray(rawRoles?.value)) {
      for (const roleId of rawRoles.value) {
        const id = String(roleId || "").trim();
        if (/^\d{17,22}$/.test(id)) ids.add(id);
      }
    }

    if (interaction?.guildId) {
      ids.add(String(interaction.guildId));
    }
    return [...ids];
  }

  formatPermissionRoleMentions(roleIds) {
    const ids = Array.isArray(roleIds) ? roleIds.filter((id) => /^\d{17,22}$/.test(String(id || "").trim())) : [];
    if (!ids.length) return "-";
    return ids.map((id) => `<@&${id}>`).join(", ");
  }

  checkCommandRolePermission(interaction, commandName) {
    const guildId = interaction?.guildId;
    const command = normalizePermissionCommandName(commandName);
    if (!guildId || !isPermissionManagedCommand(command)) {
      return { ok: true, enforced: false };
    }

    const { t } = this.createInteractionTranslator(interaction);

    const feature = requireFeature(guildId, "commandPermissions");
    if (!feature.ok) {
      return { ok: true, enforced: false };
    }

    if (this.hasPermissionAdminBypass(interaction)) {
      return { ok: true, enforced: true, bypass: true };
    }

    const roleIds = this.getInteractionRoleIds(interaction);
    const decision = evaluateCommandPermission(guildId, command, roleIds);
    if (decision.allowed) {
      return { ok: true, enforced: decision.configured, decision };
    }

    if (decision.reason === "deny") {
      const blocked = this.formatPermissionRoleMentions(decision.matchedRoleIds || decision.denyRoleIds);
      return {
        ok: false,
        enforced: true,
        decision,
        message: t(
          `Du darfst \`/${command}\` nicht nutzen. Deine Rolle ist dafür gesperrt (${blocked}).`,
          `You are not allowed to use \`/${command}\`. Your role is blocked for this command (${blocked}).`
        ),
      };
    }

    const requiredRoles = this.formatPermissionRoleMentions(decision.allowRoleIds);
    return {
      ok: false,
      enforced: true,
      decision,
      message: t(
        `Du darfst \`/${command}\` nicht nutzen. Erlaubte Rollen: ${requiredRoles}.`,
        `You are not allowed to use \`/${command}\`. Allowed roles: ${requiredRoles}.`
      ),
    };
  }

  async handlePermissionCommand(interaction) {
    const guildId = interaction.guildId;
    const { t, language } = this.createInteractionTranslator(interaction);

    if (!this.hasGuildManagePermissions(interaction)) {
      await interaction.reply({
        content: t(
          "Du brauchst die Berechtigung `Server verwalten` für `/perm`.",
          "You need the `Manage Server` permission for `/perm`."
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const feature = requireFeature(guildId, "commandPermissions");
    if (!feature.ok) {
      await interaction.reply({
        content: `${getFeatureRequirementMessage(feature, language)}\nUpgrade: ${BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R"}`,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    const sub = interaction.options.getSubcommand();
    const rawCommand = interaction.options.getString("command");
    const command = rawCommand ? normalizePermissionCommandName(rawCommand) : null;
    if (command && !isPermissionManagedCommand(command)) {
      await interaction.reply({
        content: t(
          `Unbekannter Command: \`${rawCommand}\``,
          `Unknown command: \`${rawCommand}\``
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "allow" || sub === "deny") {
      const role = interaction.options.getRole("role", true);
      const result = setCommandRolePermission(guildId, command, role.id, sub);
      if (!result.ok) {
        const storeMessage = translatePermissionStoreMessage(result.message, language);
        await interaction.reply({ content: t(`Fehler: ${storeMessage}`, `Error: ${storeMessage}`), flags: MessageFlags.Ephemeral });
        return;
      }
      await this.respondLongInteraction(
        interaction,
        `${t("Rolle", "Role")} ${role.toString()} ${t("ist jetzt fuer", "is now")} \`/${command}\` ${sub === "allow" ? t("erlaubt", "allowed") : t("gesperrt", "blocked")}.\n` +
          `Allow: ${this.formatPermissionRoleMentions(result.rule.allowRoleIds)}\n` +
          `Deny: ${this.formatPermissionRoleMentions(result.rule.denyRoleIds)}`,
        { flags: MessageFlags.Ephemeral }
      );
      return;
    }

    if (sub === "remove") {
      const role = interaction.options.getRole("role", true);
      const result = removeCommandRolePermission(guildId, command, role.id);
      if (!result.ok) {
        const storeMessage = translatePermissionStoreMessage(result.message, language);
        await interaction.reply({ content: t(`Fehler: ${storeMessage}`, `Error: ${storeMessage}`), flags: MessageFlags.Ephemeral });
        return;
      }
      await this.respondLongInteraction(
        interaction,
        `${t("Regel fuer", "Rule for")} ${role.toString()} ${t("bei", "on")} \`/${command}\` ${result.changed ? t("entfernt", "removed") : t("war nicht gesetzt", "was not set")}.\n` +
          `Allow: ${this.formatPermissionRoleMentions(result.rule.allowRoleIds)}\n` +
          `Deny: ${this.formatPermissionRoleMentions(result.rule.denyRoleIds)}`,
        { flags: MessageFlags.Ephemeral }
      );
      return;
    }

    if (sub === "reset") {
      const result = resetCommandPermissions(guildId, command || null);
      if (!result.ok) {
        const storeMessage = translatePermissionStoreMessage(result.message, language);
        await interaction.reply({ content: t(`Fehler: ${storeMessage}`, `Error: ${storeMessage}`), flags: MessageFlags.Ephemeral });
        return;
      }

      if (command) {
        await interaction.reply({
          content: result.changed
            ? t(`Regeln für \`/${command}\` wurden zurückgesetzt.`, `Rules for \`/${command}\` were reset.`)
            : t(`Für \`/${command}\` waren keine Regeln gesetzt.`, `No rules were configured for \`/${command}\`.`),
          flags: MessageFlags.Ephemeral,
        });
      } else {
        await interaction.reply({
          content: result.changed
            ? t("Alle Command-Regeln für diesen Server wurden zurückgesetzt.", "All command rules for this server were reset.")
            : t("Es waren keine Command-Regeln gesetzt.", "No command rules were configured."),
          flags: MessageFlags.Ephemeral,
        });
      }
      return;
    }

    if (sub === "list") {
      const rulesByCommand = getGuildCommandPermissionRules(guildId);
      const commands = command ? [command] : getSupportedPermissionCommands();
      const lines = [];

      for (const name of commands) {
        const rule = rulesByCommand[name] || { allowRoleIds: [], denyRoleIds: [] };
        const allowCount = rule.allowRoleIds.length;
        const denyCount = rule.denyRoleIds.length;
        if (!command && allowCount === 0 && denyCount === 0) continue;
        lines.push(
          `\`/${name}\` -> Allow: ${this.formatPermissionRoleMentions(rule.allowRoleIds)} | Deny: ${this.formatPermissionRoleMentions(rule.denyRoleIds)}`
        );
      }

      if (!lines.length) {
        await interaction.reply({
          content: command
            ? t(`Für \`/${command}\` sind keine Rollenregeln gesetzt.`, `No role rules are configured for \`/${command}\`.`)
            : t("Keine Command-Rollenregeln gesetzt.", "No command role rules are configured."),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const header = command
        ? t(`Regeln für \`/${command}\`:`, `Rules for \`/${command}\`:`)
        : t(`Aktive Command-Rollenregeln (${lines.length}):`, `Active command role rules (${lines.length}):`);
      await this.respondLongInteraction(interaction, `${header}\n${lines.join("\n")}`, { flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.reply({ content: t("Unbekannte /perm Aktion.", "Unknown /perm action."), flags: MessageFlags.Ephemeral });
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

  async handleLanguageCommand(interaction) {
    const guildId = interaction.guildId;
    const sub = interaction.options.getSubcommand();
    const { t, language } = this.createInteractionTranslator(interaction);
    const override = getGuildLanguage(guildId);
    const effectiveLanguage = this.resolveInteractionLanguage(interaction);
    const clientLanguage = resolveLanguageFromDiscordLocale(interaction.locale, language);
    const suggestOverride = !override && clientLanguage !== effectiveLanguage
      ? `\n${t(
        `Tipp: Mit \`/language set value:${clientLanguage}\` kannst du OmniFM für diesen Server fest auf \`${clientLanguage}\` stellen.`,
        `Tip: Use \`/language set value:${clientLanguage}\` to force OmniFM to \`${clientLanguage}\` for this server.`
      )}`
      : "";

    if (sub === "show") {
      await interaction.reply({
        content:
          `**${t("OmniFM Sprache", "OmniFM language")}**\n` +
          `${t("Aktiv", "Active")}: \`${effectiveLanguage}\`\n` +
          `${t("Quelle", "Source")}: ${override ? t("Manuell gesetzt", "Manually set") : t("Discord-Server oder Client-Sprache", "Discord server or client locale")}\n` +
          `${t("Deine Discord-Client-Sprache", "Your Discord client language")}: \`${clientLanguage}\`` +
          suggestOverride,
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (!this.hasGuildManagePermissions(interaction)) {
      await interaction.reply({
        content: t(
          "Du brauchst die Berechtigung `Server verwalten` für `/language set` und `/language reset`.",
          "You need the `Manage Server` permission for `/language set` and `/language reset`."
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "set") {
      const value = normalizeLanguage(interaction.options.getString("value", true), getDefaultLanguage());
      setGuildLanguage(guildId, value);
      await interaction.reply({
        content: t(
          `Sprache für diesen Server wurde auf \`${value}\` gesetzt.`,
          `Language for this server was set to \`${value}\`.`
        ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "reset") {
      const changed = resetGuildLanguage(guildId);
      const next = this.resolveInteractionLanguage(interaction);
      await interaction.reply({
        content: changed
          ? t(
            `Manuelle Sprache entfernt. OmniFM nutzt jetzt wieder Discord-Server oder Client-Sprache (\`${next}\`).`,
            `Manual language override removed. OmniFM now uses the Discord server or client locale again (\`${next}\`).`
          )
          : t(
            `Es war keine manuelle Sprache gesetzt. Aktive Sprache bleibt \`${next}\`.`,
            `No manual language override was set. Active language remains \`${next}\`.`
          ),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({ content: t("Unbekannte /language Aktion.", "Unknown /language action."), flags: MessageFlags.Ephemeral });
  }

  async respondInteraction(interaction, payload) {
    // Convert deprecated ephemeral to flags
    const finalPayload = { ...payload };
    if (finalPayload.ephemeral === true) {
      finalPayload.flags = MessageFlags.Ephemeral;
      delete finalPayload.ephemeral;
    } else if (finalPayload.ephemeral === false) {
      delete finalPayload.ephemeral;
    }

    if (interaction.deferred || interaction.replied) {
      const editPayload = { ...finalPayload };
      delete editPayload.flags;
      if (!editPayload.content && !editPayload.embeds) {
        const { t } = this.createInteractionTranslator(interaction);
        editPayload.content = t("Es ist ein Fehler aufgetreten.", "An error occurred.");
      }
      return interaction.editReply(editPayload);
    }
    return interaction.reply(finalPayload);
  }

  async respondLongInteraction(interaction, content, { ephemeral = true } = {}) {
    const chunks = splitTextForDiscord(content, 1900);
    if (!chunks.length) {
      await this.respondInteraction(interaction, { content: "-", ephemeral });
      return;
    }

    await this.respondInteraction(interaction, { content: chunks[0], ephemeral });
    for (let i = 1; i < chunks.length; i++) {
      await interaction.followUp({ content: chunks[i], flags: ephemeral ? MessageFlags.Ephemeral : 0 });
    }
  }

  async connectToVoice(interaction, targetChannel = null, { silent = false } = {}) {
    const { t } = this.createInteractionTranslator(interaction);
    const sendError = async (message) => {
      if (!silent) {
        await this.respondInteraction(interaction, { content: message, flags: MessageFlags.Ephemeral });
      }
      return { connection: null, error: message };
    };

    const member = interaction.member;
    const channel = targetChannel || member?.voice?.channel;
    if (!channel) {
      return sendError(
        buildVoiceChannelAccessMessage({ issue: "select_channel", t })
      );
    }
    if (!channel.isVoiceBased()) {
      return sendError(t("Bitte waehle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel."));
    }
    if (channel.guildId !== interaction.guildId) {
      return sendError(t("Der ausgewaehlte Channel ist nicht in diesem Server.", "The selected channel is not in this server."));
    }

    const guild = interaction.guild;
    if (!guild) {
      return sendError(t("Guild konnte nicht ermittelt werden.", "Could not resolve guild."));
    }

    const accessCheck = await this.validateVoiceChannelAccess(guild, channel, { language });
    if (!accessCheck.ok) {
      return sendError(accessCheck.message);
    }

    const guildId = interaction.guildId;
    await this.refreshVoiceGuardSettings(guildId).catch(() => null);
    const state = this.getState(guildId);
    state.lastChannelId = channel.id;
    this.clearReconnectTimer(state);
    state.reconnectAttempts = 0;

    if (state.connection) {
      const currentChannelId = state.connection.joinConfig?.channelId;
      if (currentChannelId === channel.id) {
        state.restoreBlockedUntil = 0;
        state.restoreBlockedAt = 0;
        state.restoreBlockCount = 0;
        state.restoreBlockReason = null;
        if (channel.type === ChannelType.GuildStageVoice) {
          await this.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
        }
        this.queueVoiceStateReconcile(guildId, "voice-existing", 900);
        return { connection: state.connection, error: null };
      }

      state.shouldReconnect = false;
      this.clearReconnectTimer(state);
      this.clearNowPlayingTimer(state);
      state.connection.destroy();
      state.connection = null;
    }

    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      group: this.voiceGroup,
      selfDeaf: true
    });
    log("INFO", `[${this.config.name}] Join Voice: guild=${guild.id} channel=${channel.id} group=${this.voiceGroup}`);
    state.connection = connection;

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    } catch {
      if (state.connection === connection) {
        state.connection = null;
      }
      connection.destroy();
      return sendError(t("Konnte dem Voice-Channel nicht beitreten.", "Could not join the voice channel."));
    }

    const joinedVoiceState = await this.confirmBotVoiceChannel(guildId, channel.id, { timeoutMs: 8_000, intervalMs: 700 });
    if (!joinedVoiceState) {
      if (state.connection === connection) {
        state.connection = null;
      }
      try { connection.destroy(); } catch {}
      return sendError(t("Voice-Verbindung war instabil. Bitte erneut versuchen.", "Voice connection was unstable. Please try again."));
    }

    connection.subscribe(state.player);
    state.reconnectAttempts = 0;
    state.lastReconnectAt = new Date().toISOString();
    state.restoreBlockedUntil = 0;
    state.restoreBlockedAt = 0;
    state.restoreBlockCount = 0;
    state.restoreBlockReason = null;
    this.clearReconnectTimer(state);
    this.noteNetworkRecoverySuccess(guildId, `${this.config.name} voice-ready guild=${guildId}`);
    recordConnectionEvent(guildId, {
      botId: this.config.id || "",
      eventType: "connect",
      channelId: channel.id || "",
      details: "Voice connection ready",
    });

    this.attachConnectionHandlers(guildId, connection);
    if (channel.type === ChannelType.GuildStageVoice) {
      await this.ensureStageChannelReady(guild, channel, { createInstance: true, ensureSpeaker: true });
    }
    this.queueVoiceStateReconcile(guildId, "voice-joined", 1200);
    return { connection, error: null };
  }

  async tryReconnect(guildId) {
    return tryRuntimeReconnect(this, guildId);
  }

  handleNetworkRecovered(recoveryEvent = null) {
    return handleRuntimeNetworkRecovered(this, recoveryEvent);
  }

  scheduleReconnect(guildId, options = {}) {
    return scheduleRuntimeReconnect(this, guildId, options);
  }

  getGuildAccess(guildId) {
    const tierConfig = getTierConfig(guildId);
    const guildTier = tierConfig.tier || "free";
    const requiredTier = this.config.requiredTier || "free";
    const tierAllowed = (TIER_RANK[guildTier] ?? 0) >= (TIER_RANK[requiredTier] ?? 0);
    const botIndex = Number(this.config.index || 1);
    const maxBots = Number(tierConfig.maxBots || 0);
    const workerSlot = this.role === "worker"
      ? Number(this.workerSlot || 0)
      : null;
    const withinBotLimit = isWithinWorkerPlanLimit({
      role: this.role,
      workerSlot,
      botIndex,
      maxBots,
    });

    return {
      allowed: tierAllowed && withinBotLimit,
      guildTier,
      requiredTier,
      tierAllowed,
      botIndex,
      workerSlot,
      maxBots,
      withinBotLimit,
    };
  }

  async replyAccessDenied(interaction, access) {
    const { t } = this.createInteractionTranslator(interaction);
    if (!access.tierAllowed) {
      await interaction.reply({
        content:
          t(
            `Dieser Bot erfordert **${access.requiredTier.toUpperCase()}**.\n` +
              `Dein Server hat aktuell **${access.guildTier.toUpperCase()}**.\n` +
              `Upgrade: ${BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R"}`,
            `This bot requires **${access.requiredTier.toUpperCase()}**.\n` +
              `Your server currently has **${access.guildTier.toUpperCase()}**.\n` +
              `Upgrade: ${BRAND.upgradeUrl || "https://discord.gg/UeRkfGS43R"}`
          ),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    await interaction.reply(
      botLimitEmbed(
        access.guildTier,
        access.maxBots,
        access.workerSlot || access.botIndex,
        this.resolveInteractionLanguage(interaction)
      )
    );
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
        const resolvedVolume = Number.isFinite(parsedVolume)
          ? Math.max(0, Math.min(100, parsedVolume))
          : (Number.isFinite(Number(state.volume)) ? Math.max(0, Math.min(100, Number(state.volume))) : 100);
        state.volume = resolvedVolume;
        state.volumePreferenceSet = true;
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
      setBotGuildVolume(this.config.id, guildId, normalizedValue);

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
  }

  getPlayingGuildCount() {
    let count = 0;
    for (const [guildId, state] of this.guildState.entries()) {
      if (isRuntimePlaybackActive(this, guildId, state)) count += 1;
    }
    return count;
  }

  buildStatusSnapshot({ includeGuildDetails = false } = {}) {
    const stats = this.collectStats();
    const resolvedClientId = this.getApplicationId() || this.config.clientId;
    const isPremiumBot = this.config.requiredTier && this.config.requiredTier !== "free";
    const accentColor = this.config.requiredTier === "ultimate"
      ? "#BD00FF"
      : this.config.requiredTier === "pro"
        ? "#FFB800"
        : "#00F0FF";
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
            || (Number(state.reconnectAttempts || 0) || 0) > 0
          )
        ),
        reconnectAttempts: Number(state.reconnectAttempts || 0) || 0,
        streamErrorCount: Number(state.streamErrorCount || 0) || 0,
        shouldReconnect: state.shouldReconnect === true,
        meta: state.currentMeta || null,
      };

      const reconnectCount = Number(state.reconnectCount || 0) || 0;
      if (reconnectCount > 0) detail.reconnectCount = reconnectCount;

      if (state.lastReconnectAt) detail.lastReconnectAt = state.lastReconnectAt;
      if (state.reconnectTimer) detail.reconnectPending = true;
      if (state.reconnectInFlight === true) detail.reconnectInFlight = true;
      if (state.streamRestartTimer) detail.streamRestartPending = true;
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
  }

  getPublicStatus() {
    return this.buildStatusSnapshot();
  }

  getDashboardStatus() {
    return this.buildStatusSnapshot({ includeGuildDetails: true });
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
