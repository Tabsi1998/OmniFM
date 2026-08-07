import fs from "node:fs";
import path from "node:path";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

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

function loadRawState() {
  try {
    if (!fs.existsSync(STATE_FILE)) return emptyState();
    if (fs.statSync(STATE_FILE).isDirectory()) return emptyState();
    const raw = fs.readFileSync(STATE_FILE, "utf8");
    if (!raw.trim()) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return emptyState();
  }
}

function saveRawState(state) {
  const normalized = normalizeState(state);
  const tempPath = `${STATE_FILE}.tmp-${process.pid}-${Date.now()}`;
  const serialized = `${JSON.stringify(normalized, null, 2)}\n`;

  try {
    fs.writeFileSync(tempPath, serialized, "utf8");
    try {
      fs.renameSync(tempPath, STATE_FILE);
    } catch (renameErr) {
      const code = String(renameErr?.code || "");
      if (["EBUSY", "EPERM", "EACCES", "EXDEV"].includes(code)) {
        fs.writeFileSync(STATE_FILE, serialized, "utf8");
      } else {
        throw renameErr;
      }
    }
  } catch {
    // ignore store write failures
  } finally {
    try {
      if (fs.existsSync(tempPath)) fs.unlinkSync(tempPath);
    } catch {
      // ignore cleanup failures
    }
  }

  return normalized;
}

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
