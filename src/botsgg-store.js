import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";
import { createStateDocumentStore } from "./lib/state-document-store.js";

const STATE_FILE = resolveRuntimeDataPath("botsgg.json");

function emptyState() {
  return {
    version: 1,
    lastStatsSync: null,
  };
}

function normalizeIso(rawValue, fallback = new Date().toISOString()) {
  const value = String(rawValue || "").trim();
  if (!value) return fallback;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? fallback : parsed.toISOString();
}

function normalizeSyncEntry(rawEntry) {
  if (!rawEntry || typeof rawEntry !== "object") return null;
  return {
    at: normalizeIso(rawEntry.at),
    ok: rawEntry.ok !== false,
    source: rawEntry.source ? String(rawEntry.source).slice(0, 60) : null,
    botId: rawEntry.botId ? String(rawEntry.botId).slice(0, 40) : null,
    details: rawEntry.details && typeof rawEntry.details === "object"
      ? rawEntry.details
      : null,
    error: rawEntry.error ? String(rawEntry.error).slice(0, 240) : null,
  };
}

function normalizeState(rawState) {
  const input = rawState && typeof rawState === "object" ? rawState : {};
  return {
    version: 1,
    lastStatsSync: normalizeSyncEntry(input.lastStatsSync),
  };
}

// MongoDB when connected (#292), the JSON file otherwise; saves set only changed fields.
const stateDocument = createStateDocumentStore({ id: "botsgg", file: STATE_FILE, emptyState, normalize: normalizeState });

function loadRawState() {
  return stateDocument.load();
}

function saveRawState(state) {
  return stateDocument.save(state);
}

export const initBotsGGStore = (options) => stateDocument.init(options);
export const stopBotsGGStore = () => stateDocument.stop();

function setBotsGGSyncStatus(payload = {}) {
  const state = loadRawState();
  state.lastStatsSync = normalizeSyncEntry({
    at: new Date().toISOString(),
    ...payload,
  });
  return saveRawState(state).lastStatsSync;
}

function getBotsGGState() {
  return loadRawState();
}

export {
  getBotsGGState,
  setBotsGGSyncStatus,
};
