// ============================================================
// stations-store.js – MongoDB-basiert (mit JSON-Fallback)
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { getDb } from "./lib/db.js";
import { withFileStoreLock } from "./lib/file-store-lock.js";
import { log, logStoreLoadError } from "./lib/logging.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

const stationsPath = resolveRuntimeDataPath("stations.json");

const QUALITY_PRESETS = new Set(["low", "medium", "high", "custom"]);
const COLLECTION = "stations";
const CONFIG_COLLECTION = "stations_config";
const CATALOG_MIGRATIONS_COLLECTION = "stations_catalog_migrations";

const TOMORROWLAND_ANTHEMS_LEGACY_URL = "https://playerservices.streamtheworld.com/api/livestream-redirect/OWR_DAB.mp3";
const TOMORROWLAND_ANTHEMS_URL = "https://playerservices.streamtheworld.com/api/livestream-redirect/OWR_ANTHEMS.mp3";

export const STATION_CATALOG_MIGRATIONS = Object.freeze([
  Object.freeze({
    id: "2026-08-22-tomorrowland-anthems-url",
    key: "protml03",
    keys: Object.freeze(["protml03", "pro_tml_03"]),
    fromUrl: TOMORROWLAND_ANTHEMS_LEGACY_URL,
    toUrl: TOMORROWLAND_ANTHEMS_URL,
  }),
]);

function col() { const db = getDb(); return db ? db.collection(COLLECTION) : null; }
function configCol() { const db = getDb(); return db ? db.collection(CONFIG_COLLECTION) : null; }
function catalogMigrationsCol() { const db = getDb(); return db ? db.collection(CATALOG_MIGRATIONS_COLLECTION) : null; }

function isDuplicateKeyError(err) {
  return Number(err?.code) === 11000 || /E11000\s+duplicate\s+key/i.test(String(err?.message || ""));
}

/**
 * Applies narrowly-scoped built-in catalog migrations before the catalog is read.
 *
 * Each station write has an exact legacy URL filter and only known catalog-key
 * representations, so a dashboard or operator override is never replaced. The
 * completion marker is inserted only after the catalog write succeeds. Multiple
 * split workers can safely race this: their exact writes are idempotent and a
 * duplicate marker means another process already completed the same migration.
 */
export async function applyStationCatalogMigrations(stationsCollection, migrationsCollection) {
  if (!stationsCollection || !migrationsCollection) return { applied: [], skipped: [] };

  const applied = [];
  const skipped = [];

  for (const migration of STATION_CATALOG_MIGRATIONS) {
    const marker = await migrationsCollection.findOne(
      { _id: migration.id },
      { projection: { _id: 1 } }
    );
    if (marker) {
      skipped.push({ id: migration.id, reason: "already-applied" });
      continue;
    }

    const updateResult = await stationsCollection.updateMany(
      { key: { $in: migration.keys }, url: migration.fromUrl },
      { $set: { url: migration.toUrl } }
    );
    if (updateResult?.acknowledged === false) {
      throw new Error(`Katalogmigration ${migration.id} wurde von MongoDB nicht bestaetigt.`);
    }

    const markerDocument = {
      _id: migration.id,
      appliedAt: new Date(),
      key: migration.key,
      keys: migration.keys,
      fromUrl: migration.fromUrl,
      toUrl: migration.toUrl,
      matchedCount: Number(updateResult?.matchedCount || 0),
      modifiedCount: Number(updateResult?.modifiedCount || 0),
    };

    try {
      const markerResult = await migrationsCollection.insertOne(markerDocument);
      if (markerResult?.acknowledged === false) {
        throw new Error(`Katalogmigration ${migration.id} konnte nicht als abgeschlossen markiert werden.`);
      }
      applied.push({ id: migration.id, ...markerDocument, markerWritten: true });
    } catch (err) {
      if (!isDuplicateKeyError(err)) throw err;
      applied.push({ id: migration.id, ...markerDocument, markerWritten: false });
    }
  }

  return { applied, skipped };
}

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function writeStationsFileAtomically(filePath, data) {
  const tempPath = `${filePath}.tmp-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const serialized = `${JSON.stringify(data, null, 2)}\n`;

  try {
    fs.writeFileSync(tempPath, serialized, "utf8");
    fs.renameSync(tempPath, filePath);
  } finally {
    try { fs.unlinkSync(tempPath); } catch {}
  }
}

/**
 * Migrates the mutable runtime-data catalog when MongoDB is unavailable.
 * Only the sanitized key protml03 with the exact retired URL is changed; all
 * other catalog fields and operator overrides are preserved unchanged.
 */
export function migrateStationsFileCatalog(filePath = stationsPath) {
  if (!fs.existsSync(filePath)) return { changed: false, reason: "missing-file" };
  if (!fs.statSync(filePath).isFile()) return { changed: false, reason: "not-a-file" };

  return withFileStoreLock(filePath, () => {
    // The file may have changed while this process waited for another worker.
    if (!fs.existsSync(filePath)) return { changed: false, reason: "missing-file" };
    if (!fs.statSync(filePath).isFile()) return { changed: false, reason: "not-a-file" };

    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (!isRecord(data) || !isRecord(data.stations)) {
      return { changed: false, reason: "invalid-catalog" };
    }

    let matchedCount = 0;
    for (const [rawKey, station] of Object.entries(data.stations)) {
      if (!isRecord(station)) continue;
      if (sanitizeKey(rawKey) !== "protml03") continue;
      if (station.url !== TOMORROWLAND_ANTHEMS_LEGACY_URL) continue;
      station.url = TOMORROWLAND_ANTHEMS_URL;
      matchedCount += 1;
    }

    if (matchedCount === 0) return { changed: false, matchedCount: 0 };

    writeStationsFileAtomically(filePath, data);
    return { changed: true, matchedCount };
  });
}

function emptyStationsData() {
  return { defaultStationKey: null, stations: {}, locked: false, qualityPreset: "custom", fallbackKeys: [] };
}

function cloneStationMap(stationsInput) {
  const out = {};
  if (!stationsInput || typeof stationsInput !== "object") return out;
  for (const [key, station] of Object.entries(stationsInput)) {
    out[key] = station && typeof station === "object" ? { ...station } : station;
  }
  return out;
}

function sanitizeKey(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function sanitizeStations(stationsInput) {
  const out = {};
  if (!stationsInput || typeof stationsInput !== "object") return out;
  for (const [rawKey, rawValue] of Object.entries(stationsInput)) {
    const key = sanitizeKey(rawKey);
    const name = String(rawValue?.name || "").trim();
    const url = String(rawValue?.url || "").trim();
    if (!key || !name || !url) continue;
    const tier = String(rawValue?.tier || "free").toLowerCase();
    out[key] = {
      name,
      url,
      tier: ["free", "pro", "ultimate"].includes(tier) ? tier : "free",
      genre: String(rawValue?.genre || rawValue?.category || "Radio").trim().slice(0, 80) || "Radio",
      country: String(rawValue?.country || "").trim().slice(0, 60),
      language: String(rawValue?.language || "").trim().slice(0, 40),
    };
  }
  return out;
}

export function normalizeStationsData(input) {
  const base = emptyStationsData();
  if (!input || typeof input !== "object") return base;
  const stations = sanitizeStations(input.stations);
  const stationKeys = Object.keys(stations);
  const defaultKey = sanitizeKey(input.defaultStationKey);
  const qualityPreset = String(input.qualityPreset || "custom").toLowerCase();
  const rawFallback = Array.isArray(input.fallbackKeys) ? input.fallbackKeys : [];
  const fallbackKeys = rawFallback.map((k) => sanitizeKey(k)).filter((k, idx, arr) => k && stations[k] && arr.indexOf(k) === idx);
  return {
    defaultStationKey: stations[defaultKey] ? defaultKey : stationKeys[0] || null,
    stations, locked: Boolean(input.locked),
    qualityPreset: QUALITY_PRESETS.has(qualityPreset) ? qualityPreset : "custom",
    fallbackKeys,
  };
}

function loadStationsFromFile() {
  try {
    const migration = migrateStationsFileCatalog();
    if (migration.changed) {
      log("INFO", `Stations-Dateikatalogmigration abgeschlossen: ${migration.matchedCount} Tomorrowland-Anthems-URL(s) aktualisiert`);
    }
  } catch (err) {
    // Keep the existing file fallback available; a failed migration never overwrites it.
    log("WARN", `Stations-Dateikatalogmigration fehlgeschlagen: ${err?.message || err}`);
  }

  if (!fs.existsSync(stationsPath)) return emptyStationsData();
  try {
    if (fs.statSync(stationsPath).isDirectory()) return emptyStationsData();
    const raw = fs.readFileSync(stationsPath, "utf8");
    return normalizeStationsData(JSON.parse(raw));
  } catch (err) {
    logStoreLoadError("stations", stationsPath, err);
    return emptyStationsData();
  }
}

export function loadStations() {
  const c = col();
  if (!c) return buildScopedStationsData(loadStationsFromFile());

  // Synchronous loading not possible with MongoDB driver; use cached version
  if (_stationsCache) return buildScopedStationsData(_stationsCache);
  return buildScopedStationsData(loadStationsFromFile());
}

let _stationsCache = null;

export async function initStationsStore() {
  const c = col();
  if (!c) {
    _stationsCache = loadStationsFromFile();
    return _stationsCache;
  }

  try {
    const migrationsCollection = catalogMigrationsCol();
    if (migrationsCollection) {
      try {
        const migrationResult = await applyStationCatalogMigrations(c, migrationsCollection);
        const writtenMarkers = migrationResult.applied.filter((entry) => entry.markerWritten);
        if (writtenMarkers.length > 0) {
          log("INFO", `Stations-Katalogmigration abgeschlossen: ${writtenMarkers.map((entry) => entry.id).join(", ")}`);
        }
      } catch (err) {
        // Do not hide an otherwise readable catalog when only its migration metadata fails.
        // No completion marker is written in this case, so a later startup retries safely.
        log("WARN", `Stations-Katalogmigration fehlgeschlagen: ${err?.message || err}`);
      }
    }

    const docs = await c.find({}, { projection: { _id: 0 } }).toArray();
    if (docs.length === 0) {
      // Seed from file
      const fileData = loadStationsFromFile();
      _stationsCache = fileData;
      return _stationsCache;
    }

    const stations = {};
    let defaultKey = null;
    for (const doc of docs) {
      const key = doc.key;
      if (key) {
        stations[key] = {
          name: doc.name || key,
          url: doc.url || "",
          tier: doc.tier || "free",
          genre: doc.genre || doc.category || "Radio",
          country: doc.country || "",
          language: doc.language || "",
        };
        if (doc.is_default) defaultKey = key;
      }
    }

    // Load config
    const cc = configCol();
    let config = {};
    if (cc) {
      try {
        config = (await cc.findOne({ _id: "main" })) || {};
      } catch {}
    }

    _stationsCache = normalizeStationsData({
      defaultStationKey: defaultKey || config.defaultStationKey || Object.keys(stations)[0] || null,
      stations,
      locked: config.locked || false,
      qualityPreset: config.qualityPreset || "custom",
      fallbackKeys: config.fallbackKeys || [],
    });

    log("INFO", `Stations geladen: ${Object.keys(stations).length} Sender`);
    return _stationsCache;
  } catch (err) {
    log("WARN", `Stations aus DB laden fehlgeschlagen: ${err.message}, Fallback auf Datei`);
    _stationsCache = loadStationsFromFile();
    return _stationsCache;
  }
}

export async function saveStations(data) {
  const normalized = normalizeStationsData(data);
  _stationsCache = normalized;

  const c = col();
  if (c) {
    try {
      // Update MongoDB
      const bulkOps = [];
      for (const [key, station] of Object.entries(normalized.stations)) {
        bulkOps.push({
          updateOne: {
            filter: { key },
            update: {
              $set: {
                key, name: station.name, url: station.url, tier: station.tier,
                is_default: key === normalized.defaultStationKey,
              },
            },
            upsert: true,
          },
        });
      }
      if (bulkOps.length > 0) await c.bulkWrite(bulkOps);

      // Remove deleted stations
      const existingDocs = await c.find({}, { projection: { _id: 0, key: 1 } }).toArray();
      const toDelete = existingDocs.filter((d) => !normalized.stations[d.key]).map((d) => d.key);
      if (toDelete.length > 0) await c.deleteMany({ key: { $in: toDelete } });

      // Save config
      const cc = configCol();
      if (cc) {
        await cc.replaceOne({ _id: "main" }, {
          _id: "main",
          defaultStationKey: normalized.defaultStationKey,
          locked: normalized.locked,
          qualityPreset: normalized.qualityPreset,
          fallbackKeys: normalized.fallbackKeys,
        }, { upsert: true });
      }
    } catch (err) {
      log("ERROR", `Stations speichern: ${err.message}`);
    }
  }

  // Also save to file as backup
  try {
    const serialized = JSON.stringify(normalized, null, 2);
    const tempPath = `${stationsPath}.tmp`;
    fs.writeFileSync(tempPath, serialized);
    try { fs.renameSync(tempPath, stationsPath); } catch { fs.writeFileSync(stationsPath, serialized); }
  } catch {}

  return normalized;
}

export function getStationsPath() { return stationsPath; }
export function isValidQualityPreset(preset) { return QUALITY_PRESETS.has(String(preset || "").toLowerCase()); }
export function normalizeKey(rawKey) { return sanitizeKey(rawKey); }

export function buildScopedStationsData(source, scopedStations = null) {
  const sourceData = source && typeof source === "object" ? source : emptyStationsData();
  const stations = cloneStationMap(scopedStations ?? sourceData.stations);
  const stationKeys = Object.keys(stations);
  const defaultStationKey = stations[sourceData.defaultStationKey] ? sourceData.defaultStationKey : (stationKeys[0] || null);
  const qualityPreset = String(sourceData.qualityPreset || "custom").toLowerCase();
  const fallbackKeys = Array.isArray(sourceData.fallbackKeys)
    ? sourceData.fallbackKeys.filter((key, idx, arr) => stations[key] && arr.indexOf(key) === idx)
    : [];

  return {
    defaultStationKey,
    stations,
    locked: Boolean(sourceData.locked),
    qualityPreset: QUALITY_PRESETS.has(qualityPreset) ? qualityPreset : "custom",
    fallbackKeys,
  };
}

export function resolveStation(stations, key) {
  if (!key) {
    return stations.stations[stations.defaultStationKey] ? stations.defaultStationKey : Object.keys(stations.stations)[0] || null;
  }
  return stations.stations[key] ? key : null;
}

export function getFallbackKey(stations, currentKey) {
  if (Array.isArray(stations.fallbackKeys) && stations.fallbackKeys.length) {
    const next = stations.fallbackKeys.find((k) => stations.stations[k] && k !== currentKey);
    if (next) return next;
  }
  if (stations.defaultStationKey && stations.defaultStationKey !== currentKey) return stations.defaultStationKey;
  const keys = Object.keys(stations.stations);
  return keys.find((k) => k !== currentKey) || null;
}

const TIER_RANK = { free: 0, pro: 1, ultimate: 2 };

export function filterStationsByTier(stations, guildTier) {
  const rank = TIER_RANK[guildTier] ?? 0;
  const filtered = {};
  for (const [key, station] of Object.entries(stations)) {
    if (String(key || "").trim().toLowerCase().startsWith("custom:")) continue;
    const stationRank = TIER_RANK[station.tier || "free"] ?? 0;
    if (stationRank <= rank) filtered[key] = station;
  }
  return filtered;
}
