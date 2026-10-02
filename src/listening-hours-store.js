// ============================================================
// OmniFM: listening time per person, only with consent (#302)
// ============================================================
// A person's document exists only while they have switched counting on in
// /mydata. The commander adds the minutes they spend in a voice channel
// where OmniFM plays, and never creates a document while doing so: without
// the switch nothing about a person is counted. Switching it off deletes
// the document, and the hours with it.
import { getDb, isConnected } from "./lib/db.js";

export const LISTENING_HOURS_COLLECTION = "listening_hours";

function cleanUserId(userId) {
  const id = String(userId || "").trim();
  return /^\d{17,22}$/.test(id) ? id : "";
}

function hoursCollection() {
  if (!isConnected() || !getDb()) return null;
  return getDb().collection(LISTENING_HOURS_COLLECTION);
}

export function listeningHoursAvailable() {
  return hoursCollection() !== null;
}

/**
 * Switches counting on (keeps what was counted) or off (deletes it).
 * @returns {Promise<{ ok: boolean, counting: boolean, error?: string }>}
 */
export async function setListeningConsent(userId, on, { now = new Date() } = {}) {
  const id = cleanUserId(userId);
  const hours = hoursCollection();
  if (!id) return { ok: false, counting: false, error: "invalid_user" };
  if (!hours) return { ok: false, counting: false, error: "db_unavailable" };
  if (on) {
    await hours.updateOne(
      { _id: id },
      { $setOnInsert: { userId: id, consentAt: now, listenedMs: 0 }, $set: { updatedAt: now } },
      { upsert: true },
    );
    return { ok: true, counting: true };
  }
  await hours.deleteOne({ _id: id });
  return { ok: true, counting: false };
}

/** @returns {Promise<{ counting: boolean, listenedMs: number, consentAt: Date | null }>} */
export async function getListeningHours(userId) {
  const id = cleanUserId(userId);
  const hours = hoursCollection();
  const row = id && hours ? await hours.findOne({ _id: id }) : null;
  return {
    counting: Boolean(row),
    listenedMs: Number(row?.listenedMs) || 0,
    consentAt: row?.consentAt instanceof Date ? row.consentAt : null,
  };
}

/** Everyone who has switched counting on. */
export async function consentingUserIds() {
  const hours = hoursCollection();
  if (!hours) return new Set();
  const rows = await hours.find({}, { projection: { _id: 1 } }).toArray();
  return new Set(rows.map((row) => String(row._id)));
}

/**
 * Adds listening time. Only existing documents are touched: a person who
 * switched counting off in the meantime is not counted again.
 * @param {Map<string, number>} timeByUser  milliseconds per Discord ID
 * @returns {Promise<number>} how many people got time
 */
export async function addListeningTime(timeByUser, { now = new Date() } = {}) {
  const hours = hoursCollection();
  if (!hours || !timeByUser?.size) return 0;
  const operations = [];
  for (const [userId, ms] of timeByUser) {
    const id = cleanUserId(userId);
    const add = Math.round(Number(ms) || 0);
    if (!id || add <= 0) continue;
    operations.push({ updateOne: { filter: { _id: id }, update: { $inc: { listenedMs: add }, $set: { updatedAt: now } } } });
  }
  if (!operations.length) return 0;
  const result = await hours.bulkWrite(operations, { ordered: false });
  return result.modifiedCount || 0;
}

/** /mydata "delete everything": the switch and the hours go. */
export async function forgetListeningHours(userId) {
  const id = cleanUserId(userId);
  const hours = hoursCollection();
  if (!id || !hours) return 0;
  return (await hours.deleteOne({ _id: id })).deletedCount || 0;
}
