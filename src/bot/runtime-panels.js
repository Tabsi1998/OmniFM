import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  MessageFlags,
  StringSelectMenuBuilder,
} from "discord.js";
import { clipText } from "../lib/helpers.js";
import { getTier, getServerPlanConfig } from "../core/entitlements.js";
import { loadStations, filterStationsByTier, buildScopedStationsData } from "../stations-store.js";
import {
  getGuildStations,
  buildCustomStationReference,
  validateCustomStationUrl,
  customStationLogoUrl,
} from "../custom-stations.js";
import { BRAND } from "../config/plans.js";
import {
  PLAY_COMPONENT_PREFIX,
  STATIONS_COMPONENT_PREFIX,
  withLanguageParam,
  DASHBOARD_URL,
  WEBSITE_URL,
} from "./runtime-links.js";
import { buildOmniEmbed, buildLinkRow } from "./discord-ui.js";
import * as ui from "../discord/ui/index.js";
import { normalizeFavoriteStations } from "../lib/favorite-stations.js";
import { buildBrowserEntries, buildStationBrowserPayload } from "./station-browser.js";

const PANEL_TTL_MS = 15 * 60_000;
const PLAY_STATION_OPTION_LIMIT = 25;
const CHANNEL_OPTION_LIMIT = 25;

export function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

export function parsePanelCustomId(customId, prefix) {
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

export function buildStationCatalog(guildId) {
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
        logo: customStationLogoUrl(guildId, customKey, customStation),
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

export function buildStationOptions(entries, language, selectedStationKey = null, { limit = PLAY_STATION_OPTION_LIMIT } = {}) {
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

export function buildVoiceChannelOptions(guild, selectedChannelId = null) {
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

export async function resolveExplicitVoiceChannel(interaction, explicitChannel, explicitChannelId) {
  if (explicitChannel) return explicitChannel;
  const guild = interaction?.guild;
  const channelId = String(explicitChannelId || "").trim();
  if (!guild || !channelId) return null;
  return guild.channels?.cache?.get?.(channelId)
    || await guild.channels?.fetch?.(channelId).catch(() => null)
    || null;
}

export function buildPanelClosedPayload(language, title, description) {
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

// The station browser (#268): Components V2, genre filter, play buttons,
// locked stations with a link to Premium; see station-browser.js.
export function buildRuntimeStationsBrowserPayload(runtime, interaction, session, { hint = "" } = {}) {
  const { t, language } = runtime.createInteractionTranslator(interaction);
  const guildId = String(interaction?.guildId || session?.guildId || "").trim();
  const guildTier = getTier(guildId);
  const customStations = [];
  if (guildTier === "ultimate") {
    for (const [customKey, customStation] of Object.entries(getGuildStations(guildId))) {
      if (!validateCustomStationUrl(customStation?.url).ok) continue;
      customStations.push({
        key: buildCustomStationReference(customKey),
        name: customStation?.name || customKey,
        genre: customStation?.genre || "Radio",
        color: customStation?.color || null,
        logo: customStationLogoUrl(guildId, customKey, customStation),
        tier: "ultimate",
      });
    }
  }
  return buildStationBrowserPayload({
    t,
    prefix: STATIONS_COMPONENT_PREFIX,
    session,
    entries: buildBrowserEntries({ stations: loadStations().stations, guildTier, customStations }),
    planName: getTierConfig(guildId).name,
    premiumUrl: withLanguageParam(BRAND.upgradeUrl || WEBSITE_URL, language),
    applicationId: interaction?.applicationId || runtime.client?.application?.id || null,
    hint,
    favorites: session?.data?.favorites || [],
    canEditFavorites: session?.data?.canEditFavorites === true,
    favoriteLimit: runtime.favoriteLimitForGuild?.(guildId) || 3,
  });
}

// Answer on a Components V2 message: it cannot become an embed again.
export function buildBrowserNotice(t, kind, title, body) {
  return ui.reply(ui.notice(kind, { title, body }));
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
  // The star menu (#276) needs the stored favourites and the right to edit them.
  const settings = interaction?.guildId
    ? await runtime.loadGuildSettingsCached?.(interaction.guildId).catch(() => null)
    : null;
  const session = runtime.createInteractiveUiSession("stations", {
    guildId: interaction?.guildId,
    userId: interaction?.user?.id,
    ttlMs: PANEL_TTL_MS,
    data: {
      stationKey: stationKey || null,
      page: Math.max(0, Number.parseInt(String(page || 0), 10) || 0),
      genre: null,
      query: "",
      favorites: normalizeFavoriteStations(settings?.favoriteStations),
      canEditFavorites: runtime.canEditFavorites?.(interaction) === true,
    },
  });
  return buildRuntimeStationsBrowserPayload(runtime, interaction, session, { hint });
}

// Split into topic modules (#295); the public API stays here.
export { handleRuntimePanelInteraction } from "./runtime-panel-interactions.js";
export { delegatePlayToWorker, executeRuntimePlay } from "./runtime-play.js";
