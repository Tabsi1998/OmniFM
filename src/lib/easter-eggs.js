// ============================================================
// OmniFM: the Easter egg hunt in the panel (#429)
// ============================================================
// From Palm Sunday to Easter Monday (the server's time) about every eighth
// new song brings an egg into the panel; a rare golden one counts five.
// Whoever clicks first gets it. Here: when the hunt runs, the dice and the
// dates. The data side is easter-eggs-store.js, Discord bot/easter-eggs.js.
import { createHash, randomBytes, randomInt } from "node:crypto";
import {
  DEFAULT_SEASON_TIME_ZONE,
  easterSunday,
  isValidTimeZone,
  localTime,
  normalizeOwnerSeasons,
  normalizeSeasonSettings,
} from "./seasons.js";

/** One song in eight brings an egg, one egg in twenty is golden and counts five. */
export const EGG_CHANCE = 8;
export const GOLDEN_CHANCE = 20;
export const GOLDEN_POINTS = 5;
// The owner's Easter test: an egg every other song and often a golden one, to try it quickly.
export const TEST_EGG_CHANCE = 2;
export const TEST_GOLDEN_CHANCE = 4;
/** A year's eggs are deleted this many days after Easter Monday. */
export const KEEP_AFTER_EASTER_DAYS = 30;
// Two panels with the same song (two bots on one server): one egg per person
// and song. A song that comes again later is a new song.
export const SAME_SONG_MS = 15 * 60_000;

const DAY_MS = 86_400_000;

/** Days since 1970-01-01 of a calendar date; plain date arithmetic, no time zone. */
function dayNumber(year, month, day) {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

/** Palm Sunday and Easter Monday of a year as day numbers. */
function huntDays(year) {
  const easter = easterSunday(year);
  const sunday = dayNumber(easter.year, easter.month, easter.day);
  return { first: sunday - 7, last: sunday + 1 };
}

function dateOf(days) {
  const date = new Date(days * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/**
 * Whether the egg hunt runs on this server now: { year, test } or null. The
 * part and the Easter switches of the owner and the server decide, the date
 * counts in the server's time zone; the owner's Easter test runs it any day
 * on the servers it names.
 * @param {{ now?: Date, guildId?: string, settings?: any, owner?: any }} [options]
 */
export function eggHuntFor({ now = new Date(), guildId = "", settings = {}, owner = {} } = {}) {
  const server = normalizeSeasonSettings(settings?.seasonDecor);
  if (server.parts.eggHunt === false) return null;
  const switches = normalizeOwnerSeasons(owner);
  const zone = isValidTimeZone(settings?.timeZone) ? settings.timeZone : DEFAULT_SEASON_TIME_ZONE;
  const local = localTime(now, zone);
  if (switches.test.guildIds.includes(String(guildId)) && /^easter-/.test(switches.test.preview)) {
    return { year: local.year, test: true };
  }
  if (!switches.enabled.easter || !server.seasons.easter) return null;
  const today = dayNumber(local.year, local.month, local.day);
  const { first, last } = huntDays(local.year);
  return today >= first && today <= last ? { year: local.year, test: false } : null;
}

/** The first day (Palm Sunday) of the next hunt that has not begun yet: { year, month, day }. */
export function nextEggHunt(now = new Date(), timeZone = DEFAULT_SEASON_TIME_ZONE) {
  const local = localTime(now, timeZone);
  const today = dayNumber(local.year, local.month, local.day);
  const { first } = huntDays(local.year);
  return first > today ? dateOf(first) : dateOf(huntDays(local.year + 1).first);
}

/**
 * When a year's eggs are deleted: 30 days after Easter Monday. Eggs from the
 * owner's test later in the year stay 30 days after the last one.
 */
export function eggExpiry(year, now = Date.now()) {
  const afterEaster = (huntDays(year).last + KEEP_AFTER_EASTER_DAYS + 1) * DAY_MS;
  return new Date(Math.max(afterEaster, now + KEEP_AFTER_EASTER_DAYS * DAY_MS));
}

/**
 * The dice for a new song: null (no egg) or { id, golden }. The ID goes into
 * the button, so it cannot be guessed.
 * @param {{ test?: boolean, random?: (max: number) => number }} [options]
 */
export function rollEgg({ test = false, random = randomInt } = {}) {
  if (random(test ? TEST_EGG_CHANCE : EGG_CHANCE) !== 0) return null;
  return {
    id: randomBytes(9).toString("base64url"),
    golden: random(test ? TEST_GOLDEN_CHANCE : GOLDEN_CHANCE) === 0,
  };
}

/** How much an egg counts. */
export function eggPoints(egg) {
  return egg?.golden ? GOLDEN_POINTS : 1;
}

/** A short key of a song for "one egg per person and song"; the title itself is not kept. */
export function songKey(title) {
  const clean = String(title || "").trim().toLowerCase();
  return clean ? createHash("sha256").update(clean).digest("base64url").slice(0, 12) : "";
}

/** Places with ties, rows sorted by count: 12, 9, 9, 4 -> 1, 2, 2, 4. */
export function rankRows(rows = []) {
  let place = 0;
  let previous = null;
  return rows.map((row, index) => {
    if (row.count !== previous) {
      place = index + 1;
      previous = row.count;
    }
    return { ...row, rank: place };
  });
}
