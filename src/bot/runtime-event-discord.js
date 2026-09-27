// OmniFM: scheduled events: time windows, stage channels, Discord events and announcements.
// Split out of src/bot/runtime-events.js (#295).
import {
  ChannelType,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  PermissionFlagsBits,
} from "discord.js";
import { log } from "../lib/logging.js";
import { clipText } from "../lib/helpers.js";
import { languagePick } from "../lib/language.js";
import { isStageChannel, splitStageModeratorBots } from "./stage-moderator.js";
import {
  EVENT_FALLBACK_TIME_ZONE,
  buildDiscordScheduledEventRecurrenceRule,
  buildEventDateTimeFromParts,
  formatDateTime,
  normalizeEventTimeZone,
  renderEventAnnouncement,
} from "../lib/event-time.js";
import { patchScheduledEvent } from "../scheduled-events-store.js";
import { BRAND } from "../config/plans.js";
import {
  resolveRuntimeGuildVoiceChannel,
  ensureRuntimeStageChannelReady,
  ensureRuntimeVoiceConnectionForChannel,
} from "./runtime-voice.js";

export function parseEventWindowInput(runtime, {
  startRaw = undefined,
  startDateRaw = undefined,
  startTimeRaw = undefined,
  endRaw = undefined,
  endDateRaw = undefined,
  endTimeRaw = undefined,
  baseRunAtMs = 0,
  baseDurationMs = 0,
  requestedTimeZone = "",
  allowImmediate = false,
} = {}, language = "de") {
  const now = Date.now();
  let runAtMs = Number.parseInt(String(baseRunAtMs || 0), 10);
  let timeZone = normalizeEventTimeZone(requestedTimeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;

  const hasStartInput = [startRaw, startDateRaw, startTimeRaw].some((value) => String(value || "").trim());
  if (hasStartInput) {
    const parsedStart = buildEventDateTimeFromParts({
      rawDateTime: startRaw,
      rawDate: startDateRaw,
      rawTime: startTimeRaw,
      language,
      preferredTimeZone: timeZone,
      fallbackRunAtMs: runAtMs || now,
      nowMs: now,
    });
    if (!parsedStart.ok) return parsedStart;
    runAtMs = parsedStart.runAtMs;
    timeZone = parsedStart.timeZone || timeZone;
  }

  if (!Number.isFinite(runAtMs) || runAtMs <= 0) {
    return { ok: false, message: languagePick(language, "Startzeit fehlt oder ist ungültig.", "Start time is missing or invalid.") };
  }

  let durationMs = Math.max(0, Number.parseInt(String(baseDurationMs || 0), 10) || 0);
  let endAtMs = durationMs > 0 ? runAtMs + durationMs : 0;

  const hasEndInput = [endRaw, endDateRaw, endTimeRaw].some((value) => value !== undefined && value !== null && String(value || "").trim());
  if (hasEndInput) {
    const rawEndText = String(endRaw || "").trim().toLowerCase();
    if (["-", "clear", "none", "off"].includes(rawEndText)) {
      durationMs = 0;
      endAtMs = 0;
    } else {
      const parsedEnd = buildEventDateTimeFromParts({
        rawDateTime: endRaw,
        rawDate: endDateRaw,
        rawTime: endTimeRaw,
        language,
        preferredTimeZone: timeZone,
        fallbackRunAtMs: runAtMs,
        nowMs: now,
      });
      if (!parsedEnd.ok) return parsedEnd;
      if (parsedEnd.runAtMs <= runAtMs) {
        return {
          ok: false,
          message: languagePick(language, "Endzeit muss nach der Startzeit liegen.", "End time must be after the start time."),
        };
      }
      durationMs = parsedEnd.runAtMs - runAtMs;
      endAtMs = parsedEnd.runAtMs;
    }
  } else if (hasStartInput && durationMs > 0) {
    endAtMs = runAtMs + durationMs;
  }

  if (allowImmediate && runAtMs <= (now + 60_000) && runAtMs >= (now - 60_000)) {
    runAtMs = now;
    if (durationMs > 0) {
      endAtMs = runAtMs + durationMs;
    }
  }

  return { ok: true, runAtMs, timeZone, durationMs, endAtMs };
}

export function queueImmediateScheduledEventTick(runtime, delayMs = 250) {
  const timer = setTimeout(() => {
    runtime.tickScheduledEvents().catch((err) => {
      log("ERROR", `[${runtime.config.name}] Sofortiger Event-Start fehlgeschlagen: ${err?.message || err}`);
    });
  }, Math.max(0, delayMs));
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
}

export async function resolveGuildVoiceChannel(runtime, guildId, channelId) {
  return resolveRuntimeGuildVoiceChannel(runtime, guildId, channelId);
}

export async function ensureStageChannelReady(runtime, guild, channel, {
  topic = null,
  guildScheduledEventId = null,
  createInstance = true,
  ensureSpeaker = true,
} = {}) {
  return ensureRuntimeStageChannelReady(runtime, guild, channel, {
    topic,
    guildScheduledEventId,
    createInstance,
    ensureSpeaker,
  });
}

export async function deleteDiscordScheduledEventById(runtime, guildId, scheduledEventId) {
  const eventId = String(scheduledEventId || "").trim();
  if (!/^\d{17,22}$/.test(eventId)) return false;

  const guild = runtime.client.guilds.cache.get(guildId) || await runtime.client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return false;

  const scheduled = await guild.scheduledEvents.fetch(eventId).catch(() => null);
  if (!scheduled) return false;

  await scheduled.delete().catch(() => null);
  return true;
}

export async function syncDiscordScheduledEvent(runtime, event, station, { runAtMs = null, forceCreate = false } = {}) {
  if (!event?.createDiscordEvent) return null;

  const { guild, channel } = await runtime.resolveGuildVoiceChannel(event.guildId, event.voiceChannelId);
  if (!guild || !channel) {
    throw new Error("Voice- oder Stage-Channel für Server-Event nicht gefunden.");
  }

  const requestedRunAtMs = Number.parseInt(String(runAtMs ?? event.runAtMs ?? 0), 10);
  const minDiscordStartMs = Date.now() + 60_000;
  const scheduledRunAtMs = Number.isFinite(requestedRunAtMs) && requestedRunAtMs > 0
    ? Math.max(requestedRunAtMs, minDiscordStartMs)
    : minDiscordStartMs;

  const stationName = clipText(station?.name || event.stationKey || "-", 100) || "-";
  const scheduledEndAtMs = runtime.getScheduledEventEndAtMs(event, scheduledRunAtMs);
  const recurrenceRule = buildDiscordScheduledEventRecurrenceRule(
    scheduledRunAtMs,
    event?.repeat || "none",
    event?.timeZone,
  );
  const payload = {
    name: clipText(event.name || stationName || `${BRAND.name} Event`, 100),
    scheduledStartTime: new Date(scheduledRunAtMs),
    privacyLevel: GuildScheduledEventPrivacyLevel.GuildOnly,
    entityType: channel.type === ChannelType.GuildStageVoice
      ? GuildScheduledEventEntityType.StageInstance
      : GuildScheduledEventEntityType.Voice,
    channel,
    description: await runtime.buildScheduledEventServerDescription(event, stationName, guild),
    reason: `OmniFM scheduled event ${event.id}`,
  };
  if (recurrenceRule) {
    payload.recurrenceRule = recurrenceRule;
  }
  if (scheduledEndAtMs > scheduledRunAtMs) {
    payload.scheduledEndTime = new Date(scheduledEndAtMs);
  }

  const existingId = String(event.discordScheduledEventId || "").trim();
  let scheduledEvent = null;

  if (!forceCreate && existingId) {
    const existingEvent = await guild.scheduledEvents.fetch(existingId).catch(() => null);
    if (existingEvent) {
      if (!recurrenceRule) {
        payload.recurrenceRule = null;
      }
      scheduledEvent = await existingEvent.edit(payload).catch(() => null);
    }
  }

  if (!scheduledEvent) {
    scheduledEvent = await guild.scheduledEvents.create(payload);
  }

  if (scheduledEvent?.id && scheduledEvent.id !== existingId) {
    patchScheduledEvent(event.id, { discordScheduledEventId: scheduledEvent.id });
  }

  return scheduledEvent || null;
}

export async function ensureVoiceConnectionForChannel(runtime, guildId, channelId, state, options = {}) {
  return ensureRuntimeVoiceConnectionForChannel(runtime, guildId, channelId, state, options);
}

export async function postScheduledEventAnnouncement(runtime, event, station, language = "de") {
  if (!event?.textChannelId) return;

  const guild = runtime.client.guilds.cache.get(event.guildId);
  if (!guild) return;

  const channel = guild.channels.cache.get(event.textChannelId)
    || await guild.channels.fetch(event.textChannelId).catch(() => null);
  if (!channel || typeof channel.send !== "function") return;

  const me = await runtime.resolveBotMember(guild);
  if (!me) return;

  const perms = channel.permissionsFor?.(me);
  if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) return;

  const endAtMs = Number.parseInt(String(event?.activeUntilMs || 0), 10) > 0
    ? Number.parseInt(String(event.activeUntilMs), 10)
    : runtime.getScheduledEventEndAtMs(event, event?.runAtMs);
  const rendered = renderEventAnnouncement(event.announceMessage, {
    event: event.name,
    station: station?.name || event.stationKey,
    voice: `<#${event.voiceChannelId}>`,
    time: formatDateTime(event.runAtMs, language, event.timeZone),
    end: endAtMs > 0 ? formatDateTime(endAtMs, language, event.timeZone) : "-",
    timeZone: normalizeEventTimeZone(event.timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE,
  }, language);
  const resolvedMessage = await runtime.resolveGuildEmojiAliases(rendered, guild);
  if (!resolvedMessage) return;

  await channel.send({
    content: clipText(resolvedMessage, 1800),
    allowedMentions: { parse: [] },
  });
}

// In a Stage channel a free worker that is Stage moderator there comes first:
// only it can open the Stage and speak without being brought up by hand.
export async function pickScheduledEventWorker(runtime, guild, event, tier) {
  const channel = guild?.channels?.cache?.get?.(String(event?.voiceChannelId || "")) || null;
  if (!isStageChannel(channel)) return runtime.workerManager.findFreeWorker(event.guildId, tier);
  const available = runtime.workerManager.getAvailableWorkers(event.guildId, tier)
    .sort((a, b) => Number(runtime.workerManager.getWorkerSlot(a) || 0) - Number(runtime.workerManager.getWorkerSlot(b) || 0));
  const { moderators } = await splitStageModeratorBots(guild, channel, available);
  return moderators[0] || available[0] || null;
}
