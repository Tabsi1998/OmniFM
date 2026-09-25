// ============================================================
// OmniFM: the weekly digest as a Components V2 message (#278)
// ============================================================
// Tiles for listening time, the most listeners at once, the busiest moment
// and active days, each compared with the week before; then the top
// stations with their logos and the songs that ran most. "team" adds the
// technical numbers and the dashboard link, "public" is for the community.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import * as ui from "../discord/ui/index.js";

function clip(value, max) {
  const text = String(value ?? "").trim();
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

/** "12 h 30 min", "45 min", "0 min". */
export function formatDigestDuration(ms) {
  const minutes = Math.max(0, Math.round((Number(ms) || 0) / 60_000));
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest} min`;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

/** "▲ 18 %", "▼ 5 %", "± 0 %"; empty without a week to compare. */
export function formatDigestChange(percent, t) {
  if (percent === null || percent === undefined || !Number.isFinite(percent)) return "";
  const arrow = percent > 0 ? "▲" : (percent < 0 ? "▼" : "±");
  return `${arrow} ${Math.abs(percent)} % ${t("zur Vorwoche", "vs. last week")}`;
}

function seconds(ms) {
  return Math.floor(Number(ms) / 1000);
}

function tile(value, label, change = "") {
  return ui.text(`### ${value}\n${ui.subtext(ui.statusLine([label, change]))}`);
}

/**
 * @param {object} input
 * @param {(de: string, en: string) => string} input.t
 * @param {string} input.guildName
 * @param {object} input.report     from buildWeeklyDigestReport()
 * @param {"team"|"public"} [input.audience]
 * @param {object} [input.urls]     { dashboard }
 */
export function buildWeeklyDigestPayload({ t, guildName = "", report, audience = "team", urls = {} }) {
  const team = audience !== "public";
  const name = clip(guildName || "OmniFM", 80);
  const range = `<t:${seconds(report.range.startMs)}:d> – <t:${seconds(report.range.endMs - 1000)}:d>`;
  const head = ui.text([
    ui.heading(`📈 ${t("Wochenrückblick", "Weekly recap")}`),
    ui.subtext(`${name} · ${range}`),
  ].join("\n"));

  if (report.empty) {
    return ui.message(ui.container({
      blocks: [
        head,
        ui.text(t(
          `Diese Woche lief auf **${name}** kein Radio. Startet mit /play oder dem Schnellstart – nächste Woche stehen hier eure Zahlen.`,
          `No radio ran on **${name}** this week. Start with /play or the quick start; next week your numbers show up here.`
        )),
        ui.brandLine(t("Wochenrückblick", "Weekly recap")),
      ],
    }));
  }

  const { week, changes } = report;
  const blocks = [
    head,
    ui.separator(),
    tile(`🎧 ${formatDigestDuration(week.listeningMs)}`, t("Hörzeit", "Listening time"), formatDigestChange(changes.listeningMs, t)),
    tile(`👥 ${week.peakListeners}`, t("Meiste Hörer gleichzeitig", "Most listeners at once"), formatDigestChange(changes.peakListeners, t)),
  ];
  if (report.peakTime) {
    blocks.push(tile(`⏰ <t:${seconds(report.peakTime.atMs)}:f>`, t(`Spitzenzeit mit ${report.peakTime.listeners} Hörern`, `Busiest moment, ${report.peakTime.listeners} listeners`)));
  }
  blocks.push(tile(`📅 ${week.activeDays} / 7`, t("Tage mit Radio", "Days with radio")));
  if (report.firstWeek) {
    blocks.push(ui.text(ui.subtext(t(
      "Erste Woche mit OmniFM – den Vergleich zur Vorwoche gibt es ab nächster Woche.",
      "First week with OmniFM; the comparison with the week before starts next week."
    ))));
  }

  if (report.topStations.length) {
    blocks.push(ui.separator(), ui.text(`**🏆 ${t("Top-Sender", "Top stations")}**`));
    report.topStations.forEach((station, index) => {
      const content = `**${index + 1}. ${clip(station.name, 80)}**\n${ui.subtext(`${formatDigestDuration(station.listeningMs)} ${t("Hörzeit", "listening")}`)}`;
      blocks.push(station.logoUrl ? ui.section({ content, thumbnailUrl: station.logoUrl }) : ui.text(content));
    });
  }

  if (report.topSongs.length) {
    const songs = report.topSongs
      .map((song, index) => `${index + 1}. ${clip(song.displayTitle, 90)} (${song.count}×)`)
      .join("\n");
    blocks.push(ui.separator(), ui.text(`**🎵 ${t("Am öftesten gelaufen", "Played most often")}**\n${songs}`));
  }

  const actions = [];
  if (team) {
    blocks.push(ui.text(ui.subtext(ui.statusLine([
      `${t("Sessions", "Sessions")} ${week.sessions}`,
      `${t("Starts", "Starts")} ${week.starts}`,
      report.allTime.listeningMs ? `${t("Seit Beginn", "Since the start")} ${formatDigestDuration(report.allTime.listeningMs)}` : null,
    ]))));
    if (urls.dashboard) {
      actions.push(new ActionRowBuilder().addComponents(
        new ButtonBuilder().setStyle(ButtonStyle.Link).setLabel(t("Mehr im Dashboard", "More in the dashboard")).setURL(urls.dashboard)
      ));
    }
  }
  if (actions.length) blocks.push(ui.separator(), ...actions);
  blocks.push(ui.brandLine(t("Wochenrückblick", "Weekly recap")));

  // The accent follows the week's favourite station, like the panel does.
  const accent = report.topStations[0]?.color ?? ui.UI_COLORS.brand;
  return ui.message(ui.container({ accent, blocks }));
}
