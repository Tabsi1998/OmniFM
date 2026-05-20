import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
} from "discord.js";

import { clipText } from "../lib/helpers.js";
import { getTier, getServerPlanConfig } from "../core/entitlements.js";
import { PLANS, BRAND } from "../config/plans.js";
import { normalizeLanguage, getDefaultLanguage } from "../i18n.js";
import { buildSetupStatusSummary } from "../lib/user-facing-setup.js";
import {
  DASHBOARD_URL,
  WEBSITE_URL,
  SUPPORT_URL,
  INVITE_COMPONENT_ID_OPEN,
  PLAY_COMPONENT_ID_OPEN,
  STATIONS_COMPONENT_ID_OPEN,
  WORKERS_COMPONENT_ID_OPEN,
  WORKERS_COMPONENT_ID_PAGE_PREFIX,
  WORKERS_COMPONENT_ID_REFRESH,
  withLanguageParam,
} from "./runtime-links.js";
import { buildOmniEmbed, buildLinkRow } from "./discord-ui.js";

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

function countVoiceChannels(guild) {
  const cache = guild?.channels?.cache;
  if (!cache?.filter) return 0;
  return cache.filter((channel) =>
    channel
    && channel.isVoiceBased?.() === true
    && (channel.type === ChannelType.GuildVoice || channel.type === ChannelType.GuildStageVoice)
  ).size || 0;
}

export function buildRuntimeSetupMessagePayload(
  runtime,
  { guild = null, language = null, guildId = null } = {}
) {
  const resolvedGuildId = String(guildId || guild?.id || "").trim();
  const resolvedLanguage = normalizeLanguage(
    language || (resolvedGuildId ? runtime.resolveGuildLanguage(resolvedGuildId) : getDefaultLanguage()),
    getDefaultLanguage()
  );
  const guildName = guild?.name || (resolvedGuildId ? `Server ${resolvedGuildId}` : null);
  const isDe = resolvedLanguage === "de";
  const dashboardUrl = withLanguageParam(DASHBOARD_URL, resolvedLanguage);
  const websiteUrl = withLanguageParam(WEBSITE_URL, resolvedLanguage);
  const guildTier = resolvedGuildId ? getTier(resolvedGuildId) : "free";
  const maxWorkerSlots = runtime.workerManager?.getMaxWorkerIndex?.(guildTier) || getTierConfig(resolvedGuildId).maxBots || 0;
  const invitedWorkerCount = resolvedGuildId && runtime.workerManager?.getInvitedWorkers
    ? runtime.workerManager.getInvitedWorkers(resolvedGuildId, guildTier).length
    : 0;
  const voiceChannelCount = countVoiceChannels(guild);
  const setupSummary = buildSetupStatusSummary({
    commanderReady: Boolean(guild || resolvedGuildId),
    invitedWorkerCount,
    maxWorkerSlots,
    voiceChannelCount,
    t: (de, en) => (isDe ? de : en),
  });

  const embed = buildOmniEmbed({
    tone: "admin",
    title: isDe ? `🚀 ${BRAND.name}: Erste Schritte` : `🚀 ${BRAND.name}: First steps`,
    description: isDe
      ? `Danke für den Invite auf **${guildName || "deinen Server"}**.\n${setupSummary.nextTitle}: ${setupSummary.nextBody}`
      : `Thanks for inviting me to **${guildName || "your server"}**.\n${setupSummary.nextTitle}: ${setupSummary.nextBody}`,
    fields: [
      {
        name: isDe ? "Aktueller Status" : "Current status",
        value: setupSummary.checklist.join("\n"),
      },
      {
        name: isDe ? "Nächster Schritt" : "Next step",
        value: isDe
          ? `Starte mit **${setupSummary.command}**.\n${setupSummary.nextBody}`
          : `Start with **${setupSummary.command}**.\n${setupSummary.nextBody}`,
      },
      {
        name: isDe ? "Vor dem ersten /play" : "Before the first /play",
        value: isDe
          ? "Der Ziel-Channel braucht für OmniFM mindestens `Connect` und außerhalb von Stage zusätzlich `Speak`."
          : "The target channel needs at least `Connect` for OmniFM and also `Speak` outside of stage channels.",
      },
      {
        name: isDe ? "Wichtige Commands" : "Important commands",
        value: isDe
          ? "`/play` öffnet jetzt einen geführten Schnellstart, `/stations` zeigt den Browser, `/workers` und `/invite` regeln deine Worker."
          : "`/play` now opens a guided quick-start, `/stations` opens the browser, and `/workers` plus `/invite` handle your workers.",
      },
    ],
    footer: isDe ? "Geführter Start, moderne Panels und schnelle Aktionen direkt in Discord." : "Guided setup, modern panels, and quick actions directly in Discord.",
  });

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(PLAY_COMPONENT_ID_OPEN)
      .setStyle(ButtonStyle.Primary)
      .setLabel(isDe ? "Schnellstart" : "Quick start"),
    new ButtonBuilder()
      .setCustomId(STATIONS_COMPONENT_ID_OPEN)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(isDe ? "Sender" : "Stations"),
    new ButtonBuilder()
      .setCustomId(WORKERS_COMPONENT_ID_OPEN)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(isDe ? "Worker-Status" : "Worker status"),
    new ButtonBuilder()
      .setCustomId(INVITE_COMPONENT_ID_OPEN)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(isDe ? "Worker einladen" : "Invite worker")
  );

  const linkRow = buildLinkRow([
    { label: "📊 Dashboard", url: dashboardUrl },
    { label: "🌐 Website", url: websiteUrl },
    { label: "🛟 Support", url: SUPPORT_URL },
  ]);

  return { embeds: [embed], components: linkRow ? [actionRow, linkRow] : [actionRow] };
}

export function buildRuntimeHelpMessage(runtime, interaction) {
  const language = runtime.resolveInteractionLanguage(interaction);
  const isDe = language === "de";
  const dashboardUrl = withLanguageParam(DASHBOARD_URL, language);
  const websiteUrl = withLanguageParam(WEBSITE_URL, language);
  const guildId = interaction?.guildId;
  const tierConfig = guildId ? getTierConfig(guildId) : PLANS.free;

  const headerEmbed = buildOmniEmbed({
    tone: "info",
    title: isDe ? `🧭 ${BRAND.name} Hilfe` : `🧭 ${BRAND.name} Help`,
    description: isDe
      ? `Server: **${interaction.guild?.name || guildId || "-"}**\nPlan: **${tierConfig.name}** | Audio: **${tierConfig.bitrate}** | Worker-Slots: **${tierConfig.maxBots}**`
      : `Server: **${interaction.guild?.name || guildId || "-"}**\nPlan: **${tierConfig.name}** | Audio: **${tierConfig.bitrate}** | Worker slots: **${tierConfig.maxBots}**`,
    fields: [
      {
        name: isDe ? "Schnellstart" : "Quick start",
        value: isDe
          ? "1. `/play` öffnet den geführten Schnellstart.\n2. `/stations` zeigt einen Browser mit Auswahl.\n3. `/workers` und `/invite` regeln deine Worker.\n4. `/setup` erklärt den Server-Start Schritt für Schritt."
          : "1. `/play` opens the guided quick start.\n2. `/stations` opens a browser with selection controls.\n3. `/workers` and `/invite` manage your workers.\n4. `/setup` explains the server start step by step.",
        inline: false,
      },
      {
        name: isDe ? "Sprache" : "Language",
        value: isDe
          ? "OmniFM erkennt Server- und Discord-Sprache automatisch. Mit `/language set value:de|en` kannst du sie fest setzen."
          : "OmniFM auto-detects the server/Discord language. Use `/language set value:de|en` to force it.",
        inline: false,
      },
      {
        name: isDe ? "Dashboard" : "Dashboard",
        value: isDe
          ? "Web-Dashboard mit SSO: Statistiken, Events, Abo und Server-Einstellungen."
          : "Web dashboard with SSO: stats, events, subscription, and server settings.",
        inline: false,
      },
    ],
  });

  const playbackEmbed = buildOmniEmbed({
    tone: "live",
    title: isDe ? "🎧 Wiedergabe & Live" : "🎧 Playback & Live",
    fields: [
      {
        name: "/play /pause /resume /stop",
        value: isDe
          ? "Startet, pausiert oder beendet Streams im Voice- oder Stage-Channel. `/play` führt jetzt per Buttons und Menüs."
          : "Start, pause, or stop streams in voice or stage channels. `/play` now guides you with buttons and menus.",
        inline: false,
      },
      {
        name: "/stations /list /now /history /stats",
        value: isDe
          ? "Zeigt verfügbare Sender, aktuelle Songs, History und Server-Statistiken. `/stations` ist jetzt ein Browser statt Textwand."
          : "Shows available stations, current songs, history, and server statistics. `/stations` is now a browser instead of a text wall.",
        inline: false,
      },
      {
        name: "/setvolume /status /health /diag",
        value: isDe
          ? "Audio, Worker-Zustand und technische Checks für Admins."
          : "Audio, worker status, and technical checks for admins.",
        inline: false,
      },
    ],
  });

  const automationEmbed = buildOmniEmbed({
    tone: "info",
    title: isDe ? "🗓 Events & Automationen" : "🗓 Events & Automation",
    fields: [
      {
        name: "/event create|edit|list|delete",
        value: isDe
          ? "Flexible Event-Planung mit Voice-/Stage-Channel, Wiederholung, Server-Event und Ankündigung."
          : "Flexible event scheduling with voice/stage channel, recurrence, server event, and announcement.",
        inline: false,
      },
      {
        name: isDe ? "Datumsformate" : "Date formats",
        value: isDe
          ? "`DD.MM.YYYY HH:MM`, `YYYY-MM-DD HH:MM`, `20:00`, `heute`, `morgen` oder getrennt über `startdate` + `starttime`."
          : "`DD.MM.YYYY HH:MM`, `YYYY-MM-DD HH:MM`, `20:00`, `today`, `tomorrow`, or split across `startdate` + `starttime`.",
        inline: false,
      },
      {
        name: isDe ? "Wichtig" : "Important",
        value: isDe
          ? "Ohne `serverevent` darf ein Event sofort starten. Mit `serverevent` muss der Start mindestens 60 Sekunden in der Zukunft liegen."
          : "Without `serverevent`, an event may start immediately. With `serverevent`, start time must be at least 60 seconds in the future.",
        inline: false,
      },
    ],
  });

  const adminEmbed = buildOmniEmbed({
    tone: tierConfig.tier === "ultimate" ? "admin" : "info",
    title: "🛠 Admin & Premium",
    fields: [
      {
        name: "/setup /invite /workers /perm",
        value: isDe
          ? "Geführten Start öffnen, Worker-Setup prüfen, Worker einladen und Rollenrechte für Commands regeln."
          : "Open the guided start, inspect worker setup, invite workers, and manage role permissions for commands.",
        inline: false,
      },
      {
        name: "/premium /license",
        value: isDe
          ? "Lizenzstatus, Upgrades und Seat-Verwaltung für deinen Server."
          : "License status, upgrades, and seat management for your server.",
        inline: false,
      },
      {
        name: "/addstation /removestation /mystations",
        value: isDe
          ? "Ultimate-only für eigene Sender und private Streams."
          : "Ultimate-only for custom stations and private streams.",
        inline: false,
      },
    ],
    footer: isDe
      ? "Commander nimmt Befehle entgegen, Worker halten die Voice-/Stage-Streams."
      : "The commander handles commands, workers keep the voice/stage streams running.",
  });

  const actionRow = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(PLAY_COMPONENT_ID_OPEN)
      .setStyle(ButtonStyle.Primary)
      .setLabel(isDe ? "Schnellstart" : "Quick start"),
    new ButtonBuilder()
      .setCustomId(STATIONS_COMPONENT_ID_OPEN)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(isDe ? "Sender" : "Stations"),
    new ButtonBuilder()
      .setCustomId(WORKERS_COMPONENT_ID_OPEN)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(isDe ? "Worker" : "Workers")
  );

  const linkRow = buildLinkRow([
    { label: "📊 Dashboard", url: dashboardUrl },
    { label: "🌐 Website", url: websiteUrl },
    { label: "🛟 Support", url: SUPPORT_URL },
    { label: "💎 Premium", url: BRAND.upgradeUrl || WEBSITE_URL },
  ]);

  return {
    embeds: [headerEmbed, playbackEmbed, automationEmbed, adminEmbed],
    components: linkRow ? [actionRow, linkRow] : [actionRow],
  };
}

export async function buildRuntimeWorkersStatusPayload(runtime, interaction, { hint = "", page = 0 } = {}) {
  const { t, language } = runtime.createInteractionTranslator(interaction);
  const guildId = String(interaction?.guildId || "").trim();
  if (!guildId) {
    return {
      content: t(
        "Dieser Befehl funktioniert nur auf einem Discord-Server (nicht in DMs).",
        "This command only works inside a Discord server (not in DMs)."
      ),
      embeds: [],
      components: [],
    };
  }

  const guildTier = getTier(guildId);
  const maxIndex = runtime.workerManager.getMaxWorkerIndex(guildTier);
  const statuses = runtime.workerManager.getAllStatuses();
  const onlineCount = statuses.filter((ws) => ws?.online).length;
  const activeTotal = statuses.reduce((sum, ws) => sum + (Number(ws?.activeStreams || 0) || 0), 0);
  const lines = [];

  for (const ws of statuses) {
    const runtimeWorker = runtime.workerManager.getWorkerByIndex(ws.index, { prefer: "slot" });
    const inGuild = ws.online && runtimeWorker?.client?.guilds?.cache?.has(guildId);
    const streaming = Array.isArray(ws.streams)
      ? ws.streams.find((stream) => stream.guildId === guildId)
      : null;
    const tierLocked = ws.index > maxIndex;

    let statusEmoji = "";
    let statusText = "";
    if (tierLocked) {
      statusEmoji = "🔒";
      statusText = t("(Upgrade erforderlich)", "(Upgrade required)");
    } else if (!ws.online) {
      statusEmoji = "🔴";
      statusText = t("Offline", "Offline");
    } else if (!inGuild) {
      statusEmoji = "📨";
      statusText = t("Nicht eingeladen", "Not invited");
    } else if (streaming) {
      statusEmoji = "🟢";
      statusText = t("Aktiv auf diesem Server", "Active on this server");
    } else {
      statusEmoji = "🟡";
      statusText = t("Bereit", "Ready");
    }

    const botIndexText = ws.botIndex ? `, BOT_${ws.botIndex}` : "";
    lines.push(
      `${statusEmoji} **${ws.name}** - ${statusText} (${ws.totalGuilds} ${t("Server", "servers")}, ${ws.activeStreams} ${t("aktiv", "active")}, ${t("Slot", "Slot")} ${ws.index}${botIndexText})`
    );
  }

  const pagedLines = [];
  let currentPageLines = [];
  let currentLength = 0;
  const maxFieldLength = 1024;
  for (const rawLine of lines) {
    const line = clipText(String(rawLine || "-"), 320);
    const nextLength = currentPageLines.length > 0
      ? currentLength + 1 + line.length
      : line.length;
    if (nextLength > maxFieldLength && currentPageLines.length > 0) {
      pagedLines.push(currentPageLines.join("\n"));
      currentPageLines = [line];
      currentLength = line.length;
    } else {
      currentPageLines.push(line);
      currentLength = nextLength;
    }
  }
  if (currentPageLines.length > 0) {
    pagedLines.push(currentPageLines.join("\n"));
  }
  if (pagedLines.length === 0) {
    pagedLines.push("-");
  }

  const totalPages = Math.max(1, pagedLines.length);
  const resolvedPage = Math.max(0, Math.min(totalPages - 1, Number.parseInt(String(page || 0), 10) || 0));
  const summaryValue = pagedLines[resolvedPage] || "-";

  const summaryEmbed = new EmbedBuilder()
    .setColor(BRAND.color)
    .setTitle(t("Worker-Status", "Worker status"))
    .setDescription(
      t(
        `Plan: **${runtime.formatTierLabel(guildTier, language)}** | Freigeschaltet: **1-${maxIndex}**\nOnline: **${onlineCount}/${statuses.length}** | Aktiv: **${activeTotal}**`,
        `Plan: **${runtime.formatTierLabel(guildTier, language)}** | Unlocked: **1-${maxIndex}**\nOnline: **${onlineCount}/${statuses.length}** | Active: **${activeTotal}**`
      )
    )
    .addFields({
      name: t("Übersicht", "Overview"),
      value: summaryValue,
      inline: false,
    });

  if (hint) {
    summaryEmbed.addFields({
      name: t("Hinweis", "Note"),
      value: clipText(String(hint), 900),
      inline: false,
    });
  }
  summaryEmbed.setFooter({
    text: t(
      `Seite ${resolvedPage + 1}/${totalPages} | 🟢 Spielt | 🟡 Bereit | 🔴 Offline | 📨 Nicht eingeladen | 🔒 Upgrade`,
      `Page ${resolvedPage + 1}/${totalPages} | 🟢 Playing | 🟡 Ready | 🔴 Offline | 📨 Not invited | 🔒 Upgrade`
    ),
  });

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(INVITE_COMPONENT_ID_OPEN)
      .setStyle(ButtonStyle.Primary)
      .setLabel(t("Worker einladen", "Invite worker")),
    new ButtonBuilder()
      .setCustomId(`${WORKERS_COMPONENT_ID_PAGE_PREFIX}${resolvedPage - 1}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t("Zurück", "Back"))
      .setDisabled(resolvedPage <= 0),
    new ButtonBuilder()
      .setCustomId(`${WORKERS_COMPONENT_ID_PAGE_PREFIX}${resolvedPage + 1}`)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t("Weiter", "Next"))
      .setDisabled(resolvedPage >= (totalPages - 1)),
    new ButtonBuilder()
      .setCustomId(WORKERS_COMPONENT_ID_REFRESH)
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t("Aktualisieren", "Refresh"))
  );

  return {
    embeds: [summaryEmbed],
    components: [row],
  };
}
