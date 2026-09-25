// ============================================================
// OmniFM: welcome after the invite and the three-step setup (#271)
// ============================================================
// After the invite the server gets one welcome message (system channel or a
// bot/admin channel, never a community channel). Its button, or /setup,
// opens a private setup: ① voice channel (with a check of the worker's
// permissions), ② station, ③ channel for the now-playing panel. Everything
// is chosen in the message itself; at the end the radio runs.
// This file only builds payloads; runtime-methods/onboarding.js feeds them.
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
} from "discord.js";

import { clipText } from "../lib/helpers.js";
import * as ui from "../discord/ui/index.js";
import { NOTICE_CATALOG } from "../discord/ui/notice-catalog.js";

export const SETUP_COMPONENT_PREFIX = "omnifm:setup:";
export const SETUP_COMPONENT_ID_OPEN = `${SETUP_COMPONENT_PREFIX}open`;
export const SETUP_COMPONENT_ID_HELP = `${SETUP_COMPONENT_PREFIX}help`;
export const SETUP_PANEL_AUTO = "auto";

const SETUP_ACTIONS = new Set(["voice", "station", "panel", "start", "refresh"]);
const TEXT_CHANNEL_OPTION_LIMIT = 24;

// Names as the Discord client shows them in the permission settings.
const PERMISSION_LABELS = Object.freeze({
  ViewChannel: ["Kanal ansehen", "View Channel"],
  Connect: ["Verbinden", "Connect"],
  Speak: ["Sprechen", "Speak"],
  SendMessages: ["Nachrichten senden", "Send Messages"],
  EmbedLinks: ["Links einbetten", "Embed Links"],
});

export const PANEL_CHANNEL_PERMISSIONS = Object.freeze(["ViewChannel", "SendMessages", "EmbedLinks"]);

/** What a worker needs in a voice channel; a stage needs no Speak to join. */
export function voiceChannelPermissions(channelType) {
  return channelType === ChannelType.GuildStageVoice
    ? ["ViewChannel", "Connect"]
    : ["ViewChannel", "Connect", "Speak"];
}

/** The permissions from `needed` that `perms` lacks, as labels in the user's language. */
export function missingPermissionLabels(perms, needed, t = (de) => de) {
  return needed
    .filter((name) => !perms?.has?.(PermissionFlagsBits[name]))
    .map((name) => t(...(PERMISSION_LABELS[name] || [name, name])));
}

export function setupCustomId(action, sessionId) {
  return `${SETUP_COMPONENT_PREFIX}${action}:${sessionId}`;
}

/** "omnifm:setup:voice:abc" -> { action: "voice", sessionId: "abc" }; null for others. */
export function parseSetupCustomId(customId) {
  const value = String(customId || "");
  if (!value.startsWith(SETUP_COMPONENT_PREFIX)) return null;
  const [action, sessionId] = value.slice(SETUP_COMPONENT_PREFIX.length).split(":");
  if (!SETUP_ACTIONS.has(action) || !sessionId) return null;
  return { action, sessionId };
}

/** Text and announcement channels in server order, for step ③. */
export function buildPanelChannelOptions(guild, selectedId = null, { t = (de) => de, canUse = null } = {}) {
  const channels = Array.from(guild?.channels?.cache?.values?.() || [])
    .filter((channel) => channel && (channel.type === ChannelType.GuildText || channel.type === ChannelType.GuildAnnouncement))
    .sort((left, right) => (Number(left?.rawPosition) || 0) - (Number(right?.rawPosition) || 0));
  // Channels the worker can post in come first, so a large server does not
  // lose them behind the 25-option limit.
  const usable = typeof canUse === "function" ? channels.filter((channel) => canUse(channel)) : channels;
  const shown = (usable.length ? usable : channels).slice(0, TEXT_CHANNEL_OPTION_LIMIT);
  return [
    {
      label: t("Automatisch", "Automatic"),
      value: SETUP_PANEL_AUTO,
      description: t("Im Chat des Sprachkanals", "In the voice channel's chat"),
      default: selectedId === SETUP_PANEL_AUTO,
    },
    ...shown.map((channel) => ({
      label: clipText(`#${channel.name || channel.id}`, 90),
      value: channel.id,
      default: channel.id === selectedId,
    })),
  ];
}

function stepState({ chosen, missing }) {
  if (!chosen) return "open";
  return Array.isArray(missing) && missing.length ? "problem" : "done";
}

const STEP_MARKS = Object.freeze({ done: "✅", problem: "⚠️", open: "⬜" });

function selectRow(customId, placeholder, options, t) {
  const hasOptions = options.length > 0;
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(customId)
      .setPlaceholder(placeholder)
      .addOptions(hasOptions ? options : [{
        label: t("Nichts zur Auswahl", "Nothing to choose"),
        value: "__none__",
        default: true,
      }])
      .setDisabled(!hasOptions)
  );
}

function missingText(t, missing, channelMention) {
  const entry = NOTICE_CATALOG["missing-permissions"];
  return `${ui.icon("error")} ${t(...entry.body({ missing, channel: channelMention }))}`;
}

function helpButton(t, applicationId) {
  return new ButtonBuilder()
    .setCustomId(SETUP_COMPONENT_ID_HELP)
    .setStyle(ButtonStyle.Secondary)
    .setEmoji(ui.componentEmoji("help", applicationId))
    .setLabel(t("Hilfe", "Help"));
}

function linkButton(label, url) {
  return url ? new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(label).setURL(url) : null;
}

/**
 * The public welcome after the invite: what OmniFM is, the three steps, and
 * the button that opens the private setup.
 */
export function buildWelcomePayload({ t, guildName = "", urls = {}, applicationId = null }) {
  const steps = [
    `① ${t("Sprachkanal wählen", "Choose a voice channel")}`,
    `② ${t("Sender wählen", "Choose a station")}`,
    `③ ${t("Kanal fürs Now-Playing-Panel wählen", "Choose the channel for the now-playing panel")}`,
  ].join("\n");
  const actions = [
    new ActionRowBuilder().addComponents(...[
      new ButtonBuilder()
        .setCustomId(SETUP_COMPONENT_ID_OPEN)
        .setStyle(ButtonStyle.Primary)
        .setEmoji(ui.componentEmoji("settings", applicationId))
        .setLabel(t("Einrichtung starten", "Start setup")),
      helpButton(t, applicationId),
      linkButton("Dashboard", urls.dashboard),
      linkButton("Support", urls.support),
    ].filter(Boolean)),
  ];
  return ui.message(ui.panel({
    title: `${ui.icon("radio", applicationId)} ${t("Danke für die Einladung!", "Thanks for the invite!")}`,
    subtitle: guildName
      ? t(`OmniFM ist jetzt auf **${guildName}**.`, `OmniFM is now on **${guildName}**.`)
      : "",
    body: [
      ui.text(`${t("In drei Schritten läuft euer Radio – ganz ohne Befehle:", "Three steps and your radio runs, no commands needed:")}\n${steps}`),
      ui.text(ui.subtext(t(
        "Die Einrichtung startet, wer auf dem Server das Recht „Server verwalten“ hat.",
        "Anyone with the “Manage Server” permission can start the setup."
      ))),
    ],
    actions,
  }));
}

/**
 * The private setup. `view` holds what the runtime found out:
 * worker { ready, name, inviteUrl }, voice { options, selectedId,
 * missing }, station { options, selectedKey, selectedName }, panel
 * { options, selectedId, missing }, optional hint { kind, title, body }.
 */
export function buildSetupWizardPayload({ t, sessionId, guildName = "", view, urls = {}, applicationId = null }) {
  const { worker = {}, voice = {}, station = {}, panel = {}, hint = null } = view || {};
  const voiceState = stepState({ chosen: voice.selectedId, missing: voice.missing });
  const stationState = stepState({ chosen: station.selectedKey, missing: null });
  const panelState = stepState({ chosen: panel.selectedId, missing: panel.missing });
  const progress = [
    `${STEP_MARKS[voiceState]} ① ${t("Sprachkanal", "Voice channel")}`,
    `${STEP_MARKS[stationState]} ② ${t("Sender", "Station")}`,
    `${STEP_MARKS[panelState]} ③ ${t("Panel-Kanal", "Panel channel")}`,
  ].join("  →  ");

  const body = [ui.text(progress)];
  if (hint) {
    const style = ui.NOTICE_KINDS[hint.kind] || ui.NOTICE_KINDS.info;
    body.push(ui.text(`${ui.icon(style.icon, applicationId)} **${hint.title}**\n${hint.body || ""}`.trim()));
  }
  body.push(ui.separator());

  if (!worker.ready) {
    const intro = `**${t("Zuerst: einen Worker einladen", "First: invite a worker")}**\n${t(
      "Der Worker ist der Bot, der im Sprachkanal spielt. Lade ihn ein und tippe danach auf „Prüfen“.",
      "The worker is the bot that plays in the voice channel. Invite it, then tap “Check”."
    )}`;
    const invite = linkButton(t("Worker einladen", "Invite worker"), worker.inviteUrl);
    body.push(invite ? ui.section({ content: intro, button: invite }) : ui.text(intro));
  }

  // ① voice channel, with the permissions of the worker that will play
  let voiceLine = t("Wo soll das Radio laufen?", "Where should the radio play?");
  if (voice.selectedId) {
    const mention = `<#${voice.selectedId}>`;
    if (voiceState === "problem") voiceLine = missingText(t, voice.missing, mention);
    else if (Array.isArray(voice.missing)) {
      voiceLine = t(`🔊 ${mention} · Die Rechte für ${worker.name || "den Worker"} passen.`, `🔊 ${mention} · ${worker.name || "The worker"} has the permissions it needs.`);
    } else {
      voiceLine = t(`🔊 ${mention} · Die Rechte prüfe ich beim Start.`, `🔊 ${mention} · I check the permissions when starting.`);
    }
  }
  body.push(ui.text(`${ui.heading(`① ${t("Sprachkanal", "Voice channel")}`, 3)}\n${voiceLine}`));
  body.push(selectRow(setupCustomId("voice", sessionId), t("🔊 Sprachkanal wählen", "🔊 Choose a voice channel"), voice.options || [], t));

  // ② station
  const stationLine = station.selectedKey
    ? `📻 **${clipText(station.selectedName || station.selectedKey, 100)}**`
    : t("Was soll laufen? Wechseln geht später jederzeit.", "What should play? You can switch any time later.");
  body.push(ui.text(`${ui.heading(`② ${t("Sender", "Station")}`, 3)}\n${stationLine}`));
  body.push(selectRow(setupCustomId("station", sessionId), t("📻 Sender wählen", "📻 Choose a station"), station.options || [], t));

  // ③ panel channel, saved for the server
  let panelLine = t("Wo soll das Now-Playing-Panel stehen? Ohne Auswahl: im Chat des Sprachkanals.", "Where should the now-playing panel go? Without a choice: in the voice channel's chat.");
  if (panel.selectedId === SETUP_PANEL_AUTO) {
    panelLine = t("📌 Automatisch: im Chat des Sprachkanals.", "📌 Automatic: in the voice channel's chat.");
  } else if (panel.selectedId) {
    const mention = `<#${panel.selectedId}>`;
    panelLine = panelState === "problem"
      ? missingText(t, panel.missing, mention)
      : t(`📌 Das Panel erscheint in ${mention}.`, `📌 The panel appears in ${mention}.`);
  }
  body.push(ui.text(`${ui.heading(`③ ${t("Panel-Kanal", "Panel channel")}`, 3)}\n${panelLine}`));
  body.push(selectRow(setupCustomId("panel", sessionId), t("📌 Panel-Kanal wählen", "📌 Choose the panel channel"), panel.options || [], t));

  const canStart = Boolean(worker.ready && voice.selectedId && voiceState !== "problem" && station.selectedKey);
  const buttons = [
    new ButtonBuilder()
      .setCustomId(setupCustomId("start", sessionId))
      .setStyle(ButtonStyle.Success)
      .setEmoji(ui.componentEmoji("play", applicationId))
      .setLabel(t("Radio starten", "Start radio"))
      .setDisabled(!canStart),
    new ButtonBuilder()
      .setCustomId(setupCustomId("refresh", sessionId))
      .setStyle(ButtonStyle.Secondary)
      .setLabel(t("🔄 Prüfen", "🔄 Check")),
    helpButton(t, applicationId),
    linkButton("Dashboard", urls.dashboard),
  ];
  if (voiceState === "problem" || panelState === "problem") {
    buttons.push(linkButton(t("So gibst du Rechte", "How to grant permissions"), urls.permissionsHelp));
  }

  return ui.reply(ui.panel({
    title: `${ui.icon("settings", applicationId)} ${t("Einrichtung", "Setup")}${guildName ? ` · ${clipText(guildName, 60)}` : ""}`,
    body,
    actions: [new ActionRowBuilder().addComponents(...buttons.filter(Boolean))],
  }));
}

/** The last view: the radio runs. */
export function buildSetupDonePayload({
  t,
  workerName = "",
  stationName = "",
  voiceChannelId = "",
  panelChannelId = null,
  recovering = false,
  urls = {},
  quickstartId = null,
  applicationId = null,
}) {
  const who = workerName || "OmniFM";
  const lines = [
    recovering
      ? t(`${who} ist in <#${voiceChannelId}> und holt **${stationName}** gerade noch einmal – das dauert einen Moment.`, `${who} is in <#${voiceChannelId}> and is fetching **${stationName}** once more; this takes a moment.`)
      : t(`${who} spielt jetzt **${stationName}** in <#${voiceChannelId}>.`, `${who} now plays **${stationName}** in <#${voiceChannelId}>.`),
    panelChannelId && panelChannelId !== SETUP_PANEL_AUTO
      ? t(`Das Now-Playing-Panel erscheint in <#${panelChannelId}>.`, `The now-playing panel appears in <#${panelChannelId}>.`)
      : t("Das Now-Playing-Panel erscheint im Chat des Sprachkanals.", "The now-playing panel appears in the voice channel's chat."),
  ];
  const buttons = [
    linkButton("Dashboard", urls.dashboard),
    helpButton(t, applicationId),
    quickstartId
      ? new ButtonBuilder().setCustomId(quickstartId).setStyle(ButtonStyle.Secondary).setLabel(t("🎛 Sender wechseln", "🎛 Switch station"))
      : null,
  ].filter(Boolean);
  return ui.reply(ui.panel({
    accent: recovering ? ui.UI_COLORS.warning : ui.UI_COLORS.success,
    title: recovering ? t("Gleich geht's los", "Almost there") : t("Läuft! 🎉", "It's on! 🎉"),
    body: [
      ui.text(lines.join("\n")),
      ui.text(ui.subtext(t(
        "Alles Weitere – Sender, Lautstärke, Zeitpläne – findest du im Dashboard und in der Hilfe.",
        "Everything else (stations, volume, schedules) is in the dashboard and the help."
      ))),
    ],
    actions: [new ActionRowBuilder().addComponents(...buttons)],
  }));
}
