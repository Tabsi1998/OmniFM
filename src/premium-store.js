// ============================================================
// OmniFM - License Store (Seat-Based Licensing)
// ============================================================

import fs from "node:fs";
import path from "node:path";
import { PLANS } from "./config/plans.js";
import { getDefaultLanguage, normalizeLanguage } from "./i18n.js";
import { log, logStoreLoadError } from "./lib/logging.js";
import { getDb } from "./lib/db.js";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

const premiumFile = resolveRuntimeDataPath("premium.json");
const premiumBackupFile = premiumFile + ".bak";

const MAX_PROCESSED_ENTRIES = 5000;
const TRIAL_RESERVATION_STALE_MS = 15 * 60 * 1000;
const PLAN_RANK = { free: 0, pro: 1, ultimate: 2 };
const VALID_SEATS = [1, 2, 3, 5];
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

function load() {
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
  const tmpFile = `${premiumFile}.tmp-${process.pid}-${Date.now()}`;
  try {
    if (fs.existsSync(premiumFile) && fs.statSync(premiumFile).isDirectory()) return;

    // Trim lookup maps
    for (const mapKey of ["processedSessions", "processedEvents"]) {
      const entries = Object.entries(data[mapKey] || {});
      if (entries.length > MAX_PROCESSED_ENTRIES) {
        entries.sort((a, b) => new Date(b[1]?.processedAt || 0) - new Date(a[1]?.processedAt || 0));
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

function save(data) {
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

// --- License CRUD ---

function isExpired(license) {
  if (!license || !license.expiresAt) return false; // No expiry = perpetual (for now)
  return new Date(license.expiresAt) <= new Date();
}

function remainingDays(license) {
  if (!license || !license.expiresAt) return Infinity;
  const diff = new Date(license.expiresAt) - new Date();
  return Math.max(0, Math.ceil(diff / 86400000));
}

function generateLicenseId() {
  return `lic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeContactEmail(email) {
  return String(email || "").trim().toLowerCase();
}

function normalizeSeatCount(rawSeats) {
  const seats = Number(rawSeats);
  return VALID_SEATS.includes(seats) ? seats : 1;
}

function planRank(plan) {
  return PLAN_RANK[String(plan || "free").toLowerCase()] ?? 0;
}

export function createLicense({
  plan,
  seats = 1,
  billingPeriod = "monthly",
  months = 1,
  activatedBy = "admin",
  note = "",
  contactEmail = "",
  preferredLanguage = getDefaultLanguage(),
}) {
  if (!PLANS[plan] || plan === "free") throw new Error("Plan must be 'pro' or 'ultimate'.");
  if (!VALID_SEATS.includes(seats)) throw new Error("Seats must be 1, 2, 3, or 5.");

  const data = load();
  const id = generateLicenseId();
  const now = new Date();
  const expiresAt = new Date(now);
  expiresAt.setMonth(expiresAt.getMonth() + months);

  data.licenses[id] = {
    id,
    plan,
    seats,
    billingPeriod,
    active: true,
    linkedServerIds: [],
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    durationMonths: months,
    activatedBy,
    note,
    contactEmail: normalizeContactEmail(contactEmail),
    preferredLanguage: normalizeLanguage(preferredLanguage, getDefaultLanguage()),
  };
  save(data);
  return data.licenses[id];
}

export function getLicenseById(licenseId) {
  const data = load();
  const lic = data.licenses[String(licenseId)];
  if (!lic) return null;
  return {
    ...lic,
    expired: isExpired(lic),
    remainingDays: remainingDays(lic),
    seatsUsed: (lic.linkedServerIds || []).length,
    seatsAvailable: lic.seats - (lic.linkedServerIds || []).length,
  };
}

export function linkServerToLicense(serverId, licenseId) {
  const sid = String(serverId);
  const lid = String(licenseId);
  const data = load();
  const lic = data.licenses[lid];
  if (!lic) return { ok: false, message: "License not found." };
  if (lic.active === false || isExpired(lic)) return { ok: false, message: "License is not active or has expired." };

  // If server is linked to a different license, release that seat first.
  const currentEntitlement = data.serverEntitlements[sid];
  const currentLicenseId = String(currentEntitlement?.licenseId || "");
  if (currentLicenseId && currentLicenseId !== lid) {
    const oldLicense = data.licenses[currentLicenseId];
    if (oldLicense) {
      oldLicense.linkedServerIds = (oldLicense.linkedServerIds || []).filter((id) => id !== sid);
      oldLicense.updatedAt = new Date().toISOString();
    }
  }
  // Repair assignments written by older Owner versions that had no matching
  // serverEntitlements document, and guarantee one active seat per guild.
  for (const [otherLicenseId, otherLicense] of Object.entries(data.licenses)) {
    if (otherLicenseId === lid || !otherLicense) continue;
    if (!(otherLicense.linkedServerIds || []).some((id) => String(id) === sid)) continue;
    otherLicense.linkedServerIds = (otherLicense.linkedServerIds || []).filter((id) => String(id) !== sid);
    otherLicense.updatedAt = new Date().toISOString();
  }

  const linked = lic.linkedServerIds || [];
  if (linked.includes(sid)) {
    data.serverEntitlements[sid] = { serverId: sid, licenseId: lid };
    save(data);
    return { ok: true, message: "Server already linked." };
  }
  if (linked.length >= lic.seats) return { ok: false, message: `All ${lic.seats} seat(s) are occupied. Unlink a server first or upgrade.` };

  lic.linkedServerIds = [...linked, sid];
  lic.updatedAt = new Date().toISOString();
  data.serverEntitlements[sid] = { serverId: sid, licenseId: lid };
  save(data);
  return { ok: true };
}

export function unlinkServerFromLicense(serverId, licenseId) {
  const sid = String(serverId);
  const lid = String(licenseId);
  const data = load();
  const lic = data.licenses[lid];
  if (!lic) return { ok: false, message: "License not found." };

  lic.linkedServerIds = (lic.linkedServerIds || []).filter(id => id !== sid);
  lic.updatedAt = new Date().toISOString();
  const entitlement = data.serverEntitlements[sid];
  if (entitlement && String(entitlement.licenseId || "") === lid) {
    delete data.serverEntitlements[sid];
  }
  save(data);
  return { ok: true };
}

export function getServerLicense(serverId) {
  const data = load();
  const normalizedServerId = String(serverId);
  let entitlement = data.serverEntitlements[normalizedServerId];
  // Older Owner releases only wrote linkedServerIds. Accept those records so
  // existing production licenses start working immediately after deployment.
  if (!entitlement) {
    const legacyLink = Object.entries(data.licenses).find(([, license]) =>
      (license?.linkedServerIds || []).some((id) => String(id) === normalizedServerId)
    );
    if (legacyLink) entitlement = { serverId: normalizedServerId, licenseId: legacyLink[0] };
  }
  if (!entitlement) return null;
  const lic = data.licenses[entitlement.licenseId];
  if (!lic) return null;
  if (isExpired(lic)) return { ...lic, id: lic.id || entitlement.licenseId, active: false, expired: true };
  return {
    ...lic,
    id: lic.id || entitlement.licenseId,
    active: lic.active !== false,
    expired: false,
    remainingDays: remainingDays(lic),
  };
}

export function getServerPlan(serverId) {
  const lic = getServerLicense(serverId);
  if (!lic || lic.active === false || lic.expired) return "free";
  return PLANS[lic.plan] ? lic.plan : "free";
}

export function isServerLicensed(serverId) {
  return getServerPlan(serverId) !== "free";
}

export function listLicenses() {
  const data = load();
  return data.licenses;
}

export function removeLicense(licenseId) {
  const data = load();
  const lic = data.licenses[String(licenseId)];
  if (!lic) return false;
  // Unlink all servers
  for (const sid of (lic.linkedServerIds || [])) {
    delete data.serverEntitlements[sid];
  }
  delete data.licenses[String(licenseId)];
  save(data);
  return true;
}

export function extendLicense(licenseId, months) {
  const data = load();
  const lic = data.licenses[String(licenseId)];
  if (!lic) throw new Error("License not found.");
  const currentExpiry = lic.expiresAt ? new Date(lic.expiresAt) : new Date();
  const base = currentExpiry > new Date() ? currentExpiry : new Date();
  const newExpiry = new Date(base);
  newExpiry.setMonth(newExpiry.getMonth() + months);
  lic.expiresAt = newExpiry.toISOString();
  lic.updatedAt = new Date().toISOString();
  lic.active = true;
  save(data);
  return lic;
}

export function updateLicenseContactEmail(licenseId, contactEmail, preferredLanguage = "") {
  const lid = String(licenseId || "").trim();
  const normalizedEmail = normalizeContactEmail(contactEmail);
  if (!lid || !normalizedEmail) return null;

  const data = load();
  const lic = data.licenses[lid];
  if (!lic) return null;

  lic.contactEmail = normalizedEmail;
  if (preferredLanguage) {
    lic.preferredLanguage = normalizeLanguage(preferredLanguage, getDefaultLanguage());
  }
  lic.updatedAt = new Date().toISOString();
  save(data);

  return {
    ...lic,
    expired: isExpired(lic),
    remainingDays: remainingDays(lic),
    seatsUsed: (lic.linkedServerIds || []).length,
    seatsAvailable: Number(lic.seats || 0) - (lic.linkedServerIds || []).length,
  };
}

export function listLicensesByContactEmail(email) {
  const normalizedEmail = normalizeContactEmail(email);
  if (!normalizedEmail) return [];

  const data = load();
  return Object.values(data.licenses)
    .filter((lic) => normalizeContactEmail(lic.contactEmail) === normalizedEmail)
    .map((lic) => ({
      ...lic,
      expired: isExpired(lic),
      remainingDays: remainingDays(lic),
      seatsUsed: (lic.linkedServerIds || []).length,
      seatsAvailable: Number(lic.seats || 0) - (lic.linkedServerIds || []).length,
    }))
    .sort((a, b) => {
      const aExpiry = Date.parse(a.expiresAt || "");
      const bExpiry = Date.parse(b.expiresAt || "");
      const aUpdated = Date.parse(a.updatedAt || a.createdAt || "");
      const bUpdated = Date.parse(b.updatedAt || b.createdAt || "");
      return (Number.isFinite(bExpiry) ? bExpiry : 0) - (Number.isFinite(aExpiry) ? aExpiry : 0)
        || (Number.isFinite(bUpdated) ? bUpdated : 0) - (Number.isFinite(aUpdated) ? aUpdated : 0);
    });
}

export function createOrExtendLicenseForEmail({
  plan,
  seats = 1,
  billingPeriod = "monthly",
  months = 1,
  activatedBy = "admin",
  note = "",
  contactEmail = "",
  preferredLanguage = getDefaultLanguage(),
}) {
  if (!PLANS[plan] || plan === "free") throw new Error("Plan must be 'pro' or 'ultimate'.");

  const normalizedEmail = normalizeContactEmail(contactEmail);
  if (!normalizedEmail) throw new Error("contactEmail is required.");

  const normalizedSeats = normalizeSeatCount(seats);
  const normalizedMonths = Math.max(1, Number.parseInt(String(months), 10) || 1);
  const targetPlanRank = planRank(plan);
  const data = load();

  let candidate = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const lic of Object.values(data.licenses)) {
    if (normalizeContactEmail(lic.contactEmail) !== normalizedEmail) continue;

    const existingPlanRank = planRank(lic.plan);
    if (existingPlanRank > targetPlanRank) {
      // Avoid silently downgrading or extending a higher-tier license with a lower-tier purchase.
      continue;
    }

    let score = 0;
    if (String(lic.plan || "") === plan) score += 1_000;
    if (!isExpired(lic)) score += 500;
    score += Math.min((lic.linkedServerIds || []).length, 50);

    const expiryMs = Date.parse(lic.expiresAt || "");
    if (Number.isFinite(expiryMs)) score += expiryMs / 1e12;

    const updatedMs = Date.parse(lic.updatedAt || lic.createdAt || "");
    if (Number.isFinite(updatedMs)) score += updatedMs / 1e13;

    if (!candidate || score > bestScore) {
      candidate = lic;
      bestScore = score;
    }
  }

  if (!candidate) {
    const created = createLicense({
      plan,
      seats: normalizedSeats,
      billingPeriod,
      months: normalizedMonths,
      activatedBy,
      note,
      contactEmail: normalizedEmail,
      preferredLanguage,
    });
    const withMeta = getLicenseById(created.id) || created;
    return {
      license: withMeta,
      created: true,
      extended: false,
      upgraded: false,
      previousPlan: null,
      previousExpiresAt: null,
    };
  }

  const previousPlan = String(candidate.plan || "free");
  const previousExpiresAt = candidate.expiresAt || null;
  const wasExpired = isExpired(candidate);
  const linkedCount = (candidate.linkedServerIds || []).length;

  const now = new Date();
  const currentExpiry = candidate.expiresAt ? new Date(candidate.expiresAt) : now;
  const base = currentExpiry > now ? currentExpiry : now;
  const newExpiry = new Date(base);
  newExpiry.setMonth(newExpiry.getMonth() + normalizedMonths);

  candidate.plan = planRank(plan) >= planRank(candidate.plan) ? plan : candidate.plan;
  candidate.seats = Math.max(normalizedSeats, linkedCount);
  candidate.billingPeriod = billingPeriod;
  candidate.expiresAt = newExpiry.toISOString();
  candidate.durationMonths = Math.max(1, Number(candidate.durationMonths || 1)) + normalizedMonths;
  candidate.active = true;
  candidate.updatedAt = now.toISOString();
  candidate.activatedBy = activatedBy || candidate.activatedBy || "admin";
  candidate.contactEmail = normalizedEmail;
  candidate.preferredLanguage = normalizeLanguage(preferredLanguage, getDefaultLanguage());

  const incomingNote = String(note || "").trim();
  if (incomingNote) {
    const existingNote = String(candidate.note || "").trim();
    candidate.note = existingNote ? `${existingNote} | ${incomingNote}` : incomingNote;
  }

  save(data);
  const withMeta = getLicenseById(candidate.id) || candidate;
  return {
    license: withMeta,
    created: false,
    extended: true,
    upgraded: planRank(previousPlan) < planRank(withMeta.plan),
    previousPlan,
    previousExpiresAt,
    wasExpired,
  };
}

// --- Dedup helpers ---

export function isSessionProcessed(sessionId) {
  const data = load();
  return !!data.processedSessions[String(sessionId)];
}

export function getProcessedSession(sessionId) {
  const data = load();
  const entry = data.processedSessions[String(sessionId)];
  if (!entry || typeof entry !== "object") return null;
  return { sessionId: String(sessionId), ...entry };
}

export function markSessionProcessed(sessionId, meta = {}) {
  const data = load();
  data.processedSessions[String(sessionId)] = { ...meta, processedAt: new Date().toISOString() };
  save(data);
}

export function listProcessedSessionsByEmail(email, limit = 10) {
  const normalizedEmail = normalizeContactEmail(email);
  if (!normalizedEmail) return [];

  const max = Math.max(1, Math.min(100, Number.parseInt(String(limit), 10) || 10));
  const data = load();
  return Object.entries(data.processedSessions || {})
    .map(([sessionId, entry]) => ({
      sessionId,
      ...(entry && typeof entry === "object" ? entry : {}),
    }))
    .filter((entry) => normalizeContactEmail(entry.email) === normalizedEmail)
    .sort((a, b) => {
      const aProcessed = Date.parse(a.processedAt || "");
      const bProcessed = Date.parse(b.processedAt || "");
      const aCreated = Date.parse(a.checkoutCreatedAt || a.createdAt || "");
      const bCreated = Date.parse(b.checkoutCreatedAt || b.createdAt || "");
      return (Number.isFinite(bProcessed) ? bProcessed : 0) - (Number.isFinite(aProcessed) ? aProcessed : 0)
        || (Number.isFinite(bCreated) ? bCreated : 0) - (Number.isFinite(aCreated) ? aCreated : 0);
    })
    .slice(0, max)
    .map((entry) => ({ ...entry }));
}

export function isEventProcessed(eventId) {
  const data = load();
  return !!data.processedEvents[String(eventId)];
}

export function markEventProcessed(eventId, meta = {}) {
  const data = load();
  data.processedEvents[String(eventId)] = { ...meta, processedAt: new Date().toISOString() };
  save(data);
}

// --- Trial claim helpers ---

function normalizeTrialEmail(email) {
  return String(email || "").trim().toLowerCase();
}

export function getTrialClaimByEmail(email) {
  const normalizedEmail = normalizeTrialEmail(email);
  if (!normalizedEmail) return null;
  const data = load();
  return data.trialClaims[normalizedEmail] || null;
}

export function reserveTrialClaim(email, meta = {}) {
  const normalizedEmail = normalizeTrialEmail(email);
  if (!normalizedEmail) return { ok: false, message: "email is required" };

  const data = load();
  const existing = data.trialClaims[normalizedEmail];
  if (existing) {
    const existingCreatedAtMs = Date.parse(existing.createdAt || "");
    const isStaleReservation = (
      existing.status === "reserved"
      && !existing.licenseId
      && Number.isFinite(existingCreatedAtMs)
      && (Date.now() - existingCreatedAtMs) > TRIAL_RESERVATION_STALE_MS
    );
    if (!isStaleReservation) {
      return { ok: false, message: "trial already claimed", claim: existing };
    }
  }

  data.trialClaims[normalizedEmail] = {
    email: normalizedEmail,
    status: "reserved",
    createdAt: new Date().toISOString(),
    ...meta,
  };
  save(data);
  return { ok: true, claim: data.trialClaims[normalizedEmail] };
}

export function finalizeTrialClaim(email, patch = {}) {
  const normalizedEmail = normalizeTrialEmail(email);
  if (!normalizedEmail) return null;

  const data = load();
  const existing = data.trialClaims[normalizedEmail];
  if (!existing) return null;

  data.trialClaims[normalizedEmail] = {
    ...existing,
    ...patch,
    email: normalizedEmail,
    status: "claimed",
    claimedAt: new Date().toISOString(),
  };
  save(data);
  return data.trialClaims[normalizedEmail];
}

export function releaseTrialClaim(email) {
  const normalizedEmail = normalizeTrialEmail(email);
  if (!normalizedEmail) return false;

  const data = load();
  if (!data.trialClaims[normalizedEmail]) return false;
  delete data.trialClaims[normalizedEmail];
  save(data);
  return true;
}

// --- Server-level convenience functions ---

export function addLicenseForServer(serverId, plan, months = 1, activatedBy = "admin", note = "") {
  const license = createLicense({ plan, seats: 1, billingPeriod: months >= 12 ? "yearly" : "monthly", months, activatedBy, note });
  const link = linkServerToLicense(serverId, license.id);
  if (!link.ok) throw new Error(link.message);
  return license;
}

export function patchLicenseForServer(serverId, patch) {
  const data = load();
  const entitlement = data.serverEntitlements[String(serverId)];
  if (!entitlement) return null;
  const lic = data.licenses[entitlement.licenseId];
  if (!lic) return null;
  Object.assign(lic, patch);
  lic.updatedAt = new Date().toISOString();
  save(data);
  return lic;
}

export function patchLicenseById(licenseId, patch) {
  const lid = String(licenseId || "");
  if (!lid) return null;
  const data = load();
  const lic = data.licenses[lid];
  if (!lic) return null;
  Object.assign(lic, patch);
  lic.updatedAt = new Date().toISOString();
  save(data);
  return lic;
}

export function upgradeLicenseForServer(serverId, newPlan) {
  const data = load();
  const entitlement = data.serverEntitlements[String(serverId)];
  if (!entitlement) throw new Error("No active license for this server.");
  const lic = data.licenses[entitlement.licenseId];
  if (!lic) throw new Error("License not found.");
  lic.plan = newPlan;
  lic.updatedAt = new Date().toISOString();
  lic.active = true;
  save(data);
  return lic;
}

// Expose for entitlements module
export { isExpired, remainingDays };
