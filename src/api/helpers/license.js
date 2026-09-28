// OmniFM API: license, plan and capability payloads of the server dashboard.
// Split out of src/api/server.js (#293).
import {
  isValidEmailAddress,
  calculatePrice,
  calculateUpgradePrice,
  isProTrialEnabled,
  PRO_TRIAL_MONTHS,
} from "../../lib/helpers.js";
import { toPublicDashboardExportsWebhookConfig } from "../../lib/dashboard-webhooks.js";
import {
  DEFAULT_DASHBOARD_INCIDENT_ALERTS_CONFIG,
  normalizeDashboardIncidentAlertsConfig,
} from "../../lib/dashboard-incident-alerts.js";
import { customStationLogoUrl } from "../../custom-stations.js";
import {
  getTier,
  getServerPlanConfig,
  getServerCapabilities,
  getPlanLimits,
  getServerSeats,
  serverHasCapability,
  buildUpgradeHints,
} from "../../core/entitlements.js";
import {
  getServerLicense,
  listProcessedSessionsByEmail,
  getTrialClaimByEmail,
} from "../../premium-store.js";
import { getRedemptionBySession } from "../../coupon-store.js";
import { CAPABILITY_KEYS } from "../../config/plans.js";

export function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

export function getLicense(guildId) {
  return getServerLicense(guildId);
}

export function maskDashboardEmail(rawEmail) {
  const email = String(rawEmail || "").trim().toLowerCase();
  if (!isValidEmailAddress(email)) return "";
  const [localPart = "", domain = ""] = email.split("@");
  const visible = localPart.slice(0, Math.min(2, localPart.length));
  const maskedLocal = localPart.length > 2 ? `${visible}***` : `${visible}***`;
  return `${maskedLocal}@${domain}`;
}

function buildDashboardUpgradePreview(currentLicense, targetTier, seatCount) {
  const normalizedTier = String(targetTier || "").trim().toLowerCase();
  if (!["pro", "ultimate"].includes(normalizedTier)) return null;

  const seats = Math.max(1, Number(seatCount || 1) || 1);
  const targetLimits = getPlanLimits(normalizedTier);
  const upgradeCost = currentLicense ? calculateUpgradePrice(currentLicense, normalizedTier) : null;

  return {
    tier: normalizedTier,
    tierName: normalizedTier === "ultimate" ? "Ultimate" : "Pro",
    seats,
    limits: targetLimits,
    pricing: {
      monthlyCents: calculatePrice(normalizedTier, 1, seats),
      quarterlyCents: calculatePrice(normalizedTier, 3, seats),
      yearlyCents: calculatePrice(normalizedTier, 12, seats),
    },
    upgradeCostCents: Number(upgradeCost?.upgradeCost || 0) || 0,
    daysLeft: Number(upgradeCost?.daysLeft || 0) || 0,
  };
}

function getDashboardTierName(tier) {
  const normalizedTier = String(tier || "free").trim().toLowerCase();
  if (normalizedTier === "ultimate") return "Ultimate";
  if (normalizedTier === "pro") return "Pro";
  return "Free";
}

export function buildDashboardLicensePayload(guildInfo) {
  const license = getLicense(guildInfo.id);
  const capabilityPayload = buildServerCapabilityPayload(guildInfo.id);
  const effectiveTier = String(license?.plan || guildInfo.tier || "free").trim().toLowerCase();
  const currentLimits = getPlanLimits(effectiveTier);
  const seats = Math.max(1, Number(license?.seats || capabilityPayload?.limits?.seats || 1) || 1);
  const nextUpgradeTier = String(capabilityPayload?.upgradeHints?.nextTier || "").trim().toLowerCase();
  const licenseEmail = String(license?.contactEmail || license?.email || "").trim().toLowerCase();
  const hasBillingEmail = isValidEmailAddress(licenseEmail);
  const linkedServers = Array.isArray(license?.linkedServerIds) ? license.linkedServerIds : [];

  return {
    serverId: guildInfo.id,
    tier: guildInfo.tier,
    effectiveTier,
    tierName: getDashboardTierName(effectiveTier),
    capabilities: capabilityPayload.capabilities,
    limits: capabilityPayload.limits,
    upgradeHints: capabilityPayload.upgradeHints,
    dashboardEnabled: capabilityPayload.capabilities.dashboardAccess === true,
    ultimateEnabled: capabilityPayload.capabilities.advancedAnalytics === true
      || capabilityPayload.capabilities.customStationUrls === true
      || capabilityPayload.capabilities.failoverRules === true,
    currentPlan: {
      tier: effectiveTier,
      tierName: effectiveTier === "ultimate" ? "Ultimate" : effectiveTier === "pro" ? "Pro" : "Free",
      limits: currentLimits,
      pricing: effectiveTier === "free"
        ? null
        : {
          monthlyCents: calculatePrice(effectiveTier, 1, seats),
          quarterlyCents: calculatePrice(effectiveTier, 3, seats),
          yearlyCents: calculatePrice(effectiveTier, 12, seats),
        },
    },
    recommendedUpgrade: nextUpgradeTier
      ? buildDashboardUpgradePreview(license, nextUpgradeTier, seats)
      : null,
    promotions: {
      couponCodesSupported: true,
      directGrantCodesSupported: true,
      proTrialEnabled: isProTrialEnabled(),
      proTrialMonths: PRO_TRIAL_MONTHS,
      trialOnlyForNewCustomers: true,
    },
    activity: buildDashboardLicenseActivity(license),
    license: license ? {
      plan: license.plan || license.tier || "free",
      seats,
      seatsUsed: linkedServers.length,
      seatsAvailable: Math.max(0, seats - linkedServers.length),
      active: Boolean(license.active) && !license.expired,
      expired: Boolean(license.expired),
      expiresAt: license.expiresAt || null,
      remainingDays: Number.isFinite(license.remainingDays) ? license.remainingDays : 0,
      billingPeriod: license.billingPeriod || "monthly",
      durationMonths: license.durationMonths || null,
      emailMasked: maskDashboardEmail(licenseEmail),
      hasBillingEmail,
      canUpdateEmail: true,
      updatedAt: license.updatedAt || null,
      contactEmailDomain: hasBillingEmail ? licenseEmail.split("@")[1] : "",
    } : null,
  };
}

function buildDashboardLicenseActivity(license) {
  const licenseEmail = String(license?.contactEmail || license?.email || "").trim().toLowerCase();
  const hasBillingEmail = isValidEmailAddress(licenseEmail);
  if (!hasBillingEmail) {
    return {
      replayProtection: {
        enabled: true,
        recentSessionCount: 0,
        lastProcessedAt: null,
        lastSessionId: null,
      },
      recentSessions: [],
      trial: null,
    };
  }

  const recentSessions = listProcessedSessionsByEmail(licenseEmail, 5);
  const trialClaim = getTrialClaimByEmail(licenseEmail);
  const mappedSessions = recentSessions.map((entry) => {
    const redemption = getRedemptionBySession(entry.sessionId);
    const tier = String(entry.tier || license?.plan || "free").trim().toLowerCase();
    return {
      sessionId: entry.sessionId,
      processedAt: entry.processedAt || null,
      source: entry.source || null,
      tier,
      tierName: tier === "ultimate" ? "Ultimate" : tier === "pro" ? "Pro" : "Free",
      seats: Number(entry.seats || license?.seats || 1) || 1,
      months: Number(entry.months || 1) || 1,
      expiresAt: entry.expiresAt || null,
      created: Boolean(entry.created),
      renewed: Boolean(entry.renewed),
      upgraded: Boolean(entry.upgraded),
      replayProtected: entry.replayProtected !== false,
      amountPaidCents: Math.max(0, Number(entry.amountPaidCents || entry.finalAmountCents || 0) || 0),
      baseAmountCents: Math.max(0, Number(entry.baseAmountCents || 0) || 0),
      discountCents: Math.max(0, Number(entry.discountCents || 0) || 0),
      finalAmountCents: Math.max(0, Number(entry.finalAmountCents || entry.amountPaidCents || 0) || 0),
      appliedOfferCode: String(entry.appliedOfferCode || redemption?.code || "").trim().toUpperCase(),
      appliedOfferKind: String(entry.appliedOfferKind || redemption?.kind || "").trim().toLowerCase(),
      referralCode: String(entry.referralCode || redemption?.referralCode || "").trim().toUpperCase(),
    };
  });
  const latestSession = mappedSessions[0] || null;

  return {
    replayProtection: {
      enabled: true,
      recentSessionCount: mappedSessions.length,
      lastProcessedAt: latestSession?.processedAt || null,
      lastSessionId: latestSession?.sessionId || null,
    },
    recentSessions: mappedSessions,
    trial: trialClaim ? {
      status: trialClaim.status || null,
      source: trialClaim.source || null,
      claimedAt: trialClaim.claimedAt || null,
      createdAt: trialClaim.createdAt || null,
      expiresAt: trialClaim.expiresAt || null,
      licenseId: trialClaim.licenseId || null,
      months: Number(trialClaim.months || 0) || 0,
      seats: Number(trialClaim.seats || 0) || 0,
    } : null,
  };
}

export function buildDashboardSessionHistoryEntryId(session = {}) {
  return JSON.stringify([
    String(session?.startedAt || ""),
    String(session?.stationKey || ""),
    String(session?.channelId || ""),
    Math.max(0, Number(session?.durationMs || 0) || 0),
    Math.max(0, Number(session?.humanListeningMs || 0) || 0),
    Math.max(0, Number(session?.peakListeners || 0) || 0),
    Math.max(0, Number(session?.avgListeners || 0) || 0),
  ]);
}

export function buildDashboardConnectionEventEntryId(event = {}) {
  return JSON.stringify([
    String(event?.timestamp || ""),
    String(event?.botId || ""),
    String(event?.eventType || ""),
    String(event?.channelId || ""),
    String(event?.details || ""),
  ]);
}

function getBlockedCapabilitiesForServer(serverId) {
  return CAPABILITY_KEYS.filter((capabilityKey) => !serverHasCapability(serverId, capabilityKey));
}

export function buildServerCapabilityPayload(serverId) {
  const guildId = String(serverId || "").trim();
  const tier = getTier(guildId);
  const limits = getPlanLimits(tier);
  return {
    serverId: guildId,
    tier,
    capabilities: getServerCapabilities(guildId, { apiShape: true }),
    limits: {
      ...limits,
      seats: getServerSeats(guildId),
    },
    upgradeHints: buildUpgradeHints(tier, getBlockedCapabilitiesForServer(guildId)),
  };
}

export function mapDashboardCustomStation(key, station, guildId = null) {
  return {
    key,
    name: station?.name || key,
    url: station?.url || "",
    genre: station?.genre || "",
    folder: station?.folder || "",
    tags: Array.isArray(station?.tags) ? station.tags : [],
    logoUrl: guildId ? customStationLogoUrl(guildId, key, station) : null,
    custom: true,
  };
}

export function buildDashboardExportsWebhookResponse(rawConfig) {
  return toPublicDashboardExportsWebhookConfig(rawConfig);
}

export function buildDashboardIncidentAlertsResponse(rawConfig) {
  return normalizeDashboardIncidentAlertsConfig(
    rawConfig && typeof rawConfig === "object"
      ? rawConfig
      : DEFAULT_DASHBOARD_INCIDENT_ALERTS_CONFIG
  );
}
