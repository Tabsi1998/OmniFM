// What the dashboard may show per plan: from the bot's plan file (#413), so
// the locks here and the checks in the API never differ.
import { PLAN_CAPABILITIES } from '../../../src/config/plan-features.js';

const CAPABILITY_ENTRIES = Object.values(PLAN_CAPABILITIES);

export const DASHBOARD_CAPABILITY_DEFAULTS = Object.freeze(
  Object.fromEntries(CAPABILITY_ENTRIES.map((entry) => [entry.apiKey, false])),
);

export const DASHBOARD_CAPABILITY_REQUIRED_TIERS = Object.freeze(
  Object.fromEntries(CAPABILITY_ENTRIES.map((entry) => [entry.apiKey, entry.minPlan])),
);

const DASHBOARD_CAPABILITY_LABELS = Object.freeze(
  Object.fromEntries(CAPABILITY_ENTRIES.map((entry) => [entry.apiKey, { de: entry.de, en: entry.en }])),
);

export function getDashboardCapabilityRequiredTier(capabilityKey) {
  return DASHBOARD_CAPABILITY_REQUIRED_TIERS[String(capabilityKey || '').trim()] || null;
}

export function getDashboardCapabilityLabel(capabilityKey, t) {
  const key = String(capabilityKey || '').trim();
  const entry = DASHBOARD_CAPABILITY_LABELS[key];
  if (entry) {
    return t(entry.de, entry.en);
  }
  return key;
}

export function getDashboardBlockedFeatureLabels(featureKeys, t, limit = Infinity) {
  const labels = [];
  const seen = new Set();
  const safeLimit = Number.isFinite(limit) ? Math.max(1, Number(limit) || 1) : Infinity;

  for (const rawKey of Array.isArray(featureKeys) ? featureKeys : []) {
    const key = String(rawKey || '').trim();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    labels.push(getDashboardCapabilityLabel(key, t));
    if (labels.length >= safeLimit) break;
  }

  return labels;
}

export function normalizeDashboardCapabilityPayload(payload) {
  if (!payload || typeof payload !== 'object') {
    return {
      serverId: '',
      tier: 'free',
      capabilities: { ...DASHBOARD_CAPABILITY_DEFAULTS },
      limits: {},
      upgradeHints: { nextTier: null, blockedFeatures: [] },
    };
  }

  return {
    serverId: String(payload.serverId || ''),
    tier: String(payload.tier || 'free'),
    capabilities: {
      ...DASHBOARD_CAPABILITY_DEFAULTS,
      ...(payload.capabilities && typeof payload.capabilities === 'object' ? payload.capabilities : {}),
    },
    limits: payload.limits && typeof payload.limits === 'object' ? payload.limits : {},
    upgradeHints: payload.upgradeHints && typeof payload.upgradeHints === 'object'
      ? {
        nextTier: payload.upgradeHints.nextTier || null,
        blockedFeatures: Array.isArray(payload.upgradeHints.blockedFeatures) ? payload.upgradeHints.blockedFeatures : [],
      }
      : { nextTier: null, blockedFeatures: [] },
  };
}
