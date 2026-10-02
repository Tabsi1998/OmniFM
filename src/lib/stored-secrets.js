// ============================================================
// OmniFM: the secrets OmniFM keeps in MongoDB, encrypted (#284)
// ============================================================
// Bot tokens, the OAuth and SMTP secrets, API keys and webhook addresses of
// owner_config are stored as "enc:v1:<iv>:<tag>:<data>" (AES-256-GCM with
// OMNIFM_TOKEN_KEY, src/lib/token-crypto.js). Whoever reads owner_config
// opens them; a plain value of an older installation is taken as it is
// until start.sh seals it (scripts/database.mjs encrypt-secrets). A dump or
// a backup of MongoDB alone opens nothing.
import { decryptToken, encryptToken, tokenKeyFrom, tokenKeysFrom } from "./token-crypto.js";

/** The fields of owner_config that hold secrets: masked in every answer, sealed in MongoDB. */
export const SECRET_CONFIG_FIELDS = new Set(["token", "secretKey", "webhookSecret", "secret", "clientSecret", "password", "apiKey", "webhookUrl"]);
export const SECRET_PREFIX = "enc:";
export const OWNER_CONFIG_COLLECTION = "owner_config";
export const OWNER_CONFIG_DOCUMENT = "global";
const LINKED_ROLES_COLLECTION = "linked_roles";
const LINKED_ROLE_TOKEN_FIELDS = ["accessToken", "refreshToken"];

export class SecretKeyError extends Error {
  constructor(message) {
    super(message);
    this.name = "SecretKeyError";
  }
}

export const MISSING_KEY_MESSAGE = "OMNIFM_TOKEN_KEY fehlt in backend/.env; ./update.sh legt ihn an.";

const isPlainObject = (value) => value !== null && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype;

export function isSealed(value) {
  return typeof value === "string" && value.startsWith(SECRET_PREFIX);
}

/** A copy of the document with fn applied to every string in a secret field; fn gets value and path. */
function mapSecrets(value, fn, path = []) {
  if (Array.isArray(value)) return value.map((entry, index) => mapSecrets(entry, fn, [...path, index]));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [key, entry] of Object.entries(value)) {
    out[key] = SECRET_CONFIG_FIELDS.has(key) && typeof entry === "string" ? fn(entry, [...path, key]) : mapSecrets(entry, fn, [...path, key]);
  }
  return out;
}

/** Every secret sealed with the current key; sealed and empty ones stay as they are. */
export function sealOwnerSecrets(doc, key = tokenKeyFrom()) {
  return mapSecrets(doc, (value) => {
    if (!value || isSealed(value)) return value;
    if (!key) throw new SecretKeyError(MISSING_KEY_MESSAGE);
    return SECRET_PREFIX + encryptToken(value, key);
  });
}

/**
 * Every secret opened; plain ones stay as they are. What no key opens comes
 * back empty, and its path is listed in `failed`.
 */
export function openOwnerSecrets(doc, keys = tokenKeysFrom()) {
  const failed = [];
  const opened = mapSecrets(doc, (value, path) => {
    if (!isSealed(value)) return value;
    const plain = decryptToken(value.slice(SECRET_PREFIX.length), keys);
    if (plain === null) {
      failed.push(path.join("."));
      return "";
    }
    return plain;
  });
  return { doc: opened, failed };
}

/** What the stored document holds: plain secrets, sealed ones, and sealed ones no key opens. */
export function describeOwnerSecrets(doc, keys = tokenKeysFrom()) {
  const report = { plain: [], sealed: 0, unopenable: [], previousKey: [] };
  const [current] = keys;
  mapSecrets(doc, (value, path) => {
    if (!value) return value;
    if (!isSealed(value)) report.plain.push(path.join("."));
    else if (current && decryptToken(value.slice(SECRET_PREFIX.length), [current]) !== null) report.sealed += 1;
    else if (decryptToken(value.slice(SECRET_PREFIX.length), keys) !== null) report.previousKey.push(path.join("."));
    else report.unopenable.push(path.join("."));
    return value;
  });
  return report;
}

async function storedOwnerConfig(db) {
  return (await db.collection(OWNER_CONFIG_COLLECTION).findOne({ _id: OWNER_CONFIG_DOCUMENT })) || null;
}

/** The changed secret fields as dotted paths, so nothing else of the document is written. */
function changedSecretPaths(before, after, path = [], changes = {}) {
  if (Array.isArray(before) && Array.isArray(after)) {
    before.forEach((entry, index) => changedSecretPaths(entry, after[index], [...path, index], changes));
  } else if (isPlainObject(before) && isPlainObject(after)) {
    for (const [key, entry] of Object.entries(before)) {
      if (SECRET_CONFIG_FIELDS.has(key) && typeof entry === "string") {
        if (after[key] !== entry) changes[[...path, key].join(".")] = after[key];
      } else {
        changedSecretPaths(entry, after[key], [...path, key], changes);
      }
    }
  }
  return changes;
}

/** owner_config's secrets in MongoDB: plain, sealed, or not to be opened with these keys. */
export async function checkStoredSecrets(db, keys = tokenKeysFrom()) {
  const doc = await storedOwnerConfig(db);
  return doc ? describeOwnerSecrets(doc, keys) : { plain: [], sealed: 0, unopenable: [], previousKey: [] };
}

/**
 * Seals every plain secret of owner_config with the current key and seals
 * again what only the previous key opens (after a key change). Returns how
 * many fields were written. Refuses when a sealed value opens with no key.
 */
export async function encryptStoredSecrets(db, { key = tokenKeyFrom(), keys = tokenKeysFrom() } = {}) {
  const doc = await storedOwnerConfig(db);
  if (!doc) return 0;
  const report = describeOwnerSecrets(doc, keys);
  if (report.unopenable.length) throw new SecretKeyError(`Diese Geheimnisse öffnet OMNIFM_TOKEN_KEY nicht: ${report.unopenable.join(", ")}`);
  if (!report.plain.length && !report.previousKey.length) return 0;
  if (!key) throw new SecretKeyError(MISSING_KEY_MESSAGE);
  const resealed = mapSecrets(doc, (value) => {
    if (!value) return value;
    if (!isSealed(value)) return SECRET_PREFIX + encryptToken(value, key);
    if (decryptToken(value.slice(SECRET_PREFIX.length), [key]) !== null) return value;
    return SECRET_PREFIX + encryptToken(decryptToken(value.slice(SECRET_PREFIX.length), keys), key);
  });
  const changes = changedSecretPaths(doc, resealed);
  if (Object.keys(changes).length) {
    await db.collection(OWNER_CONFIG_COLLECTION).updateOne({ _id: OWNER_CONFIG_DOCUMENT }, { $set: changes });
  }
  return Object.keys(changes).length;
}

/**
 * Stores every secret of owner_config in plain text again: for a rollback to
 * a version that reads them that way. Refuses when a value opens with no key.
 */
export async function decryptStoredSecrets(db, keys = tokenKeysFrom()) {
  const doc = await storedOwnerConfig(db);
  if (!doc) return 0;
  const { doc: opened, failed } = openOwnerSecrets(doc, keys);
  if (failed.length) throw new SecretKeyError(`Diese Geheimnisse öffnet OMNIFM_TOKEN_KEY nicht: ${failed.join(", ")}`);
  const changes = changedSecretPaths(doc, opened);
  if (Object.keys(changes).length) {
    await db.collection(OWNER_CONFIG_COLLECTION).updateOne({ _id: OWNER_CONFIG_DOCUMENT }, { $set: changes });
  }
  return Object.keys(changes).length;
}

/**
 * The linked roles' Discord tokens sealed again with the current key where
 * only the previous one opens them. Tokens no key opens stay; their owner
 * connects again. Returns how many accounts were written.
 */
export async function resealLinkedRoleTokens(db, { key = tokenKeyFrom(), keys = tokenKeysFrom() } = {}) {
  if (!key) throw new SecretKeyError(MISSING_KEY_MESSAGE);
  const collection = db.collection(LINKED_ROLES_COLLECTION);
  let written = 0;
  for (const row of await collection.find({}, { projection: Object.fromEntries(LINKED_ROLE_TOKEN_FIELDS.map((field) => [field, 1])) }).toArray()) {
    const changes = {};
    for (const field of LINKED_ROLE_TOKEN_FIELDS) {
      const sealed = row[field];
      if (typeof sealed !== "string" || !sealed || decryptToken(sealed, [key]) !== null) continue;
      const plain = decryptToken(sealed, keys);
      if (plain !== null) changes[field] = encryptToken(plain, key);
    }
    if (Object.keys(changes).length) {
      // eslint-disable-next-line no-await-in-loop -- a handful of accounts, once per key change
      await collection.updateOne({ _id: row._id }, { $set: changes });
      written += 1;
    }
  }
  return written;
}
