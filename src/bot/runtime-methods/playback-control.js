// OmniFM: play, stop, pause, resume and volume per server.
// BotRuntime methods, split out of src/bot/runtime.js (#295); mixed into
// BotRuntime.prototype there, so `this` is the runtime as before.
import { ChannelType } from "discord.js";
import { log } from "../../lib/logging.js";
import { applyVolumeTransformerLevel } from "../../lib/helpers.js";
import { setBotGuildVolume, getBotGuildVolume } from "../../bot-state.js";
import { isRuntimePlaybackActive } from "../runtime-live-state.js";
import { endOwnedStageInstance } from "../runtime-voice.js";
import { recordPlaybackPhase } from "../playback-phase.js";
// playInGuild and friends run through the class's own serializer, also on test doubles.
import { BotRuntime } from "../runtime.js";

const playbackControlMethods = {
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
  },

  /**
   * Programmatic stop - used by Commander to stop a Worker in a guild.
   */
  async stopInGuild(guildId) {
    return BotRuntime.prototype.runSerializedGuildOperation.call(this, guildId, "stop", async () => {
      const state = this.guildState.get(guildId);
      if (!state) return { ok: false, error: "Kein State für diesen Server." };

      this.clearRestoreRetry(guildId);
      // A stop ends a sleep timer too (#275).
      this.clearSleepTimer?.(guildId);
      state.shouldReconnect = false;
      // A Stage OmniFM opened ends with the stream (and with it its server event).
      await endOwnedStageInstance(this, guildId, state);
      this.resetVoiceSession(guildId, state, { preservePlaybackTarget: false, clearLastChannel: true });
      recordPlaybackPhase(this, guildId, state, "stop");

      return { ok: true };
    });
  },

  /**
   * Programmatic pause.
   */
  async pauseInGuild(guildId) {
    return BotRuntime.prototype.runSerializedGuildOperation.call(this, guildId, "pause", async () => {
      const state = this.guildState.get(guildId);
      if (!state?.currentStationKey) return { ok: false, error: "Es läuft nichts." };
      state.player.pause(true);
      return { ok: true };
    });
  },

  /**
   * Programmatic resume.
   */
  async resumeInGuild(guildId) {
    return BotRuntime.prototype.runSerializedGuildOperation.call(this, guildId, "resume", async () => {
      const state = this.guildState.get(guildId);
      if (!state?.currentStationKey) return { ok: false, error: "Es läuft nichts." };
      state.player.unpause();
      return { ok: true };
    });
  },

  /**
   * Programmatic volume set.
   */
  async setVolumeInGuild(guildId, value) {
    return BotRuntime.prototype.runSerializedGuildOperation.call(this, guildId, "set-volume", async () => {
      const parsedValue = Number.parseInt(String(value ?? ""), 10);
      if (!Number.isFinite(parsedValue)) {
        return { ok: false, error: "Ungültige Lautstärke." };
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
            log("WARN", `[${this.config.name}] Now-Playing-Update nach Lautstärkewechsel fehlgeschlagen: ${err?.message || err}`);
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
  },
};

export { playbackControlMethods };
