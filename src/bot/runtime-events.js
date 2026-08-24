import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  GuildScheduledEventEntityType,
  GuildScheduledEventPrivacyLevel,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";

import { log } from "../lib/logging.js";
import { expandDiscordEmojiAliases } from "../lib/discord-emojis.js";
import {
  EVENT_SCHEDULER_ENABLED,
  EVENT_SCHEDULER_POLL_MS,
  EVENT_SCHEDULER_RETRY_MS,
  clipText,
} from "../lib/helpers.js";
import {
  getFeatureRequirementMessage,
  languagePick,
  translateCustomStationErrorMessage,
  translateScheduledEventStoreMessage,
} from "../lib/language.js";
import {
  EVENT_FALLBACK_TIME_ZONE,
  buildDiscordScheduledEventRecurrenceRule,
  buildEventDateTimeFromParts,
  computeNextEventRunAtMs,
  formatDateTime,
  getRepeatLabel,
  isWorkdayInTimeZone,
  normalizeEventTimeZone,
  normalizeRepeatMode,
  renderEventAnnouncement,
  renderStageTopic,
} from "../lib/event-time.js";
import { loadStations, normalizeKey, filterStationsByTier, buildScopedStationsData } from "../stations-store.js";
import {
  getGuildStations,
  addGuildStation,
  removeGuildStation,
  countGuildStations,
  MAX_STATIONS_PER_GUILD,
  buildCustomStationReference,
  parseCustomStationReference,
  validateCustomStationUrl,
} from "../custom-stations.js";
import { getTier, requireFeature } from "../core/entitlements.js";
import {
  listScheduledEvents,
  createScheduledEvent,
  deleteScheduledEvent,
  patchScheduledEvent,
  getScheduledEvent,
} from "../scheduled-events-store.js";
import { BRAND } from "../config/plans.js";
import { OMNI_COLORS, brandAuthor, brandFooter } from "./brand-embed.js";
import {
  DASHBOARD_URL,
  PLAY_COMPONENT_ID_OPEN,
  STATIONS_COMPONENT_ID_OPEN,
  SUPPORT_URL,
  withLanguageParam,
} from "./runtime-links.js";
import { buildOmniEmbed } from "./discord-ui.js";
import {
  resolveRuntimeGuildVoiceChannel,
  ensureRuntimeStageChannelReady,
  ensureRuntimeVoiceConnectionForChannel,
} from "./runtime-voice.js";

function buildEventActionRows(language = "de", {
  includePlayback = true,
  includeDashboard = true,
  includePremium = false,
  includeSupport = false,
} = {}) {
  const t = (de, en) => languagePick(language, de, en);
  const rows = [];
  if (includePlayback) {
    rows.push(
      new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(PLAY_COMPONENT_ID_OPEN)
          .setStyle(ButtonStyle.Primary)
          .setLabel(t("🎛 Schnellstart", "🎛 Quick start")),
        new ButtonBuilder()
          .setCustomId(STATIONS_COMPONENT_ID_OPEN)
          .setStyle(ButtonStyle.Secondary)
          .setLabel(t("📻 Sender", "📻 Stations"))
      )
    );
  }
  const supportButtons = [];
  if (includeDashboard) {
    supportButtons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("📊 Dashboard")
        .setURL(withLanguageParam(DASHBOARD_URL, language))
    );
  }
  if (includePremium) {
    supportButtons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("💎 Premium")
        .setURL(withLanguageParam(BRAND.upgradeUrl || DASHBOARD_URL, language))
    );
  }
  if (includeSupport) {
    supportButtons.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("🛟 Support")
        .setURL(SUPPORT_URL)
    );
  }
  if (supportButtons.length) {
    rows.push(new ActionRowBuilder().addComponents(...supportButtons.slice(0, 5)));
  }
  return rows;
}

function buildEventNoticePayload(language, {
  tone = "info",
  title,
  description,
  fields = [],
  includePlayback = true,
  includePremium = false,
  includeSupport = false,
} = {}) {
  return {
    embeds: [
      buildOmniEmbed({
        tone,
        title,
        description,
        fields,
      }),
    ],
    components: buildEventActionRows(language, {
      includePlayback,
      includePremium,
      includeSupport,
    }),
    flags: MessageFlags.Ephemeral,
  };
}

export function normalizeStationReference(runtime, rawStationKey) {
  const customRef = parseCustomStationReference(rawStationKey);
  if (customRef.isCustom) {
    return {
      key: customRef.reference || "",
      lookupKey: customRef.key || "",
      isCustom: true,
    };
  }

  const normalized = normalizeKey(rawStationKey);
  return {
    key: normalized,
    lookupKey: normalized,
    isCustom: false,
  };
}

export function resolveStationForGuild(runtime, guildId, rawStationKey, language = "de") {
  const t = (de, en) => languagePick(language, de, en);
  const stationRef = runtime.normalizeStationReference(rawStationKey);
  if (!stationRef.key || !stationRef.lookupKey) {
    return { ok: false, message: t("Stations-Key ist ungültig.", "Station key is invalid.") };
  }

  const stations = loadStations();
  const guildTier = getTier(guildId);
  const available = filterStationsByTier(stations.stations, guildTier);
  if (!stationRef.isCustom && available[stationRef.key]) {
    return {
      ok: true,
      key: stationRef.key,
      station: available[stationRef.key],
      stations: buildScopedStationsData(stations, available),
      isCustom: false,
    };
  }

  if (guildTier === "ultimate") {
    const customStations = getGuildStations(guildId);
    const custom = customStations[stationRef.lookupKey];
    if (custom) {
      const validation = validateCustomStationUrl(custom.url);
      if (!validation.ok) {
        const translated = translateCustomStationErrorMessage(validation.error, language);
        return { ok: false, message: t(`Custom-Station kann nicht genutzt werden: ${translated}`, `Custom station cannot be used: ${translated}`) };
      }
      const station = { name: custom.name, url: validation.url, tier: "ultimate" };
      const resolvedKey = buildCustomStationReference(stationRef.lookupKey) || stationRef.key;
      return {
        ok: true,
        key: resolvedKey,
        station,
        stations: buildScopedStationsData(stations, { ...available, [resolvedKey]: station }),
        isCustom: true,
      };
    }
  }

  if (!stationRef.isCustom && stations.stations[stationRef.key]) {
    return {
      ok: false,
      message: t(
        `Station \`${stationRef.key}\` ist in deinem Plan nicht verfügbar.`,
        `Station \`${stationRef.key}\` is not available in your plan.`
      )
    };
  }
  return {
    ok: false,
    message: t(
      `Station \`${stationRef.key}\` wurde nicht gefunden.`,
      `Station \`${stationRef.key}\` was not found.`
    )
  };
}

export function getResolvedCurrentStation(runtime, guildId, state, language = null) {
  if (!state?.currentStationKey) return null;
  const resolved = runtime.resolveStationForGuild(guildId, state.currentStationKey, language || runtime.resolveGuildLanguage(guildId));
  return resolved.ok ? resolved : null;
}

export function clearScheduledEventPlayback(runtime, state) {
  if (!state) return;
  state.activeScheduledEventId = null;
  state.activeScheduledEventStopAtMs = 0;
}

export function markScheduledEventPlayback(runtime, state, eventId, stopAtMs = 0) {
  if (!state) return;
  const normalizedId = String(eventId || "").trim();
  state.activeScheduledEventId = normalizedId || null;
  const normalizedStopAtMs = Number.parseInt(String(stopAtMs || 0), 10);
  state.activeScheduledEventStopAtMs = Number.isFinite(normalizedStopAtMs) && normalizedStopAtMs > 0
    ? normalizedStopAtMs
    : 0;
}

export function setScheduledEventPlaybackInGuild(runtime, guildId, eventId, stopAtMs = 0) {
  const state = runtime.getState(guildId);
  runtime.markScheduledEventPlayback(state, eventId, stopAtMs);
  runtime.persistState();
  return { ok: true };
}

export function clearScheduledEventPlaybackInGuild(runtime, guildId) {
  const state = runtime.guildState.get(guildId);
  if (!state) return { ok: false, error: "Kein State für diesen Server." };
  runtime.clearScheduledEventPlayback(state);
  runtime.persistState();
  return { ok: true };
}

export function getScheduledEventEndAtMs(runtime, event, runAtMs = null) {
  const durationMs = Number.parseInt(String(event?.durationMs || 0), 10);
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  const baseRunAtMs = Number.parseInt(String(runAtMs ?? event?.runAtMs ?? 0), 10);
  if (!Number.isFinite(baseRunAtMs) || baseRunAtMs <= 0) return 0;
  return baseRunAtMs + durationMs;
}

export function formatDiscordTimestamp(runtime, ms, style = "F") {
  const value = Number.parseInt(String(ms || 0), 10);
  if (!Number.isFinite(value) || value <= 0) return "-";
  return `<t:${Math.floor(value / 1000)}:${style}>`;
}

export function normalizeClearableText(runtime, rawValue, maxLen) {
  if (rawValue === undefined || rawValue === null) return undefined;
  const trimmed = clipText(String(rawValue || "").trim(), maxLen);
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (["-", "clear", "none", "off"].includes(lower)) return null;
  return trimmed;
}

export function isScheduledEventStopDue(runtime, stopAtMs, now = Date.now()) {
  const normalizedStopAtMs = Number.parseInt(String(stopAtMs || 0), 10);
  return Number.isFinite(normalizedStopAtMs) && normalizedStopAtMs > 0 && now >= normalizedStopAtMs;
}

export async function resolveGuildEmojiAliases(runtime, text, guild) {
  const source = String(text || "");
  if (!source || !guild?.emojis) return source;

  try {
    if (typeof guild.emojis.fetch === "function") {
      await guild.emojis.fetch();
    }
  } catch {}

  return expandDiscordEmojiAliases(source, [...(guild.emojis.cache?.values() || [])]);
}

export async function buildScheduledEventServerDescription(runtime, event, stationName, guild = null) {
  const eventLanguage = event?.guildId ? runtime.resolveGuildLanguage(event.guildId) : "de";
  const baseDescription = String(event?.description || "").trim();
  const details = [
    `OmniFM Auto-Event | Station: ${clipText(stationName || event?.stationKey || "-", 120)}`,
  ];
  if (normalizeRepeatMode(event?.repeat || "none") !== "none") {
    details.push(
      `${languagePick(eventLanguage, "Wiederholung", "Repeat")}: ${getRepeatLabel(event?.repeat, eventLanguage, {
        runAtMs: event?.runAtMs,
        timeZone: event?.timeZone,
      })}`
    );
  }
  const description = baseDescription ? `${baseDescription}\n\n${details.join("\n")}` : details.join("\n");
  const resolvedDescription = await runtime.resolveGuildEmojiAliases(description, guild);
  return clipText(resolvedDescription, 1000);
}

export function validateDiscordScheduledEventPermissions(runtime, guild, channel, language = "de") {
  if (!guild || !channel) {
    return languagePick(language, "Guild oder Channel fehlt.", "Guild or channel is missing.");
  }

  const me = guild.members.me;
  if (!me) {
    return languagePick(language, "Bot-Mitglied konnte nicht geladen werden.", "Could not resolve the bot member.");
  }

  const guildPerms = me.permissions;
  const channelPerms = channel.permissionsFor(me);
  const missing = [];

  if (!guildPerms?.has(PermissionFlagsBits.CreateEvents)) {
    missing.push("Create Events");
  }
  if (!channelPerms?.has(PermissionFlagsBits.ViewChannel)) {
    missing.push("View Channel");
  }
  if (!channelPerms?.has(PermissionFlagsBits.Connect)) {
    missing.push("Connect");
  }

  if (channel.type === ChannelType.GuildStageVoice) {
    if (!guildPerms?.has(PermissionFlagsBits.ManageChannels)) {
      missing.push("Manage Channels");
    }
    if (!guildPerms?.has(PermissionFlagsBits.MuteMembers)) {
      missing.push("Mute Members");
    }
    if (!guildPerms?.has(PermissionFlagsBits.MoveMembers)) {
      missing.push("Move Members");
    }
  }

  if (!missing.length) return null;
  return languagePick(
    language,
    `Discord-Server-Event nicht möglich. Fehlende Rechte: ${missing.join(", ")}.`,
    `Discord server event is not possible. Missing permissions: ${missing.join(", ")}.`
  );
}

export function buildScheduledEventSummary(runtime, event, stationName, language = "de", { includeId = true } = {}) {
  const now = Date.now();
  const timeZone = normalizeEventTimeZone(event?.timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  const effectiveEndAtMs = Number.parseInt(String(event?.activeUntilMs || 0), 10) > 0
    ? Number.parseInt(String(event.activeUntilMs), 10)
    : runtime.getScheduledEventEndAtMs(event, event?.runAtMs);
  const isActive = effectiveEndAtMs > now && Number(event?.lastStopAtMs || 0) < effectiveEndAtMs;
  const status = !event?.enabled
    ? languagePick(language, "pausiert", "paused")
    : isActive
      ? `${languagePick(language, "aktiv bis", "active until")} ${runtime.formatDiscordTimestamp(effectiveEndAtMs, "F")}`
      : languagePick(language, "geplant", "scheduled");
  const stationLine = stationName && stationName !== event?.stationKey
    ? `\`${event?.stationKey || "-"}\` (${stationName})`
    : `\`${event?.stationKey || "-"}\``;
  const lines = [];

  if (includeId) {
    lines.push(`\`${event?.id || "-"}\` • **${clipText(event?.name || "-", 80)}**`);
  } else {
    lines.push(`**${clipText(event?.name || "-", 80)}**`);
  }

  lines.push(`${languagePick(language, "Status", "Status")}: ${status}`);
  lines.push(`${languagePick(language, "Station", "Station")}: ${stationLine}`);
  lines.push(`${languagePick(language, "Voice/Stage", "Voice/Stage")}: <#${event?.voiceChannelId || "-"}>`);
  lines.push(`${languagePick(language, "Start", "Start")}: ${runtime.formatDiscordTimestamp(event?.runAtMs, "F")} (${formatDateTime(event?.runAtMs, language, timeZone)})`);
  lines.push(
    `${languagePick(language, "Ende", "End")}: ${
      effectiveEndAtMs > 0
        ? `${runtime.formatDiscordTimestamp(effectiveEndAtMs, "F")} (${formatDateTime(effectiveEndAtMs, language, timeZone)})`
        : languagePick(language, "offen", "open")
    }`
  );
  lines.push(`${languagePick(language, "Wiederholung", "Repeat")}: ${getRepeatLabel(event?.repeat, language, { runAtMs: event?.runAtMs, timeZone })}`);
  lines.push(`${languagePick(language, "Zeitzone", "Time zone")}: \`${timeZone}\``);
  lines.push(`${languagePick(language, "Ankündigung", "Announcement")}: ${event?.textChannelId ? `<#${event.textChannelId}>` : languagePick(language, "aus", "off")}`);
  lines.push(`${languagePick(language, "Server-Event", "Server event")}: ${event?.createDiscordEvent ? (event?.discordScheduledEventId ? `on (\`${event.discordScheduledEventId}\`)` : "on") : "off"}`);
  if (event?.stageTopic) {
    lines.push(`${languagePick(language, "Stage-Thema", "Stage topic")}: \`${event.stageTopic}\``);
  }
  if (event?.description) {
    lines.push(`${languagePick(language, "Beschreibung", "Description")}: ${clipText(event.description, 180)}`);
  }

  return lines.join("\n");
}

export function buildScheduledEventEmbed(runtime, event, stationName, language = "de", { includeId = true, titlePrefix = "" } = {}) {
  const timeZone = normalizeEventTimeZone(event?.timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  const effectiveEndAtMs = Number.parseInt(String(event?.activeUntilMs || 0), 10) > 0
    ? Number.parseInt(String(event.activeUntilMs), 10)
    : runtime.getScheduledEventEndAtMs(event, event?.runAtMs);
  const now = Date.now();
  const isActive = effectiveEndAtMs > now && Number(event?.lastStopAtMs || 0) < effectiveEndAtMs;
  const statusLabel = !event?.enabled
    ? languagePick(language, "Pausiert", "Paused")
    : isActive
      ? languagePick(language, "Aktiv", "Active")
      : languagePick(language, "Geplant", "Scheduled");
  const stationLabel = stationName && stationName !== event?.stationKey
    ? `${stationName} (\`${event?.stationKey || "-"}\`)`
    : `\`${event?.stationKey || "-"}\``;
  const embed = new EmbedBuilder()
    .setColor(!event?.enabled ? OMNI_COLORS.neutral : (isActive ? OMNI_COLORS.success : BRAND.color))
    .setTitle(`${titlePrefix}${clipText(event?.name || "-", 120)}`)
    .setDescription(includeId ? `${languagePick(language, "Event-ID", "Event ID")}: \`${event?.id || "-"}\`` : null)
    .addFields(
      { name: languagePick(language, "Status", "Status"), value: statusLabel, inline: true },
      { name: languagePick(language, "Station", "Station"), value: stationLabel, inline: true },
      { name: languagePick(language, "Voice", "Voice"), value: `<#${event?.voiceChannelId || "-"}>`, inline: true },
      {
        name: languagePick(language, "Start", "Start"),
        value: `${runtime.formatDiscordTimestamp(event?.runAtMs, "F")}\n${formatDateTime(event?.runAtMs, language, timeZone)}`,
        inline: true,
      },
      {
        name: languagePick(language, "Ende", "End"),
        value: effectiveEndAtMs > 0
          ? `${runtime.formatDiscordTimestamp(effectiveEndAtMs, "F")}\n${formatDateTime(effectiveEndAtMs, language, timeZone)}`
          : languagePick(language, "Offen", "Open"),
        inline: true,
      },
      {
        name: languagePick(language, "Wiederholung", "Repeat"),
        value: getRepeatLabel(event?.repeat, language, { runAtMs: event?.runAtMs, timeZone }),
        inline: true,
      },
      { name: languagePick(language, "Zeitzone", "Time zone"), value: `\`${timeZone}\``, inline: true },
      {
        name: languagePick(language, "Ankündigung", "Announcement"),
        value: event?.textChannelId ? `<#${event.textChannelId}>` : languagePick(language, "Aus", "Off"),
        inline: true,
      },
      {
        name: languagePick(language, "Server-Event", "Server event"),
        value: event?.createDiscordEvent
          ? (event?.discordScheduledEventId ? `On (\`${event.discordScheduledEventId}\`)` : "On")
          : "Off",
        inline: true,
      }
    )
    .setAuthor(brandAuthor(languagePick(language, "OmniFM · Events", "OmniFM · Events")))
    .setFooter(brandFooter(languagePick(language, "OmniFM Event Scheduler", "OmniFM Event Scheduler")))
    .setTimestamp(new Date());

  if (event?.stageTopic) {
    embed.addFields({
      name: languagePick(language, "Stage-Thema", "Stage topic"),
      value: clipText(event.stageTopic, 120),
      inline: false,
    });
  }
  if (event?.description) {
    embed.addFields({
      name: languagePick(language, "Beschreibung", "Description"),
      value: clipText(event.description, 400),
      inline: false,
    });
  }
  if (event?.announceMessage) {
    embed.addFields({
      name: languagePick(language, "Nachricht", "Message"),
      value: clipText(event.announceMessage, 900),
      inline: false,
    });
  }

  return embed;
}

export function buildScheduledEventsListEmbed(runtime, events, guildId, language = "de") {
  const embed = new EmbedBuilder()
    .setColor(BRAND.color)
    .setAuthor(brandAuthor(languagePick(language, "OmniFM · Events", "OmniFM · Events")))
    .setTitle(languagePick(language, "🗓️ Geplante Events", "🗓️ Scheduled events"))
    .setDescription(`${events.length} ${languagePick(language, "Eintrag(e) auf diesem Server", "item(s) on this server")}`)
    .setFooter(brandFooter(`${runtime.config.name} · /event list`))
    .setTimestamp(new Date());

  const guild = runtime.client.guilds.cache.get(guildId) || null;
  const fields = events.slice(0, 8).map((event) => {
    const station = runtime.resolveStationForGuild(guildId, event.stationKey, language);
    const voiceChannelName = guild?.channels?.cache?.get(event.voiceChannelId)?.name || event.voiceChannelId;
    const status = !event.enabled
      ? languagePick(language, "Pausiert", "Paused")
      : languagePick(language, "Geplant", "Scheduled");
    return {
      name: clipText(`${event.name} (${event.id})`, 256),
      value: [
        `${languagePick(language, "Status", "Status")}: ${status}`,
        `${languagePick(language, "Station", "Station")}: ${station.ok ? (station.station?.name || event.stationKey) : event.stationKey}`,
        `${languagePick(language, "Start", "Start")}: ${runtime.formatDiscordTimestamp(event.runAtMs, "F")}`,
        `${languagePick(language, "Voice", "Voice")}: ${voiceChannelName ? `#${voiceChannelName}` : `<#${event.voiceChannelId}>`}`,
      ].join("\n"),
      inline: false,
    };
  });

  embed.addFields(fields);
  if (events.length > fields.length) {
    embed.addFields({
      name: languagePick(language, "Weitere Events", "More events"),
      value: languagePick(
        language,
        `${events.length - fields.length} weitere Events sind vorhanden. Nutze \`/event edit\` oder \`/event delete\` mit der Event-ID.`,
        `${events.length - fields.length} more events exist. Use \`/event edit\` or \`/event delete\` with the event ID.`
      ),
      inline: false,
    });
  }
  return embed;
}

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

export async function executeScheduledEvent(runtime, event) {
  if (runtime.workerManager?.refreshRemoteStates) {
    await runtime.workerManager.refreshRemoteStates().catch(() => null);
  }
  const now = Date.now();
  if (!runtime.client.guilds.cache.has(event.guildId)) {
    deleteScheduledEvent(event.id, { guildId: event.guildId, botId: runtime.config.id });
    return;
  }

  const feature = requireFeature(event.guildId, "scheduledEvents");
  if (!feature.ok) {
    patchScheduledEvent(event.id, { enabled: false, lastRunAtMs: now });
    log(
      "INFO",
      `[${runtime.config.name}] Event deaktiviert (Plan zu niedrig): guild=${event.guildId} id=${event.id}`
    );
    return;
  }

  const state = runtime.getState(event.guildId);
  const eventGuild = runtime.client.guilds.cache.get(event.guildId) || null;
  const eventLanguage = runtime.resolveGuildLanguage(event.guildId);
  const stationResult = runtime.resolveStationForGuild(event.guildId, event.stationKey, eventLanguage);
  if (!stationResult.ok) {
    patchScheduledEvent(event.id, { runAtMs: now + EVENT_SCHEDULER_RETRY_MS, enabled: true });
    log(
      "ERROR",
      `[${runtime.config.name}] Event ${event.id} konnte nicht starten: ${stationResult.message}`
    );
    return;
  }

  try {
    const scheduledStopAtMs = runtime.getScheduledEventEndAtMs(event, event.runAtMs);
    const activeOccurrenceEvent = scheduledStopAtMs > 0
      ? { ...event, activeUntilMs: scheduledStopAtMs }
      : event;
    const eventEndLabel = scheduledStopAtMs > 0
      ? formatDateTime(scheduledStopAtMs, eventLanguage, event.timeZone)
      : "-";
    const eventTimeZone = normalizeEventTimeZone(event.timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
    let startedBy = runtime.config.name;
    if (runtime.role === "commander" && runtime.workerManager) {
      const guildTier = getTier(event.guildId);
      const worker = runtime.workerManager.findFreeWorker(event.guildId, guildTier);
      if (!worker) {
        patchScheduledEvent(event.id, { runAtMs: now + EVENT_SCHEDULER_RETRY_MS, enabled: true });
        log(
          "WARN",
          `[${runtime.config.name}] Event ${event.id} wartet auf freien Worker (guild=${event.guildId}, tier=${guildTier}).`
        );
        return;
      }

      const rawStageTopic = renderStageTopic(event.stageTopic, {
        event: event.name,
        station: stationResult.station?.name || event.stationKey,
        time: formatDateTime(event.runAtMs, eventLanguage, event.timeZone),
        end: eventEndLabel,
        timeZone: eventTimeZone,
      });
      const stageTopic = clipText(await runtime.resolveGuildEmojiAliases(rawStageTopic, eventGuild), 120);
      const delegatedResult = await worker.playInGuild(
        event.guildId,
        event.voiceChannelId,
        stationResult.key,
        stationResult.stations,
        undefined,
        {
          stageTopic,
          guildScheduledEventId: event.discordScheduledEventId || null,
          createStageInstance: true,
          scheduledEventId: event.id,
          scheduledEventStopAtMs: scheduledStopAtMs,
        }
      );
      if (!delegatedResult.ok) {
        throw new Error(delegatedResult.error || "Worker konnte Event nicht starten.");
      }
      startedBy = delegatedResult.workerName || worker.config.name;
    } else {
      const rawStageTopic = renderStageTopic(event.stageTopic, {
        event: event.name,
        station: stationResult.station?.name || event.stationKey,
        time: formatDateTime(event.runAtMs, eventLanguage, event.timeZone),
        end: eventEndLabel,
        timeZone: eventTimeZone,
      });
      const stageTopic = clipText(await runtime.resolveGuildEmojiAliases(rawStageTopic, eventGuild), 120);
      const localResult = await runtime.playInGuild(
        event.guildId,
        event.voiceChannelId,
        stationResult.key,
        stationResult.stations,
        undefined,
        {
          stageTopic,
          guildScheduledEventId: event.discordScheduledEventId || null,
          createStageInstance: true,
          scheduledEventId: event.id,
          scheduledEventStopAtMs: scheduledStopAtMs,
        }
      );
      if (!localResult.ok) {
        throw new Error(localResult.error || "Event konnte lokal nicht gestartet werden.");
      }
      runtime.persistState();
    }

    await runtime.postScheduledEventAnnouncement(activeOccurrenceEvent, stationResult.station, eventLanguage);

    const nextRunAtMs = computeNextEventRunAtMs(event.runAtMs, event.repeat, now, event.timeZone);
    if (nextRunAtMs) {
      let nextDiscordScheduledEventId = event.discordScheduledEventId || null;
      if (event.createDiscordEvent) {
        try {
          const nextDiscordEvent = await runtime.syncDiscordScheduledEvent(event, stationResult.station, {
            runAtMs: nextRunAtMs,
            forceCreate: false,
          });
          nextDiscordScheduledEventId = nextDiscordEvent?.id || nextDiscordScheduledEventId;
        } catch (syncErr) {
          log(
            "WARN",
            `[${runtime.config.name}] Discord-Server-Event konnte nicht auf Folgetermin gesetzt werden (guild=${event.guildId}, id=${event.id}): ${syncErr?.message || syncErr}`
          );
        }
      }

      patchScheduledEvent(event.id, {
        runAtMs: nextRunAtMs,
        lastRunAtMs: now,
        enabled: true,
        activeUntilMs: scheduledStopAtMs > 0 ? scheduledStopAtMs : 0,
        deleteAfterStop: false,
        discordScheduledEventId: nextDiscordScheduledEventId,
      });
    } else if (scheduledStopAtMs > 0) {
      patchScheduledEvent(event.id, {
        lastRunAtMs: now,
        activeUntilMs: scheduledStopAtMs,
        enabled: true,
        deleteAfterStop: true,
      });
    } else {
      deleteScheduledEvent(event.id, { guildId: event.guildId, botId: runtime.config.id });
    }

    log(
      "INFO",
      `[${runtime.config.name}] Event gestartet: guild=${event.guildId} id=${event.id} station=${stationResult.key} via=${startedBy}`
    );
  } catch (err) {
    patchScheduledEvent(event.id, { runAtMs: now + EVENT_SCHEDULER_RETRY_MS, enabled: true });
    log(
      "ERROR",
      `[${runtime.config.name}] Event ${event.id} Startfehler: ${err?.message || err}`
    );
  }
}

export async function executeScheduledEventStop(runtime, event) {
  if (runtime.workerManager?.refreshRemoteStates) {
    await runtime.workerManager.refreshRemoteStates().catch(() => null);
  }
  const stopAtMs = Number.parseInt(String(event?.activeUntilMs || 0), 10);
  if (!Number.isFinite(stopAtMs) || stopAtMs <= 0) return;

  let stoppedBy = null;
  let stopped = false;

  const localState = runtime.guildState.get(event.guildId);
  if (localState?.activeScheduledEventId === event.id) {
    const result = await runtime.stopInGuild(event.guildId);
    stopped = Boolean(result?.ok);
    stoppedBy = runtime.config.name;
  }

  if (!stopped && runtime.workerManager) {
    const worker = runtime.workerManager.findWorkerByScheduledEvent(event.guildId, event.id);
    if (worker) {
      const result = await worker.stopInGuild(event.guildId);
      stopped = Boolean(result?.ok);
      stoppedBy = worker.config?.name || "Worker";
    }
  }

  if (event.deleteAfterStop) {
    deleteScheduledEvent(event.id, { guildId: event.guildId, botId: runtime.config.id });
  } else {
    patchScheduledEvent(event.id, {
      activeUntilMs: 0,
      lastStopAtMs: Date.now(),
      deleteAfterStop: false,
    });
  }

  log(
    "INFO",
    `[${runtime.config.name}] Event beendet: guild=${event.guildId} id=${event.id} stopped=${stopped ? "yes" : "no"} via=${stoppedBy || "state-cleanup"}`
  );
}

export async function tickScheduledEvents(runtime, ) {
  if (!EVENT_SCHEDULER_ENABLED) return;
  if (!runtime.client.isReady()) return;

  if (runtime.workerManager?.refreshRemoteStates) {
    await runtime.workerManager.refreshRemoteStates().catch(() => null);
  }

  const now = Date.now();
  const scheduled = listScheduledEvents({
    botId: runtime.config.id,
    includeDisabled: true,
  });
  const events = Array.isArray(scheduled) ? scheduled : [];

  for (const event of events) {
    const stopAtMs = Number.parseInt(String(event?.activeUntilMs || 0), 10);
    const alreadyStoppedAt = Number.parseInt(String(event?.lastStopAtMs || 0), 10);
    if (!Number.isFinite(stopAtMs) || stopAtMs <= 0) continue;
    if (alreadyStoppedAt >= stopAtMs) continue;
    if (stopAtMs > now + 1000) continue;
    if (runtime.scheduledEventInFlight.has(`${event.id}:stop`)) continue;

    runtime.scheduledEventInFlight.add(`${event.id}:stop`);
    try {
      // eslint-disable-next-line no-await-in-loop
      await runtime.executeScheduledEventStop(event);
    } finally {
      runtime.scheduledEventInFlight.delete(`${event.id}:stop`);
    }
  }

  for (const event of events) {
    if (!event.enabled) continue;
    if (event.runAtMs > now + 1000) continue;
    if (event.lastRunAtMs && event.lastRunAtMs >= event.runAtMs) continue;
    if (runtime.scheduledEventInFlight.has(event.id)) continue;

    runtime.scheduledEventInFlight.add(event.id);
    try {
      // eslint-disable-next-line no-await-in-loop
      await runtime.executeScheduledEvent(event);
    } finally {
      runtime.scheduledEventInFlight.delete(event.id);
    }
  }
}

export function startEventScheduler(runtime, ) {
  if (!EVENT_SCHEDULER_ENABLED) return;
  if (runtime.eventSchedulerTimer) return;

  const run = () => {
    runtime.tickScheduledEvents().catch((err) => {
      log("ERROR", `[${runtime.config.name}] Event-Scheduler Fehler: ${err?.message || err}`);
    });
  };

  run();
  runtime.eventSchedulerTimer = setInterval(run, EVENT_SCHEDULER_POLL_MS);
}

export function stopEventScheduler(runtime, ) {
  if (runtime.eventSchedulerTimer) {
    clearInterval(runtime.eventSchedulerTimer);
    runtime.eventSchedulerTimer = null;
  }
  runtime.scheduledEventInFlight.clear();
}

export async function handleEventCommand(runtime, interaction) {
  const guildId = interaction.guildId;
  const { t, language } = runtime.createInteractionTranslator(interaction);
  if (!runtime.hasGuildManagePermissions(interaction)) {
    await interaction.reply(buildEventNoticePayload(language, {
      tone: "warning",
      title: t("🛠 Event-Rechte fehlen", "🛠 Event permission missing"),
      description: t(
        "Du brauchst die Berechtigung `Server verwalten` für `/event`.",
        "You need the `Manage Server` permission for `/event`."
      ),
      includePlayback: false,
      includeSupport: true,
    }));
    return;
  }

  const feature = requireFeature(guildId, "scheduledEvents");
  if (!feature.ok) {
    await interaction.reply(buildEventNoticePayload(language, {
      tone: "info",
      title: t("📅 Events sind nicht freigeschaltet", "📅 Events are not unlocked"),
      description: getFeatureRequirementMessage(feature, language),
      fields: [
        {
          name: t("Upgrade", "Upgrade"),
          value: withLanguageParam(BRAND.upgradeUrl || DASHBOARD_URL, language),
          inline: false,
        },
      ],
      includePlayback: false,
      includePremium: true,
      includeSupport: true,
    }));
    return;
  }

  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild || runtime.client.guilds.cache.get(guildId) || await runtime.client.guilds.fetch(guildId).catch(() => null);
  const me = guild ? await runtime.resolveBotMember(guild) : null;

  if (!guild || !me) {
    await interaction.reply(buildEventNoticePayload(language, {
      tone: "danger",
      title: t("✖ Server-Zugriff fehlgeschlagen", "✖ Server access failed"),
      description: t("Bot-Mitglied im Server konnte nicht geladen werden.", "Could not load the bot member in this server."),
      includePlayback: false,
      includeSupport: true,
    }));
    return;
  }

  const validateTextChannel = (channel) => {
    if (!channel) return null;
    if (channel.guildId !== guildId) {
      return t("Der gewaehlte Text-Channel ist nicht in diesem Server.", "The selected text channel is not in this server.");
    }
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.ViewChannel) || !perms?.has(PermissionFlagsBits.SendMessages)) {
      return t(`Ich kann in ${channel.toString()} nicht schreiben.`, `I cannot send messages in ${channel.toString()}.`);
    }
    return null;
  };

  const validateVoiceChannel = (channel, { stageTopic = null, createDiscordEvent = false } = {}) => {
    if (!channel) {
      return t("Voice- oder Stage-Channel fehlt.", "Voice or stage channel is missing.");
    }
    if (channel.guildId !== guildId) {
      return t("Der gewaehlte Voice/Stage-Channel ist nicht in diesem Server.", "The selected voice/stage channel is not in this server.");
    }
    if (!channel.isVoiceBased() || (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice)) {
      return t("Bitte waehle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel.");
    }
    if (stageTopic && channel.type !== ChannelType.GuildStageVoice) {
      return t("`stagetopic` funktioniert nur mit Stage-Channels.", "`stagetopic` only works with stage channels.");
    }
    const perms = channel.permissionsFor(me);
    if (!perms?.has(PermissionFlagsBits.Connect)) {
      return t(`Ich habe keine Connect-Berechtigung für ${channel.toString()}.`, `I do not have Connect permission for ${channel.toString()}.`);
    }
    if (channel.type !== ChannelType.GuildStageVoice && !perms?.has(PermissionFlagsBits.Speak)) {
      return t(`Ich habe keine Speak-Berechtigung für ${channel.toString()}.`, `I do not have Speak permission for ${channel.toString()}.`);
    }
    if (createDiscordEvent) {
      return runtime.validateDiscordScheduledEventPermissions(guild, channel, language);
    }
    return null;
  };

  const parseWindow = (input) => runtime.parseEventWindowInput(input, language);

  if (sub === "create") {
    const name = clipText(interaction.options.getString("name", true).trim(), 120);
    const stationRaw = interaction.options.getString("station", true);
    const voiceChannel = interaction.options.getChannel("voice", true);
    const textChannel = interaction.options.getChannel("text");
    const startRaw = interaction.options.getString("start");
    const startDateRaw = interaction.options.getString("startdate");
    const startTimeRaw = interaction.options.getString("starttime");
    const endRaw = interaction.options.getString("end");
    const endDateRaw = interaction.options.getString("enddate");
    const endTimeRaw = interaction.options.getString("endtime");
    const requestedTimeZone = interaction.options.getString("timezone") || "";
    const repeat = normalizeRepeatMode(interaction.options.getString("repeat") || "none");
    const createDiscordEvent = interaction.options.getBoolean("serverevent") === true;
    const stageTopicTemplate = runtime.normalizeClearableText(interaction.options.getString("stagetopic"), 120);
    const message = runtime.normalizeClearableText(interaction.options.getString("message"), 1200);
    const description = runtime.normalizeClearableText(interaction.options.getString("description"), 800);

    if (!name) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("✍ Eventname fehlt", "✍ Event name missing"),
        description: t("Eventname darf nicht leer sein.", "Event name cannot be empty."),
      }));
      return;
    }

    const voiceError = validateVoiceChannel(voiceChannel, {
      stageTopic: stageTopicTemplate,
      createDiscordEvent,
    });
    if (voiceError) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🎙 Voice-Channel prüfen", "🎙 Check voice channel"),
        description: voiceError,
      }));
      return;
    }

    const textError = validateTextChannel(textChannel);
    if (textError) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("💬 Text-Channel prüfen", "💬 Check text channel"),
        description: textError,
      }));
      return;
    }

    if (![startRaw, startDateRaw, startTimeRaw].some((value) => String(value || "").trim())) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🕒 Startzeit fehlt", "🕒 Start time missing"),
        description: t(
          "Bitte gib eine Startzeit an. Nutze entweder `start` oder die Kombination aus `startdate` + `starttime`.",
          "Please provide a start time. Use either `start` or the `startdate` + `starttime` combination."
        ),
      }));
      return;
    }

    const parsedWindow = parseWindow({
      startRaw,
      startDateRaw,
      startTimeRaw,
      endRaw,
      endDateRaw,
      endTimeRaw,
      requestedTimeZone,
      allowImmediate: !createDiscordEvent,
    });
    if (!parsedWindow.ok) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🗓 Zeitfenster ungültig", "🗓 Invalid event window"),
        description: parsedWindow.message,
      }));
      return;
    }
    if (createDiscordEvent && parsedWindow.runAtMs < Date.now() + 60_000) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("📣 Server-Event zu früh", "📣 Server event too soon"),
        description: t(
          "Mit `serverevent` muss die Startzeit mindestens 60 Sekunden in der Zukunft liegen.",
          "With `serverevent`, start time must be at least 60 seconds in the future."
        ),
      }));
      return;
    }
    if (repeat === "weekdays" && !isWorkdayInTimeZone(parsedWindow.runAtMs, parsedWindow.timeZone)) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("📆 Wiederholung passt nicht", "📆 Repeat rule does not match"),
        description: t(
          "Für `weekdays` muss die Startzeit auf Montag bis Freitag liegen.",
          "For `weekdays`, the start time must fall on Monday to Friday."
        ),
      }));
      return;
    }

    const station = runtime.resolveStationForGuild(guildId, stationRaw, language);
    if (!station.ok) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("📻 Sender prüfen", "📻 Check station"),
        description: station.message,
      }));
      return;
    }

    if (runtime.role === "commander" && runtime.workerManager) {
      const guildTier = getTier(guildId);
      const invitedWorkers = runtime.workerManager.getInvitedWorkers(guildId, guildTier);
      if (invitedWorkers.length === 0) {
        await interaction.reply(buildEventNoticePayload(language, {
          tone: "warning",
          title: t("🤖 Kein Worker verfügbar", "🤖 No worker available"),
          description: t(
            "Kein geeigneter Worker-Bot ist auf diesem Server eingeladen. Bitte zuerst einen Worker mit `/invite worker:1` einladen.",
            "No eligible worker bot is invited on this server. Please invite one first with `/invite worker:1`."
          ),
        }));
        return;
      }
    }

    const created = createScheduledEvent({
      guildId,
      botId: runtime.config.id,
      name,
      stationKey: station.key,
      voiceChannelId: voiceChannel.id,
      textChannelId: textChannel?.id || null,
      announceMessage: message || null,
      description: description || null,
      stageTopic: stageTopicTemplate || null,
      timeZone: parsedWindow.timeZone,
      createDiscordEvent,
      discordScheduledEventId: null,
      repeat,
      runAtMs: parsedWindow.runAtMs,
      durationMs: parsedWindow.durationMs,
      activeUntilMs: 0,
      deleteAfterStop: false,
      createdByUserId: interaction.user?.id || null,
    });

    if (!created.ok) {
      const storeMessage = translateScheduledEventStoreMessage(created.message, language);
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "danger",
        title: t("✖ Event konnte nicht gespeichert werden", "✖ Could not save event"),
        description: storeMessage,
        includeSupport: true,
      }));
      return;
    }

    let replyEvent = created.event;
    let serverEventNote = "";
    if (createDiscordEvent) {
      try {
        const scheduledEvent = await runtime.syncDiscordScheduledEvent(created.event, station.station, {
          runAtMs: created.event.runAtMs,
        });
        if (scheduledEvent?.id) {
          const patched = patchScheduledEvent(created.event.id, { discordScheduledEventId: scheduledEvent.id });
          replyEvent = patched?.event || { ...created.event, discordScheduledEventId: scheduledEvent.id };
        }
      } catch (err) {
        serverEventNote = `${t("Server-Event Hinweis", "Server event note")}: ${clipText(err?.message || err, 180)}`;
        log("WARN", `[${runtime.config.name}] Event ${created.event.id}: Discord-Server-Event konnte nicht erstellt werden: ${err?.message || err}`);
      }
    }

    const embed = runtime.buildScheduledEventEmbed(replyEvent, station.station?.name || null, language, {
      titlePrefix: `${t("Event erstellt", "Event created")}: `,
    });
    if (serverEventNote) {
      embed.addFields({
        name: t("Hinweis", "Note"),
        value: clipText(serverEventNote, 800),
        inline: false,
      });
    }
    await interaction.reply({ embeds: [embed], components: buildEventActionRows(language), flags: MessageFlags.Ephemeral });
    if (replyEvent.runAtMs <= Date.now() + 5_000) {
      runtime.queueImmediateScheduledEventTick(250);
    }
    return;
  }

  if (sub === "edit") {
    const id = interaction.options.getString("id", true);
    const existing = getScheduledEvent(id);
    if (!existing || existing.guildId !== guildId || existing.botId !== runtime.config.id) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🔎 Event nicht gefunden", "🔎 Event not found"),
        description: t("Event nicht gefunden.", "Event not found."),
      }));
      return;
    }

    const nameRaw = interaction.options.getString("name");
    const stationRaw = interaction.options.getString("station");
    const voiceChannelOption = interaction.options.getChannel("voice");
    const startRaw = interaction.options.getString("start");
    const startDateRaw = interaction.options.getString("startdate");
    const startTimeRaw = interaction.options.getString("starttime");
    const endRaw = interaction.options.getString("end");
    const endDateRaw = interaction.options.getString("enddate");
    const endTimeRaw = interaction.options.getString("endtime");
    const timeZoneRaw = interaction.options.getString("timezone");
    const repeatRaw = interaction.options.getString("repeat");
    const textChannelOption = interaction.options.getChannel("text");
    const clearText = interaction.options.getBoolean("cleartext") === true;
    const serverEventRaw = interaction.options.getBoolean("serverevent");
    const stageTopicRaw = interaction.options.getString("stagetopic");
    const messageRaw = interaction.options.getString("message");
    const descriptionRaw = interaction.options.getString("description");
    const enabledRaw = interaction.options.getBoolean("enabled");

    const existingVoiceChannel = await guild.channels.fetch(existing.voiceChannelId).catch(() => null);
    const nextVoiceChannel = voiceChannelOption || existingVoiceChannel;
    const nextStageTopic = stageTopicRaw !== null
      ? runtime.normalizeClearableText(stageTopicRaw, 120)
      : existing.stageTopic;
    const nextCreateDiscordEvent = serverEventRaw !== null ? serverEventRaw === true : existing.createDiscordEvent;
    const nextTextChannel = textChannelOption
      ? textChannelOption
      : clearText
        ? null
        : (existing.textChannelId ? await guild.channels.fetch(existing.textChannelId).catch(() => null) : null);
    const nextName = nameRaw !== null ? clipText(nameRaw.trim(), 120) : existing.name;
    const nextMessage = messageRaw !== null
      ? runtime.normalizeClearableText(messageRaw, 1200)
      : existing.announceMessage;
    const nextDescription = descriptionRaw !== null
      ? runtime.normalizeClearableText(descriptionRaw, 800)
      : existing.description;

    if (!nextName) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("✍ Eventname fehlt", "✍ Event name missing"),
        description: t("Eventname darf nicht leer sein.", "Event name cannot be empty."),
      }));
      return;
    }

    const voiceError = validateVoiceChannel(nextVoiceChannel, {
      stageTopic: nextStageTopic,
      createDiscordEvent: nextCreateDiscordEvent,
    });
    if (voiceError) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🎙 Voice-Channel prüfen", "🎙 Check voice channel"),
        description: voiceError,
      }));
      return;
    }

    const textError = validateTextChannel(nextTextChannel);
    if (textError) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("💬 Text-Channel prüfen", "💬 Check text channel"),
        description: textError,
      }));
      return;
    }

    const currentDurationMs = Math.max(0, Number.parseInt(String(existing.durationMs || 0), 10) || 0);
    const hasStartChange = [startRaw, startDateRaw, startTimeRaw].some((value) => String(value || "").trim());
    const parsedWindow = parseWindow({
      startRaw,
      startDateRaw,
      startTimeRaw,
      endRaw,
      endDateRaw,
      endTimeRaw,
      baseRunAtMs: existing.runAtMs,
      baseDurationMs: currentDurationMs,
      requestedTimeZone: timeZoneRaw || existing.timeZone || "",
      allowImmediate: !nextCreateDiscordEvent,
    });
    if (!parsedWindow.ok) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🗓 Zeitfenster ungültig", "🗓 Invalid event window"),
        description: parsedWindow.message,
      }));
      return;
    }
    if (nextCreateDiscordEvent && (hasStartChange || serverEventRaw === true) && parsedWindow.runAtMs < Date.now() + 60_000) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("📣 Server-Event zu früh", "📣 Server event too soon"),
        description: t(
          "Mit `serverevent` muss die Startzeit mindestens 60 Sekunden in der Zukunft liegen.",
          "With `serverevent`, start time must be at least 60 seconds in the future."
        ),
      }));
      return;
    }
    const nextRepeat = repeatRaw ? normalizeRepeatMode(repeatRaw) : existing.repeat;
    if (nextRepeat === "weekdays" && !isWorkdayInTimeZone(parsedWindow.runAtMs, parsedWindow.timeZone)) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("📆 Wiederholung passt nicht", "📆 Repeat rule does not match"),
        description: t(
          "Für `weekdays` muss die Startzeit auf Montag bis Freitag liegen.",
          "For `weekdays`, the start time must fall on Monday to Friday."
        ),
      }));
      return;
    }

    let resolvedStation = runtime.resolveStationForGuild(guildId, existing.stationKey, language);
    if (stationRaw) {
      resolvedStation = runtime.resolveStationForGuild(guildId, stationRaw, language);
      if (!resolvedStation.ok) {
        await interaction.reply(buildEventNoticePayload(language, {
          tone: "warning",
          title: t("📻 Sender prüfen", "📻 Check station"),
          description: resolvedStation.message,
        }));
        return;
      }
    } else if (!resolvedStation.ok) {
      resolvedStation = { ok: true, key: existing.stationKey, station: null };
    }

    const eventIsActive = Number.parseInt(String(existing.activeUntilMs || 0), 10) > Date.now()
      && Number.parseInt(String(existing.lastStopAtMs || 0), 10) < Number.parseInt(String(existing.activeUntilMs || 0), 10);

    const patchPayload = {
      name: nextName,
      stationKey: resolvedStation.key,
      voiceChannelId: nextVoiceChannel.id,
      textChannelId: nextTextChannel?.id || null,
      announceMessage: nextMessage || null,
      description: nextDescription || null,
      stageTopic: nextStageTopic || null,
      timeZone: parsedWindow.timeZone,
      createDiscordEvent: nextCreateDiscordEvent,
      repeat: nextRepeat,
      runAtMs: parsedWindow.runAtMs,
      durationMs: parsedWindow.durationMs,
      activeUntilMs: eventIsActive ? parsedWindow.endAtMs : 0,
      enabled: enabledRaw === null ? existing.enabled : enabledRaw === true,
    };

    const updated = patchScheduledEvent(existing.id, patchPayload);
    if (!updated.ok) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "danger",
        title: t("✖ Event konnte nicht aktualisiert werden", "✖ Could not update event"),
        description: translateScheduledEventStoreMessage(updated.message, language),
        includeSupport: true,
      }));
      return;
    }

    let replyEvent = updated.event;
    let serverEventNote = "";
    if (!nextCreateDiscordEvent && existing.discordScheduledEventId) {
      await runtime.deleteDiscordScheduledEventById(guildId, existing.discordScheduledEventId).catch(() => null);
      const cleared = patchScheduledEvent(existing.id, { discordScheduledEventId: null });
      replyEvent = cleared?.event || { ...replyEvent, discordScheduledEventId: null };
    } else if (nextCreateDiscordEvent) {
      try {
        const scheduledEvent = await runtime.syncDiscordScheduledEvent(replyEvent, resolvedStation.station || { name: replyEvent.stationKey }, {
          runAtMs: replyEvent.runAtMs,
        });
        if (scheduledEvent?.id) {
          const synced = patchScheduledEvent(existing.id, { discordScheduledEventId: scheduledEvent.id });
          replyEvent = synced?.event || { ...replyEvent, discordScheduledEventId: scheduledEvent.id };
        }
      } catch (err) {
        serverEventNote = `${t("Server-Event Hinweis", "Server event note")}: ${clipText(err?.message || err, 180)}`;
        log("WARN", `[${runtime.config.name}] Event ${existing.id}: Discord-Server-Event Sync fehlgeschlagen: ${err?.message || err}`);
      }
    }

    const embed = runtime.buildScheduledEventEmbed(replyEvent, resolvedStation.station?.name || null, language, {
      titlePrefix: `${t("Event aktualisiert", "Event updated")}: `,
    });
    if (serverEventNote) {
      embed.addFields({
        name: t("Hinweis", "Note"),
        value: clipText(serverEventNote, 800),
        inline: false,
      });
    }
    await interaction.reply({ embeds: [embed], components: buildEventActionRows(language), flags: MessageFlags.Ephemeral });
    if (replyEvent.enabled && replyEvent.runAtMs <= Date.now() + 5_000) {
      runtime.queueImmediateScheduledEventTick(250);
    }
    return;
  }

  if (sub === "list") {
    const events = listScheduledEvents({
      guildId,
      botId: runtime.config.id,
      includeDisabled: true,
    });

    if (!events.length) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "info",
            title: t("🗓 Keine Events geplant", "🗓 No events scheduled"),
            description: t(
              "Für diesen Server sind aktuell keine OmniFM-Events gespeichert.",
              "There are currently no OmniFM events stored for this server."
            ),
            fields: [
              {
                name: t("Nächster Schritt", "Next step"),
                value: t("Lege mit `/event create` den ersten automatischen Start an.", "Create the first automated start with `/event create`."),
                inline: false,
              },
            ],
          }),
        ],
        components: buildEventActionRows(language),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await interaction.reply({
      embeds: [runtime.buildScheduledEventsListEmbed(events, guildId, language)],
      components: buildEventActionRows(language),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (sub === "delete") {
    const id = interaction.options.getString("id", true);
    const existing = getScheduledEvent(id);
    if (!existing || existing.guildId !== guildId || existing.botId !== runtime.config.id) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "warning",
        title: t("🔎 Event nicht gefunden", "🔎 Event not found"),
        description: t("Event nicht gefunden.", "Event not found."),
        includePlayback: false,
      }));
      return;
    }

    if (Number.parseInt(String(existing.activeUntilMs || 0), 10) > Date.now()
      && Number.parseInt(String(existing.lastStopAtMs || 0), 10) < Number.parseInt(String(existing.activeUntilMs || 0), 10)
    ) {
      await runtime.executeScheduledEventStop({ ...existing, deleteAfterStop: false });
    }

    let removedDiscordEvent = false;
    if (existing.discordScheduledEventId) {
      removedDiscordEvent = await runtime.deleteDiscordScheduledEventById(guildId, existing.discordScheduledEventId);
    }
    const removed = deleteScheduledEvent(id, { guildId, botId: runtime.config.id });
    if (!removed.ok) {
      await interaction.reply(buildEventNoticePayload(language, {
        tone: "danger",
        title: t("✖ Event konnte nicht entfernt werden", "✖ Could not remove event"),
        description: translateScheduledEventStoreMessage(removed.message, language),
        includePlayback: false,
        includeSupport: true,
      }));
      return;
    }
    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: "warning",
          title: t("🧹 Event entfernt", "🧹 Event removed"),
          description: `${t("Event", "Event")} \`${id}\` ${t("entfernt", "removed")}.${removedDiscordEvent ? ` ${t("Discord-Server-Event ebenfalls entfernt.", "Discord server event was removed too.")}` : ""}`,
        }),
      ],
      components: buildEventActionRows(language, { includePlayback: false }),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  await interaction.reply(buildEventNoticePayload(language, {
    tone: "warning",
    title: t("❓ Unbekannte Event-Aktion", "❓ Unknown event action"),
    description: t("Unbekannte /event Aktion.", "Unknown /event action."),
    includePlayback: false,
  }));
}
