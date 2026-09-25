// ============================================================
// OmniFM: the owner console's data archive on the Node API (#288)
// ============================================================
// The Node twin of archive_mongo_records() / restore_archived_operation() in
// backend/services/owner_audit.py: before the owner deletes something, its
// documents are copied into data_archive, and one click puts them back -
// unless newer data would be overwritten.
import { randomBytes } from "node:crypto";
import { isDeepStrictEqual } from "node:util";

export const ARCHIVABLE_COLLECTIONS = Object.freeze(new Set([
  "licenses", "server_entitlements", "stations", "custom_stations", "scheduled_events",
  "command_permissions", "daily_stats", "listening_sessions", "listener_snapshots", "guild_stats",
]));

const token = () => randomBytes(18).toString("base64url");
const clip = (value, max) => {
  const text = String(value ?? "").trim();
  return text.length <= max ? text : `${text.slice(0, max - 3)}...`;
};

export class ArchiveError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

/**
 * Copies the matching documents into data_archive (all of them, before
 * anything is removed) and deletes the originals when `remove` is true.
 * @param {any} db
 * @param {Array<[string, object]>} queries [collection, filter]
 * @param {{ operation?: string, target?: string, actor?: string, ip?: string, remove?: boolean, now?: Date }} [options]
 */
export async function archiveMongoRecords(db, queries, { operation = "", target = "", actor = "owner", ip = "-", remove = true, now = new Date() } = {}) {
  if (!db) throw new ArchiveError(503, "MongoDB nicht verbunden.");
  for (const [collectionName] of queries) {
    if (!ARCHIVABLE_COLLECTIONS.has(collectionName)) throw new ArchiveError(400, `Collection ist nicht archivierbar: ${collectionName}`);
  }
  const operationId = `arc_${token()}`;
  const archivedAt = now.toISOString();
  const sources = await Promise.all(queries.map(async ([collectionName, query]) => {
    const collection = db.collection(collectionName);
    return [collectionName, collection, await collection.find(query).toArray()];
  }));
  const rows = [];
  for (const [collectionName, , documents] of sources) {
    for (const document of documents) {
      rows.push({
        recordId: `rec_${token()}`,
        operationId,
        operation: clip(operation, 100),
        target: clip(target, 200),
        collection: collectionName,
        originalId: String(document._id ?? ""),
        payload: document,
        archivedAt,
        archivedBy: clip(actor, 120),
        ip,
        restoredAt: null,
        restoredBy: null,
      });
    }
  }
  const deleted = Object.fromEntries(sources.map(([name]) => [name, 0]));
  if (!rows.length) return { operationId: null, archived: 0, deleted };
  // The copy has to be complete before any active record is removed.
  const inserted = await db.collection("data_archive").insertMany(rows, { ordered: true });
  if (Number(inserted?.insertedCount ?? Object.keys(inserted?.insertedIds || {}).length) !== rows.length) {
    throw new ArchiveError(500, "Archivierung wurde nicht vollständig bestätigt.");
  }
  if (remove) {
    await Promise.all(sources.map(async ([name, collection, documents]) => {
      const ids = documents.map((document) => document._id).filter((id) => id !== undefined && id !== null);
      if (ids.length) deleted[name] = (await collection.deleteMany({ _id: { $in: ids } })).deletedCount || 0;
    }));
  }
  return { operationId, archived: rows.length, deleted };
}

/** GET /api/admin/archive: one row per archive operation, newest first. */
export async function listArchiveOperations(db, limit = 100) {
  if (!db) throw new ArchiveError(503, "MongoDB nicht verbunden.");
  const safeLimit = Math.max(1, Math.min(Number.parseInt(String(limit || 100), 10) || 100, 250));
  const grouped = await db.collection("data_archive").aggregate([
    { $sort: { archivedAt: -1 } },
    {
      $group: {
        _id: "$operationId",
        operation: { $first: "$operation" },
        target: { $first: "$target" },
        archivedAt: { $first: "$archivedAt" },
        archivedBy: { $first: "$archivedBy" },
        collections: { $addToSet: "$collection" },
        recordCount: { $sum: 1 },
        restoredCount: { $sum: { $cond: [{ $ne: ["$restoredAt", null] }, 1, 0] } },
        restoredAt: { $max: "$restoredAt" },
      },
    },
    { $sort: { archivedAt: -1 } },
    { $limit: safeLimit },
  ]).toArray();
  return grouped.map((row) => ({
    operationId: String(row._id ?? ""),
    operation: row.operation ?? null,
    target: row.target ?? null,
    archivedAt: row.archivedAt ?? null,
    archivedBy: row.archivedBy ?? null,
    collections: [...(row.collections || [])].map(String).sort(),
    recordCount: Number(row.recordCount || 0),
    restoredCount: Number(row.restoredCount || 0),
    restoredAt: row.restoredAt ?? null,
  }));
}

/** Puts an archive operation back, unless newer active data would be overwritten. */
export async function restoreArchivedOperation(db, operationId, { ip = "-", now = new Date() } = {}) {
  if (!db) throw new ArchiveError(503, "MongoDB nicht verbunden.");
  const id = String(operationId || "").trim();
  if (!/^arc_[A-Za-z0-9_-]{12,80}$/.test(id)) throw new ArchiveError(409, "Ungültige Archiv-ID.");
  const archive = db.collection("data_archive");
  const rows = await archive.find({ operationId: id, restoredAt: null }).sort({ archivedAt: 1 }).toArray();
  if (!rows.length) {
    if (await archive.findOne({ operationId: id })) throw new ArchiveError(409, "Dieser Archivvorgang wurde bereits wiederhergestellt.");
    throw new ArchiveError(404, "Archivvorgang nicht gefunden.");
  }
  const restoreRows = rows.map((row) => {
    const name = String(row.collection || "");
    const payload = row.payload;
    if (!ARCHIVABLE_COLLECTIONS.has(name) || !payload || typeof payload !== "object" || payload._id === undefined || payload._id === null) {
      throw new ArchiveError(409, "Archiv enthält einen nicht wiederherstellbaren Datensatz.");
    }
    return [name, payload, row.originalId];
  });
  const existing = await Promise.all(restoreRows.map(([name, payload]) => db.collection(name).findOne({ _id: payload._id })));
  const conflicts = restoreRows
    .filter(([, payload], index) => existing[index] !== null && !isDeepStrictEqual(existing[index], payload))
    .map(([name, payload, originalId]) => `${name}:${originalId || payload._id}`);
  if (conflicts.length) {
    throw new ArchiveError(409, `Wiederherstellung würde neuere aktive Daten überschreiben: ${conflicts.slice(0, 8).join(", ")}`);
  }
  // Nothing is written before every record was checked.
  await Promise.all(restoreRows.map(([name, payload]) => db.collection(name).replaceOne({ _id: payload._id }, payload, { upsert: true })));
  const restoredAt = now.toISOString();
  await archive.updateMany({ operationId: id, restoredAt: null }, { $set: { restoredAt, restoredBy: "owner", restoredIp: ip } });
  return { operationId: id, restored: restoreRows.length, restoredAt };
}
