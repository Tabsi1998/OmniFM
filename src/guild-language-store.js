import fs from "node:fs";
import path from "node:path";
import { getDefaultLanguage, normalizeLanguage } from "./i18n.js";
import { log, logStoreLoadError } from "./lib/logging.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

const STORE_FILE = resolveRuntimeDataPath("guild-languages.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;

function emptyState() {
  return {
    version: 1,
    guilds: {},
  };
}

function sanitizeGuildId(rawGuildId) {
  const guildId = String(rawGuildId || "").trim();
  return /^\d{17,22}$/.test(guildId) ? guildId : null;
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const guilds = source.guilds && typeof source.guilds === "object" ? source.guilds : {};
  const out = {};

  for (const [rawGuildId, rawLanguage] of Object.entries(guilds)) {
    const guildId = sanitizeGuildId(rawGuildId);
    if (!guildId) continue;
    out[guildId] = normalizeLanguage(rawLanguage, getDefaultLanguage());
  }

  return {
    version: 1,
    guilds: out,
  };
}

function readState(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch (err) {
    logStoreLoadError("guild-languages", filePath, err);
    return null;
  }
}

function loadState() {
  const primary = readState(STORE_FILE);
  if (primary) return primary;

  // Primary file is corrupt or missing - try backup
  const backup = readState(BACKUP_FILE);
  if (backup) {
    // Auto-repair: restore primary from backup
    try {
      const payload = `${JSON.stringify(backup, null, 2)}\n`;
      fs.writeFileSync(STORE_FILE, payload, "utf8");
      log("WARN", `[guild-languages] Auto-repaired ${STORE_FILE} from backup.`);
    } catch (repairErr) {
      log("ERROR", `[guild-languages] Auto-repair failed: ${repairErr?.message || repairErr}`);
    }
    return backup;
  }

  // Both corrupt/missing - start fresh and write a clean file
  const fresh = emptyState();
  try {
    fs.writeFileSync(STORE_FILE, `${JSON.stringify(fresh, null, 2)}\n`, "utf8");
    log("INFO", `[guild-languages] Initialized fresh ${STORE_FILE}.`);
  } catch {
    // ignore - will work in-memory
  }
  return fresh;
}

function saveState(state) {
  const normalized = normalizeState(state);
  const payload = `${JSON.stringify(normalized, null, 2)}\n`;
  const tmpFile = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (fs.existsSync(STORE_FILE)) {
      try {
        fs.copyFileSync(STORE_FILE, BACKUP_FILE);
      } catch {
        // ignore backup errors
      }
    }
    fs.writeFileSync(tmpFile, payload, "utf8");
    try {
      fs.renameSync(tmpFile, STORE_FILE);
    } catch {
      fs.writeFileSync(STORE_FILE, payload, "utf8");
    }
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore
    }
  }
}

let cache = null;
function ensureState() {
  if (cache) return cache;
  cache = loadState();
  return cache;
}

export function getGuildLanguage(guildId) {
  const id = sanitizeGuildId(guildId);
  if (!id) return null;
  const state = ensureState();
  return state.guilds[id] || null;
}

export function setGuildLanguage(guildId, language) {
  const id = sanitizeGuildId(guildId);
  if (!id) return null;
  const state = ensureState();
  const nextLanguage = normalizeLanguage(language, getDefaultLanguage());
  state.guilds[id] = nextLanguage;
  saveState(state);
  return nextLanguage;
}

export function clearGuildLanguage(guildId) {
  const id = sanitizeGuildId(guildId);
  if (!id) return false;
  const state = ensureState();
  if (!state.guilds[id]) return false;
  delete state.guilds[id];
  saveState(state);
  return true;
}

export function resetGuildLanguage(guildId) {
  return clearGuildLanguage(guildId);
}

export function getAllGuildLanguages() {
  const state = ensureState();
  return { ...(state.guilds || {}) };
}
