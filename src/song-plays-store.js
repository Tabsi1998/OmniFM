// ============================================================
// OmniFM: how often a song ran on a server, per day (#278)
// ============================================================
// Feeds "top songs of the week" in the weekly digest, the charts and the
// months of the year review (#301). One document per server, day and song
// with a counter; no person is stored. MongoDB drops the documents after 45
// days on its own (TTL index on `day`), so a whole month is still there when
// the year review counts it for the last time.
import { getDb, isConnected } from "./lib/db.js";
import { log } from "./lib/logging.js";

export const SONG_PLAYS_COLLECTION = "song_plays";
const RETENTION_SECONDS = 45 * 24 * 60 * 60;

let indexesReady = null;

function sanitizeGuildId(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

function cleanText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : "";
}

/** One key per song, without case, accents or punctuation. */
export function songPlayKey({ artist = "", title = "", displayTitle = "" } = {}) {
  const normalize = (value) => String(value || "").toLowerCase().normalize("NFKD")
    .replace(/\p{M}+/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const artistKey = normalize(artist);
  const titleKey = normalize(title);
  const key = artistKey && titleKey ? `${artistKey}|${titleKey}` : normalize(displayTitle);
  return key.slice(0, 300);
}

/**
 * Midnight UTC of the day, the bucket a play is counted in.
 * @param {Date | number} [now]
 */
export function songPlayDay(now = new Date()) {
  const date = new Date(now);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

function collection() {
  if (!isConnected() || !getDb()) return null;
  return getDb().collection(SONG_PLAYS_COLLECTION);
}

/**
 * The TTL index with the current time. Until #301 it was 21 days; MongoDB
 * refuses the same index with another time, so an existing one is changed.
 * Counting never stops over it: if the change fails, the next start tries again.
 */
async function ensureRetention(plays) {
  try {
    await plays.createIndex({ day: 1 }, { expireAfterSeconds: RETENTION_SECONDS, name: "day_ttl" });
  } catch (error) {
    if (error?.code !== 85 && error?.codeName !== "IndexOptionsConflict") throw error;
    await getDb().command({ collMod: SONG_PLAYS_COLLECTION, index: { name: "day_ttl", expireAfterSeconds: RETENTION_SECONDS } })
      .catch((err) => log("WARN", `[Song-Plays] Aufbewahrung nicht auf ${RETENTION_SECONDS / 86_400} Tage umgestellt: ${err?.message || err}`));
  }
}

async function ensureIndexes(plays) {
  if (!indexesReady) {
    // One index after the other: the TTL change does not run into the other build.
    indexesReady = plays.createIndex({ guildId: 1, day: 1, trackKey: 1 }, { unique: true, name: "guild_day_track_unique" })
      .then(() => ensureRetention(plays))
      .catch((error) => {
        indexesReady = null;
        throw error;
      });
  }
  return indexesReady;
}

/** Counts one play of a song on a server. Without MongoDB nothing happens. */
export async function recordSongPlay(guildId, song = {}, { now = new Date() } = {}) {
  const gid = sanitizeGuildId(guildId);
  const trackKey = songPlayKey(song);
  const plays = collection();
  if (!gid || !trackKey || !plays) return { ok: false };
  const displayTitle = cleanText(song.displayTitle, 220)
    || [cleanText(song.artist, 120), cleanText(song.title, 160)].filter(Boolean).join(" - ");
  const update = {
    $inc: { count: 1 },
    $set: { displayTitle, lastPlayedAt: new Date(now) },
    $setOnInsert: { guildId: gid, day: songPlayDay(now), trackKey },
  };
  try {
    await ensureIndexes(plays);
    await plays.updateOne({ guildId: gid, day: songPlayDay(now), trackKey }, update, { upsert: true });
    return { ok: true };
  } catch (error) {
    // Two workers counting the same new document: the second one retries as an update.
    if (error?.code === 11000) {
      await plays.updateOne({ guildId: gid, day: songPlayDay(now), trackKey }, update).catch(() => null);
      return { ok: true };
    }
    return { ok: false };
  }
}

/**
 * The most played songs between two times, most plays first: [{ displayTitle, count }].
 * @param {string} guildId
 * @param {{ sinceMs?: number, untilMs?: number, limit?: number }} [options]
 */
export async function getTopSongPlays(guildId, { sinceMs, untilMs = Date.now(), limit = 5 } = {}) {
  const gid = sanitizeGuildId(guildId);
  const plays = collection();
  if (!gid || !plays) return [];
  try {
    const rows = await plays.aggregate([
      { $match: { guildId: gid, day: { $gte: songPlayDay(sinceMs), $lt: new Date(untilMs) } } },
      { $group: { _id: "$trackKey", count: { $sum: "$count" }, displayTitle: { $last: "$displayTitle" } } },
      { $sort: { count: -1, displayTitle: 1 } },
      { $limit: Math.max(1, Math.min(20, Number(limit) || 5)) },
    ]).toArray();
    return rows.map((row) => ({ displayTitle: row.displayTitle || row._id, count: Number(row.count) || 0 }));
  } catch {
    return [];
  }
}

export function resetSongPlaysStoreForTests() {
  indexesReady = null;
}
