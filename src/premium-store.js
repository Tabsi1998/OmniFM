// ============================================================
// OmniFM - License Store (Seat-Based Licensing)
// ============================================================
import fs from "node:fs";
import { fileStoresAllowed } from "./lib/store-policy.js";
import { log, logStoreLoadError } from "./lib/logging.js";
import { getDb } from "./lib/db.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";
import { isExpired, remainingDays } from "./premium/licenses.js";

const premiumFile = resolveRuntimeDataPath("premium.json");
const premiumBackupFile = premiumFile + ".bak";

const MAX_PROCESSED_ENTRIES = 5000;
export const TRIAL_RESERVATION_STALE_MS = 15 * 60 * 1000;
export const PLAN_RANK = { free: 0, pro: 1, ultimate: 2 };
export const VALID_SEATS = [1, 2, 3, 5];
const MONGO_REFRESH_MS = Math.max(1000, Number(process.env.PREMIUM_STORE_REFRESH_MS || 2000) || 2000);

let mongoSnapshot = null;
let mongoRefreshTimer = null;
let mongoWriteQueue = Promise.resolve();
let mongoWritesPending = 0;

// --- Internal helpers ---

function emptyStore() {
  return {
    licenses: {},
    serverEntitlements: {},
    processedSessions: {},
    processedEvents: {},
    trialClaims: {},
    offers: {},
    discordBotListState: {},
    recentRedemptions: [],
  };
}

function cloneStore(data) {
  return JSON.parse(JSON.stringify(data || emptyStore()));
}

function normalizeStore(input) {
  const data = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : emptyStore();
  for (const key of ["licenses", "serverEntitlements", "processedSessions", "processedEvents", "trialClaims", "offers", "discordBotListState"]) {
    if (!data[key] || typeof data[key] !== "object" || Array.isArray(data[key])) data[key] = {};
  }
  if (!Array.isArray(data.recentRedemptions)) data.recentRedemptions = [];
  return data;
}

function readFileSafe(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    if (fs.statSync(filePath).isDirectory()) return null;
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) return emptyStore();
    return JSON.parse(raw);
  } catch (err) {
    logStoreLoadError("premium", filePath, err);
    return null;
  }
}

export function load() {
  const data = normalizeStore(mongoSnapshot
    ? cloneStore(mongoSnapshot)
    : (readFileSafe(premiumFile) || readFileSafe(premiumBackupFile) || emptyStore()));

  // Migrate old format: if a license key looks like a guild ID (17+ digits),
  // convert to new format
  for (const [key, val] of Object.entries(data.licenses)) {
    if (/^\d{17,22}$/.test(key) && val.tier && !val.seats) {
      // Old format: guildId -> license. Migrate to new format
      const licId = `legacy_${key}`;
      data.licenses[licId] = {
        id: licId,
        plan: val.tier,
        seats: 1,
        billingPeriod: "monthly",
        active: !isExpired(val),
        linkedServerIds: [key],
        createdAt: val.activatedAt || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        expiresAt: val.expiresAt || null,
        activatedBy: val.activatedBy || "legacy",
        note: val.note || "",
        contactEmail: val.contactEmail || "",
      };
      data.serverEntitlements[key] = { serverId: key, licenseId: licId };
      delete data.licenses[key];
    }
  }

  return data;
}

function saveFile(data) {
  // In production MongoDB is the only copy (#292).
  if (getDb() && !fileStoresAllowed()) return;
  const tmpFile = `${premiumFile}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (fs.existsSync(premiumFile) && fs.statSync(premiumFile).isDirectory()) return;

    // Trim lookup maps
    for (const mapKey of ["processedSessions", "processedEvents"]) {
      const entries = Object.entries(data[mapKey] || {});
      if (entries.length > MAX_PROCESSED_ENTRIES) {
        entries.sort((a, b) => new Date(b[1]?.processedAt || 0).getTime() - new Date(a[1]?.processedAt || 0).getTime());
        data[mapKey] = Object.fromEntries(entries.slice(0, MAX_PROCESSED_ENTRIES));
      }
    }

    const payload = JSON.stringify(data, null, 2) + "\n";
    if (fs.existsSync(premiumFile)) {
      try { fs.copyFileSync(premiumFile, premiumBackupFile); } catch {}
    }
    fs.writeFileSync(tmpFile, payload, "utf-8");
    try {
      fs.renameSync(tmpFile, premiumFile);
    } catch {
      fs.writeFileSync(premiumFile, payload, "utf-8");
    }
  } catch (err) {
    log("ERROR", `[OmniFM] License save error: ${err.message}`);
  } finally {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
  }
}

async function readMongoStore(database) {
  const [licenseDocs, entitlementDocs, sessionDocs, eventDocs, metaDoc] = await Promise.all([
    database.collection("licenses").find({}, { projection: { _id: 0 } }).toArray(),
    database.collection("server_entitlements").find({}, { projection: { _id: 0 } }).toArray(),
    database.collection("processed_sessions").find({}, { projection: { _id: 0 } }).toArray(),
    database.collection("processed_events").find({}, { projection: { _id: 0 } }).toArray(),
    database.collection("premium_state").findOne({ _id: "meta" }, { projection: { _id: 0 } }),
  ]);
  const data = normalizeStore({ ...(metaDoc || {}) });
  data.licenses = Object.fromEntries(licenseDocs
    .filter((doc) => doc?._licenseId)
    .map((doc) => {
      const { _licenseId, ...license } = doc;
      return [String(_licenseId), license];
    }));
  data.serverEntitlements = Object.fromEntries(entitlementDocs
    .filter((doc) => doc?._serverId)
    .map((doc) => {
      const { _serverId, ...entitlement } = doc;
      return [String(_serverId), entitlement];
    }));
  data.processedSessions = Object.fromEntries(sessionDocs
    .filter((doc) => doc?._sessionId)
    .map((doc) => {
      const { _sessionId, ...session } = doc;
      return [String(_sessionId), session];
    }));
  data.processedEvents = Object.fromEntries(eventDocs
    .filter((doc) => doc?._eventId)
    .map((doc) => {
      const { _eventId, ...event } = doc;
      return [String(_eventId), event];
    }));
  return data;
}

async function replaceMapCollection(database, collectionName, idField, values) {
  const ids = [];
  for (const [id, value] of Object.entries(values || {})) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    // eslint-disable-next-line no-await-in-loop -- one document after the other; the store is small
    await database.collection(collectionName).replaceOne(
      { [idField]: id },
      { ...value, [idField]: id },
      { upsert: true }
    );
    ids.push(id);
  }
  if (ids.length) {
    await database.collection(collectionName).deleteMany({ [idField]: { $nin: ids } });
  } else {
    await database.collection(collectionName).deleteMany({});
  }
}

function valuesEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function writeMapDelta(database, collectionName, idField, beforeValues, nextValues) {
  const before = beforeValues && typeof beforeValues === "object" ? beforeValues : {};
  const next = nextValues && typeof nextValues === "object" ? nextValues : {};
  for (const [id, value] of Object.entries(next)) {
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    if (valuesEqual(before[id], value)) continue;
    // eslint-disable-next-line no-await-in-loop -- one document after the other; the store is small
    await database.collection(collectionName).replaceOne(
      { [idField]: id },
      { ...value, [idField]: id },
      { upsert: true }
    );
  }
  const removedIds = Object.keys(before).filter((id) => !Object.hasOwn(next, id));
  if (removedIds.length) {
    await database.collection(collectionName).deleteMany({ [idField]: { $in: removedIds } });
  }
}

async function writeMongoStore(database, input) {
  const data = normalizeStore(cloneStore(input));
  await replaceMapCollection(database, "licenses", "_licenseId", data.licenses);
  await replaceMapCollection(database, "server_entitlements", "_serverId", data.serverEntitlements);
  await replaceMapCollection(database, "processed_sessions", "_sessionId", data.processedSessions);
  await replaceMapCollection(database, "processed_events", "_eventId", data.processedEvents);
  await database.collection("premium_state").replaceOne(
    { _id: "meta" },
    {
      _id: "meta",
      trialClaims: data.trialClaims,
      offers: data.offers,
      discordBotListState: data.discordBotListState,
      recentRedemptions: data.recentRedemptions,
    },
    { upsert: true }
  );
}

async function writeMongoDelta(database, beforeInput, nextInput) {
  const before = normalizeStore(cloneStore(beforeInput));
  const next = normalizeStore(cloneStore(nextInput));
  await writeMapDelta(database, "licenses", "_licenseId", before.licenses, next.licenses);
  await writeMapDelta(database, "server_entitlements", "_serverId", before.serverEntitlements, next.serverEntitlements);
  await writeMapDelta(database, "processed_sessions", "_sessionId", before.processedSessions, next.processedSessions);
  await writeMapDelta(database, "processed_events", "_eventId", before.processedEvents, next.processedEvents);

  const changedMeta = {};
  for (const key of ["trialClaims", "offers", "discordBotListState", "recentRedemptions"]) {
    if (!valuesEqual(before[key], next[key])) changedMeta[key] = next[key];
  }
  if (Object.keys(changedMeta).length) {
    await database.collection("premium_state").updateOne(
      { _id: "meta" },
      { $set: changedMeta },
      { upsert: true }
    );
  }
}

function hasStoreData(data) {
  return ["licenses", "serverEntitlements", "processedSessions", "processedEvents", "trialClaims", "offers", "discordBotListState"]
    .some((key) => Object.keys(data?.[key] || {}).length > 0)
    || (data?.recentRedemptions || []).length > 0;
}

async function refreshMongoSnapshot() {
  const database = getDb();
  if (!database || mongoWritesPending > 0) return false;
  const remote = await readMongoStore(database);
  mongoSnapshot = normalizeStore(remote);
  saveFile(mongoSnapshot);
  return true;
}

function queueMongoWrite(data, baseline) {
  const database = getDb();
  if (!database) return;
  const snapshot = cloneStore(data);
  const previous = cloneStore(baseline);
  mongoWritesPending += 1;
  mongoWriteQueue = mongoWriteQueue
    .then(() => writeMongoDelta(database, previous, snapshot))
    .catch((err) => log("ERROR", `[OmniFM] MongoDB license save error: ${err?.message || err}`))
    .finally(() => { mongoWritesPending = Math.max(0, mongoWritesPending - 1); });
}

export function save(data) {
  const normalized = normalizeStore(data);
  saveFile(normalized);
  if (getDb()) {
    const baseline = cloneStore(mongoSnapshot || emptyStore());
    mongoSnapshot = cloneStore(normalized);
    queueMongoWrite(normalized, baseline);
  }
}

export async function initPremiumStore() {
  const fileStore = normalizeStore(readFileSafe(premiumFile) || readFileSafe(premiumBackupFile) || emptyStore());
  const database = getDb();
  if (!database) return fileStore;

  try {
    const remote = await readMongoStore(database);
    if (hasStoreData(remote) || !hasStoreData(fileStore)) {
      mongoSnapshot = normalizeStore(remote);
      saveFile(mongoSnapshot);
    } else {
      mongoSnapshot = cloneStore(fileStore);
      await writeMongoStore(database, mongoSnapshot);
      log("INFO", "[OmniFM] Premium-Store einmalig von JSON nach MongoDB migriert.");
    }
    if (!mongoRefreshTimer) {
      mongoRefreshTimer = setInterval(() => {
        refreshMongoSnapshot().catch((err) => log("WARN", `[OmniFM] Premium-Store Refresh fehlgeschlagen: ${err?.message || err}`));
      }, MONGO_REFRESH_MS);
      mongoRefreshTimer.unref?.();
    }
    log("INFO", `[OmniFM] Premium-Store nutzt MongoDB (Live-Refresh ${MONGO_REFRESH_MS}ms).`);
    return cloneStore(mongoSnapshot);
  } catch (err) {
    mongoSnapshot = null;
    log("WARN", `[OmniFM] Premium-Store MongoDB nicht lesbar: ${err?.message || err}. Nutze JSON-Fallback.`);
    return fileStore;
  }
}

// --- For the owner routes on the Node API (#288) ---

/** The store fresh from MongoDB (FastAPI's checkout writes there too), after this process's own writes. */
export async function reloadPremiumStore() {
  await mongoWriteQueue.catch(() => null);
  if (getDb()) await refreshMongoSnapshot().catch(() => false);
  return load();
}

export function savePremiumStore(data) {
  save(data);
}

/** Resolves once every queued MongoDB write of this process is done. */
export async function flushPremiumStoreWrites() {
  await mongoWriteQueue.catch(() => null);
}

// --- License CRUD ---

// Expose for entitlements module
export { isExpired, remainingDays };

// Split into topic modules (#295); the public API stays here.
export {
  finalizeTrialClaim,
  getProcessedSession,
  getTrialClaimByEmail,
  isEventProcessed,
  isSessionProcessed,
  listProcessedSessionsByEmail,
  markEventProcessed,
  markSessionProcessed,
  releaseTrialClaim,
  reserveTrialClaim,
} from "./premium/claims.js";
export {
  addLicenseForServer,
  createLicense,
  createOrExtendLicenseForEmail,
  extendLicense,
  getLicenseById,
  getServerLicense,
  getServerPlan,
  isServerLicensed,
  linkServerToLicense,
  listLicenses,
  listLicensesByContactEmail,
  patchLicenseById,
  patchLicenseForServer,
  removeLicense,
  unlinkServerFromLicense,
  updateLicenseContactEmail,
  upgradeLicenseForServer,
} from "./premium/licenses.js";
