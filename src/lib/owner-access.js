// ============================================================
// OmniFM: who may use the owner console, and what (#283)
// ============================================================
// Before: one fixed API_ADMIN_TOKEN, anyone with it could do everything and
// the audit said only "owner". Now the owner signs in with Discord (the
// dashboard's login), and owner_config.access lists the Discord accounts
// with a role:
//   owner    everything
//   support  read everything, run checks (cockpit, station tests, integration tests)
//   billing  read everything, licences, payment and plan settings
// The token stays for scripts and can be switched off once an owner account
// exists. Owner sessions: a random cookie (HttpOnly, SameSite=Strict, 12 h),
// stored hashed in MongoDB (owner_sessions), so the commander's cockpit
// knows them too; changes need the X-OmniFM-CSRF header.
import { createHash, randomBytes } from "node:crypto";
import { getDb, isConnected } from "./db.js";
import { ownerSettings } from "./owner-settings-cache.js";
import { safeTokenEquals } from "./api-helpers.js";

export const OWNER_ROLES = Object.freeze(["owner", "support", "billing"]);
export const OWNER_ROLE_LABELS = Object.freeze({ owner: "Owner", support: "Support", billing: "Abrechnung" });
export const OWNER_SESSION_COOKIE = "omnifm_owner";
export const OWNER_SESSION_TTL_MS = 12 * 60 * 60 * 1000;
export const OWNER_CSRF_HEADER = "x-omnifm-csrf";
export const OWNER_CSRF_VALUE = "owner-intent";

const SNOWFLAKE = /^\d{17,22}$/;
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const text = (value, max = 80) => String(value ?? "").trim().slice(0, max);

/** The access section as it may be stored: valid accounts only, one per Discord ID. */
export function normalizeAccess(raw = {}) {
  const seen = new Set();
  const accounts = [];
  for (const entry of Array.isArray(raw?.accounts) ? raw.accounts : []) {
    const discordId = text(entry?.discordId, 22);
    const role = text(entry?.role, 20).toLowerCase();
    if (!SNOWFLAKE.test(discordId) || !OWNER_ROLES.includes(role) || seen.has(discordId)) continue;
    seen.add(discordId);
    accounts.push({ discordId, name: text(entry?.name) || discordId, role });
  }
  return { accounts, tokenEnabled: raw?.tokenEnabled !== false };
}

export function accessSettings(settings = ownerSettings()) {
  return normalizeAccess(settings?.access || {});
}

/** The token can only be off while a Discord owner can still get in. */
export function tokenLoginEnabled(access = accessSettings()) {
  return access.tokenEnabled || !access.accounts.some((account) => account.role === "owner");
}

export function accountForDiscordUser(discordId, access = accessSettings()) {
  return access.accounts.find((account) => account.discordId === String(discordId || "")) || null;
}

/**
 * What a role may do with one request. Reads are open to every role; the
 * config section of a save is checked by roleMaySaveSection().
 */
export function roleAllows(role, method, pathname) {
  if (role === "owner") return true;
  if (!OWNER_ROLES.includes(role)) return false;
  const verb = String(method || "GET").toUpperCase();
  if (SAFE_METHODS.has(verb)) return true;
  if (role === "support") {
    return verb === "POST" && ["/api/owner/status/check", "/api/admin/stations/test", "/api/admin/stations/health", "/api/admin/integrations/test"].includes(pathname);
  }
  // billing
  if (pathname === "/api/admin/licenses") return verb === "POST";
  if (/^\/api\/admin\/licenses\/[^/]+$/.test(pathname)) return verb === "PATCH" || verb === "DELETE";
  return verb === "PUT" && pathname === "/api/admin/config";
}

export function roleMaySaveSection(role, section) {
  if (role === "owner") return true;
  return role === "billing" && ["plans", "discordShop"].includes(section);
}

/** The owner access section as the owner saves it: no lock-out. */
export function validateAccessSave(data) {
  const access = normalizeAccess(data);
  if (!access.tokenEnabled && !access.accounts.some((account) => account.role === "owner")) {
    return { ok: false, error: "Der Token kann erst aus, wenn mindestens ein Discord-Konto die Rolle Owner hat." };
  }
  return { ok: true, access };
}

// ---- Sessions -------------------------------------------------------------

const memorySessions = new Map();
const hashToken = (token) => createHash("sha256").update(String(token)).digest("hex");
const sessionsCollection = () => (isConnected() && getDb() ? getDb().collection("owner_sessions") : null);
let indexReady = false;

async function ensureSessionIndex(collection) {
  if (indexReady) return;
  indexReady = true;
  await collection.createIndex({ expiresAt: 1 }, { name: "owner_session_expiry", expireAfterSeconds: 0 }).catch(() => null);
}

export async function createOwnerSession({ discordId, name }, { now = Date.now() } = {}) {
  const token = randomBytes(32).toString("base64url");
  const doc = { _id: hashToken(token), discordId: String(discordId), name: text(name), createdAt: new Date(now), expiresAt: new Date(now + OWNER_SESSION_TTL_MS) };
  const collection = sessionsCollection();
  if (collection) {
    await ensureSessionIndex(collection);
    await collection.insertOne(doc);
  } else {
    memorySessions.set(doc._id, doc);
  }
  return { token, expiresAt: doc.expiresAt };
}

export async function readOwnerSession(token, { now = Date.now() } = {}) {
  if (!token) return null;
  const id = hashToken(token);
  const collection = sessionsCollection();
  const doc = collection ? await collection.findOne({ _id: id }).catch(() => null) : memorySessions.get(id);
  if (!doc || new Date(doc.expiresAt).getTime() <= now) return null;
  return { discordId: doc.discordId, name: doc.name, expiresAt: doc.expiresAt };
}

export async function deleteOwnerSession(token) {
  if (!token) return;
  const id = hashToken(token);
  memorySessions.delete(id);
  const collection = sessionsCollection();
  if (collection) await collection.deleteOne({ _id: id }).catch(() => null);
}

/** Signs one Discord account out of the owner console (#285); its access in the settings stays. */
export async function deleteOwnerSessionsOfUser(discordId) {
  const id = String(discordId || "").trim();
  if (!id) return 0;
  let count = 0;
  for (const [key, doc] of memorySessions.entries()) {
    if (doc.discordId !== id) continue;
    memorySessions.delete(key);
    count += 1;
  }
  const collection = sessionsCollection();
  if (!collection) return count;
  const result = await collection.deleteMany({ discordId: id }).catch(() => null);
  return count + (result?.deletedCount || 0);
}

export function ownerSessionCookie(token, { secure = false, maxAgeSeconds = OWNER_SESSION_TTL_MS / 1000 } = {}) {
  const value = token ? encodeURIComponent(token) : "";
  const age = token ? maxAgeSeconds : 0;
  return `${OWNER_SESSION_COOKIE}=${value}; Max-Age=${age}; Path=/api; HttpOnly; SameSite=Strict${secure ? "; Secure" : ""}`;
}

export function ownerSessionTokenFrom(req) {
  for (const part of String(req?.headers?.cookie || "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === OWNER_SESSION_COOKIE) {
      try { return decodeURIComponent(rest.join("=")); } catch { return ""; }
    }
  }
  return "";
}

// ---- Who is asking --------------------------------------------------------

function headerToken(req) {
  const headerValue = String(req?.headers?.["x-admin-token"] || "").trim();
  if (headerValue) return headerValue;
  const auth = String(req?.headers?.authorization || "").trim();
  return /^bearer\s+/i.test(auth) ? auth.replace(/^bearer\s+/i, "").trim() : "";
}

/**
 * The owner identity of a request: the script token (role owner) or a Discord
 * owner session with its current role. Removing an account from the list
 * ends its access at once, whatever its session says.
 */
export async function resolveOwnerIdentity(req, { adminToken = "" } = {}) {
  const access = accessSettings();
  const token = headerToken(req);
  if (token && adminToken && tokenLoginEnabled(access) && safeTokenEquals(token, adminToken)) {
    // The audit names the script token "owner"; Discord sign-ins name the person.
    return { via: "token", role: "owner", actor: "owner", user: null };
  }
  const session = await readOwnerSession(ownerSessionTokenFrom(req));
  if (!session) return null;
  const account = accountForDiscordUser(session.discordId, access);
  if (!account) return null;
  return {
    via: "discord",
    role: account.role,
    actor: `${account.name} (${account.discordId})`,
    user: { id: account.discordId, name: account.name },
  };
}

/** A change through the session cookie needs the header a foreign page cannot send. */
export function csrfSatisfied(req, identity) {
  if (!identity || identity.via !== "discord") return true;
  if (SAFE_METHODS.has(String(req?.method || "GET").toUpperCase())) return true;
  return String(req?.headers?.[OWNER_CSRF_HEADER] || "").trim() === OWNER_CSRF_VALUE;
}
