// ============================================================
// OmniFM: the servers' jingles (#309)
// ============================================================
// One jingle per server, as the PCM the bot mixes (src/lib/jingle-audio.js),
// with its file name, length and time. Who uploaded it is not kept here; the
// owner audit has it like every dashboard change. It goes when the server
// deletes it or with the server's data (src/services/server-data-retention.js).
import { getDb, isConnected } from "./lib/db.js";

export const JINGLES_COLLECTION = "guild_jingles";

/** @typedef {{ name: string, durationMs: number, bytes: number, updatedAt: number }} JingleInfo */

function cleanGuildId(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

function jinglesCollection() {
  if (!isConnected() || !getDb()) return null;
  return getDb().collection(JINGLES_COLLECTION);
}

/** @returns {JingleInfo} */
function infoOf(row) {
  return {
    name: String(row.name || "Jingle"),
    durationMs: Number(row.durationMs) || 0,
    bytes: Number(row.bytes) || 0,
    updatedAt: Number(row.updatedAt) || 0,
  };
}

/**
 * @param {string} guildId
 * @param {{ pcm: Buffer, durationMs: number, name: string }} jingle
 * @returns {Promise<{ ok: true, info: JingleInfo } | { ok: false, error: string }>}
 */
export async function saveGuildJingle(guildId, { pcm, durationMs, name }, { now = Date.now() } = {}) {
  const gid = cleanGuildId(guildId);
  if (!gid || !Buffer.isBuffer(pcm) || !pcm.length) return { ok: false, error: "invalid" };
  const jingles = jinglesCollection();
  if (!jingles) return { ok: false, error: "no-database" };
  const row = { guildId: gid, pcm, bytes: pcm.length, durationMs: Number(durationMs) || 0, name: String(name || "Jingle"), updatedAt: now };
  await jingles.updateOne({ _id: gid }, { $set: row }, { upsert: true });
  return { ok: true, info: infoOf(row) };
}

/** What is stored for the server, without the sound; null without a jingle. */
export async function getGuildJingleInfo(guildId) {
  const gid = cleanGuildId(guildId);
  const jingles = jinglesCollection();
  if (!gid || !jingles) return null;
  const row = await jingles.findOne({ _id: gid }, { projection: { pcm: 0 } });
  return row ? infoOf(row) : null;
}

/** @returns {Promise<{ pcm: Buffer, updatedAt: number } | null>} */
export async function getGuildJinglePcm(guildId) {
  const gid = cleanGuildId(guildId);
  const jingles = jinglesCollection();
  if (!gid || !jingles) return null;
  const row = await jingles.findOne({ _id: gid }, { projection: { pcm: 1, updatedAt: 1 } });
  if (!row?.pcm) return null;
  // The driver hands back a BSON Binary.
  const pcm = Buffer.isBuffer(row.pcm) ? row.pcm : Buffer.from(row.pcm.buffer || row.pcm);
  return { pcm, updatedAt: Number(row.updatedAt) || 0 };
}

export async function deleteGuildJingle(guildId) {
  const gid = cleanGuildId(guildId);
  const jingles = jinglesCollection();
  if (!gid || !jingles) return false;
  const result = await jingles.deleteOne({ _id: gid });
  return result.deletedCount > 0;
}
