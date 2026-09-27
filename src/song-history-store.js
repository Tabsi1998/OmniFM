import fs from "node:fs";
import { getDb, isConnected } from "./lib/db.js";
import { log } from "./lib/logging.js";
import path from "node:path";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

const STORE_FILE = resolveRuntimeDataPath("song-history.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;
const SPLIT_PROCESS_ROLE = String(process.env.BOT_PROCESS_ROLE || "").trim().toLowerCase();
const SPLIT_HISTORY_STORAGE_ENABLED = SPLIT_PROCESS_ROLE === "commander" || SPLIT_PROCESS_ROLE === "worker";
const SPLIT_HISTORY_DIR = resolveRuntimeDataPath("song-history");
const DEFAULT_MAX_PER_GUILD = 120;
const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 30;

function emptyState() {
  return { guilds: {} };
}

function normalizeText(value, maxLen = 240) {
  const text = String(value || "").trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

function normalizeGuildId(guildId) {
  const gid = String(guildId || "").trim();
  return /^\d{17,22}$/.test(gid) ? gid : null;
}

function normalizeEntry(raw, guildId) {
  if (!raw || typeof raw !== "object") return null;
  const timestampMs = Number.isFinite(raw.timestampMs) ? raw.timestampMs : Date.parse(raw.recordedAt || "");
  if (!Number.isFinite(timestampMs) || timestampMs <= 0) return null;

  const displayTitle = normalizeText(raw.displayTitle, 220);
  const streamTitle = normalizeText(raw.streamTitle, 220);
  const fallbackTitle = displayTitle || streamTitle;
  if (!fallbackTitle) return null;

  return {
    id: normalizeText(raw.id, 64) || `trk_${timestampMs.toString(36)}`,
    guildId,
    botId: normalizeText(raw.botId, 64) || null,
    stationKey: normalizeText(raw.stationKey, 80) || null,
    stationName: normalizeText(raw.stationName, 120) || null,
    displayTitle: displayTitle || streamTitle,
    streamTitle: streamTitle || displayTitle || null,
    artist: normalizeText(raw.artist, 120) || null,
    title: normalizeText(raw.title, 120) || null,
    artworkUrl: normalizeText(raw.artworkUrl, 600) || null,
    timestampMs,
    recordedAt: new Date(timestampMs).toISOString(),
  };
}

function normalizeState(input) {
  const source = input && typeof input === "object" ? input : {};
  const rawGuilds = source.guilds && typeof source.guilds === "object" ? source.guilds : {};
  const guilds = {};

  for (const [rawGuildId, rawEntries] of Object.entries(rawGuilds)) {
    const guildId = normalizeGuildId(rawGuildId);
    if (!guildId) continue;

    const entries = Array.isArray(rawEntries) ? rawEntries : [];
    const normalized = [];
    for (const item of entries) {
      const entry = normalizeEntry(item, guildId);
      if (entry) normalized.push(entry);
    }

    normalized.sort((a, b) => a.timestampMs - b.timestampMs);
    if (normalized.length) guilds[guildId] = normalized.slice(-DEFAULT_MAX_PER_GUILD);
  }

  return { guilds };
}

function readStateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
}

function getGuildHistoryFile(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return null;
  return path.join(SPLIT_HISTORY_DIR, `${gid}.json`);
}

function getGuildHistoryBackupFile(guildId) {
  const filePath = getGuildHistoryFile(guildId);
  return filePath ? `${filePath}.bak` : null;
}

function ensureSplitHistoryDir() {
  if (!fs.existsSync(SPLIT_HISTORY_DIR)) {
    fs.mkdirSync(SPLIT_HISTORY_DIR, { recursive: true });
  }
}

function readSplitGuildState(guildId) {
  const filePath = getGuildHistoryFile(guildId);
  const backupFilePath = getGuildHistoryBackupFile(guildId);
  if (!filePath) return { guilds: { [guildId]: [] } };
  return readStateFile(filePath) || readStateFile(backupFilePath) || { guilds: { [guildId]: [] } };
}

function saveSplitGuildState(guildId, state) {
  const filePath = getGuildHistoryFile(guildId);
  const backupFilePath = getGuildHistoryBackupFile(guildId);
  if (!filePath) return;

  ensureSplitHistoryDir();
  const tmpFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(state, null, 2) + "\n";

  try {
    if (fs.existsSync(filePath)) {
      try { fs.copyFileSync(filePath, backupFilePath); } catch {}
    }
    fs.writeFileSync(tmpFile, payload, "utf8");
    try {
      fs.renameSync(tmpFile, filePath);
    } catch {
      fs.writeFileSync(filePath, payload, "utf8");
    }
  } finally {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
  }
}

let stateCache = null;

function ensureState() {
  if (stateCache) return stateCache;
  stateCache = readStateFile(STORE_FILE) || readStateFile(BACKUP_FILE) || emptyState();
  return stateCache;
}

function saveState() {
  const state = ensureState();
  const tmpFile = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(state, null, 2) + "\n";

  try {
    if (fs.existsSync(STORE_FILE)) {
      try { fs.copyFileSync(STORE_FILE, BACKUP_FILE); } catch {}
    }
    fs.writeFileSync(tmpFile, payload, "utf8");
    try {
      fs.renameSync(tmpFile, STORE_FILE);
    } catch {
      fs.writeFileSync(STORE_FILE, payload, "utf8");
    }
  } finally {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
  }
}

// ---- MongoDB (#292) ----
// A song is written by the worker that plays the server and read by the
// panel (same worker) and /history (commander). In MongoDB each song is one
// document in song_history; the playing worker keeps the latest songs of its
// servers in memory for the panel and the duplicate check, and /history asks
// MongoDB directly (readSongHistory). Without MongoDB the files stay.
const COLLECTION = "song_history";
let mongoActive = false;
const recentByGuild = new Map();
const warming = new Set();
let mongoWriteQueue = Promise.resolve();

function queueMongo(task) {
  mongoWriteQueue = mongoWriteQueue
    .then(async () => { if (isConnected()) await task(getDb().collection(COLLECTION)); })
    .catch((err) => log("ERROR", `[song-history] MongoDB-Speichern fehlgeschlagen: ${err?.message || err}`));
  return mongoWriteQueue;
}

/** The latest songs of a server from MongoDB, into this process's memory (panel after a restart). */
function warmGuild(gid) {
  if (warming.has(gid) || recentByGuild.has(gid) || !isConnected()) return;
  warming.add(gid);
  getDb().collection(COLLECTION).find({ guildId: gid }, { projection: { _id: 0 } }).sort({ timestampMs: -1 }).limit(DEFAULT_MAX_PER_GUILD).toArray()
    .then((rows) => { if (!recentByGuild.has(gid)) recentByGuild.set(gid, rows.reverse()); })
    .catch(() => null)
    .finally(() => warming.delete(gid));
}

/** The latest songs of a server straight from MongoDB, newest first (/history in another process). */
export async function readSongHistory(guildId, options = {}) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return [];
  if (!mongoActive || !isConnected()) return getSongHistory(gid, options);
  const limitRaw = Number.parseInt(String(options.limit ?? DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(MAX_LIMIT, limitRaw)) : DEFAULT_LIMIT;
  return getDb().collection(COLLECTION).find({ guildId: gid }, { projection: { _id: 0 } }).sort({ timestampMs: -1 }).limit(limit).toArray();
}

/** MongoDB becomes the store; the songs of the history files are copied once. */
export async function initSongHistoryStore() {
  if (!isConnected() || !getDb()) return { backend: "file" };
  const collection = getDb().collection(COLLECTION);
  await collection.createIndex({ guildId: 1, timestampMs: -1 }, { name: "guild_time" }).catch(() => null);
  await collection.createIndex({ guildId: 1, id: 1 }, { name: "guild_entry", unique: true }).catch(() => null);
  const guilds = {};
  const legacy = readStateFile(STORE_FILE) || readStateFile(BACKUP_FILE);
  Object.assign(guilds, legacy?.guilds || {});
  try {
    if (fs.existsSync(SPLIT_HISTORY_DIR) && fs.statSync(SPLIT_HISTORY_DIR).isDirectory()) {
      for (const name of fs.readdirSync(SPLIT_HISTORY_DIR)) {
        if (!name.endsWith(".json")) continue;
        const state = readStateFile(path.join(SPLIT_HISTORY_DIR, name));
        Object.assign(guilds, state?.guilds || {});
      }
    }
  } catch (err) {
    log("WARN", `[song-history] Verlaufsdateien nicht lesbar: ${err?.message || err}`);
  }
  const ops = [];
  for (const [gid, entries] of Object.entries(guilds)) {
    for (const entry of Array.isArray(entries) ? entries : []) {
      if (!entry?.id) continue;
      ops.push({ updateOne: { filter: { guildId: gid, id: entry.id }, update: { $setOnInsert: { ...entry, guildId: gid } }, upsert: true } });
    }
  }
  if (!(await collection.estimatedDocumentCount().catch(() => 0)) && ops.length) {
    for (let index = 0; index < ops.length; index += 1000) {
      // eslint-disable-next-line no-await-in-loop -- a one-time copy in batches
      await collection.bulkWrite(ops.slice(index, index + 1000), { ordered: false }).catch(() => null);
    }
    log("INFO", `[song-history] ${ops.length} Songs aus den Verlaufsdateien nach MongoDB übernommen.`);
  }
  mongoActive = true;
  return { backend: "mongo" };
}

export async function stopSongHistoryStore() {
  await mongoWriteQueue.catch(() => null);
}

function buildTrackFingerprint(track) {
  const parts = [
    normalizeText(track.displayTitle, 220) || "",
    normalizeText(track.artist, 120) || "",
    normalizeText(track.title, 120) || "",
    normalizeText(track.streamTitle, 220) || "",
  ];
  return parts.join("|").toLowerCase();
}

export function appendSongHistory(guildId, track, options = {}) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return { saved: false, reason: "invalid-guild" };

  const baseTitle = normalizeText(track?.displayTitle || track?.streamTitle, 220);
  if (!baseTitle) return { saved: false, reason: "empty-track" };

  const maxPerGuildRaw = Number.parseInt(String(options.maxPerGuild ?? DEFAULT_MAX_PER_GUILD), 10);
  const maxPerGuild = Number.isFinite(maxPerGuildRaw)
    ? Math.max(20, Math.min(500, maxPerGuildRaw))
    : DEFAULT_MAX_PER_GUILD;
  const dedupeWindowMsRaw = Number.parseInt(String(options.dedupeWindowMs ?? 120_000), 10);
  const dedupeWindowMs = Number.isFinite(dedupeWindowMsRaw)
    ? Math.max(15_000, Math.min(10 * 60_000, dedupeWindowMsRaw))
    : 120_000;

  const timestampMs = Number.isFinite(track?.timestampMs) ? Number(track.timestampMs) : Date.now();
  const entry = normalizeEntry({
    ...track,
    displayTitle: normalizeText(track?.displayTitle, 220) || baseTitle,
    streamTitle: normalizeText(track?.streamTitle, 220) || baseTitle,
    timestampMs,
    id: `trk_${timestampMs.toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
  }, gid);

  if (!entry) return { saved: false, reason: "invalid-entry" };

  if (mongoActive) {
    const list = recentByGuild.get(gid) || [];
    const previous = list.length ? list[list.length - 1] : null;
    if (previous
      && buildTrackFingerprint(previous) === buildTrackFingerprint(entry)
      && Math.abs(entry.timestampMs - previous.timestampMs) <= dedupeWindowMs) {
      return { saved: false, reason: "duplicate", entry: previous };
    }
    list.push(entry);
    const kept = list.slice(-maxPerGuild);
    recentByGuild.set(gid, kept);
    queueMongo(async (collection) => {
      await collection.insertOne({ ...entry, guildId: gid });
      // Only the newest songs per server stay, as in the files.
      if (list.length > maxPerGuild) await collection.deleteMany({ guildId: gid, timestampMs: { $lt: kept[0].timestampMs } });
    });
    return { saved: true, entry };
  }

  const state = SPLIT_HISTORY_STORAGE_ENABLED
    ? readSplitGuildState(gid)
    : ensureState();
  if (!state.guilds[gid]) state.guilds[gid] = [];
  const list = state.guilds[gid];

  const previous = list.length ? list[list.length - 1] : null;
  if (previous) {
    const sameTrack = buildTrackFingerprint(previous) === buildTrackFingerprint(entry);
    const nearInTime = Math.abs(entry.timestampMs - previous.timestampMs) <= dedupeWindowMs;
    if (sameTrack && nearInTime) {
      return { saved: false, reason: "duplicate", entry: previous };
    }
  }

  list.push(entry);
  if (list.length > maxPerGuild) {
    state.guilds[gid] = list.slice(-maxPerGuild);
  }

  if (SPLIT_HISTORY_STORAGE_ENABLED) {
    saveSplitGuildState(gid, { guilds: { [gid]: state.guilds[gid] } });
  } else {
    saveState();
  }
  return { saved: true, entry };
}

export function getSongHistory(guildId, options = {}) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return [];

  const limitRaw = Number.parseInt(String(options.limit ?? DEFAULT_LIMIT), 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.max(1, Math.min(MAX_LIMIT, limitRaw))
    : DEFAULT_LIMIT;

  if (mongoActive) {
    // This process's memory; after a restart it is filled from MongoDB in the background.
    if (!recentByGuild.has(gid)) warmGuild(gid);
    return (recentByGuild.get(gid) || []).slice(-limit).reverse().map((entry) => ({ ...entry }));
  }

  const state = SPLIT_HISTORY_STORAGE_ENABLED
    ? readSplitGuildState(gid)
    : ensureState();
  const entries = Array.isArray(state.guilds[gid]) ? state.guilds[gid] : [];
  return entries.slice(-limit).reverse().map((entry) => ({ ...entry }));
}

export function clearSongHistory(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return false;

  if (mongoActive) {
    recentByGuild.delete(gid);
    queueMongo((collection) => collection.deleteMany({ guildId: gid }));
    return true;
  }

  const state = SPLIT_HISTORY_STORAGE_ENABLED
    ? readSplitGuildState(gid)
    : ensureState();
  if (!state.guilds[gid]) return false;
  delete state.guilds[gid];
  if (SPLIT_HISTORY_STORAGE_ENABLED) {
    const filePath = getGuildHistoryFile(gid);
    try {
      if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch {}
  } else {
    saveState();
  }
  return true;
}

// Legacy aliases used in runtime/import compatibility.
export const addSongEntry = appendSongHistory;
export const getHistory = getSongHistory;
export const getGuildSongHistory = getSongHistory;
