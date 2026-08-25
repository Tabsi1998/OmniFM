import { MongoClient } from "mongodb";
import { log } from "./logging.js";

const MONGO_URL = process.env.MONGO_URL || "mongodb://localhost:27017";
const DB_NAME = process.env.DB_NAME || "radio_bot";

let client = null;
let db = null;
let connectPromise = null;
let initialized = false;

// ---- Fix: Echter Verbindungsstatus-Check ----
// db !== null reicht nicht – der Client kann disconnected sein ohne dass db null wird.
function isConnected() {
  if (!client || !db) return false;
  // MongoClient.topology ist die interne Verbindungsschicht.
  // isConnected() auf der Topology gibt den echten Status zurück.
  try {
    return client.topology?.isConnected?.() === true;
  } catch {
    return false;
  }
}

async function initCollections(database) {
  if (initialized) return;
  try {
    const existing = await database.listCollections().toArray();
    const names = new Set(existing.map((c) => c.name));

    // listening_sessions: anonymous session tracking
    if (!names.has("listening_sessions")) {
      await database.createCollection("listening_sessions");
    }
    await database.collection("listening_sessions").createIndexes([
      { key: { guildId: 1, startedAt: -1 }, name: "guild_time" },
      { key: { guildId: 1, stationKey: 1 }, name: "guild_station" },
      { key: { endedAt: 1 }, name: "ended", expireAfterSeconds: 86400 * 180 },
    ]).catch(() => null);

    // daily_stats: per-guild daily aggregates
    if (!names.has("daily_stats")) {
      await database.createCollection("daily_stats");
    }
    await database.collection("daily_stats").createIndexes([
      { key: { guildId: 1, date: -1 }, name: "guild_date", unique: true },
    ]).catch(() => null);

    // connection_events: connection health log
    if (!names.has("connection_events")) {
      await database.createCollection("connection_events");
    }
    await database.collection("connection_events").createIndexes([
      { key: { guildId: 1, timestamp: -1 }, name: "guild_time" },
      { key: { timestamp: 1 }, name: "ttl", expireAfterSeconds: 86400 * 90 },
    ]).catch(() => null);

    // runtime_incidents: recent reliability incidents for dashboard health history
    if (!names.has("runtime_incidents")) {
      await database.createCollection("runtime_incidents");
    }
    await database.collection("runtime_incidents").createIndexes([
      { key: { guildId: 1, timestamp: -1 }, name: "guild_time" },
      { key: { guildId: 1, id: 1 }, name: "guild_incident_id" },
      { key: { timestamp: 1 }, name: "ttl", expireAfterSeconds: 86400 * 90 },
    ]).catch(() => null);

    // guild_stats: aggregated stats per guild
    if (!names.has("guild_stats")) {
      await database.createCollection("guild_stats");
    }
    await database.collection("guild_stats").createIndexes([
      { key: { guildId: 1 }, name: "guild_unique", unique: true },
    ]).catch(() => null);

    // listener_snapshots: periodic listener count samples
    if (!names.has("listener_snapshots")) {
      await database.createCollection("listener_snapshots");
    }
    await database.collection("listener_snapshots").createIndexes([
      { key: { guildId: 1, timestamp: -1 }, name: "guild_time" },
      { key: { timestamp: 1 }, name: "ttl", expireAfterSeconds: 86400 * 30 },
    ]).catch(() => null);

    // guild_settings: per-guild settings (weekly digest, fallback station)
    if (!names.has("guild_settings")) {
      await database.createCollection("guild_settings");
    }
    await database.collection("guild_settings").createIndexes([
      { key: { guildId: 1 }, name: "guild_unique", unique: true },
    ]).catch(() => null);

    // Shared licensing store used by FastAPI, Commander and workers.
    await database.collection("licenses").createIndex({ _licenseId: 1 }, { name: "license_id", unique: true }).catch(() => null);
    await database.collection("server_entitlements").createIndex({ _serverId: 1 }, { name: "server_id", unique: true }).catch(() => null);
    await database.collection("processed_sessions").createIndex({ _sessionId: 1 }, { name: "session_id", unique: true }).catch(() => null);
    await database.collection("processed_events").createIndex({ _eventId: 1 }, { name: "event_id", unique: true }).catch(() => null);

    initialized = true;
    log("INFO", "MongoDB Kollektionen und Indizes initialisiert.");
  } catch (err) {
    log("WARN", `MongoDB initCollections Fehler: ${err?.message || err}`);
  }
}

async function connect() {
  // ---- Fix: Prüfe echten Verbindungsstatus, nicht nur db !== null ----
  if (db && isConnected()) return db;

  // Falls ein laufendes Connect-Promise existiert, darauf warten
  if (connectPromise) return connectPromise;

  connectPromise = (async () => {
    try {
      // Alten Client aufräumen falls vorhanden aber disconnected
      if (client) {
        try { await client.close(); } catch { /* ignore */ }
        client = null;
        db = null;
        initialized = false;
      }

      client = new MongoClient(MONGO_URL, {
        serverSelectionTimeoutMS: 5000,
        connectTimeoutMS: 5000,
        // ---- Fix: MongoClient hat eingebautes Connection-Pooling + Auto-Reconnect ----
        // maxPoolSize sorgt dafür dass bei kurzen Ausfällen Verbindungen wiederhergestellt werden
        maxPoolSize: 10,
        minPoolSize: 1,
        socketTimeoutMS: 30000,
        heartbeatFrequencyMS: 10000,
      });

      // ---- Fix: Auf Verbindungsverlust reagieren ----
      client.on("close", () => {
        log("WARN", "[MongoDB] Verbindung getrennt (close event).");
        // db und connectPromise zurücksetzen damit der nächste connect()-Aufruf
        // eine neue Verbindung aufbaut
        db = null;
        connectPromise = null;
        initialized = false;
      });

      client.on("error", (err) => {
        log("WARN", `[MongoDB] Client-Fehler: ${err?.message || err}`);
      });

      client.on("reconnect", () => {
        log("INFO", "[MongoDB] Verbindung wiederhergestellt.");
      });

      await client.connect();
      db = client.db(DB_NAME);
      log("INFO", `MongoDB verbunden: ${DB_NAME}`);
      await initCollections(db);
      return db;
    } catch (err) {
      connectPromise = null;
      db = null;
      throw err;
    }
  })();

  return connectPromise;
}

function getDb() {
  // ---- Fix: Gibt null zurück wenn nicht wirklich verbunden ----
  if (!isConnected()) return null;
  return db;
}

async function close() {
  if (client) {
    await client.close();
    client = null;
    db = null;
    connectPromise = null;
    initialized = false;
  }
}

export { connect, getDb, isConnected, close };
