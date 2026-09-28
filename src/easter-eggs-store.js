// ============================================================
// OmniFM: the found Easter eggs (#429)
// ============================================================
// Per server, person and year the number of eggs, plus when and with which
// song (a short key, not the title) the person found the last one, so that
// two panels with the same song give one person one egg; and the server's
// name for the owner console. An egg itself is claimed once: whoever stores
// it first has it. The counts go 30 days after Easter Monday, a claimed egg
// after two days. MongoDB only.
import { getDb, isConnected } from "./lib/db.js";
import { SAME_SONG_MS, eggExpiry, rankRows } from "./lib/easter-eggs.js";

export const EGG_FINDERS_COLLECTION = "easter_eggs";
export const EGG_CLAIMS_COLLECTION = "easter_egg_claims";
const CLAIM_KEEP_MS = 2 * 86_400_000;
const SNOWFLAKE = /^\d{17,22}$/;

let indexesReady = null;

export function eggStoreAvailable() {
  return isConnected() && Boolean(getDb());
}

function collections() {
  if (!eggStoreAvailable()) return null;
  const db = getDb();
  return { finders: db.collection(EGG_FINDERS_COLLECTION), claims: db.collection(EGG_CLAIMS_COLLECTION) };
}

async function ensureIndexes({ finders, claims }) {
  if (!indexesReady) {
    indexesReady = Promise.all([
      finders.createIndex({ guildId: 1, year: 1, userId: 1 }, { name: "finder", unique: true }),
      finders.createIndex({ guildId: 1, year: 1, count: -1 }, { name: "board" }),
      finders.createIndex({ userId: 1 }, { name: "person" }),
      finders.createIndex({ expiresAt: 1 }, { name: "ttl", expireAfterSeconds: 0 }),
      claims.createIndex({ expiresAt: 1 }, { name: "ttl", expireAfterSeconds: 0 }),
    ]).catch((error) => {
      indexesReady = null;
      throw error;
    });
  }
  return indexesReady;
}

const isDuplicate = (error) => error?.code === 11000;

/**
 * Gives the egg to this person if nobody has it yet: { ok: true, count } with
 * the person's eggs on this server this year, or { ok: false, reason }:
 * "taken" (somebody was faster), "song" (the person has an egg for this song
 * already; this one stays for the others), "unavailable" (no MongoDB).
 * @param {{ eggId: string, guildId: string, guildName?: string, userId: string, year: number, points?: number, song?: string, now?: number }} input
 */
export async function claimEgg({ eggId, guildId, guildName = "", userId, year, points = 1, song = "", now = Date.now() }) {
  const stores = collections();
  if (!stores) return { ok: false, reason: "unavailable" };
  if (!eggId || !SNOWFLAKE.test(String(guildId)) || !SNOWFLAKE.test(String(userId)) || !Number.isInteger(year)) {
    return { ok: false, reason: "taken" };
  }
  await ensureIndexes(stores);
  const guild = String(guildId);
  const claimId = `${guild}:${eggId}`;
  try {
    await stores.claims.insertOne({ _id: claimId, guildId: guild, year, expiresAt: new Date(now + CLAIM_KEEP_MS) });
  } catch (error) {
    if (isDuplicate(error)) return { ok: false, reason: "taken" };
    throw error;
  }

  const filter = { guildId: guild, year, userId: String(userId) };
  if (song) filter.$nor = [{ lastSong: song, lastFoundAt: { $gt: new Date(now - SAME_SONG_MS) } }];
  const update = {
    $inc: { count: points },
    $set: { guildName: String(guildName || "").slice(0, 100), lastSong: song || null, lastFoundAt: new Date(now), expiresAt: eggExpiry(year, now) },
  };
  const bump = () => stores.finders.findOneAndUpdate(filter, update, { upsert: true, returnDocument: "after" });
  const release = () => stores.claims.deleteOne({ _id: claimId }).catch(() => null);
  let finder;
  try {
    // A duplicate key means the person's entry exists but the filter missed:
    // the same song. Once more, in case two first eggs of a person met.
    finder = await bump().catch((error) => {
      if (!isDuplicate(error)) throw error;
      return bump().catch((again) => {
        if (isDuplicate(again)) return null;
        throw again;
      });
    });
  } catch (error) {
    await release();
    throw error;
  }
  if (!finder) {
    await release();
    return { ok: false, reason: "song" };
  }
  return { ok: true, count: Number(finder.count) || points };
}

/**
 * A server's board for a year: the top ten with places (ties share one), the
 * asker's place and count, and how many people found eggs. null without MongoDB.
 */
export async function eggBoard(guildId, year, { userId = "", limit = 10 } = {}) {
  const stores = collections();
  if (!stores) return null;
  await ensureIndexes(stores);
  const query = { guildId: String(guildId), year, count: { $gt: 0 } };
  const [rows, finders] = await Promise.all([
    stores.finders.find(query, { projection: { _id: 0, userId: 1, count: 1 } }).sort({ count: -1, userId: 1 }).limit(limit).toArray(),
    stores.finders.countDocuments(query),
  ]);
  let own = null;
  if (userId) {
    const mine = await stores.finders.findOne({ guildId: String(guildId), year, userId: String(userId) }, { projection: { _id: 0, count: 1 } });
    if (Number(mine?.count) > 0) {
      const ahead = await stores.finders.countDocuments({ guildId: String(guildId), year, count: { $gt: mine.count } });
      own = { count: mine.count, rank: ahead + 1 };
    }
  }
  return { year, top: rankRows(rows), own, finders };
}

/** The last year in which somebody found an egg on this server, or null. */
export async function latestEggYear(guildId) {
  const stores = collections();
  if (!stores) return null;
  const latest = await stores.finders.find({ guildId: String(guildId), count: { $gt: 0 } }, { projection: { _id: 0, year: 1 } })
    .sort({ year: -1 }).limit(1).toArray();
  return latest[0]?.year ?? null;
}

/**
 * For the owner console: per server the top three of a year (the last year
 * with eggs when none is asked for), the servers with the most eggs first.
 */
export async function eggTopByServer({ year = null, limit = 100 } = {}) {
  const stores = collections();
  if (!stores) return { year: null, servers: [] };
  let pickedYear = Number.isInteger(year) ? year : null;
  if (pickedYear === null) {
    const latest = await stores.finders.find({ count: { $gt: 0 } }, { projection: { _id: 0, year: 1 } }).sort({ year: -1 }).limit(1).toArray();
    pickedYear = latest[0]?.year ?? null;
  }
  if (pickedYear === null) return { year: null, servers: [] };
  const servers = await stores.finders.aggregate([
    { $match: { year: pickedYear, count: { $gt: 0 } } },
    { $sort: { count: -1, userId: 1 } },
    { $group: { _id: "$guildId", name: { $max: "$guildName" }, finders: { $sum: 1 }, eggs: { $sum: "$count" }, top: { $push: { userId: "$userId", count: "$count" } } } },
    { $project: { _id: 0, guildId: "$_id", name: 1, finders: 1, eggs: 1, top: { $slice: ["$top", 3] } } },
    { $sort: { eggs: -1, guildId: 1 } },
    { $limit: limit },
  ]).toArray();
  return { year: pickedYear, servers: servers.map((server) => ({ ...server, top: rankRows(server.top) })) };
}

/** A person's eggs on every server, for /mydata. */
export async function listEggsOfFinder(userId) {
  const stores = collections();
  if (!stores) return [];
  return stores.finders.find({ userId: String(userId) }, { projection: { _id: 0, guildId: 1, guildName: 1, year: 1, count: 1, lastSong: 1, lastFoundAt: 1 } })
    .sort({ year: -1, guildId: 1 }).toArray();
}

/** "Delete everything": the person's eggs on every server. */
export async function forgetEggFinder(userId) {
  const stores = collections();
  if (!stores) return 0;
  const result = await stores.finders.deleteMany({ userId: String(userId) });
  return result.deletedCount || 0;
}
