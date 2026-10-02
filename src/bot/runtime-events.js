import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  PermissionFlagsBits,
} from "discord.js";
import { expandDiscordEmojiAliases } from "../lib/discord-emojis.js";
import { stationSeasonFromWord } from "../lib/seasons.js";
import { clipText } from "../lib/helpers.js";
import { languagePick, translateCustomStationErrorMessage } from "../lib/language.js";
import {
  isStageChannel,
  missingStageModeratorPermissions,
  stageModeratorHowTo,
} from "./stage-moderator.js";
import {
  EVENT_FALLBACK_TIME_ZONE,
  formatDateTime,
  getRepeatLabel,
  normalizeEventTimeZone,
  normalizeRepeatMode,
} from "../lib/event-time.js";
import {
  loadStations,
  normalizeKey,
  filterStationsByTier,
  buildScopedStationsData,
} from "../stations-store.js";
import {
  getGuildStations,
  buildCustomStationReference,
  parseCustomStationReference,
  validateCustomStationUrl,
  customStationLogoUrl,
} from "../custom-stations.js";
import { getTier } from "../core/entitlements.js";
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
import { botTranslator } from "../lib/bot-i18n.js";

// Moved to runtime-event-command.js (#210); re-exported for existing importers.
export {
  handleEventCommand,
} from "./runtime-event-command.js";

export function buildEventActionRows(language = "de", {
  includePlayback = true,
  includeDashboard = true,
  includePremium = false,
  includeSupport = false,
} = {}) {
  const t = botTranslator(language);
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

/**
 * @param {string} language
 * @param {{
 *   tone?: string, title?: string, description?: string,
 *   fields?: { name?: string, value?: any, inline?: boolean }[],
 *   includePlayback?: boolean, includePremium?: boolean, includeSupport?: boolean,
 * }} [options]
 */
export function buildEventNoticePayload(language, {
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

export function resolveStationForGuild(runtime, guildId, rawStationKey, language = "de", { random = Math.random } = {}) {
  const t = botTranslator(language);
  // #430: "/play weihnachten" picks one of the plan's Christmas stations.
  const seasonWord = stationSeasonFromWord(rawStationKey);
  if (seasonWord) {
    const stations = loadStations();
    const available = filterStationsByTier(stations.stations, getTier(guildId));
    const keys = Object.keys(available).filter((key) => (available[key]?.seasons || []).includes(seasonWord));
    if (!keys.length) {
      const anyInCatalog = Object.values(stations.stations || {}).some((station) => (station?.seasons || []).includes(seasonWord));
      const name = {
        christmas: t("Weihnachtssender", "Christmas station"),
        easter: t("Ostersender", "Easter station"),
        halloween: t("Halloween-Sender", "Halloween station"),
      }[seasonWord];
      return {
        ok: false,
        message: anyInCatalog
          ? t("Dein Plan hat gerade keinen {station}.", "Your plan has no {station} right now.", { station: name })
          : t("Im Katalog steht gerade kein {station}.", "The catalogue has no {station} right now.", { station: name }),
      };
    }
    const key = keys[Math.min(keys.length - 1, Math.floor(random() * keys.length))];
    return { ok: true, key, station: available[key], stations: buildScopedStationsData(stations, available), isCustom: false };
  }
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
        return { ok: false, message: t("Custom-Station kann nicht genutzt werden: {reason}", "Custom station cannot be used: {reason}", { reason: translated }) };
      }
      const station = { name: custom.name, url: validation.url, tier: "ultimate", genre: custom.genre || "", logo: customStationLogoUrl(guildId, stationRef.lookupKey, custom) };
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
        "Station `{station}` ist in deinem Plan nicht verfügbar.",
        "Station `{station}` is not available in your plan.", { station: stationRef.key }
      )
    };
  }
  return {
    ok: false,
    message: t(
      "Station `{station}` wurde nicht gefunden.",
      "Station `{station}` was not found.", { station: stationRef.key }
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

  if (!missing.length && isStageChannel(channel) && missingStageModeratorPermissions(channel, me).length) {
    // Checked in the channel: Discord gives these rights as "Stage moderator"
    // there, so checking the server-wide role blocked Stage events.
    return `${languagePick(
      language,
      "Für ein Discord-Server-Event in {channel} muss {bot} dort Stage-Moderator sein.",
      "For a Discord server event in {channel}, {bot} has to be a Stage moderator there.",
      { channel: channel.toString(), bot: runtime.config?.name || "OmniFM" }
    )}\n${stageModeratorHowTo(language)}`;
  }

  if (!missing.length) return null;
  return languagePick(
    language,
    "Discord-Server-Event nicht möglich. Fehlende Rechte: {missing}.",
    "Discord server event is not possible. Missing permissions: {missing}.", { missing: missing.join(", ") }
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
      ? languagePick(language, "aktiv bis {date}", "active until {date}", { date: runtime.formatDiscordTimestamp(effectiveEndAtMs, "F") })
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
    .setDescription(events.length === 1
      ? languagePick(language, "1 Eintrag auf diesem Server", "1 event on this server")
      : languagePick(language, "{count} Einträge auf diesem Server", "{count} events on this server", { count: events.length }))
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
        "{count} weitere Events sind vorhanden. Nutze `/event edit` oder `/event delete` mit der Event-ID.",
        "{count} more events exist. Use `/event edit` or `/event delete` with the event ID.", { count: events.length - fields.length }
      ),
      inline: false,
    });
  }
  return embed;
}

// Split into topic modules (#295); the public API stays here.
export {
  deleteDiscordScheduledEventById,
  ensureStageChannelReady,
  ensureVoiceConnectionForChannel,
  parseEventWindowInput,
  pickScheduledEventWorker,
  postScheduledEventAnnouncement,
  queueImmediateScheduledEventTick,
  resolveGuildVoiceChannel,
  syncDiscordScheduledEvent,
} from "./runtime-event-discord.js";
export {
  executeScheduledEvent,
  executeScheduledEventStop,
  startEventScheduler,
  stopEventScheduler,
  tickScheduledEvents,
} from "./runtime-event-execution.js";
