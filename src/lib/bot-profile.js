// ============================================================
// OmniFM: the bot's own look per server (#280, Ultimate)
// ============================================================
// Discord lets a bot have its own avatar, banner and bio on each server.
// Here the checks for what the dashboard sends: real image files by their
// first bytes, size limits, bio length, and how often a worker's profile may
// change (Discord limits profile edits).

export const BOT_PROFILE_BIO_MAX = 190;
export const BOT_PROFILE_AVATAR_MAX_BYTES = 2 * 1024 * 1024;
export const BOT_PROFILE_BANNER_MAX_BYTES = 4 * 1024 * 1024;
export const BOT_PROFILE_CHANGES_PER_WINDOW = 3;
export const BOT_PROFILE_WINDOW_MS = 10 * 60_000;

const IMAGE_SIGNATURES = [
  { mime: "image/png", test: (b) => b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47 },
  { mime: "image/jpeg", test: (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/gif", test: (b) => b.length > 6 && b.subarray(0, 4).toString("ascii") === "GIF8" },
  { mime: "image/webp", test: (b) => b.length > 12 && b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP" },
];

/** The image type from the file's first bytes, whatever the data URL claims; null for anything else. */
export function detectImageType(buffer) {
  if (!Buffer.isBuffer(buffer)) return null;
  return IMAGE_SIGNATURES.find((signature) => signature.test(buffer))?.mime || null;
}

/**
 * "data:image/png;base64,..." -> { ok, mime, buffer, dataUri } or
 * { ok: false, error: "invalid" | "format" | "size" }.
 */
export function parseProfileImage(dataUrl, maxBytes) {
  const match = /^data:([a-z0-9.+/-]+);base64,([a-z0-9+/=\s]+)$/i.exec(String(dataUrl || "").trim());
  if (!match) return { ok: false, error: "invalid" };
  const buffer = Buffer.from(match[2].replace(/\s+/g, ""), "base64");
  if (!buffer.length) return { ok: false, error: "invalid" };
  if (buffer.length > maxBytes) return { ok: false, error: "size" };
  const mime = detectImageType(buffer);
  if (!mime) return { ok: false, error: "format" };
  return { ok: true, mime, buffer, dataUri: `data:${mime};base64,${buffer.toString("base64")}` };
}

/**
 * What the dashboard sends for one worker: { slot, avatar?, banner?, bio?, reset? }.
 * A field that is missing stays as it is; null removes it (back to the default).
 * { ok, slot, reset, changes: { avatar?, banner?, bio? } } with data URIs, or { ok: false, error, field }.
 */
export function validateBotProfileInput(body = {}) {
  const slot = Number.parseInt(String(body?.slot ?? ""), 10);
  if (!Number.isInteger(slot) || slot < 1 || slot > 50) return { ok: false, error: "slot", field: "slot" };
  if (body.reset === true) return { ok: true, slot, reset: true, changes: { avatar: null, banner: null, bio: null } };

  const changes = {};
  for (const [field, maxBytes] of [["avatar", BOT_PROFILE_AVATAR_MAX_BYTES], ["banner", BOT_PROFILE_BANNER_MAX_BYTES]]) {
    if (!Object.hasOwn(body, field)) continue;
    if (body[field] === null) {
      changes[field] = null;
      continue;
    }
    const image = parseProfileImage(body[field], maxBytes);
    if (!image.ok) return { ok: false, error: image.error, field };
    changes[field] = image.dataUri;
  }
  if (Object.hasOwn(body, "bio")) {
    const bio = body.bio === null ? "" : String(body.bio).replace(/\r\n/g, "\n").trim();
    if (bio.length > BOT_PROFILE_BIO_MAX) return { ok: false, error: "size", field: "bio" };
    changes.bio = bio || null;
  }
  if (!Object.keys(changes).length) return { ok: false, error: "empty", field: null };
  return { ok: true, slot, reset: false, changes };
}

/** What is stored per worker: which parts are custom, the bio, when and by whom. */
export function summarizeProfileChange(previous = {}, changes = {}, { at = new Date(), by = null } = {}) {
  const next = {
    avatar: Object.hasOwn(changes, "avatar") ? changes.avatar !== null : previous.avatar === true,
    banner: Object.hasOwn(changes, "banner") ? changes.banner !== null : previous.banner === true,
    bio: Object.hasOwn(changes, "bio") ? changes.bio || null : previous.bio || null,
    updatedAt: new Date(at).toISOString(),
    updatedBy: by,
  };
  return next.avatar || next.banner || next.bio ? next : null;
}

/**
 * A small limiter per worker and server: at most three changes in ten
 * minutes. `take(key, now)` says whether one more is allowed now.
 */
export function createProfileChangeLimiter({ limit = BOT_PROFILE_CHANGES_PER_WINDOW, windowMs = BOT_PROFILE_WINDOW_MS } = {}) {
  const history = new Map();
  return {
    take(key, now = Date.now()) {
      const recent = (history.get(key) || []).filter((at) => now - at < windowMs);
      if (recent.length >= limit) {
        history.set(key, recent);
        return { ok: false, retryAfterMs: windowMs - (now - recent[0]) };
      }
      recent.push(now);
      history.set(key, recent);
      return { ok: true };
    },
  };
}
