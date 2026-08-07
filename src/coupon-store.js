import fs from "node:fs";
import path from "node:path";
import { resolveRuntimeDataPath } from "./lib/runtime-data-path.js";

const STORE_FILE = resolveRuntimeDataPath("coupons.json");
const BACKUP_FILE = `${STORE_FILE}.bak`;
const OFFER_KINDS = new Set(["coupon", "referral"]);
const OFFER_FULFILLMENT_MODES = new Set(["discount", "direct_grant"]);
const VALID_TIERS = new Set(["pro", "ultimate"]);
const VALID_SEATS = new Set([1, 2, 3, 5]);
const MAX_REDEMPTIONS = 50_000;

function emptyStore() {
  return {
    offers: {},
    redemptions: {},
  };
}

function normalizeCode(rawCode) {
  const cleaned = String(rawCode || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 40);
  return cleaned || null;
}

function clipText(value, maxLen = 200) {
  const text = String(value || "").trim();
  if (!text) return "";
  return text.slice(0, maxLen);
}

function normalizePositiveInt(rawValue, fallback = null) {
  const num = Number.parseInt(String(rawValue), 10);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return num;
}

function normalizeIsoDate(rawValue) {
  if (!rawValue) return null;
  const parsed = new Date(String(rawValue));
  const ms = parsed.getTime();
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function normalizeTierValue(rawValue, fallback = null) {
  const value = String(rawValue || "").trim().toLowerCase();
  if (!value) return fallback;
  return VALID_TIERS.has(value) ? value : fallback;
}

function normalizeSeatValue(rawValue, fallback = null) {
  const value = Number.parseInt(String(rawValue), 10);
  if (!Number.isFinite(value) || !VALID_SEATS.has(value)) return fallback;
  return value;
}

function normalizeOffer(rawOffer, existing = null) {
  const source = rawOffer && typeof rawOffer === "object" ? rawOffer : {};
  const fallbackCode = normalizeCode(existing?.code);
  const code = normalizeCode(source.code) || fallbackCode;
  if (!code) throw new Error("Offer code is required.");

  const kindRaw = String(source.kind || existing?.kind || "coupon").trim().toLowerCase();
  const kind = OFFER_KINDS.has(kindRaw) ? kindRaw : "coupon";
  const fulfillmentModeRaw = String(
    source.fulfillmentMode
      ?? source.fulfillment_mode
      ?? existing?.fulfillmentMode
      ?? "discount"
  ).trim().toLowerCase();
  const fulfillmentMode = OFFER_FULFILLMENT_MODES.has(fulfillmentModeRaw)
    ? fulfillmentModeRaw
    : "discount";

  const hasPercentInput = source.percentOff !== undefined || source.percent_off !== undefined;
  const hasAmountInput = source.amountOffCents !== undefined || source.amount_off_cents !== undefined;
  const percentCandidate = Number(
    hasPercentInput ? (source.percentOff ?? source.percent_off) : (existing?.percentOff ?? 0)
  );
  const amountCandidate = Number(
    hasAmountInput ? (source.amountOffCents ?? source.amount_off_cents) : (existing?.amountOffCents ?? 0)
  );

  const percentOff = Number.isFinite(percentCandidate) && percentCandidate > 0
    ? Math.min(95, Math.round(percentCandidate))
    : 0;
  const amountOffCents = Number.isFinite(amountCandidate) && amountCandidate > 0
    ? Math.min(2_000_000, Math.round(amountCandidate))
    : 0;

  const allowedTiersRaw = Array.isArray(source.allowedTiers)
    ? source.allowedTiers
    : Array.isArray(source.allowed_tiers)
      ? source.allowed_tiers
      : Array.isArray(existing?.allowedTiers)
        ? existing.allowedTiers
        : [];
  const allowedTiers = [...new Set(
    allowedTiersRaw
      .map((entry) => String(entry || "").trim().toLowerCase())
      .filter((entry) => VALID_TIERS.has(entry))
  )];

  const allowedSeatsRaw = Array.isArray(source.allowedSeats)
    ? source.allowedSeats
    : Array.isArray(source.allowed_seats)
      ? source.allowed_seats
      : Array.isArray(existing?.allowedSeats)
        ? existing.allowedSeats
        : [];
  const allowedSeats = [...new Set(
    allowedSeatsRaw
      .map((entry) => Number.parseInt(String(entry), 10))
      .filter((entry) => VALID_SEATS.has(entry))
  )];

  const maxRedemptions = normalizePositiveInt(
    source.maxRedemptions ?? source.max_redemptions ?? existing?.maxRedemptions,
    null
  );
  const maxPerEmail = normalizePositiveInt(
    source.maxPerEmail ?? source.max_per_email ?? existing?.maxPerEmail,
    null
  );
  const minMonths = normalizePositiveInt(
    source.minMonths ?? source.min_months ?? existing?.minMonths,
    null
  );
  const startsAt = normalizeIsoDate(source.startsAt ?? source.starts_at ?? existing?.startsAt);
  const expiresAt = normalizeIsoDate(source.expiresAt ?? source.expires_at ?? existing?.expiresAt);
  const grantPlan = normalizeTierValue(
    source.grantPlan ?? source.grant_plan ?? existing?.grantPlan,
    null
  );
  const grantSeats = normalizeSeatValue(
    source.grantSeats ?? source.grant_seats ?? existing?.grantSeats,
    null
  );
  const grantMonths = normalizePositiveInt(
    source.grantMonths ?? source.grant_months ?? existing?.grantMonths,
    null
  );
  if (startsAt && expiresAt && Date.parse(startsAt) > Date.parse(expiresAt)) {
    throw new Error("startsAt must be before expiresAt.");
  }

  if (fulfillmentMode === "discount") {
    if (percentOff <= 0 && amountOffCents <= 0) {
      throw new Error("Offer needs either percentOff or amountOffCents.");
    }
  } else {
    if (!grantPlan || !grantSeats || !grantMonths) {
      throw new Error("Direct grant offers require grantPlan, grantSeats, and grantMonths.");
    }
  }

  const nowIso = new Date().toISOString();
  const updatedBy = clipText(source.updatedBy ?? source.updated_by ?? "", 120);
  const createdBy = clipText(source.createdBy ?? source.created_by ?? existing?.createdBy ?? updatedBy, 120);

  const active = source.active === undefined
    ? (existing?.active ?? true)
    : Boolean(source.active);

  const normalizedAllowedTiers = fulfillmentMode === "direct_grant" && allowedTiers.length === 0 && grantPlan
    ? [grantPlan]
    : allowedTiers;
  const normalizedAllowedSeats = fulfillmentMode === "direct_grant" && allowedSeats.length === 0 && grantSeats
    ? [grantSeats]
    : allowedSeats;

  return {
    code,
    kind,
    active,
    fulfillmentMode,
    percentOff: fulfillmentMode === "discount" ? percentOff : 0,
    amountOffCents: fulfillmentMode === "discount" ? amountOffCents : 0,
    grantPlan,
    grantSeats,
    grantMonths,
    maxRedemptions,
    maxPerEmail,
    minMonths,
    allowedTiers: normalizedAllowedTiers,
    allowedSeats: normalizedAllowedSeats,
    startsAt,
    expiresAt,
    ownerLabel: clipText(source.ownerLabel ?? source.owner_label ?? existing?.ownerLabel ?? "", 160) || null,
    note: clipText(source.note ?? existing?.note ?? "", 400) || null,
    createdAt: existing?.createdAt || nowIso,
    updatedAt: nowIso,
    createdBy: createdBy || null,
    updatedBy: updatedBy || null,
  };
}

function normalizeRedemption(rawRedemption, sessionId) {
  if (!rawRedemption || typeof rawRedemption !== "object") return null;
  const sid = String(sessionId || "").trim();
  if (!sid) return null;

  const processedAt = normalizeIsoDate(rawRedemption.processedAt) || normalizeIsoDate(rawRedemption.createdAt);
  if (!processedAt) return null;

  return {
    sessionId: sid,
    source: clipText(rawRedemption.source, 80) || null,
    email: clipText(rawRedemption.email, 200).toLowerCase() || null,
    code: normalizeCode(rawRedemption.code),
    kind: OFFER_KINDS.has(String(rawRedemption.kind || "").toLowerCase())
      ? String(rawRedemption.kind).toLowerCase()
      : null,
    fulfillmentMode: OFFER_FULFILLMENT_MODES.has(String(rawRedemption.fulfillmentMode || "").toLowerCase())
      ? String(rawRedemption.fulfillmentMode).toLowerCase()
      : "discount",
    referralCode: normalizeCode(rawRedemption.referralCode),
    tier: VALID_TIERS.has(String(rawRedemption.tier || "").toLowerCase())
      ? String(rawRedemption.tier).toLowerCase()
      : null,
    seats: VALID_SEATS.has(Number(rawRedemption.seats)) ? Number(rawRedemption.seats) : null,
    months: normalizePositiveInt(rawRedemption.months, null),
    grantPlan: normalizeTierValue(rawRedemption.grantPlan, null),
    grantSeats: normalizeSeatValue(rawRedemption.grantSeats, null),
    grantMonths: normalizePositiveInt(rawRedemption.grantMonths, null),
    baseAmountCents: Math.max(0, Number.parseInt(String(rawRedemption.baseAmountCents || 0), 10) || 0),
    discountCents: Math.max(0, Number.parseInt(String(rawRedemption.discountCents || 0), 10) || 0),
    finalAmountCents: Math.max(0, Number.parseInt(String(rawRedemption.finalAmountCents || 0), 10) || 0),
    processedAt,
  };
}

function normalizeStore(input) {
  const source = input && typeof input === "object" ? input : {};
  const offersRaw = source.offers && typeof source.offers === "object" ? source.offers : {};
  const redemptionsRaw = source.redemptions && typeof source.redemptions === "object" ? source.redemptions : {};

  const offers = {};
  for (const [rawCode, rawOffer] of Object.entries(offersRaw)) {
    try {
      const normalized = normalizeOffer({ ...rawOffer, code: rawCode });
      offers[normalized.code] = normalized;
    } catch {
      // ignore invalid offer
    }
  }

  const redemptions = {};
  for (const [rawSessionId, rawRedemption] of Object.entries(redemptionsRaw)) {
    const normalized = normalizeRedemption(rawRedemption, rawSessionId);
    if (!normalized) continue;
    redemptions[normalized.sessionId] = normalized;
  }

  // Keep only the newest redemption entries.
  const entries = Object.entries(redemptions);
  if (entries.length > MAX_REDEMPTIONS) {
    entries.sort((a, b) => Date.parse(b[1].processedAt || 0) - Date.parse(a[1].processedAt || 0));
    return {
      offers,
      redemptions: Object.fromEntries(entries.slice(0, MAX_REDEMPTIONS)),
    };
  }

  return { offers, redemptions };
}

function readStore(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    const stat = fs.statSync(filePath);
    if (!stat.isFile()) return null;
    const raw = fs.readFileSync(filePath, "utf8").trim();
    if (!raw) return emptyStore();
    return normalizeStore(JSON.parse(raw));
  } catch {
    return null;
  }
}

let storeCache = null;

function ensureStore() {
  if (storeCache) return storeCache;
  storeCache = readStore(STORE_FILE) || readStore(BACKUP_FILE) || emptyStore();
  return storeCache;
}

function saveStore() {
  const store = ensureStore();
  const tmpFile = `${STORE_FILE}.tmp-${process.pid}-${Date.now()}`;
  const payload = JSON.stringify(store, null, 2) + "\n";

  try {
    if (fs.existsSync(STORE_FILE)) {
      try { fs.copyFileSync(STORE_FILE, BACKUP_FILE); } catch {}
    }
    fs.writeFileSync(tmpFile, payload, "utf8");
    try {
      fs.renameSync(tmpFile, STORE_FILE);
    } catch {
      fs.writeFileSync(STORE_FILE, payload, "utf8");
    }
  } finally {
    try { if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile); } catch {}
  }
}

function countRedemptionsForOffer(store, code) {
  let count = 0;
  for (const redemption of Object.values(store.redemptions)) {
    if (normalizeCode(redemption.code) === code) count += 1;
  }
  return count;
}

function countRedemptionsForOfferAndEmail(store, code, email) {
  const normalizedEmail = String(email || "").trim().toLowerCase();
  if (!normalizedEmail) return 0;
  let count = 0;
  for (const redemption of Object.values(store.redemptions)) {
    if (normalizeCode(redemption.code) !== code) continue;
    if (String(redemption.email || "").trim().toLowerCase() === normalizedEmail) count += 1;
  }
  return count;
}

function sanitizeOfferPublic(offer) {
  if (!offer) return null;
  return {
    code: offer.code,
    kind: offer.kind,
    active: Boolean(offer.active),
    fulfillmentMode: offer.fulfillmentMode || "discount",
    percentOff: Number(offer.percentOff || 0),
    amountOffCents: Number(offer.amountOffCents || 0),
    grantPlan: offer.grantPlan || null,
    grantSeats: Number.isFinite(Number(offer.grantSeats)) ? Number(offer.grantSeats) : null,
    grantMonths: Number.isFinite(Number(offer.grantMonths)) ? Number(offer.grantMonths) : null,
    maxRedemptions: Number.isFinite(Number(offer.maxRedemptions)) ? Number(offer.maxRedemptions) : null,
    maxPerEmail: Number.isFinite(Number(offer.maxPerEmail)) ? Number(offer.maxPerEmail) : null,
    minMonths: Number.isFinite(Number(offer.minMonths)) ? Number(offer.minMonths) : null,
    allowedTiers: Array.isArray(offer.allowedTiers) ? [...offer.allowedTiers] : [],
    allowedSeats: Array.isArray(offer.allowedSeats) ? [...offer.allowedSeats] : [],
    startsAt: offer.startsAt || null,
    expiresAt: offer.expiresAt || null,
    ownerLabel: offer.ownerLabel || null,
  };
}

function sanitizeOfferAdmin(offer, redemptionStats = null) {
  if (!offer) return null;
  return {
    ...sanitizeOfferPublic(offer),
    note: offer.note || null,
    createdAt: offer.createdAt || null,
    updatedAt: offer.updatedAt || null,
    createdBy: offer.createdBy || null,
    updatedBy: offer.updatedBy || null,
    redemptions: redemptionStats || null,
  };
}

function evaluateSingleOffer(store, rawCode, context = {}, expectedKind = null) {
  const code = normalizeCode(rawCode);
  if (!code) return { ok: false, reason: "code_missing", code: null, offer: null };

  const offer = store.offers[code];
  if (!offer) return { ok: false, reason: "offer_not_found", code, offer: null };

  if (expectedKind && offer.kind !== expectedKind) {
    return { ok: false, reason: "offer_kind_mismatch", code, offer };
  }
  if (!offer.active) {
    return { ok: false, reason: "offer_inactive", code, offer };
  }

  const nowMs = Number.isFinite(context.nowMs) ? context.nowMs : Date.now();
  const startsAtMs = offer.startsAt ? Date.parse(offer.startsAt) : NaN;
  const expiresAtMs = offer.expiresAt ? Date.parse(offer.expiresAt) : NaN;
  if (Number.isFinite(startsAtMs) && nowMs < startsAtMs) {
    return { ok: false, reason: "offer_not_started", code, offer };
  }
  if (Number.isFinite(expiresAtMs) && nowMs > expiresAtMs) {
    return { ok: false, reason: "offer_expired", code, offer };
  }

  const tier = String(context.tier || "").trim().toLowerCase();
  if (offer.allowedTiers?.length && !offer.allowedTiers.includes(tier)) {
    return { ok: false, reason: "offer_tier_mismatch", code, offer };
  }

  const seats = Number(context.seats);
  if (offer.allowedSeats?.length && !offer.allowedSeats.includes(seats)) {
    return { ok: false, reason: "offer_seat_mismatch", code, offer };
  }

  const months = Number(context.months);
  if (Number.isFinite(offer.minMonths) && offer.minMonths > 0 && months < offer.minMonths) {
    return { ok: false, reason: "offer_months_mismatch", code, offer };
  }

  if (Number.isFinite(offer.maxRedemptions) && offer.maxRedemptions > 0) {
    const count = countRedemptionsForOffer(store, code);
    if (count >= offer.maxRedemptions) {
      return { ok: false, reason: "offer_maxed_out", code, offer };
    }
  }

  const email = String(context.email || "").trim().toLowerCase();
  if (email && Number.isFinite(offer.maxPerEmail) && offer.maxPerEmail > 0) {
    const perEmailCount = countRedemptionsForOfferAndEmail(store, code, email);
    if (perEmailCount >= offer.maxPerEmail) {
      return { ok: false, reason: "offer_email_limit_reached", code, offer };
    }
  }

  if (offer.fulfillmentMode === "direct_grant") {
    return {
      ok: true,
      code,
      offer,
      fulfillmentMode: "direct_grant",
      discountCents: 0,
      percentOff: 0,
      amountOffCents: 0,
      grant: {
        plan: offer.grantPlan,
        seats: offer.grantSeats,
        months: offer.grantMonths,
      },
    };
  }

  const baseAmountCents = Math.max(0, Number.parseInt(String(context.baseAmountCents || 0), 10) || 0);
  if (baseAmountCents <= 0) {
    return { ok: false, reason: "invalid_base_amount", code, offer };
  }

  let discountCents = 0;
  if (offer.percentOff > 0) {
    discountCents = Math.round((baseAmountCents * offer.percentOff) / 100);
  } else if (offer.amountOffCents > 0) {
    discountCents = offer.amountOffCents;
  }

  discountCents = Math.max(0, Math.min(baseAmountCents, discountCents));
  if (discountCents <= 0) {
    return { ok: false, reason: "invalid_discount", code, offer };
  }

  return {
    ok: true,
    code,
    offer,
    discountCents,
    percentOff: offer.percentOff || 0,
    amountOffCents: offer.amountOffCents || 0,
  };
}

function capDiscountForStripeMinimum(baseAmountCents, discountCents) {
  const base = Math.max(0, Number.parseInt(String(baseAmountCents || 0), 10) || 0);
  const discount = Math.max(0, Number.parseInt(String(discountCents || 0), 10) || 0);
  if (base <= 0) return 0;
  // Stripe card payments generally require at least 0.50 EUR.
  const minChargeCents = 50;
  const maxDiscount = Math.max(0, base - minChargeCents);
  return Math.max(0, Math.min(discount, maxDiscount));
}

export function getOffer(code) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return null;
  const store = ensureStore();
  const offer = store.offers[normalizedCode];
  return offer ? sanitizeOfferPublic(offer) : null;
}

export function listOffers(options = {}) {
  const includeInactive = options.includeInactive !== false;
  const includeStats = options.includeStats === true;
  const store = ensureStore();
  const list = [];

  for (const offer of Object.values(store.offers)) {
    if (!includeInactive && !offer.active) continue;
    let stats = null;
    if (includeStats) {
      stats = {
        total: countRedemptionsForOffer(store, offer.code),
      };
    }
    list.push(sanitizeOfferAdmin(offer, stats));
  }

  list.sort((a, b) => String(a.code || "").localeCompare(String(b.code || "")));
  return list;
}

export function upsertOffer(input, options = {}) {
  const store = ensureStore();
  const rawCode = normalizeCode(input?.code);
  if (!rawCode) throw new Error("code is required.");

  const existing = store.offers[rawCode] || null;
  const mergedInput = options.partial && existing
    ? { ...existing, ...input, code: rawCode }
    : { ...input, code: rawCode };
  const normalized = normalizeOffer(mergedInput, existing);

  store.offers[rawCode] = normalized;
  saveStore();
  return sanitizeOfferAdmin(normalized, {
    total: countRedemptionsForOffer(store, rawCode),
  });
}

export function setOfferActive(code, active) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return null;
  const store = ensureStore();
  const existing = store.offers[normalizedCode];
  if (!existing) return null;

  existing.active = Boolean(active);
  existing.updatedAt = new Date().toISOString();
  saveStore();
  return sanitizeOfferAdmin(existing, {
    total: countRedemptionsForOffer(store, normalizedCode),
  });
}

export function deleteOffer(code) {
  const normalizedCode = normalizeCode(code);
  if (!normalizedCode) return false;
  const store = ensureStore();
  if (!store.offers[normalizedCode]) return false;
  delete store.offers[normalizedCode];
  saveStore();
  return true;
}

export function previewCheckoutOffer(context = {}) {
  const store = ensureStore();
  const baseAmountCents = Math.max(0, Number.parseInt(String(context.baseAmountCents || 0), 10) || 0);
  const checkoutContext = {
    baseAmountCents,
    tier: String(context.tier || "").trim().toLowerCase(),
    seats: Number(context.seats),
    months: Number(context.months),
    email: String(context.email || "").trim().toLowerCase(),
    nowMs: Number.isFinite(context.nowMs) ? Number(context.nowMs) : Date.now(),
  };

  const couponResult = evaluateSingleOffer(store, context.couponCode, checkoutContext, "coupon");
  const referralResult = evaluateSingleOffer(store, context.referralCode, checkoutContext, "referral");

  let applied = null;
  if (couponResult.ok) {
    applied = { ...couponResult, kind: "coupon" };
  } else if (referralResult.ok) {
    applied = { ...referralResult, kind: "referral" };
  }

  let discountCents = applied?.discountCents || 0;
  if (applied?.fulfillmentMode === "direct_grant") {
    discountCents = baseAmountCents;
  } else {
    discountCents = capDiscountForStripeMinimum(baseAmountCents, discountCents);
  }

  const finalAmountCents = applied?.fulfillmentMode === "direct_grant"
    ? 0
    : Math.max(0, baseAmountCents - discountCents);
  const attributionReferralCode = referralResult.ok ? referralResult.code : null;

  return {
    baseAmountCents,
    finalAmountCents,
    discountCents,
    requiresStripe: !(applied?.fulfillmentMode === "direct_grant"),
    applied: applied
      ? {
        code: applied.code,
        kind: applied.kind,
        fulfillmentMode: applied.fulfillmentMode || "discount",
        percentOff: applied.percentOff || 0,
        amountOffCents: applied.amountOffCents || 0,
        grantPlan: applied.grant?.plan || applied.offer?.grantPlan || null,
        grantSeats: applied.grant?.seats || applied.offer?.grantSeats || null,
        grantMonths: applied.grant?.months || applied.offer?.grantMonths || null,
        ownerLabel: applied.offer?.ownerLabel || null,
      }
      : null,
    coupon: {
      code: couponResult.code,
      ok: couponResult.ok,
      reason: couponResult.ok ? null : couponResult.reason,
    },
    referral: {
      code: referralResult.code,
      ok: referralResult.ok,
      reason: referralResult.ok ? null : referralResult.reason,
      ownerLabel: referralResult.offer?.ownerLabel || null,
    },
    attributionReferralCode,
  };
}

export function getRedemptionBySession(sessionId) {
  const sid = String(sessionId || "").trim();
  if (!sid) return null;
  const store = ensureStore();
  return store.redemptions[sid] ? { ...store.redemptions[sid] } : null;
}

export function markOfferRedemption(sessionId, payload = {}) {
  const sid = String(sessionId || "").trim();
  if (!sid) return null;

  const store = ensureStore();
  if (store.redemptions[sid]) return { ...store.redemptions[sid] };

  const normalized = normalizeRedemption({
    ...payload,
    processedAt: new Date().toISOString(),
  }, sid);
  if (!normalized) return null;

  store.redemptions[sid] = normalized;
  saveStore();
  return { ...normalized };
}

export function listRecentRedemptions(limit = 100) {
  const max = Math.max(1, Math.min(500, Number.parseInt(String(limit), 10) || 100));
  const store = ensureStore();
  return Object.values(store.redemptions)
    .sort((a, b) => Date.parse(b.processedAt || 0) - Date.parse(a.processedAt || 0))
    .slice(0, max)
    .map((entry) => ({ ...entry }));
}

export function normalizeOfferCode(rawCode) {
  return normalizeCode(rawCode);
}
