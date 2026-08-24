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
import { brandAuthor, brandFooter, brandIconUrl, OMNI_RULE } from "./brand-embed.js";

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
    author: isDe ? "OmniFM · Hilfe-Center" : "OmniFM · Help Center",
    description: [
      isDe ? "## 📡 Willkommen bei OmniFM" : "## 📡 Welcome to OmniFM",
      isDe
        ? "-# Dein 24/7-Radio für Discord — der Commander nimmt Befehle entgegen, Worker halten die Streams."
        : "-# Your 24/7 radio for Discord — the commander takes commands, workers keep the streams alive.",
      OMNI_RULE,
    ].join("\n"),
    fields: [
      {
        name: isDe ? "🖥️ Server" : "🖥️ Server",
        value: clipText(interaction.guild?.name || guildId || "—", 60),
        inline: true,
      },
      { name: "💠 Plan", value: `**${tierConfig.name}**`, inline: true },
      { name: "🎚️ Audio", value: String(tierConfig.bitrate || "—"), inline: true },
      { name: "🤖 Worker-Slots", value: String(tierConfig.maxBots || 0), inline: true },
      {
        name: isDe ? "🌍 Sprache" : "🌍 Language",
        value: "`/language set value:de|en`",
        inline: true,
      },
      {
        name: "📊 Dashboard",
        value: isDe ? "Web-Dashboard mit SSO" : "Web dashboard with SSO",
        inline: true,
      },
      {
        name: isDe ? "🚀 Schnellstart" : "🚀 Quick start",
        value: isDe
          ? "> **1.** `/play` — geführter Schnellstart mit Buttons\n> **2.** `/stations` — Sender-Browser öffnen\n> **3.** `/invite` — Worker auf den Server holen\n> **4.** `/setup` — Server-Start Schritt für Schritt"
          : "> **1.** `/play` — guided quick start with buttons\n> **2.** `/stations` — open the station browser\n> **3.** `/invite` — bring workers to your server\n> **4.** `/setup` — server start step by step",
        inline: false,
      },
    ],
    thumbnail: brandIconUrl(),
    withFooter: false,
    timestamp: false,
  });

  const playbackEmbed = buildOmniEmbed({
    tone: "live",
    withAuthor: false,
    withFooter: false,
    timestamp: false,
    description: [
      isDe ? "### 🎧 Wiedergabe & Live" : "### 🎧 Playback & Live",
      "`/play` `/pause` `/resume` `/stop`",
      isDe
        ? "-# Streams im Voice- oder Stage-Channel starten, pausieren und beenden — komplett per Buttons & Menüs."
        : "-# Start, pause, and stop streams in voice or stage channels — fully via buttons & menus.",
      "",
      "`/stations` `/list` `/now` `/history` `/stats`",
      isDe
        ? "-# Sender-Browser, aktueller Song, Song-History und Server-Statistiken."
        : "-# Station browser, current song, song history, and server statistics.",
      "",
      "`/setvolume` `/status` `/health` `/diag`",
      isDe
        ? "-# Lautstärke, Worker-Zustand und Technik-Checks für Admins."
        : "-# Volume, worker health, and technical checks for admins.",
    ].join("\n"),
  });

  const automationEmbed = buildOmniEmbed({
    tone: "info",
    withAuthor: false,
    withFooter: false,
    timestamp: false,
    description: [
      isDe ? "### 🗓️ Events & Automationen" : "### 🗓️ Events & Automation",
      "`/event create` `/event edit` `/event list` `/event delete`",
      isDe
        ? "-# Radio-Events mit Voice-/Stage-Channel, Wiederholung, Server-Event und Ankündigung."
        : "-# Radio events with voice/stage channel, recurrence, server event, and announcement.",
      "",
      isDe
        ? "**Datumsformate:** `DD.MM.YYYY HH:MM` · `YYYY-MM-DD HH:MM` · `20:00` · `heute` · `morgen`"
        : "**Date formats:** `DD.MM.YYYY HH:MM` · `YYYY-MM-DD HH:MM` · `20:00` · `today` · `tomorrow`",
      isDe
        ? "-# Mit `serverevent` muss der Start mindestens 60 Sekunden in der Zukunft liegen."
        : "-# With `serverevent`, the start must be at least 60 seconds in the future.",
    ].join("\n"),
  });

  const adminEmbed = buildOmniEmbed({
    tone: "admin",
    withAuthor: false,
    description: [
      isDe ? "### 🛠️ Admin & Premium" : "### 🛠️ Admin & Premium",
      "`/setup` `/invite` `/workers` `/perm`",
      isDe
        ? "-# Geführter Start, Worker-Setup, Einladungen und Rollenrechte für Commands."
        : "-# Guided start, worker setup, invites, and role permissions for commands.",
      "",
      "`/premium` `/license`",
      isDe
        ? "-# Lizenzstatus, Upgrades und Seat-Verwaltung für deinen Server."
        : "-# License status, upgrades, and seat management for your server.",
      "",
      "`/addstation` `/removestation` `/mystations`",
      isDe
        ? "-# Eigene Sender & private Streams (Ultimate)."
        : "-# Custom stations & private streams (Ultimate).",
    ].join("\n"),
    footer: isDe
      ? "Commander steuert · Worker streamen"
      : "Commander controls · workers stream",
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
    .setAuthor(brandAuthor())
    .setTimestamp(new Date())
    .setTitle(t("🤖 Worker-Status", "🤖 Worker status"))
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
  summaryEmbed.setFooter(brandFooter(t(
    `Seite ${resolvedPage + 1}/${totalPages} · 🟢 Spielt · 🟡 Bereit · 🔴 Offline · 📨 Nicht eingeladen · 🔒 Upgrade`,
    `Page ${resolvedPage + 1}/${totalPages} · 🟢 Playing · 🟡 Ready · 🔴 Offline · 📨 Not invited · 🔒 Upgrade`
  )));

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
