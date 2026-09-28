// ============================================================
// OmniFM: the seasonal decoration in Discord (#426)
// ============================================================
// From a season of src/lib/seasons.js: the panel's colour and line, the
// emoji of the voice channel status and the bot's status text. Plain data
// in and out, so every season is tested with a made-up date; the runtime
// only asks which season a server has (serverSeason) and passes it on.
import * as ui from "../discord/ui/index.js";
import { seasonEmoji, seasonForServer } from "../lib/seasons.js";
import { ownerSettings } from "../lib/owner-settings-cache.js";

/** The panel's accent per look; a colour the server picked itself (#281) still wins. */
export const SEASON_COLORS = Object.freeze({
  easter: 0xA3E635,
  halloween: 0xF97316,
  advent: 0x15803D,
  christmas: 0xDC2626,
  winter: 0x7DD3FC,
  newyear: 0xFBBF24,
});

const ADVENT_EN = ["Advent, week 1", "Advent, week 2", "Advent, week 3", "Advent, week 4"];

/** What a server shows now, from its cached settings and the owner's switches; null outside a season. */
export function serverSeason(guildId, settings, now = new Date()) {
  return seasonForServer({
    now,
    guildId,
    timeZone: settings?.timeZone || undefined,
    server: settings?.seasonDecor,
    owner: ownerSettings()?.seasons,
  });
}

/** The bot's status is the same on every server: Vienna time, only the owner's main switches. */
export function globalSeason(now = new Date()) {
  return seasonForServer({ now, owner: { enabled: ownerSettings()?.seasons?.enabled } });
}

/** What changes the panel's look, so the panel is drawn again when it changes. */
export function seasonSignature(season) {
  if (!season) return "";
  return [season.season, season.phase, season.candles, season.year, season.parts?.panel !== false, season.parts?.countdown !== false].join(":");
}

/**
 * The panel's colour and top line, or null when the panel part is off.
 * @param {object} season  from seasonForServer
 * @param {{ t: (de: string, en: string) => string, appId?: string|null, nowMs?: number }} options
 */
export function seasonPanelLook(season, { t, appId = null, nowMs = Date.now() }) {
  if (!season || season.parts?.panel === false) return null;
  const icon = (name) => ui.icon(name, appId);
  if (season.season === "easter") {
    return season.phase === "greeting"
      ? { color: SEASON_COLORS.easter, line: `${icon("egg")} **${t("Frohe Ostern", "Happy Easter")}** 🌷` }
      : { color: SEASON_COLORS.easter, line: `🌷 **${t("Bald ist Ostern", "Easter is coming")}**` };
  }
  if (season.season === "halloween") {
    return season.phase === "greeting"
      ? { color: SEASON_COLORS.halloween, line: `${icon("pumpkin")} **${t("Happy Halloween!", "Happy Halloween!")}** ${icon("spider")}` }
      : { color: SEASON_COLORS.halloween, line: `🕸️ **${t("Bald ist Halloween", "Halloween is coming")}** ${icon("spider")}` };
  }
  if (season.season === "advent") {
    const lit = Math.max(1, Math.min(4, season.candles || 1));
    const candles = `${icon("candle").repeat(lit)}${icon("candle_off").repeat(4 - lit)}`;
    return { color: SEASON_COLORS.advent, line: `${candles} **${t(`${lit}. Advent`, ADVENT_EN[lit - 1])}**` };
  }
  if (season.season === "christmas") {
    return season.phase === "greeting"
      ? { color: SEASON_COLORS.christmas, line: `🎄 **${t("Frohe Weihnachten", "Merry Christmas")}** ${icon("snowflake")}` }
      : { color: SEASON_COLORS.winter, line: `${icon("snowflake")} ${icon("snowflake")} ${icon("snowflake")}` };
  }
  if (season.season === "newyear") {
    if (season.phase === "countdown") {
      // Discord counts down by itself: <t:…:R> reads "in 3 hours" in each reader's language.
      if (season.parts?.countdown === false || !Number.isFinite(season.secondsToMidnight)) return { color: SEASON_COLORS.newyear, line: null };
      const midnight = Math.floor(nowMs / 1000) + season.secondsToMidnight;
      return {
        color: SEASON_COLORS.newyear,
        line: `${icon("fireworks")} **${t(`${season.year} beginnt <t:${midnight}:R>`, `${season.year} starts <t:${midnight}:R>`)}**`,
      };
    }
    return {
      color: SEASON_COLORS.newyear,
      line: `🥂 **${t(`Frohes neues Jahr ${season.year}!`, `Happy New Year ${season.year}!`)}** ${icon("fireworks")}`,
    };
  }
  return null;
}

/** The emoji in front of the voice channel status (Unicode: the status shows no app emojis), or "". */
export function seasonVoiceEmoji(season) {
  if (!season || season.parts?.voiceStatus === false) return "";
  return seasonEmoji(season);
}

/** The bot's status with the season in front: "🎄 Merry Christmas · …"; the same on every server. */
export function withSeasonPresence(activity, season) {
  if (!activity?.name || !season) return activity;
  const prefix = {
    easter: season.phase === "greeting" ? "🐣 Happy Easter" : "🌷",
    halloween: season.phase === "greeting" ? "🎃 Happy Halloween" : "🕸️",
    advent: "🕯️ Advent",
    christmas: season.phase === "greeting" ? "🎄 Merry Christmas" : "❄️",
    newyear: season.phase === "greeting" ? `🥂 Happy New Year ${season.year}` : "🎆 New Year's Eve",
  }[season.season];
  if (!prefix) return activity;
  const name = `${prefix} · ${activity.name}`;
  return { ...activity, name: name.length > 120 ? `${name.slice(0, 119)}…` : name };
}
