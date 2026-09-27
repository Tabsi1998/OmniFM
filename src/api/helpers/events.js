// OmniFM API: scheduled events of the dashboard: input, preview, conflicts, channel checks.
// Split out of src/api/server.js (#293).
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { validateStageEventSpeakers } from "../../bot/stage-moderator.js";
import { clipText } from "../../lib/helpers.js";
import { languagePick } from "../../lib/language.js";
import {
  EVENT_FALLBACK_TIME_ZONE,
  buildEventDateTimeFromParts,
  getZonedPartsFromUtcMs,
  normalizeEventTimeZone,
  normalizeRepeatMode,
  getRepeatLabel,
  isWorkdayInTimeZone,
  computeNextEventRunAtMs,
} from "../../lib/event-time.js";
import { getTier } from "../../core/entitlements.js";

function hasOwnDashboardField(payload, field) {
  return Object.prototype.hasOwnProperty.call(payload, field);
}

function formatDashboardDateTimeLocal(runAtMs, timeZone = EVENT_FALLBACK_TIME_ZONE) {
  const utcMs = Number.parseInt(String(runAtMs || 0), 10);
  if (!Number.isFinite(utcMs) || utcMs <= 0) return "";

  const zoned = getZonedPartsFromUtcMs(
    utcMs,
    normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE
  );
  const pad = (value) => String(value || 0).padStart(2, "0");
  return `${zoned.year}-${pad(zoned.month)}-${pad(zoned.day)}T${pad(zoned.hour)}:${pad(zoned.minute)}`;
}

export function buildDashboardEventResponse(eventRow) {
  const runAtMs = Number.parseInt(String(eventRow?.runAtMs || 0), 10);
  const timezone = normalizeEventTimeZone(eventRow?.timeZone || eventRow?.timezone, EVENT_FALLBACK_TIME_ZONE)
    || EVENT_FALLBACK_TIME_ZONE;
  const discordScheduledEventId = String(eventRow?.discordScheduledEventId || "").trim() || null;
  const discordSyncError = clipText(eventRow?.discordSyncError || "", 300) || null;

  return {
    id: String(eventRow?.id || ""),
    title: eventRow?.name || "OmniFM Event",
    stationKey: eventRow?.stationKey || "",
    startsAt: runAtMs > 0 ? new Date(runAtMs).toISOString() : "",
    startsAtLocal: formatDashboardDateTimeLocal(runAtMs, timezone),
    timezone,
    channelId: eventRow?.voiceChannelId || "",
    textChannelId: eventRow?.textChannelId || "",
    enabled: eventRow?.enabled !== false,
    repeat: normalizeRepeatMode(eventRow?.repeat || "none"),
    repeatLabelDe: getRepeatLabel(eventRow?.repeat || "none", "de", { runAtMs, timeZone: timezone }),
    repeatLabelEn: getRepeatLabel(eventRow?.repeat || "none", "en", { runAtMs, timeZone: timezone }),
    durationMs: Number(eventRow?.durationMs || 0),
    announceMessage: eventRow?.announceMessage || "",
    description: eventRow?.description || "",
    stageTopic: eventRow?.stageTopic || "",
    createDiscordEvent: eventRow?.createDiscordEvent === true,
    discordScheduledEventId,
    discordEventSynced: eventRow?.createDiscordEvent === true && Boolean(discordScheduledEventId) && !discordSyncError,
    discordSyncError,
    createdByUserId: eventRow?.createdByUserId || "",
    createdAt: eventRow?.createdAt || new Date().toISOString(),
    updatedAt: eventRow?.updatedAt || eventRow?.createdAt || new Date().toISOString(),
  };
}

function buildDashboardPreviewOccurrenceRow(runAtMs, durationMs, timezone) {
  const safeRunAtMs = Number.parseInt(String(runAtMs || 0), 10);
  const safeDurationMs = Math.max(0, Number(durationMs || 0) || 0);
  const safeTimezone = normalizeEventTimeZone(timezone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  const endAtMs = safeDurationMs > 0 ? safeRunAtMs + safeDurationMs : 0;

  return {
    runAtMs: safeRunAtMs,
    durationMs: safeDurationMs,
    startsAt: safeRunAtMs > 0 ? new Date(safeRunAtMs).toISOString() : "",
    startsAtLocal: formatDashboardDateTimeLocal(safeRunAtMs, safeTimezone),
    endsAt: endAtMs > 0 ? new Date(endAtMs).toISOString() : "",
    endsAtLocal: endAtMs > 0 ? formatDashboardDateTimeLocal(endAtMs, safeTimezone) : "",
  };
}

export function buildDashboardSchedulePreviewRows(eventRow, limit = 5) {
  const rows = [];
  const safeLimit = Math.max(1, Math.min(10, Number(limit || 5) || 5));
  const repeat = normalizeRepeatMode(eventRow?.repeat || "none");
  const timezone = normalizeEventTimeZone(eventRow?.timeZone || eventRow?.timezone, EVENT_FALLBACK_TIME_ZONE)
    || EVENT_FALLBACK_TIME_ZONE;
  let runAtMs = Number.parseInt(String(eventRow?.runAtMs || 0), 10);
  const durationMs = Math.max(0, Number(eventRow?.durationMs || 0) || 0);

  for (let index = 0; index < safeLimit; index += 1) {
    if (!Number.isFinite(runAtMs) || runAtMs <= 0) break;
    rows.push(buildDashboardPreviewOccurrenceRow(runAtMs, durationMs, timezone));
    if (repeat === "none") break;
    runAtMs = computeNextEventRunAtMs(runAtMs, repeat, runAtMs, timezone);
  }

  return rows;
}

export function buildDashboardEventConflicts(candidateEvent, scheduledEvents, { language = "de", ignoreEventId = "" } = {}) {
  const candidateRows = buildDashboardSchedulePreviewRows(candidateEvent, 5);
  const seen = new Set();
  const conflicts = [];
  const candidateDurationMs = Math.max(0, Number(candidateEvent?.durationMs || 0) || 0);

  for (const existingEvent of Array.isArray(scheduledEvents) ? scheduledEvents : []) {
    if (!existingEvent || existingEvent.enabled === false) continue;
    if (String(existingEvent.id || "") === String(ignoreEventId || "")) continue;
    if (String(existingEvent.voiceChannelId || "") !== String(candidateEvent?.voiceChannelId || "")) continue;

    const existingRows = buildDashboardSchedulePreviewRows(existingEvent, 5);
    const existingDurationMs = Math.max(0, Number(existingEvent?.durationMs || 0) || 0);
    const existingResponse = buildDashboardEventResponse(existingEvent);

    for (const candidateRow of candidateRows) {
      for (const existingRow of existingRows) {
        let severity = "";
        let message = "";

        if (candidateDurationMs > 0 && existingDurationMs > 0) {
          const candidateEndAtMs = candidateRow.runAtMs + candidateDurationMs;
          const existingEndAtMs = existingRow.runAtMs + existingDurationMs;
          if (candidateRow.runAtMs < existingEndAtMs && existingRow.runAtMs < candidateEndAtMs) {
            severity = "error";
            message = languagePick(
              language,
              `Überlappt mit "${existingEvent.name}" im selben Voice-Channel.`,
              `Overlaps with "${existingEvent.name}" in the same voice channel.`
            );
          }
        } else if (candidateDurationMs <= 0 && existingRow.runAtMs >= candidateRow.runAtMs) {
          severity = "warning";
          message = languagePick(
            language,
            `Dieses Event hat kein Enddatum und könnte "${existingEvent.name}" blockieren.`,
            `This event has no end time and may block "${existingEvent.name}".`
          );
        } else if (existingDurationMs <= 0 && existingRow.runAtMs <= candidateRow.runAtMs) {
          severity = "warning";
          message = languagePick(
            language,
            `"${existingEvent.name}" hat kein Enddatum und könnte dieses Event blockieren.`,
            `"${existingEvent.name}" has no end time and may block this event.`
          );
        }

        if (!severity || !message) continue;

        const key = `${existingEvent.id}:${candidateRow.runAtMs}:${existingRow.runAtMs}:${severity}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          severity,
          message,
          eventId: existingResponse.id,
          title: existingResponse.title,
          repeat: existingResponse.repeat,
          repeatLabelDe: existingResponse.repeatLabelDe,
          repeatLabelEn: existingResponse.repeatLabelEn,
          startsAt: existingRow.startsAt,
          startsAtLocal: existingRow.startsAtLocal,
          endsAt: existingRow.endsAt,
          endsAtLocal: existingRow.endsAtLocal,
          channelId: existingResponse.channelId,
        });
      }
    }
  }

  return conflicts.sort((a, b) => {
    const severityOrder = { error: 0, warning: 1 };
    const severityDelta = (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    if (severityDelta !== 0) return severityDelta;
    return String(a.startsAt || "").localeCompare(String(b.startsAt || ""));
  });
}

function parseDashboardStartsAtInput(payload) {
  const localRaw = String(payload?.startsAtLocal || "").trim();
  if (localRaw) {
    return { mode: "local", value: localRaw };
  }

  const legacyRaw = String(payload?.startsAt || payload?.startAt || "").trim();
  if (legacyRaw) {
    return { mode: "legacy_iso", value: legacyRaw };
  }

  return { mode: "unchanged", value: "" };
}

export async function validateDashboardEventChannels(runtime, guild, event, language = "de") {
  if (!runtime || !guild) {
    return {
      ok: false,
      message: languagePick(language, "Der Bot ist auf diesem Server aktuell nicht verfügbar.", "The bot is currently unavailable on this server."),
    };
  }

  const me = await runtime.resolveBotMember(guild);
  if (!me) {
    return { ok: false, message: languagePick(language, "Bot-Mitglied im Server konnte nicht geladen werden.", "Could not load the bot member in this server.") };
  }

  const { channel: voiceChannel } = await runtime.resolveGuildVoiceChannel(guild.id, event.voiceChannelId);
  if (!voiceChannel) {
    return { ok: false, message: languagePick(language, "Bitte wähle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel.") };
  }
  if (event.stageTopic && voiceChannel.type !== ChannelType.GuildStageVoice) {
    return { ok: false, message: languagePick(language, "`stagetopic` funktioniert nur mit Stage-Channels.", "`stagetopic` only works with stage channels.") };
  }

  const voicePerms = voiceChannel.permissionsFor(me);
  if (!voicePerms?.has(PermissionFlagsBits.Connect)) {
    return {
      ok: false,
      message: languagePick(
        language,
        `Ich habe keine Connect-Berechtigung für ${voiceChannel.toString()}.`,
        `I do not have Connect permission for ${voiceChannel.toString()}.`
      ),
    };
  }
  if (voiceChannel.type !== ChannelType.GuildStageVoice && !voicePerms?.has(PermissionFlagsBits.Speak)) {
    return {
      ok: false,
      message: languagePick(
        language,
        `Ich habe keine Speak-Berechtigung für ${voiceChannel.toString()}.`,
        `I do not have Speak permission for ${voiceChannel.toString()}.`
      ),
    };
  }
  const stageError = await validateStageEventSpeakers(runtime, guild, voiceChannel, getTier(guild.id), language);
  if (stageError) {
    return { ok: false, message: stageError };
  }
  if (event.createDiscordEvent) {
    const eventPermError = runtime.validateDiscordScheduledEventPermissions(guild, voiceChannel, language);
    if (eventPermError) {
      return { ok: false, message: eventPermError };
    }
  }

  let textChannel = null;
  if (event.textChannelId) {
    textChannel = guild.channels?.cache?.get(event.textChannelId) || null;
    if (!textChannel && guild.channels?.fetch) {
      textChannel = await guild.channels.fetch(event.textChannelId).catch(() => null);
    }
    if (!textChannel || textChannel.guildId !== guild.id || typeof textChannel.send !== "function") {
      return {
        ok: false,
        message: languagePick(
          language,
          "Der gewählte Text-Channel ist nicht in diesem Server.",
          "The selected text channel is not in this server."
        ),
      };
    }

    const textPerms = textChannel.permissionsFor(me);
    if (!textPerms?.has(PermissionFlagsBits.ViewChannel) || !textPerms?.has(PermissionFlagsBits.SendMessages)) {
      return {
        ok: false,
        message: languagePick(
          language,
          `Ich kann in ${textChannel.toString()} nicht schreiben.`,
          `I cannot send messages in ${textChannel.toString()}.`
        ),
      };
    }
  }

  return { ok: true, voiceChannel, textChannel };
}

export function buildDashboardDiscordSyncPatch(event, { discordScheduledEventId = null, discordSyncError = null } = {}) {
  return {
    discordScheduledEventId: discordScheduledEventId || null,
    discordSyncError: clipText(discordSyncError || "", 300) || null,
  };
}

export async function normalizeDashboardEventInput(body, {
  guildId,
  botId,
  runtime,
  existingEvent = null,
  language = "de",
} = {}) {
  const payload = body && typeof body === "object" ? body : {};
  const title = clipText(
    hasOwnDashboardField(payload, "title") || hasOwnDashboardField(payload, "name")
      ? payload.title || payload.name
      : (existingEvent?.name || "OmniFM Event"),
    120
  ).trim();
  const stationKey = clipText(
    hasOwnDashboardField(payload, "stationKey") || hasOwnDashboardField(payload, "station")
      ? payload.stationKey || payload.station
      : (existingEvent?.stationKey || ""),
    120
  ).trim().toLowerCase();
  const channelId = String(
    hasOwnDashboardField(payload, "channelId") || hasOwnDashboardField(payload, "voiceChannelId")
      ? payload.channelId || payload.voiceChannelId
      : (existingEvent?.voiceChannelId || "")
  ).trim();
  const textChannelId = String(
    hasOwnDashboardField(payload, "textChannelId")
      ? payload.textChannelId || ""
      : (existingEvent?.textChannelId || "")
  ).trim();
  const timezoneInput = clipText(
    hasOwnDashboardField(payload, "timezone")
      ? payload.timezone
      : (existingEvent?.timeZone || EVENT_FALLBACK_TIME_ZONE),
    80
  );
  const timezone = normalizeEventTimeZone(timezoneInput, EVENT_FALLBACK_TIME_ZONE);
  const repeat = normalizeRepeatMode(
    hasOwnDashboardField(payload, "repeat")
      ? payload.repeat
      : (existingEvent?.repeat || "none")
  );
  const durationMs = Math.max(
    0,
    Number(
      hasOwnDashboardField(payload, "durationMs")
        ? payload.durationMs
        : (existingEvent?.durationMs || 0)
    ) || 0
  );
  const announceMessage = hasOwnDashboardField(payload, "announceMessage")
    ? runtime.normalizeClearableText(payload.announceMessage, 1200)
    : (existingEvent?.announceMessage || null);
  const description = hasOwnDashboardField(payload, "description")
    ? runtime.normalizeClearableText(payload.description, 800)
    : (existingEvent?.description || null);
  const stageTopic = hasOwnDashboardField(payload, "stageTopic")
    ? runtime.normalizeClearableText(payload.stageTopic, 120)
    : (existingEvent?.stageTopic || null);
  const createDiscordEvent = hasOwnDashboardField(payload, "createDiscordEvent")
    ? payload.createDiscordEvent === true
    : existingEvent?.createDiscordEvent === true;
  const enabled = hasOwnDashboardField(payload, "enabled")
    ? payload.enabled !== false
    : existingEvent?.enabled !== false;

  if (!title) return { ok: false, message: languagePick(language, "Titel fehlt.", "Title is required.") };
  if (!stationKey) return { ok: false, message: languagePick(language, "Station-Key fehlt.", "Station key is required.") };
  if (!/^\d{17,22}$/.test(channelId)) return { ok: false, message: languagePick(language, "Voice-Channel-ID fehlt oder ist ungültig.", "Voice channel ID is missing or invalid.") };
  if (textChannelId && !/^\d{17,22}$/.test(textChannelId)) return { ok: false, message: languagePick(language, "Text-Channel-ID ist ungültig.", "Text channel ID is invalid.") };
  if (!timezone) return { ok: false, message: languagePick(language, "Zeitzone ist ungültig.", "Time zone is invalid.") };
  if (!botId) return { ok: false, message: languagePick(language, "Kein geeigneter Bot für dieses Event gefunden.", "No suitable bot was found for this event.") };

  const startInput = parseDashboardStartsAtInput(payload);
  let parsedWindow;
  if (startInput.mode === "legacy_iso") {
    const parsedRunAtMs = Date.parse(startInput.value);
    if (!Number.isFinite(parsedRunAtMs) || parsedRunAtMs <= 0) {
      return { ok: false, message: languagePick(language, "Startzeit ist ungültig.", "Start time is invalid.") };
    }
    parsedWindow = {
      ok: true,
      runAtMs: parsedRunAtMs,
      timeZone: timezone,
      durationMs,
      endAtMs: durationMs > 0 ? parsedRunAtMs + durationMs : 0,
    };
  } else if (startInput.mode === "local") {
    const now = Date.now();
    const parsedStart = buildEventDateTimeFromParts({
      rawDateTime: startInput.value,
      language,
      preferredTimeZone: timezone,
      fallbackRunAtMs: existingEvent?.runAtMs || now,
      nowMs: now,
    });
    if (!parsedStart?.ok) {
      return {
        ok: false,
        message: parsedStart?.message || languagePick(language, "Startzeit ist ungültig.", "Start time is invalid."),
      };
    }

    let runAtMs = Number.parseInt(String(parsedStart.runAtMs || 0), 10);
    const resolvedTimeZone = parsedStart.timeZone || timezone;
    let endAtMs = durationMs > 0 ? runAtMs + durationMs : 0;

    if (!createDiscordEvent && runAtMs <= (now + 60_000) && runAtMs >= (now - 60_000)) {
      runAtMs = now;
      endAtMs = durationMs > 0 ? runAtMs + durationMs : 0;
    }

    parsedWindow = {
      ok: true,
      runAtMs,
      timeZone: resolvedTimeZone,
      durationMs,
      endAtMs,
    };
  } else {
    parsedWindow = runtime.parseEventWindowInput({
      startRaw: startInput.mode === "local" ? startInput.value : undefined,
      baseRunAtMs: existingEvent?.runAtMs || 0,
      baseDurationMs: durationMs,
      requestedTimeZone: timezone,
      allowImmediate: !createDiscordEvent,
    }, language);
  }
  if (!parsedWindow?.ok) {
    return { ok: false, message: parsedWindow?.message || languagePick(language, "Startzeit ist ungültig.", "Start time is invalid.") };
  }
  if (createDiscordEvent && parsedWindow.runAtMs < Date.now() + 60_000) {
    return {
      ok: false,
      message: languagePick(
        language,
        "Mit Discord-Server-Event muss die Startzeit mindestens 60 Sekunden in der Zukunft liegen.",
        "With a Discord server event, the start time must be at least 60 seconds in the future."
      ),
    };
  }
  if (repeat === "weekdays" && !isWorkdayInTimeZone(parsedWindow.runAtMs, parsedWindow.timeZone || timezone)) {
    return {
      ok: false,
      message: languagePick(
        language,
        "Für Werktags-Wiederholung muss die Startzeit auf Montag bis Freitag liegen.",
        "For weekday recurrence, the start time must fall on Monday to Friday."
      ),
    };
  }

  const station = runtime.resolveStationForGuild(guildId, stationKey, language);
  if (!station.ok) {
    return { ok: false, message: station.message };
  }

  return {
    ok: true,
    station,
    parsedWindow,
    event: {
      guildId,
      botId,
      name: title,
      stationKey: station.key,
      voiceChannelId: channelId,
      textChannelId: textChannelId || null,
      announceMessage: announceMessage || null,
      description: description || null,
      stageTopic: stageTopic || null,
      timeZone: parsedWindow.timeZone || timezone,
      createDiscordEvent,
      repeat,
      runAtMs: parsedWindow.runAtMs,
      durationMs: parsedWindow.durationMs > 0 ? parsedWindow.durationMs : 0,
      enabled,
    },
  };
}
