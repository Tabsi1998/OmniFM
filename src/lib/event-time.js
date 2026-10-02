// ============================================================
// OmniFM: Event Scheduling Time Functions
// ============================================================
import {
  GuildScheduledEventRecurrenceRuleFrequency,
  GuildScheduledEventRecurrenceRuleMonth,
  GuildScheduledEventRecurrenceRuleWeekday,
} from "discord.js";
import { normalizeLanguage, getDefaultLanguage } from "../i18n.js";
import { languagePick } from "./language.js";
import { botLocale, normalizeBotLanguage } from "./bot-i18n.js";

const REPEAT_MODES = new Set([
  "none",
  "daily",
  "weekdays",
  "weekly",
  "biweekly",
  "yearly",
  "monthly_first_weekday",
  "monthly_second_weekday",
  "monthly_third_weekday",
  "monthly_fourth_weekday",
  "monthly_last_weekday",
]);

const MONTHLY_REPEAT_NTH = Object.freeze({
  monthly_first_weekday: 1,
  monthly_second_weekday: 2,
  monthly_third_weekday: 3,
  monthly_fourth_weekday: 4,
  monthly_last_weekday: -1,
});

const EVENT_TIME_ZONE_ALIASES = Object.freeze({
  UTC: "UTC",
  GMT: "UTC",
  CET: "Europe/Berlin",
  CEST: "Europe/Berlin",
  MEZ: "Europe/Berlin",
  MESZ: "Europe/Berlin",
  BERLIN: "Europe/Berlin",
  VIENNA: "Europe/Vienna",
  WIEN: "Europe/Vienna",
});

const EVENT_TIME_ZONE_SUGGESTIONS = [
  // Häufigste (Top 20) mit Emojis für bessere Lesbarkeit
  { label: "🇩🇪 Europe/Berlin (CET)", value: "Europe/Berlin" },
  { label: "🌍 UTC / GMT", value: "UTC" },
  { label: "🇺🇸 America/New_York (EST)", value: "America/New_York" },
  { label: "🇺🇸 America/Los_Angeles (PST)", value: "America/Los_Angeles" },
  { label: "🇬🇧 Europe/London (GMT)", value: "Europe/London" },
  { label: "🇦🇹 Europe/Vienna", value: "Europe/Vienna" },
  { label: "🇨🇭 Europe/Zurich", value: "Europe/Zurich" },
  { label: "🇫🇷 Europe/Paris", value: "Europe/Paris" },
  { label: "🇮🇹 Europe/Rome", value: "Europe/Rome" },
  { label: "🇪🇸 Europe/Madrid", value: "Europe/Madrid" },
  { label: "🇸🇪 Europe/Stockholm", value: "Europe/Stockholm" },
  { label: "🇨🇦 America/Toronto", value: "America/Toronto" },
  { label: "🇺🇸 America/Chicago", value: "America/Chicago" },
  { label: "🇲🇽 America/Mexico_City", value: "America/Mexico_City" },
  { label: "🇧🇷 America/Sao_Paulo", value: "America/Sao_Paulo" },
  { label: "🇦🇪 Asia/Dubai", value: "Asia/Dubai" },
  { label: "🇮🇳 Asia/Kolkata", value: "Asia/Kolkata" },
  { label: "🇹🇭 Asia/Bangkok", value: "Asia/Bangkok" },
  { label: "🇨🇳 Asia/Shanghai", value: "Asia/Shanghai" },
  { label: "🇯🇵 Asia/Tokyo", value: "Asia/Tokyo" },
  { label: "🇦🇺 Australia/Sydney", value: "Australia/Sydney" },
];

// Alle ~400 IANA Zeitzonen gruppiert nach Region (kostenlos via Intl API)
function getGroupedTimeZones() {
  const allZones = Intl.supportedValuesOf('timeZone');
  const grouped = {};
  
  allZones.forEach(zone => {
    const region = zone.split('/')[0]; // "Europe", "America", etc.
    if (!grouped[region]) grouped[region] = [];
    grouped[region].push(zone);
  });
  
  return grouped;
}

function canonicalizeTimeZone(rawTimeZone) {
  const raw = String(rawTimeZone || "").trim();
  if (!raw) return null;

  const aliasKey = raw.replace(/\s+/g, "").toUpperCase();
  const alias = EVENT_TIME_ZONE_ALIASES[aliasKey];
  const candidate = String(alias || raw).replace(/\s+/g, "_");
  if (!candidate) return null;

  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: candidate }).resolvedOptions().timeZone || candidate;
  } catch {
    return null;
  }
}

const EVENT_FALLBACK_TIME_ZONE =
  canonicalizeTimeZone(process.env.EVENT_DEFAULT_TIMEZONE)
  || canonicalizeTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone)
  || "UTC";

function normalizeEventTimeZone(rawTimeZone, fallback = EVENT_FALLBACK_TIME_ZONE) {
  const raw = String(rawTimeZone || "").trim();
  if (!raw) return fallback;
  return canonicalizeTimeZone(raw);
}

function getZonedPartsFromUtcMs(utcMs, timeZone) {
  const tz = normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    hour12: false,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });

  const rawParts = formatter.formatToParts(new Date(utcMs));
  const map = {};
  for (const part of rawParts) {
    if (part.type === "literal") continue;
    map[part.type] = part.value;
  }

  return {
    year: Number.parseInt(map.year || "0", 10),
    month: Number.parseInt(map.month || "0", 10),
    day: Number.parseInt(map.day || "0", 10),
    hour: Number.parseInt(map.hour || "0", 10),
    minute: Number.parseInt(map.minute || "0", 10),
    second: Number.parseInt(map.second || "0", 10),
  };
}

function getTimeZoneOffsetMs(utcMs, timeZone) {
  const zoned = getZonedPartsFromUtcMs(utcMs, timeZone);
  const asUtc = Date.UTC(zoned.year, zoned.month - 1, zoned.day, zoned.hour, zoned.minute, zoned.second, 0);
  return asUtc - utcMs;
}

function zonedDateTimeToUtcMs(parts, timeZone) {
  const guessUtcMs = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second || 0, 0);
  let offset = getTimeZoneOffsetMs(guessUtcMs, timeZone);
  let resolvedUtcMs = guessUtcMs - offset;
  const nextOffset = getTimeZoneOffsetMs(resolvedUtcMs, timeZone);
  if (offset !== nextOffset) {
    resolvedUtcMs = guessUtcMs - nextOffset;
  }
  return resolvedUtcMs;
}

function getWeekdayIndexInTimeZone(utcMs, timeZone) {
  const tz = normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  const short = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(new Date(utcMs));
  const key = String(short || "").toLowerCase().replace(/[^a-z]/g, "").slice(0, 3);
  const map = { sun: 0, mon: 1, tue: 2, wed: 3, thu: 4, fri: 5, sat: 6 };
  return map[key] ?? new Date(utcMs).getUTCDay();
}

function getWeekdayName(utcMs, language = "de", timeZone = EVENT_FALLBACK_TIME_ZONE) {
  const locale = botLocale(normalizeBotLanguage(language, getDefaultLanguage()));
  const tz = normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  return new Intl.DateTimeFormat(locale, { timeZone: tz, weekday: "long" }).format(new Date(utcMs));
}

function addDaysCalendar(year, month, day, dayDelta) {
  const next = new Date(Date.UTC(year, month - 1, day + dayDelta, 12, 0, 0, 0));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
    day: next.getUTCDate(),
  };
}

function addMonthsYearMonth(year, month, monthDelta) {
  const next = new Date(Date.UTC(year, month - 1 + monthDelta, 1, 0, 0, 0, 0));
  return {
    year: next.getUTCFullYear(),
    month: next.getUTCMonth() + 1,
  };
}

function getDaysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0, 0, 0, 0, 0)).getUTCDate();
}

function nthWeekdayOfMonth(year, month, weekdayIndex, nth) {
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1, 0, 0, 0, 0)).getUTCDay();
  const firstTargetDay = 1 + ((7 + weekdayIndex - firstWeekday) % 7);
  const day = firstTargetDay + ((nth - 1) * 7);
  return day <= getDaysInMonth(year, month) ? day : null;
}

function lastWeekdayOfMonth(year, month, weekdayIndex) {
  const maxDay = getDaysInMonth(year, month);
  const lastWeekday = new Date(Date.UTC(year, month - 1, maxDay, 0, 0, 0, 0)).getUTCDay();
  return maxDay - ((7 + lastWeekday - weekdayIndex) % 7);
}

function validateCalendarDate(year, month, day, hour = 0, minute = 0) {
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return false;
  }
  const parsed = new Date(Date.UTC(year, month - 1, day, hour, minute, 0, 0));
  return parsed.getUTCFullYear() === year
    && parsed.getUTCMonth() === (month - 1)
    && parsed.getUTCDate() === day
    && parsed.getUTCHours() === hour
    && parsed.getUTCMinutes() === minute;
}

function parseEventDateInput(rawInput, language = "de", timeZone = EVENT_FALLBACK_TIME_ZONE, nowMs = Date.now()) {
  const raw = String(rawInput || "").trim();
  if (!raw) {
    return {
      ok: false,
      message: languagePick(language, "Datum fehlt.", "Date is missing."),
    };
  }

  const lowered = raw.toLowerCase();
  if (["today", "heute"].includes(lowered)) {
    const zoned = getZonedPartsFromUtcMs(nowMs, timeZone);
    return { ok: true, year: zoned.year, month: zoned.month, day: zoned.day };
  }
  if (["tomorrow", "morgen"].includes(lowered)) {
    const zoned = getZonedPartsFromUtcMs(nowMs, timeZone);
    const next = addDaysCalendar(zoned.year, zoned.month, zoned.day, 1);
    return { ok: true, year: next.year, month: next.month, day: next.day };
  }

  const normalized = raw.replace(/\//g, ".").replace(/-/g, ".");
  let year;
  let month;
  let day;

  let match = normalized.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (match) {
    day = Number.parseInt(match[1], 10);
    month = Number.parseInt(match[2], 10);
    year = Number.parseInt(match[3], 10);
  } else {
    match = normalized.match(/^(\d{4})\.(\d{1,2})\.(\d{1,2})$/);
    if (!match) {
      return {
        ok: false,
        message: languagePick(
          language,
          "Ungültiges Datumsformat. Nutze `DD.MM.YYYY`, `YYYY-MM-DD`, `heute` oder `morgen`.",
          "Invalid date format. Use `DD.MM.YYYY`, `YYYY-MM-DD`, `today`, or `tomorrow`."
        ),
      };
    }

    year = Number.parseInt(match[1], 10);
    const first = Number.parseInt(match[2], 10);
    const second = Number.parseInt(match[3], 10);

    if (first > 12 && second <= 12) {
      day = first;
      month = second;
    } else {
      month = first;
      day = second;
    }
  }

  if (!validateCalendarDate(year, month, day)) {
    return {
      ok: false,
      message: languagePick(language, "Datum ist ungültig.", "Date is invalid."),
    };
  }

  return { ok: true, year, month, day };
}

function parseEventTimeInput(rawInput, language = "de") {
  const raw = String(rawInput || "").trim();
  if (!raw) {
    return {
      ok: false,
      message: languagePick(language, "Uhrzeit fehlt.", "Time is missing."),
    };
  }

  const match = raw.match(/^(\d{1,2})[:.](\d{2})$/);
  if (!match) {
    return {
      ok: false,
      message: languagePick(language, "Ungültige Uhrzeit. Nutze `HH:MM`.", "Invalid time. Use `HH:MM`."),
    };
  }

  const hour = Number.parseInt(match[1], 10);
  const minute = Number.parseInt(match[2], 10);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return {
      ok: false,
      message: languagePick(language, "Uhrzeit ist ungültig.", "Time is invalid."),
    };
  }

  return { ok: true, hour, minute };
}

function buildEventDateTimeFromParts({
  rawDateTime = "",
  rawDate = "",
  rawTime = "",
  language = "de",
  preferredTimeZone = "",
  fallbackRunAtMs = 0,
  nowMs = Date.now(),
} = {}) {
  const timeZone = normalizeEventTimeZone(preferredTimeZone, EVENT_FALLBACK_TIME_ZONE);
  if (!timeZone) {
    return {
      ok: false,
      message: languagePick(
        language,
        "Zeitzone ungültig. Beispiele: `Europe/Berlin`, `Europe/Vienna`, `CET`, `MEZ`, `UTC`.",
        "Invalid time zone. Examples: `Europe/Berlin`, `Europe/Vienna`, `CET`, `MEZ`, `UTC`."
      ),
    };
  }

  const combined = String(rawDateTime || "").trim();
  if (combined) {
    const normalized = combined.replace("T", " ");
    const pieces = normalized.split(/\s+/).filter(Boolean);
    if (pieces.length === 1) {
      return buildEventDateTimeFromParts({
        rawTime: pieces[0],
        language,
        preferredTimeZone: timeZone,
        fallbackRunAtMs,
        nowMs,
      });
    }
    const tzCandidate = pieces.length >= 3 ? pieces[pieces.length - 1] : "";
    const hasInlineTimeZone = Boolean(tzCandidate && /[A-Za-z/_+-]/.test(tzCandidate));
    const timeToken = hasInlineTimeZone ? pieces[pieces.length - 2] : pieces[pieces.length - 1];
    const dateToken = pieces.slice(0, hasInlineTimeZone ? -2 : -1).join(" ");
    if (!dateToken || !timeToken) {
      return {
        ok: false,
        message: languagePick(
          language,
          "Ungültiges Format. Nutze `DD.MM.YYYY HH:MM` oder `YYYY-MM-DD HH:MM`.",
          "Invalid format. Use `DD.MM.YYYY HH:MM` or `YYYY-MM-DD HH:MM`."
        ),
      };
    }

    const parsedDate = parseEventDateInput(dateToken, language, timeZone, nowMs);
    if (!parsedDate.ok) return parsedDate;
    const parsedTime = parseEventTimeInput(timeToken, language);
    if (!parsedTime.ok) return parsedTime;
    const inlineTimeZone = normalizeEventTimeZone(hasInlineTimeZone ? tzCandidate : "", timeZone) || timeZone;
    const runAtMs = zonedDateTimeToUtcMs({
      year: parsedDate.year,
      month: parsedDate.month,
      day: parsedDate.day,
      hour: parsedTime.hour,
      minute: parsedTime.minute,
      second: 0,
    }, inlineTimeZone);
    const roundTrip = getZonedPartsFromUtcMs(runAtMs, inlineTimeZone);
    if (
      roundTrip.year !== parsedDate.year
      || roundTrip.month !== parsedDate.month
      || roundTrip.day !== parsedDate.day
      || roundTrip.hour !== parsedTime.hour
      || roundTrip.minute !== parsedTime.minute
    ) {
      return {
        ok: false,
        message: languagePick(
          language,
          "Die Uhrzeit ist in dieser Zeitzone ungültig (z.B. DST-Umstellung). Bitte andere Uhrzeit wählen.",
          "That local time is invalid in this time zone (for example DST transition). Please choose another time."
        ),
      };
    }

    return { ok: true, runAtMs, timeZone: inlineTimeZone, parsed: new Date(runAtMs) };
  }

  const trimmedDate = String(rawDate || "").trim();
  const trimmedTime = String(rawTime || "").trim();
  if (!trimmedDate && !trimmedTime) {
    return {
      ok: false,
      message: languagePick(language, "Startzeit fehlt oder ist ungültig.", "Start time is missing or invalid."),
    };
  }

  let parsedDate;
  if (trimmedDate) {
    parsedDate = parseEventDateInput(trimmedDate, language, timeZone, nowMs);
    if (!parsedDate.ok) return parsedDate;
  } else if (trimmedTime) {
    const fallbackBase = Number.isFinite(Number(fallbackRunAtMs)) && Number(fallbackRunAtMs) > 0 ? Number(fallbackRunAtMs) : nowMs;
    const zoned = getZonedPartsFromUtcMs(fallbackBase, timeZone);
    parsedDate = { ok: true, year: zoned.year, month: zoned.month, day: zoned.day };
  }

  const parsedTime = parseEventTimeInput(trimmedTime, language);
  if (!parsedTime.ok) return parsedTime;

  let runAtMs = zonedDateTimeToUtcMs({
    year: parsedDate.year,
    month: parsedDate.month,
    day: parsedDate.day,
    hour: parsedTime.hour,
    minute: parsedTime.minute,
    second: 0,
  }, timeZone);

  if (!trimmedDate) {
    if (runAtMs < (nowMs - 60_000)) {
      const nextDate = addDaysCalendar(parsedDate.year, parsedDate.month, parsedDate.day, 1);
      runAtMs = zonedDateTimeToUtcMs({
        year: nextDate.year,
        month: nextDate.month,
        day: nextDate.day,
        hour: parsedTime.hour,
        minute: parsedTime.minute,
        second: 0,
      }, timeZone);
    } else if (Math.abs(runAtMs - nowMs) <= 60_000) {
      runAtMs = nowMs;
    }
  }

  return { ok: true, runAtMs, timeZone, parsed: new Date(runAtMs) };
}

function parseEventStartDateTime(rawInput, language = "de", preferredTimeZone = "") {
  const raw = String(rawInput || "").trim();
  if (!raw) {
    return {
      ok: false,
      message: languagePick(language, "Zeit fehlt.", "Time is missing."),
    };
  }

  return buildEventDateTimeFromParts({
    rawDateTime: raw,
    language,
    preferredTimeZone,
  });
}

function formatDateTime(ms, language = "de", timeZone = null) {
  const value = Number.parseInt(String(ms || ""), 10);
  if (!Number.isFinite(value) || value <= 0) return "-";
  const locale = botLocale(normalizeBotLanguage(language, getDefaultLanguage()));
  const tz = normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  return new Date(value).toLocaleString(locale, {
    timeZone: tz,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function normalizeRepeatMode(raw) {
  const repeat = String(raw || "none").trim().toLowerCase();
  if (REPEAT_MODES.has(repeat)) return repeat;
  return "none";
}

function formatOrdinal(value, language = "de") {
  const number = Number.parseInt(String(value || 0), 10);
  if (!Number.isFinite(number) || number <= 0) return String(value || "");
  if (normalizeLanguage(language, getDefaultLanguage()) === "de") return `${number}.`;
  const mod10 = number % 10;
  const mod100 = number % 100;
  if (mod10 === 1 && mod100 !== 11) return `${number}st`;
  if (mod10 === 2 && mod100 !== 12) return `${number}nd`;
  if (mod10 === 3 && mod100 !== 13) return `${number}rd`;
  return `${number}th`;
}

function formatMonthDay(utcMs, language = "de", timeZone = EVENT_FALLBACK_TIME_ZONE) {
  if (!Number.isFinite(Number(utcMs)) || Number(utcMs) <= 0) return null;
  const locale = botLocale(normalizeBotLanguage(language, getDefaultLanguage()));
  return new Intl.DateTimeFormat(locale, {
    timeZone: normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE,
    day: "numeric",
    month: "long",
  }).format(new Date(Number(utcMs)));
}

function mapJsWeekdayToDiscordWeekday(weekdayIndex) {
  switch (Number(weekdayIndex)) {
    case 0: return GuildScheduledEventRecurrenceRuleWeekday.Sunday;
    case 1: return GuildScheduledEventRecurrenceRuleWeekday.Monday;
    case 2: return GuildScheduledEventRecurrenceRuleWeekday.Tuesday;
    case 3: return GuildScheduledEventRecurrenceRuleWeekday.Wednesday;
    case 4: return GuildScheduledEventRecurrenceRuleWeekday.Thursday;
    case 5: return GuildScheduledEventRecurrenceRuleWeekday.Friday;
    case 6: return GuildScheduledEventRecurrenceRuleWeekday.Saturday;
    default: return GuildScheduledEventRecurrenceRuleWeekday.Monday;
  }
}

function isWorkdayInTimeZone(utcMs, timeZone = EVENT_FALLBACK_TIME_ZONE) {
  const weekdayIndex = getWeekdayIndexInTimeZone(utcMs, timeZone);
  return weekdayIndex >= 1 && weekdayIndex <= 5;
}

function buildDiscordScheduledEventRecurrenceRule(runAtMs, repeat, timeZone = null) {
  const base = Number.parseInt(String(runAtMs || ""), 10);
  const mode = normalizeRepeatMode(repeat);
  if (!Number.isFinite(base) || base <= 0 || mode === "none") return null;

  const tz = normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  const baseParts = getZonedPartsFromUtcMs(base, tz);
  const weekday = mapJsWeekdayToDiscordWeekday(getWeekdayIndexInTimeZone(base, tz));
  const allWeekdays = [
    GuildScheduledEventRecurrenceRuleWeekday.Monday,
    GuildScheduledEventRecurrenceRuleWeekday.Tuesday,
    GuildScheduledEventRecurrenceRuleWeekday.Wednesday,
    GuildScheduledEventRecurrenceRuleWeekday.Thursday,
    GuildScheduledEventRecurrenceRuleWeekday.Friday,
    GuildScheduledEventRecurrenceRuleWeekday.Saturday,
    GuildScheduledEventRecurrenceRuleWeekday.Sunday,
  ];
  const workdays = [
    GuildScheduledEventRecurrenceRuleWeekday.Monday,
    GuildScheduledEventRecurrenceRuleWeekday.Tuesday,
    GuildScheduledEventRecurrenceRuleWeekday.Wednesday,
    GuildScheduledEventRecurrenceRuleWeekday.Thursday,
    GuildScheduledEventRecurrenceRuleWeekday.Friday,
  ];

  if (mode === "daily") {
    return {
      startAt: new Date(base),
      frequency: GuildScheduledEventRecurrenceRuleFrequency.Daily,
      interval: 1,
      byWeekday: allWeekdays,
    };
  }
  if (mode === "weekdays") {
    return {
      startAt: new Date(base),
      frequency: GuildScheduledEventRecurrenceRuleFrequency.Daily,
      interval: 1,
      byWeekday: workdays,
    };
  }
  if (mode === "weekly" || mode === "biweekly") {
    return {
      startAt: new Date(base),
      frequency: GuildScheduledEventRecurrenceRuleFrequency.Weekly,
      interval: mode === "biweekly" ? 2 : 1,
      byWeekday: [weekday],
    };
  }
  if (mode === "yearly") {
    return {
      startAt: new Date(base),
      frequency: GuildScheduledEventRecurrenceRuleFrequency.Yearly,
      interval: 1,
      byMonth: [baseParts.month || GuildScheduledEventRecurrenceRuleMonth.January],
      byMonthDay: [baseParts.day || 1],
    };
  }

  const monthlyNth = MONTHLY_REPEAT_NTH[mode];
  if (monthlyNth) {
    return {
      startAt: new Date(base),
      frequency: GuildScheduledEventRecurrenceRuleFrequency.Monthly,
      interval: 1,
      byNWeekday: [{ n: monthlyNth, day: weekday }],
    };
  }

  return null;
}

function getRepeatLabel(raw, language = "de", { runAtMs = null, timeZone = null } = {}) {
  const repeat = normalizeRepeatMode(raw);
  const isDe = normalizeLanguage(language, getDefaultLanguage()) === "de";
  const weekday = Number.isFinite(Number(runAtMs)) && Number(runAtMs) > 0
    ? getWeekdayName(Number(runAtMs), language, timeZone || EVENT_FALLBACK_TIME_ZONE)
    : null;
  const monthDay = formatMonthDay(runAtMs, language, timeZone || EVENT_FALLBACK_TIME_ZONE);

  if (repeat === "daily") return isDe ? "Jeden Tag" : "Every day";
  if (repeat === "weekdays") return isDe ? "Werktäglich (Montag bis Freitag)" : "Weekdays (Monday to Friday)";
  if (repeat === "weekly") {
    return weekday
      ? (isDe ? `Jeden ${weekday}` : `Every ${weekday}`)
      : (isDe ? "Wöchentlich" : "Weekly");
  }
  if (repeat === "biweekly") {
    return weekday
      ? (isDe ? `Alle 2 Wochen (${weekday})` : `Every 2 weeks (${weekday})`)
      : (isDe ? "Alle 2 Wochen" : "Every 2 weeks");
  }
  if (repeat === "monthly_first_weekday") return isDe ? `Jeden ${formatOrdinal(1, language)} ${weekday || "Wochentag"} im Monat` : `Every ${formatOrdinal(1, language)} ${weekday || "weekday"} of the month`;
  if (repeat === "monthly_second_weekday") return isDe ? `Jeden ${formatOrdinal(2, language)} ${weekday || "Wochentag"} im Monat` : `Every ${formatOrdinal(2, language)} ${weekday || "weekday"} of the month`;
  if (repeat === "monthly_third_weekday") return isDe ? `Jeden ${formatOrdinal(3, language)} ${weekday || "Wochentag"} im Monat` : `Every ${formatOrdinal(3, language)} ${weekday || "weekday"} of the month`;
  if (repeat === "monthly_fourth_weekday") return isDe ? `Jeden ${formatOrdinal(4, language)} ${weekday || "Wochentag"} im Monat` : `Every ${formatOrdinal(4, language)} ${weekday || "weekday"} of the month`;
  if (repeat === "monthly_last_weekday") return isDe ? `Jeden letzten ${weekday || "Wochentag"} im Monat` : `Every last ${weekday || "weekday"} of the month`;
  if (repeat === "yearly") {
    return monthDay
      ? (isDe ? `Jährlich am ${monthDay}` : `Yearly on ${monthDay}`)
      : (isDe ? "Jährlich" : "Yearly");
  }
  return isDe ? "Einmalig" : "Once";
}

function computeNextEventRunAtMs(runAtMs, repeat, nowMs = Date.now(), timeZone = null) {
  const base = Number.parseInt(String(runAtMs || ""), 10);
  if (!Number.isFinite(base) || base <= 0) return null;

  const mode = normalizeRepeatMode(repeat);
  if (mode === "none") return null;

  const tz = normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  const baseParts = getZonedPartsFromUtcMs(base, tz);
  const baseClock = {
    hour: baseParts.hour,
    minute: baseParts.minute,
    second: 0,
  };

  if (mode === "daily" || mode === "weekdays" || mode === "weekly" || mode === "biweekly") {
    const stepDays = mode === "weekly" ? 7 : mode === "biweekly" ? 14 : 1;
    let cursor = { year: baseParts.year, month: baseParts.month, day: baseParts.day };
    let next = base;
    for (let i = 0; i < 5000; i += 1) {
      const isWorkdayCandidate = mode !== "weekdays" || isWorkdayInTimeZone(next, tz);
      if (next > nowMs && isWorkdayCandidate) {
        return next;
      }
      cursor = addDaysCalendar(cursor.year, cursor.month, cursor.day, stepDays);
      next = zonedDateTimeToUtcMs({ ...cursor, ...baseClock }, tz);
    }
    return null;
  }

  if (mode === "yearly") {
    for (let year = baseParts.year; year < baseParts.year + 400; year += 1) {
      if (!validateCalendarDate(year, baseParts.month, baseParts.day, baseClock.hour, baseClock.minute)) {
        continue;
      }
      const next = zonedDateTimeToUtcMs({
        year,
        month: baseParts.month,
        day: baseParts.day,
        ...baseClock,
      }, tz);
      if (next > nowMs) return next;
    }
    return null;
  }

  const monthlyNth = MONTHLY_REPEAT_NTH[mode];
  if (!monthlyNth) return null;

  const weekdayIndex = getWeekdayIndexInTimeZone(base, tz);
  let monthCursor = addMonthsYearMonth(baseParts.year, baseParts.month, 1);
  for (let i = 0; i < 2400; i += 1) {
    const targetDay = monthlyNth === -1
      ? lastWeekdayOfMonth(monthCursor.year, monthCursor.month, weekdayIndex)
      : nthWeekdayOfMonth(monthCursor.year, monthCursor.month, weekdayIndex, monthlyNth);
    if (targetDay) {
      const next = zonedDateTimeToUtcMs({
        year: monthCursor.year,
        month: monthCursor.month,
        day: targetDay,
        ...baseClock,
      }, tz);
      if (next > nowMs) return next;
    }
    monthCursor = addMonthsYearMonth(monthCursor.year, monthCursor.month, 1);
  }
  return null;
}

function renderEventAnnouncement(template, values, language = "de") {
  const fallback = languagePick(
    language,
    "Event **{event}** startet jetzt: **{station}** in {voice}.",
    "Event **{event}** is starting now: **{station}** in {voice}."
  );
  const base = String(template || "").trim() || fallback;
  return base
    .replace(/\{event\}/gi, String(values?.event || "-"))
    .replace(/\{station\}/gi, String(values?.station || "-"))
    .replace(/\{voice\}/gi, String(values?.voice || "-"))
    .replace(/\{time\}/gi, String(values?.time || "-"))
    .replace(/\{end\}/gi, String(values?.end || "-"))
    .replace(/\{timezone\}/gi, String(values?.timeZone || values?.timezone || "-"))
    .trim();
}

function renderStageTopic(template, values) {
  const base = String(template || "").trim() || "{event} - {station}";
  return base
    .replace(/\{event\}/gi, String(values?.event || "-"))
    .replace(/\{station\}/gi, String(values?.station || "-"))
    .replace(/\{time\}/gi, String(values?.time || "-"))
    .replace(/\{end\}/gi, String(values?.end || "-"))
    .replace(/\{timezone\}/gi, String(values?.timeZone || values?.timezone || "-"))
    .trim();
}

// Alle Zeitzonen gruppiert abrufen (für Advanced Users)
function getAllTimeZonesGrouped() {
  return getGroupedTimeZones();
}

// Validierung: Checkt ob Timezone korrekt ist
function isValidTimeZone(tz) {
  if (!tz || typeof tz !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export {
  REPEAT_MODES,
  MONTHLY_REPEAT_NTH,
  EVENT_TIME_ZONE_ALIASES,
  EVENT_TIME_ZONE_SUGGESTIONS,
  EVENT_FALLBACK_TIME_ZONE,
  canonicalizeTimeZone,
  normalizeEventTimeZone,
  getZonedPartsFromUtcMs,
  getTimeZoneOffsetMs,
  zonedDateTimeToUtcMs,
  getWeekdayIndexInTimeZone,
  getWeekdayName,
  addDaysCalendar,
  addMonthsYearMonth,
  getDaysInMonth,
  nthWeekdayOfMonth,
  lastWeekdayOfMonth,
  parseEventDateInput,
  parseEventTimeInput,
  buildEventDateTimeFromParts,
  parseEventStartDateTime,
  formatDateTime,
  normalizeRepeatMode,
  getRepeatLabel,
  isWorkdayInTimeZone,
  buildDiscordScheduledEventRecurrenceRule,
  computeNextEventRunAtMs,
  renderEventAnnouncement,
  renderStageTopic,
  getGroupedTimeZones,
  getAllTimeZonesGrouped,
  isValidTimeZone,
};
