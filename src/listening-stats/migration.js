// OmniFM: listening stats: the one-time copy of listening-stats.json into MongoDB.
// Split out of src/listening-stats-store.js (#295).
import { getDb } from "../lib/db.js";
import { log } from "../lib/logging.js";
import { ensureState, useMongo } from "../listening-stats-store.js";

/**
 * Listening sessions kept their start and end as text, so MongoDB's 180-day
 * TTL on endedAt never removed one. Turns every such text into a date; a text
 * that is no date stays as it was. Runs on every start and finds nothing once
 * everything is converted.
 */
export async function convertSessionDates(db = getDb()) {
  if (!db) return 0;
  const asDate = (field) => ({ $convert: { input: `$${field}`, to: "date", onError: `$${field}`, onNull: `$${field}` } });
  const result = await db.collection("listening_sessions").updateMany(
    { $or: [{ startedAt: { $type: "string" } }, { endedAt: { $type: "string" } }] },
    [{ $set: { startedAt: asDate("startedAt"), endedAt: asDate("endedAt") } }],
  );
  return Number(result?.modifiedCount || 0);
}

// ============================================================
// Migration: Import JSON data to MongoDB on first connect
// ============================================================
export async function migrateJsonToMongo() {
  if (!useMongo()) return { migrated: false, reason: "mongodb-not-connected" };

  const db = getDb();
  try {
    const converted = await convertSessionDates(db);
    if (converted) log("INFO", `Listening-Sessions: ${converted} Zeitangaben in Datumswerte umgewandelt; die Löschung nach 180 Tagen greift jetzt.`);
  } catch (err) {
    log("WARN", `Listening-Sessions: Umwandlung der Zeitangaben fehlgeschlagen: ${err?.message || err}`);
  }
  const existingCount = await db.collection("guild_stats").countDocuments();
  if (existingCount > 0) return { migrated: false, reason: "data-exists" };

  const state = ensureState();
  const guilds = Object.values(state.guilds);
  if (guilds.length === 0) return { migrated: false, reason: "no-json-data" };

  let migrated = 0;
  for (const guildStats of guilds) {
    try {
      const doc = { ...guildStats };
      delete doc._id;
      doc.createdAt = new Date();
      doc.migratedFromJson = true;
      // eslint-disable-next-line no-await-in-loop -- a one-time copy, one server after the other
      await db.collection("guild_stats").updateOne(
        { guildId: doc.guildId },
        { $set: doc },
        { upsert: true }
      );
      const gid = doc.guildId;
      const dailyStats = state.dailyStats?.[gid] || [];
      const sessionHistory = state.sessionHistory?.[gid] || [];
      const connectionEvents = state.connectionEvents?.[gid] || [];
      const listenerSnapshots = state.listenerSnapshots?.[gid] || [];

      for (const day of dailyStats) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection("daily_stats").updateOne(
          { guildId: gid, date: day.date },
          {
            $set: {
              guildId: gid,
              date: day.date,
              totalStarts: day.totalStarts || 0,
              totalListeningMs: day.totalListeningMs || 0,
              totalSessions: day.totalSessions || 0,
              peakListeners: day.peakListeners || 0,
              createdAt: new Date(),
            },
          },
          { upsert: true }
        );
      }

      if (sessionHistory.length) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection("listening_sessions").insertMany(
          sessionHistory.map((entry) => ({
            ...entry,
            guildId: gid,
            startedAt: new Date(entry.startedAt),
            endedAt: new Date(entry.endedAt),
          })),
          { ordered: false }
        ).catch(() => null);
      }

      if (connectionEvents.length) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection("connection_events").insertMany(
          connectionEvents.map((entry) => ({
            ...entry,
            guildId: gid,
            timestamp: new Date(entry.timestamp),
          })),
          { ordered: false }
        ).catch(() => null);
      }

      if (listenerSnapshots.length) {
        // eslint-disable-next-line no-await-in-loop
        await db.collection("listener_snapshots").insertMany(
          listenerSnapshots.map((entry) => ({
            ...entry,
            guildId: gid,
            timestamp: new Date(entry.timestamp),
          })),
          { ordered: false }
        ).catch(() => null);
      }
      migrated++;
    } catch (err) {
      log("WARN", `Migration Guild ${guildStats.guildId} fehlgeschlagen: ${err?.message || err}`);
    }
  }

  log("INFO", `JSON -> MongoDB Migration: ${migrated}/${guilds.length} Guilds migriert.`);
  return { migrated: true, count: migrated, total: guilds.length };
}
