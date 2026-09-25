import { ChannelType, PermissionFlagsBits } from "discord.js";
import {
  joinVoiceChannel,
  VoiceConnectionStatus,
  entersState,
} from "@discordjs/voice";

import { log } from "../lib/logging.js";
import { clipText, waitMs } from "../lib/helpers.js";
import { BRAND } from "../config/plans.js";
import { recordConnectionEvent } from "../listening-stats-store.js";
import { recordPlaybackPhase } from "./playback-phase.js";

function clearRestoreBlockState(state) {
  if (!state || (
    !state.restoreBlockedUntil
    && !state.restoreBlockedAt
    && !state.restoreBlockCount
    && !state.restoreBlockReason
  )) {
    return;
  }
  state.restoreBlockedUntil = 0;
  state.restoreBlockedAt = 0;
  state.restoreBlockCount = 0;
  state.restoreBlockReason = null;
}

async function waitForVoiceConnectToSettle(state, timeoutMs = 30_000) {
  const startedAt = Date.now();
  while (state?.voiceConnectInFlight && (Date.now() - startedAt) < timeoutMs) {
    await waitMs(150);
  }
}

export async function resolveRuntimeGuildVoiceChannel(runtime, guildId, channelId) {
  const guild = runtime.client.guilds.cache.get(guildId) || await runtime.client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { guild: null, channel: null };

  const channel = guild.channels.cache.get(channelId) || await guild.channels.fetch(channelId).catch(() => null);
  if (!channel || !channel.isVoiceBased()) return { guild, channel: null };
  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    return { guild, channel: null };
  }

  return { guild, channel };
}

export async function ensureRuntimeStageChannelReady(
  runtime,
  guild,
  channel,
  {
    topic = null,
    guildScheduledEventId = null,
    createInstance = true,
    ensureSpeaker = true,
  } = {}
) {
  if (!guild || !channel || channel.type !== ChannelType.GuildStageVoice) return null;

  const me = await runtime.resolveBotMember(guild);
  if (!me) return null;

  const desiredTopic = clipText(
    String(topic || "").trim() || channel.topic || `${BRAND.name} Live`,
    120
  );

  let stageInstance = channel.stageInstance || await guild.stageInstances.fetch(channel.id).catch(() => null);

  if (!stageInstance && createInstance && desiredTopic) {
    const createOptions = {
      topic: desiredTopic,
      sendStartNotification: false,
    };
    if (/^\d{17,22}$/.test(String(guildScheduledEventId || ""))) {
      createOptions.guildScheduledEvent = String(guildScheduledEventId);
    }
    stageInstance = await channel.createStageInstance(createOptions).catch((err) => {
      log(
        "WARN",
        `[${runtime.config.name}] Stage-Instance konnte nicht erstellt werden (guild=${guild.id}, channel=${channel.id}): ${err?.message || err}`
      );
      return null;
    });
    // OmniFM opened this Stage, so a stop ends it again (endOwnedStageInstance).
    const state = stageInstance ? runtime.guildState?.get?.(guild.id) : null;
    if (state) state.ownedStageChannelId = channel.id;
    if (!stageInstance) {
      stageInstance = channel.stageInstance || await guild.stageInstances.fetch(channel.id).catch(() => null);
    }
  }

  if (stageInstance && desiredTopic && stageInstance.topic !== desiredTopic) {
    stageInstance = await stageInstance.setTopic(desiredTopic).catch((err) => {
      log(
        "WARN",
        `[${runtime.config.name}] Stage-Topic Update fehlgeschlagen (guild=${guild.id}, channel=${channel.id}): ${err?.message || err}`
      );
      return stageInstance;
    });
  }

  if (ensureSpeaker && me.voice?.channelId === channel.id) {
    const perms = channel.permissionsFor(me);
    if (perms?.has(PermissionFlagsBits.MuteMembers)) {
      await me.voice.setSuppressed(false).catch(() => null);
    } else {
      await me.voice.setRequestToSpeak(true).catch(() => null);
    }
  }

  return stageInstance;
}

/**
 * Ends the Stage OmniFM opened itself, when the stream stops: otherwise the
 * Stage stays "live" with nobody on it and its server event keeps running
 * (Discord ends a Stage's event with the Stage). A Stage someone else opened
 * stays as it is.
 */
export async function endOwnedStageInstance(runtime, guildId, state) {
  const channelId = String(state?.ownedStageChannelId || "").trim();
  if (!channelId) return false;
  state.ownedStageChannelId = null;
  const guild = runtime.client?.guilds?.cache?.get?.(guildId) || null;
  const instance = guild ? await guild.stageInstances?.fetch?.(channelId).catch(() => null) : null;
  if (!instance) return false;
  try {
    await instance.delete();
    return true;
  } catch (err) {
    log("WARN", `[${runtime.config?.name}] Stage konnte nicht beendet werden (guild=${guildId}, channel=${channelId}): ${err?.message || err}`);
    return false;
  }
}

export async function ensureRuntimeVoiceConnectionForChannel(runtime, guildId, channelId, state, { source = "play" } = {}) {
  if (!state) {
    state = runtime.getState(guildId);
  }
  const connectSource = String(source || "play").trim() || "play";
  if (state.voiceConnectInFlight) {
    await waitForVoiceConnectToSettle(state);
    const settledChannelId = String(state.connection?.joinConfig?.channelId || "").trim();
    if (state.connection && settledChannelId === String(channelId || "").trim()) {
      const { guild, channel } = await runtime.resolveGuildVoiceChannel(guildId, channelId);
      return { connection: state.connection, guild, channel };
    }
  }
  if (state.voiceConnectInFlight) {
    throw new Error("Voice-Verbindung wird bereits aufgebaut.");
  }

  state.voiceConnectInFlight = true;
  recordPlaybackPhase(runtime, guildId, state, "voice-connect");
  try {
  const { guild, channel } = await runtime.resolveGuildVoiceChannel(guildId, channelId);
  if (!guild) throw new Error("Guild nicht gefunden.");
  if (!channel) throw new Error("Voice- oder Stage-Channel nicht gefunden.");

  const me = await runtime.resolveBotMember(guild);
  if (!me) throw new Error("Bot-Mitglied nicht aufloesbar.");

  const perms = channel.permissionsFor(me);
  if (!perms?.has(PermissionFlagsBits.Connect)) {
    throw new Error(`Keine Connect-Berechtigung fuer ${channel.toString()}.`);
  }
  if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
    throw new Error(`Keine Speak-Berechtigung fuer ${channel.toString()}.`);
  }

  const previousChannelId = String(state.connection?.joinConfig?.channelId || state.lastChannelId || "").trim();
  state.lastChannelId = channel.id;
  if (previousChannelId && previousChannelId !== channel.id) {
    runtime.markNowPlayingTargetDirty(state, channel.id);
    runtime.invalidateVoiceStatus?.(state);
  }

    if (state.connection) {
      const currentChannelId = state.connection.joinConfig?.channelId;
      if (currentChannelId === channel.id) {
        state.shouldReconnect = true;
        state.voiceDisconnectObservedAt = 0;
        clearRestoreBlockState(state);
        if (channel.type === ChannelType.GuildStageVoice) {
          await runtime.ensureStageChannelReady(guild, channel, { createInstance: false, ensureSpeaker: true });
        }
        runtime.queueVoiceStateReconcile(guildId, "voice-existing", 900);
        return { connection: state.connection, guild, channel };
    }

    const previousShouldReconnect = state.shouldReconnect;
    state.shouldReconnect = false;
    runtime.clearReconnectTimer(state);
    runtime.clearNowPlayingTimer(state);
    try { state.connection.destroy(); } catch {}
    state.connection = null;
    state.shouldReconnect = previousShouldReconnect;
  }

  const originalAdapter = guild.voiceAdapterCreator;
  const botName = runtime.config.name;
  const wrappedAdapter = (methods) => {
    const adapter = originalAdapter(methods);
    const originalSendPayload = adapter.sendPayload.bind(adapter);
    adapter.sendPayload = (data) => {
      const result = originalSendPayload(data);
      if (!result) {
        log("WARN", `[${botName}] Voice sendPayload returned false for guild=${guildId} (shard not ready?)`);
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
    log("INFO", `[${botName}] VoiceState: ${oldStatus} -> ${newStatus} guild=${guildId}`);
  });
  connection.on("debug", (msg) => {
    if (msg.includes("error") || msg.includes("Error") || msg.includes("timeout") || msg.includes("close") || msg.includes("destroy")) {
      log("DEBUG", `[${botName}] VoiceDebug guild=${guildId}: ${msg}`);
    }
  });

  state.connection = connection;

  try {
    await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
  } catch {
    log("WARN", `[${runtime.config.name}] Voice-Timeout: guild=${guildId} channel=${channel.id} (${channel.name || "-"}) state=${connection.state?.status || "unknown"}`);
    if (state.connection === connection) {
      state.connection = null;
    }
    try { connection.destroy(); } catch {}
    runtime.noteNetworkRecoveryFailure(guildId, `${runtime.config.name} voice-connect-timeout`, `guild=${guildId} channel=${channel.id}`);
    throw new Error("Voice-Verbindung konnte nicht hergestellt werden.");
  }

  const joinedVoiceState = await runtime.confirmBotVoiceChannel(guildId, channel.id, { timeoutMs: 10_000, intervalMs: 700 });
  if (!joinedVoiceState) {
    log("WARN", `[${runtime.config.name}] Voice-Confirm fehlgeschlagen: guild=${guildId} channel=${channel.id} (${channel.name || "-"})`);
    if (state.connection === connection) {
      state.connection = null;
    }
    try { connection.destroy(); } catch {}
    throw new Error("Voice-Verbindung ist nicht stabil genug.");
  }

  if (!state.shouldReconnect && !state.currentStationKey) {
    if (state.connection === connection) {
      state.connection = null;
    }
    try { connection.destroy(); } catch {}
    throw new Error("Voice-Verbindung wurde waehrend des Aufbaus abgebrochen.");
  }

  connection.subscribe(state.player);
  state.reconnectAttempts = 0;
  state.lastReconnectAt = new Date().toISOString();
  state.shouldReconnect = true;
  state.voiceDisconnectObservedAt = 0;
  clearRestoreBlockState(state);
  if (state.parkedReason) {
    log("INFO", `[${runtime.config.name}] Geparktes Ziel wieder aktiv guild=${guildId} channel=${channel.id} (grund=${state.parkedReason})`);
    state.parkedReason = null;
    state.parkedAt = 0;
    state.parkedDetail = null;
  }
  runtime.clearReconnectTimer(state);
  runtime.attachConnectionHandlers(guildId, connection);
  runtime.noteNetworkRecoverySuccess(guildId, `${runtime.config.name} voice-ready guild=${guildId}`);
  recordConnectionEvent(guildId, {
    botId: runtime.config.id || "",
    eventType: "connect",
    channelId: channel.id || "",
    details: `Voice connection ready (${connectSource})`,
  });

  if (channel.type === ChannelType.GuildStageVoice) {
    await runtime.ensureStageChannelReady(guild, channel, { createInstance: false, ensureSpeaker: true });
  }

  runtime.queueVoiceStateReconcile(guildId, "voice-ensure", 1200);

  return { connection, guild, channel };
  } finally {
    state.voiceConnectInFlight = false;
    recordPlaybackPhase(runtime, guildId, state, "voice-connect-done");
  }
}
