// ============================================================
// stations-store.js – MongoDB-basiert (mit JSON-Fallback)
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { getDb } from "./lib/db.js";
import { log, logStoreLoadError } from "./lib/logging.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

const stationsPath = resolveRuntimeDataPath("stations.json");

const QUALITY_PRESETS = new Set(["low", "medium", "high", "custom"]);
const COLLECTION = "stations";
const CONFIG_COLLECTION = "stations_config";

function col() { const db = getDb(); return db ? db.collection(COLLECTION) : null; }
function configCol() { const db = getDb(); return db ? db.collection(CONFIG_COLLECTION) : null; }

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
    out[key] = { name, url, tier: ["free", "pro", "ultimate"].includes(tier) ? tier : "free" };
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
        stations[key] = { name: doc.name || key, url: doc.url || "", tier: doc.tier || "free" };
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
