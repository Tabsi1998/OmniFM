import fs from "node:fs";
import path from "node:path";
import { buildCustomStationReference, parseCustomStationReference } from "./custom-stations.js";
import { log } from "./lib/logging.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";
import { getDb, isConnected } from "./lib/db.js";

const EVENTS_FILE = resolveRuntimeDataPath("scheduled-events.json");
const SUPPORTED_REPEAT = new Set([
  "none",
  "daily",
  "weekdays",
  "weekly",
  "biweekly",
  "yearly",
  "monthly_first_weekday",
  "monthly_second_weekday",
  "monthly_third_weekday",
  "monthly_fourth_weekday",
  "monthly_last_weekday",
]);
const LOAD_ERROR_LOG_COOLDOWN_MS = 60_000;
const CORRUPT_BACKUP_PREFIX = ".corrupt-";

let lastLoadErrorSignature = "";
let lastLoadErrorAt = 0;
let lastCorruptRecoverySignature = "";
let mongoState = null;
let mongoRefreshTimer = null;
let mongoWritesPending = 0;
let mongoWriteQueue = Promise.resolve();

function cloneState(state) {
  return JSON.parse(JSON.stringify(state || emptyState()));
}

async function readMongoState() {
  if (!isConnected() || mongoWritesPending > 0) return;
  const rows = await getDb().collection("scheduled_events").find({}, { projection: { _id: 0, _eventId: 0 } }).toArray();
  mongoState = normalizeState({ events: rows });
}

function queueMongoDelta(previousState, nextState) {
  if (!isConnected()) return;
  const previous = new Map((previousState?.events || []).map((event) => [event.id, event]));
  const next = new Map((nextState?.events || []).map((event) => [event.id, event]));
  const operations = [];
  for (const [id, event] of next.entries()) {
    if (JSON.stringify(previous.get(id)) === JSON.stringify(event)) continue;
    operations.push({ replaceOne: { filter: { _eventId: id }, replacement: { _eventId: id, ...event }, upsert: true } });
  }
  for (const id of previous.keys()) {
    if (!next.has(id)) operations.push({ deleteOne: { filter: { _eventId: id } } });
  }
  if (!operations.length) return;
  mongoWritesPending += 1;
  mongoWriteQueue = mongoWriteQueue
    .then(async () => {
      if (isConnected()) await getDb().collection("scheduled_events").bulkWrite(operations, { ordered: false });
    })
    .catch((err) => log("ERROR", `[scheduled-events] MongoDB-Speichern fehlgeschlagen: ${err?.message || err}`))
    .finally(() => { mongoWritesPending = Math.max(0, mongoWritesPending - 1); });
}

async function initScheduledEventsStore({ refreshMs = 2000 } = {}) {
  if (!isConnected()) return { backend: "file", count: loadRawState().events.length };
  const collection = getDb().collection("scheduled_events");
  const fileState = loadRawState();
  if (fileState.events.length) {
    const migration = await collection.bulkWrite(fileState.events.map((event) => ({
      updateOne: { filter: { _eventId: event.id }, update: { $setOnInsert: { _eventId: event.id, ...event } }, upsert: true },
    })), { ordered: false });
    if (migration.upsertedCount > 0) log("INFO", `[scheduled-events] ${migration.upsertedCount} fehlende Datei-Events nach MongoDB migriert.`);
  }
  await readMongoState();
  if (!mongoRefreshTimer) {
    mongoRefreshTimer = setInterval(() => {
      readMongoState().catch((err) => log("WARN", `[scheduled-events] MongoDB-Refresh fehlgeschlagen: ${err?.message || err}`));
    }, Math.max(1000, Number(refreshMs) || 2000));
    mongoRefreshTimer.unref?.();
  }
  log("INFO", `[scheduled-events] MongoDB ist kanonischer Event-Store (${mongoState?.events?.length || 0} Events).`);
  return { backend: "mongo", count: mongoState?.events?.length || 0 };
}

async function stopScheduledEventsStore() {
  if (mongoRefreshTimer) clearInterval(mongoRefreshTimer);
  mongoRefreshTimer = null;
  await mongoWriteQueue.catch(() => null);
}

function emptyState() {
  return {
    version: 1,
    events: [],
  };
}

function logLoadErrorOnce(message) {
  const signature = String(message || "unknown");
  const now = Date.now();
  if (signature === lastLoadErrorSignature && now - lastLoadErrorAt < LOAD_ERROR_LOG_COOLDOWN_MS) {
    return;
  }
  lastLoadErrorSignature = signature;
  lastLoadErrorAt = now;
  log("ERROR", `[scheduled-events] Load error: ${signature}`);
}

function extractFirstJsonDocument(raw) {
  const text = String(raw || "");
  if (!text.trim()) return null;

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];

    if (start < 0) {
      if (char === "\uFEFF") {
        continue;
      }
      if (char === "{" || char === "[") {
        start = index;
        depth = 1;
      } else if (!/\s/.test(char)) {
        return null;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }

    if (char === "{" || char === "[") {
      depth += 1;
      continue;
    }

    if (char === "}" || char === "]") {
      depth -= 1;
      if (depth === 0) {
        return text.slice(start, index + 1);
      }
      continue;
    }
  }

  return null;
}

function parseStateWithRecovery(raw) {
  const full = JSON.parse(raw);
  return {
    state: normalizeState(full),
    recovered: false,
  };
}

function tryParseState(raw) {
  try {
    return parseStateWithRecovery(raw);
  } catch (primaryErr) {
    const firstDocument = extractFirstJsonDocument(raw);
    if (!firstDocument) throw primaryErr;

    const recovered = parseStateWithRecovery(firstDocument);
    return {
      state: recovered.state,
      recovered: true,
      reason: primaryErr?.message || "invalid-json",
    };
  }
}

function backupCorruptRaw(raw) {
  const backupPath = `${EVENTS_FILE}${CORRUPT_BACKUP_PREFIX}${Date.now()}.json`;
  fs.writeFileSync(backupPath, raw, "utf8");
  return backupPath;
}

function recoverCorruptFile(raw, reason) {
  const signature = `${reason}|${String(raw || "").slice(0, 120)}`;
  if (signature === lastCorruptRecoverySignature) return;
  lastCorruptRecoverySignature = signature;

  let backupPath = null;
  try {
    backupPath = backupCorruptRaw(raw);
  } catch {
    // ignore
  }

  try {
    saveRawState(emptyState());
  } catch {
    // ignore
  }

  const backupHint = backupPath ? ` Backup: ${backupPath}` : "";
  log("WARN", `[scheduled-events] Datei war ungueltig und wurde auf leeren State zurueckgesetzt.${backupHint}`);
}

function sanitizeId(raw) {
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 40);
}

function sanitizeDiscordId(raw) {
  const id = String(raw || "").trim();
  return /^\d{17,22}$/.test(id) ? id : null;
}

function sanitizeStationKey(raw) {
  const custom = parseCustomStationReference(raw);
  if (custom.isCustom) {
    return buildCustomStationReference(custom.key);
  }
  return String(raw || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, "")
    .slice(0, 80);
}

function sanitizeRepeat(raw) {
  const repeat = String(raw || "none").trim().toLowerCase();
  return SUPPORTED_REPEAT.has(repeat) ? repeat : "none";
}

function sanitizeTimeZone(raw) {
  const value = String(raw || "").trim();
  if (!value) return null;
  return value.slice(0, 80);
}

function sanitizeText(raw, maxLen = 300) {
  const text = String(raw || "").trim();
  if (!text) return null;
  return text.slice(0, maxLen);
}

function sanitizeDurationMs(raw) {
  const value = Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(value) || value <= 0) return 0;
  const maxDurationMs = 365 * 24 * 60 * 60 * 1000;
  return Math.min(value, maxDurationMs);
}

function sanitizeRunAtMs(raw) {
  const runAtMs = Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(runAtMs) || runAtMs <= 0) return null;
  return runAtMs;
}

function sanitizeBoolean(raw, fallback = false) {
  if (raw === undefined || raw === null) return Boolean(fallback);
  if (typeof raw === "boolean") return raw;
  const text = String(raw).trim().toLowerCase();
  if (!text) return Boolean(fallback);
  if (["1", "true", "yes", "on", "ja", "j"].includes(text)) return true;
  if (["0", "false", "no", "off", "nein", "n"].includes(text)) return false;
  return Boolean(fallback);
}

function sanitizeLastRunAtMs(raw) {
  const value = Number.parseInt(String(raw || ""), 10);
  if (!Number.isFinite(value) || value < 0) return 0;
  return value;
}

function normalizeEvent(raw) {
  if (!raw || typeof raw !== "object") return null;

  const id = sanitizeId(raw.id);
  const guildId = sanitizeDiscordId(raw.guildId);
  const voiceChannelId = sanitizeDiscordId(raw.voiceChannelId);
  const stationKey = sanitizeStationKey(raw.stationKey);
  const botId = sanitizeText(raw.botId, 60);
  const name = sanitizeText(raw.name, 120);
  const runAtMs = sanitizeRunAtMs(raw.runAtMs);
  const repeat = sanitizeRepeat(raw.repeat);
  const createdAt = sanitizeText(raw.createdAt, 64) || new Date().toISOString();
  const createdByUserId = sanitizeDiscordId(raw.createdByUserId);
  const textChannelId = sanitizeDiscordId(raw.textChannelId);
  const announceMessage = sanitizeText(raw.announceMessage, 1200);
  const description = sanitizeText(raw.description, 1000);
  const stageTopic = sanitizeText(raw.stageTopic, 120);
  const timeZone = sanitizeTimeZone(raw.timeZone);
  const createDiscordEvent = sanitizeBoolean(raw.createDiscordEvent, false);
  const discordScheduledEventId = sanitizeDiscordId(raw.discordScheduledEventId);
  const discordSyncError = sanitizeText(raw.discordSyncError, 300);
  const durationMs = sanitizeDurationMs(raw.durationMs);
  const activeUntilMs = sanitizeRunAtMs(raw.activeUntilMs) || 0;
  const lastStopAtMs = sanitizeLastRunAtMs(raw.lastStopAtMs);
  const deleteAfterStop = sanitizeBoolean(raw.deleteAfterStop, false);
  const updatedAt = sanitizeText(raw.updatedAt, 64) || createdAt;

  if (!id || !guildId || !voiceChannelId || !stationKey || !botId || !name || !runAtMs) {
    return null;
  }

  return {
    id,
    guildId,
    botId,
    name,
    stationKey,
    voiceChannelId,
    textChannelId: textChannelId || null,
    announceMessage: announceMessage || null,
    description: description || null,
    stageTopic: stageTopic || null,
    timeZone: timeZone || null,
    createDiscordEvent,
    discordScheduledEventId: discordScheduledEventId || null,
    discordSyncError: discordSyncError || null,
    repeat,
    runAtMs,
    durationMs,
    activeUntilMs,
    createdAt,
    updatedAt,
    createdByUserId: createdByUserId || null,
    enabled: raw.enabled !== false,
    lastRunAtMs: sanitizeLastRunAtMs(raw.lastRunAtMs),
    lastStopAtMs,
    deleteAfterStop,
  };
}

function normalizeState(input) {
  if (!input) return emptyState();
  const sourceEvents = Array.isArray(input)
    ? input
    : (typeof input === "object" && Array.isArray(input.events))
      ? input.events
      : [];
  const events = sourceEvents
      .map((entry) => normalizeEvent(entry))
      .filter(Boolean);
  events.sort((a, b) => a.runAtMs - b.runAtMs);
  return {
    version: 1,
    events,
  };
}

function loadRawState() {
  if (mongoState) return cloneState(mongoState);
  try {
    if (!fs.existsSync(EVENTS_FILE)) return emptyState();
    if (fs.statSync(EVENTS_FILE).isDirectory()) {
      log("WARN", `[scheduled-events] ${EVENTS_FILE} ist ein Verzeichnis - nutze leeren State.`);
      return emptyState();
    }
    const raw = fs.readFileSync(EVENTS_FILE, "utf8");
    if (!raw.trim()) return emptyState();
    const parsed = tryParseState(raw);
    if (parsed.recovered) {
      saveRawState(parsed.state);
      log("WARN", `[scheduled-events] Ungueltiges JSON erkannt und automatisch repariert (${parsed.reason || "unknown"}).`);
    }
    return parsed.state;
  } catch (err) {
    const message = err?.message || String(err);
    logLoadErrorOnce(message);
    try {
      if (fs.existsSync(EVENTS_FILE) && fs.statSync(EVENTS_FILE).isFile()) {
        const raw = fs.readFileSync(EVENTS_FILE, "utf8");
        if (raw.trim()) {
          recoverCorruptFile(raw, message);
        }
      }
    } catch {
      // ignore follow-up recovery errors
    }
    return emptyState();
  }
}

function saveRawState(state) {
  const normalized = normalizeState(state);
  if (mongoState) {
    const previous = mongoState;
    mongoState = cloneState(normalized);
    queueMongoDelta(previous, normalized);
    return cloneState(normalized);
  }
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;
  const tempPath = `${EVENTS_FILE}.tmp-${process.pid}-${Date.now()}`;

  try {
    fs.writeFileSync(tempPath, serialized, "utf8");
    try {
      fs.renameSync(tempPath, EVENTS_FILE);
    } catch (renameErr) {
      const code = String(renameErr?.code || "");
      if (["EBUSY", "EPERM", "EACCES", "EXDEV"].includes(code)) {
        fs.writeFileSync(EVENTS_FILE, serialized, "utf8");
      } else {
        throw renameErr;
      }
    }
  } catch (err) {
    log("ERROR", `[scheduled-events] Save error: ${err?.message || err}`);
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore
    }
  }

  return normalized;
}

function buildEventId() {
  return `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function listScheduledEvents({ guildId = null, botId = null, includeDisabled = true } = {}) {
  const state = loadRawState();
  return state.events
    .filter((entry) => {
      if (guildId && entry.guildId !== String(guildId)) return false;
      if (botId && entry.botId !== String(botId)) return false;
      if (!includeDisabled && !entry.enabled) return false;
      return true;
    })
    .sort((a, b) => a.runAtMs - b.runAtMs);
}

function createScheduledEvent(input) {
  const state = loadRawState();
  const nowIso = new Date().toISOString();
  const event = normalizeEvent({
    id: buildEventId(),
    ...input,
    createdAt: nowIso,
    updatedAt: nowIso,
    enabled: true,
    lastRunAtMs: 0,
  });

  if (!event) {
    return { ok: false, message: "Event ist ungueltig." };
  }

  state.events.push(event);
  const next = saveRawState(state);
  const saved = next.events.find((entry) => entry.id === event.id) || event;
  return { ok: true, event: saved };
}

function deleteScheduledEvent(id, { guildId = null, botId = null } = {}) {
  const eventId = sanitizeId(id);
  if (!eventId) return { ok: false, message: "Event-ID fehlt." };

  const state = loadRawState();
  const before = state.events.length;
  state.events = state.events.filter((entry) => {
    if (entry.id !== eventId) return true;
    if (guildId && entry.guildId !== String(guildId)) return true;
    if (botId && entry.botId !== String(botId)) return true;
    return false;
  });

  if (state.events.length === before) {
    return { ok: false, message: "Event nicht gefunden." };
  }

  saveRawState(state);
  return { ok: true };
}

function patchScheduledEvent(id, patch) {
  const eventId = sanitizeId(id);
  if (!eventId) return { ok: false, message: "Event-ID fehlt." };

  const state = loadRawState();
  const index = state.events.findIndex((entry) => entry.id === eventId);
  if (index < 0) return { ok: false, message: "Event nicht gefunden." };

  const current = state.events[index];
  const next = normalizeEvent({
    ...current,
    ...patch,
    id: current.id,
    guildId: current.guildId,
    botId: current.botId,
    updatedAt: new Date().toISOString(),
  });
  if (!next) return { ok: false, message: "Event-Update ist ungueltig." };

  state.events[index] = next;
  saveRawState(state);
  return { ok: true, event: next };
}

function getScheduledEvent(id) {
  const eventId = sanitizeId(id);
  if (!eventId) return null;
  const state = loadRawState();
  return state.events.find((entry) => entry.id === eventId) || null;
}

function deleteScheduledEventsByFilter({ guildId = null, botId = null } = {}) {
  const state = loadRawState();
  const before = state.events.length;
  state.events = state.events.filter((entry) => {
    if (guildId && entry.guildId !== String(guildId)) return true;
    if (botId && entry.botId !== String(botId)) return true;
    if (!guildId && !botId) return true;
    return false;
  });

  if (state.events.length === before) return { ok: true, removed: 0 };
  saveRawState(state);
  return { ok: true, removed: before - state.events.length };
}

// Compatibility helpers for older imports.
function listAllEvents() {
  return listScheduledEvents({});
}

function getEvent(eventId) {
  return getScheduledEvent(eventId);
}

function addEvent(eventData) {
  return createScheduledEvent(eventData);
}

function removeEvent(eventId) {
  return deleteScheduledEvent(eventId);
}

function updateEventRunAtMs(eventId, runAtMs) {
  const result = patchScheduledEvent(eventId, { runAtMs });
  return Boolean(result?.ok);
}

function normalizeScheduledEventInput(eventData) {
  return normalizeEvent(eventData);
}

export {
  listAllEvents,
  addEvent,
  removeEvent,
  updateEventRunAtMs,
  getEvent,
  listScheduledEvents,
  createScheduledEvent,
  deleteScheduledEvent,
  patchScheduledEvent,
  getScheduledEvent,
  deleteScheduledEventsByFilter,
  normalizeScheduledEventInput,
  initScheduledEventsStore,
  stopScheduledEventsStore,
};
