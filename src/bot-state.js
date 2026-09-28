import fs from "node:fs";
import { getDb, isConnected } from "./lib/db.js";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, logStoreLoadError } from "./lib/logging.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";
import { readStoreFileWithRetry } from "./lib/file-store-lock.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function resolveStatePath(value, fallbackPath) {
  const raw = String(value || "").trim();
  if (!raw) return fallbackPath;
  return path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
}

const STATE_FILE = resolveStatePath(process.env.OMNIFM_BOT_STATE_FILE, resolveRuntimeDataPath("bot-state.json"));
const STATE_BACKUP_FILE = `${STATE_FILE}.bak`;
const SPLIT_PROCESS_ROLE = String(process.env.BOT_PROCESS_ROLE || "").trim().toLowerCase();
const SPLIT_STATE_STORAGE_ENABLED = SPLIT_PROCESS_ROLE === "commander" || SPLIT_PROCESS_ROLE === "worker";
const SPLIT_STATE_DIR = resolveStatePath(process.env.BOT_STATE_SPLIT_DIR, resolveRuntimeDataPath("bot-state"));

function hasStateEntries(value) {
  return Boolean(value && typeof value === "object" && Object.keys(value).length > 0);
}

function sanitizeSnowflake(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

function sanitizeStateIdentifier(value) {
  const text = String(value || "").trim();
  if (!text) return "";
  if (/^\d{17,22}$/.test(text)) return text;
  return /^(?=.*(?:\d|[-_:]))[a-z0-9._:-]{2,120}$/i.test(text) ? text : "";
}

function sanitizeText(value, maxLen = 200) {
  const text = String(value || "").trim();
  return text ? text.slice(0, maxLen) : "";
}

function normalizeStoredVolume(rawValue) {
  const parsed = Number.parseInt(String(rawValue ?? ""), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(100, parsed));
}

function normalizeChannelVolumes(rawValue) {
  const normalized = {};
  if (!rawValue || typeof rawValue !== "object" || Array.isArray(rawValue)) return normalized;
  for (const [rawChannelId, rawVolume] of Object.entries(rawValue)) {
    const channelId = sanitizeStateIdentifier(rawChannelId);
    const volume = normalizeStoredVolume(rawVolume);
    if (channelId && volume !== null) normalized[channelId] = volume;
  }
  return normalized;
}

function normalizeStoredTimestampMs(rawValue) {
  if (!rawValue) return 0;
  const numeric = Number.parseInt(String(rawValue ?? ""), 10);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(rawValue));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function isPersistableGuildState(state) {
  return Boolean(state?.currentStationKey && state?.lastChannelId);
}

function readStateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    if (fs.statSync(filePath).isDirectory()) {
      log("WARN", `[bot-state] ${filePath} ist ein Verzeichnis (Docker-Mount Problem). Nutze leeren State.`);
      return null;
    }
    const raw = readStoreFileWithRetry(filePath);
    if (raw === null) return null;
    if (raw.trim().length === 0) return {};
    return JSON.parse(raw);
  } catch (err) {
    logStoreLoadError("bot-state", filePath, err);
    return null;
  }
}

function loadState() {
  return readStateFile(STATE_FILE) || readStateFile(STATE_BACKUP_FILE) || {};
}

// ---- MongoDB (#292) ----
// Every bot process keeps what it plays (for the restore after a restart) and
// its volume preferences. In MongoDB each bot is one document in bot_state;
// only its own process writes it, so the whole document is replaced. Writes
// are coalesced (250 ms) and flushBotStateStore() waits for them on shutdown,
// so the state saved on SIGTERM reaches MongoDB before the process ends.
// Without MongoDB the per-bot files stay, as before.
const COLLECTION = "bot_state";
let mongoActive = false;
const mongoCache = new Map();
const pendingWrites = new Map();
let flushTimer = null;
let mongoWriteQueue = Promise.resolve();

function drainBotWrites() {
  if (!pendingWrites.size) return mongoWriteQueue;
  const batch = [...pendingWrites.entries()];
  pendingWrites.clear();
  mongoWriteQueue = mongoWriteQueue
    .then(async () => {
      if (!isConnected()) return;
      const updatedAt = new Date().toISOString();
      await getDb().collection(COLLECTION).bulkWrite(batch.map(([botId, guilds]) => ({
        replaceOne: { filter: { _id: botId }, replacement: { guilds, updatedAt }, upsert: true },
      })), { ordered: false });
    })
    .catch((err) => log("ERROR", `[bot-state] MongoDB-Speichern fehlgeschlagen: ${err?.message || err}`));
  return mongoWriteQueue;
}

function readBotData(botId) {
  return JSON.parse(JSON.stringify(mongoCache.get(String(botId)) || {}));
}

function writeBotData(botId, data) {
  const guilds = hasStateEntries(data) ? JSON.parse(JSON.stringify(data)) : {};
  mongoCache.set(String(botId), guilds);
  pendingWrites.set(String(botId), guilds);
  if (!flushTimer) {
    flushTimer = setTimeout(() => { flushTimer = null; drainBotWrites(); }, 250);
    flushTimer.unref?.();
  }
}

/** Waits until every saved state is in MongoDB (shutdown). */
async function flushBotStateStore() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  await drainBotWrites().catch(() => null);
}

/** MongoDB becomes the store; the states of the bot-state files are copied once. */
async function initBotStateStore() {
  if (!isConnected() || !getDb()) return { backend: "file" };
  const collection = getDb().collection(COLLECTION);
  const fromFiles = new Map();
  for (const [botId, data] of Object.entries(loadState() || {})) {
    if (hasStateEntries(data)) fromFiles.set(botId, data);
  }
  try {
    if (fs.existsSync(SPLIT_STATE_DIR) && fs.statSync(SPLIT_STATE_DIR).isDirectory()) {
      for (const name of fs.readdirSync(SPLIT_STATE_DIR)) {
        if (!name.endsWith(".json")) continue;
        const data = readStateFile(path.join(SPLIT_STATE_DIR, name));
        // The per-bot file is newer than the shared legacy file (#226).
        if (data && typeof data === "object") fromFiles.set(name.slice(0, -".json".length), data);
      }
    }
  } catch (err) {
    log("WARN", `[bot-state] Split-Dateien nicht lesbar: ${err?.message || err}`);
  }
  let copied = 0;
  for (const [botId, guilds] of fromFiles) {
    // eslint-disable-next-line no-await-in-loop -- a one-time copy
    const result = await collection.updateOne({ _id: botId }, { $setOnInsert: { guilds, updatedAt: new Date().toISOString() } }, { upsert: true });
    if (result.upsertedCount) copied += 1;
  }
  if (copied) log("INFO", `[bot-state] Zustand von ${copied} Bot(s) aus den bot-state-Dateien nach MongoDB übernommen.`);
  for (const doc of await collection.find({}).toArray()) mongoCache.set(String(doc._id), doc.guilds || {});
  mongoActive = true;
  return { backend: "mongo", bots: mongoCache.size };
}

function sanitizeStateFileSegment(raw) {
  return String(raw || "").trim().replace(/[^a-z0-9._-]/gi, "_");
}

function getSplitBotStateFile(botId) {
  const safeBotId = sanitizeStateFileSegment(botId);
  if (!safeBotId) return null;
  return path.join(SPLIT_STATE_DIR, `${safeBotId}.json`);
}

function getSplitBotBackupFile(botId) {
  const primary = getSplitBotStateFile(botId);
  return primary ? `${primary}.bak` : null;
}

function ensureDirectoryForFile(filePath) {
  const dir = path.dirname(filePath);
  if (fs.existsSync(dir)) {
    try {
      if (!fs.statSync(dir).isDirectory()) {
        log("WARN", `[bot-state] ${dir} ist keine Verzeichnisstruktur für Split-State.`);
        return false;
      }
    } catch {
      return false;
    }
    return true;
  }
  fs.mkdirSync(dir, { recursive: true });
  return true;
}

function writeTextFileWithDirRetry(filePath, content) {
  try {
    if (!ensureDirectoryForFile(filePath)) return false;
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  } catch (err) {
    if (err?.code !== "ENOENT") throw err;
    if (!ensureDirectoryForFile(filePath)) return false;
    fs.writeFileSync(filePath, content, "utf8");
    return true;
  }
}

function buildVolumeOnlyEntry(entry = {}) {
  const volume = normalizeStoredVolume(entry?.volume);
  const channelVolumes = normalizeChannelVolumes(entry?.channelVolumes);
  if (volume === null && Object.keys(channelVolumes).length === 0) return null;
  return {
    ...(volume !== null ? { volume } : {}),
    ...(Object.keys(channelVolumes).length ? { channelVolumes } : {}),
    volumePreference: true,
    savedAt: entry?.savedAt || new Date().toISOString(),
  };
}

/** @param {Record<string, any>} [rawEntry] */
function normalizeStoredBotStateEntry(rawEntry = {}) {
  /** @type {Record<string, any>} */
  const input = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
  const volume = normalizeStoredVolume(input.volume);
  const volumePreference = input.volumePreference === true;
  const channelVolumes = normalizeChannelVolumes(input.channelVolumes);
  const channelId = sanitizeStateIdentifier(input.channelId);
  const stationKey = sanitizeText(input.stationKey, 120);
  const stationName = sanitizeText(input.stationName, 200) || null;
  const desiredStationKey = sanitizeText(input.desiredStationKey, 120) || stationKey;
  const desiredStationName = sanitizeText(input.desiredStationName, 200) || stationName;
  const failoverActive = input.failoverActive === true && Boolean(desiredStationKey && stationKey && desiredStationKey !== stationKey);
  const failoverStartedAt = normalizeStoredTimestampMs(input.failoverStartedAt);
  const failoverReason = sanitizeText(input.failoverReason, 500) || null;
  const failoverFromStationKey = sanitizeText(input.failoverFromStationKey, 120) || null;
  const failoverFromStationName = sanitizeText(input.failoverFromStationName, 200) || null;
  const failoverFailureStationKey = sanitizeText(input.failoverFailureStationKey, 120) || null;
  const failoverFailureCount = Math.max(0, Number.parseInt(String(input.failoverFailureCount || 0), 10) || 0);
  const failoverFailureStartedAt = normalizeStoredTimestampMs(input.failoverFailureStartedAt);
  const failoverLastFailureAt = normalizeStoredTimestampMs(input.failoverLastFailureAt);
  const scheduledEventId = sanitizeSnowflake(input.scheduledEventId) || null;
  const scheduledEventStopAtMs = normalizeStoredTimestampMs(input.scheduledEventStopAtMs);
  const restoreBlockedUntil = normalizeStoredTimestampMs(input.restoreBlockedUntil);
  const restoreBlockedAt = normalizeStoredTimestampMs(input.restoreBlockedAt);
  const restoreBlockCount = Math.max(0, Number.parseInt(String(input.restoreBlockCount || 0), 10) || 0);
  const restoreBlockReason = sanitizeText(input.restoreBlockReason, 200) || null;
  const parkedReason = sanitizeText(input.parkedReason, 40).toLowerCase() || null;
  const sleepUntilMs = normalizeStoredTimestampMs(input.sleepUntilMs);
  const parkedAt = normalizeStoredTimestampMs(input.parkedAt);
  const parkedDetail = sanitizeText(input.parkedDetail, 200) || null;
  const savedAt = (() => {
    const normalized = normalizeStoredTimestampMs(input.savedAt);
    return normalized > 0 ? new Date(normalized).toISOString() : new Date().toISOString();
  })();

  const hasPlaybackTarget = Boolean(channelId && stationKey);
  const hasVolumePreference = (volume !== null || Object.keys(channelVolumes).length > 0) && (volumePreference || hasPlaybackTarget);
  if (!hasPlaybackTarget && !hasVolumePreference) {
    return null;
  }

  const normalized = { savedAt };
  if (hasPlaybackTarget) {
    normalized.channelId = channelId;
    normalized.stationKey = stationKey;
    normalized.stationName = stationName;
    normalized.desiredStationKey = desiredStationKey;
    normalized.desiredStationName = desiredStationName;
    if (failoverActive) {
      normalized.failoverActive = true;
      if (failoverStartedAt > 0) normalized.failoverStartedAt = failoverStartedAt;
      if (failoverReason) normalized.failoverReason = failoverReason;
      if (failoverFromStationKey) normalized.failoverFromStationKey = failoverFromStationKey;
      if (failoverFromStationName) normalized.failoverFromStationName = failoverFromStationName;
    }
    if (failoverFailureStationKey && failoverFailureCount > 0 && failoverFailureStartedAt > 0) {
      normalized.failoverFailureStationKey = failoverFailureStationKey;
      normalized.failoverFailureCount = failoverFailureCount;
      normalized.failoverFailureStartedAt = failoverFailureStartedAt;
      if (failoverLastFailureAt > 0) normalized.failoverLastFailureAt = failoverLastFailureAt;
    }
    normalized.scheduledEventId = scheduledEventId;
    normalized.scheduledEventStopAtMs = scheduledEventStopAtMs > 0 ? scheduledEventStopAtMs : 0;
    if (restoreBlockedUntil > 0) normalized.restoreBlockedUntil = restoreBlockedUntil;
    if (restoreBlockedAt > 0) normalized.restoreBlockedAt = restoreBlockedAt;
    if (restoreBlockCount > 0) normalized.restoreBlockCount = restoreBlockCount;
    if (restoreBlockReason) normalized.restoreBlockReason = restoreBlockReason;
    if (parkedReason) {
      normalized.parkedReason = parkedReason;
      if (parkedAt > 0) normalized.parkedAt = parkedAt;
      if (parkedDetail) normalized.parkedDetail = parkedDetail;
    }
    if (sleepUntilMs > 0) normalized.sleepUntilMs = sleepUntilMs;
  }

  if (hasVolumePreference) {
    if (volume !== null) normalized.volume = volume;
    if (Object.keys(channelVolumes).length > 0) normalized.channelVolumes = channelVolumes;
  }
  if (volumePreference) {
    normalized.volumePreference = true;
  }

  return normalized;
}

function normalizeStoredBotStateMap(rawBotState = {}) {
  const source = rawBotState && typeof rawBotState === "object" ? rawBotState : {};
  const normalized = {};

  for (const [rawGuildId, rawEntry] of Object.entries(source)) {
    const guildId = sanitizeStateIdentifier(rawGuildId);
    if (!guildId) continue;
    const entry = normalizeStoredBotStateEntry(rawEntry);
    if (!entry) continue;
    normalized[guildId] = entry;
  }

  return normalized;
}

function saveState(state) {
  const payload = JSON.stringify(state, null, 2);
  const tmpFile = `${STATE_FILE}.tmp-${process.pid}-${Date.now()}`;
  try {
    // Docker-Mount: Wenn es ein Verzeichnis ist, NICHT versuchen zu löschen
    // (schlaegt fehl mit "Device or resource busy")
    if (fs.existsSync(STATE_FILE) && fs.statSync(STATE_FILE).isDirectory()) {
      log("WARN", `[bot-state] ${STATE_FILE} ist ein Verzeichnis - State wird nur im Speicher gehalten.`);
      log("WARN", "[bot-state] Fix: das Verzeichnis entfernen oder OMNIFM_RUNTIME_DATA_DIR auf ein beschreibbares Verzeichnis setzen.");
      return;
    }

    if (fs.existsSync(STATE_FILE)) {
      try {
        fs.copyFileSync(STATE_FILE, STATE_BACKUP_FILE);
      } catch {
        // ignore backup errors
      }
    }

    fs.writeFileSync(tmpFile, payload, "utf8");
    try {
      fs.renameSync(tmpFile, STATE_FILE);
    } catch {
      fs.writeFileSync(STATE_FILE, payload, "utf8");
    }
  } catch (err) {
    log("ERROR", `[bot-state] Fehler beim Speichern: ${err?.message || err}`);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

function saveStateToFile(filePath, backupFilePath, state) {
  const payload = JSON.stringify(state, null, 2);
  const tmpFile = `${filePath}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (!ensureDirectoryForFile(filePath)) {
      log("WARN", `[bot-state] Split-State-Verzeichnis ungültig für ${filePath}.`);
      return;
    }

    if (fs.existsSync(filePath) && fs.statSync(filePath).isDirectory()) {
      log("WARN", `[bot-state] ${filePath} ist ein Verzeichnis - State wird nur im Speicher gehalten.`);
      return;
    }

    if (fs.existsSync(filePath) && backupFilePath) {
      try {
        fs.copyFileSync(filePath, backupFilePath);
      } catch {
        // ignore backup errors
      }
    }

    if (!writeTextFileWithDirRetry(tmpFile, payload)) {
      return;
    }
    try {
      fs.renameSync(tmpFile, filePath);
    } catch {
      if (!writeTextFileWithDirRetry(filePath, payload)) {
        return;
      }
    }
  } catch (err) {
    log("ERROR", `[bot-state] Fehler beim Speichern (${filePath}): ${err?.message || err}`);
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {
      // ignore cleanup errors
    }
  }
}

function loadSplitBotState(botId) {
  const filePath = getSplitBotStateFile(botId);
  const backupFilePath = getSplitBotBackupFile(botId);
  if (!filePath) return {};
  const splitState = readStateFile(filePath) || readStateFile(backupFilePath) || {};
  // Once this bot has its own file, the shared legacy file is history. Reading
  // it again for an emptied file would revive a target that was stopped (#226).
  if (hasStateEntries(splitState) || fs.existsSync(filePath)) {
    return splitState;
  }

  const legacyState = loadState();
  const legacyBotState = legacyState?.[botId];
  if (!hasStateEntries(legacyBotState)) {
    return splitState;
  }

  saveStateToFile(filePath, backupFilePath, legacyBotState);
  delete legacyState[botId];
  saveState(legacyState);
  log(
    "INFO",
    `[bot-state] Legacy-State für ${botId} nach Split-Storage migriert (${Object.keys(legacyBotState).length} Guild(s)).`
  );
  return legacyBotState;
}

/**
 * Persists the playback targets of one bot.
 * @param {string} botId
 * @param {Map<string, import("./lib/types.js").GuildPlaybackState>} guildStates
 */
function saveBotState(botId, guildStates) {
  const botData = {};

  for (const [guildId, state] of guildStates.entries()) {
    const volume = normalizeStoredVolume(state?.volume);
    const persistPlaybackState = isPersistableGuildState(state);
    const persistVolumePreference = state?.volumePreferenceSet === true && volume !== null;
    if (!persistPlaybackState && !persistVolumePreference) continue;
    const scheduledEventStopAtMs = Number.parseInt(String(state.activeScheduledEventStopAtMs || 0), 10);
    const restoreBlockedUntil = normalizeStoredTimestampMs(state?.restoreBlockedUntil);
    const restoreBlockedAt = normalizeStoredTimestampMs(state?.restoreBlockedAt);
    const restoreBlockCount = Math.max(0, Number.parseInt(String(state?.restoreBlockCount || 0), 10) || 0);
    const restoreBlockReason = String(state?.restoreBlockReason || "").trim().slice(0, 200) || null;
    const channelVolumes = normalizeChannelVolumes(state?.channelVolumes);
    const entry = {
      savedAt: new Date().toISOString(),
    };

    if (persistPlaybackState) {
      entry.channelId = state.lastChannelId;
      entry.stationKey = state.currentStationKey;
      entry.stationName = state.currentStationName || null;
      entry.desiredStationKey = state.desiredStationKey || state.currentStationKey;
      entry.desiredStationName = state.desiredStationName || state.currentStationName || null;
      if (state.failoverActive === true && entry.desiredStationKey !== entry.stationKey) {
        entry.failoverActive = true;
        entry.failoverStartedAt = normalizeStoredTimestampMs(state.failoverStartedAt);
        entry.failoverReason = sanitizeText(state.failoverReason, 500) || null;
        entry.failoverFromStationKey = sanitizeText(state.failoverFromStationKey, 120) || null;
        entry.failoverFromStationName = sanitizeText(state.failoverFromStationName, 200) || null;
      }
      const failoverFailureStartedAt = normalizeStoredTimestampMs(state.failoverFailureStartedAt);
      const failoverFailureCount = Math.max(0, Number.parseInt(String(state.failoverFailureCount || 0), 10) || 0);
      const failoverFailureStationKey = sanitizeText(state.failoverFailureStationKey, 120);
      if (failoverFailureStartedAt > 0 && failoverFailureCount > 0 && failoverFailureStationKey) {
        entry.failoverFailureStationKey = failoverFailureStationKey;
        entry.failoverFailureCount = failoverFailureCount;
        entry.failoverFailureStartedAt = failoverFailureStartedAt;
        entry.failoverLastFailureAt = normalizeStoredTimestampMs(state.failoverLastFailureAt);
      }
      const sleepUntilMs = normalizeStoredTimestampMs(state?.sleepUntilMs);
      if (sleepUntilMs > Date.now()) entry.sleepUntilMs = sleepUntilMs;
      entry.scheduledEventId = state.activeScheduledEventId || null;
      entry.scheduledEventStopAtMs = Number.isFinite(scheduledEventStopAtMs) && scheduledEventStopAtMs > 0
        ? scheduledEventStopAtMs
        : 0;
      if (restoreBlockedUntil > Date.now()) {
        entry.restoreBlockedUntil = restoreBlockedUntil;
        if (restoreBlockedAt > 0) entry.restoreBlockedAt = restoreBlockedAt;
        if (restoreBlockCount > 0) entry.restoreBlockCount = restoreBlockCount;
        if (restoreBlockReason) entry.restoreBlockReason = restoreBlockReason;
      }
      const parkedReason = sanitizeText(state?.parkedReason, 40).toLowerCase();
      if (parkedReason) {
        entry.parkedReason = parkedReason;
        const parkedAt = normalizeStoredTimestampMs(state?.parkedAt);
        if (parkedAt > 0) entry.parkedAt = parkedAt;
        const parkedDetail = sanitizeText(state?.parkedDetail, 200);
        if (parkedDetail) entry.parkedDetail = parkedDetail;
      }
    }

    if (persistVolumePreference || persistPlaybackState) {
      entry.volume = volume ?? 100;
    }
    if (persistVolumePreference) {
      entry.volumePreference = true;
    }
    if (Object.keys(channelVolumes).length > 0) {
      entry.channelVolumes = channelVolumes;
      entry.volumePreference = true;
    }

    botData[guildId] = entry;
  }

  if (mongoActive) {
    writeBotData(botId, botData);
    return;
  }

  if (SPLIT_STATE_STORAGE_ENABLED) {
    const filePath = getSplitBotStateFile(botId);
    const backupFilePath = getSplitBotBackupFile(botId);
    if (!filePath) return;
    saveStateToFile(filePath, backupFilePath, botData);
    return;
  }

  const allState = loadState();
  if (Object.keys(botData).length > 0) {
    allState[botId] = botData;
  } else {
    delete allState[botId];
  }

  saveState(allState);
}

function getBotState(botId) {
  if (mongoActive) {
    const loaded = readBotData(botId);
    const normalized = normalizeStoredBotStateMap(loaded);
    if (JSON.stringify(loaded) !== JSON.stringify(normalized)) writeBotData(botId, normalized);
    return normalized;
  }
  if (SPLIT_STATE_STORAGE_ENABLED) {
    const loaded = loadSplitBotState(botId);
    const normalized = normalizeStoredBotStateMap(loaded);
    if (JSON.stringify(loaded || {}) !== JSON.stringify(normalized)) {
      saveResolvedBotState(botId, normalized);
    }
    return normalized;
  }
  const allState = loadState();
  const loaded = allState[botId] || {};
  const normalized = normalizeStoredBotStateMap(loaded);
  if (JSON.stringify(loaded || {}) !== JSON.stringify(normalized)) {
    if (hasStateEntries(normalized)) {
      allState[botId] = normalized;
    } else {
      delete allState[botId];
    }
    saveState(allState);
  }
  return normalized;
}

function saveResolvedBotState(botId, state) {
  if (mongoActive) {
    writeBotData(botId, state);
    return;
  }
  if (SPLIT_STATE_STORAGE_ENABLED) {
    const filePath = getSplitBotStateFile(botId);
    const backupFilePath = getSplitBotBackupFile(botId);
    if (!filePath) return;
    // An empty object is written instead of deleting the file, so a later
    // start does not fall back to the backup or the shared legacy file.
    saveStateToFile(filePath, backupFilePath, hasStateEntries(state) ? state : {});
    return;
  }

  const allState = loadState();
  if (hasStateEntries(state)) {
    allState[botId] = state;
  } else {
    delete allState[botId];
  }
  saveState(allState);
}

function setBotGuildVolume(botId, guildId, value, channelId = null) {
  const normalizedGuildId = String(guildId || "").trim();
  const normalizedVolume = normalizeStoredVolume(value);
  if (!normalizedGuildId || normalizedVolume === null) return false;
  const botState = getBotState(botId);
  const currentEntry = botState?.[normalizedGuildId] && typeof botState[normalizedGuildId] === "object"
    ? botState[normalizedGuildId]
    : {};
  const normalizedChannelId = sanitizeStateIdentifier(channelId);
  const channelVolumes = normalizeChannelVolumes(currentEntry.channelVolumes);
  if (normalizedChannelId) channelVolumes[normalizedChannelId] = normalizedVolume;
  const nextEntry = {
    ...currentEntry,
    volume: normalizedVolume,
    ...(Object.keys(channelVolumes).length ? { channelVolumes } : {}),
    volumePreference: true,
    savedAt: new Date().toISOString(),
  };
  botState[normalizedGuildId] = nextEntry;
  saveResolvedBotState(botId, botState);
  return true;
}

function getBotGuildVolume(botId, guildId, channelId = null) {
  const normalizedGuildId = String(guildId || "").trim();
  if (!normalizedGuildId) return null;
  const botState = getBotState(botId);
  const normalizedChannelId = sanitizeStateIdentifier(channelId);
  if (normalizedChannelId) {
    const channelVolume = normalizeStoredVolume(botState?.[normalizedGuildId]?.channelVolumes?.[normalizedChannelId]);
    if (channelVolume !== null) return channelVolume;
  }
  return normalizeStoredVolume(botState?.[normalizedGuildId]?.volume);
}

function getBotGuildChannelVolumes(botId, guildId) {
  const normalizedGuildId = String(guildId || "").trim();
  if (!normalizedGuildId) return {};
  const botState = getBotState(botId);
  return normalizeChannelVolumes(botState?.[normalizedGuildId]?.channelVolumes);
}

/**
 * Clears what a bot plays on a server. keepVolume: false when the bot left
 * the server; then nothing of it stays, not even the volume (#285).
 */
function clearBotGuild(botId, guildId, { keepVolume = true } = {}) {
  if (mongoActive) {
    const botState = readBotData(botId);
    const volumeOnlyEntry = keepVolume ? buildVolumeOnlyEntry(botState[guildId]) : null;
    if (volumeOnlyEntry) botState[guildId] = volumeOnlyEntry;
    else delete botState[guildId];
    writeBotData(botId, botState);
    return;
  }
  if (SPLIT_STATE_STORAGE_ENABLED) {
    const botState = loadSplitBotState(botId);
    const currentEntry = botState[guildId];
    const volumeOnlyEntry = keepVolume ? buildVolumeOnlyEntry(currentEntry) : null;
    if (volumeOnlyEntry) {
      botState[guildId] = volumeOnlyEntry;
    } else {
      delete botState[guildId];
    }
    const filePath = getSplitBotStateFile(botId);
    const backupFilePath = getSplitBotBackupFile(botId);
    if (!filePath) return;
    saveStateToFile(filePath, backupFilePath, botState);
    return;
  }

  const allState = loadState();
  if (allState[botId]) {
    const currentEntry = allState[botId][guildId];
    const volumeOnlyEntry = keepVolume ? buildVolumeOnlyEntry(currentEntry) : null;
    if (volumeOnlyEntry) {
      allState[botId][guildId] = volumeOnlyEntry;
    } else {
      delete allState[botId][guildId];
    }
    if (Object.keys(allState[botId]).length === 0) {
      delete allState[botId];
    }
    saveState(allState);
  }
}

/**
 * Removes a server from every bot's state in MongoDB (#285: its data is
 * deleted). Only this process's copies change in memory; each bot process
 * writes its own document, so another bot's document is not written from here.
 */
async function forgetGuildInBotStates(guildId) {
  const gid = String(guildId || "").trim();
  if (!gid || !mongoActive) return 0;
  for (const guilds of mongoCache.values()) delete guilds[gid];
  for (const guilds of pendingWrites.values()) delete guilds[gid];
  if (!isConnected()) return 0;
  const result = await getDb().collection(COLLECTION).updateMany({ [`guilds.${gid}`]: { $exists: true } }, { $unset: { [`guilds.${gid}`]: "" } });
  return result.modifiedCount || 0;
}

export {
  flushBotStateStore,
  forgetGuildInBotStates,
  initBotStateStore,
  saveBotState,
  getBotState,
  clearBotGuild,
  isPersistableGuildState,
  loadState,
  saveState,
  setBotGuildVolume,
  getBotGuildVolume,
  getBotGuildChannelVolumes,
};
