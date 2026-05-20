import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
  StringSelectMenuBuilder,
} from "discord.js";

import { clipText } from "../lib/helpers.js";
import { buildVoiceChannelAccessMessage } from "../lib/user-facing-setup.js";
import { premiumStationEmbed, customStationEmbed } from "../ui/upgradeEmbeds.js";
import { log } from "../lib/logging.js";
import { getTier, getServerPlanConfig } from "../core/entitlements.js";
import {
  loadStations,
  resolveStation,
  getFallbackKey,
  filterStationsByTier,
  buildScopedStationsData,
} from "../stations-store.js";
import {
  getGuildStations,
  buildCustomStationReference,
  validateCustomStationUrl,
} from "../custom-stations.js";
import { translateCustomStationErrorMessage } from "../lib/language.js";
import { BRAND } from "../config/plans.js";
import {
  PLAY_COMPONENT_PREFIX,
  PLAY_COMPONENT_ID_OPEN,
  STATIONS_COMPONENT_PREFIX,
  STATIONS_COMPONENT_ID_OPEN,
  withLanguageParam,
  DASHBOARD_URL,
  WEBSITE_URL,
} from "./runtime-links.js";
import { buildOmniEmbed, buildLinkRow } from "./discord-ui.js";

const PANEL_TTL_MS = 15 * 60_000;
const PLAY_STATION_OPTION_LIMIT = 25;
const CHANNEL_OPTION_LIMIT = 25;
const STATIONS_PAGE_SIZE = 8;

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

function parsePanelCustomId(customId, prefix) {
  const raw = String(customId || "");
  if (!raw.startsWith(prefix)) return null;
  const rest = raw.slice(prefix.length);
  if (!rest) return null;
  const [action, ...parts] = rest.split(":");
  return {
    action: String(action || "").trim().toLowerCase(),
    sessionId: parts.join(":") || null,
  };
}

function sortStations(entries = []) {
  const tierOrder = { free: 0, pro: 1, ultimate: 2 };
  return [...entries].sort((left, right) => {
    const tierDelta = (tierOrder[left?.tier] ?? 9) - (tierOrder[right?.tier] ?? 9);
    if (tierDelta !== 0) return tierDelta;
    return String(left?.name || left?.key || "").localeCompare(String(right?.name || right?.key || ""));
  });
}

function formatStationTierBadge(entry, language) {
  const tier = String(entry?.tier || "free").trim().toLowerCase();
  if (entry?.source === "custom") return language === "de" ? "Eigene Station" : "Custom";
  if (tier === "pro") return "PRO";
  if (tier === "ultimate") return "ULT";
  return language === "de" ? "Free" : "Free";
}

function buildStationCatalog(guildId) {
  const stations = loadStations();
  const guildTier = getTier(guildId);
  const available = filterStationsByTier(stations.stations, guildTier);
  const mergedStations = { ...available };
  const entries = Object.entries(available).map(([key, station]) => ({
    key,
    name: station?.name || key,
    tier: station?.tier || "free",
    source: "official",
  }));

  if (guildTier === "ultimate") {
    const customStations = getGuildStations(guildId);
    for (const [customKey, customStation] of Object.entries(customStations)) {
      const reference = buildCustomStationReference(customKey);
      const validation = validateCustomStationUrl(customStation?.url);
      if (!validation.ok) continue;
      mergedStations[reference] = {
        name: customStation?.name || customKey,
        url: validation.url,
        tier: "ultimate",
      };
      entries.push({
        key: reference,
        name: customStation?.name || customKey,
        tier: "ultimate",
        source: "custom",
      });
    }
  }

  return {
    guildTier,
    stationsData: buildScopedStationsData(stations, mergedStations),
    entries: sortStations(entries),
  };
}

function buildStationOptions(entries, language, selectedStationKey = null, { limit = PLAY_STATION_OPTION_LIMIT } = {}) {
  const options = [];
  const selectedEntry = entries.find((entry) => entry.key === selectedStationKey) || null;
  if (selectedEntry) {
    options.push(selectedEntry);
  }
  for (const entry of entries) {
    if (options.length >= limit) break;
    if (selectedEntry && entry.key === selectedEntry.key) continue;
    options.push(entry);
  }
  return options.slice(0, limit).map((entry) => ({
    label: clipText(entry.name, 90),
    value: entry.key,
    description: clipText(`${formatStationTierBadge(entry, language)} | ${entry.key}`, 90),
    default: entry.key === selectedStationKey,
  }));
}

function buildVoiceChannelOptions(guild, selectedChannelId = null) {
  const channels = Array.from(guild?.channels?.cache?.values?.() || [])
    .filter((channel) =>
      channel
      && channel.isVoiceBased?.() === true
      && (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)
    )
    .sort((left, right) => {
      const posDelta = (Number(left?.rawPosition) || 0) - (Number(right?.rawPosition) || 0);
      if (posDelta !== 0) return posDelta;
      return String(left?.name || "").localeCompare(String(right?.name || ""));
    })
    .slice(0, CHANNEL_OPTION_LIMIT);

  return channels.map((channel) => ({
    label: clipText(channel.name || channel.id, 90),
    value: channel.id,
    description: channel.type === ChannelType.GuildStageVoice ? "Stage" : "Voice",
    default: channel.id === selectedChannelId,
  }));
}

function buildWorkerOptions(runtime, guildId, language, selectedWorkerIndex = null) {
  if (runtime.role !== "commander" || !runtime.workerManager) return [];
  const guildTier = getTier(guildId);
  const maxIndex = runtime.workerManager.getMaxWorkerIndex(guildTier);
  const options = [{
    label: language === "de" ? "Automatisch wählen" : "Choose automatically",
    value: "auto",
    description: language === "de" ? "Freien oder bereits verbundenen Worker nutzen" : "Use a free or already connected worker",
    default: !Number.isInteger(selectedWorkerIndex),
  }];

  for (let index = 1; index <= Math.min(maxIndex, 16); index += 1) {
    const worker = runtime.workerManager.getWorkerByIndex(index, { prefer: "slot" });
    options.push({
      label: clipText(worker?.config?.name || `Worker ${index}`, 90),
      value: String(index),
      description: language === "de" ? `Worker-Slot ${index}` : `Worker slot ${index}`,
      default: Number(selectedWorkerIndex) === index,
    });
  }
  return options.slice(0, 25);
}

function getSelectedChannelLabel(interaction, channelId, t) {
  if (!channelId) return t("Noch nicht gewählt", "Not selected yet");
  const guildChannel = interaction?.guild?.channels?.cache?.get?.(channelId);
  if (guildChannel) return `<#${guildChannel.id}>`;
  return `#${channelId}`;
}

function getSelectedWorkerLabel(runtime, workerIndex, language) {
  if (!Number.isInteger(workerIndex)) {
    return language === "de" ? "Automatisch" : "Automatic";
  }
  const worker = runtime.workerManager?.getWorkerByIndex?.(workerIndex, { prefer: "slot" });
  return worker?.config?.name || `Worker ${workerIndex}`;
}

function buildPlayFooter(language) {
  return language === "de"
    ? "Tipp: Ohne Auswahl versucht OmniFM deinen aktuellen Sprachkanal zu übernehmen."
    : "Tip: Without an explicit selection, OmniFM tries to use your current voice channel.";
}

async function resolveExplicitVoiceChannel(interaction, explicitChannel, explicitChannelId) {
  if (explicitChannel) return explicitChannel;
  const guild = interaction?.guild;
  const channelId = String(explicitChannelId || "").trim();
  if (!guild || !channelId) return null;
  return guild.channels?.cache?.get?.(channelId)
    || await guild.channels?.fetch?.(channelId).catch(() => null)
    || null;
}

function buildPanelClosedPayload(language, title, description) {
  return {
    embeds: [
      buildOmniEmbed({
        tone: "neutral",
        title,
        description,
      }),
    ],
    components: [],
    flags: MessageFlags.Ephemeral,
  };
}

export function buildRuntimePlayWizardPayload(runtime, interaction, session, { hint = "" } = {}) {
  const { t, language } = runtime.createInteractionTranslator(interaction);
  const guildId = String(interaction?.guildId || session?.guildId || "").trim();
  const guild = interaction?.guild || runtime.client.guilds?.cache?.get?.(guildId) || null;
  const { entries } = buildStationCatalog(guildId);
  const selectedStation = entries.find((entry) => entry.key === session?.data?.stationKey) || null;
  const selectedChannelId = String(session?.data?.channelId || "").trim() || null;
  const selectedWorkerIndex = Number.isInteger(session?.data?.workerIndex) ? session.data.workerIndex : null;
  const tierConfig = getTierConfig(guildId);

  const embed = buildOmniEmbed({
    tone: "live",
    title: t("🎛 OmniFM Schnellstart", "🎛 OmniFM Quick start"),
    description: t(
      `Starte einen Stream ohne Parameter-Raten. Wähle Sender, Sprachkanal und optional einen Worker aus.`,
      `Start a stream without guessing parameters. Pick a station, voice channel, and optionally a worker.`
    ),
    fields: [
      {
        name: t("Auswahl", "Selection"),
        value: [
          `${t("Sender", "Station")}: **${selectedStation?.name || t("Noch nicht gewählt", "Not selected yet")}**`,
          `${t("Channel", "Channel")}: **${getSelectedChannelLabel(interaction, selectedChannelId, t)}**`,
          `${t("Worker", "Worker")}: **${getSelectedWorkerLabel(runtime, selectedWorkerIndex, language)}**`,
        ].join("\n"),
        inline: false,
      },
      {
        name: t("Server", "Server"),
        value: `${clipText(interaction?.guild?.name || guildId, 120)}\n${t("Plan", "Plan")}: **${tierConfig.name}**`,
        inline: true,
      },
      {
        name: t("Was passiert?", "What happens next?"),
        value: t(
          "Mit `Starten` verbindet OmniFM den passenden Worker, joint dem gewählten Channel und startet den Stream direkt.",
          "With `Start`, OmniFM selects the right worker, joins the selected channel, and starts the stream immediately."
        ),
        inline: true,
      },
    ],
    footer: buildPlayFooter(language),
  });

  if (hint) {
    embed.addFields({
      name: t("Hinweis", "Hint"),
      value: clipText(hint, 500),
      inline: false,
    });
  }

  const stationOptions = buildStationOptions(entries, language, selectedStation?.key || null);
  const stationRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PLAY_COMPONENT_PREFIX}station:${session.id}`)
      .setPlaceholder(t("🎧 Sender auswählen", "🎧 Choose a station"))
      .addOptions(stationOptions.length ? stationOptions : [{
        label: t("Keine Sender verfügbar", "No stations available"),
        value: "__none__",
        description: t("Zurzeit ist keine Auswahl möglich", "No selection is available right now"),
        default: true,
      }])
      .setDisabled(!stationOptions.length)
  );

  const channelOptions = buildVoiceChannelOptions(guild, selectedChannelId);
  const channelRow = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PLAY_COMPONENT_PREFIX}channel:${session.id}`)
      .setPlaceholder(t("🔊 Sprachkanal auswählen", "🔊 Choose a voice channel"))
      .addOptions(channelOptions.length ? channelOptions : [{
        label: t("Keine Voice-/Stage-Channels gefunden", "No voice/stage channels found"),
        value: "__none__",
        description: t("Lege zuerst einen Sprachkanal an", "Create a voice channel first"),
        default: true,
      }])
      .setDisabled(!channelOptions.length)
  );

  const components = [stationRow, channelRow];

  const workerOptions = buildWorkerOptions(runtime, guildId, language, selectedWorkerIndex);
  if (workerOptions.length) {
    components.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`${PLAY_COMPONENT_PREFIX}worker:${session.id}`)
          .setPlaceholder(t("🤖 Worker auswählen", "🤖 Choose a worker"))
          .addOptions(workerOptions)
      )
    );
  }

  components.push(
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${PLAY_COMPONENT_PREFIX}start:${session.id}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(t("▶ Starten", "▶ Start")),
      new ButtonBuilder()
        .setCustomId(`${PLAY_COMPONENT_PREFIX}browse:${session.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("📻 Sender stöbern", "📻 Browse stations")),
      new ButtonBuilder()
        .setCustomId(`${PLAY_COMPONENT_PREFIX}refresh:${session.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("🔄 Aktualisieren", "🔄 Refresh")),
      new ButtonBuilder()
        .setCustomId(`${PLAY_COMPONENT_PREFIX}close:${session.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("✖ Schließen", "✖ Close"))
    )
  );

  const linkRow = buildLinkRow([
    { label: "📊 Dashboard", url: withLanguageParam(DASHBOARD_URL, language) },
    { label: "🌐 Website", url: withLanguageParam(WEBSITE_URL, language) },
  ]);
  if (linkRow) components.push(linkRow);

  return {
    embeds: [embed],
    components,
    flags: MessageFlags.Ephemeral,
  };
}

export function buildRuntimeStationsBrowserPayload(runtime, interaction, session, { hint = "" } = {}) {
  const { t, language } = runtime.createInteractionTranslator(interaction);
  const guildId = String(interaction?.guildId || session?.guildId || "").trim();
  const { entries } = buildStationCatalog(guildId);
  const resolvedPage = Math.max(0, Number.parseInt(String(session?.data?.page ?? 0), 10) || 0);
  const totalPages = Math.max(1, Math.ceil(entries.length / STATIONS_PAGE_SIZE));
  const page = Math.min(resolvedPage, totalPages - 1);
  const pageEntries = entries.slice(page * STATIONS_PAGE_SIZE, (page + 1) * STATIONS_PAGE_SIZE);
  const selectedStationKey = String(session?.data?.stationKey || "").trim() || null;
  const selectedEntry = entries.find((entry) => entry.key === selectedStationKey) || null;
  const tierConfig = getTierConfig(guildId);

  const overview = pageEntries.map((entry, index) => {
    const marker = entry.key === selectedStationKey ? "▶" : `${page * STATIONS_PAGE_SIZE + index + 1}.`;
    return `${marker} **${entry.name}**\n\`${entry.key}\` • ${formatStationTierBadge(entry, language)}`;
  }).join("\n\n") || "-";

  const embed = buildOmniEmbed({
    tone: "info",
    title: t("📻 Sender-Browser", "📻 Station browser"),
    description: t(
      `Alle für deinen Server sichtbaren Sender in einer kompakten Auswahl. Wähle einen Sender und öffne danach den Schnellstart.`,
      `All stations visible for your server in one compact browser. Pick a station and then open quick start.`
    ),
    fields: [
      {
        name: t("Aktuelle Seite", "Current page"),
        value: overview,
        inline: false,
      },
      {
        name: t("Ausgewählt", "Selected"),
        value: selectedEntry
          ? `**${selectedEntry.name}**\n\`${selectedEntry.key}\``
          : t("Noch nichts ausgewählt", "Nothing selected yet"),
        inline: true,
      },
      {
        name: t("Server", "Server"),
        value: `${clipText(interaction?.guild?.name || guildId, 120)}\n${t("Plan", "Plan")}: **${tierConfig.name}**`,
        inline: true,
      },
    ],
    footer: t(`Seite ${page + 1}/${totalPages}`, `Page ${page + 1}/${totalPages}`),
  });

  if (hint) {
    embed.addFields({
      name: t("Hinweis", "Hint"),
      value: clipText(hint, 500),
      inline: false,
    });
  }

  const stationPageOptions = pageEntries.map((entry) => ({
    label: clipText(entry.name, 90),
    value: entry.key,
    description: clipText(`${formatStationTierBadge(entry, language)} | ${entry.key}`, 90),
    default: entry.key === selectedStationKey,
  }));

  const stationSelect = new StringSelectMenuBuilder()
    .setCustomId(`${STATIONS_COMPONENT_PREFIX}station:${session.id}`)
    .setPlaceholder(t("📻 Sender auswählen", "📻 Select a station"))
    .addOptions(stationPageOptions.length ? stationPageOptions : [{
      label: t("Keine Sender verfügbar", "No stations available"),
      value: "__none__",
      description: t("Zurzeit ist keine Auswahl möglich", "No selection is available right now"),
      default: true,
    }])
    .setDisabled(!stationPageOptions.length);

  const components = [
    new ActionRowBuilder().addComponents(stationSelect),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`${STATIONS_COMPONENT_PREFIX}page-prev:${session.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("⬅ Zurück", "⬅ Back"))
        .setDisabled(page <= 0),
      new ButtonBuilder()
        .setCustomId(`${STATIONS_COMPONENT_PREFIX}page-next:${session.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("Weiter ➡", "Next ➡"))
        .setDisabled(page >= (totalPages - 1)),
      new ButtonBuilder()
        .setCustomId(`${STATIONS_COMPONENT_PREFIX}play:${session.id}`)
        .setStyle(ButtonStyle.Primary)
        .setLabel(t("🎛 Schnellstart", "🎛 Quick start"))
        .setDisabled(!selectedEntry),
      new ButtonBuilder()
        .setCustomId(`${STATIONS_COMPONENT_PREFIX}refresh:${session.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("🔄 Aktualisieren", "🔄 Refresh")),
      new ButtonBuilder()
        .setCustomId(`${STATIONS_COMPONENT_PREFIX}close:${session.id}`)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("✖ Schließen", "✖ Close"))
    ),
  ];

  return {
    embeds: [embed],
    components,
    flags: MessageFlags.Ephemeral,
  };
}

export async function openRuntimePlayWizard(runtime, interaction, {
  stationKey = null,
  channelId = null,
  workerIndex = null,
  hint = "",
} = {}) {
  const memberChannelId = interaction?.member?.voice?.channelId || null;
  const session = runtime.createInteractiveUiSession("play", {
    guildId: interaction?.guildId,
    userId: interaction?.user?.id,
    ttlMs: PANEL_TTL_MS,
    data: {
      stationKey: stationKey || null,
      channelId: channelId || memberChannelId || null,
      workerIndex: Number.isInteger(workerIndex) ? workerIndex : null,
    },
  });
  return buildRuntimePlayWizardPayload(runtime, interaction, session, { hint });
}

export async function openRuntimeStationsBrowser(runtime, interaction, {
  stationKey = null,
  page = 0,
  hint = "",
} = {}) {
  const session = runtime.createInteractiveUiSession("stations", {
    guildId: interaction?.guildId,
    userId: interaction?.user?.id,
    ttlMs: PANEL_TTL_MS,
    data: {
      stationKey: stationKey || null,
      page: Math.max(0, Number.parseInt(String(page || 0), 10) || 0),
    },
  });
  return buildRuntimeStationsBrowserPayload(runtime, interaction, session, { hint });
}

async function respondWithPayload(runtime, interaction, payload, { update = false } = {}) {
  if (update && typeof interaction.update === "function" && !interaction.deferred && !interaction.replied) {
    const updatePayload = { ...payload };
    delete updatePayload.flags;
    await interaction.update(updatePayload);
    return;
  }
  await runtime.respondInteraction(interaction, payload);
}

async function resolvePlayableStation(runtime, interaction, requested) {
  const { t, language } = runtime.createInteractionTranslator(interaction);
  const guildId = String(interaction.guildId || "").trim();
  const { guildTier, stationsData } = buildStationCatalog(guildId);
  const stations = loadStations();
  const requestedOfficialKey = resolveStation(stations, requested);
  let playStations = stationsData;
  let key = resolveStation(stationsData, requested);

  if (key) {
    const stationTier = playStations.stations[key]?.tier || "free";
    const tierRank = { free: 0, pro: 1, ultimate: 2 };
    if ((tierRank[stationTier] || 0) > (tierRank[guildTier] || 0)) {
      return { errorPayload: premiumStationEmbed(playStations.stations[key].name, stationTier, language) };
    }
    return { key, playStations, guildTier };
  }

  if (requestedOfficialKey && !String(requestedOfficialKey).startsWith("custom:")) {
    const stationTier = stations.stations[requestedOfficialKey]?.tier || "free";
    const tierRank = { free: 0, pro: 1, ultimate: 2 };
    if ((tierRank[stationTier] || 0) > (tierRank[guildTier] || 0)) {
      return { errorPayload: premiumStationEmbed(stations.stations[requestedOfficialKey].name, stationTier, language) };
    }
  }

  const customStations = getGuildStations(guildId);
  const lowered = String(requested || "").toLowerCase();
  const customKey = Object.keys(customStations).find((candidate) =>
    candidate === requested || String(customStations[candidate]?.name || "").toLowerCase() === lowered
  );
  if (customKey && guildTier === "ultimate") {
    key = buildCustomStationReference(customKey);
    const customUrl = customStations[customKey].url;
    const validation = validateCustomStationUrl(customUrl);
    if (!validation.ok) {
      const translated = translateCustomStationErrorMessage(validation.error, language);
      return {
        errorPayload: {
          content: t(
            `Custom-Station kann nicht genutzt werden: ${translated}`,
            `Custom station cannot be used: ${translated}`
          ),
          flags: MessageFlags.Ephemeral,
        },
      };
    }
    playStations = buildScopedStationsData(stations, {
      ...stationsData.stations,
      [key]: { name: customStations[customKey].name, url: validation.url, tier: "ultimate" },
    });
    return { key, playStations, guildTier };
  }

  if (customKey) {
    return { errorPayload: customStationEmbed(language) };
  }

  return {
    errorPayload: {
      content: t("Unbekannte Station.", "Unknown station."),
      flags: MessageFlags.Ephemeral,
    },
  };
}

export async function executeRuntimePlay(runtime, interaction, {
  station = null,
  requestedVoiceChannel = null,
  requestedVoiceChannelId = null,
  requestedBotIndex = null,
  requestedWorkerSelectionMode = "slot",
  openWizardWhenIncomplete = false,
  wizardHint = "",
} = {}) {
  const { t, language } = runtime.createInteractionTranslator(interaction);
  const requestedKey = String(station || "").trim();
  let explicitVoiceChannel = await resolveExplicitVoiceChannel(interaction, requestedVoiceChannel, requestedVoiceChannelId);

  if (explicitVoiceChannel) {
    if (explicitVoiceChannel.guildId !== interaction.guildId) {
      await runtime.respondInteraction(interaction, {
        content: t("Der gewaehlte Voice/Stage-Channel ist nicht in diesem Server.", "The selected voice/stage channel is not in this server."),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (
      !explicitVoiceChannel.isVoiceBased?.()
      || (explicitVoiceChannel.type !== ChannelType.GuildVoice && explicitVoiceChannel.type !== ChannelType.GuildStageVoice)
    ) {
      await runtime.respondInteraction(interaction, {
        content: t("Bitte waehle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel."),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (!requestedKey) {
    if (openWizardWhenIncomplete) {
      const payload = await openRuntimePlayWizard(runtime, interaction, {
        channelId: explicitVoiceChannel?.id || interaction?.member?.voice?.channelId || null,
        workerIndex: requestedBotIndex,
        hint: wizardHint || t("Wähle zuerst einen Sender aus, dann kannst du direkt starten.", "Pick a station first, then start right away."),
      });
      await runtime.respondInteraction(interaction, payload);
      return;
    }
    await runtime.respondInteraction(interaction, {
      content: t("Bitte gib eine Station an oder nutze den Schnellstart.", "Please choose a station or use the quick start panel."),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  const playable = await resolvePlayableStation(runtime, interaction, requestedKey);
  if (playable.errorPayload) {
    await runtime.respondInteraction(interaction, playable.errorPayload);
    return;
  }

  const guildId = interaction.guildId;
  const guild = interaction.guild;
  if (!guild) {
    await runtime.respondInteraction(interaction, {
      content: t("Guild konnte nicht ermittelt werden.", "Could not resolve guild."),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (runtime.role === "commander" && runtime.workerManager) {
    if (typeof runtime.workerManager.refreshRemoteStates === "function") {
      await runtime.workerManager.refreshRemoteStates().catch(() => null);
    }
    let channelId = explicitVoiceChannel?.id;
    if (!channelId) {
      const member = await guild.members.fetch(interaction.user.id).catch(() => null);
      channelId = member?.voice?.channelId || null;
    }
    if (!channelId) {
      if (openWizardWhenIncomplete) {
        const payload = await openRuntimePlayWizard(runtime, interaction, {
          stationKey: playable.key,
          workerIndex: requestedBotIndex,
          hint: buildVoiceChannelAccessMessage({ issue: "select_channel", t }),
        });
        await runtime.respondInteraction(interaction, payload);
        return;
      }
      await runtime.respondInteraction(interaction, {
        content: buildVoiceChannelAccessMessage({ issue: "select_channel", t }),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    await runtime.respondInteraction(interaction, { content: t("Verbinde Worker...", "Connecting worker..."), flags: MessageFlags.Ephemeral });

    let worker;
    let reusingExistingWorker = false;
    if (requestedBotIndex) {
      const check = runtime.workerManager.canUseWorker(requestedBotIndex, guildId, playable.guildTier, {
        prefer: requestedWorkerSelectionMode === "botIndex" ? "botIndex" : "slot",
      });
      if (!check.ok) {
        const reasons = {
          tier: t(`Worker ${requestedBotIndex} erfordert ein hoeheres Abo (max: ${check.maxIndex}).`, `Worker ${requestedBotIndex} requires a higher plan (max: ${check.maxIndex}).`),
          not_configured: t(`Worker ${requestedBotIndex} ist nicht konfiguriert.`, `Worker ${requestedBotIndex} is not configured.`),
          offline: t(`Worker ${requestedBotIndex} ist offline.`, `Worker ${requestedBotIndex} is offline.`),
          not_invited: t(`Worker ${requestedBotIndex} ist nicht auf diesem Server. Nutze \`/invite worker:${requestedBotIndex}\` zum Einladen.`, `Worker ${requestedBotIndex} is not on this server. Use \`/invite worker:${requestedBotIndex}\` to invite.`),
        };
        await runtime.respondInteraction(interaction, { content: reasons[check.reason] || t("Worker nicht verfuegbar.", "Worker not available.") });
        return;
      }
      worker = check.worker;
    } else {
      const activeWorkerInChannel = runtime.workerManager.findStreamingWorkerByChannel(guildId, channelId);
      if (activeWorkerInChannel) {
        worker = activeWorkerInChannel;
        reusingExistingWorker = true;
      } else {
        const connectedWorkerInChannel = await runtime.workerManager.findConnectedWorkerByChannel(guildId, channelId, playable.guildTier);
        if (connectedWorkerInChannel) {
          worker = connectedWorkerInChannel;
          reusingExistingWorker = true;
        }
      }
      if (!worker) {
        worker = runtime.workerManager.findFreeWorker(guildId, playable.guildTier);
      }
    }

    if (!worker) {
      const invited = runtime.workerManager.getInvitedWorkers(guildId, playable.guildTier);
      await runtime.respondInteraction(interaction, {
        content: invited.length === 0
          ? t(
            "Kein Worker-Bot ist auf diesem Server. Nutze `/invite worker:1` zum Einladen.",
            "No worker bot is on this server. Use `/invite worker:1` to invite one."
          )
          : t(
            "Alle Worker-Bots auf diesem Server sind belegt. Lade mehr Worker ein oder stoppe einen laufenden Stream.",
            "All worker bots on this server are busy. Invite more workers or stop a running stream."
          ),
      });
      return;
    }

    const selectedStation = playable.playStations.stations[playable.key];
    let workerAccess = { ok: true };
    if (worker?.remote !== true) {
      const workerGuild = worker.client?.guilds?.cache?.get?.(guildId)
        || await worker.client?.guilds?.fetch?.(guildId).catch(() => null);
      const workerChannel = workerGuild?.channels?.cache?.get?.(channelId)
        || await workerGuild?.channels?.fetch?.(channelId).catch(() => null);
      workerAccess = workerGuild && workerChannel
        ? await worker.validateVoiceChannelAccess(workerGuild, workerChannel, {
          language,
          workerName: worker.config?.name || "Worker",
        })
        : {
          ok: false,
          message: t(
            "Der Ziel-Channel konnte fuer den ausgewaehlten Worker gerade nicht geladen werden. Bitte versuche es erneut.",
            "The target channel could not be loaded for the selected worker right now. Please try again."
          ),
        };
    }
    if (!workerAccess.ok) {
      await runtime.respondInteraction(interaction, { content: workerAccess.message });
      return;
    }

    log("INFO", `[${runtime.config.name}] /play guild=${guildId} station=${playable.key} -> delegating to ${worker.config.name}`);
    worker.clearScheduledEventPlaybackInGuild(guildId);
    const result = await worker.playInGuild(guildId, channelId, playable.key, playable.playStations, undefined);
    if (!result.ok) {
      await runtime.respondInteraction(interaction, { content: t(`Fehler: ${result.error}`, `Error: ${result.error}`) });
      return;
    }
    if (typeof runtime.workerManager.refreshRemoteStates === "function") {
      await runtime.workerManager.refreshRemoteStates({ force: true }).catch(() => null);
    }
    const tierConfig = getTierConfig(guildId);
    const tierLabel = tierConfig.tier !== "free" ? ` [${tierConfig.name} ${tierConfig.bitrate}]` : "";
    const successEmbed = buildOmniEmbed({
      tone: result.recovering ? "warning" : "success",
      title: result.recovering
        ? t("⚠ Stream stabilisiert sich", "⚠ Stream is stabilizing")
        : t("✅ Stream gestartet", "✅ Stream started"),
      description: result.recovering
        ? t(
          `${result.workerName} bleibt verbunden und versucht die Quelle erneut: **${selectedStation?.name || playable.key}**${tierLabel}`,
          `${result.workerName} stays connected and retries the source: **${selectedStation?.name || playable.key}**${tierLabel}`
        )
        : reusingExistingWorker
          ? t(
            `${result.workerName} wechselt jetzt auf **${selectedStation?.name || playable.key}**${tierLabel}.`,
            `${result.workerName} is now switching to **${selectedStation?.name || playable.key}**${tierLabel}.`
          )
          : t(
            `${result.workerName} startet jetzt **${selectedStation?.name || playable.key}**${tierLabel}.`,
            `${result.workerName} is now starting **${selectedStation?.name || playable.key}**${tierLabel}.`
          ),
      fields: [
        {
          name: t("Ziel", "Target"),
          value: `<#${channelId}>`,
          inline: true,
        },
        {
          name: t("Worker", "Worker"),
          value: result.workerName || worker.config?.name || "-",
          inline: true,
        },
      ],
    });
    await runtime.respondInteraction(interaction, {
      embeds: [successEmbed],
      components: [
        new ActionRowBuilder().addComponents(
          new ButtonBuilder()
            .setCustomId(PLAY_COMPONENT_ID_OPEN)
            .setStyle(ButtonStyle.Secondary)
            .setLabel(t("🎛 Neu öffnen", "🎛 Open again")),
          new ButtonBuilder()
            .setCustomId(STATIONS_COMPONENT_ID_OPEN)
            .setStyle(ButtonStyle.Secondary)
            .setLabel(t("📻 Sender", "📻 Stations"))
        ),
      ],
    });
    return;
  }

  log("INFO", `[${runtime.config.name}] /play guild=${guildId} station=${playable.key} tier=${playable.guildTier}`);
  await runtime.respondInteraction(interaction, { content: t("Verbinde Sprachkanal...", "Connecting voice channel..."), flags: MessageFlags.Ephemeral });
  await runtime.runSerializedGuildOperation(guildId, "slash-play", async () => {
    const state = runtime.getState(guildId);
    runtime.clearRestoreRetry(guildId);
    const { connection, error: connectError } = await runtime.connectToVoice(interaction, explicitVoiceChannel, { silent: true });
    if (!connection) {
      if (openWizardWhenIncomplete && String(connectError || "").includes("Channel")) {
        const payload = await openRuntimePlayWizard(runtime, interaction, {
          stationKey: playable.key,
          hint: connectError,
        });
        await runtime.respondInteraction(interaction, payload);
        return;
      }
      await runtime.respondInteraction(interaction, { content: connectError || t("Konnte keine Voice-Verbindung herstellen.", "Could not establish a voice connection.") });
      return;
    }
    state.shouldReconnect = true;
    runtime.clearScheduledEventPlayback(state);

    try {
      await runtime.playStation(state, playable.playStations, playable.key, guildId, {
        countAsStart: true,
        resumeSession: false,
      });
      const tierConfig = getTierConfig(guildId);
      const tierLabel = tierConfig.tier !== "free" ? ` [${tierConfig.name} ${tierConfig.bitrate}]` : "";
      await runtime.respondInteraction(interaction, {
        embeds: [
          buildOmniEmbed({
            tone: "success",
            title: t("✅ Stream gestartet", "✅ Stream started"),
            description: t(
              `Jetzt live: **${playable.playStations.stations[playable.key]?.name || playable.key}**${tierLabel}`,
              `Now live: **${playable.playStations.stations[playable.key]?.name || playable.key}**${tierLabel}`
            ),
          }),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(PLAY_COMPONENT_ID_OPEN)
              .setStyle(ButtonStyle.Secondary)
              .setLabel(t("🎛 Neu öffnen", "🎛 Open again")),
            new ButtonBuilder()
              .setCustomId(STATIONS_COMPONENT_ID_OPEN)
              .setStyle(ButtonStyle.Secondary)
              .setLabel(t("📻 Sender", "📻 Stations"))
          ),
        ],
      });
    } catch (err) {
      log("ERROR", `[${runtime.config.name}] Play error: ${err.message}`);
      state.lastStreamErrorAt = new Date().toISOString();
      const fallbackKey = getFallbackKey(playable.playStations, playable.key);
      if (fallbackKey && fallbackKey !== playable.key && playable.playStations.stations[fallbackKey]) {
        try {
          await runtime.playStation(state, playable.playStations, fallbackKey, guildId, {
            countAsStart: true,
            resumeSession: false,
          });
          await runtime.respondInteraction(interaction, {
            embeds: [
              buildOmniEmbed({
                tone: "warning",
                title: t("⚠ Fallback aktiv", "⚠ Fallback active"),
                description: t(
                  `Fehler bei **${playable.playStations.stations[playable.key]?.name || playable.key}**. OmniFM nutzt stattdessen **${playable.playStations.stations[fallbackKey].name}**.`,
                  `There was an error on **${playable.playStations.stations[playable.key]?.name || playable.key}**. OmniFM switched to **${playable.playStations.stations[fallbackKey].name}** instead.`
                ),
              }),
            ],
          });
          return;
        } catch (fallbackErr) {
          log("ERROR", `[${runtime.config.name}] Fallback error: ${fallbackErr.message}`);
          state.lastStreamErrorAt = new Date().toISOString();
        }
      }

      const recovery = runtime.armPlaybackRecovery(
        guildId,
        state,
        playable.playStations,
        playable.key,
        err,
        { reason: "local-play-start-failed" }
      );
      if (recovery.scheduled) {
        await runtime.respondInteraction(interaction, {
          embeds: [
            buildOmniEmbed({
              tone: "warning",
              title: t("⚠ Stream stabilisiert sich", "⚠ Stream is stabilizing"),
              description: t(
                `Verbunden. Die Quelle ist aktuell instabil, OmniFM versucht **${playable.playStations.stations[playable.key]?.name || playable.key}** erneut.`,
                `Connected. The source is unstable right now, OmniFM is retrying **${playable.playStations.stations[playable.key]?.name || playable.key}**.`
              ),
            }),
          ],
        });
        return;
      }

      state.shouldReconnect = false;
      runtime.invalidateVoiceStatus?.(state, { clearText: true });
      runtime.syncVoiceChannelStatus(guildId, "").catch(() => null);
      runtime.clearNowPlayingTimer(state);
      state.player.stop();
      runtime.clearCurrentProcess(state);
      if (state.connection) {
        state.connection.destroy();
        state.connection = null;
      }
      state.currentStationKey = null;
      state.currentStationName = null;
      state.currentMeta = null;
      state.nowPlayingSignature = null;
      runtime.updatePresence();
      await runtime.respondInteraction(interaction, {
        embeds: [
          buildOmniEmbed({
            tone: "danger",
            title: t("✖ Start fehlgeschlagen", "✖ Start failed"),
            description: t(`Fehler beim Starten: ${err.message}`, `Error while starting: ${err.message}`),
          }),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(PLAY_COMPONENT_ID_OPEN)
              .setStyle(ButtonStyle.Secondary)
              .setLabel(t("🎛 Erneut versuchen", "🎛 Try again")),
            new ButtonBuilder()
              .setCustomId(STATIONS_COMPONENT_ID_OPEN)
              .setStyle(ButtonStyle.Secondary)
              .setLabel(t("📻 Sender", "📻 Stations"))
          ),
        ],
      });
    }
  });
}

export async function handleRuntimePanelInteraction(runtime, interaction) {
  const { t } = runtime.createInteractionTranslator(interaction);
  const customId = String(interaction.customId || "");

  if (customId === PLAY_COMPONENT_ID_OPEN) {
    const payload = await openRuntimePlayWizard(runtime, interaction);
    await respondWithPayload(runtime, interaction, payload, { update: true });
    return true;
  }
  if (customId === STATIONS_COMPONENT_ID_OPEN) {
    const payload = await openRuntimeStationsBrowser(runtime, interaction);
    await respondWithPayload(runtime, interaction, payload, { update: true });
    return true;
  }

  const playAction = parsePanelCustomId(customId, PLAY_COMPONENT_PREFIX);
  if (playAction?.action) {
    const session = runtime.getInteractiveUiSession(playAction.sessionId, {
      type: "play",
      guildId: interaction.guildId,
      userId: interaction.user?.id,
    });
    if (!session) {
      const payload = buildPanelClosedPayload(
        runtime.resolveInteractionLanguage(interaction),
        t("Sitzung abgelaufen", "Session expired"),
        t("Diese Schnellstart-Ansicht ist nicht mehr gültig. Öffne sie bitte erneut.", "This quick-start view is no longer valid. Please open it again.")
      );
      await respondWithPayload(runtime, interaction, payload, { update: true });
      return true;
    }

    if (playAction.action === "station" && interaction.isStringSelectMenu?.()) {
      const stationKey = interaction.values?.[0] === "__none__" ? null : (interaction.values?.[0] || null);
      runtime.updateInteractiveUiSession(session.id, { data: { stationKey } });
      const nextSession = runtime.getInteractiveUiSession(session.id);
      await interaction.update(buildRuntimePlayWizardPayload(runtime, interaction, nextSession));
      return true;
    }

    if (playAction.action === "channel" && interaction.isStringSelectMenu?.()) {
      const channelId = interaction.values?.[0] === "__none__" ? null : (interaction.values?.[0] || null);
      runtime.updateInteractiveUiSession(session.id, { data: { channelId } });
      const nextSession = runtime.getInteractiveUiSession(session.id);
      await interaction.update(buildRuntimePlayWizardPayload(runtime, interaction, nextSession));
      return true;
    }

    if (playAction.action === "worker" && interaction.isStringSelectMenu?.()) {
      const raw = interaction.values?.[0] || "auto";
      const workerIndex = raw === "auto" ? null : (Number.parseInt(String(raw), 10) || null);
      runtime.updateInteractiveUiSession(session.id, { data: { workerIndex } });
      const nextSession = runtime.getInteractiveUiSession(session.id);
      await interaction.update(buildRuntimePlayWizardPayload(runtime, interaction, nextSession));
      return true;
    }

    if (playAction.action === "refresh") {
      await interaction.update(buildRuntimePlayWizardPayload(runtime, interaction, session));
      return true;
    }

    if (playAction.action === "browse") {
      const payload = await openRuntimeStationsBrowser(runtime, interaction, {
        stationKey: session.data.stationKey || null,
        hint: t("Wähle einen Sender und öffne dann wieder den Schnellstart.", "Pick a station and then reopen quick start."),
      });
      await interaction.update(payload);
      return true;
    }

    if (playAction.action === "close") {
      runtime.deleteInteractiveUiSession(session.id);
      await interaction.update(buildPanelClosedPayload(
        runtime.resolveInteractionLanguage(interaction),
        t("Schnellstart geschlossen", "Quick start closed"),
        t("Du kannst `/play` oder die Buttons aus `/help` jederzeit erneut nutzen.", "You can reopen this any time with `/play` or the buttons from `/help`.")
      ));
      return true;
    }

    if (playAction.action === "start") {
      await interaction.deferUpdate();
      await executeRuntimePlay(runtime, interaction, {
        station: session.data.stationKey,
        requestedVoiceChannelId: session.data.channelId,
        requestedBotIndex: session.data.workerIndex,
        openWizardWhenIncomplete: true,
        wizardHint: t("Für den Start fehlen noch Angaben. Ergänze sie direkt hier.", "Some selections are still missing. Complete them right here."),
      });
      return true;
    }
  }

  const stationsAction = parsePanelCustomId(customId, STATIONS_COMPONENT_PREFIX);
  if (stationsAction?.action) {
    const session = runtime.getInteractiveUiSession(stationsAction.sessionId, {
      type: "stations",
      guildId: interaction.guildId,
      userId: interaction.user?.id,
    });
    if (!session) {
      const payload = buildPanelClosedPayload(
        runtime.resolveInteractionLanguage(interaction),
        t("Sitzung abgelaufen", "Session expired"),
        t("Dieser Sender-Browser ist nicht mehr gültig. Öffne ihn bitte erneut.", "This station browser is no longer valid. Please open it again.")
      );
      await respondWithPayload(runtime, interaction, payload, { update: true });
      return true;
    }

    if (stationsAction.action === "station" && interaction.isStringSelectMenu?.()) {
      runtime.updateInteractiveUiSession(session.id, {
        data: { stationKey: interaction.values?.[0] === "__none__" ? null : (interaction.values?.[0] || null) },
      });
      const nextSession = runtime.getInteractiveUiSession(session.id);
      await interaction.update(buildRuntimeStationsBrowserPayload(runtime, interaction, nextSession));
      return true;
    }

    if (stationsAction.action === "page-prev" || stationsAction.action === "page-next") {
      const delta = stationsAction.action === "page-prev" ? -1 : 1;
      runtime.updateInteractiveUiSession(session.id, {
        data: { page: Math.max(0, Number.parseInt(String(session.data?.page ?? 0), 10) + delta) },
      });
      const nextSession = runtime.getInteractiveUiSession(session.id);
      await interaction.update(buildRuntimeStationsBrowserPayload(runtime, interaction, nextSession));
      return true;
    }

    if (stationsAction.action === "refresh") {
      await interaction.update(buildRuntimeStationsBrowserPayload(runtime, interaction, session));
      return true;
    }

    if (stationsAction.action === "play") {
      const payload = await openRuntimePlayWizard(runtime, interaction, {
        stationKey: session.data.stationKey || null,
        hint: t("Sender übernommen. Jetzt noch Channel prüfen und starten.", "Station copied over. Now confirm the channel and start."),
      });
      await interaction.update(payload);
      return true;
    }

    if (stationsAction.action === "close") {
      runtime.deleteInteractiveUiSession(session.id);
      await interaction.update(buildPanelClosedPayload(
        runtime.resolveInteractionLanguage(interaction),
        t("Sender-Browser geschlossen", "Station browser closed"),
        t("Nutze `/stations` oder `/play`, um ihn erneut zu öffnen.", "Use `/stations` or `/play` to open it again.")
      ));
      return true;
    }
  }

  return false;
}
