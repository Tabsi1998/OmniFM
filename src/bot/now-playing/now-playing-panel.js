// ============================================================
// OmniFM: the now-playing panel in Components V2 (#266)
// ============================================================
// Built from plain data only, so every state (playing, paused, reconnecting,
// parked, backup station) can be tested without a bot. The runtime collects
// the data in now-playing-methods.js.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import * as ui from "../../discord/ui/index.js";
import { tierColor } from "../brand-embed.js";
import { STATIONS_COMPONENT_ID_OPEN } from "../runtime-links.js";
import { colorSquare } from "../station-browser.js";
import { NP_PREFIX } from "../runtime-shared.js";
import { normalizePanelDesign } from "../../lib/panel-design.js";

function clip(value, max) {
  const textValue = String(value ?? "").trim();
  return textValue.length <= max ? textValue : `${textValue.slice(0, max - 1)}…`;
}

/** The header line: what the stream is doing right now, in words. */
function phaseLabel(phase, paused, t, appId) {
  if (paused || phase === "paused") return `${ui.icon("pause", appId)} ${t("Pausiert", "Paused")}`;
  if (phase === "parked") return `${ui.icon("warning", appId)} ${t("Wartet auf den Sender", "Waiting for the station")}`;
  if (phase === "recovering") return `${ui.icon("warning", appId)} ${t("Verbindet neu …", "Reconnecting …")}`;
  if (phase === "connecting" || phase === "starting") return `${ui.icon("radio", appId)} ${t("Startet …", "Starting …")}`;
  return `${ui.icon("equalizer", appId)} ${t("LIVE · Jetzt auf Sendung", "LIVE · On air now")}`;
}

function button(customId, { label, emoji, style = ButtonStyle.Secondary, appId }) {
  const control = new ButtonBuilder().setCustomId(customId).setStyle(style);
  if (label) control.setLabel(clip(label, 80));
  const componentEmoji = emoji ? ui.componentEmoji(emoji, appId) : undefined;
  if (componentEmoji) control.setEmoji(componentEmoji);
  return control;
}

function linkButton(url, label, emoji, appId) {
  const control = new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(url).setLabel(clip(label, 80));
  const componentEmoji = emoji ? ui.componentEmoji(emoji, appId) : undefined;
  if (componentEmoji) control.setEmoji(componentEmoji);
  return control;
}

/**
 * @param {object} input
 * @param {(de: string, en: string) => string} input.t
 * @param {string|null} input.applicationId  the sending bot: its app emojis
 * @param {string} input.workerName
 * @param {string} input.planTier  the server's plan: free, pro or ultimate
 * @param {object} input.station   { name, key, genre, tier, color, logoUrl }
 * @param {object} input.track     { hasTrack, headline, artist, album, artworkUrl, sourceNote, sourceLabel, metadataHint }
 * @param {object} input.playback  { phase, paused, listeners, bitrate, volume, channelId }
 * @param {object} [input.notices] { serverMuted, failover: { active, desiredName, currentName } }
 * @param {string[]} [input.recent] display titles of the last songs, newest first
 * @param {object[]} [input.favorites] { key, name, color } of the server's favourites (#276)
 * @param {string|null} [input.searchQuery]
 * @param {string|null} [input.musicBrainzUrl]
 * @param {string|null} [input.fallbackImageUrl] bot avatar when neither cover nor logo exists
 * @param {number} [input.pollSeconds]
 * @param {object} [input.design] the server's panel look (#281), see panel-design.js
 */
export function buildNowPlayingPanel(input) {
  const { t, applicationId: appId = null, station = {}, track = {}, playback = {}, notices = {} } = input;
  const stationName = clip(station.name || station.key || "-", 100);
  const design = normalizePanelDesign(input.design);
  const show = design.buttons;

  // Accent: the server's own colour (#281), else the station's (#267), else
  // the plan colour; without a recognised title amber, like the old embed.
  const accent = design.accentColor ?? (Number.isInteger(station.color) ? station.color
    : (track.hasTrack ? tierColor(input.planTier) : ui.UI_COLORS.warning));

  const headLines = [
    ui.subtext(`${phaseLabel(playback.phase, playback.paused, t, appId)} · ${clip(input.workerName || "OmniFM", 60)}`),
    ui.heading(clip(track.hasTrack ? (track.headline || stationName) : stationName, 110)),
  ];
  if (track.hasTrack && track.artist) headLines.push(clip(track.artist, 120));
  if (track.hasTrack && track.sourceNote) headLines.push(ui.subtext(clip(track.sourceNote, 160)));
  if (!track.hasTrack) headLines.push(ui.subtext(t("Live-Radio-Stream läuft", "Live radio stream playing")));
  const image = track.artworkUrl || station.logoUrl || input.fallbackImageUrl || null;
  const head = image
    ? ui.section({ content: headLines.join("\n"), thumbnailUrl: image })
    : ui.text(headLines.join("\n"));

  const details = [
    ui.statusLine([
      `${ui.icon("radio", appId)} **${stationName}**`,
      clip(station.genre, 40),
      station.tier && String(station.tier).toLowerCase() !== "free" ? String(station.tier).toUpperCase() : null,
    ]),
    ui.statusLine([
      playback.listeners >= 2 ? `${ui.icon("listeners", appId)} ${playback.listeners} ${t("hören", "listening")}` : null,
      playback.bitrate ? `${ui.icon("quality", appId)} ${playback.bitrate}` : null,
      Number.isFinite(playback.volume) ? `🔊 ${Math.max(0, Math.min(100, playback.volume))}%` : null,
      playback.channelId ? `<#${playback.channelId}>` : null,
      playback.sleepUntilMs > 0 ? `😴 ${t("Schläft um", "Sleeps at")} <t:${Math.floor(playback.sleepUntilMs / 1000)}:t>` : null,
    ]),
  ];
  if (track.hasTrack && track.album) details.push(ui.subtext(`💿 ${clip(track.album, 120)}`));
  // #282: MusicBrainz as a link in the text, so the button row has room for "Share".
  if (track.hasTrack && input.musicBrainzUrl) details.push(ui.subtext(`[MusicBrainz](${input.musicBrainzUrl})`));

  const warnings = [];
  if (!track.hasTrack && track.metadataHint) warnings.push(`> ${ui.icon("info", appId)} ${clip(track.metadataHint, 300)}`);
  if (notices.serverMuted) {
    warnings.push(`> 🔇 ${t(
      "OmniFM ist auf diesem Server stummgeschaltet, niemand hört den Stream. Rechtsklick auf OmniFM im Sprachkanal → Server-Stummschaltung aufheben.",
      "OmniFM is server-muted here, nobody hears the stream. Right-click OmniFM in the voice channel → remove the server mute.",
    )}`);
  }
  const failover = notices.failover || {};
  if (failover.active && failover.desiredName) {
    warnings.push(`> ↪ ${t(
      `Ersatzsender aktiv: **${clip(failover.desiredName, 80)}** ist gerade nicht erreichbar. OmniFM prüft ihn automatisch und wechselt zurück, sobald er wieder läuft.`,
      `Backup station active: **${clip(failover.desiredName, 80)}** is unreachable right now. OmniFM keeps checking and switches back once it plays again.`,
    )}`);
  }

  const recent = design.showRecent
    ? (input.recent || []).map((title) => clip(title, 60)).filter(Boolean).slice(0, 3)
    : [];

  // Pause and Stop always stay; the rest follows the server's design (#281).
  const controls = new ActionRowBuilder().addComponents(...[
    button(`${NP_PREFIX}toggle`, {
      label: playback.paused ? t("Weiter", "Resume") : "Pause",
      emoji: playback.paused ? "play" : "pause",
      style: playback.paused ? ButtonStyle.Success : ButtonStyle.Secondary,
      appId,
    }),
    button(`${NP_PREFIX}stop`, { label: "Stop", emoji: "stop", style: ButtonStyle.Danger, appId }),
    show.volume ? button(`${NP_PREFIX}voldown`, { label: "−", appId }) : null,
    show.volume ? button(`${NP_PREFIX}volup`, { label: "+", appId }) : null,
    show.stations ? button(STATIONS_COMPONENT_ID_OPEN, { label: t("Sender", "Stations"), emoji: "radio", style: ButtonStyle.Primary, appId }) : null,
  ].filter(Boolean));
  const rows = [controls];
  // #276: the server's favourite stations as quick buttons.
  const favorites = (show.favorites ? input.favorites || [] : [])
    .filter((favorite) => favorite?.key && `${NP_PREFIX}fav:${favorite.key}`.length <= 100)
    .slice(0, 5);
  if (favorites.length) {
    rows.push(new ActionRowBuilder().addComponents(...favorites.map((favorite) => {
      const onAir = favorite.key === station.key;
      return new ButtonBuilder()
        .setCustomId(`${NP_PREFIX}fav:${favorite.key}`)
        .setStyle(onAir ? ButtonStyle.Success : ButtonStyle.Secondary)
        .setLabel(clip(favorite.name || favorite.key, 25))
        .setEmoji({ name: colorSquare(favorite.color) })
        .setDisabled(onAir);
    })));
  }
  if (failover.active && failover.desiredName) {
    rows.push(new ActionRowBuilder().addComponents(
      button(`${NP_PREFIX}failback`, {
        label: t(`Zurück zu ${clip(failover.desiredName, 50)}`, `Back to ${clip(failover.desiredName, 50)}`),
        style: ButtonStyle.Primary,
        appId,
      }),
      button(`${NP_PREFIX}keepstation`, {
        label: t(`${clip(failover.currentName || stationName, 50)} behalten`, `Keep ${clip(failover.currentName || stationName, 50)}`),
        appId,
      }),
    ));
  }
  // #273: "Report a problem" is always there, next to the song links when there are some.
  const reportButton = show.report ? button(`${NP_PREFIX}report`, { label: t("Problem melden", "Report a problem"), emoji: "warning", appId }) : null;
  // #282: the card to post in the channel.
  const shareButton = input.shareEnabled === false || !show.share ? null : button(`${NP_PREFIX}share`, { label: t("Teilen", "Share"), emoji: "link", appId });
  const query = input.searchQuery ? encodeURIComponent(input.searchQuery) : "";
  const songRow = [
    // #272: personal, so it sits with the song links, not the controls.
    query && show.save ? button(`${NP_PREFIX}save`, { label: t("Merken", "Save"), emoji: "save", appId }) : null,
    shareButton,
    query && show.links ? linkButton(`https://open.spotify.com/search/${query}`, "Spotify", null, appId) : null,
    query && show.links ? linkButton(`https://www.youtube.com/results?search_query=${query}`, "YouTube", null, appId) : null,
    reportButton,
  ].filter(Boolean);
  // Discord refuses an empty row, so a row with every button switched off goes.
  if (songRow.length) rows.push(new ActionRowBuilder().addComponents(...songRow));

  const footerParts = [
    track.sourceLabel || null,
    input.pollSeconds ? `↻ ${input.pollSeconds}s` : null,
  ];

  return ui.message(ui.container({
    accent,
    blocks: [
      head,
      ui.text(details.filter(Boolean).join("\n")),
      warnings.length ? ui.text(warnings.join("\n")) : null,
      recent.length ? ui.text(ui.subtext(`${ui.icon("history", appId)} ${t("Zuletzt", "Earlier")}: ${recent.join(" · ")}`)) : null,
      ui.separator(),
      ...rows,
      ui.brandLine(...footerParts),
    ],
  }));
}
