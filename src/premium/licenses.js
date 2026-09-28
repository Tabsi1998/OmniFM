// OmniFM: premium licenses: create, link, extend, look up.
// Split out of src/premium-store.js (#295).
import { PLANS } from "../config/plans.js";
import { getDefaultLanguage, normalizeLanguage } from "../i18n.js";
import { PLAN_RANK, VALID_SEATS, load, save } from "../premium-store.js";

/** @param {number} [now] the moment to judge at; the Discord shop passes its own (#298). */
export function isExpired(license, now = Date.now()) {
  if (!license || !license.expiresAt) return false; // No expiry = perpetual (for now)
  return new Date(license.expiresAt).getTime() <= now;
}

export function remainingDays(license) {
  if (!license || !license.expiresAt) return Infinity;
  const diff = new Date(license.expiresAt).getTime() - Date.now();
  return Math.max(0, Math.ceil(diff / 86400000));
}

function generateLicenseId() {
  return `lic_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

export function normalizeContactEmail(email) {
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
  const plan = String(lic.plan || lic.tier || "free").toLowerCase();
  return PLANS[plan] ? plan : "free";
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
