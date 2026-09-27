import fs from "node:fs";
import { getDb, isConnected } from "./lib/db.js";
import { fileStoresAllowed } from "./lib/store-policy.js";
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
      if (fileStoresAllowed()) fs.writeFileSync(STORE_FILE, payload, "utf8");
      log("WARN", `[guild-languages] Auto-repaired ${STORE_FILE} from backup.`);
    } catch (repairErr) {
      log("ERROR", `[guild-languages] Auto-repair failed: ${repairErr?.message || repairErr}`);
    }
    return backup;
  }

  // Both corrupt/missing - start fresh and write a clean file
  const fresh = emptyState();
  try {
    if (fileStoresAllowed()) fs.writeFileSync(STORE_FILE, `${JSON.stringify(fresh, null, 2)}\n`, "utf8");
    log("INFO", `[guild-languages] Initialized fresh ${STORE_FILE}.`);
  } catch {
    // ignore - will work in-memory
  }
  return fresh;
}

function saveState(state) {
  if (mongoActive) {
    queueMongoDelta(persisted?.guilds || {}, state.guilds || {});
    persisted = JSON.parse(JSON.stringify(state));
    return;
  }
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

// ---- MongoDB (#292) ----
// /language runs in the commander, but the workers speak in the server's
// language too, and they read this store. With the file each worker kept
// what it read at its start, so a new language only reached them after a
// restart. In MongoDB each server is one document in guild_languages, and
// every process refreshes its cache every 10 s.
const COLLECTION = "guild_languages";
let mongoActive = false;
let persisted = null;
let mongoRefreshTimer = null;
let mongoWritesPending = 0;
let mongoWriteQueue = Promise.resolve();

async function readMongoState() {
  if (!mongoActive || !isConnected() || mongoWritesPending > 0) return;
  const docs = await getDb().collection(COLLECTION).find({}).toArray();
  if (mongoWritesPending > 0) return;
  const next = normalizeState({ guilds: Object.fromEntries(docs.map((doc) => [doc._id, doc.language])) });
  cache = next;
  persisted = JSON.parse(JSON.stringify(next));
}

function queueMongoDelta(before, after) {
  const ops = [];
  for (const [guildId, language] of Object.entries(after)) {
    if (before[guildId] !== language) ops.push({ replaceOne: { filter: { _id: guildId }, replacement: { language }, upsert: true } });
  }
  for (const guildId of Object.keys(before)) {
    if (!(guildId in after)) ops.push({ deleteOne: { filter: { _id: guildId } } });
  }
  if (!ops.length) return;
  mongoWritesPending += 1;
  mongoWriteQueue = mongoWriteQueue
    .then(async () => { if (isConnected()) await getDb().collection(COLLECTION).bulkWrite(ops, { ordered: false }); })
    .catch((err) => log("ERROR", `[guild-languages] MongoDB-Speichern fehlgeschlagen: ${err?.message || err}`))
    .finally(() => { mongoWritesPending = Math.max(0, mongoWritesPending - 1); });
}

/** MongoDB becomes the store; the languages of guild-languages.json are copied once. */
export async function initGuildLanguageStore({ refreshMs = 10_000 } = {}) {
  if (!isConnected() || !getDb()) return { backend: "file" };
  const collection = getDb().collection(COLLECTION);
  const fileState = readState(STORE_FILE) || readState(BACKUP_FILE);
  let copied = 0;
  for (const [guildId, language] of Object.entries(fileState?.guilds || {})) {
    // eslint-disable-next-line no-await-in-loop -- a one-time copy
    const result = await collection.updateOne({ _id: guildId }, { $setOnInsert: { language } }, { upsert: true });
    if (result.upsertedCount) copied += 1;
  }
  if (copied) log("INFO", `[guild-languages] ${copied} Server-Sprache(n) aus guild-languages.json nach MongoDB übernommen.`);
  mongoActive = true;
  cache = normalizeState({});
  await readMongoState();
  if (!mongoRefreshTimer) {
    mongoRefreshTimer = setInterval(() => {
      readMongoState().catch((err) => log("WARN", `[guild-languages] MongoDB-Refresh fehlgeschlagen: ${err?.message || err}`));
    }, Math.max(1000, Number(refreshMs) || 10_000));
    mongoRefreshTimer.unref?.();
  }
  return { backend: "mongo" };
}

export async function stopGuildLanguageStore() {
  if (mongoRefreshTimer) clearInterval(mongoRefreshTimer);
  mongoRefreshTimer = null;
  await mongoWriteQueue.catch(() => null);
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
