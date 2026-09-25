// ============================================================
// OmniFM: logos of the servers' own stations (#340)
// ============================================================
// Discord attachment links expire after about a day, so an uploaded logo
// is kept here, once per server and station, as a 256x256 PNG and served
// by OmniFM itself (/api/station-logos/<server>/<key>.png). Deleting the
// station deletes its logo.
import { getDb, isConnected } from "./lib/db.js";

export const STATION_LOGOS_COLLECTION = "station_logos";

let indexesReady = null;

function cleanGuildId(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

function cleanKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 40);
}

function logosCollection() {
  if (!isConnected() || !getDb()) return null;
  return getDb().collection(STATION_LOGOS_COLLECTION);
}

async function ensureIndexes(logos) {
  if (!indexesReady) {
    indexesReady = logos.createIndex({ guildId: 1, key: 1 }, { unique: true, name: "guild_key_unique" })
      .catch((error) => {
        indexesReady = null;
        throw error;
      });
  }
  return indexesReady;
}

/** @returns {Promise<{ ok: true, updatedAt: number } | { ok: false, error: string }>} */
export async function saveStationLogo(guildId, key, png, { now = Date.now() } = {}) {
  const gid = cleanGuildId(guildId);
  const k = cleanKey(key);
  if (!gid || !k || !Buffer.isBuffer(png) || !png.length) return { ok: false, error: "invalid" };
  const logos = logosCollection();
  if (!logos) return { ok: false, error: "no-database" };
  await ensureIndexes(logos);
  await logos.updateOne(
    { guildId: gid, key: k },
    { $set: { guildId: gid, key: k, png, bytes: png.length, updatedAt: now } },
    { upsert: true }
  );
  return { ok: true, updatedAt: now };
}

/** @returns {Promise<{ png: Buffer, updatedAt: number } | null>} */
export async function getStationLogo(guildId, key) {
  const gid = cleanGuildId(guildId);
  const k = cleanKey(key);
  const logos = logosCollection();
  if (!gid || !k || !logos) return null;
  const row = await logos.findOne({ guildId: gid, key: k }, { projection: { _id: 0, png: 1, updatedAt: 1 } });
  if (!row?.png) return null;
  // The driver hands back a BSON Binary.
  const png = Buffer.isBuffer(row.png) ? row.png : Buffer.from(row.png.buffer || row.png);
  return { png, updatedAt: Number(row.updatedAt) || 0 };
}

export async function deleteStationLogo(guildId, key) {
  const gid = cleanGuildId(guildId);
  const k = cleanKey(key);
  const logos = logosCollection();
  if (!gid || !k || !logos) return false;
  const result = await logos.deleteOne({ guildId: gid, key: k });
  return result.deletedCount > 0;
}

export async function deleteGuildStationLogos(guildId) {
  const gid = cleanGuildId(guildId);
  const logos = logosCollection();
  if (!gid || !logos) return 0;
  const result = await logos.deleteMany({ guildId: gid });
  return result.deletedCount || 0;
}
