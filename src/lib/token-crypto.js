// ============================================================
// OmniFM: keys of other services, encrypted at rest (#302, #284)
// ============================================================
// Discord's access and refresh tokens of the linked roles and the secrets of
// the owner console (bot tokens, OAuth and SMTP secrets, API keys, webhooks)
// are kept in MongoDB only encrypted (AES-256-GCM). The key lives in the
// environment (OMNIFM_TOKEN_KEY, 32 bytes as base64 or hex), never in the
// database, so a copy of the database alone opens nothing. start.sh (which
// update.sh runs) writes one into backend/.env when there is none. While the
// key is being changed, OMNIFM_TOKEN_KEY_PREVIOUS still opens what the old
// key sealed (scripts/database.mjs rotate-key).
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";
// The full 16-byte GCM tag; a shorter one would make forgeries easier, so none is taken.
const TAG_LENGTH = 16;

/** 32 bytes from hex or base64, else null. */
export function parseTokenKey(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  const key = /^[0-9a-f]{64}$/i.test(text) ? Buffer.from(text, "hex") : Buffer.from(text, "base64");
  return key.length === 32 ? key : null;
}

/** The key from OMNIFM_TOKEN_KEY, or null when it is missing or not 32 bytes. */
export function tokenKeyFrom(env = process.env) {
  return parseTokenKey(env?.OMNIFM_TOKEN_KEY);
}

/** The keys that open stored values: the current one, then the one a key change replaces. */
export function tokenKeysFrom(env = process.env) {
  return [tokenKeyFrom(env), parseTokenKey(env?.OMNIFM_TOKEN_KEY_PREVIOUS)].filter(Boolean);
}

export function tokenCryptoAvailable(env = process.env) {
  return tokenKeyFrom(env) !== null;
}

/** "v1:<iv>:<tag>:<data>", every part base64url. */
export function encryptToken(plain, key = tokenKeyFrom()) {
  if (!key) throw new Error("OMNIFM_TOKEN_KEY fehlt.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LENGTH });
  const data = Buffer.concat([cipher.update(String(plain ?? ""), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

/**
 * The plain token, or null when no given key made it or it was changed.
 * @param {string} sealed
 * @param {Buffer | null | Array<Buffer | null>} [keys] one key or several, tried in order
 */
export function decryptToken(sealed, keys = tokenKeysFrom()) {
  const parts = String(sealed || "").split(":");
  if (parts.length !== 4 || parts[0] !== VERSION) return null;
  const tag = Buffer.from(parts[2], "base64url");
  if (tag.length !== TAG_LENGTH) return null;
  for (const key of (Array.isArray(keys) ? keys : [keys]).filter(Boolean)) {
    try {
      const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"), { authTagLength: TAG_LENGTH });
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
    } catch {
      // Not this key; the next one may open it.
    }
  }
  return null;
}
