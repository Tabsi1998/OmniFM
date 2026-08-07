import fs from "node:fs";
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

  const state = SPLIT_HISTORY_STORAGE_ENABLED
    ? readSplitGuildState(gid)
    : ensureState();
  const entries = Array.isArray(state.guilds[gid]) ? state.guilds[gid] : [];
  return entries.slice(-limit).reverse().map((entry) => ({ ...entry }));
}

export function clearSongHistory(guildId) {
  const gid = normalizeGuildId(guildId);
  if (!gid) return false;

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
