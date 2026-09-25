// ============================================================
// OmniFM: the personal list of saved songs (#272)
// ============================================================
// Data per person: a Discord user id and the songs
// they saved with "💾 Save" in the now-playing panel. At most the last 50;
// the same song is kept once, so a double click saves nothing twice. The
// person can delete single songs or all of them (/merkliste), after which
// nothing of them is left in MongoDB.
import { randomUUID } from "node:crypto";

import { getDb, isConnected } from "./lib/db.js";

export const SAVED_SONGS_COLLECTION = "saved_songs";
export const SAVED_SONGS_MAX_PER_USER = 50;

let indexesReady = null;

function sanitizeUserId(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

function cleanText(value, maxLength) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  return text ? text.slice(0, maxLength) : null;
}

function httpsUrlOrNull(value) {
  const text = String(value || "").trim();
  return /^https:\/\/\S+$/i.test(text) ? text.slice(0, 600) : null;
}

/** One key per song: artist and title, else the display title, without case or punctuation. */
export function savedSongTrackKey({ artist = null, title = null, displayTitle = null } = {}) {
  const normalize = (value) => String(value || "").toLowerCase().normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  const artistKey = normalize(artist);
  const titleKey = normalize(title);
  const key = artistKey && titleKey ? `${artistKey}|${titleKey}` : normalize(displayTitle);
  return key ? key.slice(0, 300) : "";
}

/** The stored fields of a song; null when there is no recognisable title. */
export function buildSavedSong(input = {}) {
  const artist = cleanText(input.artist, 120);
  const title = cleanText(input.title, 160);
  const displayTitle = cleanText(input.displayTitle, 220) || [artist, title].filter(Boolean).join(" - ") || null;
  const trackKey = savedSongTrackKey({ artist, title, displayTitle });
  if (!trackKey) return null;
  return {
    trackKey,
    artist,
    title,
    displayTitle,
    stationKey: cleanText(input.stationKey, 80),
    stationName: cleanText(input.stationName, 120),
    artworkUrl: httpsUrlOrNull(input.artworkUrl),
  };
}

function collection() {
  if (!isConnected() || !getDb()) return null;
  return getDb().collection(SAVED_SONGS_COLLECTION);
}

async function ensureIndexes(songs) {
  if (!indexesReady) {
    indexesReady = Promise.all([
      songs.createIndex({ userId: 1, trackKey: 1 }, { unique: true, name: "user_track_unique" }),
      songs.createIndex({ userId: 1, savedAt: -1 }, { name: "user_saved_at" }),
    ]).catch((error) => {
      indexesReady = null;
      throw error;
    });
  }
  return indexesReady;
}

async function trimToLimit(songs, userId) {
  const surplus = await songs.find({ userId }, { projection: { _id: 1 } })
    .sort({ savedAt: -1, _id: -1 })
    .skip(SAVED_SONGS_MAX_PER_USER)
    .toArray();
  if (surplus.length) {
    await songs.deleteMany({ _id: { $in: surplus.map((entry) => entry._id) } });
  }
}

/**
 * Saves a song for a person. { ok, duplicate, song } or { ok: false, error }
 * with error "invalid_user", "no_track", "db_unavailable" or "db_write_failed".
 */
export async function saveSong(userId, input, { now = new Date() } = {}) {
  const user = sanitizeUserId(userId);
  if (!user) return { ok: false, error: "invalid_user" };
  const song = buildSavedSong(input);
  if (!song) return { ok: false, error: "no_track" };
  const songs = collection();
  if (!songs) return { ok: false, error: "db_unavailable" };

  try {
    await ensureIndexes(songs);
    const result = await songs.updateOne(
      { userId: user, trackKey: song.trackKey },
      { $setOnInsert: { ...song, userId: user, id: randomUUID(), savedAt: now } },
      { upsert: true }
    );
    const duplicate = !result.upsertedCount;
    if (!duplicate) await trimToLimit(songs, user);
    return { ok: true, duplicate, song };
  } catch (error) {
    // Two clicks at the same moment: the unique index lets one of them in.
    if (error?.code === 11000) return { ok: true, duplicate: true, song };
    return { ok: false, error: "db_write_failed" };
  }
}

/** The person's saved songs, newest first. */
export async function listSavedSongs(userId, { limit = SAVED_SONGS_MAX_PER_USER } = {}) {
  const user = sanitizeUserId(userId);
  const songs = collection();
  if (!user || !songs) return [];
  const max = Math.max(1, Math.min(SAVED_SONGS_MAX_PER_USER, Number(limit) || SAVED_SONGS_MAX_PER_USER));
  try {
    return await songs.find({ userId: user }, { projection: { _id: 0 } })
      .sort({ savedAt: -1 })
      .limit(max)
      .toArray();
  } catch {
    return [];
  }
}

/** Deletes one song of the person; others' songs stay out of reach. */
export async function deleteSavedSong(userId, songId) {
  const user = sanitizeUserId(userId);
  const id = String(songId || "").trim();
  const songs = collection();
  if (!songs) return { ok: false, error: "db_unavailable" };
  if (!user || !id) return { ok: false, error: "invalid_input" };
  try {
    const result = await songs.deleteOne({ userId: user, id });
    return { ok: true, deleted: result.deletedCount || 0 };
  } catch {
    return { ok: false, error: "db_write_failed" };
  }
}

/** Deletes everything OmniFM keeps of the person here. */
export async function clearSavedSongs(userId) {
  const user = sanitizeUserId(userId);
  const songs = collection();
  if (!songs) return { ok: false, error: "db_unavailable" };
  if (!user) return { ok: false, error: "invalid_user" };
  try {
    const result = await songs.deleteMany({ userId: user });
    return { ok: true, deleted: result.deletedCount || 0 };
  } catch {
    return { ok: false, error: "db_write_failed" };
  }
}

export function resetSavedSongsStoreForTests() {
  indexesReady = null;
}
