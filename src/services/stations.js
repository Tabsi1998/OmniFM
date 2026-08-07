// ============================================================
// OmniFM - Station Service
// ============================================================

import fs from "node:fs";
import path from "node:path";
import net from "node:net";
import { fileURLToPath } from "node:url";
import { getServerPlan, planAtLeast, requireFeature } from "../core/entitlements.js";
import { log } from "../lib/logging.js";
import { resolveRuntimeDataPath } from "../lib/runtime-data-path.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.resolve(__dirname, "..", "..", "data");
const customFile = resolveRuntimeDataPath("custom-stations.json");

const MAX_CUSTOM_PER_SERVER = 50;

let _freeStations = [];
let _proStations = [];

function loadJsonSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return [];
    if (fs.statSync(filePath).isDirectory()) return [];
    return JSON.parse(fs.readFileSync(filePath, "utf-8"));
  } catch { return []; }
}

export function loadAllStations() {
  _freeStations = loadJsonSafe(path.join(dataDir, "stations.free.json"));
  _proStations = loadJsonSafe(path.join(dataDir, "stations.pro.json"));
  return { free: _freeStations.length, pro: _proStations.length };
}

// Initialize on first import
loadAllStations();

export function getAllFreeStations() { return _freeStations; }
export function getAllProStations() { return _proStations; }

export function getStationsForServer(serverId) {
  const plan = getServerPlan(serverId);
  let stations = [..._freeStations];

  if (planAtLeast(plan, "pro")) {
    stations = [...stations, ..._proStations];
  }

  if (planAtLeast(plan, "ultimate")) {
    const custom = getCustomStations(serverId);
    stations = [...stations, ...custom];
  }

  return stations;
}

export function getStationById(serverId, stationId) {
  const visible = getStationsForServer(serverId);
  return visible.find(s => s.id === stationId) || null;
}

export function findStation(serverId, query) {
  const q = String(query || "").toLowerCase().trim();
  if (!q) return null;
  const visible = getStationsForServer(serverId);
  return visible.find(s => s.id === q || s.name.toLowerCase() === q) ||
         visible.find(s => s.id.includes(q) || s.name.toLowerCase().includes(q)) ||
         null;
}

export function isStationAccessible(serverId, stationId) {
  const plan = getServerPlan(serverId);

  // Check free stations
  if (_freeStations.some(s => s.id === stationId)) return { ok: true };

  // Check pro stations
  if (_proStations.some(s => s.id === stationId)) {
    if (planAtLeast(plan, "pro")) return { ok: true };
    const station = _proStations.find(s => s.id === stationId);
    return { ok: false, station, requiredPlan: "pro" };
  }

  // Check custom stations
  const custom = getCustomStations(serverId);
  if (custom.some(s => s.id === stationId)) {
    if (planAtLeast(plan, "ultimate")) return { ok: true };
    return { ok: false, requiredPlan: "ultimate" };
  }

  return { ok: false, notFound: true };
}

// --- Custom Stations (Ultimate only) ---

function loadCustomData() {
  try {
    if (!fs.existsSync(customFile)) return {};
    if (fs.statSync(customFile).isDirectory()) return {};
    const raw = fs.readFileSync(customFile, "utf-8").trim();
    if (!raw) return {};
    return JSON.parse(raw);
  } catch { return {}; }
}

function saveCustomData(data) {
  try {
    if (fs.existsSync(customFile) && fs.statSync(customFile).isDirectory()) return;
    // Normalize legacy array format to canonical object-per-guild mapping before saving
    const normalized = {};
    for (const [gid, val] of Object.entries(data || {})) {
      if (Array.isArray(val)) {
        const obj = {};
        for (const item of val) {
          const id = String(item.id || item.key || item.name || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").substring(0, 40) || null;
          if (!id) continue;
          obj[id] = {
            name: item.name || item.title || id,
            url: item.streamURL || item.url || item.streamUrl || item.stream || "",
            bitrate: item.bitrate || 0,
            tags: item.tags || ["custom"],
            addedAt: item.addedAt || new Date().toISOString(),
          };
        }
        normalized[gid] = obj;
      } else if (val && typeof val === "object") {
        normalized[gid] = val;
      }
    }

    fs.writeFileSync(customFile, JSON.stringify(normalized, null, 2) + "\n", "utf-8");
  } catch (err) {
    log("ERROR", `[OmniFM] Custom stations save error: ${err.message}`);
  }
}

export function getCustomStations(serverId) {
  const data = loadCustomData();
  const raw = data[String(serverId)];
  if (!raw) return [];
  // Support both array (legacy) and object map (canonical)
  if (Array.isArray(raw)) {
    return raw.map(s => ({
      ...s,
      requiredPlan: "ultimate",
      tags: s.tags || ["custom"],
    }));
  }
  if (typeof raw === "object") {
    return Object.entries(raw).map(([key, s]) => ({
      id: String(key),
      name: s.name || s.title || key,
      streamURL: s.streamURL || s.url || s.streamUrl || s.stream || "",
      bitrate: s.bitrate || 0,
      tags: s.tags || ["custom"],
      requiredPlan: "ultimate",
      addedAt: s.addedAt || null,
    }));
  }
  return [];
}

export function addCustomStation(serverId, stationData) {
  const check = requireFeature(String(serverId), "customStationURLs");
  if (!check.ok) return { ok: false, message: check.message };

  const id = String(stationData.id || "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").substring(0, 40);
  const name = String(stationData.name || "").trim().substring(0, 100);
  const url = String(stationData.streamURL || stationData.url || "").trim();

  if (!id || !name || !url) return { ok: false, message: "id, name, and streamURL are required." };
  const urlCheck = validateStreamURL(url);
  if (!urlCheck.ok) return urlCheck;

  const data = loadCustomData();
  const arr = data[String(serverId)] || [];

  if (arr.length >= MAX_CUSTOM_PER_SERVER) {
    return { ok: false, message: `Maximum ${MAX_CUSTOM_PER_SERVER} custom stations per server.` };
  }
  if (arr.some(s => s.id === id)) {
    return { ok: false, message: `Station "${id}" already exists. Remove it first.` };
  }

  arr.push({ id, name, streamURL: url, bitrate: 0, tags: ["custom"], requiredPlan: "ultimate" });
  data[String(serverId)] = arr;
  saveCustomData(data);
  return { ok: true, station: arr[arr.length - 1] };
}

export function removeCustomStation(serverId, stationId) {
  const check = requireFeature(String(serverId), "customStationURLs");
  if (!check.ok) return { ok: false, message: check.message };

  const data = loadCustomData();
  const arr = data[String(serverId)] || [];
  const idx = arr.findIndex(s => s.id === stationId);
  if (idx === -1) return { ok: false, message: `Station "${stationId}" not found.` };

  arr.splice(idx, 1);
  data[String(serverId)] = arr;
  saveCustomData(data);
  return { ok: true };
}

function isPrivateIpv4(hostname) {
  const parts = String(hostname || "").split(".").map((p) => Number.parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return false;
  const [a, b] = parts;
  if (a === 10) return true;
  if (a === 127) return true;
  if (a === 169 && b === 254) return true;
  if (a === 172 && b >= 16 && b <= 31) return true;
  if (a === 192 && b === 168) return true;
  if (a === 100 && b >= 64 && b <= 127) return true;
  return false;
}

function legacyHostToIpv4(hostname) {
  const host = String(hostname || "").trim().toLowerCase();
  if (!host) return null;

  let value = null;
  if (/^\d+$/.test(host)) {
    value = BigInt(host);
  } else if (/^0x[0-9a-f]+$/i.test(host)) {
    value = BigInt(host);
  } else if (/^0[0-7]+$/.test(host) && host !== "0") {
    value = BigInt(`0o${host.slice(1)}`);
  }

  if (value === null) return null;
  if (value < 0n || value > 0xFFFFFFFFn) return null;

  const a = Number((value >> 24n) & 0xFFn);
  const b = Number((value >> 16n) & 0xFFn);
  const c = Number((value >> 8n) & 0xFFn);
  const d = Number(value & 0xFFn);
  return `${a}.${b}.${c}.${d}`;
}

export function validateStreamURL(url) {
  try {
    const parsed = new URL(url);
    if (!["http:", "https:"].includes(parsed.protocol)) {
      return { ok: false, message: "Only http/https URLs are allowed." };
    }
    if (parsed.username || parsed.password) {
      return { ok: false, message: "URLs with username/password are not allowed." };
    }

    const hostname = String(parsed.hostname || "").trim().toLowerCase().replace(/\.$/, "");
    if (
      !hostname
      || hostname === "localhost"
      || hostname === "0.0.0.0"
      || hostname.endsWith(".local")
      || hostname.endsWith(".internal")
      || hostname.endsWith(".lan")
      || hostname.endsWith(".home")
      || hostname.endsWith(".nip.io")
      || hostname.endsWith(".sslip.io")
    ) {
      return { ok: false, message: "Local URLs are not allowed." };
    }

    const legacyIpv4 = legacyHostToIpv4(hostname);
    if (legacyIpv4 && isPrivateIpv4(legacyIpv4)) {
      return { ok: false, message: "Local URLs are not allowed." };
    }

    const ipVersion = net.isIP(hostname);
    if (ipVersion === 4 && isPrivateIpv4(hostname)) {
      return { ok: false, message: "Local URLs are not allowed." };
    }
    if (ipVersion === 6) {
      if (
        hostname === "::1"
        || hostname === "::"
        || hostname.startsWith("fe80:")
        || hostname.startsWith("fc")
        || hostname.startsWith("fd")
        || hostname.startsWith("::ffff:127.")
      ) {
        return { ok: false, message: "Local URLs are not allowed." };
      }
    }

    return { ok: true };
  } catch {
    return { ok: false, message: "Invalid URL format." };
  }
}

export function getStationCounts() {
  return { free: _freeStations.length, pro: _proStations.length };
}
