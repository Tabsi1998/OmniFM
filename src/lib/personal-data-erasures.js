// ============================================================
// OmniFM: remembering that a person deleted their data (#285)
// ============================================================
// After "delete everything" in /mydata the vote syncs would read the
// person's old votes again: discordbotlist.com returns the votes of the last
// 12 hours on every sync, top.gg up to 30 days when its sync starts over.
// This keeps the erasure for 45 days, as a hash of the Discord ID (never the
// ID itself), and the vote stores skip what was voted before it. New votes
// after the erasure count as usual.
import { createHash } from "node:crypto";

import { getDb, isConnected } from "./db.js";

const COLLECTION = "personal_data_erasures";
const KEEP_MS = 45 * 24 * 60 * 60 * 1000;
const erasures = new Map();

export function erasureHash(userId) {
  return createHash("sha256").update(`omnifm-erasure:${String(userId || "").trim()}`).digest("hex");
}

/** The erasures of the last 45 days, into this process (start of the commander and the public entry). */
export async function loadPersonalDataErasures() {
  if (!isConnected() || !getDb()) return 0;
  const collection = getDb().collection(COLLECTION);
  await collection.createIndex({ expiresAt: 1 }, { name: "erasure_expiry", expireAfterSeconds: 0 }).catch(() => null);
  const rows = await collection.find({ expiresAt: { $gt: new Date() } }).toArray();
  for (const row of rows) erasures.set(row._id, new Date(row.erasedAt).getTime());
  return rows.length;
}

export async function rememberPersonalDataErasure(userId, { now = new Date() } = {}) {
  const hash = erasureHash(userId);
  erasures.set(hash, now.getTime());
  if (!isConnected() || !getDb()) return;
  await getDb().collection(COLLECTION).updateOne(
    { _id: hash },
    { $set: { erasedAt: now, expiresAt: new Date(now.getTime() + KEEP_MS) } },
    { upsert: true },
  );
}

/** True for something of the person from before their erasure, e.g. an old vote a sync reads again. */
export function erasedBefore(userId, at, { now = Date.now() } = {}) {
  const erasedAt = erasures.get(erasureHash(userId));
  if (!erasedAt || now - erasedAt > KEEP_MS) return false;
  const time = new Date(at).getTime();
  return !Number.isFinite(time) || time <= erasedAt;
}

export function resetPersonalDataErasuresForTests() {
  erasures.clear();
}
