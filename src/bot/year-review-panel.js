// ============================================================
// OmniFM: the year review in Discord (#301 part 2)
// ============================================================
// /jahresrueckblick shows a server's year as cards to page through: the
// hours with a bar per month, the stations and genres, the songs, the hours
// of the day and the longest session, and at the end the share buttons.
// Every plan sees the cards; the picture to share and the post in the
// channel come with Pro (#413), the post from 1 December to 31 January.
import { ActionRowBuilder, ButtonBuilder, ButtonStyle } from "discord.js";

import * as ui from "../discord/ui/index.js";
import { getZonedPartsFromUtcMs } from "../lib/event-time.js";

export const YEAR_REVIEW_PREFIX = "omnifm:review:";
export const YEAR_REVIEW_PAGES = Object.freeze(["overview", "stations", "songs", "time", "share"]);
const TIME_ZONE = "Europe/Berlin";

/**
 * Which year the review shows: in December the year that ends, in January
 * the year before, both final and announceable; otherwise the year so far.
 */
export function reviewYearOf(now = Date.now()) {
  const { year, month } = getZonedPartsFromUtcMs(now, TIME_ZONE);
  if (month === 12) return { year, final: true };
  if (month === 1) return { year: year - 1, final: true };
  return { year, final: false };
}

export function yearReviewCustomId(action, page = 0) {
  return `${YEAR_REVIEW_PREFIX}${action}:${Math.max(0, Number(page) || 0)}`;
}

/** { action: "page" | "open" | "image" | "announce", page } or null. */
export function parseYearReviewCustomId(customId) {
  const match = /^omnifm:review:(page|open|image|announce):(\d{1,2})$/.exec(String(customId || ""));
  if (!match) return null;
  return { action: match[1], page: Math.min(YEAR_REVIEW_PAGES.length - 1, Number(match[2])) };
}

export function isEmptyReview(review) {
  return !review || (!review.listeningHours && !(review.topStations || []).length && !(review.topSongs || []).length);
}

function numberFormat(language) {
  return new Intl.NumberFormat(language === "de" ? "de-DE" : "en-GB");
}

function monthName(monthKey, language, style = "short") {
  const [year, month] = String(monthKey).split("-").map(Number);
  return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { month: style, timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 15)));
}

function dateText(value, language) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return new Intl.DateTimeFormat(language === "de" ? "de-DE" : "en-GB", { day: "numeric", month: "long", timeZone: TIME_ZONE }).format(date);
}

function bar(value, most, width = 10) {
  const filled = most > 0 ? Math.round((width * value) / most) : 0;
  return `${"█".repeat(filled)}${"░".repeat(width - filled)}`;
}

/** The months up to now (the year so far) or all twelve, as bars in a code block. */
function monthChart(review, language, { final, now }) {
  const lastMonth = final ? 12 : getZonedPartsFromUtcMs(now, TIME_ZONE).month;
  const months = (review.months || []).slice(0, lastMonth);
  const most = Math.max(0, ...months.map((month) => month.hours));
  const format = numberFormat(language);
  const lines = months.map((month) => `${monthName(month.month, language).replace(".", "").padEnd(4).slice(0, 4)} ${bar(month.hours, most)} ${format.format(month.hours)} h`);
  return lines.length ? `\`\`\`\n${lines.join("\n")}\n\`\`\`` : "";
}

/** Night, morning, afternoon, evening as bars. */
function dayPartChart(review, t) {
  const hours = review.hoursOfDay || [];
  const parts = [
    [t("Nacht", "Night"), 0], [t("Morgen", "Morning"), 6], [t("Nachmittag", "Afternoon"), 12], [t("Abend", "Evening"), 18],
  ].map(([label, from]) => [label, from, hours.slice(from, from + 6).reduce((sum, value) => sum + (Number(value) || 0), 0)]);
  const most = Math.max(0, ...parts.map((part) => part[2]));
  const width = Math.max(...parts.map((part) => part[0].length));
  return `\`\`\`\n${parts.map(([label, from, value]) => `${label.padEnd(width)} ${String(from).padStart(2, "0")}–${String(from + 6).padStart(2, "0")} ${bar(value, most)}`).join("\n")}\n\`\`\``;
}

function navigation(page, t) {
  const last = YEAR_REVIEW_PAGES.length - 1;
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(yearReviewCustomId("page", Math.max(0, page - 1))).setStyle(ButtonStyle.Secondary)
      .setLabel(t("◀ Zurück", "◀ Back")).setDisabled(page === 0),
    new ButtonBuilder().setCustomId(`${YEAR_REVIEW_PREFIX}position:${page}`).setStyle(ButtonStyle.Secondary)
      .setLabel(`${page + 1} / ${last + 1}`).setDisabled(true),
    new ButtonBuilder().setCustomId(yearReviewCustomId("page", Math.min(last, page + 1))).setStyle(page === last ? ButtonStyle.Secondary : ButtonStyle.Primary)
      .setLabel(t("Weiter ▶", "Next ▶")).setDisabled(page === last),
  );
}

/**
 * One page of the review.
 * @param {object} input
 * @param {(de: string, en: string) => string} input.t
 * @param {string} input.language
 * @param {object} input.review from yearReviewFor()
 * @param {number} [input.page]
 * @param {boolean} [input.final] December or January: the whole year
 * @param {string} [input.guildName]
 * @param {boolean} [input.paid] Pro and up: the picture and the post
 * @param {number} [input.now]
 */
export function buildYearReviewPage({ t, language = "de", review, page = 0, final = false, guildName = "", paid = false, now = Date.now() }) {
  const year = review?.year;
  if (isEmptyReview(review)) {
    return ui.reply(ui.notice("info", {
      title: t(`Noch keine Hörzeit ${year || ""}`.trim(), `No listening time in ${year || "this year"} yet`),
      body: t(
        "Sobald auf dem Server Radio läuft, füllt sich der Rückblick von selbst. Starte einen Sender mit /play.",
        "Once radio plays on the server, the review fills up by itself. Start a station with /play."
      ),
    }));
  }
  const current = Math.min(Math.max(0, Number(page) || 0), YEAR_REVIEW_PAGES.length - 1);
  const format = numberFormat(language);
  const title = final
    ? t(`🎧 ${guildName ? `${guildName}: ` : ""}euer Jahr ${year}`, `🎧 ${guildName ? `${guildName}: ` : ""}your year ${year}`)
    : t(`🎧 ${guildName ? `${guildName}: ` : ""}euer Jahr ${year} bisher`, `🎧 ${guildName ? `${guildName}: ` : ""}your ${year} so far`);
  const body = [];
  const actions = [navigation(current, t)];

  if (YEAR_REVIEW_PAGES[current] === "overview") {
    body.push(ui.text(t(
      `## ${format.format(review.listeningHours)} Stunden Radio\n${format.format(review.sessions)} Hör-Sitzungen`,
      `## ${format.format(review.listeningHours)} hours of radio\n${format.format(review.sessions)} listening sessions`
    )));
    const chart = monthChart(review, language, { final, now });
    if (chart) body.push(ui.text(chart));
    if (review.stationsFrom && review.stationsFrom > `${year}-01`) {
      body.push(ui.subtext(t(
        `Stunden zählen das ganze Jahr; Sender, Songs und Uhrzeiten erst seit ${monthName(review.stationsFrom, language, "long")}.`,
        `Hours count the whole year; stations, songs and times since ${monthName(review.stationsFrom, language, "long")}.`
      )));
    }
  } else if (YEAR_REVIEW_PAGES[current] === "stations") {
    const stations = (review.topStations || []).map((station, index) => `${index + 1}. **${station.name}** · ${format.format(station.hours)} h`);
    body.push(ui.text(`### ${t("📻 Eure Sender", "📻 Your stations")}\n${stations.join("\n") || t("Noch keine Sender gezählt.", "No stations counted yet.")}`));
    const genres = (review.topGenres || []).map((genre) => `${genre.genre} ${genre.share} %`);
    if (genres.length) body.push(ui.text(`### ${t("🎚️ Eure Genres", "🎚️ Your genres")}\n${genres.join(" · ")}`));
  } else if (YEAR_REVIEW_PAGES[current] === "songs") {
    const songs = (review.topSongs || []).map((song, index) => `${index + 1}. **${song.title}** · ${format.format(song.plays)}×`);
    body.push(ui.text(`### ${t("🎵 Eure Songs", "🎵 Your songs")}\n${songs.join("\n") || t("Noch keine Songs gezählt.", "No songs counted yet.")}`));
    if (review.songsFrom) body.push(ui.subtext(t(`Songs zählen seit ${dateText(review.songsFrom, language)}.`, `Songs count since ${dateText(review.songsFrom, language)}.`)));
  } else if (YEAR_REVIEW_PAGES[current] === "time") {
    const lines = [`### ${t("🕗 Wann ihr hört", "🕗 When you listen")}`];
    if (Number.isInteger(review.busiestHour)) {
      lines.push(t(
        `Am liebsten zwischen **${review.busiestHour} und ${(review.busiestHour + 1) % 24} Uhr**.`,
        `Most of all between **${review.busiestHour}:00 and ${(review.busiestHour + 1) % 24}:00**.`
      ));
    }
    body.push(ui.text(lines.join("\n")));
    body.push(ui.text(dayPartChart(review, t)));
    if (review.longest) {
      const when = dateText(review.longest.startedAt, language);
      body.push(ui.text(t(
        `**Längste Sitzung:** ${format.format(review.longest.hours)} h${review.longest.stationName ? ` mit ${review.longest.stationName}` : ""}${when ? ` am ${when}` : ""}.`,
        `**Longest session:** ${format.format(review.longest.hours)} h${review.longest.stationName ? ` with ${review.longest.stationName}` : ""}${when ? ` on ${when}` : ""}.`
      )));
    }
  } else {
    const top = review.topStations?.[0]?.name;
    body.push(ui.text(t(
      `### 🎉 Danke fürs Zuhören\n${format.format(review.listeningHours)} Stunden${top ? `, am meisten ${top}` : ""}. Teilt euer Jahr mit dem Server.`,
      `### 🎉 Thanks for listening\n${format.format(review.listeningHours)} hours${top ? `, most of all ${top}` : ""}. Share your year with the server.`
    )));
    actions.push(new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(yearReviewCustomId("image")).setStyle(ButtonStyle.Primary)
        .setLabel(paid ? t("🖼️ Als Bild", "🖼️ As a picture") : t("🖼️ Bild ab Pro", "🖼️ Picture with Pro")).setDisabled(!paid),
      new ButtonBuilder().setCustomId(yearReviewCustomId("announce")).setStyle(ButtonStyle.Success)
        .setLabel(t("📣 Im Kanal teilen", "📣 Share in the channel")).setDisabled(!paid || !final),
    ));
    body.push(ui.subtext(paid
      ? (final
        ? t("Im Kanal teilen können Verwalter des Servers.", "Server managers can share it in the channel.")
        : t("Im Kanal teilen geht vom 1. Dezember bis 31. Januar.", "Sharing in the channel works from 1 December to 31 January."))
      : t("Bild und Beitrag im Kanal gibt es ab Pro.", "The picture and the channel post come with Pro.")));
  }

  return ui.reply(ui.panel({ title, body, actions }));
}

/** The post in the channel: the year in short and a button that opens the cards for anyone. */
export function buildYearReviewAnnouncement({ t, language = "de", review, guildName = "" }) {
  const format = numberFormat(language);
  const lines = [
    t(`## ${format.format(review.listeningHours)} Stunden Radio`, `## ${format.format(review.listeningHours)} hours of radio`),
    review.topStations?.[0] ? t(`📻 Top-Sender: **${review.topStations[0].name}**`, `📻 Top station: **${review.topStations[0].name}**`) : null,
    review.topSongs?.[0] ? t(`🎵 Top-Song: **${review.topSongs[0].title}**`, `🎵 Top song: **${review.topSongs[0].title}**`) : null,
    Number.isInteger(review.busiestHour) ? t(`🕗 Am liebsten um ${review.busiestHour} Uhr`, `🕗 Most of all at ${review.busiestHour}:00`) : null,
  ].filter(Boolean);
  return ui.message(ui.panel({
    title: t(`🎧 ${guildName || "Unser Server"}: unser Jahr ${review.year} auf OmniFM`, `🎧 ${guildName || "Our server"}: our ${review.year} on OmniFM`),
    body: [ui.text(lines.join("\n"))],
    actions: [new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(yearReviewCustomId("open")).setStyle(ButtonStyle.Primary)
        .setLabel(t("Ganzen Rückblick ansehen", "See the whole review")),
    )],
  }));
}
