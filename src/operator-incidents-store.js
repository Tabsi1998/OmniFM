import fs from "node:fs";
import path from "node:path";
import { getDb, isConnected } from "./lib/db.js";
import { log, onLoggedError } from "./lib/logging.js";
import { redactSensitiveData, redactSensitiveText } from "./lib/redact-sensitive.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

const STORE_FILE = resolveRuntimeDataPath("operator-incidents.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;
const MAX_FALLBACK_INCIDENTS = 500;
const OPERATOR_INCIDENT_REPEAT_COOLDOWN_MS = Math.max(
  10_000,
  Number.parseInt(String(process.env.OPERATOR_INCIDENT_REPEAT_COOLDOWN_MS || "300000"), 10) || 300000
);
const OPERATOR_INCIDENT_SUMMARY_WINDOW_MS = 24 * 60 * 60 * 1000;

function emptyState() {
  return {
    version: 1,
    incidents: [],
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeText(value, maxLen = 240) {
  const text = redactSensitiveText(value).trim();
  if (!text) return "";
  return text.slice(0, maxLen);
}

function normalizeIsoDate(value) {
  const date = value instanceof Date ? value : new Date(String(value || ""));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

function normalizeLevel(value) {
  const normalized = String(value || "").trim().toUpperCase();
  if (["DEBUG", "INFO", "WARN", "ERROR", "CRITICAL"].includes(normalized)) return normalized;
  return "ERROR";
}

function normalizeContext(value) {
  const input = redactSensitiveData(isObject(value) ? value : {});
  const entries = Object.entries(input)
    .map(([key, entryValue]) => [sanitizeText(key, 60), sanitizeText(entryValue, 240)])
    .filter(([key, entryValue]) => key && entryValue);
  return Object.fromEntries(entries.slice(0, 20));
}

function normalizeStackLines(value) {
  const lines = Array.isArray(value) ? value : String(value || "").split("\n");
  return lines
    .map((line) => sanitizeText(line, 240))
    .filter(Boolean)
    .slice(0, 20);
}

function buildOperatorIncidentId(incident = {}) {
  return JSON.stringify([
    String(incident.timestamp || ""),
    String(incident.level || ""),
    String(incident.summary || ""),
    String(incident.source || ""),
    String(incident.errorCode || ""),
  ]);
}

function normalizeOperatorIncident(rawIncident) {
  if (!isObject(rawIncident)) return null;
  const timestamp = normalizeIsoDate(rawIncident.timestamp);
  const summary = sanitizeText(rawIncident.summary, 240);
  if (!timestamp || !summary) return null;

  const normalized = {
    id: sanitizeText(rawIncident.id, 260),
    timestamp,
    level: normalizeLevel(rawIncident.level),
    summary,
    message: sanitizeText(rawIncident.message, 400),
    source: sanitizeText(rawIncident.source, 120),
    entry: sanitizeText(rawIncident.entry, 120),
    errorName: sanitizeText(rawIncident.errorName, 120),
    errorCode: sanitizeText(rawIncident.errorCode, 80),
    errorStatus: sanitizeText(rawIncident.errorStatus, 80),
    context: normalizeContext(rawIncident.context),
    stackLines: normalizeStackLines(rawIncident.stackLines),
  };
  if (!normalized.id) {
    normalized.id = buildOperatorIncidentId(normalized);
  }
  return normalized;
}

function normalizeState(rawState) {
  const source = isObject(rawState) ? rawState : {};
  return {
    version: 1,
    incidents: (Array.isArray(source.incidents) ? source.incidents : [])
      .map((incident) => normalizeOperatorIncident(incident))
      .filter(Boolean)
      .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")))
      .slice(0, MAX_FALLBACK_INCIDENTS),
  };
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
const repeatedIncidentState = new Map();

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
    log("WARN", `[operator-incidents] Mongo access failed: ${err?.message || err}`);
    return null;
  }
}

export async function recordOperatorIncident(input) {
  const incident = normalizeOperatorIncident({
    ...input,
    timestamp: input?.timestamp || new Date().toISOString(),
  });
  if (!incident) return null;

  const mongoResult = await runWithMongo(async (db) => {
    await db.collection("operator_incidents").insertOne({
      ...incident,
      timestamp: new Date(incident.timestamp),
    });
    return incident;
  });
  if (mongoResult !== null) {
    return deepClone(mongoResult);
  }

  const state = ensureState();
  state.incidents = [incident, ...(Array.isArray(state.incidents) ? state.incidents : [])]
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")))
    .slice(0, MAX_FALLBACK_INCIDENTS);
  saveState();
  return deepClone(incident);
}

export async function getRecentOperatorIncidents(limit = 50) {
  const safeLimit = Math.max(1, Math.min(100, Number.parseInt(String(limit || 50), 10) || 50));
  const mongoResult = await runWithMongo(async (db) => {
    const rows = await db.collection("operator_incidents")
      .find({})
      .sort({ timestamp: -1 })
      .limit(safeLimit)
      .project({ _id: 0 })
      .toArray();
    return rows.map((incident) => normalizeOperatorIncident(incident)).filter(Boolean);
  });
  if (mongoResult !== null) {
    return deepClone(mongoResult || []);
  }

  const state = ensureState();
  return deepClone((state.incidents || []).slice(0, safeLimit));
}

function sortCountEntries(mapLike) {
  return [...mapLike.entries()]
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .map(([key, count]) => ({ key, count }));
}

export async function summarizeRecentOperatorIncidents({
  sinceMs = OPERATOR_INCIDENT_SUMMARY_WINDOW_MS,
  limit = 200,
} = {}) {
  const incidents = await getRecentOperatorIncidents(limit);
  const now = Date.now();
  const cutoff = Math.max(0, now - Math.max(0, Number(sinceMs || 0) || 0));
  const relevant = incidents.filter((incident) => {
    const ts = Date.parse(String(incident?.timestamp || ""));
    return Number.isFinite(ts) && ts >= cutoff;
  });

  const byLevel = new Map();
  const bySource = new Map();
  const bySummary = new Map();

  for (const incident of relevant) {
    const level = normalizeLevel(incident?.level);
    const source = sanitizeText(incident?.source, 120) || "unknown";
    const summary = sanitizeText(incident?.summary, 240) || "unknown";
    byLevel.set(level, (byLevel.get(level) || 0) + 1);
    bySource.set(source, (bySource.get(source) || 0) + 1);
    bySummary.set(summary, (bySummary.get(summary) || 0) + 1);
  }

  return {
    windowMs: Math.max(0, Number(sinceMs || 0) || 0),
    total: relevant.length,
    latestAt: relevant[0]?.timestamp || null,
    levels: sortCountEntries(byLevel),
    sources: sortCountEntries(bySource),
    summaries: sortCountEntries(bySummary),
  };
}

function formatSummaryBucket(entries = [], maxItems = 3) {
  return entries
    .slice(0, Math.max(1, Number.parseInt(String(maxItems || 3), 10) || 3))
    .map((entry) => `${entry.key}=${entry.count}`)
    .join(", ");
}

export function buildOperatorIncidentSummaryLines(summary, {
  label = "Recent operator incidents",
  maxItems = 3,
} = {}) {
  const safeSummary = summary && typeof summary === "object" ? summary : {};
  const total = Math.max(0, Number(safeSummary.total || 0) || 0);
  if (total <= 0) return [];

  const windowHours = Math.max(1, Math.round((Number(safeSummary.windowMs || 0) || 0) / 3600000));
  const lines = [
    `[operator-incidents] ${label}: total=${total} window=${windowHours}h latest=${safeSummary.latestAt || "-"}`,
  ];

  const levels = formatSummaryBucket(Array.isArray(safeSummary.levels) ? safeSummary.levels : [], maxItems);
  const sources = formatSummaryBucket(Array.isArray(safeSummary.sources) ? safeSummary.sources : [], maxItems);
  const summaries = formatSummaryBucket(Array.isArray(safeSummary.summaries) ? safeSummary.summaries : [], maxItems);

  if (levels) lines.push(`[operator-incidents] levels ${levels}`);
  if (sources) lines.push(`[operator-incidents] sources ${sources}`);
  if (summaries) lines.push(`[operator-incidents] summaries ${summaries}`);
  return lines;
}

export async function logRecentOperatorIncidentSummary({
  sinceMs = OPERATOR_INCIDENT_SUMMARY_WINDOW_MS,
  limit = 200,
  label = "Recent operator incidents",
  logger = log,
  level = "INFO",
} = {}) {
  const summary = await summarizeRecentOperatorIncidents({ sinceMs, limit });
  const lines = buildOperatorIncidentSummaryLines(summary, { label });
  for (const line of lines) {
    logger(level, line);
  }
  return summary;
}

function shouldRecordOperatorIncident(event) {
  const summary = sanitizeText(event?.summary, 240);
  if (!summary) return false;
  const context = normalizeContext(event?.context);
  const dedupeKey = [
    sanitizeText(event?.level, 20).toUpperCase(),
    summary,
    context.source || "",
    sanitizeText(event?.err?.code, 80),
    sanitizeText(event?.err?.status || event?.err?.statusCode, 80),
  ].join("|");
  const now = Date.now();
  const previous = repeatedIncidentState.get(dedupeKey);
  if (previous && (now - previous) < OPERATOR_INCIDENT_REPEAT_COOLDOWN_MS) {
    return false;
  }
  repeatedIncidentState.set(dedupeKey, now);
  return true;
}

export function installOperatorIncidentRecorder({ entry = "" } = {}) {
  const normalizedEntry = sanitizeText(entry, 120) || sanitizeText(path.basename(process.argv[1] || "process"), 120) || "process";
  return onLoggedError((event) => {
    if (!shouldRecordOperatorIncident(event)) {
      return;
    }
    const err = event?.err;
    const context = normalizeContext(event?.context);
    return recordOperatorIncident({
      timestamp: event?.timestamp || new Date().toISOString(),
      level: event?.level || "ERROR",
      summary: event?.summary || "Error",
      message: event?.message || "",
      source: context.source || normalizedEntry,
      entry: context.entry || normalizedEntry,
      errorName: sanitizeText(err?.name, 120),
      errorCode: sanitizeText(err?.code, 80),
      errorStatus: sanitizeText(err?.status || err?.statusCode, 80),
      context,
      stackLines: err?.stack,
    }).catch(() => null);
  });
}

export function resetOperatorIncidentStateForTests() {
  stateCache = null;
  repeatedIncidentState.clear();
  try {
    if (fs.existsSync(STORE_FILE)) fs.unlinkSync(STORE_FILE);
  } catch {}
  try {
    if (fs.existsSync(BACKUP_FILE)) fs.unlinkSync(BACKUP_FILE);
  } catch {}
}
