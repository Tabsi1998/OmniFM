// Information and setup commands: /help, /setup, /language, /stats, /invite,
// /stations, /list, /now, /history, /premium, /health.
// Moved out of runtime-interactions.js unchanged (#210); runtime-interactions.js
// dispatches to the map at the end of this file.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { TIER_RANK, SONG_HISTORY_ENABLED, clipText } from "../../lib/helpers.js";
import { getTier } from "../../core/entitlements.js";
import { getSongHistory } from "../../song-history-store.js";
import { recordCommandUsage } from "../../listening-stats-store.js";
import { buildInviteUrl } from "../../bot-config.js";
import { BRAND } from "../../config/plans.js";
import { INVITE_COMPONENT_ID_OPEN } from "../runtime-links.js";
import { openRuntimeStationsBrowser } from "../runtime-panels.js";
import { buildOmniEmbed } from "../discord-ui.js";
import { derivePlaybackPhase } from "../playback-phase.js";
import {
  getTierConfig,
  buildQuickActionRow,
  buildSupportRow,
  buildNoticePayload,
  buildStreamingRuntimeSelectionPayload,
  getLicense,
} from "./command-helpers.js";

/** /help */
async function handleHelpCommand({ runtime, interaction }) {
  recordCommandUsage(interaction.guildId, interaction.commandName);
  const payload = runtime.buildHelpMessage(interaction);
  await runtime.respondInteraction(interaction, { ...payload, flags: MessageFlags.Ephemeral });
  return;
}

/** /setup */
async function handleSetupCommand({ runtime, interaction }) {
  recordCommandUsage(interaction.guildId, interaction.commandName);
  const payload = runtime.buildSetupMessage(interaction);
  await runtime.respondInteraction(interaction, { ...payload, flags: MessageFlags.Ephemeral });
  return;
}

/** /language */
async function handleLanguageCommand({ runtime, interaction }) {
  recordCommandUsage(interaction.guildId, interaction.commandName);
  await runtime.handleLanguageCommand(interaction);
  return;
}

/** /stats */
async function handleStatsCommand({ runtime, interaction, t, language }) {
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
/** /invite */
async function handleInviteCommand({ runtime, interaction, t, language }) {
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

/** /stations */
async function handleStationsCommand({ runtime, interaction }) {
  const payload = await openRuntimeStationsBrowser(runtime, interaction);
  await runtime.respondInteraction(interaction, payload);
  return;
}

/** /list */
async function handleListCommand({ runtime, interaction }) {
  const page = Math.max(0, (interaction.options.getInteger("page") || 1) - 1);
  const payload = await openRuntimeStationsBrowser(runtime, interaction, { page });
  await runtime.respondInteraction(interaction, payload);
  return;
}

/** /now */
async function handleNowCommand({ runtime, interaction, t, language }) {
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
  // The same panel as in the channel (#266), privately for the person asking.
  const playerStatus = activeState.player?.state?.status;
  const panel = runtime.buildNowPlayingPanelPayload(interaction.guildId, current.station, {
    ...meta,
    name: meta.name || current.station.name || null,
  }, {
    stationKey: activeState.currentStationKey,
    phase: derivePlaybackPhase(activeState),
    paused: playerStatus === "paused" || playerStatus === "autopaused",
    channelId,
    listenerCount: activeRuntime.getCurrentListenerCount(interaction.guildId, activeState),
    volume: activeState.volume,
    workerName: activeRuntime.config?.name || BRAND.name,
    serverMuted: activeState.serverMuted === true,
    failover: activeState.failoverActive === true
      ? { active: true, desiredName: activeState.desiredStationName || activeState.desiredStationKey || "" }
      : null,
  });
  await interaction.reply({ ...panel, flags: panel.flags | MessageFlags.Ephemeral });
  return;
}

/** /history */
async function handleHistoryCommand({ runtime, interaction, t, language }) {
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

/** /premium */
async function handlePremiumCommand({ runtime, interaction, t, language }) {
  const gid = interaction.guildId;
  const tierConfig = getTierConfig(gid);
  const license = getLicense(gid);

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

/** /health */
async function handleHealthCommand({ runtime, interaction, t, language }) {
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

export const INFO_COMMANDS = {
  help: handleHelpCommand,
  setup: handleSetupCommand,
  language: handleLanguageCommand,
  stats: handleStatsCommand,
  invite: handleInviteCommand,
  stations: handleStationsCommand,
  list: handleListCommand,
  now: handleNowCommand,
  history: handleHistoryCommand,
  premium: handlePremiumCommand,
  health: handleHealthCommand,
};
