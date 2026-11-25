// ============================================================
// OmniFM Radio (#593): the live announcement and its "show over" edit
// ============================================================
// OmniFM 1 posts the live message with a "Listen now" button; when the show
// ends the same message becomes a thank-you without button. DJ name and
// title come from AzuraCast: escaped, on one line, and no mention inside
// them can render or ping. Only the role a server chose is pinged.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle, escapeMarkdown } from "discord.js";

import * as ui from "../discord/ui/index.js";

/** The "Listen now" button; handled by the bot that posted the message. */
export const RADIO_LISTEN_ID = "omnifm:radio:listen";

// After "<" it stops a mention from rendering (the ping is off anyway).
const ZERO_WIDTH = String.fromCharCode(0x200b);

/** One line of AzuraCast text that renders as written: no markdown, no mention. */
function plain(value, max) {
  const line = String(value ?? "").replace(/\s+/g, " ").trim();
  const clipped = line.length > max ? `${line.slice(0, max - 1)}…` : line;
  return escapeMarkdown(clipped, { maskedLink: true }).replace(/</g, `<${ZERO_WIDTH}`);
}

const unix = (iso) => {
  const time = Date.parse(String(iso || ""));
  return Number.isFinite(time) ? Math.floor(time / 1000) : null;
};

/**
 * @param {{ t: (de: string, en: string, params?: Record<string, unknown>) => string, show: any, roleId?: string, botName?: string, applicationId?: string | null }} options
 */
export function buildRadioLivePayload({ t, show = {}, roleId = "", botName = "OmniFM 1", applicationId = null }) {
  const dj = plain(show.streamerName, 80);
  const title = plain(show.title, 200);
  const since = unix(show.startedAt);
  const heading = `${ui.icon("live", applicationId)} ${dj
    ? t("{dj} ist live auf OmniFM Radio", "{dj} is live on OmniFM Radio", { dj })
    : t("Live auf OmniFM Radio", "Live on OmniFM Radio")}`;
  const listen = new ButtonBuilder()
    .setCustomId(RADIO_LISTEN_ID)
    .setStyle(ButtonStyle.Success)
    .setLabel(t("Jetzt hören", "Listen now"));
  const emoji = ui.componentEmoji("play", applicationId);
  if (emoji) listen.setEmoji(emoji);
  const panel = ui.panel({
    accent: ui.UI_COLORS.live,
    title: heading,
    subtitle: title ? `**${title}**` : "",
    body: [
      roleId ? ui.text(`<@&${roleId}>`) : null,
      ui.text(t(
        "Geh in einen Sprachkanal und drück auf „Jetzt hören“: {bot} kommt zu dir und spielt die Sendung.",
        "Join a voice channel and press “Listen now”: {bot} joins you and plays the show.",
        { bot: plain(botName, 40) },
      )),
      ui.text(ui.subtext(ui.statusLine([
        since ? t("Live seit {time}", "Live since {time}", { time: `<t:${since}:R>` }) : null,
        show.source === "test" ? t("Test-Sendung", "Test show") : null,
      ]))),
    ].filter(Boolean),
    actions: [new ActionRowBuilder().addComponents(listen)],
  });
  return { ...ui.message(panel), allowedMentions: roleId ? { parse: [], roles: [roleId] } : { parse: [] } };
}

/**
 * @param {{ t: (de: string, en: string, params?: Record<string, unknown>) => string, show: any, applicationId?: string | null }} options
 */
export function buildRadioEndedPayload({ t, show = {}, applicationId = null }) {
  const start = unix(show.startedAt);
  const end = unix(show.endedAt);
  const panel = ui.panel({
    accent: ui.UI_COLORS.neutral,
    title: `${ui.icon("radio", applicationId)} ${t("Sendung vorbei – danke fürs Zuhören", "Show over – thanks for listening")}`,
    subtitle: ui.statusLine([plain(show.streamerName, 80), plain(show.title, 200)]),
    body: start && end
      ? [ui.text(ui.subtext(t("Gesendet von {start} bis {end}", "On air from {start} to {end}", { start: `<t:${start}:t>`, end: `<t:${end}:t>` })))]
      : [],
  });
  return { ...ui.message(panel), allowedMentions: { parse: [] } };
}
