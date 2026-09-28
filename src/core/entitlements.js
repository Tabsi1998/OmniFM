// ============================================================
// OmniFM - Entitlements (Centralized Permission Checks)
// ============================================================

import {
  PLANS,
  PLAN_ORDER,
  BRAND,
  CAPABILITIES,
  CAPABILITY_KEYS,
  CAPABILITY_API_KEYS,
  CAPABILITY_LABELS,
} from "../config/plans.js";
import { planLimits } from "../config/plan-features.js";

// --- License storage interface (injected) ---
let _getLicenseForServer = null;

export function setLicenseProvider(fn) {
  _getLicenseForServer = fn;
}

// --- Plan helpers ---

export function comparePlans(a, b) {
  const ia = PLAN_ORDER.indexOf(a);
  const ib = PLAN_ORDER.indexOf(b);
  if (ia < ib) return -1;
  if (ia > ib) return 1;
  return 0;
}

export function planAtLeast(current, minimum) {
  return comparePlans(current, minimum) >= 0;
}

export function getServerPlan(serverId) {
  if (!_getLicenseForServer) return "free";
  const license = _getLicenseForServer(String(serverId));
  if (!license || !license.active) return "free";
  const plan = String(license.plan || license.tier || "free").toLowerCase();
  return PLANS[plan] ? plan : "free";
}

export function getServerPlanConfig(serverId) {
  const plan = getServerPlan(serverId);
  return { plan, ...PLANS[plan] };
}

export function getServerSeats(serverId) {
  if (!_getLicenseForServer) return 0;
  const license = _getLicenseForServer(String(serverId));
  if (!license || !license.active) return 0;
  return Math.max(1, Number(license.seats || 1) || 1);
}

function normalizePlanId(planId) {
  return PLANS[planId] ? planId : "free";
}

function mapCapabilities(planId, { apiShape = false } = {}) {
  const plan = PLANS[normalizePlanId(planId)] || PLANS.free;
  const out = {};
  for (const capabilityKey of CAPABILITY_KEYS) {
    const targetKey = apiShape ? CAPABILITY_API_KEYS[capabilityKey] : capabilityKey;
    out[targetKey] = !!plan.capabilities?.[capabilityKey];
  }
  return out;
}

export function hasCapability(planId, capabilityKey) {
  const plan = PLANS[normalizePlanId(planId)];
  if (!plan) return false;
  return !!plan.capabilities?.[capabilityKey];
}

export function serverHasCapability(serverId, capabilityKey) {
  return hasCapability(getServerPlan(serverId), capabilityKey);
}

export function getPlanCapabilities(planId, options = {}) {
  return mapCapabilities(planId, options);
}

export function getServerCapabilities(serverId, options = {}) {
  return mapCapabilities(getServerPlan(serverId), options);
}

/** The numbers of a plan (#413): voice channels, audio, favourites, events (null = no limit), ... */
export function getPlanLimits(planId) {
  return { ...planLimits(normalizePlanId(planId)) };
}

export function getServerPlanLimits(serverId) {
  return getPlanLimits(getServerPlan(serverId));
}

/** One number of the server's plan; null is no limit (#413). */
export function getServerLimit(serverId, key) {
  const value = getServerPlanLimits(serverId)[key];
  return value === undefined ? null : value;
}

export function getCapabilityRequirementPlan(capabilityKey) {
  const declared = CAPABILITIES?.[capabilityKey]?.minPlan;
  if (declared && PLANS[declared]) return declared;
  return PLAN_ORDER.find((planId) => hasCapability(planId, capabilityKey)) || "pro";
}

function getNextPlan(planId) {
  const index = PLAN_ORDER.indexOf(normalizePlanId(planId));
  if (index < 0 || index >= PLAN_ORDER.length - 1) return null;
  return PLAN_ORDER[index + 1];
}

export function buildUpgradeHints(planId, blockedCapabilities = []) {
  const normalizedPlan = normalizePlanId(planId);
  const nextTier = getNextPlan(normalizedPlan);
  const filtered = [...new Set((Array.isArray(blockedCapabilities) ? blockedCapabilities : []).filter(Boolean))];
  return {
    nextTier,
    blockedFeatures: filtered.map((capabilityKey) => CAPABILITY_API_KEYS[capabilityKey] || capabilityKey),
  };
}

// --- Requirement checks (return { ok, message } instead of throwing) ---

export function requirePlan(serverId, minimumPlan) {
  const current = getServerPlan(serverId);
  if (planAtLeast(current, minimumPlan)) {
    return { ok: true };
  }
  const minConfig = PLANS[minimumPlan];
  return {
    ok: false,
    currentPlan: current,
    requiredPlan: minimumPlan,
    message: `This feature requires ${BRAND.name} **${minConfig.name}** or higher. Your server is on the **${PLANS[current].name}** plan.`,
  };
}

export function requireCapability(serverId, capabilityKey) {
  const plan = getServerPlan(serverId);
  if (hasCapability(plan, capabilityKey)) {
    return { ok: true };
  }
  const requiredPlan = getCapabilityRequirementPlan(capabilityKey);
  const label = CAPABILITY_LABELS[capabilityKey] || capabilityKey;
  return {
    ok: false,
    currentPlan: plan,
    requiredPlan,
    capabilityKey,
    message: `**${label}** requires ${BRAND.name} **${PLANS[requiredPlan].name}** or higher.`,
  };
}

// --- Bitrate enforcement ---

export function getMaxBitrate(serverId) {
  const plan = getServerPlan(serverId);
  return PLANS[plan].bitrateNum;
}

export function getBitrateFlag(serverId) {
  return PLANS[getServerPlan(serverId)].bitrate;
}

// --- Reconnect policy ---

export function getReconnectDelay(serverId) {
  const plan = getServerPlan(serverId);
  return PLANS[plan].reconnectMs;
}

// --- Bot limit ---

export function getMaxBots(serverId) {
  const plan = getServerPlan(serverId);
  return PLANS[plan].maxBots;
}

export function isBotAllowed(serverId, botIndex) {
  return botIndex <= getMaxBots(serverId);
}

// Aliases for backward compatibility
export const getTier = getServerPlan;
