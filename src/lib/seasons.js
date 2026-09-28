// ============================================================
// OmniFM: the seasons of the decorations (#425)
// ============================================================
// Easter, Advent, Christmas and New Year for any year, in a server's time
// zone. No imports: the bot, the dashboard and the website share this file
// (frontend/vite.config.js), like src/config/plan-features.js.
//
//   season     from                       to                phases
//   easter     Palm Sunday                Easter Monday     "soon" until Holy Saturday, "greeting" Sunday and Monday
//   advent     first Sunday of Advent     23 December       "candles", one more candle every Sunday (1-4)
//   christmas  24 December                30 December       "greeting" 24-26, "winter" 27-30 (decoration, no greeting)
//   newyear    31 December, 00:00         1 January, 23:59  "countdown" until midnight, then "greeting"
//
// Easter Sunday comes from the Gregorian computus (Meeus/Jones/Butcher): it
// holds for every year and needs no service that could fail.

export const SEASONS = Object.freeze(["easter", "advent", "christmas", "newyear"]);

/** The parts a server can switch off one by one (dashboard, "Saison-Deko"). */
export const SEASON_PARTS = Object.freeze([
  "panel",
  "voiceStatus",
  "adventCalendar",
  "eggHunt",
  "countdown",
  "newYearGreeting",
  "seasonStations",
]);

export const DEFAULT_SEASON_TIME_ZONE = "Europe/Vienna";

/** The looks the owner's test mode can force on chosen servers (owner console). */
export const SEASON_PREVIEWS = Object.freeze([
  { id: "easter-soon", season: "easter", phase: "soon", candles: 0 },
  { id: "easter-greeting", season: "easter", phase: "greeting", candles: 0 },
  { id: "advent-1", season: "advent", phase: "candles", candles: 1 },
  { id: "advent-2", season: "advent", phase: "candles", candles: 2 },
  { id: "advent-3", season: "advent", phase: "candles", candles: 3 },
  { id: "advent-4", season: "advent", phase: "candles", candles: 4 },
  { id: "christmas-greeting", season: "christmas", phase: "greeting", candles: 0 },
  { id: "christmas-winter", season: "christmas", phase: "winter", candles: 0 },
  { id: "newyear-countdown", season: "newyear", phase: "countdown", candles: 0 },
  { id: "newyear-greeting", season: "newyear", phase: "greeting", candles: 0 },
]);

const DAY_MS = 86_400_000;
const SNOWFLAKE = /^\d{17,22}$/;

/** Days since 1970-01-01 of a calendar date; plain date arithmetic, no time zone. */
function dayNumber(year, month, day) {
  return Math.floor(Date.UTC(year, month - 1, day) / DAY_MS);
}

function dateOfDay(days) {
  const date = new Date(days * DAY_MS);
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() };
}

/** Easter Sunday of a year (Gregorian calendar) as { year, month, day }. */
export function easterSunday(year) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return { year, month, day };
}

/** The first Sunday of Advent: the fourth Sunday before Christmas Day. */
export function firstAdventSunday(year) {
  const christmas = dayNumber(year, 12, 25);
  const weekday = new Date(christmas * DAY_MS).getUTCDay();
  const fourthAdvent = christmas - (weekday === 0 ? 7 : weekday);
  return dateOfDay(fourthAdvent - 21);
}

export function isValidTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try {
    Intl.DateTimeFormat("en-US", { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date and clock time of a moment in a time zone; an unknown zone counts as Vienna. */
export function localTime(moment = new Date(), timeZone = DEFAULT_SEASON_TIME_ZONE) {
  const zone = isValidTimeZone(timeZone) ? timeZone.trim() : DEFAULT_SEASON_TIME_ZONE;
  const date = moment instanceof Date ? moment : new Date(moment);
  const parts = Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(date);
  const value = (type) => Number(parts.find((part) => part.type === type)?.value);
  return {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour") % 24,
    minute: value("minute"),
    second: value("second"),
  };
}

function secondsToMidnight(local) {
  return 86_400 - (local.hour * 3600 + local.minute * 60 + local.second);
}

/**
 * @param {string} season
 * @param {string} phase
 * @param {{ candles?: number, year: number, countdown?: number | null }} details
 */
function state(season, phase, { candles = 0, year, countdown = null }) {
  return { season, phase, candles, year, secondsToMidnight: countdown };
}

/**
 * The season at a moment in a time zone, or null outside every season:
 * { season, phase, candles, year, secondsToMidnight }. For New Year, year is
 * the new year's number; secondsToMidnight only counts down on 31 December.
 */
export function seasonAt(moment = new Date(), timeZone = DEFAULT_SEASON_TIME_ZONE) {
  const local = localTime(moment, timeZone);
  const today = dayNumber(local.year, local.month, local.day);

  const easter = easterSunday(local.year);
  const easterDay = dayNumber(easter.year, easter.month, easter.day);
  if (today >= easterDay - 7 && today <= easterDay + 1) {
    return state("easter", today >= easterDay ? "greeting" : "soon", { year: local.year });
  }

  const advent = firstAdventSunday(local.year);
  const adventDay = dayNumber(advent.year, advent.month, advent.day);
  if (today >= adventDay && today <= dayNumber(local.year, 12, 23)) {
    const candles = Math.min(4, Math.floor((today - adventDay) / 7) + 1);
    return state("advent", "candles", { candles, year: local.year });
  }

  if (local.month === 12 && local.day >= 24 && local.day <= 30) {
    return state("christmas", local.day <= 26 ? "greeting" : "winter", { year: local.year });
  }
  if (local.month === 12 && local.day === 31) {
    return state("newyear", "countdown", { year: local.year + 1, countdown: secondsToMidnight(local) });
  }
  if (local.month === 1 && local.day === 1) {
    return state("newyear", "greeting", { year: local.year });
  }
  return null;
}

/** The next season to begin after today in the time zone: { season, year, month, day } of its first day. */
export function nextSeasonStart(moment = new Date(), timeZone = DEFAULT_SEASON_TIME_ZONE) {
  const local = localTime(moment, timeZone);
  const today = dayNumber(local.year, local.month, local.day);
  const starts = [];
  for (const year of [local.year, local.year + 1]) {
    const easter = easterSunday(year);
    const advent = firstAdventSunday(year);
    starts.push(
      { season: "easter", day: dayNumber(year, easter.month, easter.day) - 7 },
      { season: "advent", day: dayNumber(year, advent.month, advent.day) },
      { season: "christmas", day: dayNumber(year, 12, 24) },
      { season: "newyear", day: dayNumber(year, 12, 31) },
    );
  }
  const next = starts.filter((entry) => entry.day > today).sort((a, b) => a.day - b.day)[0];
  return { season: next.season, ...dateOfDay(next.day) };
}

/** One emoji for a season and phase (voice channel status, dashboard preview); "" outside a season. */
export function seasonEmoji(current) {
  if (!current) return "";
  if (current.season === "easter") return current.phase === "greeting" ? "🐣" : "🌷";
  if (current.season === "advent") return "🕯️";
  if (current.season === "christmas") return current.phase === "greeting" ? "🎄" : "❄️";
  if (current.season === "newyear") return current.phase === "countdown" ? "🎆" : "🥂";
  return "";
}

const allOn = (keys) => Object.fromEntries(keys.map((key) => [key, true]));

/** A server's switches (dashboard): every season and part on unless switched off. */
export function normalizeSeasonSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const seasons = allOn(SEASONS);
  const parts = allOn(SEASON_PARTS);
  for (const key of SEASONS) if (source.seasons?.[key] === false) seasons[key] = false;
  for (const key of SEASON_PARTS) if (source.parts?.[key] === false) parts[key] = false;
  return { seasons, parts };
}

/** The owner's switches: a main switch per season (on unless off) and the test mode. */
export function normalizeOwnerSeasons(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  const enabled = allOn(SEASONS);
  for (const key of SEASONS) if (source.enabled?.[key] === false) enabled[key] = false;
  const preview = SEASON_PREVIEWS.some((entry) => entry.id === source.test?.preview) ? source.test.preview : "";
  const ids = Array.isArray(source.test?.guildIds) ? source.test.guildIds : [];
  const guildIds = [...new Set(ids.map((id) => String(id ?? "").trim()).filter((id) => SNOWFLAKE.test(id)))].slice(0, 25);
  return { enabled, test: { preview, guildIds } };
}

/**
 * A look of the test mode (SEASON_PREVIEWS) as a season, whatever the date:
 * for the owner's test servers and the website's ?season= (#427); null for
 * an unknown look.
 */
export function seasonPreview(id, now = new Date(), timeZone = DEFAULT_SEASON_TIME_ZONE) {
  const preview = SEASON_PREVIEWS.find((entry) => entry.id === id);
  if (!preview) return null;
  const local = localTime(now, timeZone);
  return state(preview.season, preview.phase, {
    candles: preview.candles,
    // The look of the coming turn of the year; in January the one just passed.
    year: preview.season === "newyear" && local.month !== 1 ? local.year + 1 : local.year,
    countdown: preview.phase === "countdown" ? secondsToMidnight(local) : null,
  });
}

/**
 * What a server shows now, or null: the calendar in the server's time zone,
 * unless the owner or the server switched that season off. The owner's test
 * mode forces its look on the servers it names, whatever the date and the
 * season switches say; the parts still follow the server's switches.
 * @param {{ now?: Date, guildId?: string, timeZone?: string, server?: any, owner?: any }} [options]
 */
export function seasonForServer({ now = new Date(), guildId = "", timeZone = DEFAULT_SEASON_TIME_ZONE, server, owner } = {}) {
  const settings = normalizeSeasonSettings(server);
  const switches = normalizeOwnerSeasons(owner);
  const zone = isValidTimeZone(timeZone) ? timeZone.trim() : DEFAULT_SEASON_TIME_ZONE;
  const preview = switches.test.preview && switches.test.guildIds.includes(String(guildId))
    ? SEASON_PREVIEWS.find((entry) => entry.id === switches.test.preview)
    : null;

  let current;
  if (preview) {
    current = seasonPreview(preview.id, now, zone);
  } else {
    current = seasonAt(now, zone);
    if (!current || !switches.enabled[current.season] || !settings.seasons[current.season]) return null;
  }
  return { ...current, preview: Boolean(preview), timeZone: zone, parts: settings.parts };
}
