import fs from "node:fs";
import path from "node:path";
import { readStoreFileWithRetry, withFileStoreLock, withFileWriteRetry } from "./lib/file-store-lock.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";
import { createHash } from "node:crypto";
import { getDb, isConnected } from "./lib/db.js";
import { log } from "./lib/logging.js";

const STORE_FILE = path.resolve(process.env.OMNIFM_DASHBOARD_FILE || resolveRuntimeDataPath("dashboard.json"));
const BACKUP_FILE = `${STORE_FILE}.bak`;

function emptyState() {
  return {
    version: 1,
    events: {},
    perms: {},
    telemetry: {},
    authSessions: {},
    oauthStates: {},
  };
}

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function sanitizeText(value, maxLen = 200) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, maxLen);
}

function sanitizeSnowflake(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

function normalizeGuildRow(rawGuild) {
  if (!isObject(rawGuild)) return null;
  const guildId = sanitizeSnowflake(rawGuild.id);
  if (!guildId) return null;
  return {
    id: guildId,
    name: sanitizeText(rawGuild.name, 120) || guildId,
    icon: sanitizeText(rawGuild.icon, 120),
    owner: Boolean(rawGuild.owner),
    permissions: sanitizeText(rawGuild.permissions, 40) || "0",
  };
}

function normalizeUserRow(rawUser) {
  if (!isObject(rawUser)) return {};
  return {
    id: sanitizeSnowflake(rawUser.id),
    username: sanitizeText(rawUser.username, 80) || "Discord User",
    globalName: sanitizeText(rawUser.globalName || rawUser.global_name, 80),
    avatar: sanitizeText(rawUser.avatar, 120),
  };
}

function normalizeAuthSession(rawSession) {
  if (!isObject(rawSession)) return null;
  const expiresAt = Number.parseInt(String(rawSession.expiresAt || 0), 10);
  if (!Number.isFinite(expiresAt) || expiresAt <= 0) return null;

  const guilds = Array.isArray(rawSession.guilds)
    ? rawSession.guilds.map((guild) => normalizeGuildRow(guild)).filter(Boolean)
    : [];

  return {
    user: normalizeUserRow(rawSession.user),
    guilds,
    createdAt: Number.parseInt(String(rawSession.createdAt || 0), 10) || Math.floor(Date.now() / 1000),
    expiresAt,
  };
}

function normalizeOauthState(rawState) {
  if (!isObject(rawState)) return null;
  const token = sanitizeText(rawState.token, 120);
  const expiresAt = Number.parseInt(String(rawState.expiresAt || 0), 10);
  if (!token || !Number.isFinite(expiresAt) || expiresAt <= 0) return null;
  return {
    token,
    nextPage: sanitizeText(rawState.nextPage, 40) || "dashboard",
    language: sanitizeText(rawState.language, 12),
    origin: sanitizeText(rawState.origin, 200),
    // The redirect URI the login named; the token exchange has to repeat it.
    redirectUri: sanitizeText(rawState.redirectUri, 300),
    createdAt: Number.parseInt(String(rawState.createdAt || 0), 10) || Math.floor(Date.now() / 1000),
    expiresAt,
  };
}

function normalizeTelemetryRow(rawTelemetry) {
  return isObject(rawTelemetry) ? deepClone(rawTelemetry) : {};
}

function normalizeState(rawState) {
  const source = isObject(rawState) ? rawState : {};
  const normalized = emptyState();

  for (const [guildId, telemetry] of Object.entries(source.telemetry || {})) {
    const safeGuildId = sanitizeSnowflake(guildId);
    if (!safeGuildId) continue;
    normalized.telemetry[safeGuildId] = normalizeTelemetryRow(telemetry);
  }

  for (const [token, session] of Object.entries(source.authSessions || {})) {
    const safeToken = sanitizeText(token, 160);
    const normalizedSession = normalizeAuthSession(session);
    if (!safeToken || !normalizedSession) continue;
    normalized.authSessions[safeToken] = normalizedSession;
  }

  for (const [token, state] of Object.entries(source.oauthStates || {})) {
    const normalizedStateRow = normalizeOauthState({ ...state, token });
    if (!normalizedStateRow) continue;
    normalized.oauthStates[normalizedStateRow.token] = {
      nextPage: normalizedStateRow.nextPage,
      language: normalizedStateRow.language,
      origin: normalizedStateRow.origin,
      createdAt: normalizedStateRow.createdAt,
      expiresAt: normalizedStateRow.expiresAt,
    };
  }

  if (isObject(source.events)) normalized.events = deepClone(source.events);
  if (isObject(source.perms)) normalized.perms = deepClone(source.perms);

  return normalized;
}

/**
 * Reads a state file. A missing file gives null. With strict (inside the
 * lock, before a write) a file that exists but cannot be read throws instead
 * of returning null: the caller would otherwise fall back to the older backup
 * or an empty state and write that over newer entries (#223). A corrupt file
 * still gives null, so the backup can take over.
 */
function readStateFile(filePath, { strict = false } = {}) {
  let content;
  try {
    // No existsSync/statSync first: on Windows both report a file that is
    // briefly held by another process as missing.
    content = readStoreFileWithRetry(filePath);
  } catch (err) {
    if (strict && err?.code !== "EISDIR") throw err;
    return null;
  }
  if (content === null) return null;
  const raw = content.trim();
  if (!raw) return emptyState();
  try {
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

function loadLatestState() {
  // With MongoDB the refreshed cache is the latest state.
  if (mongoActive) return ensureState();
  stateCache = readStateFile(STORE_FILE, { strict: true }) || readStateFile(BACKUP_FILE) || emptyState();
  return stateCache;
}

function saveStateUnlocked(state = ensureState()) {
  const payload = JSON.stringify(normalizeState(state), null, 2) + "\n";
  const tmpFile = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;

  try {
    if (fs.existsSync(STORE_FILE)) {
      try { withFileWriteRetry(() => fs.copyFileSync(STORE_FILE, BACKUP_FILE)); } catch {}
    }
    withFileWriteRetry(() => fs.writeFileSync(tmpFile, payload, "utf8"));
    try {
      withFileWriteRetry(() => fs.renameSync(tmpFile, STORE_FILE));
    } catch {
      withFileWriteRetry(() => fs.writeFileSync(STORE_FILE, payload, "utf8"));
    }
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
  }
}

// ---- MongoDB (#292) ----
// Dashboard logins are written by the commander and read by the public entry
// (owner sign-in, #283) since #290. In MongoDB each login is a document keyed
// by the hash of its token (the token itself is never stored), each OAuth
// state and each server's telemetry too; MongoDB drops what expired (TTL).
// The cache is refreshed every 2 s; findDashboardAuthSession() asks MongoDB
// directly for a login that is only seconds old. Without MongoDB the locked
// dashboard.json stays the store, as before.
const SESSIONS = "dashboard_auth_sessions";
const OAUTH_STATES = "dashboard_oauth_states";
const TELEMETRY = "dashboard_telemetry";
let mongoActive = false;
let mongoRefreshTimer = null;
let mongoWritesPending = 0;
let mongoWriteQueue = Promise.resolve();

const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");
/** The key of a login in the state: the token in the file, its hash in MongoDB. */
const sessionKey = (token) => (mongoActive ? hashToken(token) : token);
const expiryDate = (seconds) => new Date(Number(seconds || 0) * 1000);

async function readMongoState() {
  if (!mongoActive || !isConnected() || mongoWritesPending > 0) return;
  const database = getDb();
  const now = new Date();
  const [sessions, oauthStates, telemetry] = await Promise.all([
    database.collection(SESSIONS).find({ expiresAt: { $gt: now } }).toArray(),
    database.collection(OAUTH_STATES).find({ expiresAt: { $gt: now } }).toArray(),
    database.collection(TELEMETRY).find({}).toArray(),
  ]);
  if (mongoWritesPending > 0) return;
  const next = emptyState();
  for (const doc of sessions) {
    const session = normalizeAuthSession(doc.session);
    if (session) next.authSessions[doc._id] = session;
  }
  for (const doc of oauthStates) {
    const row = normalizeOauthState({ ...doc.state, token: doc._id });
    if (row) {
      const { token: _token, ...rest } = row;
      next.oauthStates[doc._id] = rest;
    }
  }
  for (const doc of telemetry) next.telemetry[doc._id] = normalizeTelemetryRow(doc.telemetry);
  stateCache = next;
}

function queueMongoDelta(before, after) {
  const operations = [];
  const delta = (collection, beforeMap, afterMap, toDoc) => {
    const ops = [];
    for (const [key, value] of Object.entries(afterMap || {})) {
      if (JSON.stringify(beforeMap?.[key]) === JSON.stringify(value)) continue;
      ops.push({ replaceOne: { filter: { _id: key }, replacement: toDoc(value), upsert: true } });
    }
    for (const key of Object.keys(beforeMap || {})) {
      if (!(key in (afterMap || {}))) ops.push({ deleteOne: { filter: { _id: key } } });
    }
    if (ops.length) operations.push([collection, ops]);
  };
  delta(SESSIONS, before.authSessions, after.authSessions, (session) => ({ session, expiresAt: expiryDate(session.expiresAt) }));
  delta(OAUTH_STATES, before.oauthStates, after.oauthStates, (state) => ({ state, expiresAt: expiryDate(state.expiresAt) }));
  delta(TELEMETRY, before.telemetry, after.telemetry, (telemetry) => ({ telemetry }));
  if (!operations.length) return;
  mongoWritesPending += 1;
  mongoWriteQueue = mongoWriteQueue
    .then(async () => {
      if (!isConnected()) return;
      for (const [collection, ops] of operations) {
        // eslint-disable-next-line no-await-in-loop -- one collection after the other
        await getDb().collection(collection).bulkWrite(ops, { ordered: false });
      }
    })
    .catch((err) => log("ERROR", `[dashboard-store] MongoDB-Speichern fehlgeschlagen: ${err?.message || err}`))
    .finally(() => { mongoWritesPending = Math.max(0, mongoWritesPending - 1); });
}

/** MongoDB becomes the store; logins, OAuth states and telemetry of dashboard.json are copied once. */
export async function initDashboardStore({ refreshMs = 2000 } = {}) {
  if (!isConnected() || !getDb()) return { backend: "file" };
  const database = getDb();
  await database.collection(SESSIONS).createIndex({ expiresAt: 1 }, { name: "session_expiry", expireAfterSeconds: 0 }).catch(() => null);
  await database.collection(OAUTH_STATES).createIndex({ expiresAt: 1 }, { name: "oauth_expiry", expireAfterSeconds: 0 }).catch(() => null);
  const fileState = readStateFile(STORE_FILE) || readStateFile(BACKUP_FILE);
  if (fileState) {
    const nowSeconds = Math.floor(Date.now() / 1000);
    const copies = [];
    for (const [token, session] of Object.entries(fileState.authSessions || {})) {
      if (Number(session.expiresAt) > nowSeconds) copies.push([SESSIONS, hashToken(token), { session, expiresAt: expiryDate(session.expiresAt) }]);
    }
    for (const [serverId, telemetry] of Object.entries(fileState.telemetry || {})) copies.push([TELEMETRY, serverId, { telemetry }]);
    for (const [collection, id, doc] of copies) {
      // eslint-disable-next-line no-await-in-loop -- a one-time copy
      await database.collection(collection).updateOne({ _id: id }, { $setOnInsert: doc }, { upsert: true });
    }
    if (copies.length) log("INFO", `[dashboard-store] ${copies.length} Logins/Telemetrie-Einträge aus dashboard.json nach MongoDB übernommen.`);
  }
  mongoActive = true;
  stateCache = null;
  await readMongoState();
  if (!stateCache) stateCache = emptyState();
  if (!mongoRefreshTimer) {
    mongoRefreshTimer = setInterval(() => {
      readMongoState().catch((err) => log("WARN", `[dashboard-store] MongoDB-Refresh fehlgeschlagen: ${err?.message || err}`));
    }, Math.max(500, Number(refreshMs) || 2000));
    mongoRefreshTimer.unref?.();
  }
  return { backend: "mongo" };
}

export async function stopDashboardStore() {
  if (mongoRefreshTimer) clearInterval(mongoRefreshTimer);
  mongoRefreshTimer = null;
  await mongoWriteQueue.catch(() => null);
}

/**
 * A login straight from MongoDB, for a process that did not create it (the
 * public entry signing an owner in seconds after the commander's login).
 */
export async function findDashboardAuthSession(token) {
  const safeToken = sanitizeText(token, 160);
  if (!safeToken) return null;
  if (!mongoActive || !isConnected()) return getDashboardAuthSession(safeToken);
  const doc = await getDb().collection(SESSIONS).findOne({ _id: hashToken(safeToken), expiresAt: { $gt: new Date() } });
  const session = doc ? normalizeAuthSession(doc.session) : null;
  return session ? deepClone(session) : null;
}

function mutateState(mutator) {
  if (mongoActive) {
    const state = ensureState();
    const before = deepClone({ authSessions: state.authSessions, oauthStates: state.oauthStates, telemetry: state.telemetry });
    const result = mutator(state) || {};
    if (result.changed) queueMongoDelta(before, state);
    return result.value;
  }
  return withFileStoreLock(STORE_FILE, () => {
    const state = loadLatestState();
    const result = mutator(state) || {};
    if (result.changed) {
      saveStateUnlocked(state);
    }
    return result.value;
  });
}

function cleanupExpiredAuthEntriesFromState(state, nowTs = Math.floor(Date.now() / 1000)) {
  let changed = false;

  for (const [token, session] of Object.entries(state.authSessions)) {
    const expiresAt = Number.parseInt(String(session?.expiresAt || 0), 10);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowTs) {
      delete state.authSessions[token];
      changed = true;
    }
  }

  for (const [token, oauthState] of Object.entries(state.oauthStates)) {
    const expiresAt = Number.parseInt(String(oauthState?.expiresAt || 0), 10);
    if (!Number.isFinite(expiresAt) || expiresAt <= nowTs) {
      delete state.oauthStates[token];
      changed = true;
    }
  }

  return changed;
}

function cleanupExpiredAuthEntries(nowTs = Math.floor(Date.now() / 1000)) {
  return mutateState((state) => ({
    changed: cleanupExpiredAuthEntriesFromState(state, nowTs),
    value: undefined,
  }));
}

export function getDashboardTelemetry(serverId) {
  const guildId = sanitizeSnowflake(serverId);
  if (!guildId) return {};
  const state = loadLatestState();
  return deepClone(state.telemetry[guildId] || {});
}

export function setDashboardTelemetry(serverId, telemetry) {
  const guildId = sanitizeSnowflake(serverId);
  if (!guildId) return {};
  return mutateState((state) => {
    state.telemetry[guildId] = normalizeTelemetryRow(telemetry);
    return { changed: true, value: deepClone(state.telemetry[guildId]) };
  });
}

export function setDashboardOauthState(token, payload) {
  const safeToken = sanitizeText(token, 160);
  const stateRow = normalizeOauthState({ ...payload, token: safeToken });
  if (!safeToken || !stateRow) return null;
  return mutateState((state) => {
    cleanupExpiredAuthEntriesFromState(state);
    state.oauthStates[safeToken] = {
      nextPage: stateRow.nextPage,
      language: stateRow.language,
      origin: stateRow.origin,
      redirectUri: stateRow.redirectUri,
      createdAt: stateRow.createdAt,
      expiresAt: stateRow.expiresAt,
    };
    return { changed: true, value: deepClone(state.oauthStates[safeToken]) };
  });
}

export function popDashboardOauthState(token) {
  const safeToken = sanitizeText(token, 160);
  if (!safeToken) return null;
  return mutateState((state) => {
    const cleanupChanged = cleanupExpiredAuthEntriesFromState(state);
    const value = state.oauthStates[safeToken] || null;
    if (value) {
      delete state.oauthStates[safeToken];
    }
    return {
      changed: cleanupChanged || Boolean(value),
      value: value ? deepClone(value) : null,
    };
  });
}

export function setDashboardAuthSession(token, payload) {
  const safeToken = sanitizeText(token, 160);
  const normalizedSession = normalizeAuthSession(payload);
  if (!safeToken || !normalizedSession) return null;
  return mutateState((state) => {
    cleanupExpiredAuthEntriesFromState(state);
    state.authSessions[sessionKey(safeToken)] = normalizedSession;
    return { changed: true, value: deepClone(normalizedSession) };
  });
}

export function getDashboardAuthSession(token) {
  const safeToken = sanitizeText(token, 160);
  if (!safeToken) return null;
  cleanupExpiredAuthEntries();
  const state = loadLatestState();
  const session = state.authSessions[sessionKey(safeToken)];
  return session ? deepClone(session) : null;
}

export function deleteDashboardAuthSession(token) {
  const safeToken = sanitizeText(token, 160);
  if (!safeToken) return false;
  return mutateState((state) => {
    const key = sessionKey(safeToken);
    if (!state.authSessions[key]) return { changed: false, value: false };
    delete state.authSessions[key];
    return { changed: true, value: true };
  });
}

/** The logins of one Discord account (#285), without their tokens. */
export async function listDashboardSessionsOfUser(userId) {
  const id = sanitizeSnowflake(userId);
  if (!id) return [];
  if (mongoActive && isConnected()) {
    const docs = await getDb().collection(SESSIONS).find({ "session.user.id": id }, { projection: { _id: 0, session: 1 } }).toArray();
    return docs.map((doc) => normalizeAuthSession(doc.session)).filter(Boolean);
  }
  return Object.values(loadLatestState().authSessions).filter((session) => session?.user?.id === id).map(deepClone);
}

/** Signs one Discord account out everywhere and forgets its logins (#285). */
export async function deleteDashboardSessionsOfUser(userId) {
  const id = sanitizeSnowflake(userId);
  if (!id) return 0;
  const removed = mutateState((state) => {
    let count = 0;
    for (const [key, session] of Object.entries(state.authSessions)) {
      if (session?.user?.id !== id) continue;
      delete state.authSessions[key];
      count += 1;
    }
    return { changed: count > 0, value: count };
  }) || 0;
  if (!mongoActive || !isConnected()) return removed;
  // Logins another process made a moment ago are not in this cache yet.
  const result = await getDb().collection(SESSIONS).deleteMany({ "session.user.id": id });
  return Math.max(removed, result.deletedCount || 0);
}

export function cleanupDashboardAuthState(nowTs) {
  cleanupExpiredAuthEntries(nowTs);
}
