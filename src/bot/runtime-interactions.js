import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  MessageFlags,
} from "discord.js";

import { log } from "../lib/logging.js";
import {
  TIER_RANK,
  SONG_HISTORY_ENABLED,
  clipText,
} from "../lib/helpers.js";
import {
  resolveLanguageFromDiscordLocale,
  translateCustomStationErrorMessage,
} from "../lib/language.js";
import {
  EVENT_FALLBACK_TIME_ZONE,
  EVENT_TIME_ZONE_SUGGESTIONS,
  formatDateTime,
} from "../lib/event-time.js";
import {
  loadStations,
  resolveStation,
  getFallbackKey,
  filterStationsByTier,
  buildScopedStationsData,
} from "../stations-store.js";
import {
  getGuildStations,
  addGuildStation,
  removeGuildStation,
  countGuildStations,
  MAX_STATIONS_PER_GUILD,
  buildCustomStationReference,
  validateCustomStationUrl,
} from "../custom-stations.js";
import { getTier, requireFeature, getServerPlanConfig, serverHasCapability } from "../core/entitlements.js";
import { getSongHistory } from "../song-history-store.js";
import { recordCommandUsage } from "../listening-stats-store.js";
import { listScheduledEvents } from "../scheduled-events-store.js";
import { getDefaultLanguage } from "../i18n.js";
import { premiumStationEmbed, customStationEmbed } from "../ui/upgradeEmbeds.js";
import { buildInviteUrl } from "../bot-config.js";
import { updateGuildSettings } from "../lib/guild-settings.js";
import {
  buildResolvedVoiceGuardConfig,
  formatVoiceGuardDurationMs,
  validateVoiceGuardSettings,
} from "../lib/voice-guard.js";
import {
  getLicenseById,
  linkServerToLicense,
  unlinkServerFromLicense,
  getServerLicense,
} from "../premium-store.js";
import { PLANS, BRAND } from "../config/plans.js";
import { buildUserFacingRuntimeStatus } from "../lib/user-facing-status.js";
import { buildVoiceChannelAccessMessage } from "../lib/user-facing-setup.js";
import {
  DASHBOARD_URL,
  WEBSITE_URL,
  SUPPORT_URL,
  INVITE_COMPONENT_ID_OPEN,
  PLAY_COMPONENT_ID_OPEN,
  STATIONS_COMPONENT_ID_OPEN,
  WORKERS_COMPONENT_ID_OPEN,
  withLanguageParam,
} from "./runtime-links.js";
import {
  executeRuntimePlay,
  openRuntimeStationsBrowser,
} from "./runtime-panels.js";
import { buildOmniEmbed } from "./discord-ui.js";

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

function buildQuickActionRow(t, {
  includePlay = false,
  includeStations = false,
  includeWorkers = false,
  includeInvite = false,
} = {}) {
  const row = new ActionRowBuilder();
  if (includePlay) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(PLAY_COMPONENT_ID_OPEN)
        .setStyle(ButtonStyle.Primary)
        .setLabel(t("🎛 Schnellstart", "🎛 Quick start"))
    );
  }
  if (includeStations) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(STATIONS_COMPONENT_ID_OPEN)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("📻 Sender", "📻 Stations"))
    );
  }
  if (includeWorkers) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(WORKERS_COMPONENT_ID_OPEN)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("🤖 Worker", "🤖 Workers"))
    );
  }
  if (includeInvite) {
    row.addComponents(
      new ButtonBuilder()
        .setCustomId(INVITE_COMPONENT_ID_OPEN)
        .setStyle(ButtonStyle.Secondary)
        .setLabel(t("📨 Worker einladen", "📨 Invite worker"))
    );
  }
  return row.components.length ? row : null;
}

function buildSupportRow(language, {
  includeDashboard = true,
  includePremium = false,
  includeSupport = true,
  includeWebsite = false,
} = {}) {
  const components = [];
  if (includeDashboard) {
    components.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("📊 Dashboard")
        .setURL(withLanguageParam(DASHBOARD_URL, language))
    );
  }
  if (includePremium) {
    components.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("💎 Premium")
        .setURL(withLanguageParam(BRAND.upgradeUrl || WEBSITE_URL, language))
    );
  }
  if (includeSupport) {
    components.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("🛟 Support")
        .setURL(SUPPORT_URL)
    );
  }
  if (includeWebsite) {
    components.push(
      new ButtonBuilder()
        .setStyle(ButtonStyle.Link)
        .setLabel("🌐 Website")
        .setURL(withLanguageParam(WEBSITE_URL, language))
    );
  }
  if (!components.length) return null;
  return new ActionRowBuilder().addComponents(...components.slice(0, 5));
}

function buildNoticePayload({
  t,
  language,
  tone = "info",
  title,
  description,
  fields = [],
  quickActions = null,
  supportActions = null,
  extraComponents = [],
} = {}) {
  const rows = [];
  if (quickActions) {
    const quickRow = buildQuickActionRow(t, quickActions);
    if (quickRow) rows.push(quickRow);
  }
  if (supportActions) {
    const supportRow = buildSupportRow(language, supportActions);
    if (supportRow) rows.push(supportRow);
  }
  for (const row of Array.isArray(extraComponents) ? extraComponents : []) {
    if (row) rows.push(row);
  }
  return {
    embeds: [
      buildOmniEmbed({
        tone,
        title,
        description,
        fields,
      }),
    ],
    components: rows,
    flags: MessageFlags.Ephemeral,
  };
}

function formatWorkerList(workers = []) {
  return workers
    .map((worker) => clipText(worker?.config?.name || "Worker", 80))
    .filter(Boolean)
    .join(", ");
}

function buildStreamingRuntimeSelectionPayload(runtime, interaction, playback, language) {
  const { t } = runtime.createInteractionTranslator(interaction);
  const guildId = String(interaction?.guildId || "").trim();
  const reason = String(playback?.reason || "none").trim().toLowerCase();
  const requestedWorkerIndex = Number(playback?.requestedWorkerIndex || 0) || null;
  const workers = runtime.role === "commander" && runtime.workerManager
    ? runtime.workerManager.getStreamingWorkers(guildId)
    : [];

  const workerLines = workers.slice(0, 8).map((worker) => {
    const info = worker.getGuildInfo?.(guildId) || {};
    const workerSlot = Number(runtime.workerManager?.getWorkerSlot?.(worker) || worker?.workerSlot || worker?.config?.index || 0) || null;
    const channelId = String(info?.channelId || "").trim();
    const channelLabel = /^\d{16,22}$/.test(channelId) ? `<#${channelId}>` : (channelId || t("unbekannt", "unknown"));
    const stationLabel = clipText(info?.stationName || info?.stationKey || t("unbekannt", "unknown"), 80);
    return `**Bot ${workerSlot || "?"}** - ${stationLabel} - ${channelLabel}\n\`bot:${workerSlot || "?"}\``;
  });

  let title = t("ℹ Kein aktiver Stream", "ℹ No active stream");
  let description = runtime.getStreamingRuntimeSelectionMessage(reason, language);
  let tone = "info";

  if (reason === "multiple" || reason === "multiple_in_channel") {
    title = t("🤖 Worker auswählen", "🤖 Choose a worker");
    description = t(
      "Mehrere Worker streamen aktuell. Du kannst den gewünschten Stream direkt über den optionalen `bot`-Parameter auswählen.",
      "Multiple workers are currently streaming. You can select the desired stream directly with the optional `bot` parameter."
    );
  } else if (reason === "requested_missing") {
    title = t("🔎 Gewählter Worker nicht aktiv", "🔎 Selected worker is not active");
    description = requestedWorkerIndex
      ? t(
        `Für \`bot:${requestedWorkerIndex}\` läuft aktuell kein Stream auf diesem Server.`,
        `There is currently no active stream on this server for \`bot:${requestedWorkerIndex}\`.`
      )
      : runtime.getStreamingRuntimeSelectionMessage(reason, language);
    tone = "warning";
  }

  const fields = workerLines.length > 0
    ? [
      {
        name: t("Aktive Worker", "Active workers"),
        value: clipText(workerLines.join("\n\n"), 1024),
        inline: false,
      },
      {
        name: t("Beispiel", "Example"),
        value: t("`/diag bot:2` oder `/status bot:1`", "`/diag bot:2` or `/status bot:1`"),
        inline: false,
      },
    ]
    : [];

  return {
    embeds: [
      buildOmniEmbed({
        tone,
        title,
        description,
        fields,
      }),
    ],
    components: [
      buildQuickActionRow(t, { includePlay: true, includeStations: true, includeWorkers: runtime.role === "commander" && Boolean(runtime.workerManager) }),
      buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true }),
    ].filter(Boolean),
    flags: MessageFlags.Ephemeral,
  };
}

function getLicense(guildId) {
  return getServerLicense(guildId);
}

function formatVoiceGuardPolicyLabel(policy, t) {
  const normalized = String(policy || "default").trim().toLowerCase();
  if (normalized === "allow") return t("Erlauben", "Allow");
  if (normalized === "disconnect") return t("Disconnect", "Disconnect");
  if (normalized === "return") return t("Zurueckspringen", "Return");
  return t("Standard", "Default");
}

export async function handleRuntimeAutocomplete(runtime, interaction) {
  try {
    if (interaction.guildId) {
      const access = runtime.getGuildAccess(interaction.guildId);
      if (!access.allowed) {
        await interaction.respond([]);
        return;
      }
    }

    const commandPermission = runtime.checkCommandRolePermission(interaction, interaction.commandName);
    if (!commandPermission.ok) {
      await interaction.respond([]);
      return;
    }
    if (interaction.commandName === "event") {
      const feature = requireFeature(interaction.guildId, "scheduledEvents");
      if (!feature.ok) {
        await interaction.respond([]);
        return;
      }
    }

    const focused = interaction.options.getFocused(true);

    if (focused.name === "station") {
      const stations = loadStations();
      const guildId = interaction.guildId;
      const guildTier = getTier(guildId);
      const query = String(focused.value || "").toLowerCase().trim();

      // Standard-Stationen nach Tier gefiltert
      const available = filterStationsByTier(stations.stations, guildTier);
      const allStations = Object.entries(available)
        .map(([key, value]) => {
          const badge = value.tier && value.tier !== "free" ? ` [${value.tier.toUpperCase()}]` : "";
          return { key, name: value.name, display: `${value.name}${badge}` };
        });

      // Custom Stationen (Ultimate)
      if (guildTier === "ultimate") {
        const custom = getGuildStations(guildId);
        for (const [key, station] of Object.entries(custom)) {
          allStations.push({ key, name: station.name, display: `${station.name} [CUSTOM]` });
        }
      }

      const items = (query
        ? allStations.filter((item) =>
            item.key.toLowerCase().includes(query) ||
            item.name.toLowerCase().includes(query)
          )
        : allStations
      )
        .slice(0, 25)
        .map((item) => ({ name: clipText(`${item.display} (${item.key})`, 100), value: item.key }));

      await interaction.respond(items);
      return;
    }

    // Autocomplete fuer /removestation key
    if (focused.name === "key" && interaction.commandName === "removestation") {
      const guildId = interaction.guildId;
      const custom = getGuildStations(guildId);
      const query = String(focused.value || "").toLowerCase().trim();
      const items = Object.entries(custom)
        .filter(([k, v]) => !query || k.includes(query) || v.name.toLowerCase().includes(query))
        .slice(0, 25)
        .map(([k, v]) => ({ name: `${v.name} (${k})`, value: k }));
      await interaction.respond(items);
      return;
    }

    if (focused.name === "timezone" && interaction.commandName === "event") {
      const query = String(focused.value || "").trim().toLowerCase();
      const dedup = new Map();
      for (const entry of EVENT_TIME_ZONE_SUGGESTIONS) {
        if (!entry?.value) continue;
        dedup.set(entry.value, entry.label || entry.value);
      }
      dedup.set(EVENT_FALLBACK_TIME_ZONE, EVENT_FALLBACK_TIME_ZONE);

      const items = [...dedup.entries()]
        .filter(([value, label]) => {
          if (!query) return true;
          return value.toLowerCase().includes(query) || String(label || "").toLowerCase().includes(query);
        })
        .slice(0, 25)
        .map(([value, label]) => ({
          name: clipText(String(label || value), 100),
          value,
        }));

      await interaction.respond(items);
      return;
    }

    if (focused.name === "id" && interaction.commandName === "event") {
      const guildId = interaction.guildId;
      const query = String(focused.value || "").toLowerCase().trim();
      const events = listScheduledEvents({
        guildId,
        botId: runtime.config.id,
        includeDisabled: true,
      });
      const language = runtime.resolveInteractionLanguage(interaction);

      const items = events
        .filter((event) =>
          !query
          || event.id.includes(query)
          || String(event.name || "").toLowerCase().includes(query)
          || String(event.stationKey || "").toLowerCase().includes(query)
        )
        .slice(0, 25)
        .map((event) => ({
          name: clipText(`${event.name} | ${formatDateTime(event.runAtMs, language, event.timeZone)} | ${event.id}`, 100),
          value: event.id,
        }));

      await interaction.respond(items);
      return;
    }

    // Unknown option
    await interaction.respond([]);
  } catch (err) {
    log("ERROR", `[${runtime.config.name}] Autocomplete error: ${err?.message || err}`);
    try {
      await interaction.respond([]);
    } catch {
      // interaction might have already been responded to
    }
  }
}

export async function handleRuntimeInteraction(runtime, interaction) {
  if (interaction.isAutocomplete()) {
    await runtime.handleAutocomplete(interaction);
    return;
  }

  if (interaction.isButton?.() || interaction.isStringSelectMenu?.()) {
    const handled = await runtime.handleComponentInteraction(interaction);
    if (handled) return;
  }

  if (!interaction.isChatInputCommand()) return;

  if (!interaction.guildId) {
    const isDe = resolveLanguageFromDiscordLocale(interaction?.locale, getDefaultLanguage()) === "de";
    await interaction.reply(buildNoticePayload({
      t: (de, en) => (isDe ? de : en),
      language: isDe ? "de" : "en",
      tone: "warning",
      title: isDe ? "🏠 Nur auf Servern verfügbar" : "🏠 Available in servers only",
      description: isDe ? "Dieser Bot funktioniert nur auf Servern." : "This bot only works in servers.",
      supportActions: { includeDashboard: false, includePremium: false, includeSupport: true },
    }));
    return;
  }

  const { t, language } = runtime.createInteractionTranslator(interaction);
  const unrestrictedCommands = new Set(["help", "setup", "premium", "license", "language"]);
  if (!unrestrictedCommands.has(interaction.commandName)) {
    const access = runtime.getGuildAccess(interaction.guildId);
    if (!access.allowed) {
      await runtime.replyAccessDenied(interaction, access);
      return;
    }
  }

  if (runtime.role === "commander" && runtime.workerManager?.refreshRemoteStates) {
    await runtime.workerManager.refreshRemoteStates().catch(() => null);
  }

  if (interaction.commandName === "help") {
    recordCommandUsage(interaction.guildId, interaction.commandName);
    const payload = runtime.buildHelpMessage(interaction);
    await runtime.respondInteraction(interaction, { ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "setup") {
    recordCommandUsage(interaction.guildId, interaction.commandName);
    const payload = runtime.buildSetupMessage(interaction);
    await runtime.respondInteraction(interaction, { ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "language") {
    recordCommandUsage(interaction.guildId, interaction.commandName);
    await runtime.handleLanguageCommand(interaction);
    return;
  }

  if (interaction.commandName === "perm") {
    recordCommandUsage(interaction.guildId, interaction.commandName);
    await runtime.handlePermissionCommand(interaction);
    return;
  }

  const commandPermission = runtime.checkCommandRolePermission(interaction, interaction.commandName);
  if (!commandPermission.ok) {
    await interaction.reply(buildNoticePayload({
      t,
      language,
      tone: "warning",
      title: t("🔒 Befehl nicht erlaubt", "🔒 Command not allowed"),
      description: commandPermission.message,
      supportActions: { includeDashboard: true, includePremium: false, includeSupport: true },
    }));
    return;
  }

  recordCommandUsage(interaction.guildId, interaction.commandName);

  if (interaction.commandName === "event") {
    await runtime.handleEventCommand(interaction);
    return;
  }

  if (interaction.commandName === "stats") {
    await interaction.reply({
      embeds: [runtime.buildListeningStatsEmbed(interaction.guildId, language)],
      components: [
        buildQuickActionRow(t, { includePlay: true, includeStations: true, includeWorkers: runtime.role === "commander" && Boolean(runtime.workerManager) }),
        buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true }),
      ].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  // ---- Commander-only commands ----
  if (interaction.commandName === "invite") {
    if (runtime.role !== "commander" || !runtime.workerManager) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("🤖 Nur im Commander verfügbar", "🤖 Commander only"),
        description: t("Dieser Befehl ist nur für den Commander-Bot.", "This command is only for the commander bot."),
      }));
      return;
    }

    const guildId = String(interaction.guildId || "").trim();
    if (!guildId) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("🏠 Nur auf Servern verfügbar", "🏠 Available in servers only"),
        description: t(
          "Dieser Befehl funktioniert nur auf einem Discord-Server (nicht in DMs).",
          "This command only works inside a Discord server (not in DMs)."
        ),
      }));
      return;
    }

    // Accepts both current option name (`worker`) and legacy name (`bot`).
    const workerIndex = runtime.getIntegerOptionFlexible(interaction, ["worker", "bot"]);
    if (!Number.isInteger(workerIndex)) {
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const payload = await runtime.buildInviteMenuPayload(interaction);
      await interaction.editReply(payload);
      return;
    }

    const guildTier = getTier(guildId);
    const maxIndex = runtime.workerManager.getMaxWorkerIndex(guildTier);

    if (workerIndex < 1 || workerIndex > 16) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("🔢 Worker-Nummer ungültig", "🔢 Invalid worker number"),
        description: t("Worker-Nummer muss zwischen 1 und 16 sein.", "Worker number must be between 1 and 16."),
      }));
      return;
    }

    const resolvedWorker = runtime.workerManager.resolveWorker(workerIndex);
    if (!resolvedWorker?.worker) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("🔎 Worker nicht gefunden", "🔎 Worker not found"),
        description: t(`Worker ${workerIndex} ist nicht konfiguriert.`, `Worker ${workerIndex} is not configured.`),
      }));
      return;
    }
    const workerSlot = Number(resolvedWorker.workerSlot || 0);
    if (!workerSlot || workerSlot > maxIndex) {
      const requiredTier = runtime.formatTierLabel(runtime.getWorkerRequiredTierBySlot(workerSlot || workerIndex), language);
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "info",
        title: t("💎 Höherer Plan nötig", "💎 Higher plan required"),
        description: t(
          `Worker ${workerIndex} erfordert mindestens **${requiredTier}**. Dein Plan erlaubt Worker 1-${maxIndex}.`,
          `Worker ${workerIndex} requires at least **${requiredTier}**. Your plan allows workers 1-${maxIndex}.`
        ),
        supportActions: { includeDashboard: true, includePremium: true, includeSupport: true },
      }));
      return;
    }

    const worker = resolvedWorker.worker;

    const clientId = worker.getApplicationId() || worker.config.clientId;
    const inviteUrl = buildInviteUrl({
      ...worker.config,
      clientId,
    });
    const guild = interaction.guild || runtime.client.guilds.cache.get(guildId) || null;
    const alreadyInvited = await runtime.isWorkerAlreadyInvited(guild, worker);

    if (alreadyInvited) {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(INVITE_COMPONENT_ID_OPEN)
          .setStyle(ButtonStyle.Secondary)
          .setLabel(t("Anderen Worker waehlen", "Select another worker"))
      );
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "info",
        title: t("✅ Worker bereits eingeladen", "✅ Worker already invited"),
        description: t(
          `**${worker.config.name}** ist bereits auf diesem Server.`,
          `**${worker.config.name}** is already on this server.`
        ),
        extraComponents: [row],
      }));
    } else {
      const row = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setStyle(ButtonStyle.Link)
          .setLabel(t(`Invite ${worker.config.name}`, `Invite ${worker.config.name}`))
          .setURL(inviteUrl),
        new ButtonBuilder()
          .setCustomId(INVITE_COMPONENT_ID_OPEN)
          .setStyle(ButtonStyle.Secondary)
          .setLabel(t("Menue", "Menu"))
      );
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "success",
        title: t("📨 Worker bereit", "📨 Worker ready"),
        description: t(
          `Worker **${worker.config.name}** ist bereit zum Einladen.`,
          `Worker **${worker.config.name}** is ready to invite.`
        ),
        fields: [
          {
            name: t("Nächster Schritt", "Next step"),
            value: t("Öffne den Invite-Link und lade den Worker auf diesen Server ein.", "Open the invite link and add the worker to this server."),
            inline: false,
          },
        ],
        extraComponents: [row],
      }));
    }
    return;
  }

  if (interaction.commandName === "workers") {
    if (runtime.role !== "commander" || !runtime.workerManager) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("🤖 Nur im Commander verfügbar", "🤖 Commander only"),
        description: t("Dieser Befehl ist nur für den Commander-Bot.", "This command is only for the commander bot."),
      }));
      return;
    }

    const guildId = String(interaction.guildId || "").trim();
    if (!guildId) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("🏠 Nur auf Servern verfügbar", "🏠 Available in servers only"),
        description: t(
          "Dieser Befehl funktioniert nur auf einem Discord-Server (nicht in DMs).",
          "This command only works inside a Discord server (not in DMs)."
        ),
      }));
      return;
    }
    const view = String(interaction.options?.getString?.("view") || "private").trim().toLowerCase();
    if (view === "panel") {
      if (!runtime.hasGuildManagePermissions(interaction)) {
        await interaction.reply(buildNoticePayload({
          t,
          language,
          tone: "warning",
          title: t("🛠 Rechte fehlen", "🛠 Permission missing"),
          description: t(
            "Du brauchst die Berechtigung `Server verwalten`, um ein öffentliches Worker-Panel zu posten.",
            "You need the `Manage Server` permission to post a public worker panel."
          ),
        }));
        return;
      }

      const channel = interaction.channel;
      if (!channel?.isTextBased?.()) {
        await interaction.reply(buildNoticePayload({
          t,
          language,
          tone: "warning",
          title: t("💬 Text-Channel nötig", "💬 Text channel required"),
          description: t(
            "In diesem Channel kann ich kein Panel posten. Nutze einen Text-Channel.",
            "I cannot post a panel in this channel. Use a text channel."
          ),
        }));
        return;
      }

      const payload = await runtime.buildWorkersStatusPayload(interaction, {
        hint: t(
          "Dieses Panel bleibt im Channel sichtbar und kann Ã¼ber die Buttons aktualisiert werden.",
          "This panel stays visible in the channel and can be refreshed with the buttons."
        ),
      });
      try {
        const panelMessage = await channel.send(payload);
        const createdLabel = t("Nachricht erstellt.", "Message created.");
        await interaction.reply(buildNoticePayload({
          t,
          language,
          tone: "success",
          title: t("📋 Worker-Panel gepostet", "📋 Worker panel posted"),
          description: t(
            `Worker-Panel gepostet: ${panelMessage?.url || createdLabel}`,
            `Worker panel posted: ${panelMessage?.url || createdLabel}`
          ),
        }));
      } catch (err) {
        await interaction.reply(buildNoticePayload({
          t,
          language,
          tone: "danger",
          title: t("✖ Worker-Panel fehlgeschlagen", "✖ Worker panel failed"),
          description: t(
            "Worker-Panel konnte nicht gepostet werden. Prüfe meine Schreibrechte in diesem Channel.",
            "Could not post the worker panel. Check my send-message permission in this channel."
          ),
        }));
        log("WARN", `[${runtime.config.name}] Workers panel post failed guild=${guildId} channel=${channel?.id || "-"}: ${err?.message || err}`);
      }
      return;
    }

    const payload = await runtime.buildWorkersStatusPayload(interaction);
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  const stations = loadStations();
  const state = runtime.getState(interaction.guildId);

  if (interaction.commandName === "stations") {
    const payload = await openRuntimeStationsBrowser(runtime, interaction);
    await runtime.respondInteraction(interaction, payload);
    return;
  }

  if (interaction.commandName === "list") {
    const page = Math.max(0, (interaction.options.getInteger("page") || 1) - 1);
    const payload = await openRuntimeStationsBrowser(runtime, interaction, { page });
    await runtime.respondInteraction(interaction, payload);
    return;
  }

  if (interaction.commandName === "now") {
    const guildTier = getTier(interaction.guildId);
    if ((TIER_RANK[guildTier] ?? 0) < (TIER_RANK.pro ?? 1)) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "info",
        title: t("💎 `/now` ist Pro", "💎 `/now` is Pro"),
        description: t(
          "`/now` ist ab **Pro** verfügbar.",
          "`/now` is available with **Pro** and above."
        ),
        supportActions: { includeDashboard: true, includePremium: true, includeSupport: true },
      }));
      return;
    }

    const playback = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    if (!playback.runtime || !playback.state) {
      await interaction.reply(buildStreamingRuntimeSelectionPayload(runtime, interaction, playback, language));
      return;
    }

    const activeRuntime = playback.runtime;
    const activeState = playback.state;
    const playingGuilds = activeRuntime.getPlayingGuildCount();
    const current = runtime.getResolvedCurrentStation(interaction.guildId, activeState, language);
    if (!current?.station) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("📻 Station nicht mehr verfügbar", "📻 Station no longer available"),
        description: t("Aktuelle Station wurde entfernt.", "Current station was removed."),
        quickActions: { includePlay: true, includeStations: true },
      }));
      return;
    }

    const channelId = activeState.connection?.joinConfig?.channelId || activeState.lastChannelId || null;
    const meta = activeState.currentMeta || {};
    const embed = runtime.buildNowPlayingEmbed(interaction.guildId, current.station, {
      ...meta,
      name: meta.name || current.station.name || null,
    }, {
      channelId,
      listenerCount: activeRuntime.getCurrentListenerCount(interaction.guildId, activeState),
      volume: activeState.volume,
      workerName: activeRuntime.config?.name || BRAND.name,
    });
    embed.addFields(
      {
        name: t("Aktiv auf", "Active on"),
        value: `${playingGuilds} ${t(`Server${playingGuilds === 1 ? "" : "n"}`, `server${playingGuilds === 1 ? "" : "s"}`)}`,
        inline: true,
      }
    );

    await interaction.reply({
      embeds: [embed],
      components: runtime.buildTrackLinkComponents(interaction.guildId, current.station, meta),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "history") {
    const guildTier = getTier(interaction.guildId);
    if ((TIER_RANK[guildTier] ?? 0) < (TIER_RANK.pro ?? 1)) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "info",
        title: t("💎 Song-History ist Pro", "💎 Song history is Pro"),
        description: t(
          "Song-History ist ab **Pro** verfügbar.",
          "Song history is available with **Pro** and above."
        ),
        supportActions: { includeDashboard: true, includePremium: true, includeSupport: true },
      }));
      return;
    }

    if (!SONG_HISTORY_ENABLED) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("🕘 Song-History deaktiviert", "🕘 Song history disabled"),
        description: t(
          "Song-History ist aktuell deaktiviert (`SONG_HISTORY_ENABLED=0`).",
          "Song history is currently disabled (`SONG_HISTORY_ENABLED=0`)."
        ),
      }));
      return;
    }

    const playback = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    const requestedLimit = interaction.options.getInteger("limit") || 10;
    const limit = Math.max(1, Math.min(20, requestedLimit));
    const history = getSongHistory(interaction.guildId, { limit });

    if (!history.length) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "info",
        title: t("🕘 Noch keine Song-History", "🕘 No song history yet"),
        description: t(
          "Noch keine Song-History verfügbar. Starte zuerst eine Station mit `/play`.",
          "No song history yet. Start a station with `/play` first."
        ),
        quickActions: { includePlay: true, includeStations: true },
      }));
      return;
    }

    const payload = runtime.buildSongHistoryEmbed(history, interaction.guildId, playback.runtime, language);
    await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "pause") {
    const requestedBot = interaction.options.getInteger("bot");
    if (runtime.role === "commander" && runtime.workerManager) {
      const workers = requestedBot
        ? [runtime.workerManager.getWorkerByIndex(requestedBot, { prefer: "botIndex" })].filter(Boolean)
        : runtime.workerManager.getStreamingWorkers(interaction.guildId);
      if (workers.length === 0) {
        await interaction.reply(buildNoticePayload({
          t,
          language,
          tone: "info",
          title: t("⏸ Nichts zu pausieren", "⏸ Nothing to pause"),
          description: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."),
          quickActions: { includePlay: true, includeStations: true },
        }));
        return;
      }
      const failures = [];
      const pausedWorkers = [];
      for (const w of workers) {
        const result = await w.pauseInGuild(interaction.guildId);
        if (!result?.ok) failures.push(`${w.config?.name || "Worker"}: ${result?.error || "pause_failed"}`);
        else pausedWorkers.push(w);
      }
      await runtime.workerManager.refreshRemoteStates?.({ force: true })?.catch?.(() => null);
      if (failures.length === workers.length) {
        await interaction.reply(buildNoticePayload({
          t,
          language,
          tone: "danger",
          title: t("✖ Pause fehlgeschlagen", "✖ Pause failed"),
          description: clipText(failures.join("\n"), 3500),
        }));
        return;
      }
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: failures.length > 0 ? "warning" : "success",
        title: t("⏸ Wiedergabe pausiert", "⏸ Playback paused"),
        description: t(
          `Pausiert: ${formatWorkerList(pausedWorkers) || t("Worker", "worker")}`,
          `Paused: ${formatWorkerList(pausedWorkers) || t("worker", "worker")}`
        ),
        fields: failures.length > 0 ? [{ name: t("Fehler", "Errors"), value: clipText(failures.join("\n"), 1024), inline: false }] : [],
        quickActions: { includePlay: true, includeStations: true },
      }));
      return;
    }
    if (!state.currentStationKey) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "info",
        title: t("⏸ Nichts zu pausieren", "⏸ Nothing to pause"),
        description: t("Es läuft nichts.", "Nothing is playing."),
        quickActions: { includePlay: true, includeStations: true },
      }));
      return;
    }
    await runtime.pauseInGuild(interaction.guildId);
    await interaction.reply(buildNoticePayload({
      t,
      language,
      tone: "success",
      title: t("⏸ Wiedergabe pausiert", "⏸ Playback paused"),
      description: t("Der Stream wurde pausiert.", "The stream was paused."),
      quickActions: { includePlay: true, includeStations: true },
    }));
    return;
  }

  if (interaction.commandName === "resume") {
    const requestedBot = interaction.options.getInteger("bot");
    if (runtime.role === "commander" && runtime.workerManager) {
      const workers = requestedBot
        ? [runtime.workerManager.getWorkerByIndex(requestedBot, { prefer: "botIndex" })].filter(Boolean)
        : runtime.workerManager.getStreamingWorkers(interaction.guildId);
      if (workers.length === 0) {
        await interaction.reply(buildNoticePayload({
          t,
          language,
          tone: "info",
          title: t("▶ Nichts zum Fortsetzen", "▶ Nothing to resume"),
          description: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."),
          quickActions: { includePlay: true, includeStations: true },
        }));
        return;
      }
      const failures = [];
      const resumedWorkers = [];
      for (const w of workers) {
        const result = await w.resumeInGuild(interaction.guildId);
        if (!result?.ok) failures.push(`${w.config?.name || "Worker"}: ${result?.error || "resume_failed"}`);
        else resumedWorkers.push(w);
      }
      await runtime.workerManager.refreshRemoteStates?.({ force: true })?.catch?.(() => null);
      if (failures.length === workers.length) {
        await interaction.reply(buildNoticePayload({
          t,
          language,
          tone: "danger",
          title: t("✖ Fortsetzen fehlgeschlagen", "✖ Resume failed"),
          description: clipText(failures.join("\n"), 3500),
        }));
        return;
      }
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: failures.length > 0 ? "warning" : "success",
        title: t("▶ Wiedergabe fortgesetzt", "▶ Playback resumed"),
        description: t(
          `Fortgesetzt: ${formatWorkerList(resumedWorkers) || t("Worker", "worker")}`,
          `Resumed: ${formatWorkerList(resumedWorkers) || t("worker", "worker")}`
        ),
        fields: failures.length > 0 ? [{ name: t("Fehler", "Errors"), value: clipText(failures.join("\n"), 1024), inline: false }] : [],
      }));
      return;
    }
    if (!state.currentStationKey) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "info",
        title: t("▶ Nichts zum Fortsetzen", "▶ Nothing to resume"),
        description: t("Es läuft nichts.", "Nothing is playing."),
        quickActions: { includePlay: true, includeStations: true },
      }));
      return;
    }
    await runtime.resumeInGuild(interaction.guildId);
    await interaction.reply(buildNoticePayload({
      t,
      language,
      tone: "success",
      title: t("▶ Wiedergabe fortgesetzt", "▶ Playback resumed"),
      description: t("Der Stream läuft wieder.", "The stream is playing again."),
    }));
    return;
  }

  if (interaction.commandName === "stop") {
    const requestedBot = interaction.options.getInteger("bot");
    const stopAll = interaction.options.getBoolean("all");
    
    if (runtime.role === "commander" && runtime.workerManager) {
      const guildId = interaction.guildId;
      let workers = [];
      
      // Priorität 1: Explizit bot: Parameter
      if (requestedBot) {
        const worker = runtime.workerManager.getWorkerByIndex(requestedBot, { prefer: "botIndex" });
        if (!worker) {
          // Worker-Index nicht gefunden / nicht konfiguriert
          await interaction.reply(buildNoticePayload({
            t,
            language,
            tone: "warning",
            title: t("🤖 Worker nicht gefunden", "🤖 Worker not found"),
            description: t(
              `Worker **${requestedBot}** ist nicht konfiguriert oder nicht verfügbar.`,
              `Worker **${requestedBot}** is not configured or not available.`
            ),
            extraComponents: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(WORKERS_COMPONENT_ID_OPEN)
                  .setStyle(ButtonStyle.Secondary)
                  .setLabel(t("🤖 Worker anzeigen", "🤖 Show workers"))
              ),
            ],
          }));
          return;
        }
        const streamingWorkers = runtime.workerManager.getStreamingWorkers(guildId);
        if (!streamingWorkers.includes(worker)) {
          await interaction.reply(buildNoticePayload({
            t,
            language,
            tone: "info",
            title: t("ðŸ›‘ Dieser Bot streamt nicht", "ðŸ›‘ This bot is not streaming"),
            description: t(
              `**${worker.config?.name || `Bot ${requestedBot}`}** streamt aktuell nicht auf diesem Server.`,
              `**${worker.config?.name || `Bot ${requestedBot}`}** is not currently streaming on this server.`
            ),
            fields: streamingWorkers.length > 0
              ? [{
                name: t("Aktive Worker", "Active workers"),
                value: clipText(formatWorkerList(streamingWorkers), 1024),
                inline: false,
              }]
              : [],
            quickActions: { includePlay: true, includeStations: true, includeWorkers: true },
          }));
          return;
        }
        workers = [worker];
      }
      // PrioritÃ¤t 2: all: true Parameter
      else if (stopAll) {
        workers = runtime.workerManager.getStreamingWorkers(guildId);
      }
      // PrioritÃ¤t 3: User im Voice-Channel â†’ stoppe nur Worker in diesem Channel
      else {
        const guild = interaction.guild || runtime.client.guilds.cache.get(guildId);
        const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
        const userChannelId = String(member?.voice?.channelId || "").trim();
        
        if (userChannelId) {
          // User ist in Channel â†’ stoppe nur Worker in diesem Channel
          const allStreamingWorkers = runtime.workerManager.getStreamingWorkers(guildId);
          const matchingWorkers = allStreamingWorkers.filter((worker) => {
            const info = worker.getGuildInfo(guildId);
            return String(info?.channelId || "").trim() === userChannelId;
          });
          if (matchingWorkers.length > 0) {
            workers = matchingWorkers;
          } else {
            await interaction.reply(buildNoticePayload({
              t,
              language,
              tone: "info",
              title: t("ðŸ›‘ Kein Worker in deinem Channel", "ðŸ›‘ No worker in your channel"),
              description: t(
                "In deinem Voice-Channel wurde kein aktiver OmniFM-Worker gefunden. Nutze `/stop bot:<botnummer>` oder `/stop all:true`, damit nichts Falsches gestoppt wird.",
                "No active OmniFM worker was found in your voice channel. Use `/stop bot:<bot number>` or `/stop all:true` so the wrong stream is not stopped."
              ),
              fields: allStreamingWorkers.length > 0
                ? [{
                  name: t("Aktive Worker", "Active workers"),
                  value: clipText(formatWorkerList(allStreamingWorkers), 1024),
                  inline: false,
                }]
                : [],
              quickActions: { includePlay: true, includeStations: true, includeWorkers: true },
            }));
            return;
          }
        } else {
          // User nicht im Channel â†’ Error
          await interaction.reply(buildNoticePayload({
            t,
            language,
            tone: "info",
            title: t("🛑 Worker auswählen", "🛑 Choose a worker"),
            description: t(
              "Du musst in einem Voice-Channel sein oder `/stop bot:<nummer>` / `/stop all:true` nutzen.",
              "You must be in a voice channel or use `/stop bot:<number>` / `/stop all:true`."
            ),
            extraComponents: [
              new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                  .setCustomId(WORKERS_COMPONENT_ID_OPEN)
                  .setStyle(ButtonStyle.Secondary)
                  .setLabel(t("🤖 Worker öffnen", "🤖 Open workers"))
              ),
            ],
          }));
          return;
        }
      }
      
      if (workers.length === 0) {
        await interaction.reply(buildNoticePayload({
          t,
          language,
          tone: "info",
          title: t("🛑 Nichts zu stoppen", "🛑 Nothing to stop"),
          description: t("Kein Worker streamt auf diesem Server.", "No worker is streaming on this server."),
          quickActions: { includePlay: true, includeStations: true },
        }));
        return;
      }
      const failures = [];
      const stoppedWorkers = [];
      for (const w of workers) {
        const result = await w.stopInGuild(guildId);
        if (!result?.ok) failures.push(`${w.config?.name || "Worker"}: ${result?.error || "stop_failed"}`);
        else stoppedWorkers.push(w);
      }
      await runtime.workerManager.refreshRemoteStates?.({ force: true })?.catch?.(() => null);
      if (failures.length === workers.length) {
        await interaction.reply(buildNoticePayload({
          t,
          language,
          tone: "danger",
          title: t("✖ Stop fehlgeschlagen", "✖ Stop failed"),
          description: clipText(failures.join("\n"), 3500),
        }));
        return;
      }
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: failures.length > 0 ? "warning" : "success",
        title: t("🛑 Wiedergabe gestoppt", "🛑 Playback stopped"),
        description: t(
          `Gestoppt: ${formatWorkerList(stoppedWorkers) || t("Worker", "worker")}`,
          `Stopped: ${formatWorkerList(stoppedWorkers) || t("worker", "worker")}`
        ),
        fields: failures.length > 0 ? [{ name: t("Fehler", "Errors"), value: clipText(failures.join("\n"), 1024), inline: false }] : [],
        quickActions: { includePlay: true, includeStations: true },
      }));
      return;
    }
    
    // Worker/Legacy Mode: lokaler Stop
    await runtime.stopInGuild(interaction.guildId);

    await interaction.reply(buildNoticePayload({
      t,
      language,
      tone: "success",
      title: t("🛑 Wiedergabe gestoppt", "🛑 Playback stopped"),
      description: t("Gestoppt und Channel verlassen.", "Stopped and left the channel."),
      quickActions: { includePlay: true, includeStations: true },
    }));
    return;
  }

  if (interaction.commandName === "setvolume") {
    const value = interaction.options.getInteger("value", true);
    if (value < 0 || value > 100) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "warning",
        title: t("🎚 Lautstärke ungültig", "🎚 Invalid volume"),
        description: t("Wert muss zwischen 0 und 100 liegen.", "Value must be between 0 and 100."),
      }));
      return;
    }
    if (runtime.role === "commander" && runtime.workerManager) {
      const requestedBot = runtime.getIntegerOptionFlexible(interaction, ["bot", "worker"]);
      const guildTier = getTier(interaction.guildId);
      let targetWorkers = [];

      if (Number.isInteger(requestedBot)) {
        const check = runtime.workerManager.canUseWorker(requestedBot, interaction.guildId, guildTier, { prefer: "botIndex" });
        if (!check.ok) {
          const reasons = {
            tier: t(`Worker ${requestedBot} erfordert ein hoeheres Abo (max: ${check.maxIndex}).`, `Worker ${requestedBot} requires a higher plan (max: ${check.maxIndex}).`),
            not_configured: t(`Worker ${requestedBot} ist nicht konfiguriert.`, `Worker ${requestedBot} is not configured.`),
            offline: t(`Worker ${requestedBot} ist offline.`, `Worker ${requestedBot} is offline.`),
            not_invited: t(`Worker ${requestedBot} ist nicht auf diesem Server eingeladen.`, `Worker ${requestedBot} is not invited on this server.`),
          };
          await interaction.reply(buildNoticePayload({
            t,
            language,
            tone: "warning",
            title: t("🤖 Worker nicht verfügbar", "🤖 Worker not available"),
            description: reasons[check.reason] || t("Worker nicht verfügbar.", "Worker not available."),
          }));
          return;
        }
        targetWorkers = [check.worker];
      } else {
        const workers = runtime.workerManager.getStreamingWorkers(interaction.guildId);
        if (workers.length === 0) {
          const invitedWorkers = runtime.workerManager.getInvitedWorkers(interaction.guildId, guildTier);
          if (invitedWorkers.length === 1) {
            targetWorkers = invitedWorkers;
          } else if (invitedWorkers.length === 0) {
            await interaction.reply(buildNoticePayload({
              t,
              language,
              tone: "warning",
              title: t("🤖 Kein Worker eingeladen", "🤖 No worker invited"),
              description: t("Kein Worker ist auf diesem Server eingeladen.", "No worker is invited on this server."),
              quickActions: { includeInvite: true, includeWorkers: true },
            }));
            return;
          } else {
            await interaction.reply(buildNoticePayload({
              t,
              language,
              tone: "info",
              title: t("🎚 Worker auswählen", "🎚 Choose a worker"),
              description: t(
                "Aktuell streamt kein Worker. Nutze `/setvolume <value> bot:<nummer>`, um die Lautstärke für einen bestimmten Worker zu speichern.",
                "No worker is currently streaming. Use `/setvolume <value> bot:<number>` to save the volume for a specific worker."
              ),
              extraComponents: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId(WORKERS_COMPONENT_ID_OPEN)
                    .setStyle(ButtonStyle.Secondary)
                    .setLabel(t("🤖 Worker öffnen", "🤖 Open workers"))
                ),
              ],
            }));
            return;
          }
        }

        if (workers.length > 0) {
          const guild = interaction.guild || runtime.client.guilds.cache.get(interaction.guildId);
          const member = guild ? await guild.members.fetch(interaction.user.id).catch(() => null) : null;
          const userChannelId = String(member?.voice?.channelId || "").trim();
          if (userChannelId) {
            const matchingByChannel = workers.filter((worker) => {
              const info = worker.getGuildInfo(interaction.guildId);
              return String(info?.channelId || "").trim() === userChannelId;
            });
            if (matchingByChannel.length === 1) {
              targetWorkers = matchingByChannel;
            }
          }

          if (targetWorkers.length === 0 && workers.length === 1) {
            targetWorkers = workers;
          }
          if (targetWorkers.length === 0 && workers.length > 1) {
            await interaction.reply(buildNoticePayload({
              t,
              language,
              tone: "info",
              title: t("🎚 Worker auswählen", "🎚 Choose a worker"),
              description: t(
                "Mehrere Worker streamen aktuell. Nutze `/setvolume <value> bot:<nummer>` oder tritt dem Ziel-Voice-Channel bei.",
                "Multiple workers are currently streaming. Use `/setvolume <value> bot:<number>` or join the target voice channel."
              ),
              extraComponents: [
                new ActionRowBuilder().addComponents(
                  new ButtonBuilder()
                    .setCustomId(WORKERS_COMPONENT_ID_OPEN)
                    .setStyle(ButtonStyle.Secondary)
                    .setLabel(t("🤖 Worker öffnen", "🤖 Open workers"))
                ),
              ],
            }));
            return;
          }
        }
      }

      if (targetWorkers.length === 0) {
        await interaction.reply(buildNoticePayload({
          t,
          language,
          tone: "warning",
          title: t("🔎 Kein passender Worker", "🔎 No matching worker"),
          description: t("Kein passender Worker gefunden.", "No matching worker found."),
        }));
        return;
      }
      const failures = [];
      const appliedWorkers = [];
      const savedWorkers = [];
      for (const worker of targetWorkers) {
        const result = await worker.setVolumeInGuild(interaction.guildId, value);
        if (!result?.ok) {
          failures.push(`${worker.config?.name || "Worker"}: ${result?.error || "setvolume_failed"}`);
          continue;
        }
        if (result?.appliedLive) {
          appliedWorkers.push(worker.config?.name || "Worker");
        } else {
          savedWorkers.push(worker.config?.name || "Worker");
        }
      }
      if (failures.length === targetWorkers.length) {
        await interaction.reply(buildNoticePayload({
          t,
          language,
          tone: "danger",
          title: t("✖ Lautstärke konnte nicht gesetzt werden", "✖ Could not change volume"),
          description: clipText(failures.join("\n"), 3500),
        }));
        return;
      }
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: failures.length > 0 ? "warning" : "success",
        title: t("🎚 Lautstärke aktualisiert", "🎚 Volume updated"),
        description: t(`Zielwert: **${value}**`, `Target value: **${value}**`),
        fields: [
          ...(appliedWorkers.length > 0 ? [{
            name: t("Direkt angewendet", "Applied live"),
            value: clipText(appliedWorkers.join(", "), 1024),
            inline: false,
          }] : []),
          ...(savedWorkers.length > 0 ? [{
            name: t("Gespeichert für später", "Saved for later"),
            value: clipText(savedWorkers.join(", "), 1024),
            inline: false,
          }] : []),
          ...(failures.length > 0 ? [{
            name: t("Fehler", "Errors"),
            value: clipText(failures.join("\n"), 1024),
            inline: false,
          }] : []),
        ],
      }));
      return;
    }
    const result = await runtime.setVolumeInGuild(interaction.guildId, value);
    if (!result?.ok) {
      await interaction.reply(buildNoticePayload({
        t,
        language,
        tone: "danger",
        title: t("✖ Lautstärke konnte nicht gesetzt werden", "✖ Could not change volume"),
        description: t(`Fehler: ${result?.error || "setvolume_failed"}`, `Error: ${result?.error || "setvolume_failed"}`),
      }));
      return;
    }
    await interaction.reply(buildNoticePayload({
      t,
      language,
      tone: "success",
      title: t("🎚 Lautstärke aktualisiert", "🎚 Volume updated"),
      description: result.appliedLive
        ? t(`Lautstärke gesetzt: **${value}**`, `Volume set to: **${value}**`)
        : t(
          `Lautstärke gespeichert: **${value}**. Wird beim nächsten Start verwendet.`,
          `Volume saved: **${value}**. It will be used for the next playback.`
        ),
    }));
    return;
  }

  if (interaction.commandName === "premium") {
    const gid = interaction.guildId;
    const tierConfig = getTierConfig(gid);
    const license = getLicense(gid);
    const tierColor = tierConfig.tier === "ultimate"
      ? BRAND.ultimateColor
      : (tierConfig.tier === "pro" ? BRAND.proColor : BRAND.color);
    const dashboardUrl = withLanguageParam(DASHBOARD_URL, language);
    const premiumUrl = withLanguageParam(BRAND.upgradeUrl || WEBSITE_URL, language);

    let licenseSummary = t("Keine aktive Lizenz.", "No active license.");
    if (license && !license.expired) {
      const expDate = new Date(license.expiresAt).toLocaleDateString(t("de-DE", "en-US"));
      licenseSummary = t(
        `Aktiv bis ${expDate} (${license.remainingDays} Tage uebrig)`,
        `Active until ${expDate} (${license.remainingDays} day${license.remainingDays === 1 ? "" : "s"} left)`
      );
    } else if (license && license.expired) {
      licenseSummary = t("Abgelaufen", "Expired");
    }

    const premiumEmbed = buildOmniEmbed({
      tone: tierConfig.tier === "ultimate" ? "admin" : tierConfig.tier === "pro" ? "live" : "info",
      title: t("💎 Premium-Status", "💎 Premium status"),
      description: `${BRAND.name} | ${tierConfig.name}`,
      fields: [
        {
          name: t("Server", "Server"),
          value: `${clipText(interaction.guild?.name || gid, 120)}\n\`${gid}\``,
          inline: false,
        },
        {
          name: t("Plan", "Plan"),
          value: [
            `**${tierConfig.name}**`,
            `Audio: ${tierConfig.bitrate} Opus`,
            `Reconnect: ${tierConfig.reconnectMs}ms`,
            `${t("Max Bots", "Max bots")}: ${tierConfig.maxBots}`,
          ].join("\n"),
          inline: true,
        },
        {
          name: t("Lizenz", "License"),
          value: licenseSummary,
          inline: true,
        },
      ],
      footer: t("Plan, Audio-Profil und Lizenzstatus für diesen Server.", "Plan, audio profile, and license status for this server."),
    });

    if (tierConfig.tier === "free") {
      premiumEmbed.addFields({
        name: t("Upgrade", "Upgrade"),
        value: t(
          `Upgrade auf ${BRAND.name} Pro oder Ultimate fuer bessere Audioqualitaet, mehr Worker und schnellere Reconnects.`,
          `Upgrade to ${BRAND.name} Pro or Ultimate for better audio quality, more workers, and faster reconnects.`
        ),
        inline: false,
      });
    }

    const rows = [];
    const quickRow = buildQuickActionRow(t, {
      includePlay: true,
      includeStations: true,
      includeWorkers: runtime.role === "commander" && Boolean(runtime.workerManager),
      includeInvite: runtime.role === "commander" && Boolean(runtime.workerManager),
    });
    if (quickRow) rows.push(quickRow);
    rows.push(buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true }));

    await interaction.reply({ embeds: [premiumEmbed], components: rows.filter(Boolean), flags: MessageFlags.Ephemeral });
    return;
  }

  if (interaction.commandName === "health") {
    const playback = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    if (!playback.runtime || !playback.state) {
      await interaction.reply(buildStreamingRuntimeSelectionPayload(runtime, interaction, playback, language));
      return;
    }
    const activeRuntime = playback.runtime;
    const activeState = playback.state;
    const networkHoldMs = activeRuntime.getNetworkRecoveryDelayMs(interaction.guildId);
    const quickRow = buildQuickActionRow(t, {
      includePlay: true,
      includeStations: true,
      includeWorkers: runtime.role === "commander" && Boolean(runtime.workerManager),
    });
    const supportRow = buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true });

    await interaction.reply({
      embeds: [
        buildOmniEmbed({
          tone: activeState.streamErrorCount > 0 || networkHoldMs > 0 ? "warning" : "info",
          title: t("🩺 Stream-Gesundheit", "🩺 Stream health"),
          description: `${activeRuntime.config.name} | ${interaction.guild?.name || interaction.guildId}`,
          fields: [
            {
              name: t("Verbindung", "Connection"),
              value: [
                `Bot: ${activeRuntime.config.name}`,
                `Ready: ${activeRuntime.client.isReady() ? t("ja", "yes") : t("nein", "no")}`,
                `${t("Auto-Reconnect", "Auto reconnect")}: ${activeState.shouldReconnect ? t("aktiv", "enabled") : t("aus", "off")}`,
                `${t("Reconnects", "Reconnects")}: ${activeState.reconnectCount || 0}`,
              ].join("\n"),
              inline: false,
            },
            {
              name: t("Fehler", "Errors"),
              value: [
                `${t("Letzter Stream-Fehler", "Last stream error")}: ${activeState.lastStreamErrorAt || "-"}`,
                `${t("Fehler-Reihe", "Error streak")}: ${activeState.streamErrorCount || 0}`,
                `${t("Letzter ffmpeg Exit-Code", "Last ffmpeg exit code")}: ${activeState.lastProcessExitCode ?? "-"}`,
                `${t("Letzter Reconnect", "Last reconnect")}: ${activeState.lastReconnectAt || "-"}`,
              ].join("\n"),
              inline: false,
            },
            {
              name: t("Recovery", "Recovery"),
              value: networkHoldMs > 0
                ? t(
                  `Netz-Cooldown aktiv (${Math.round(networkHoldMs)}ms). Der Stream stabilisiert sich gerade erneut.`,
                  `Network cooldown active (${Math.round(networkHoldMs)}ms). The stream is stabilizing again right now.`
                )
                : t("Kein zusätzlicher Netz-Cooldown aktiv.", "No extra network cooldown is active."),
              inline: false,
            },
          ],
        }),
      ],
      components: [quickRow, supportRow].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "diag") {
    const playback = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    if (!playback.runtime || !playback.state) {
      await interaction.reply(buildStreamingRuntimeSelectionPayload(runtime, interaction, playback, language));
      return;
    }
    const activeRuntime = playback.runtime;
    const activeState = playback.state;
    const connected = activeState.connection ? t("ja", "yes") : t("nein", "no");
    const channelId = activeState.connection?.joinConfig?.channelId || activeState.lastChannelId || "-";
    const station = activeState.currentStationKey || "-";
    const diag = runtime.getStreamDiagnostics(interaction.guildId, activeState);
    const restartPending = activeState.streamRestartTimer ? t("ja", "yes") : t("nein", "no");
    const reconnectPending = activeState.reconnectTimer ? t("ja", "yes") : t("nein", "no");
    const networkHoldMs = activeRuntime.getNetworkRecoveryDelayMs(interaction.guildId);
    const resolvedChannel = /^\d{16,22}$/.test(String(channelId))
      ? `<#${channelId}>`
      : String(channelId || "-");

    const diagEmbed = new EmbedBuilder()
      .setColor(connected === t("ja", "yes") ? BRAND.proColor : BRAND.color)
      .setTitle(t("Stream-Diagnose", "Stream diagnostics"))
      .setDescription(`${activeRuntime.config.name} | ${interaction.guild?.name || interaction.guildId}`)
      .addFields(
        {
          name: t("Stream-Profil", "Stream profile"),
          value: [
            `Plan: ${diag.tier.toUpperCase()}`,
            `preset=${diag.preset}`,
            `transcode=${diag.transcodeEnabled ? "on" : "off"} (${diag.transcodeMode})`,
            `${t("Bitrate Ziel", "Target bitrate")}: ${diag.bitrateOverride || "-"} (${diag.requestedBitrateKbps}k)`,
            `${t("Profil", "Profile")}: ${diag.profile}`,
          ].join("\n"),
          inline: false,
        },
        {
          name: "FFmpeg",
          value: `queue=${diag.queue} | probe=${diag.probeSize} | analyzeUs=${diag.analyzeUs}`,
          inline: false,
        },
        {
          name: t("Wiedergabe", "Playback"),
          value: [
            `${t("Verbunden", "Connected")}: ${connected}`,
            `Channel: ${resolvedChannel}`,
            `Station: ${station}`,
            `${t("Stream-Laufzeit", "Stream lifetime")}: ${diag.streamLifetimeSec}s`,
            `${t("Fehler (Reihe)", "Errors (streak)")}: ${activeState.streamErrorCount || 0}`,
            `${t("Restart geplant", "Restart pending")}: ${restartPending}`,
            `${t("Reconnect geplant", "Reconnect pending")}: ${reconnectPending}`,
            `${t("Netz-Cooldown", "Network cooldown")}: ${networkHoldMs > 0 ? `${Math.round(networkHoldMs)}ms` : "0ms"}`,
          ].join("\n"),
          inline: false,
        }
      );

    await interaction.reply({
      embeds: [diagEmbed],
      components: [
        buildQuickActionRow(t, {
          includePlay: true,
          includeStations: true,
          includeWorkers: runtime.role === "commander" && Boolean(runtime.workerManager),
        }),
        buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true }),
      ].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "status") {
    const playback = await runtime.resolveStreamingRuntimeForInteraction(interaction);
    if (!playback.runtime || !playback.state) {
      await interaction.reply(buildStreamingRuntimeSelectionPayload(runtime, interaction, playback, language));
      return;
    }
    const activeRuntime = playback.runtime;
    const activeState = playback.state;
    const channelId = activeState.connection?.joinConfig?.channelId || activeState.lastChannelId || "-";
    const resolvedChannel = /^\d{16,22}$/.test(String(channelId))
      ? `<#${channelId}>`
      : String(channelId || "-");
    const userStatus = buildUserFacingRuntimeStatus({
      ready: activeRuntime.client?.isReady?.() === true,
      connected: Boolean(activeState.connection),
      playing: activeState.player?.state?.status === "playing" || activeState.connection?.state?.status === "ready",
      shouldReconnect: activeState.shouldReconnect === true,
      reconnectPending: Boolean(activeState.reconnectTimer),
      reconnectInFlight: activeState.reconnectInFlight === true,
      streamRestartPending: Boolean(activeState.streamRestartTimer),
      voiceConnectInFlight: activeState.voiceConnectInFlight === true,
      reconnectAttempts: activeState.reconnectAttempts || 0,
      streamErrorCount: activeState.streamErrorCount || 0,
      stationName: activeState.currentStationName || activeState.currentStationKey || "-",
      channelLabel: resolvedChannel,
      listeners: typeof activeRuntime.getCurrentListenerCount === "function"
        ? Number(activeRuntime.getCurrentListenerCount(interaction.guildId, activeState) || 0) || 0
        : 0,
      voiceGuardLastAction: activeState.voiceGuardLastAction || null,
    }, { t });

    const statusEmbed = new EmbedBuilder()
      .setColor(userStatus.accent)
      .setTitle(t("Bot-Status", "Bot status"))
      .setDescription(`${activeRuntime.config.name} | ${interaction.guild?.name || interaction.guildId}`)
      .addFields(
        {
          name: t("Status", "Status"),
          value: userStatus.label,
          inline: false,
        },
        {
          name: t("Aktuell", "Currently"),
          value: userStatus.summary,
          inline: false,
        },
        {
          name: t("Wiedergabe", "Playback"),
          value: userStatus.playback,
          inline: false,
        },
        {
          name: t("Hinweis", "Hint"),
          value: userStatus.nextStep,
          inline: false,
        }
      );

    await interaction.reply({
      embeds: [statusEmbed],
      components: [
        buildQuickActionRow(t, {
          includePlay: true,
          includeStations: true,
          includeWorkers: runtime.role === "commander" && Boolean(runtime.workerManager),
        }),
        buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true }),
      ].filter(Boolean),
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  if (interaction.commandName === "addstation") {
    const guildId = interaction.guildId;
    const guildTier = getTier(guildId);
    if (guildTier !== "ultimate") {
      await interaction.reply(customStationEmbed(language));
      return;
    }
    const key = interaction.options.getString("key");
    const name = interaction.options.getString("name");
    const url = interaction.options.getString("url");
    const result = await addGuildStation(guildId, key, name, url);
    if (result.error) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "warning",
            title: t("⚠ Custom-Station konnte nicht gespeichert werden", "⚠ Could not save custom station"),
            description: translateCustomStationErrorMessage(result.error, language),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
    } else {
      const count = countGuildStations(guildId);
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "success",
            title: t("✅ Custom-Station gespeichert", "✅ Custom station saved"),
            description: t(
              `**${result.station.name}** ist jetzt als \`${result.key}\` verfügbar.`,
              `**${result.station.name}** is now available as \`${result.key}\`.`
            ),
            fields: [
              {
                name: t("Nutzung", "Usage"),
                value: t(`${count}/${MAX_STATIONS_PER_GUILD} Slots belegt`, `${count}/${MAX_STATIONS_PER_GUILD} slots used`),
                inline: true,
              },
              {
                name: t("Nächster Schritt", "Next step"),
                value: t("Öffne `/play` oder `/stations`, um den Sender direkt zu starten.", "Open `/play` or `/stations` to start the station right away."),
                inline: true,
              },
            ],
          }),
        ],
        components: [
          new ActionRowBuilder().addComponents(
            new ButtonBuilder()
              .setCustomId(PLAY_COMPONENT_ID_OPEN)
              .setStyle(ButtonStyle.Primary)
              .setLabel(t("🎛 Schnellstart", "🎛 Quick start")),
            new ButtonBuilder()
              .setCustomId(STATIONS_COMPONENT_ID_OPEN)
              .setStyle(ButtonStyle.Secondary)
              .setLabel(t("📻 Sender", "📻 Stations"))
          ),
        ],
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (interaction.commandName === "removestation") {
    const guildId = interaction.guildId;
    const guildTier = getTier(guildId);
    if (guildTier !== "ultimate") {
      await interaction.reply(customStationEmbed(language));
      return;
    }
    const key = interaction.options.getString("key");
    if (removeGuildStation(guildId, key)) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "warning",
            title: t("🧹 Custom-Station entfernt", "🧹 Custom station removed"),
            description: t(`Station \`${key}\` entfernt.`, `Station \`${key}\` removed.`),
          }),
        ],
        components: [
          buildQuickActionRow(t, { includePlay: true, includeStations: true }),
          buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true }),
        ].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
    } else {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "warning",
            title: t("🔎 Custom-Station nicht gefunden", "🔎 Custom station not found"),
            description: t(`Station \`${key}\` nicht gefunden.`, `Station \`${key}\` was not found.`),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  if (interaction.commandName === "mystations") {
    const guildId = interaction.guildId;
    const guildTier = getTier(guildId);
    if (guildTier !== "ultimate") {
      await interaction.reply(customStationEmbed(language));
      return;
    }
    const custom = getGuildStations(guildId);
    const keys = Object.keys(custom);
    if (keys.length === 0) {
      const quickRow = buildQuickActionRow(t, { includePlay: true, includeStations: true });
      const supportRow = buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true });
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "info",
            title: t("📂 Eigene Sender", "📂 Custom stations"),
            description: t(
              "Du hast noch keine eigenen Sender gespeichert. Lege zuerst mit `/addstation` einen privaten Stream an.",
              "You do not have any custom stations yet. Create a private stream first with `/addstation`."
            ),
            fields: [
              {
                name: t("Nächster Schritt", "Next step"),
                value: t("Danach kannst du den Sender direkt über `/play` oder `/stations` starten.", "After that, you can start it directly via `/play` or `/stations`."),
                inline: false,
              },
            ],
          }),
        ],
        components: [quickRow, supportRow].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
    } else {
      const list = keys.map((k) => {
        const station = custom[k] || {};
        const meta = [];
        if (station.folder) meta.push(`[${station.folder}]`);
        if (Array.isArray(station.tags) && station.tags.length > 0) {
          meta.push(station.tags.map((tag) => `#${tag}`).join(", "));
        }
        const suffix = meta.length > 0 ? ` - ${meta.join(" ")}` : "";
        return `• **${station.name}**\n\`${k}\`${suffix}`;
      }).join("\n\n");
      const quickRow = buildQuickActionRow(t, { includePlay: true, includeStations: true });
      const supportRow = buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true });
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "admin",
            title: t("📂 Eigene Sender", "📂 Custom stations"),
            description: t(
              `${keys.length}/${MAX_STATIONS_PER_GUILD} Slots belegt. Deine privaten Streams sind direkt in OmniFM verfügbar.`,
              `${keys.length}/${MAX_STATIONS_PER_GUILD} slots used. Your private streams are directly available in OmniFM.`
            ),
            fields: [
              {
                name: t("Sender", "Stations"),
                value: clipText(list, 3500),
                inline: false,
              },
            ],
          }),
        ],
        components: [quickRow, supportRow].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
    }
    return;
  }

  // === /license Command ===
  if (interaction.commandName === "license") {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    const requiresManagePermission = sub === "activate" || sub === "remove";
    if (requiresManagePermission && !runtime.hasGuildManagePermissions(interaction)) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "warning",
            title: t("🛠 Lizenz-Rechte fehlen", "🛠 License permission missing"),
            description: t(
              "Du brauchst die Berechtigung `Server verwalten`, um Lizenz-Aktionen auszufuehren.",
              "You need the `Manage Server` permission to execute license actions."
            ),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral
      });
      return;
    }

    if (sub === "activate") {
      const rawKey = interaction.options.getString("key").trim();
      const keyCandidates = [...new Set([rawKey, rawKey.toLowerCase(), rawKey.toUpperCase()])];
      let lic = null;
      let resolvedKey = null;
      for (const candidate of keyCandidates) {
        lic = getLicenseById(candidate);
        if (lic) {
          resolvedKey = lic.id || candidate;
          break;
        }
      }

      if (!lic) {
        await interaction.reply({
          embeds: [
            buildOmniEmbed({
              tone: "danger",
              title: t("✖ Lizenz-Key nicht gefunden", "✖ License key not found"),
              description: t(
                "Bitte prüfe den Key und versuche es erneut oder verwalte die Lizenz direkt im Dashboard.",
                "Please verify the key and try again, or manage the license directly in the dashboard."
              ),
            }),
          ],
          components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      if (lic.expired) {
        await interaction.reply({
          embeds: [
            buildOmniEmbed({
              tone: "warning",
              title: t("⚠ Lizenz abgelaufen", "⚠ License expired"),
              description: t("Diese Lizenz ist abgelaufen. Bitte erneuere dein Abo.", "This license has expired. Please renew your subscription."),
            }),
          ],
          components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const result = linkServerToLicense(guildId, resolvedKey);
      if (!result.ok) {
        const msg = result.message.includes("already linked")
          ? t("Dieser Server ist bereits mit dieser Lizenz verknuepft.", "This server is already linked to this license.")
          : result.message.includes("seat")
            ? t(
              `Alle ${lic.seats} Server-Slots sind belegt. Entferne zuerst einen Server mit \`/license remove\` oder upgrade auf mehr Seats.`,
              `All ${lic.seats} server seats are used. Remove a server with \`/license remove\` or upgrade to more seats first.`
            )
            : result.message;
        await interaction.reply({
          embeds: [
            buildOmniEmbed({
              tone: "warning",
              title: t("⚠ Lizenz konnte nicht aktiviert werden", "⚠ License could not be activated"),
              description: msg,
            }),
          ],
          components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const refreshedLicense = getLicenseById(resolvedKey) || lic;
      const planName = PLANS[refreshedLicense.plan]?.name || refreshedLicense.plan;
      const expDate = refreshedLicense.expiresAt
        ? new Date(refreshedLicense.expiresAt).toLocaleDateString(t("de-DE", "en-US"))
        : t("Unbegrenzt", "Unlimited");
      const usedSeats = refreshedLicense.linkedServerIds?.length || 0;
      const quickRow = buildQuickActionRow(t, { includePlay: true, includeStations: true, includeWorkers: true, includeInvite: true });
      const supportRow = buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true });
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: refreshedLicense.plan === "ultimate" ? "admin" : "live",
            title: t("✅ Lizenz aktiviert", "✅ License activated"),
            description: t(
              `Dieser Server wurde erfolgreich mit deiner **${planName}**-Lizenz verknüpft.`,
              `This server was linked successfully with your **${planName}** license.`
            ),
            fields: [
              { name: t("Lizenz-Key", "License key"), value: `\`${resolvedKey}\``, inline: true },
              { name: t("Plan", "Plan"), value: planName, inline: true },
              { name: t("Server-Slots", "Server seats"), value: `${usedSeats}/${refreshedLicense.seats}`, inline: true },
              { name: t("Gültig bis", "Valid until"), value: expDate, inline: true },
            ],
          }),
        ],
        components: [quickRow, supportRow].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "info") {
      const lic = getServerLicense(guildId);
      if (!lic) {
        await interaction.reply({
          embeds: [
            buildOmniEmbed({
              tone: "info",
              title: t("🔓 Keine aktive Lizenz", "🔓 No active license"),
              description: t(
                "Dieser Server hat aktuell keine aktive Lizenz. Du kannst einen Key aktivieren oder direkt upgraden.",
                "This server currently has no active license. You can activate a key or upgrade directly."
              ),
            }),
          ],
          components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const planName = PLANS[lic.plan]?.name || lic.plan;
      const expDate = lic.expiresAt ? new Date(lic.expiresAt).toLocaleDateString(t("de-DE", "en-US")) : t("Unbegrenzt", "Unlimited");
      const linked = lic.linkedServerIds || [];
      const tierConfig = PLANS[lic.plan] || PLANS.free;
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: lic.plan === "ultimate" ? "admin" : "live",
            title: `💎 OmniFM ${planName}`,
            description: t("Lizenz- und Planübersicht für diesen Server.", "License and plan overview for this server."),
            fields: [
              { name: t("Lizenz-Key", "License key"), value: `\`${lic.id || "-"}\``, inline: true },
              { name: t("Plan", "Plan"), value: planName, inline: true },
              { name: t("Server-Slots", "Server seats"), value: `${linked.length}/${lic.seats}`, inline: true },
              { name: t("Gültig bis", "Valid until"), value: expDate, inline: true },
              { name: t("Verbleibend", "Remaining"), value: t(`${lic.remainingDays} Tage`, `${lic.remainingDays} days`), inline: true },
              { name: t("Audio", "Audio"), value: tierConfig.bitrate, inline: true },
              { name: t("Max Bots", "Max bots"), value: `${tierConfig.maxBots}`, inline: true },
              { name: t("Reconnect", "Reconnect"), value: `${tierConfig.reconnectMs}ms`, inline: true },
            ],
            footer: lic.expired ? t("ABGELAUFEN", "EXPIRED") : "OmniFM Premium",
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "remove") {
      const lic = getServerLicense(guildId);
      if (!lic || !lic.id) {
        await interaction.reply({
          embeds: [
            buildOmniEmbed({
              tone: "info",
              title: t("🔓 Keine aktive Lizenz", "🔓 No active license"),
              description: t("Dieser Server hat keine aktive Lizenz.", "This server has no active license."),
            }),
          ],
          components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      const result = unlinkServerFromLicense(guildId, lic.id);
      if (!result.ok) {
        await interaction.reply({
          embeds: [
            buildOmniEmbed({
              tone: "danger",
              title: t("✖ Lizenz konnte nicht entfernt werden", "✖ License could not be removed"),
              description: t("Fehler beim Entfernen: ", "Error while removing: ") + result.message,
            }),
          ],
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "warning",
            title: t("🧹 Lizenz entfernt", "🧹 License removed"),
            description: t(
              "Server wurde von der Lizenz entfernt. Der Server-Slot ist jetzt frei und kann für einen anderen Server genutzt werden.",
              "The server was unlinked from the license. The seat is now free and can be used for another server."
            ),
            fields: [
              {
                name: t("Nächster Schritt", "Next step"),
                value: t("Nutze `/license activate`, um einen neuen Key zu verbinden, oder upgrade direkt über das Dashboard.", "Use `/license activate` to link a new key, or upgrade directly in the dashboard."),
                inline: false,
              },
            ],
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (interaction.commandName === "voiceguard") {
    const sub = interaction.options.getSubcommand();
    const guildId = interaction.guildId;
    if (!serverHasCapability(guildId, "voice_guard")) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "info",
            title: t("🛡 Voice Guard gesperrt", "🛡 Voice guard locked"),
            description: t(
              "Voice Guard ist auf diesem Server aktuell nicht verfuegbar.",
              "Voice guard is not currently available on this server."
            ),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: true, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
    if (!runtime.hasGuildManagePermissions(interaction)) {
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "warning",
            title: t("🛠 Voice-Guard-Rechte fehlen", "🛠 Voice guard permission missing"),
            description: t(
              "Du brauchst die Berechtigung `Server verwalten`, um den Voice-Guard zu aendern.",
              "You need the `Manage Server` permission to manage the voice guard."
            ),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "policy") {
      const rawValue = interaction.options.getString("value", true);
      const validated = validateVoiceGuardSettings({ policy: rawValue });
      if (!validated.ok) {
        await interaction.reply({
          embeds: [
            buildOmniEmbed({
              tone: "warning",
              title: t("⚠ Voice-Guard-Policy ungültig", "⚠ Invalid voice guard policy"),
              description: t(validated.error, validated.error),
            }),
          ],
          components: [buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true })].filter(Boolean),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      const persisted = await updateGuildSettings(guildId, { voiceGuard: validated.config });
      if (!persisted.ok) {
        await interaction.editReply({
          embeds: [
            buildOmniEmbed({
              tone: "danger",
              title: t("✖ Voice Guard konnte nicht gespeichert werden", "✖ Could not save voice guard"),
              description: t(
                "Voice-Guard-Policy konnte nicht gespeichert werden. Bitte versuche es spaeter erneut oder nutze das Dashboard.",
                "The voice guard policy could not be saved. Please try again later or use the dashboard."
              ),
            }),
          ],
          components: [buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true })].filter(Boolean),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }

      await runtime.refreshVoiceGuardSettingsForGuild(guildId, { force: true }).catch(() => null);
      const resolved = buildResolvedVoiceGuardConfig(validated.config);
      await interaction.editReply({
        embeds: [
          buildOmniEmbed({
            tone: resolved.effectivePolicy === "disconnect" ? "warning" : "success",
            title: t("🛡 Voice Guard aktualisiert", "🛡 Voice guard updated"),
            description: t(
              `Gespeichert: **${formatVoiceGuardPolicyLabel(resolved.policy, t)}** | Aktiv: **${formatVoiceGuardPolicyLabel(resolved.effectivePolicy, t)}**`,
              `Saved: **${formatVoiceGuardPolicyLabel(resolved.policy, t)}** | Active: **${formatVoiceGuardPolicyLabel(resolved.effectivePolicy, t)}**`
            ),
          }),
        ],
        components: [buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true })].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "status") {
      await runtime.refreshVoiceGuardSettings(guildId).catch(() => null);
      const configured = runtime.getVoiceGuardRuntimeSummary(guildId);
      const resolvedRuntime = await runtime.resolveStreamingRuntimeForInteraction(interaction);
      const { runtime: activeRuntime, state: activeState } = resolvedRuntime;
      if (!activeRuntime && resolvedRuntime.reason && resolvedRuntime.reason !== "none") {
        await interaction.reply(buildStreamingRuntimeSelectionPayload(runtime, interaction, resolvedRuntime, language));
        return;
      }
      const liveSummary = activeRuntime && activeState
        ? activeRuntime.getVoiceGuardRuntimeSummary(guildId)
        : configured;
      const unlockLabel = liveSummary.unlockUntil
        ? new Date(Number(liveSummary.unlockUntil)).toLocaleString(language === "de" ? "de-DE" : "en-US")
        : "-";
      const cooldownLabel = liveSummary.cooldownUntil
        ? new Date(Number(liveSummary.cooldownUntil)).toLocaleString(language === "de" ? "de-DE" : "en-US")
        : "-";
      const quickRow = buildQuickActionRow(t, { includePlay: true, includeStations: true });
      const supportRow = buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true });
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: liveSummary.unlocked ? "warning" : liveSummary.effectivePolicy === "disconnect" ? "danger" : liveSummary.effectivePolicy === "return" ? "success" : "neutral",
            title: t("🛡 Voice Guard", "🛡 Voice guard"),
            fields: [
              {
                name: t("Policy", "Policy"),
                value: `${formatVoiceGuardPolicyLabel(liveSummary.policy, t)} -> ${formatVoiceGuardPolicyLabel(liveSummary.effectivePolicy, t)}`,
                inline: true,
              },
              {
                name: t("Unlock", "Unlock"),
                value: liveSummary.unlocked
                  ? t(`aktiv bis ${unlockLabel}`, `active until ${unlockLabel}`)
                  : t("nicht aktiv", "inactive"),
                inline: true,
              },
              {
                name: t("Cooldown", "Cooldown"),
                value: liveSummary.cooldownUntil ? cooldownLabel : "-",
                inline: true,
              },
              {
                name: t("Bewegungen", "Moves"),
                value: t(
                  `Gesamt: ${liveSummary.moveCount} | Fenster: ${liveSummary.moveWindowCount}/${liveSummary.maxMovesPerWindow}`,
                  `Total: ${liveSummary.moveCount} | Window: ${liveSummary.moveWindowCount}/${liveSummary.maxMovesPerWindow}`
                ),
                inline: false,
              },
              {
                name: t("Aktionen", "Actions"),
                value: t(
                  `Returns: ${liveSummary.returnCount} | Disconnects: ${liveSummary.disconnectCount} | Eskalationen: ${liveSummary.escalationCount}`,
                  `Returns: ${liveSummary.returnCount} | Disconnects: ${liveSummary.disconnectCount} | Escalations: ${liveSummary.escalationCount}`
                ),
                inline: false,
              },
              {
                name: t("Letzte Aktion", "Last action"),
                value: liveSummary.lastAction
                  ? `${liveSummary.lastAction}${liveSummary.lastActionReason ? ` | ${liveSummary.lastActionReason}` : ""}`
                  : "-",
                inline: false,
              },
              {
                name: t("Guard-Regeln", "Guard rules"),
                value: t(
                  `Confirm: ${liveSummary.moveConfirmations} | Return-Cooldown: ${formatVoiceGuardDurationMs(liveSummary.returnCooldownMs)} | Fenster: ${formatVoiceGuardDurationMs(liveSummary.moveWindowMs)} | Eskalation: ${liveSummary.escalation}`,
                  `Confirm: ${liveSummary.moveConfirmations} | Return cooldown: ${formatVoiceGuardDurationMs(liveSummary.returnCooldownMs)} | Window: ${formatVoiceGuardDurationMs(liveSummary.moveWindowMs)} | Escalation: ${liveSummary.escalation}`
                ),
                inline: false,
              },
            ],
            footer: activeRuntime
              ? t(`Live-Runtime: ${activeRuntime.config.name}`, `Live runtime: ${activeRuntime.config.name}`)
              : t("Keine aktive Stream-Runtime erkannt", "No active stream runtime detected"),
          }),
        ],
        components: [quickRow, supportRow].filter(Boolean),
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "unlock") {
      const resolved = await runtime.resolveStreamingRuntimeForInteraction(interaction);
      if (!resolved.runtime || !resolved.state) {
        if (resolved.reason && resolved.reason !== "none") {
          await interaction.reply(buildStreamingRuntimeSelectionPayload(runtime, interaction, resolved, language));
          return;
        }
        await interaction.reply({
          embeds: [
            buildOmniEmbed({
              tone: "info",
              title: t("ℹ Voice Guard wartet auf einen aktiven Stream", "ℹ Voice guard needs an active stream"),
              description: runtime.buildRuntimeSelectionHint(resolved.reason, language),
            }),
          ],
          components: [
            buildQuickActionRow(t, { includePlay: true, includeStations: true }),
            buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true }),
          ].filter(Boolean),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      const minutes = Math.max(1, Math.min(180, Number(interaction.options.getInteger("minutes") || 10) || 10));
      const result = await resolved.runtime.setVoiceGuardTemporaryUnlock(guildId, minutes * 60_000, "slash-unlock");
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "warning",
            title: t("🔓 Voice Guard entsperrt", "🔓 Voice guard unlocked"),
            description: t(
              `Voice Guard ist jetzt für ${result.label} entsperrt. Du kannst den Bot in dieser Zeit bewusst verschieben.`,
              `Voice guard is unlocked for ${result.label}. You can intentionally move the bot during that time.`
            ),
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }

    if (sub === "lock") {
      const resolved = await runtime.resolveStreamingRuntimeForInteraction(interaction);
      if (!resolved.runtime || !resolved.state) {
        await runtime.clearVoiceGuardTemporaryUnlockForGuild(guildId, "slash-lock");
        if (resolved.reason && resolved.reason !== "none") {
          await interaction.reply(buildStreamingRuntimeSelectionPayload(runtime, interaction, resolved, language));
          return;
        }
        await interaction.reply({
          embeds: [
            buildOmniEmbed({
              tone: "info",
              title: t("🛡 Voice Guard zurückgesetzt", "🛡 Voice guard reset"),
              description: t(
                "Keine aktive Stream-Runtime gefunden. Temporaere Unlocks wurden fuer diesen Server zurueckgesetzt, falls vorhanden.",
                "No active stream runtime found. Temporary unlocks were reset for this server where present."
              ),
            }),
          ],
          components: [buildSupportRow(language, { includeDashboard: true, includePremium: false, includeSupport: true })].filter(Boolean),
          flags: MessageFlags.Ephemeral,
        });
        return;
      }
      await resolved.runtime.clearVoiceGuardTemporaryUnlockForGuild(guildId, "slash-lock");
      await interaction.reply({
        embeds: [
          buildOmniEmbed({
            tone: "success",
            title: t("🔒 Voice Guard aktiv", "🔒 Voice guard active"),
            description: t(
              "Voice Guard ist wieder sofort aktiv.",
              "Voice guard is active again immediately."
            ),
          }),
        ],
        flags: MessageFlags.Ephemeral,
      });
      return;
    }
  }

  if (interaction.commandName === "play") {
    await executeRuntimePlay(runtime, interaction, {
      station: interaction.options.getString("station"),
      requestedVoiceChannel: interaction.options.getChannel("voice"),
      requestedBotIndex: interaction.options.getInteger("bot"),
      requestedWorkerSelectionMode: "botIndex",
      openWizardWhenIncomplete: true,
    });
    return;
  }
}
