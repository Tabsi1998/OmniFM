// OmniFM: premium: processed checkout sessions and events, trial claims.
// Split out of src/premium-store.js (#295).
import { TRIAL_RESERVATION_STALE_MS, load, save } from "../premium-store.js";
import { normalizeContactEmail } from "./licenses.js";

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
