// ============================================================
// OmniFM: servers OmniFM was removed from, and when their data goes (#285)
// ============================================================
// One document per server in guild_departures, written when the commander
// leaves it and removed when it comes back or the data is deleted. Without
// MongoDB it lives in memory (development).
import { getDb, isConnected } from "./lib/db.js";

export const GUILD_DEPARTURES_COLLECTION = "guild_departures";
export const SERVER_DATA_RETENTION_DAYS = 30;
const DAY_MS = 24 * 60 * 60 * 1000;
const memory = new Map();

function sanitizeId(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

function collection() {
  if (!isConnected() || !getDb()) return null;
  return getDb().collection(GUILD_DEPARTURES_COLLECTION);
}

function fromDoc(doc) {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return { guildId: rest.guildId || _id, ...rest };
}

/**
 * Notes that the commander left the server. `created` is true only the first
 * time, so the server owner hears about it once; the date stays the first one.
 * @param {{ guildId?: string, guildName?: string, now?: Date }} [input]
 */
export async function recordGuildDeparture({ guildId, guildName = "", now = new Date() } = {}) {
  const gid = sanitizeId(guildId);
  if (!gid) return { created: false, departure: null };
  const departure = {
    guildId: gid,
    guildName: String(guildName || "").trim().slice(0, 100),
    leftAt: now,
    deleteAfter: new Date(now.getTime() + SERVER_DATA_RETENTION_DAYS * DAY_MS),
    ownerNotifiedAt: null,
  };
  const departures = collection();
  if (!departures) {
    if (memory.has(gid)) return { created: false, departure: memory.get(gid) };
    memory.set(gid, departure);
    return { created: true, departure };
  }
  const result = await departures.updateOne({ _id: gid }, { $setOnInsert: departure }, { upsert: true });
  return { created: Boolean(result.upsertedCount), departure: fromDoc(await departures.findOne({ _id: gid })) || departure };
}

export async function markGuildDepartureNotified(guildId, at = new Date()) {
  const gid = sanitizeId(guildId);
  if (!gid) return;
  if (memory.has(gid)) memory.get(gid).ownerNotifiedAt = at;
  await collection()?.updateOne({ _id: gid }, { $set: { ownerNotifiedAt: at } }).catch(() => null);
}

/** OmniFM is back on the server, or its data is gone: nothing left to delete. */
export async function clearGuildDeparture(guildId) {
  const gid = sanitizeId(guildId);
  if (!gid) return false;
  const inMemory = memory.delete(gid);
  const departures = collection();
  if (!departures) return inMemory;
  const result = await departures.deleteOne({ _id: gid }).catch(() => null);
  return inMemory || Boolean(result?.deletedCount);
}

/** Every server waiting for its data to be deleted, soonest first. */
export async function listGuildDepartures() {
  const departures = collection();
  const rows = departures
    ? (await departures.find({}).sort({ deleteAfter: 1 }).toArray()).map(fromDoc)
    : [...memory.values()].sort((a, b) => a.deleteAfter - b.deleteAfter);
  return rows;
}

export async function listDueGuildDepartures(now = new Date()) {
  return (await listGuildDepartures()).filter((departure) => new Date(departure.deleteAfter).getTime() <= now.getTime());
}

export function resetGuildDeparturesForTests() {
  memory.clear();
}
