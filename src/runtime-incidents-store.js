import fs from "node:fs";
import path from "node:path";
import { getDb, isConnected } from "./lib/db.js";
import { log } from "./lib/logging.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

const STORE_FILE = resolveRuntimeDataPath("runtime-incidents.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;
const MAX_FALLBACK_INCIDENTS_PER_GUILD = 100;

function emptyState() {
  return {
    version: 1,
    incidents: {},
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeSnowflake(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

function sanitizeText(value, maxLen = 200) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, maxLen);
}

function normalizeBoolean(value) {
  return value === true;
}

function normalizeActor(value) {
  const input = isObject(value) ? value : {};
  const id = sanitizeSnowflake(input.id);
  const username = sanitizeText(input.username || input.globalName, 120);
  if (!id && !username) return null;
  return {
    id: id || null,
    username: username || null,
  };
}

function normalizeCount(value) {
  const parsed = Number.parseInt(String(value || 0), 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function normalizeIsoDate(value) {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeSeverity(value, eventKey = "") {
  const severity = String(value || "").trim().toLowerCase();
  if (["success", "warning", "critical"].includes(severity)) return severity;
  switch (String(eventKey || "").trim().toLowerCase()) {
    case "stream_recovered":
      return "success";
    case "stream_failover_exhausted":
      return "critical";
    default:
      return "warning";
  }
}

function normalizeCandidateList(value, maxItems = 6) {
  const entries = Array.isArray(value) ? value : [];
  return entries
    .map((entry) => sanitizeText(entry, 120))
    .filter(Boolean)
    .slice(0, maxItems);
}

function normalizeIncidentStatus(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "acknowledged") return "acknowledged";
  if (normalized === "open") return "open";
  return "all";
}

function sortRuntimeIncidents(rows = []) {
  return [...(Array.isArray(rows) ? rows : [])]
    .sort((a, b) => String(b?.timestamp || "").localeCompare(String(a?.timestamp || "")));
}

function filterRuntimeIncidentsByStatus(rows, status = "all") {
  const normalizedStatus = normalizeIncidentStatus(status);
  if (normalizedStatus === "all") return Array.isArray(rows) ? rows : [];
  return (Array.isArray(rows) ? rows : []).filter((incident) => {
    const incidentStatus = String(incident?.status || "").trim().toLowerCase() || "open";
    return incidentStatus === normalizedStatus;
  });
}

function buildRuntimeIncidentId(entry = {}) {
  return JSON.stringify([
    String(entry?.timestamp || ""),
    String(entry?.eventKey || ""),
    String(entry?.runtime?.id || ""),
    String(entry?.payload?.previousStationKey || ""),
    String(entry?.payload?.recoveredStationKey || ""),
    String(entry?.payload?.failoverStationKey || ""),
  ]);
}

function normalizeRuntimeIncident(rawIncident, guildId = "") {
  if (!isObject(rawIncident)) return null;
  const safeGuildId = sanitizeSnowflake(guildId || rawIncident.guildId);
  if (!safeGuildId) return null;

  const eventKey = sanitizeText(rawIncident.eventKey, 80).toLowerCase();
  const timestamp = normalizeIsoDate(rawIncident.timestamp || rawIncident.createdAt);
  if (!eventKey || !timestamp) return null;

  const runtimeInput = isObject(rawIncident.runtime) ? rawIncident.runtime : {};
  const payloadInput = isObject(rawIncident.payload) ? rawIncident.payload : {};
  const runtime = {
    id: sanitizeText(runtimeInput.id, 120),
    name: sanitizeText(runtimeInput.name, 120),
    role: sanitizeText(runtimeInput.role, 40),
  };
  const acknowledgedAt = normalizeIsoDate(rawIncident.acknowledgedAt);
  const acknowledgedBy = normalizeActor(rawIncident.acknowledgedBy);

  return {
    id: sanitizeText(rawIncident.id, 240) || buildRuntimeIncidentId({
      timestamp,
      eventKey,
      runtime,
      payload: payloadInput,
    }),
    guildId: safeGuildId,
    guildName: sanitizeText(rawIncident.guildName, 120),
    tier: sanitizeText(rawIncident.tier, 40).toLowerCase(),
    eventKey,
    severity: normalizeSeverity(rawIncident.severity, eventKey),
    timestamp,
    acknowledgedAt,
    acknowledgedBy,
    status: acknowledgedAt ? "acknowledged" : "open",
    runtime,
    payload: {
      previousStationKey: sanitizeText(payloadInput.previousStationKey, 120),
      previousStationName: sanitizeText(payloadInput.previousStationName, 120),
      recoveredStationKey: sanitizeText(payloadInput.recoveredStationKey, 120),
      recoveredStationName: sanitizeText(payloadInput.recoveredStationName, 120),
      failoverStationKey: sanitizeText(payloadInput.failoverStationKey, 120),
      failoverStationName: sanitizeText(payloadInput.failoverStationName, 120),
      restartReason: sanitizeText(payloadInput.restartReason, 80),
      triggerError: sanitizeText(payloadInput.triggerError, 240),
      streamErrorCount: normalizeCount(payloadInput.streamErrorCount),
      reconnectAttempts: normalizeCount(payloadInput.reconnectAttempts),
      listenerCount: normalizeCount(payloadInput.listenerCount),
      lastStreamErrorAt: normalizeIsoDate(payloadInput.lastStreamErrorAt),
      recoverableRestartError: normalizeBoolean(payloadInput.recoverableRestartError),
      attemptedCandidates: normalizeCandidateList(payloadInput.attemptedCandidates),
    },
  };
}

function normalizeState(rawState) {
  const source = isObject(rawState) ? rawState : {};
  const normalized = emptyState();

  for (const [rawGuildId, rawIncidents] of Object.entries(source.incidents || {})) {
    const guildId = sanitizeSnowflake(rawGuildId);
    if (!guildId) continue;
    normalized.incidents[guildId] = (Array.isArray(rawIncidents) ? rawIncidents : [])
      .map((incident) => normalizeRuntimeIncident(incident, guildId))
      .filter(Boolean)
      .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")))
      .slice(0, MAX_FALLBACK_INCIDENTS_PER_GUILD);
  }

  return normalized;
}

function readStateFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    if (!fs.statSync(filePath).isFile()) return null;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return emptyState();
    return normalizeState(JSON.parse(raw));
  } catch {
    return null;
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
  const payload = `${JSON.stringify(normalizeState(state), null, 2)}\n`;
  const tmpFile = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;

  try {
    if (fs.existsSync(STORE_FILE)) {
      try {
        fs.copyFileSync(STORE_FILE, BACKUP_FILE);
      } catch {}
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
    } catch {}
  }
}

async function runWithMongo(callback) {
  if (!isConnected() || !getDb()) return null;
  try {
    return await callback(getDb());
  } catch (err) {
    log("WARN", `[runtime-incidents] Mongo access failed: ${err?.message || err}`);
    return null;
  }
}

export async function recordRuntimeIncident(input) {
  const guildId = sanitizeSnowflake(input?.guildId);
  if (!guildId) return null;

  const incident = normalizeRuntimeIncident({
    ...input,
    guildId,
    timestamp: input?.timestamp || new Date().toISOString(),
  }, guildId);
  if (!incident) return null;

  const mongoResult = await runWithMongo(async (db) => {
    await db.collection("runtime_incidents").insertOne({
      ...incident,
      timestamp: new Date(incident.timestamp),
    });
    return incident;
  });
  if (mongoResult !== null) {
    return deepClone(mongoResult);
  }

  const state = ensureState();
  const current = Array.isArray(state.incidents[guildId]) ? state.incidents[guildId] : [];
  state.incidents[guildId] = sortRuntimeIncidents([incident, ...current]).slice(0, MAX_FALLBACK_INCIDENTS_PER_GUILD);
  saveState();
  return deepClone(incident);
}

export async function getRecentRuntimeIncidents(guildId, limit = 6, options = {}) {
  const safeGuildId = sanitizeSnowflake(guildId);
  if (!safeGuildId) return [];
  const safeLimit = Math.max(1, Math.min(20, Number.parseInt(String(limit || 6), 10) || 6));
  const status = normalizeIncidentStatus(options?.status);

  const mongoResult = await runWithMongo(async (db) => {
    const rows = await db.collection("runtime_incidents")
      .find({ guildId: safeGuildId })
      .sort({ timestamp: -1 })
      .limit(MAX_FALLBACK_INCIDENTS_PER_GUILD)
      .project({ _id: 0 })
      .toArray();
    return filterRuntimeIncidentsByStatus(rows
      .map((incident) => normalizeRuntimeIncident(incident, safeGuildId))
      .filter(Boolean), status).slice(0, safeLimit);
  });
  if (mongoResult !== null) {
    return deepClone(mongoResult || []);
  }

  const state = ensureState();
  return deepClone(filterRuntimeIncidentsByStatus(state.incidents[safeGuildId] || [], status).slice(0, safeLimit));
}

export async function acknowledgeRuntimeIncident(guildId, incidentId, actor = null) {
  const safeGuildId = sanitizeSnowflake(guildId);
  const safeIncidentId = sanitizeText(incidentId, 240);
  if (!safeGuildId || !safeIncidentId) return null;

  const acknowledgedAt = new Date().toISOString();
  const acknowledgedBy = normalizeActor(actor);

  const mongoResult = await runWithMongo(async (db) => {
    const filter = { guildId: safeGuildId, id: safeIncidentId };
    const update = {
      acknowledgedAt,
      acknowledgedBy,
    };
    const result = await db.collection("runtime_incidents").updateOne(filter, { $set: update });
    if (!result?.matchedCount) {
      return undefined;
    }
    const row = await db.collection("runtime_incidents").findOne(filter, { projection: { _id: 0 } });
    return normalizeRuntimeIncident(row, safeGuildId);
  });
  if (mongoResult !== null) {
    return mongoResult ? deepClone(mongoResult) : null;
  }

  const state = ensureState();
  const current = Array.isArray(state.incidents[safeGuildId]) ? state.incidents[safeGuildId] : [];
  const index = current.findIndex((incident) => String(incident?.id || "").trim() === safeIncidentId);
  if (index < 0) return null;

  const updatedIncident = normalizeRuntimeIncident({
    ...current[index],
    acknowledgedAt,
    acknowledgedBy,
  }, safeGuildId);
  if (!updatedIncident) return null;

  state.incidents[safeGuildId] = sortRuntimeIncidents([
    ...current.slice(0, index),
    updatedIncident,
    ...current.slice(index + 1),
  ]).slice(0, MAX_FALLBACK_INCIDENTS_PER_GUILD);
  saveState();
  return deepClone(updatedIncident);
}

export async function clearRuntimeIncidentsForGuild(guildId) {
  const safeGuildId = sanitizeSnowflake(guildId);
  if (!safeGuildId) return false;

  await runWithMongo(async (db) => {
    await db.collection("runtime_incidents").deleteMany({ guildId: safeGuildId });
  });

  const state = ensureState();
  if (state.incidents[safeGuildId]) {
    delete state.incidents[safeGuildId];
    saveState();
  }
  return true;
}
