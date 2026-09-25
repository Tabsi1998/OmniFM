// Helpers shared by the slash command handlers (#210).
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} from "discord.js";
import { clipText } from "../../lib/helpers.js";
import { getServerPlanConfig } from "../../core/entitlements.js";
import { getServerLicense } from "../../premium-store.js";
import { BRAND } from "../../config/plans.js";
import {
  DASHBOARD_URL,
  WEBSITE_URL,
  SUPPORT_URL,
  INVITE_COMPONENT_ID_OPEN,
  PLAY_COMPONENT_ID_OPEN,
  STATIONS_COMPONENT_ID_OPEN,
  WORKERS_COMPONENT_ID_OPEN,
  withLanguageParam,
} from "../runtime-links.js";
import { buildOmniEmbed } from "../discord-ui.js";
import * as ui from "../../discord/ui/index.js";
import { NOTICE_CATALOG } from "../../discord/ui/notice-catalog.js";

export async function deferRuntimeReply(interaction) {
  if (interaction?.deferred || interaction?.replied || typeof interaction?.deferReply !== "function") return;
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
}

export function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

export function buildQuickActionRow(t, {
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

export function buildSupportRow(language, {
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

const TONE_KINDS = { info: "info", success: "success", warning: "warning", danger: "error", error: "error", premium: "premium", neutral: "info" };

/** The button that fixes a catalogued problem (#270). */
export function buildNoticeFixRow(fix, t, language) {
  const button = new ButtonBuilder();
  if (fix === "quickstart") {
    button.setCustomId(PLAY_COMPONENT_ID_OPEN).setStyle(ButtonStyle.Primary).setLabel(t("Schnellstart öffnen", "Open quick start"));
  } else if (fix === "stations") {
    button.setCustomId(STATIONS_COMPONENT_ID_OPEN).setStyle(ButtonStyle.Primary).setLabel(t("Anderen Sender wählen", "Pick another station"));
  } else if (fix === "premium") {
    button.setStyle(ButtonStyle.Link).setURL(withLanguageParam(BRAND.upgradeUrl || WEBSITE_URL, language)).setLabel(t("Premium ansehen", "See Premium"));
  } else if (fix === "permissions") {
    button.setStyle(ButtonStyle.Link).setURL(withLanguageParam(`${String(WEBSITE_URL).replace(/\/+$/, "")}/faq`, language))
      .setLabel(t("So gibst du die Rechte", "How to grant them"));
  } else {
    return null;
  }
  return new ActionRowBuilder().addComponents(button);
}

/**
 * A notice in the design system (#264, #270): a container in the colour of
 * its tone, private. With `code` the text and the fix button come from the
 * notice catalog; `title`/`description` still work for one-off texts.
 */
export function buildNoticePayload({
  t,
  language,
  tone = "info",
  title,
  description,
  code = null,
  params = {},
  fields = [],
  quickActions = null,
  supportActions = null,
  extraComponents = [],
} = {}) {
  const entry = code ? NOTICE_CATALOG[code] : null;
  const kind = entry?.kind || TONE_KINDS[tone] || "info";
  const style = ui.NOTICE_KINDS[kind] || ui.NOTICE_KINDS.info;
  const translate = typeof t === "function" ? t : (de) => de;
  const heading = entry ? `${ui.icon(style.icon)} ${translate(...entry.title)}` : String(title || "");
  const bodyText = entry ? translate(...entry.body(params)) : String(description || "");

  const rows = [];
  if (entry?.fix) {
    const fixRow = buildNoticeFixRow(entry.fix, translate, language);
    if (fixRow) rows.push(fixRow);
  }
  if (quickActions) {
    const quickRow = buildQuickActionRow(translate, quickActions);
    if (quickRow) rows.push(quickRow);
  }
  if (supportActions) {
    const supportRow = buildSupportRow(language, supportActions);
    if (supportRow) rows.push(supportRow);
  }
  for (const row of Array.isArray(extraComponents) ? extraComponents : []) {
    if (row) rows.push(row);
  }

  const body = [];
  if (bodyText) body.push(ui.text(clipText(bodyText, 3000)));
  const fieldText = (Array.isArray(fields) ? fields : [])
    .filter((field) => field && (field.name || field.value))
    .map((field) => ui.field(field.name, clipText(String(field.value ?? ""), 1000)))
    .join("\n\n");
  if (fieldText) body.push(ui.text(fieldText));

  return ui.reply(ui.panel({
    accent: tone === "neutral" && !entry ? ui.UI_COLORS.neutral : style.color,
    title: heading,
    body,
    actions: rows.slice(0, 5),
  }));
}

export function formatWorkerList(workers = []) {
  return workers
    .map((worker) => clipText(worker?.config?.name || "Worker", 80))
    .filter(Boolean)
    .join(", ");
}

export function buildStreamingRuntimeSelectionPayload(runtime, interaction, playback, language) {
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

export function getLicense(guildId) {
  return getServerLicense(guildId);
}

export function formatVoiceGuardPolicyLabel(policy, t) {
  const normalized = String(policy || "default").trim().toLowerCase();
  if (normalized === "allow") return t("Erlauben", "Allow");
  if (normalized === "disconnect") return t("Disconnect", "Disconnect");
  if (normalized === "return") return t("Zurueckspringen", "Return");
  return t("Standard", "Default");
}
