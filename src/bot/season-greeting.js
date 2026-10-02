// ============================================================
// OmniFM: the New Year greeting (#426)
// ============================================================
// At midnight, server time, one message with fireworks, into the channel the
// panel is in and only while OmniFM plays there. Once per server and year: a
// record in MongoDB is the lock, so two bots on one server never both greet,
// and without MongoDB nobody greets.
import * as ui from "../discord/ui/index.js";
import { localTime } from "../lib/seasons.js";
import { getDb, isConnected } from "../lib/db.js";
import { isRuntimePlaybackActive } from "./runtime-live-state.js";
import { SEASON_COLORS } from "./season-look.js";
import { botTranslator } from "../lib/bot-i18n.js";

/** The greeting goes out in the first minutes after midnight; a bot that starts later stays quiet. */
export const GREETING_WINDOW_MINUTES = 15;
export const GREETING_COLLECTION = "season_greetings";

/** New Year's Day, the first minutes after the server's midnight, the part on; the owner's test at once. */
export function isGreetingTime(season, now = new Date()) {
  if (!season || season.season !== "newyear" || season.phase !== "greeting") return false;
  if (season.parts?.newYearGreeting === false) return false;
  if (season.preview) return true;
  const local = localTime(now, season.timeZone);
  return local.month === 1 && local.day === 1 && local.hour === 0 && local.minute < GREETING_WINDOW_MINUTES;
}

/** The lock: true for the first try of a server and year, false for every later one. */
export async function claimGreeting(db, { guildId, year, preview = false }) {
  if (!db) return false;
  const id = `newyear:${guildId}:${year}${preview ? ":preview" : ""}`;
  try {
    await db.collection(GREETING_COLLECTION).insertOne({ _id: id, guildId, year, preview, sentAt: new Date() });
    return true;
  } catch (err) {
    if (err?.code === 11000) return false;
    throw err;
  }
}

export function buildNewYearGreeting({ year, t, appId = null }) {
  const fireworks = ui.icon("fireworks", appId);
  return ui.message(ui.container({
    accent: SEASON_COLORS.newyear,
    blocks: [
      ui.text([
        ui.heading(`🥂 ${t("Frohes neues Jahr {year}!", "Happy New Year {year}!", { year })}`),
        `${fireworks} ${t(
          "Danke, dass ihr mit OmniFM ins neue Jahr feiert. Auf ein Jahr voller guter Musik!",
          "Thanks for celebrating the new year with OmniFM. Here's to a year full of good music!",
        )} ${fireworks}`,
      ].join("\n")),
      ui.brandLine(),
    ],
  }));
}

/**
 * Sends the greeting if it is time, OmniFM plays and the channel is the
 * panel's; returns whether it went out.
 * @param {any} runtime
 * @param {{
 *   guildId?: string, channel?: any, season?: any, now?: Date, db?: any,
 *   isPlaying?: (runtime: any, guildId: string, state?: any) => boolean,
 * }} [options]
 */
export async function sendNewYearGreeting(runtime, {
  guildId,
  channel,
  season,
  now = new Date(),
  db = isConnected() ? getDb() : null,
  isPlaying = isRuntimePlaybackActive,
} = {}) {
  if (!channel?.id || typeof channel.send !== "function" || !isGreetingTime(season, now)) return false;
  const state = runtime?.guildState?.get?.(guildId) || null;
  if (!state || !isPlaying(runtime, guildId, state)) return false;
  if (String(state.nowPlayingChannelId || "") !== String(channel.id)) return false;
  if (!(await claimGreeting(db, { guildId, year: season.year, preview: season.preview === true }))) return false;
  const language = runtime.resolveGuildLanguage?.(guildId) || "en";
  const t = botTranslator(language);
  const appId = runtime.getApplicationId?.() || runtime.client?.application?.id || null;
  await channel.send({ ...buildNewYearGreeting({ year: season.year, t, appId }), allowedMentions: { parse: [] } });
  return true;
}
