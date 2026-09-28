// ============================================================
// OmniFM: station suggestions from the community (#303)
// ============================================================
// A suggestion waits in the owner console's queue with its stream checks
// until the owner takes it into the catalogue or turns it down; the person
// who sent it hears about it once. The Discord ID is kept only for that
// message (and /mydata shows and deletes it); a decided suggestion goes
// after 180 days. MongoDB only.
import { randomBytes } from "node:crypto";
import { getDb, isConnected } from "./lib/db.js";
import { MAX_PENDING_PER_PERSON, readSuggestionInput, streamUrlKey } from "./lib/station-suggestions.js";

export const STATION_SUGGESTIONS_COLLECTION = "station_suggestions";
const KEEP_DECIDED_MS = 180 * 86_400_000;
const KEEP_CHECKS = 48;

let indexesReady = null;

function collection() {
  if (!isConnected() || !getDb()) return null;
  return getDb().collection(STATION_SUGGESTIONS_COLLECTION);
}

async function ensureIndexes(suggestions) {
  if (!indexesReady) {
    indexesReady = Promise.all([
      suggestions.createIndex({ urlKey: 1 }, { name: "url_key" }),
      suggestions.createIndex({ "submitter.userId": 1 }, { name: "submitter" }),
      suggestions.createIndex({ status: 1, createdAt: -1 }, { name: "queue" }),
      suggestions.createIndex({ expiresAt: 1 }, { name: "ttl", expireAfterSeconds: 0 }),
    ]).catch((error) => {
      indexesReady = null;
      throw error;
    });
  }
  return indexesReady;
}

const cleanId = (value) => (/^\d{17,22}$/.test(String(value || "")) ? String(value) : "");

/**
 * Takes a suggestion into the queue, or says why not: "unavailable", the
 * form's "name" | "url" | "homepage", "in-catalog" (with the station's
 * name), "already-suggested", "too-many" (pending ones of the person).
 * @param {Record<string, any>} input the form
 * @param {{ userId?: string, userName?: string, guildId?: string, language?: string }} submitter
 * @param {{ now?: number, catalog?: Record<string, { name?: string, url?: string }> }} [options]
 */
export async function createStationSuggestion(input, submitter = {}, { now = Date.now(), catalog = {} } = {}) {
  const suggestions = collection();
  if (!suggestions) return { error: "unavailable" };
  const read = readSuggestionInput(input);
  if (read.error) return { error: read.error };
  const { suggestion } = read;
  const known = Object.values(catalog || {}).find((station) => streamUrlKey(station?.url) === suggestion.urlKey);
  if (known) return { error: "in-catalog", station: String(known.name || "") };
  await ensureIndexes(suggestions);
  const earlier = await suggestions.findOne({ urlKey: suggestion.urlKey, status: { $in: ["pending", "accepted"] } }, { projection: { status: 1 } });
  if (earlier) return { error: "already-suggested", status: earlier.status };
  const userId = cleanId(submitter.userId);
  if (userId && await suggestions.countDocuments({ "submitter.userId": userId, status: "pending" }) >= MAX_PENDING_PER_PERSON) {
    return { error: "too-many" };
  }
  const doc = {
    _id: randomBytes(8).toString("hex"),
    ...suggestion,
    status: "pending",
    createdAt: new Date(now),
    checks: [],
    ...(userId ? {
      submitter: {
        userId,
        userName: String(submitter.userName || "").slice(0, 80),
        guildId: cleanId(submitter.guildId) || null,
        language: submitter.language === "en" ? "en" : "de",
      },
    } : {}),
  };
  await suggestions.insertOne(doc);
  return { suggestion: doc };
}

/**
 * One stream check of a suggestion; the last 48 stay.
 * @param {string} id
 * @param {{ ok?: boolean, audio?: boolean, bitrate?: number | null, latencyMs?: number | null, error?: string }} check
 */
export async function recordSuggestionCheck(id, check, { now = Date.now() } = {}) {
  const suggestions = collection();
  if (!suggestions) return false;
  const entry = {
    at: new Date(now),
    ok: check.ok === true,
    audio: check.audio === true,
    bitrate: Number.isFinite(Number(check.bitrate)) ? Number(check.bitrate) : null,
    latencyMs: Number.isFinite(Number(check.latencyMs)) ? Number(check.latencyMs) : null,
    error: String(check.error || "").slice(0, 120) || null,
  };
  const result = await suggestions.updateOne({ _id: String(id) }, { $push: { checks: { $each: [entry], $slice: -KEEP_CHECKS } } });
  return result.modifiedCount > 0;
}

/** Pending suggestions younger than a week: the ones the hourly check tests. */
export async function suggestionsToCheck({ now = Date.now(), maxAgeDays = 7 } = {}) {
  const suggestions = collection();
  if (!suggestions) return [];
  return suggestions
    .find({ status: "pending", createdAt: { $gte: new Date(now - maxAgeDays * 86_400_000) } }, { projection: { url: 1, name: 1 } })
    .toArray();
}

/** The owner console's queue: pending first, then the decided ones, newest first. */
export async function listStationSuggestions({ limit = 200 } = {}) {
  const suggestions = collection();
  if (!suggestions) return [];
  const rows = await suggestions.find({}).sort({ createdAt: -1 }).limit(Math.max(1, Math.min(500, limit))).toArray();
  const order = { pending: 0, accepted: 1, rejected: 2 };
  return rows.sort((a, b) => (order[a.status] ?? 3) - (order[b.status] ?? 3));
}

export async function findStationSuggestion(id) {
  const suggestions = collection();
  if (!suggestions) return null;
  return suggestions.findOne({ _id: String(id) });
}

/**
 * The owner's decision. The person who sent it hears about it once (the
 * commander sends the message); a suggestion without a person is only marked.
 * @param {string} id
 * @param {{ status: "accepted" | "rejected", stationKey?: string, note?: string, actor?: string, now?: number }} decision
 */
export async function decideStationSuggestion(id, { status, stationKey = "", note = "", actor = "owner", now = Date.now() }) {
  const suggestions = collection();
  if (!suggestions) return { error: "unavailable" };
  const current = await suggestions.findOne({ _id: String(id) });
  if (!current) return { error: "not-found" };
  if (current.status !== "pending") return { error: "decided", status: current.status };
  const decided = {
    status,
    decidedAt: new Date(now),
    decidedBy: String(actor || "owner").slice(0, 120),
    decisionNote: String(note || "").trim().slice(0, 300),
    stationKey: status === "accepted" ? String(stationKey) : null,
    expiresAt: new Date(now + KEEP_DECIDED_MS),
    ...(current.submitter?.userId ? { notify: { pending: true } } : {}),
  };
  await suggestions.updateOne({ _id: current._id, status: "pending" }, { $set: decided });
  return { suggestion: { ...current, ...decided } };
}

/** Decided suggestions whose person has not heard about it yet. */
export async function suggestionsToNotify({ limit = 20 } = {}) {
  const suggestions = collection();
  if (!suggestions) return [];
  return suggestions.find({ "notify.pending": true, "submitter.userId": { $exists: true } }).limit(limit).toArray();
}

/** The message went out (or cannot): no second try either way. */
export async function markSuggestionNotified(id, { ok = true, now = Date.now() } = {}) {
  const suggestions = collection();
  if (!suggestions) return false;
  const result = await suggestions.updateOne({ _id: String(id) }, { $set: { notify: { pending: false, sentAt: new Date(now), delivered: ok === true } } });
  return result.modifiedCount > 0;
}

/** /mydata (#285): the suggestions a person sent. */
export async function listStationSuggestionsOfUser(userId) {
  const suggestions = collection();
  const id = cleanId(userId);
  if (!suggestions || !id) return [];
  return suggestions.find({ "submitter.userId": id }, { projection: { name: 1, url: 1, status: 1, createdAt: 1, decidedAt: 1 } }).toArray();
}

/** /mydata delete: the suggestions stay for the queue, without the person. */
export async function forgetStationSuggestionSubmitter(userId) {
  const suggestions = collection();
  const id = cleanId(userId);
  if (!suggestions || !id) return 0;
  const result = await suggestions.updateMany({ "submitter.userId": id }, { $unset: { submitter: "", notify: "" } });
  return result.modifiedCount || 0;
}
