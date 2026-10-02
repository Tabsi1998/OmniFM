// ============================================================
// OmniFM: keys of other services, encrypted at rest (#302)
// ============================================================
// Discord's access and refresh tokens of the linked roles are kept in
// MongoDB only encrypted (AES-256-GCM). The key lives in the environment
// (OMNIFM_TOKEN_KEY, 32 bytes as base64 or hex), never in the database, so
// a copy of the database alone opens nothing. update.sh writes one into
// backend/.env when there is none.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

/** The key from OMNIFM_TOKEN_KEY, or null when it is missing or not 32 bytes. */
export function tokenKeyFrom(env = process.env) {
  const raw = String(env?.OMNIFM_TOKEN_KEY || "").trim();
  if (!raw) return null;
  const key = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
  return key.length === 32 ? key : null;
}

export function tokenCryptoAvailable(env = process.env) {
  return tokenKeyFrom(env) !== null;
}

/** "v1:<iv>:<tag>:<data>", every part base64url. */
export function encryptToken(plain, key = tokenKeyFrom()) {
  if (!key) throw new Error("OMNIFM_TOKEN_KEY fehlt.");
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const data = Buffer.concat([cipher.update(String(plain ?? ""), "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), data.toString("base64url")].join(":");
}

/** The plain token, or null when it was made with another key or changed. */
export function decryptToken(sealed, key = tokenKeyFrom()) {
  const parts = String(sealed || "").split(":");
  if (!key || parts.length !== 4 || parts[0] !== VERSION) return null;
  try {
    const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(parts[1], "base64url"));
    decipher.setAuthTag(Buffer.from(parts[2], "base64url"));
    return Buffer.concat([decipher.update(Buffer.from(parts[3], "base64url")), decipher.final()]).toString("utf8");
  } catch {
    return null;
  }
}
