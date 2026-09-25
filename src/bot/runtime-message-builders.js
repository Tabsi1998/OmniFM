import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
} from "discord.js";

import { clipText } from "../lib/helpers.js";
import { getTier, getServerPlanConfig } from "../core/entitlements.js";
import { PLANS, BRAND } from "../config/plans.js";
import {
  DASHBOARD_URL,
  WEBSITE_URL,
  SUPPORT_URL,
  INVITE_COMPONENT_ID_OPEN,
  WORKERS_COMPONENT_ID_PAGE_PREFIX,
  WORKERS_COMPONENT_ID_REFRESH,
  withLanguageParam,
} from "./runtime-links.js";
import { brandAuthor, brandFooter } from "./brand-embed.js";
import { buildHelpPayload } from "./help-panel.js";

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

// /help (#269): one panel with a topic menu; see help-panel.js.
export function buildRuntimeHelpMessage(runtime, interaction, section = "overview") {
  const language = runtime.resolveInteractionLanguage(interaction);
  const t = (de, en) => (language === "de" ? de : en);
  const guildId = interaction?.guildId;
  const tierConfig = guildId ? getTierConfig(guildId) : PLANS.free;
  return buildHelpPayload({
    t,
    section,
    plan: { name: tierConfig.name, bitrate: tierConfig.bitrate, maxBots: tierConfig.maxBots },
    guildName: clipText(interaction?.guild?.name || "", 60),
    urls: {
      dashboard: withLanguageParam(DASHBOARD_URL, language),
      website: withLanguageParam(WEBSITE_URL, language),
      support: SUPPORT_URL,
      premium: withLanguageParam(BRAND.upgradeUrl || WEBSITE_URL, language),
    },
    applicationId: interaction?.applicationId || runtime.client?.application?.id || null,
  });
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
