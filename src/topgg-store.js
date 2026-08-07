import fs from "node:fs";
import path from "node:path";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

const STATE_FILE = resolveRuntimeDataPath("topgg.json");

function emptyState() {
  return {
    version: 1,
    project: null,
    lastProjectSync: null,
    lastCommandsSync: null,
    lastStatsSync: null,
    lastVoteSync: null,
    lastWebhookVoteAt: null,
    lastWebhookTestAt: null,
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

function normalizeProjectSummary(rawProject) {
  if (!rawProject || typeof rawProject !== "object") return null;
  return {
    id: String(rawProject.id || "").trim().slice(0, 40) || null,
    botId: String(rawProject.botId || rawProject.platformId || rawProject.platform_id || "").trim().slice(0, 40) || null,
    name: String(rawProject.name || "").trim().slice(0, 120) || null,
    platform: String(rawProject.platform || "").trim().slice(0, 40) || null,
    type: String(rawProject.type || "").trim().slice(0, 40) || null,
    headline: String(rawProject.headline || "").trim().slice(0, 240) || null,
    tags: Array.isArray(rawProject.tags)
      ? rawProject.tags.map((tag) => String(tag || "").trim()).filter(Boolean).slice(0, 50)
      : [],
    votes: Math.max(0, Number.parseInt(String(rawProject.votes || 0), 10) || 0),
    votesTotal: Math.max(0, Number.parseInt(String(rawProject.votesTotal || rawProject.votes_total || 0), 10) || 0),
    reviewScore: Math.max(0, Number(rawProject.reviewScore || rawProject.review_score || 0) || 0),
    reviewCount: Math.max(0, Number.parseInt(String(rawProject.reviewCount || rawProject.review_count || 0), 10) || 0),
    checkedAt: normalizeIso(rawProject.checkedAt),
  };
}

function normalizeState(rawState) {
  const input = rawState && typeof rawState === "object" ? rawState : {};
  return {
    version: 1,
    project: normalizeProjectSummary(input.project),
    lastProjectSync: normalizeSyncEntry(input.lastProjectSync),
    lastCommandsSync: normalizeSyncEntry(input.lastCommandsSync),
    lastStatsSync: normalizeSyncEntry(input.lastStatsSync),
    lastVoteSync: normalizeSyncEntry(input.lastVoteSync),
    lastWebhookVoteAt: input.lastWebhookVoteAt ? normalizeIso(input.lastWebhookVoteAt) : null,
    lastWebhookTestAt: input.lastWebhookTestAt ? normalizeIso(input.lastWebhookTestAt) : null,
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

function setTopGGSyncStatus(kind, payload = {}) {
  const keyMap = {
    project: "lastProjectSync",
    commands: "lastCommandsSync",
    stats: "lastStatsSync",
    votes: "lastVoteSync",
  };
  const field = keyMap[String(kind || "").trim().toLowerCase()];
  if (!field) return null;

  const state = loadRawState();
  state[field] = normalizeSyncEntry({
    at: new Date().toISOString(),
    ...payload,
  });
  return saveRawState(state)[field];
}

function setTopGGProjectState(projectSummary, syncPayload = {}) {
  const state = loadRawState();
  state.project = normalizeProjectSummary(projectSummary);
  state.lastProjectSync = normalizeSyncEntry({
    at: new Date().toISOString(),
    ok: syncPayload.ok !== false,
    source: syncPayload.source || "api",
    botId: syncPayload.botId || state.project?.botId || null,
    details: syncPayload.details || null,
    error: syncPayload.error || null,
  });
  return saveRawState(state);
}

function setTopGGWebhookEvent(kind, payload = {}) {
  const state = loadRawState();
  const at = normalizeIso(payload.at);
  if (String(kind || "").trim().toLowerCase() === "test") {
    state.lastWebhookTestAt = at;
  } else {
    state.lastWebhookVoteAt = at;
  }
  return saveRawState(state);
}

function getTopGGState() {
  return loadRawState();
}

export {
  getTopGGState,
  setTopGGProjectState,
  setTopGGSyncStatus,
  setTopGGWebhookEvent,
};
