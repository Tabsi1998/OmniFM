// ============================================================
// OmniFM: the Advent calendar in the panel (#428)
// ============================================================
// From 1 to 24 December (the server's time) the panel has a button
// "🎁 Türchen 5". Anyone may open it; the door is only for whoever opened
// it: the station tip of the day and a small surprise, in their language.
// The same door on every server that day; nothing is stored per person.
import { ButtonBuilder, ButtonStyle } from "discord.js";

import * as ui from "../discord/ui/index.js";
import {
  DEFAULT_SEASON_TIME_ZONE,
  isValidTimeZone,
  localTime,
  normalizeOwnerSeasons,
  normalizeSeasonSettings,
} from "../lib/seasons.js";
import { ADVENT_DOORS, ADVENT_LABELS, ADVENT_LANGUAGES } from "../config/advent-doors.js";
import { NP_PREFIX } from "./runtime-shared.js";

export const ADVENT_BUTTON_ID = `${NP_PREFIX}advent`;
const ADVENT_COLOR = 0x15803D;
const WINTRY_GENRES = /winter|christmas|xmas|chill|ambient|lounge|jazz|lo-?fi|classic|klassik|acoustic|piano|soul/i;

/**
 * Which door is open today on this server (1-24), or null. The part and the
 * Advent switches of the owner and the server decide, the date counts in the
 * server's time zone; the owner's Advent or Christmas test opens one any day.
 */
export function adventDoorFor({ now = new Date(), guildId = "", settings = {}, owner = {} } = {}) {
  const server = normalizeSeasonSettings(settings?.seasonDecor);
  if (server.parts.adventCalendar === false) return null;
  const switches = normalizeOwnerSeasons(owner);
  const zone = isValidTimeZone(settings?.timeZone) ? settings.timeZone : DEFAULT_SEASON_TIME_ZONE;
  const local = localTime(now, zone);
  if (switches.test.guildIds.includes(String(guildId)) && /^(advent|christmas)-/.test(switches.test.preview)) {
    return Math.min(24, Math.max(1, local.day));
  }
  if (!switches.enabled.advent || !server.seasons.advent) return null;
  return local.month === 12 && local.day <= 24 ? local.day : null;
}

/** The door's language: the opener's Discord language if it is one of the nine, else English. */
export function adventLanguage(locale) {
  const code = String(locale || "").toLowerCase().split("-")[0];
  return ADVENT_LANGUAGES.includes(code) ? code : "en";
}

/**
 * The station tip of the day among the stations the server's plan plays:
 * its Christmas stations first (#430), else wintry genres, else any; the
 * same for every server with that choice on that day.
 */
export function adventStationTip(stations = {}, day = 1) {
  const entries = Object.entries(stations || {}).sort(([left], [right]) => left.localeCompare(right));
  const christmas = entries.filter(([, station]) => Array.isArray(station?.seasons) && station.seasons.includes("christmas"));
  const wintry = entries.filter(([, station]) => WINTRY_GENRES.test(String(station?.genre || "")));
  const pool = christmas.length ? christmas : (wintry.length ? wintry : entries);
  if (!pool.length) return null;
  const [key, station] = pool[(Math.max(1, day) - 1) % pool.length];
  return { key, name: String(station?.name || key), genre: String(station?.genre || "") };
}

/**
 * The opened door, ephemeral: the surprise (a riddle's answer as a spoiler)
 * and the station tip with "Play now" for whoever may use /play.
 */
export function buildAdventDoor({ day, language = "en", tip = null, canPlay = false }) {
  const labels = ADVENT_LABELS[language] || ADVENT_LABELS.en;
  const door = ADVENT_DOORS[Math.min(24, Math.max(1, day)) - 1];
  const lines = [
    ui.heading(`🎁 ${labels.door.replace("{day}", String(day))}`),
    `**${labels[door.kind]}** ${door.text[language] || door.text.en}`,
  ];
  if (door.answer) lines.push(`${labels.answer}: ||${door.answer[language] || door.answer.en}||`);
  const blocks = [ui.text(lines.join("\n"))];
  if (tip) {
    const tipLine = `📻 **${labels.tip}:** ${tip.name}${tip.genre ? ` · ${tip.genre}` : ""}`;
    const customId = `${NP_PREFIX}fav:${tip.key}`;
    blocks.push(canPlay && customId.length <= 100
      ? ui.section({ content: tipLine, button: new ButtonBuilder().setCustomId(customId).setStyle(ButtonStyle.Success).setLabel(labels.play) })
      : ui.text(tipLine));
  } else {
    blocks.push(ui.text(ui.subtext(labels.noTip)));
  }
  blocks.push(ui.brandLine());
  return ui.reply(ui.container({ accent: ADVENT_COLOR, blocks }));
}
