import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { log, logStoreLoadError } from "./lib/logging.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

function resolveStatePath(value, fallbackPath) {
  const raw = String(value || "").trim();
  if (!raw) return fallbackPath;
  return path.isAbsolute(raw) ? raw : path.resolve(rootDir, raw);
}

const STATE_FILE = resolveStatePath(process.env.OMNIFM_BOT_STATE_FILE, path.join(rootDir, "bot-state.json"));
const STATE_BACKUP_FILE = `${STATE_FILE}.bak`;
const SPLIT_PROCESS_ROLE = String(process.env.BOT_PROCESS_ROLE || "").trim().toLowerCase();
const SPLIT_STATE_STORAGE_ENABLED = SPLIT_PROCESS_ROLE === "commander" || SPLIT_PROCESS_ROLE === "worker";
const SPLIT_STATE_DIR = resolveStatePath(process.env.BOT_STATE_SPLIT_DIR, path.join(rootDir, "bot-state"));

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

function normalizeStoredTimestampMs(rawValue) {
  if (!rawValue) return 0;
  const numeric = Number.parseInt(String(rawValue ?? ""), 10);
  if (Number.isFinite(numeric) && numeric > 0) return numeric;
  const parsed = Date.parse(String(rawValue));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function hasSavedVolumePreference(entry) {
  return normalizeStoredVolume(entry?.volume) !== null;
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
    const raw = fs.readFileSync(filePath, "utf8");
    if (!raw || raw.trim().length === 0) return {};
    return JSON.parse(raw);
  } catch (err) {
    logStoreLoadError("bot-state", filePath, err);
    return null;
  }
}

function loadState() {
  return readStateFile(STATE_FILE) || readStateFile(STATE_BACKUP_FILE) || {};
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
        log("WARN", `[bot-state] ${dir} ist keine Verzeichnisstruktur fuer Split-State.`);
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
  if (volume === null) return null;
  return {
    volume,
    volumePreference: true,
    savedAt: entry?.savedAt || new Date().toISOString(),
  };
}

function normalizeStoredBotStateEntry(rawEntry = {}) {
  const input = rawEntry && typeof rawEntry === "object" ? rawEntry : {};
  const volume = normalizeStoredVolume(input.volume);
  const volumePreference = input.volumePreference === true;
  const channelId = sanitizeStateIdentifier(input.channelId);
  const stationKey = sanitizeText(input.stationKey, 120);
  const stationName = sanitizeText(input.stationName, 200) || null;
  const scheduledEventId = sanitizeSnowflake(input.scheduledEventId) || null;
  const scheduledEventStopAtMs = normalizeStoredTimestampMs(input.scheduledEventStopAtMs);
  const restoreBlockedUntil = normalizeStoredTimestampMs(input.restoreBlockedUntil);
  const restoreBlockedAt = normalizeStoredTimestampMs(input.restoreBlockedAt);
  const restoreBlockCount = Math.max(0, Number.parseInt(String(input.restoreBlockCount || 0), 10) || 0);
  const restoreBlockReason = sanitizeText(input.restoreBlockReason, 200) || null;
  const savedAt = (() => {
    const normalized = normalizeStoredTimestampMs(input.savedAt);
    return normalized > 0 ? new Date(normalized).toISOString() : new Date().toISOString();
  })();

  const hasPlaybackTarget = Boolean(channelId && stationKey);
  const hasVolumePreference = volume !== null && (volumePreference || hasPlaybackTarget);
  if (!hasPlaybackTarget && !hasVolumePreference) {
    return null;
  }

  const normalized = { savedAt };
  if (hasPlaybackTarget) {
    normalized.channelId = channelId;
    normalized.stationKey = stationKey;
    normalized.stationName = stationName;
    normalized.scheduledEventId = scheduledEventId;
    normalized.scheduledEventStopAtMs = scheduledEventStopAtMs > 0 ? scheduledEventStopAtMs : 0;
    if (restoreBlockedUntil > 0) normalized.restoreBlockedUntil = restoreBlockedUntil;
    if (restoreBlockedAt > 0) normalized.restoreBlockedAt = restoreBlockedAt;
    if (restoreBlockCount > 0) normalized.restoreBlockCount = restoreBlockCount;
    if (restoreBlockReason) normalized.restoreBlockReason = restoreBlockReason;
  }

  if (hasVolumePreference) {
    normalized.volume = volume;
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
    // Docker-Mount: Wenn es ein Verzeichnis ist, NICHT versuchen zu loeschen
    // (schlaegt fehl mit "Device or resource busy")
    if (fs.existsSync(STATE_FILE) && fs.statSync(STATE_FILE).isDirectory()) {
      log("WARN", `[bot-state] ${STATE_FILE} ist ein Verzeichnis - State wird nur im Speicher gehalten.`);
      log("WARN", `[bot-state] Fix: echo '{}' > ./bot-state.json && docker compose up -d`);
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
      log("WARN", `[bot-state] Split-State-Verzeichnis ungueltig fuer ${filePath}.`);
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
  if (hasStateEntries(splitState)) {
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
    `[bot-state] Legacy-State fuer ${botId} nach Split-Storage migriert (${Object.keys(legacyBotState).length} Guild(s)).`
  );
  return legacyBotState;
}

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
    const entry = {
      savedAt: new Date().toISOString(),
    };

    if (persistPlaybackState) {
      entry.channelId = state.lastChannelId;
      entry.stationKey = state.currentStationKey;
      entry.stationName = state.currentStationName || null;
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
    }

    if (persistVolumePreference || persistPlaybackState) {
      entry.volume = volume ?? 100;
    }
    if (persistVolumePreference) {
      entry.volumePreference = true;
    }

    botData[guildId] = entry;
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
  if (SPLIT_STATE_STORAGE_ENABLED) {
    const filePath = getSplitBotStateFile(botId);
    const backupFilePath = getSplitBotBackupFile(botId);
    if (!filePath) return;
    if (!hasStateEntries(state)) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
      return;
    }
    saveStateToFile(filePath, backupFilePath, state);
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

function setBotGuildVolume(botId, guildId, value) {
  const normalizedGuildId = String(guildId || "").trim();
  const normalizedVolume = normalizeStoredVolume(value);
  if (!normalizedGuildId || normalizedVolume === null) return false;
  const botState = getBotState(botId);
  const nextEntry = {
    ...(botState?.[normalizedGuildId] && typeof botState[normalizedGuildId] === "object"
      ? botState[normalizedGuildId]
      : {}),
    volume: normalizedVolume,
    volumePreference: true,
    savedAt: new Date().toISOString(),
  };
  botState[normalizedGuildId] = nextEntry;
  saveResolvedBotState(botId, botState);
  return true;
}

function getBotGuildVolume(botId, guildId) {
  const normalizedGuildId = String(guildId || "").trim();
  if (!normalizedGuildId) return null;
  const botState = getBotState(botId);
  return normalizeStoredVolume(botState?.[normalizedGuildId]?.volume);
}

function clearBotGuild(botId, guildId) {
  if (SPLIT_STATE_STORAGE_ENABLED) {
    const botState = loadSplitBotState(botId);
    const currentEntry = botState[guildId];
    const volumeOnlyEntry = buildVolumeOnlyEntry(currentEntry);
    if (volumeOnlyEntry) {
      botState[guildId] = volumeOnlyEntry;
    } else {
      delete botState[guildId];
    }
    const filePath = getSplitBotStateFile(botId);
    const backupFilePath = getSplitBotBackupFile(botId);
    if (!filePath) return;
    if (Object.keys(botState).length === 0) {
      try {
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      } catch {
        // ignore
      }
      return;
    }
    saveStateToFile(filePath, backupFilePath, botState);
    return;
  }

  const allState = loadState();
  if (allState[botId]) {
    const currentEntry = allState[botId][guildId];
    const volumeOnlyEntry = buildVolumeOnlyEntry(currentEntry);
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

export {
  saveBotState,
  getBotState,
  clearBotGuild,
  isPersistableGuildState,
  loadState,
  saveState,
  setBotGuildVolume,
  getBotGuildVolume,
};
