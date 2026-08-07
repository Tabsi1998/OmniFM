import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, logStoreLoadError } from "./lib/logging.js";
import { validateOutboundUrl, validateOutboundUrlWithDns } from "./lib/safe-outbound-http.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_CUSTOM_FILE = path.resolve(__dirname, "..", "custom-stations.json");
const CUSTOM_FILE = path.resolve(process.env.OMNIFM_CUSTOM_STATIONS_FILE || DEFAULT_CUSTOM_FILE);
const CUSTOM_BACKUP_FILE = `${CUSTOM_FILE}.bak`;
const MAX_STATIONS_PER_GUILD = 50;
const MAX_TAGS_PER_STATION = 8;
const MAX_FOLDER_LENGTH = 40;
const MAX_TAG_LENGTH = 24;
const CUSTOM_STATION_PREFIX = "custom:";

function normalizeWhitespace(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

function readStationsFile(filePath) {
  if (!fs.existsSync(filePath)) return null;
  if (fs.statSync(filePath).isDirectory()) {
    log("WARN", `[custom-stations] ${filePath} ist ein Verzeichnis - ueberspringe.`);
    return null;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

function load() {
  const candidates = [CUSTOM_FILE, CUSTOM_BACKUP_FILE];
  for (const filePath of candidates) {
    try {
      const data = readStationsFile(filePath);
      if (data) {
        if (filePath === CUSTOM_BACKUP_FILE) {
          log("WARN", "[custom-stations] Verwende Backup-Datei custom-stations.json.bak");
        }
        // Migrate legacy array-per-guild format to canonical object-per-guild format
        let migrated = false;
        for (const [gid, value] of Object.entries(data)) {
          if (Array.isArray(value)) {
            const objMap = {};
            for (const item of value) {
              const key = sanitizeKey(item.id || item.key || item.name || "");
              if (!key) continue;
              objMap[key] = {
                name: String(item.name || item.title || key).trim().substring(0, 100),
                url: String(item.streamURL || item.url || item.streamUrl || "").trim(),
                genre: String(item.genre || "").trim().substring(0, 80),
                folder: normalizeCustomStationFolder(item.folder || item.group || ""),
                tags: normalizeCustomStationTags(item.tags),
                addedAt: item.addedAt || new Date().toISOString(),
              };
            }
            data[gid] = objMap;
            migrated = true;
          }
        }
        if (migrated) {
          try {
            save(data);
            log("INFO", "[custom-stations] Migration: legacy array format konvertiert und gespeichert.");
          } catch (err) {
            log("ERROR", `[custom-stations] Migration Save failed: ${err?.message || err}`);
          }
        }
        return data;
      }
    } catch (err) {
      logStoreLoadError("custom-stations", filePath, err);
    }
  }
  return {};
}

function save(data) {
  const tmpFile = `${CUSTOM_FILE}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (fs.existsSync(CUSTOM_FILE) && fs.statSync(CUSTOM_FILE).isDirectory()) {
      log("WARN", `[custom-stations] ${CUSTOM_FILE} ist ein Verzeichnis - Speichern uebersprungen.`);
      return;
    }

    if (fs.existsSync(CUSTOM_FILE)) {
      try {
        fs.copyFileSync(CUSTOM_FILE, CUSTOM_BACKUP_FILE);
      } catch (copyErr) {
        log("ERROR", `[custom-stations] Backup warnung: ${copyErr.message}`);
      }
    }

    fs.writeFileSync(tmpFile, JSON.stringify(data, null, 2) + "\n", "utf8");
    try {
      fs.renameSync(tmpFile, CUSTOM_FILE);
    } catch (renameErr) {
      const code = String(renameErr?.code || "");
      if (["EBUSY", "EPERM", "EACCES", "EXDEV"].includes(code)) {
        fs.writeFileSync(CUSTOM_FILE, JSON.stringify(data, null, 2) + "\n", "utf8");
        log("WARN", `[custom-stations] Atomic rename nicht moeglich (${code}), nutze direkten Write-Fallback.`);
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    log("ERROR", `[custom-stations] Save error: ${err.message}`);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

function sanitizeKey(raw) {
  return String(raw || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").substring(0, 40);
}

function normalizeCustomStationKey(raw) {
  return sanitizeKey(raw);
}

function normalizeCustomStationFolder(raw) {
  return normalizeWhitespace(raw).substring(0, MAX_FOLDER_LENGTH);
}

function normalizeCustomStationTags(rawTags) {
  const source = Array.isArray(rawTags)
    ? rawTags
    : typeof rawTags === "string"
      ? rawTags.split(/[,\n]/g)
      : [];

  const tags = [];
  const seen = new Set();
  for (const rawTag of source) {
    const value = normalizeWhitespace(rawTag).substring(0, MAX_TAG_LENGTH);
    if (!value) continue;
    const normalizedKey = value.toLowerCase();
    if (seen.has(normalizedKey)) continue;
    seen.add(normalizedKey);
    tags.push(value);
    if (tags.length >= MAX_TAGS_PER_STATION) break;
  }

  return tags;
}

function normalizeStoredStation(station, fallbackKey = "") {
  const raw = station && typeof station === "object" ? station : {};
  return {
    name: String(raw.name || raw.title || fallbackKey).trim().substring(0, 100),
    url: String(raw.url || raw.streamURL || raw.streamUrl || "").trim(),
    genre: String(raw.genre || "").trim().substring(0, 80),
    folder: normalizeCustomStationFolder(raw.folder || raw.group || ""),
    tags: normalizeCustomStationTags(raw.tags),
    addedAt: raw.addedAt || null,
  };
}

function buildCustomStationReference(rawKey) {
  const key = normalizeCustomStationKey(rawKey);
  return key ? `${CUSTOM_STATION_PREFIX}${key}` : null;
}

function parseCustomStationReference(rawReference) {
  const raw = String(rawReference || "").trim().toLowerCase();
  if (!raw.startsWith(CUSTOM_STATION_PREFIX)) {
    return { isCustom: false, key: null, reference: null };
  }

  const key = normalizeCustomStationKey(raw.slice(CUSTOM_STATION_PREFIX.length));
  if (!key) {
    return { isCustom: true, key: null, reference: null };
  }

  return {
    isCustom: true,
    key,
    reference: `${CUSTOM_STATION_PREFIX}${key}`,
  };
}

function validateCustomStationUrl(rawUrl) {
  const validation = validateOutboundUrl(rawUrl, {
    allowedProtocols: ["http:", "https:"],
  });
  if (!validation.ok) return validation;
  return { ok: true, url: validation.url };
}

async function validateCustomStationUrlWithDns(rawUrl, options = {}) {
  return validateOutboundUrlWithDns(rawUrl, {
    ...options,
    allowedProtocols: ["http:", "https:"],
  });
}

function getGuildStations(guildId) {
  const data = load();
  const rawStations = data[String(guildId)] || {};
  const stations = {};
  for (const [key, station] of Object.entries(rawStations)) {
    stations[key] = normalizeStoredStation(station, key);
  }
  return stations;
}

function normalizeStationInput(nameOrStation, url) {
  if (nameOrStation && typeof nameOrStation === "object" && !Array.isArray(nameOrStation)) {
    return {
      name: String(nameOrStation.name || "").trim(),
      url: String(nameOrStation.url || nameOrStation.streamURL || nameOrStation.streamUrl || "").trim(),
      genre: String(nameOrStation.genre || "").trim().substring(0, 80),
      folder: normalizeCustomStationFolder(nameOrStation.folder || ""),
      tags: normalizeCustomStationTags(nameOrStation.tags),
    };
  }

  return {
    name: String(nameOrStation || "").trim(),
    url: String(url || "").trim(),
    genre: "",
    folder: "",
    tags: [],
  };
}

async function saveGuildStation(guildId, key, nameOrStation, url, options = {}) {
  const data = load();
  const gid = String(guildId);
  if (!data[gid]) data[gid] = {};

  const sKey = sanitizeKey(key);
  if (!sKey) return { error: "Ungültiger Station-Key." };

  const existingStation = data[gid][sKey];
  if (!existingStation && Object.keys(data[gid]).length >= MAX_STATIONS_PER_GUILD) {
    return { error: `Maximum ${MAX_STATIONS_PER_GUILD} Custom-Stationen erreicht.` };
  }
  if (!options?.overwrite && existingStation) {
    return { error: `Station mit Key '${sKey}' existiert bereits.` };
  }

  const stationInput = normalizeStationInput(nameOrStation, url);
  if (!stationInput.name) return { error: "Name darf nicht leer sein." };
  if (!stationInput.url) return { error: "URL darf nicht leer sein." };

  const validation = await validateCustomStationUrlWithDns(stationInput.url);
  if (!validation.ok) return { error: validation.error };

  data[gid][sKey] = {
    name: stationInput.name.substring(0, 100),
    url: validation.url,
    genre: stationInput.genre,
    folder: stationInput.folder,
    tags: stationInput.tags,
    addedAt: existingStation?.addedAt || new Date().toISOString(),
  };
  save(data);
  return { success: true, key: sKey, station: data[gid][sKey] };
}

async function addGuildStation(guildId, key, nameOrStation, url) {
  return saveGuildStation(guildId, key, nameOrStation, url, { overwrite: false });
}

async function updateGuildStation(guildId, key, nameOrStation, url) {
  return saveGuildStation(guildId, key, nameOrStation, url, { overwrite: true });
}

function removeGuildStation(guildId, key) {
  const data = load();
  const gid = String(guildId);
  const sKey = sanitizeKey(key);
  if (!data[gid] || !data[gid][sKey]) return false;
  delete data[gid][sKey];
  if (Object.keys(data[gid]).length === 0) delete data[gid];
  save(data);
  return true;
}

function listGuildStations(guildId) {
  return getGuildStations(guildId);
}

function countGuildStations(guildId) {
  return Object.keys(getGuildStations(guildId)).length;
}

function clearGuildStations(guildId) {
  const data = load();
  delete data[String(guildId)];
  save(data);
}

// Legacy aliases used by older runtime code.
const addCustomStation = addGuildStation;
const updateCustomStation = updateGuildStation;
const removeCustomStation = removeGuildStation;
const listCustomStations = listGuildStations;

export {
  CUSTOM_STATION_PREFIX,
  MAX_STATIONS_PER_GUILD,
  MAX_TAGS_PER_STATION,
  normalizeCustomStationKey,
  normalizeCustomStationFolder,
  normalizeCustomStationTags,
  buildCustomStationReference,
  parseCustomStationReference,
  validateCustomStationUrl,
  validateCustomStationUrlWithDns,
  getGuildStations, addGuildStation, removeGuildStation,
  updateGuildStation,
  listGuildStations, countGuildStations, clearGuildStations,
  addCustomStation, updateCustomStation, removeCustomStation, listCustomStations,
};
