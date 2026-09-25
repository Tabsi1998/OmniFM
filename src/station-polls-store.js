// ============================================================
// OmniFM: running station polls (#274)
// ============================================================
// One poll per server at a time. Kept in MongoDB so a restart of the
// commander still evaluates it; without MongoDB it lives in memory (then a
// restart forgets it, the poll itself stays in Discord).
import { getDb, isConnected } from "./lib/db.js";

export const STATION_POLLS_COLLECTION = "station_polls";

const memory = new Map();

function sanitizeId(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

function collection() {
  if (!isConnected() || !getDb()) return null;
  return getDb().collection(STATION_POLLS_COLLECTION);
}

/** { guildId, channelId, messageId, voiceChannelId, stations: [{ key, name }], endsAt, createdBy } */
export function normalizeStationPoll(input = {}) {
  const guildId = sanitizeId(input.guildId);
  const channelId = sanitizeId(input.channelId);
  const messageId = sanitizeId(input.messageId);
  const endsAt = Number(input.endsAt) || 0;
  const stations = (Array.isArray(input.stations) ? input.stations : [])
    .map((station) => ({ key: String(station?.key || "").trim().slice(0, 120), name: String(station?.name || "").trim().slice(0, 120) }))
    .filter((station) => station.key)
    .slice(0, 10);
  if (!guildId || !channelId || !messageId || !endsAt || stations.length < 2) return null;
  return {
    guildId,
    channelId,
    messageId,
    voiceChannelId: sanitizeId(input.voiceChannelId) || null,
    stations,
    endsAt,
    createdBy: sanitizeId(input.createdBy) || null,
  };
}

export async function saveActiveStationPoll(input) {
  const poll = normalizeStationPoll(input);
  if (!poll) return { ok: false, error: "invalid_poll" };
  memory.set(poll.guildId, poll);
  const polls = collection();
  if (polls) {
    await polls.updateOne({ guildId: poll.guildId }, { $set: poll }, { upsert: true }).catch(() => null);
  }
  return { ok: true, poll };
}

export async function getActiveStationPoll(guildId) {
  const gid = sanitizeId(guildId);
  if (!gid) return null;
  const polls = collection();
  if (polls) {
    const stored = await polls.findOne({ guildId: gid }, { projection: { _id: 0 } }).catch(() => null);
    if (stored) return normalizeStationPoll(stored);
  }
  return memory.get(gid) || null;
}

export async function listActiveStationPolls() {
  const polls = collection();
  if (polls) {
    const stored = await polls.find({}, { projection: { _id: 0 } }).toArray().catch(() => []);
    return stored.map(normalizeStationPoll).filter(Boolean);
  }
  return [...memory.values()];
}

export async function deleteActiveStationPoll(guildId) {
  const gid = sanitizeId(guildId);
  if (!gid) return;
  memory.delete(gid);
  await collection()?.deleteOne({ guildId: gid }).catch(() => null);
}

export function resetStationPollsForTests() {
  memory.clear();
}
