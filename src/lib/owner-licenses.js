// ============================================================
// OmniFM: the owner console's license manager on the Node API (#288)
// ============================================================
// The Node twin of backend/routers/admin_licenses.py and the helpers in
// backend/services/licenses.py, with the same rules, so the console behaves
// the same whichever backend answers. Works on the premium store's data
// ({ licenses, serverEntitlements }); the caller loads and saves it.
import { randomInt } from "node:crypto";

export const LICENSE_TIER_NAMES = Object.freeze({ free: "Free", pro: "Pro", ultimate: "Ultimate" });
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SERVER_ID = /^\d{17,22}$/;
const DAY_MS = 86_400_000;

export class OwnerLicenseError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export const isValidEmail = (value) => EMAIL.test(String(value || "").trim());
export const isValidServerId = (value) => SERVER_ID.test(String(value || "").trim());

/** Python's int(str(value).strip()) with a fallback, like parse_int. */
export function parseIntLike(value, fallback) {
  const text = String(value ?? "").trim();
  return /^[+-]?\d+$/.test(text) ? Number.parseInt(text, 10) : fallback;
}

export function isLicenseExpired(license, now = Date.now()) {
  if (!license?.expiresAt) return false;
  const at = Date.parse(license.expiresAt);
  return Number.isFinite(at) && at <= now;
}

/** remaining_days(): whole days left, plus one, never below zero. */
export function remainingLicenseDays(license, now = Date.now()) {
  if (!license?.expiresAt) return 0;
  const at = Date.parse(license.expiresAt);
  if (!Number.isFinite(at)) return 0;
  return Math.max(0, Math.trunc((at - now) / DAY_MS) + 1);
}

export function maskEmail(email) {
  const raw = String(email || "").trim();
  if (!raw.includes("@")) return raw;
  const [local, domain] = [raw.slice(0, raw.indexOf("@")), raw.slice(raw.indexOf("@") + 1)];
  if (local.length <= 2) return `${"*".repeat(local.length)}@${domain}`;
  return `${local.slice(0, 2)}***@${domain}`;
}

/** OMNI-XXXX-XXXX-XXXX, like the keys FastAPI hands out. */
export function generateOwnerLicenseKey() {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  const part = () => Array.from({ length: 4 }, () => chars[randomInt(chars.length)]).join("");
  return `OMNI-${part()}-${part()}-${part()}`;
}

const planOf = (license) => String(license?.plan || license?.tier || "free").toLowerCase();
const seatsOf = (license) => Math.max(1, parseIntLike(license?.seats ?? 1, 1));
const linkedOf = (license) => (Array.isArray(license?.linkedServerIds) ? license.linkedServerIds : []);

/** add_license() */
export function addOwnerLicense(data, { email = "", tier, months = 1, seats = 1, note = "", activatedBy = "owner" }, now = new Date()) {
  if (!["pro", "ultimate"].includes(tier)) throw new OwnerLicenseError(400, "Tier muss 'pro' oder 'ultimate' sein.");
  const safeMonths = Math.max(1, parseIntLike(months, 1));
  const safeSeats = Math.max(1, Math.min(5, Number.isFinite(Number(seats)) ? Math.trunc(Number(seats)) : 1));
  data.licenses = data.licenses || {};
  let key = generateOwnerLicenseKey();
  while (Object.hasOwn(data.licenses, key)) key = generateOwnerLicenseKey();
  const stamp = now.toISOString();
  data.licenses[key] = {
    id: key,
    tier,
    plan: tier,
    seats: safeSeats,
    active: true,
    email,
    contactEmail: email,
    linkedServerIds: [],
    createdAt: stamp,
    updatedAt: stamp,
    activatedAt: stamp,
    expiresAt: new Date(now.getTime() + safeMonths * 30 * DAY_MS).toISOString(),
    durationMonths: safeMonths,
    activatedBy,
    note,
  };
  return { ...data.licenses[key], licenseKey: key };
}

/** _set_license_server_links(): one seat per server, a server moves off any other license. */
export function setLicenseServerLinks(data, licenseKey, serverIds, now = new Date()) {
  const licenses = data.licenses || (data.licenses = {});
  const entitlements = data.serverEntitlements || (data.serverEntitlements = {});
  const license = licenses[licenseKey];
  if (!license || typeof license !== "object") throw new OwnerLicenseError(400, "Lizenz nicht gefunden.");
  const normalized = [];
  const invalid = [];
  for (const raw of Array.isArray(serverIds) ? serverIds : [serverIds]) {
    const id = String(raw ?? "").trim();
    if (!id) continue;
    if (!isValidServerId(id)) invalid.push(id);
    else if (!normalized.includes(id)) normalized.push(id);
  }
  if (invalid.length) throw new OwnerLicenseError(400, `Ungültige Discord Guild-ID: ${invalid[0]}. Erwartet werden 17–22 Ziffern.`);
  const seats = seatsOf(license);
  if (normalized.length > seats) throw new OwnerLicenseError(400, `Diese Lizenz hat ${seats} Seat(s), angefordert wurden ${normalized.length} Server.`);

  const stamp = now.toISOString();
  const target = new Set(normalized);
  for (const id of linkedOf(license).map(String)) {
    if (!target.has(id) && String(entitlements[id]?.licenseId || "") === String(licenseKey)) delete entitlements[id];
  }
  for (const id of normalized) {
    const conflicting = new Set();
    const current = String(entitlements[id]?.licenseId || "");
    if (current) conflicting.add(current);
    for (const [otherId, other] of Object.entries(licenses)) {
      if (String(otherId) !== String(licenseKey) && linkedOf(other).map(String).includes(id)) conflicting.add(String(otherId));
    }
    for (const oldId of conflicting) {
      if (!oldId || oldId === String(licenseKey) || !licenses[oldId] || typeof licenses[oldId] !== "object") continue;
      licenses[oldId].linkedServerIds = linkedOf(licenses[oldId]).filter((item) => String(item) !== id);
      licenses[oldId].updatedAt = stamp;
    }
    entitlements[id] = { serverId: id, licenseId: String(licenseKey) };
  }
  license.linkedServerIds = normalized;
  license.updatedAt = stamp;
  return normalized;
}

/** PATCH /api/admin/licenses/<key>: returns the list of changes. */
export function patchOwnerLicense(data, licenseKey, body = {}, now = new Date()) {
  const license = data.licenses?.[licenseKey];
  if (!license || typeof license !== "object") throw new OwnerLicenseError(404, "Lizenz nicht gefunden.");
  const changes = [];
  if (body.tier) {
    const tier = String(body.tier).trim().toLowerCase();
    if (!["pro", "ultimate"].includes(tier)) throw new OwnerLicenseError(400, "Tier muss 'pro' oder 'ultimate' sein.");
    license.tier = tier;
    license.plan = tier;
    changes.push(`tier=${tier}`);
  }
  if ("seats" in body) {
    const seats = Math.max(1, Math.min(5, parseIntLike(body.seats ?? 1, 1)));
    const linkedCount = linkedOf(license).length;
    if (seats < linkedCount) throw new OwnerLicenseError(400, `Seats können nicht unter die ${linkedCount} verknüpften Server reduziert werden.`);
    license.seats = seats;
    changes.push(`seats=${seats}`);
  }
  if ("email" in body) {
    const email = String(body.email || "").trim();
    if (email && !isValidEmail(email)) throw new OwnerLicenseError(400, "Bitte eine gültige E-Mail-Adresse angeben.");
    license.email = email;
    license.contactEmail = email;
    changes.push("email");
  }
  if ("note" in body) {
    license.note = String(body.note || "").trim();
    changes.push("note");
  }
  const baseAt = Date.parse(license.expiresAt || "");
  const base = Number.isFinite(baseAt) ? baseAt : now.getTime();
  if (body.expireNow) {
    license.expiresAt = new Date(now.getTime() - DAY_MS).toISOString();
    changes.push("expireNow");
  } else if (body.expiresAt) {
    const at = Date.parse(String(body.expiresAt));
    if (!Number.isFinite(at)) throw new OwnerLicenseError(400, "Ungültiges Ablaufdatum.");
    license.expiresAt = new Date(at).toISOString();
    changes.push("expiresAt");
  } else {
    let deltaDays = 0;
    if (body.extendMonths !== undefined && body.extendMonths !== null) deltaDays += parseIntLike(body.extendMonths, 0) * 30;
    if (body.extendDays !== undefined && body.extendDays !== null) deltaDays += parseIntLike(body.extendDays, 0);
    if (deltaDays !== 0) {
      license.expiresAt = new Date(base + deltaDays * DAY_MS).toISOString();
      changes.push(`expiry${deltaDays > 0 ? "+" : ""}${deltaDays}d`);
    }
  }
  if ("active" in body) {
    license.active = Boolean(body.active);
    changes.push(`active=${Boolean(body.active)}`);
  }
  let requested = linkedOf(license).map(String);
  if (Array.isArray(body.linkedServerIds)) {
    requested = body.linkedServerIds;
    changes.push("linkedServerIds");
  }
  if (body.addServerId) {
    const id = String(body.addServerId).trim();
    if (id && !requested.includes(id)) requested.push(id);
    changes.push(`+guild ${id}`);
  }
  if (body.removeServerId) {
    const id = String(body.removeServerId).trim();
    requested = requested.filter((item) => String(item) !== id);
    changes.push(`-guild ${id}`);
  }
  setLicenseServerLinks(data, licenseKey, requested, now);
  license.updatedAt = now.toISOString();
  return changes;
}

/** get_server_license(): which license a server resolves to, and from where. */
export function resolveServerLicense(data, serverId, now = Date.now()) {
  const sid = String(serverId ?? "").trim();
  if (!sid) return null;
  const licenses = data.licenses || {};
  const resolved = (license, source, licenseId) => {
    const expired = isLicenseExpired(license, now);
    const active = license.active !== false && !expired;
    const plan = Object.hasOwn(LICENSE_TIER_NAMES, planOf(license)) ? planOf(license) : "free";
    return { ...license, expired, active, activeTier: active ? plan : "free", tier: plan, plan, resolutionSource: source, _licenseId: String(licenseId || license.id || "") };
  };
  const entitlements = data.serverEntitlements || {};
  let entitlement = entitlements[sid] || Object.entries(entitlements).find(([key]) => String(key) === sid)?.[1] || null;
  if (!entitlement) {
    const legacy = Object.entries(licenses).find(([, candidate]) => linkedOf(candidate).map(String).includes(sid));
    if (legacy) entitlement = { serverId: sid, licenseId: legacy[0], _legacyLink: true };
  }
  if (entitlement) {
    const licenseId = String(entitlement.licenseId || "");
    const license = licenses[licenseId];
    if (license) return resolved(license, entitlement._legacyLink ? "linkedServerIds" : "serverEntitlement", licenseId);
  }
  const legacyKeyed = licenses[sid];
  return legacyKeyed ? resolved(legacyKeyed, "legacyServerKey", sid) : null;
}

function baseRow(licenseId, license, now) {
  const plan = planOf(license);
  const expired = isLicenseExpired(license, now);
  return {
    plan,
    planName: LICENSE_TIER_NAMES[plan] || plan.charAt(0).toUpperCase() + plan.slice(1),
    seats: seatsOf(license),
    seatsUsed: linkedOf(license).length,
    active: license.active !== false && !expired,
    expired,
    daysLeft: remainingLicenseDays(license, now),
    expiresAt: license.expiresAt ?? null,
  };
}

const byCreatedDesc = (a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || ""));

/** _license_rows(): the short list, e-mails masked. */
export function licenseRows(data, now = Date.now()) {
  return Object.entries(data.licenses || {})
    .filter(([, license]) => license && typeof license === "object")
    .map(([licenseId, license]) => ({
      id: String(license.id || licenseId),
      ...baseRow(licenseId, license, now),
      createdAt: license.createdAt || license.issuedAt || null,
      source: license.source || "manual",
      contactEmail: maskEmail(license.contactEmail || license.email || ""),
      linkedServerIds: linkedOf(license).map(String).slice(0, 25),
    }))
    .sort(byCreatedDesc);
}

/**
 * _admin_license_rows(): everything the owner needs to find and edit a
 * license, with how each linked server resolves.
 * @param {Record<string, { name?: string, memberCount?: number, iconUrl?: string|null, bots?: string[] }>} [guildDirectory]
 */
export function adminLicenseRows(data, guildDirectory = {}, now = Date.now()) {
  return Object.entries(data.licenses || {})
    .filter(([, license]) => license && typeof license === "object")
    .map(([licenseId, license]) => {
      const linkedIds = linkedOf(license).map(String).slice(0, 50);
      return {
        licenseKey: String(licenseId),
        id: String(license.id || licenseId),
        ...baseRow(licenseId, license, now),
        activatedAt: license.activatedAt ?? null,
        createdAt: license.createdAt || license.issuedAt || license.activatedAt || null,
        durationMonths: license.durationMonths ?? null,
        source: license.source || license.activatedBy || "manual",
        email: String(license.contactEmail || license.email || ""),
        note: String(license.note || ""),
        linkedServerIds: linkedIds,
        linkedServers: linkedIds.map((serverId) => {
          const resolved = resolveServerLicense(data, serverId, now);
          const known = guildDirectory[serverId];
          return {
            id: serverId,
            name: known?.name || serverId,
            known: Boolean(known),
            valid: isValidServerId(serverId),
            memberCount: known?.memberCount || 0,
            iconUrl: known?.iconUrl ?? null,
            bots: known?.bots || [],
            discordUrl: isValidServerId(serverId) ? `https://discord.com/channels/${serverId}` : null,
            licenseResolved: Boolean(resolved && resolved.active && !resolved.expired && String(resolved._licenseId || "") === String(licenseId)),
            effectivePlan: resolved?.activeTier || "free",
            resolutionSource: resolved?.resolutionSource ?? null,
          };
        }),
      };
    })
    .sort(byCreatedDesc);
}
