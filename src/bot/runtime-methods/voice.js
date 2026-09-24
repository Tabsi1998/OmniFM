// Voice channel access, the voice channel status text, presence and the
// first voice connection of a session.
// BotRuntime methods, moved out of runtime.js unchanged (#210) and mixed into
// BotRuntime.prototype there, so `this` is the runtime as before.
import { ChannelType, PermissionFlagsBits, MessageFlags } from "discord.js";
import { joinVoiceChannel, VoiceConnectionStatus, entersState } from "@discordjs/voice";
import { log } from "../../lib/logging.js";
import { clipText } from "../../lib/helpers.js";
import { recordConnectionEvent } from "../../listening-stats-store.js";
import { BRAND } from "../../config/plans.js";
import { normalizeLanguage, getDefaultLanguage } from "../../i18n.js";
import { buildVoiceChannelAccessMessage } from "../../lib/user-facing-setup.js";
import { buildRuntimePresenceActivity } from "../runtime-presence.js";
import { getRuntimeConnectedChannelId } from "../runtime-live-state.js";
import {
  VOICE_CHANNEL_STATUS_ENABLED,
  VOICE_CHANNEL_STATUS_TEMPLATE,
  VOICE_CHANNEL_STATUS_MAX_LENGTH,
  VOICE_CHANNEL_STATUS_REFRESH_MS,
} from "../runtime-shared.js";

const voiceMethods = {
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
  },

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
  },

  renderVoiceStatusText(stationName) {
    const station = clipText(String(stationName || "").trim(), 60) || "Radio";
    const botName = clipText(String(this.config?.name || BRAND.name || "OmniFM"), 24);
    const raw = VOICE_CHANNEL_STATUS_TEMPLATE
      .replace(/\{station\}/gi, station)
      .replace(/\{bot\}/gi, botName)
      .trim();
    if (!raw) return "";
    return clipText(raw, VOICE_CHANNEL_STATUS_MAX_LENGTH);
  },

  invalidateVoiceStatus(state, { clearText = false } = {}) {
    if (!state) return;
    state.voiceStatusNeedsSync = true;
    state.voiceStatusChannelId = "";
    state.lastVoiceStatusSyncAt = 0;
    state.lastVoiceStatusErrorAt = 0;
    if (clearText) {
      state.voiceStatusText = "";
    }
  },

  shouldRefreshVoiceStatus(state, desired, channelId, { force = false } = {}) {
    if (!state) return false;
    if (force) return true;
    if (state.voiceStatusNeedsSync) return true;
    if (String(state.voiceStatusChannelId || "") !== String(channelId || "").trim()) return true;
    if (String(state.voiceStatusText || "") !== String(desired || "")) return true;
    if (!desired) return false;
    const lastSyncAt = Number(state.lastVoiceStatusSyncAt || 0);
    return !lastSyncAt || (Date.now() - lastSyncAt) >= VOICE_CHANNEL_STATUS_REFRESH_MS;
  },

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
  },

  buildPresenceActivity() {
    return buildRuntimePresenceActivity(this);
  },

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
  },

  startPresenceRotation() {
    if (this._presenceInterval) return;
    this._presenceInterval = setInterval(() => this.updatePresence(), 30000);
  },

  stopPresenceRotation() {
    if (this._presenceInterval) {
      clearInterval(this._presenceInterval);
      this._presenceInterval = null;
    }
  },

  async connectToVoice(interaction, targetChannel = null, { silent = false } = {}) {
    const { t, language } = this.createInteractionTranslator(interaction);
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
    if (state.parkedReason) {
      log("INFO", `[${this.config.name}] Geparktes Ziel durch /play ersetzt guild=${guildId} (grund=${state.parkedReason})`);
      state.parkedReason = null;
      state.parkedAt = 0;
      state.parkedDetail = null;
    }
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
  },
};

export { voiceMethods };
