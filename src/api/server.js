// ============================================================
// OmniFM: Web Server & API Routes
// ============================================================
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { ChannelType, PermissionFlagsBits } from "discord.js";
import { createDashboardChannelsRouteHandler } from "./routes/dashboard-channels.js";
import { createAuthRoutesHandler } from "./routes/auth-routes.js";
import { createDashboardCustomStationsRouteHandler } from "./routes/dashboard-custom-stations.js";
import { createDashboardAccessRouteHandler } from "./routes/dashboard-access.js";
import { createDashboardEmojisRouteHandler } from "./routes/dashboard-emojis.js";
import { createDashboardEventsRouteHandler } from "./routes/dashboard-events.js";
import { createDashboardExportsRouteHandler } from "./routes/dashboard-exports.js";
import { createDashboardLicenseRouteHandler } from "./routes/dashboard-license.js";
import { createDashboardPermsRouteHandler } from "./routes/dashboard-perms.js";
import { createDashboardRolesRouteHandler } from "./routes/dashboard-roles.js";
import { createDashboardSettingsDigestRouteHandler } from "./routes/dashboard-settings-digest.js";
import { createDashboardSettingsRouteHandler } from "./routes/dashboard-settings.js";
import { createDashboardStationsRouteHandler } from "./routes/dashboard-stations.js";
import { createDashboardStatsRouteHandler } from "./routes/dashboard-stats.js";
import { createDashboardTelemetryRouteHandler } from "./routes/dashboard-telemetry.js";
import { createBotsGGRoutesHandler } from "./routes/botsgg-routes.js";
import { createDiscordBotListRoutesHandler } from "./routes/discordbotlist-routes.js";
import { createTopGGRoutesHandler } from "./routes/topgg-routes.js";
import { createVoteEventsRoutesHandler } from "./routes/vote-events-routes.js";
import { createPremiumBillingRoutesHandler } from "./routes/premium-billing-routes.js";
import { createPremiumOffersRoutesHandler } from "./routes/premium-offers-routes.js";
import { createPremiumReadRoutesHandler } from "./routes/premium-read-routes.js";
import { createPublicRoutesHandler } from "./routes/public-routes.js";
import { createAdminRoutesHandler } from "./routes/admin-routes.js";
import {
  isRuntimePlaybackActive,
  isRuntimeVoiceConnected,
} from "../bot/runtime-live-state.js";

import { log, webDir, webRootSource, frontendBuildStamp, rootDir } from "../lib/logging.js";
import { buildReleaseInfo } from "../lib/release-info.js";
import {
  TIERS,
  TIER_RANK,
  clipText,
  normalizeDuration,
  normalizeSeats,
  isValidEmailAddress,
  calculatePrice,
  calculateUpgradePrice,
  durationPricingInEuro,
  seatPricingInEuro,
  sanitizeOfferCode,
  translateOfferReason,
  isProTrialEnabled,
  PRO_TRIAL_MONTHS,
  DURATION_OPTIONS,
  SEAT_OPTIONS,
  getPricePerMonthCents,
} from "../lib/helpers.js";
import { normalizeLanguage, getDefaultLanguage, resolveLanguageFromAcceptLanguage } from "../i18n.js";
import {
  languagePick,
  translateCustomStationErrorMessage,
  translatePermissionStoreMessage,
  translateScheduledEventStoreMessage,
} from "../lib/language.js";
import { resolveRequestLanguage } from "../lib/request-language.js";
import {
  EVENT_FALLBACK_TIME_ZONE,
  buildEventDateTimeFromParts,
  getZonedPartsFromUtcMs,
  normalizeEventTimeZone,
  normalizeRepeatMode,
  getRepeatLabel,
  isWorkdayInTimeZone,
  computeNextEventRunAtMs,
} from "../lib/event-time.js";
import {
  getCommonSecurityHeaders,
  sendJson,
  methodNotAllowed,
  sendStaticFile,
  applyCors,
  getAdminApiToken,
  isAdminApiRequest,
  sanitizeLicenseForApi,
  API_COMMANDS,
  getBotAccessForTier,
  resolveRuntimeClientId,
  buildInviteUrlForRuntime,
  resolvePublicWebsiteUrl,
  buildInviteOverviewForTier,
  getStripeSecretKey,
  resolveCheckoutReturnBase,
  getConfiguredPublicOrigin,
  isAllowedFrontendOrigin,
  toOrigin,
  enforceApiRateLimit,
  getClientIp,
} from "../lib/api-helpers.js";
import {
  buildWeeklyDigestEmbedData,
  buildWeeklyDigestMeta,
  buildWeeklyDigestPreview,
  normalizeWeeklyDigestConfig,
} from "../lib/weekly-digest.js";
import {
  DEFAULT_DASHBOARD_EXPORTS_WEBHOOK_CONFIG,
  normalizeDashboardExportsWebhookConfig,
  validateDashboardExportsWebhookConfig,
  shouldDeliverDashboardWebhook,
  buildDashboardWebhookPayload,
  deliverDashboardWebhook,
} from "../lib/dashboard-webhooks.js";
import {
  DEFAULT_DASHBOARD_INCIDENT_ALERTS_CONFIG,
  normalizeDashboardIncidentAlertsConfig,
  validateDashboardIncidentAlertsConfig,
} from "../lib/dashboard-incident-alerts.js";
import {
  buildResolvedVoiceGuardConfig,
  validateVoiceGuardSettings,
} from "../lib/voice-guard.js";
import {
  getPrimaryFailoverStation,
  normalizeFailoverChain,
} from "../lib/failover-chain.js";
import { loadStations, filterStationsByTier } from "../stations-store.js";
import { buildPublicStationCatalog } from "../lib/public-stations.js";
import {
  getGuildStations as getCustomStations,
  addGuildStation as addCustomStation,
  updateGuildStation as updateCustomStation,
  removeGuildStation as removeCustomStation,
} from "../custom-stations.js";
import {
  getTier,
  checkFeatureAccess,
  getServerPlanConfig,
  getServerCapabilities,
  getPlanLimits,
  getServerSeats,
  serverHasCapability,
  buildUpgradeHints,
} from "../core/entitlements.js";
import {
  getServerLicense,
  getLicenseById,
  linkServerToLicense,
  unlinkServerFromLicense,
  listLicensesByContactEmail,
  listProcessedSessionsByEmail,
  updateLicenseContactEmail,
  isSessionProcessed,
  isEventProcessed,
  markEventProcessed,
  getTrialClaimByEmail,
} from "../premium-store.js";
import {
  resolveCheckoutOfferForRequest,
  activateOfferGrant,
  activatePaidStripeSession,
  activateProTrial,
} from "../services/payment.js";
import {
  listOffers,
  upsertOffer,
  deleteOffer,
  setOfferActive,
  listRecentRedemptions,
  getOffer,
  getRedemptionBySession,
} from "../coupon-store.js";
import { PLANS, BRAND, CAPABILITY_KEYS } from "../config/plans.js";
import {
  getDashboardTelemetry,
  setDashboardTelemetry,
  setDashboardOauthState,
  popDashboardOauthState,
  setDashboardAuthSession,
  getDashboardAuthSession,
  deleteDashboardAuthSession,
  cleanupDashboardAuthState,
} from "../dashboard-store.js";
import { getDb } from "../lib/db.js";
import {
  getSupportedPermissionCommands,
  getGuildCommandPermissionRules,
  setCommandRolePermission,
  resetCommandPermissions,
} from "../command-permissions-store.js";
import {
  listScheduledEvents,
  createScheduledEvent,
  patchScheduledEvent,
  deleteScheduledEvent,
  getScheduledEvent,
} from "../scheduled-events-store.js";
import {
  getGuildListeningStats,
  getGuildDailyStats,
  getGuildSessionHistory,
  getGuildConnectionHealth,
  getGuildListenerTimeline,
  getGlobalStats,
  getActiveSessionsForGuild,
  resetGuildStats,
} from "../listening-stats-store.js";
import { getRecentRuntimeIncidents, acknowledgeRuntimeIncident } from "../runtime-incidents-store.js";
import {
  fetchBotsGGPublicBotSummary,
  getBotsGGStatus,
  syncBotsGGStats,
} from "../services/botsgg.js";
import {
  fetchDiscordBotListPublicBotSummary,
  getDiscordBotListStatus,
  handleDiscordBotListVoteWebhook,
  syncDiscordBotListCommands,
  syncDiscordBotListStats,
  syncDiscordBotListVotes,
} from "../services/discordbotlist.js";
import {
  fetchTopGGProjectSummary,
  fetchTopGGVoteStatus,
  getTopGGStatus,
  handleTopGGWebhook,
  syncTopGGCommands,
  syncTopGGProject,
  syncTopGGStats,
  syncTopGGVotes,
} from "../services/topgg.js";
import { getVoteEventsState } from "../vote-events-store.js";
import { listLicenses, patchLicenseById } from "../premium-store.js";
import { getStationHealthReport } from "../services/station-health.js";
import { getRecentOperatorIncidents } from "../operator-incidents-store.js";

const appStartTime = Date.now();
const webhookEventsInFlight = new Set();
let binaryHealthCache = null;

function getTierConfig(guildId) {
  const config = getServerPlanConfig(guildId);
  return { ...config, tier: config.plan };
}

function getLicense(guildId) {
  return getServerLicense(guildId);
}

function maskDashboardEmail(rawEmail) {
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

function buildDashboardLicenseWorkspace(license, guildInfo, sessionPayload, capabilityPayload) {
  if (!license?.id || capabilityPayload?.capabilities?.licenseWorkspace !== true) {
    return null;
  }

  const selectedGuildId = String(guildInfo?.id || "").trim();
  const linkedServerIds = [...new Set(
    (Array.isArray(license?.linkedServerIds) ? license.linkedServerIds : [])
      .map((serverId) => String(serverId || "").trim())
      .filter((serverId) => /^\d{17,22}$/.test(serverId))
  )];
  const sessionGuilds = resolveDashboardGuildsForSession(sessionPayload);
  const sessionGuildMap = new Map(sessionGuilds.map((guild) => [guild.id, guild]));

  const linkedServers = linkedServerIds
    .map((serverId) => {
      const sessionGuild = sessionGuildMap.get(serverId);
      const assignedLicense = serverId === selectedGuildId
        ? license
        : getServerLicense(serverId);
      const plan = String(assignedLicense?.plan || sessionGuild?.tier || "free").trim().toLowerCase();
      return {
        id: serverId,
        name: sessionGuild?.name || serverId,
        icon: sessionGuild?.icon || "",
        accessible: Boolean(sessionGuild),
        selected: serverId === selectedGuildId,
        tier: plan,
        tierName: getDashboardTierName(plan),
        active: Boolean(assignedLicense?.active) && !Boolean(assignedLicense?.expired),
      };
    })
    .sort((a, b) => Number(Boolean(b.selected)) - Number(Boolean(a.selected)) || a.name.localeCompare(b.name));

  const candidates = sessionGuilds
    .filter((guild) => !linkedServerIds.includes(guild.id))
    .map((guild) => {
      const assignedLicense = getServerLicense(guild.id);
      const foreignActiveLicense = Boolean(assignedLicense?.id)
        && String(assignedLicense.id) !== String(license.id)
        && Boolean(assignedLicense.active)
        && !Boolean(assignedLicense.expired);
      const assignedPlan = String(assignedLicense?.plan || guild?.tier || "free").trim().toLowerCase();
      return {
        id: guild.id,
        name: guild.name,
        icon: guild.icon || "",
        owner: Boolean(guild.owner),
        tier: assignedPlan,
        tierName: getDashboardTierName(assignedPlan),
        reason: foreignActiveLicense ? "existing_active_license" : "",
        canLink: !foreignActiveLicense,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    enabled: true,
    canManage: Boolean(license.active) && !Boolean(license.expired),
    linkedServers,
    availableServers: candidates.filter((candidate) => candidate.canLink),
    blockedServers: candidates.filter((candidate) => !candidate.canLink),
    hiddenLinkedServerCount: linkedServers.filter((server) => !server.accessible).length,
  };
}

function buildDashboardLicensePayload(guildInfo, sessionPayload = null) {
  const license = getLicense(guildInfo.id);
  const capabilityPayload = buildServerCapabilityPayload(guildInfo.id);
  const effectiveTier = String(license?.plan || guildInfo.tier || "free").trim().toLowerCase();
  const currentLimits = getPlanLimits(effectiveTier);
  const seats = Math.max(1, Number(license?.seats || capabilityPayload?.limits?.seats || 1) || 1);
  const nextUpgradeTier = String(capabilityPayload?.upgradeHints?.nextTier || "").trim().toLowerCase();
  const licenseEmail = String(license?.contactEmail || license?.email || "").trim().toLowerCase();
  const hasBillingEmail = isValidEmailAddress(licenseEmail);
  const linkedServers = Array.isArray(license?.linkedServerIds) ? license.linkedServerIds : [];
  const workspace = buildDashboardLicenseWorkspace(license, guildInfo, sessionPayload, capabilityPayload);

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
      active: Boolean(license.active) && !Boolean(license.expired),
      expired: Boolean(license.expired),
      expiresAt: license.expiresAt || null,
      remainingDays: Number.isFinite(license.remainingDays) ? license.remainingDays : 0,
      billingPeriod: license.billingPeriod || "monthly",
      durationMonths: license.durationMonths || null,
      emailMasked: maskDashboardEmail(licenseEmail),
      hasBillingEmail,
      canUpdateEmail: true,
      canManageWorkspace: workspace?.canManage === true,
      updatedAt: license.updatedAt || null,
      contactEmailDomain: hasBillingEmail ? licenseEmail.split("@")[1] : "",
      workspace,
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

function buildDashboardSessionHistoryEntryId(session = {}) {
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

function buildDashboardConnectionEventEntryId(event = {}) {
  return JSON.stringify([
    String(event?.timestamp || ""),
    String(event?.botId || ""),
    String(event?.eventType || ""),
    String(event?.channelId || ""),
    String(event?.details || ""),
  ]);
}

function extractMailbox(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) return "";
  const bracketMatch = text.match(/<([^>]+)>/);
  if (bracketMatch?.[1]) return bracketMatch[1].trim();
  const plainMatch = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return plainMatch?.[0] || "";
}

function getBlockedCapabilitiesForServer(serverId) {
  return CAPABILITY_KEYS.filter((capabilityKey) => !serverHasCapability(serverId, capabilityKey));
}

function buildServerCapabilityPayload(serverId) {
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

function mapDashboardCustomStation(key, station) {
  return {
    key,
    name: station?.name || key,
    url: station?.url || "",
    genre: station?.genre || "",
    folder: station?.folder || "",
    tags: Array.isArray(station?.tags) ? station.tags : [],
    custom: true,
  };
}

function buildDashboardExportsWebhookResponse(rawConfig) {
  return normalizeDashboardExportsWebhookConfig(
    rawConfig && typeof rawConfig === "object"
      ? rawConfig
      : DEFAULT_DASHBOARD_EXPORTS_WEBHOOK_CONFIG
  );
}

function buildDashboardIncidentAlertsResponse(rawConfig) {
  return normalizeDashboardIncidentAlertsConfig(
    rawConfig && typeof rawConfig === "object"
      ? rawConfig
      : DEFAULT_DASHBOARD_INCIDENT_ALERTS_CONFIG
  );
}

const handleDashboardLicenseRoute = createDashboardLicenseRouteHandler({
  BRAND,
  TIERS,
  activateOfferGrant,
  buildDashboardLicensePayload,
  calculatePrice,
  getDashboardSession,
  getLicense,
  getLocalizedJsonBodyError,
  getStripeSecretKey,
  isValidEmailAddress,
  languagePick,
  linkServerToLicense,
  log,
  maskDashboardEmail,
  methodNotAllowed,
  normalizeDuration,
  normalizeLanguage,
  normalizeSeats,
  resolveCheckoutOfferForRequest,
  resolveCheckoutReturnBase,
  resolveDashboardGuildForSession,
  resolveDashboardRequestLanguage,
  resolvePublicWebsiteUrl,
  sanitizeOfferCode,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
  unlinkServerFromLicense,
  updateLicenseContactEmail,
});

const handleDashboardPermsRoute = createDashboardPermsRouteHandler({
  formatDashboardPermissionMapForClient,
  formatDashboardPermissionRulesForClient,
  getDashboardRequestTranslator,
  getDashboardSession,
  getGuildCommandPermissionRules,
  getLocalizedJsonBodyError,
  methodNotAllowed,
  resetCommandPermissions,
  resolveDashboardGuildForSession,
  resolveDashboardPermissionRuleUpdates,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
  setCommandRolePermission,
});

const handlePublicRoutes = createPublicRoutesHandler({
  API_COMMANDS,
  BRAND,
  TIERS,
  appStartTime,
  buildPublicLegalNotice,
  buildPublicPrivacyNotice,
  buildPublicTermsNotice,
  buildPublicStationCatalog,
  frontendBuildStamp,
  getDashboardRequestTranslator,
  getGlobalStats,
  getHealthBinaryProbe,
  getStripeSecretKey,
  isAdminApiRequest,
  languagePick,
  loadStations,
  log,
  methodNotAllowed,
  rootDir,
  sendJson,
  sendLocalizedError,
  webRootSource,
  getReleaseInfo: () => buildReleaseInfo({ frontendBuildStamp, webRootSource }),
});

const handleAuthRoutes = createAuthRoutesHandler({
  buildDashboardErrorRedirect,
  buildDashboardSessionCookie,
  buildDashboardSessionCookieDeletion,
  buildDiscordAuthorizeUrl,
  deleteDashboardAuthSession,
  exchangeDiscordCodeForToken,
  fetchDiscordUserGuilds,
  fetchDiscordUserProfile,
  getCommonSecurityHeaders,
  getConfiguredPublicOrigin,
  getDashboardSession,
  getDashboardSessionTtlSeconds,
  getDefaultLanguage,
  getDiscordOauthStateTtlSeconds,
  getFrontendBaseOrigin,
  isAllowedFrontendOrigin,
  isDiscordOauthConfigured,
  languagePick,
  log,
  methodNotAllowed,
  normalizeLanguage,
  popDashboardOauthState,
  resolveDashboardGuildsForSession,
  resolveDashboardRequestLanguage,
  sanitizeDashboardPage,
  sendJson,
  setDashboardAuthSession,
  setDashboardOauthState,
});

const handleDashboardAccessRoute = createDashboardAccessRouteHandler({
  buildServerCapabilityPayload,
  getDashboardRequestTranslator,
  getDashboardSession,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  resolveDashboardGuildsForSession,
  sendJson,
  sendLocalizedError,
});

const handleDiscordBotListRoutes = createDiscordBotListRoutesHandler({
  fetchDiscordBotListPublicBotSummary,
  getDashboardRequestTranslator,
  getDiscordBotListStatus,
  getLocalizedJsonBodyError,
  handleDiscordBotListVoteWebhook,
  isAdminApiRequest,
  languagePick,
  log,
  methodNotAllowed,
  sendJson,
  syncDiscordBotListCommands,
  syncDiscordBotListStats,
  syncDiscordBotListVotes,
});

const handleBotsGGRoutes = createBotsGGRoutesHandler({
  fetchBotsGGPublicBotSummary,
  getBotsGGStatus,
  getDashboardRequestTranslator,
  isAdminApiRequest,
  languagePick,
  methodNotAllowed,
  sendJson,
  syncBotsGGStats,
});

const handleTopGGRoutes = createTopGGRoutesHandler({
  fetchTopGGProjectSummary,
  fetchTopGGVoteStatus,
  getDashboardRequestTranslator,
  getLocalizedJsonBodyError,
  getTopGGStatus,
  handleTopGGWebhook,
  isAdminApiRequest,
  languagePick,
  log,
  methodNotAllowed,
  sendJson,
  syncTopGGCommands,
  syncTopGGProject,
  syncTopGGStats,
  syncTopGGVotes,
});

const handleVoteEventsRoutes = createVoteEventsRoutesHandler({
  getDashboardRequestTranslator,
  getVoteEventsState,
  isAdminApiRequest,
  languagePick,
  methodNotAllowed,
  sendJson,
});

const handlePremiumReadRoutes = createPremiumReadRoutesHandler({
  BRAND,
  DURATION_OPTIONS,
  PRO_TRIAL_MONTHS,
  SEAT_OPTIONS,
  TIERS,
  buildInviteUrlForRuntime,
  calculateUpgradePrice,
  durationPricingInEuro,
  getBotAccessForTier,
  getDashboardRequestTranslator,
  getDefaultLanguage,
  getLicense,
  getPricePerMonthCents,
  getTierConfig,
  isAdminApiRequest,
  isProTrialEnabled,
  languagePick,
  methodNotAllowed,
  normalizeLanguage,
  normalizeSeats,
  resolveLanguageFromAcceptLanguage,
  sanitizeLicenseForApi,
  seatPricingInEuro,
  sendJson,
});

const handlePremiumBillingRoutes = createPremiumBillingRoutesHandler({
  BRAND,
  SEAT_OPTIONS,
  TIERS,
  activateOfferGrant,
  activatePaidStripeSession,
  activateProTrial,
  calculatePrice,
  getDashboardRequestTranslator,
  getDefaultLanguage,
  getLocalizedJsonBodyError,
  getStripeSecretKey,
  isEventProcessed,
  isProTrialEnabled,
  isSessionProcessed,
  isValidEmailAddress,
  log,
  markEventProcessed,
  methodNotAllowed,
  normalizeDuration,
  normalizeLanguage,
  normalizeSeats,
  resolveCheckoutOfferForRequest,
  resolveCheckoutReturnBase,
  resolveLanguageFromAcceptLanguage,
  sanitizeOfferCode,
  sendJson,
  webhookEventsInFlight,
});

const handlePremiumOffersRoutes = createPremiumOffersRoutesHandler({
  clipText,
  deleteOffer,
  getDashboardRequestTranslator,
  getLocalizedJsonBodyError,
  getOffer,
  isAdminApiRequest,
  listOffers,
  listRecentRedemptions,
  methodNotAllowed,
  sanitizeOfferCode,
  sendJson,
  setOfferActive,
  upsertOffer,
});

const handleDashboardSettingsRoute = createDashboardSettingsRouteHandler({
  buildDashboardIncidentAlertsResponse,
  buildDashboardExportsWebhookResponse,
  buildDashboardFailoverChainPreview,
  buildDashboardFallbackStationPreview,
  buildResolvedVoiceGuardConfig,
  buildServerCapabilityPayload,
  buildWeeklyDigestMeta,
  clipText,
  getDashboardRequestTranslator,
  getDashboardSession,
  getPrimaryFailoverStation,
  languagePick,
  methodNotAllowed,
  normalizeFailoverChain,
  normalizeWeeklyDigestConfig,
  resolveDashboardFailoverChain,
  resolveDashboardGuildForSession,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
  validateDashboardIncidentAlertsConfig,
  validateDashboardExportsWebhookConfig,
  validateVoiceGuardSettings,
});

const handleDashboardStatsRoute = createDashboardStatsRouteHandler({
  acknowledgeRuntimeIncident,
  buildDashboardDetailStatsPayload,
  buildDashboardStatsForGuild,
  getDashboardRequestTranslator,
  getDashboardSession,
  getDb,
  getLocalizedJsonBodyError,
  getRecentRuntimeIncidents,
  languagePick,
  log,
  methodNotAllowed,
  resetGuildStats,
  resolveDashboardGuildForSession,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
});

const handleDashboardEventsRoute = createDashboardEventsRouteHandler({
  buildDashboardDiscordSyncPatch,
  buildDashboardEventConflicts,
  buildDashboardEventResponse,
  buildDashboardSchedulePreviewRows,
  createScheduledEvent,
  deleteScheduledEvent,
  getDashboardRequestTranslator,
  getDashboardSession,
  getLocalizedJsonBodyError,
  getRepeatLabel,
  getScheduledEvent,
  getTier,
  languagePick,
  listScheduledEvents,
  log,
  methodNotAllowed,
  normalizeDashboardEventInput,
  patchScheduledEvent,
  resolveDashboardGuildForSession,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
  translateScheduledEventStoreMessage,
  validateDashboardEventChannels,
});

const handleDashboardChannelsRoute = createDashboardChannelsRouteHandler({
  getDashboardRequestTranslator,
  getDashboardSession,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
});

const handleDashboardTelemetryRoute = createDashboardTelemetryRouteHandler({
  getDashboardRequestTranslator,
  getLocalizedJsonBodyError,
  isAdminApiRequest,
  languagePick,
  methodNotAllowed,
  normalizeDashboardTelemetryPayload,
  sendJson,
  sendLocalizedError,
  setDashboardTelemetry,
});

const handleDashboardEmojisRoute = createDashboardEmojisRouteHandler({
  getDashboardRequestTranslator,
  getDashboardSession,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
});

const handleDashboardStationsRoute = createDashboardStationsRouteHandler({
  filterStationsByTier,
  getCustomStations,
  getDashboardRequestTranslator,
  getDashboardSession,
  loadStations,
  mapDashboardCustomStation,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
});

const handleDashboardCustomStationsRoute = createDashboardCustomStationsRouteHandler({
  addCustomStation,
  clipText,
  getCustomStations,
  getDashboardRequestTranslator,
  getDashboardSession,
  languagePick,
  mapDashboardCustomStation,
  methodNotAllowed,
  removeCustomStation,
  resolveDashboardGuildForSession,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
  translateCustomStationErrorMessage,
  updateCustomStation,
});

const handleDashboardSettingsDigestRoute = createDashboardSettingsDigestRouteHandler({
  buildDashboardWeeklyDigestPreviewPayload,
  getDashboardRequestTranslator,
  getDashboardSession,
  getLocalizedJsonBodyError,
  methodNotAllowed,
  normalizeWeeklyDigestConfig,
  resolveDashboardGuildForSession,
  resolveGuildTextChannel,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
});

const handleDashboardExportsRoute = createDashboardExportsRouteHandler({
  buildDashboardDetailStatsPayload,
  buildDashboardExportsWebhookResponse,
  buildDashboardStatsForGuild,
  buildDashboardWebhookPayload,
  deliverDashboardWebhook,
  getCustomStations,
  getDashboardRequestTranslator,
  getDashboardSession,
  getLocalizedJsonBodyError,
  languagePick,
  log,
  mapDashboardCustomStation,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
  shouldDeliverDashboardWebhook,
  validateDashboardExportsWebhookConfig,
});

const handleDashboardRolesRoute = createDashboardRolesRouteHandler({
  getDashboardRequestTranslator,
  getDashboardSession,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
});

function buildDashboardSelectableStations(guildId) {
  const tier = getTier(guildId);
  const scopedStations = filterStationsByTier(loadStations().stations || {}, tier);
  const customStations = getCustomStations(guildId) || {};
  const entries = [];

  for (const [key, station] of Object.entries(customStations)) {
    const normalizedKey = `custom:${String(key || "").trim().toLowerCase()}`;
    entries.push({
      value: normalizedKey,
      name: station?.name || key,
      label: `${station?.name || key} (Custom)`,
      tier: "ultimate",
      isCustom: true,
      folder: station?.folder || "",
      tags: Array.isArray(station?.tags) ? station.tags : [],
    });
  }

  for (const [key, station] of Object.entries(scopedStations)) {
    const tierLabel = String(station?.tier || "free").trim().toLowerCase();
    const suffix = tierLabel === "free" ? "" : ` (${tierLabel.charAt(0).toUpperCase()}${tierLabel.slice(1)})`;
    entries.push({
      value: key,
      name: station?.name || key,
      label: `${station?.name || key}${suffix}`,
      tier: tierLabel,
      isCustom: false,
    });
  }

  return entries;
}

function buildDashboardFallbackStationPreview(guildId, rawFallbackStation) {
  const selectedValue = String(rawFallbackStation || "").trim().toLowerCase();
  if (!selectedValue) {
    return {
      configured: false,
      valid: true,
      key: "",
      name: "",
      label: "",
      tier: null,
      isCustom: false,
    };
  }

  const match = buildDashboardSelectableStations(guildId).find((entry) => entry.value === selectedValue) || null;
  if (!match) {
    return {
      configured: true,
      valid: false,
      key: selectedValue,
      name: "",
      label: selectedValue,
      tier: null,
      isCustom: selectedValue.startsWith("custom:"),
    };
  }

  return {
    configured: true,
    valid: true,
    key: match.value,
    name: match.name,
    label: match.label,
    tier: match.tier,
    isCustom: match.isCustom,
  };
}

function resolveDashboardFailoverChain(settings = {}) {
  const configuredChain = normalizeFailoverChain(settings?.failoverChain || []);
  if (configuredChain.length > 0) return configuredChain;
  return normalizeFailoverChain(settings?.fallbackStation || "");
}

function buildDashboardFailoverChainPreview(guildId, rawFailoverChain = [], rawFallbackStation = "") {
  const chain = normalizeFailoverChain(
    Array.isArray(rawFailoverChain) && rawFailoverChain.length > 0
      ? rawFailoverChain
      : rawFallbackStation
  );
  return chain.map((stationKey, index) => ({
    order: index + 1,
    ...buildDashboardFallbackStationPreview(guildId, stationKey),
  }));
}

function getHealthBinaryProbe() {
  const cacheAgeMs = 30_000;
  if (binaryHealthCache && (Date.now() - binaryHealthCache.checkedAt) < cacheAgeMs) {
    return binaryHealthCache;
  }

  const probe = (command, variants = [["-version"], ["--version"]]) => {
    for (const args of variants) {
      try {
        const result = spawnSync(command, args, {
          encoding: "utf8",
          timeout: 2_000,
          windowsHide: true,
        });
        if (result.error) continue;
        const firstLine = String(result.stdout || result.stderr || "").split(/\r?\n/).find(Boolean) || "";
        return {
          available: result.status === 0,
          version: firstLine.trim() || null,
          status: result.status,
        };
      } catch {}
    }
    return {
      available: false,
      version: null,
      status: null,
    };
  };

  binaryHealthCache = {
    checkedAt: Date.now(),
    ffmpeg: probe("ffmpeg"),
    fpcalc: probe("fpcalc"),
  };
  return binaryHealthCache;
}

function isPublicLegalPlaceholder(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!normalized) return false;
  return normalized.includes("example operator")
    || normalized.startsWith("example ")
    || normalized.endsWith("@example.com")
    || normalized.includes("://localhost")
    || normalized.includes("://127.0.0.1");
}

function readPublicLegalEnv(name) {
  const value = String(process.env[name] || "").trim();
  return isPublicLegalPlaceholder(value) ? "" : value;
}

function buildPublicLegalNotice() {
  const publicUrl = readPublicLegalEnv("PUBLIC_WEB_URL");
  const fallbackEmail = isPublicLegalPlaceholder(process.env.SMTP_FROM)
    ? ""
    : extractMailbox(process.env.SMTP_FROM || "");
  const productName = readPublicLegalEnv("LEGAL_PRODUCT_NAME") || BRAND.name || "OmniFM";
  const legal = {
    productName,
    providerName: readPublicLegalEnv("LEGAL_PROVIDER_NAME"),
    legalForm: readPublicLegalEnv("LEGAL_LEGAL_FORM"),
    representative: readPublicLegalEnv("LEGAL_REPRESENTATIVE"),
    streetAddress: readPublicLegalEnv("LEGAL_STREET_ADDRESS"),
    postalCode: readPublicLegalEnv("LEGAL_POSTAL_CODE"),
    city: readPublicLegalEnv("LEGAL_CITY"),
    country: readPublicLegalEnv("LEGAL_COUNTRY"),
    email: readPublicLegalEnv("LEGAL_EMAIL") || fallbackEmail,
    phone: readPublicLegalEnv("LEGAL_PHONE"),
    website: readPublicLegalEnv("LEGAL_WEBSITE") || publicUrl,
    businessPurpose: readPublicLegalEnv("LEGAL_BUSINESS_PURPOSE"),
    commercialRegisterNumber: readPublicLegalEnv("LEGAL_COMMERCIAL_REGISTER_NUMBER"),
    commercialRegisterCourt: readPublicLegalEnv("LEGAL_COMMERCIAL_REGISTER_COURT"),
    vatId: readPublicLegalEnv("LEGAL_VAT_ID"),
    supervisoryAuthority: readPublicLegalEnv("LEGAL_SUPERVISORY_AUTHORITY"),
    chamber: readPublicLegalEnv("LEGAL_CHAMBER"),
    profession: readPublicLegalEnv("LEGAL_PROFESSION"),
    professionRules: readPublicLegalEnv("LEGAL_PROFESSION_RULES"),
    editorialResponsible: readPublicLegalEnv("LEGAL_EDITORIAL_RESPONSIBLE"),
    mediaOwner: readPublicLegalEnv("LEGAL_MEDIA_OWNER"),
    mediaLine: readPublicLegalEnv("LEGAL_MEDIA_LINE"),
  };

  const missingCoreFields = [];
  if (!legal.providerName) missingCoreFields.push("providerName");
  if (!legal.streetAddress) missingCoreFields.push("streetAddress");
  if (!legal.postalCode) missingCoreFields.push("postalCode");
  if (!legal.city) missingCoreFields.push("city");
  if (!legal.email) missingCoreFields.push("email");

  return {
    legal,
    missingCoreFields,
    isConfigured: missingCoreFields.length === 0,
    basis: ["ECG_5", "UGB_14", "GewO_63", "MedienG_25"],
    updatedAt: new Date().toISOString(),
  };
}

function buildPublicPrivacyNotice() {
  const legalNotice = buildPublicLegalNotice();
  const legal = legalNotice.legal || {};
  const hasStripe = Boolean(getStripeSecretKey());
  const hasSmtp = Boolean(String(process.env.SMTP_HOST || "").trim());
  const hasDiscordBotList = String(process.env.DISCORDBOTLIST_ENABLED || "1").trim() !== "0"
    && Boolean(String(process.env.DISCORDBOTLIST_TOKEN || "").trim());
  const hasBotsGG = String(process.env.BOTSGG_ENABLED || "0").trim() !== "0"
    && Boolean(String(process.env.BOTSGG_TOKEN || "").trim());
  const hasTopGG = String(process.env.TOPGG_ENABLED || "0").trim() !== "0"
    && Boolean(String(process.env.TOPGG_TOKEN || "").trim());
  const hasRecognition = String(process.env.NOW_PLAYING_RECOGNITION_ENABLED || "0").trim() === "1"
    && Boolean(String(process.env.ACOUSTID_API_KEY || "").trim());

  const controller = {
    name: readPublicLegalEnv("PRIVACY_CONTROLLER_NAME") || legal.providerName,
    representative: readPublicLegalEnv("PRIVACY_CONTROLLER_REPRESENTATIVE") || legal.representative,
    streetAddress: readPublicLegalEnv("PRIVACY_CONTROLLER_STREET_ADDRESS") || legal.streetAddress,
    postalCode: readPublicLegalEnv("PRIVACY_CONTROLLER_POSTAL_CODE") || legal.postalCode,
    city: readPublicLegalEnv("PRIVACY_CONTROLLER_CITY") || legal.city,
    country: readPublicLegalEnv("PRIVACY_CONTROLLER_COUNTRY") || legal.country || "Österreich",
    website: readPublicLegalEnv("PRIVACY_CONTROLLER_WEBSITE") || legal.website,
  };

  const contact = {
    email: readPublicLegalEnv("PRIVACY_CONTACT_EMAIL") || legal.email,
    phone: readPublicLegalEnv("PRIVACY_CONTACT_PHONE") || legal.phone,
  };

  const dpo = {
    name: readPublicLegalEnv("PRIVACY_DPO_NAME"),
    email: readPublicLegalEnv("PRIVACY_DPO_EMAIL"),
  };

  const hosting = {
    provider: readPublicLegalEnv("PRIVACY_HOSTING_PROVIDER"),
    location: readPublicLegalEnv("PRIVACY_HOSTING_LOCATION"),
  };

  const authority = {
    name: readPublicLegalEnv("PRIVACY_AUTHORITY_NAME") || "Österreichische Datenschutzbehörde",
    website: readPublicLegalEnv("PRIVACY_AUTHORITY_WEBSITE") || "https://www.dsb.gv.at/",
  };

  const additionalRecipients = readPublicLegalEnv("PRIVACY_ADDITIONAL_RECIPIENTS");
  const customNote = readPublicLegalEnv("PRIVACY_CUSTOM_NOTE");
  const missingCoreFields = [];

  if (!controller.name) missingCoreFields.push("controllerName");
  if (!controller.streetAddress) missingCoreFields.push("controllerStreetAddress");
  if (!controller.postalCode) missingCoreFields.push("controllerPostalCode");
  if (!controller.city) missingCoreFields.push("controllerCity");
  if (!contact.email) missingCoreFields.push("contactEmail");

  return {
    controller,
    productName: legal.productName || String(process.env.LEGAL_PRODUCT_NAME || BRAND.name || "OmniFM").trim(),
    contact,
    dpo,
    hosting,
    authority,
    additionalRecipients,
    customNote,
    features: {
      stripeEnabled: hasStripe,
      smtpEnabled: hasSmtp,
      discordBotListEnabled: hasDiscordBotList,
      botsGGEnabled: hasBotsGG,
      topGGEnabled: hasTopGG,
      recognitionEnabled: hasRecognition,
      googleAnalyticsEnabled: true,
      googleAnalyticsMeasurementId: "G-J5X0ZZ5E3Z",
      cookieConsentStorageKey: "omnifm.cookieConsent.v1",
      stationPreviewEnabled: true,
      localeStorageKey: "omnifm.web.locale",
    },
    retention: {
      logDays: Number.parseInt(String(process.env.LOG_MAX_DAYS || "14"), 10) || 14,
      songHistoryEnabled: String(process.env.SONG_HISTORY_ENABLED || "1").trim() !== "0",
      songHistoryMaxPerGuild: Number.parseInt(String(process.env.SONG_HISTORY_MAX_PER_GUILD || "100"), 10) || 100,
      listeningStatsEnabled: true,
      scheduledEventsEnabled: true,
    },
    missingCoreFields,
    isConfigured: missingCoreFields.length === 0,
    basis: ["GDPR_ART_13", "GDPR_ART_15_22", "DSB_AT"],
    updatedAt: new Date().toISOString(),
  };
}

function buildPublicTermsNotice() {
  const legalNotice = buildPublicLegalNotice();
  const legal = legalNotice.legal || {};
  const publicUrl = readPublicLegalEnv("PUBLIC_WEB_URL");
  const fallbackEmail = isPublicLegalPlaceholder(process.env.SMTP_FROM)
    ? ""
    : extractMailbox(process.env.SMTP_FROM || "");
  const hasStripe = Boolean(getStripeSecretKey());
  const hasSmtp = Boolean(String(process.env.SMTP_HOST || "").trim());

  const operator = {
    providerName: legal.providerName || "",
    representative: legal.representative || "",
    businessPurpose: legal.businessPurpose || "",
    website: legal.website || publicUrl,
  };

  const contact = {
    email: readPublicLegalEnv("TERMS_CONTACT_EMAIL")
      || readPublicLegalEnv("PRIVACY_CONTACT_EMAIL")
      || legal.email
      || fallbackEmail,
    website: readPublicLegalEnv("TERMS_SUPPORT_URL")
      || legal.website
      || publicUrl,
    effectiveDate: readPublicLegalEnv("TERMS_EFFECTIVE_DATE"),
    governingLaw: readPublicLegalEnv("TERMS_GOVERNING_LAW"),
  };

  const missingCoreFields = [];
  if (!operator.providerName) missingCoreFields.push("providerName");
  if (!contact.email) missingCoreFields.push("contactEmail");
  if (!contact.website) missingCoreFields.push("website");

  return {
    operator,
    productName: legal.productName || String(process.env.LEGAL_PRODUCT_NAME || BRAND.name || "OmniFM").trim(),
    contact,
    service: {
      discordBotEnabled: true,
      dashboardEnabled: true,
      stationPreviewEnabled: true,
      scheduledEventsEnabled: true,
      customStationsEnabled: true,
    },
    billing: {
      premiumCheckoutEnabled: hasStripe,
      paymentProvider: hasStripe ? "Stripe" : "",
      emailDeliveryEnabled: hasSmtp,
      trialEnabled: isProTrialEnabled(),
    },
    customNote: readPublicLegalEnv("TERMS_CUSTOM_NOTE"),
    missingCoreFields,
    isConfigured: missingCoreFields.length === 0,
    basis: ["DISCORD_TERMS", "AUSTRIAN_SERVICE_TERMS", "STREAM_RIGHTS_NOTICE"],
    updatedAt: new Date().toISOString(),
  };
}

const SPA_ENTRY_PATHS = new Set([
  "/",
  "/dashboard",
  "/stations",
  "/sender",
  "/premium",
  "/pricing",
  "/preise",
  "/faq",
  "/fragen",
  "/imprint",
  "/impressum",
  "/privacy",
  "/privacy-policy",
  "/datenschutz",
  "/terms",
  "/tos",
  "/terms-of-service",
  "/nutzungsbedingungen",
  "/agb",
]);

function normalizeSpaPathname(pathname) {
  const raw = String(pathname || "/").trim();
  if (!raw) return "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (withLeadingSlash.length === 1) return withLeadingSlash;
  return withLeadingSlash.replace(/\/+$/, "");
}

function parseEnvInt(value, fallback, minimum = 1) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

function getDashboardSessionCookieName() {
  return String(process.env.DASHBOARD_SESSION_COOKIE || "omnifm_session").trim() || "omnifm_session";
}

function getDashboardSessionTtlSeconds() {
  return parseEnvInt(process.env.DASHBOARD_SESSION_TTL_SECONDS, 86_400, 300);
}

function getDiscordOauthStateTtlSeconds() {
  return parseEnvInt(process.env.DISCORD_OAUTH_STATE_TTL_SECONDS, 600, 60);
}

function getDiscordOauthScopes() {
  return String(process.env.DISCORD_OAUTH_SCOPES || "identify guilds").trim() || "identify guilds";
}

function getDiscordClientId() {
  return String(process.env.DISCORD_CLIENT_ID || "").trim();
}

function getDiscordClientSecret() {
  return String(process.env.DISCORD_CLIENT_SECRET || "").trim();
}

function getDiscordRedirectUri() {
  return String(process.env.DISCORD_REDIRECT_URI || "").trim();
}

function isDiscordOauthConfigured() {
  return Boolean(getDiscordClientId() && getDiscordClientSecret() && getDiscordRedirectUri());
}

function hasManageGuildPermission(rawPermissions) {
  try {
    const bitfield = BigInt(String(rawPermissions || "0").trim() || "0");
    return (bitfield & 0x20n) === 0x20n || (bitfield & 0x8n) === 0x8n;
  } catch {
    return false;
  }
}

function sanitizeDashboardPage(rawPage) {
  const page = String(rawPage || "dashboard").trim().toLowerCase();
  return page === "home" ? "home" : "dashboard";
}

function parseCookieHeader(rawCookieHeader) {
  const cookies = {};
  for (const part of String(rawCookieHeader || "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

function resolveDashboardSessionToken(req) {
  const auth = String(req.headers.authorization || "").trim();
  if (/^Bearer\s+/i.test(auth)) {
    const bearer = auth.replace(/^Bearer\s+/i, "").trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookieHeader(req.headers.cookie);
  const cookieToken = String(cookies[getDashboardSessionCookieName()] || "").trim();
  if (cookieToken) return cookieToken;
  const headerToken = String(req.headers["x-session-token"] || "").trim();
  if (headerToken) return headerToken;
  return "";
}

function getDashboardSession(req) {
  cleanupDashboardAuthState();
  const token = resolveDashboardSessionToken(req);
  if (!token) return { session: null, token: "" };
  return {
    session: getDashboardAuthSession(token),
    token,
  };
}

function getFrontendBaseOrigin(req, publicUrl, preferredOrigin = "") {
  const preferred = toOrigin(preferredOrigin);
  if (preferred) return preferred;
  const requestOrigin = toOrigin(String(req.headers.origin || "").trim());
  if (requestOrigin) return requestOrigin;
  const refererOrigin = toOrigin(String(req.headers.referer || req.headers.referrer || "").trim());
  if (refererOrigin) return refererOrigin;
  const publicOrigin = toOrigin(publicUrl);
  if (publicOrigin) return publicOrigin;
  const redirectOrigin = toOrigin(getDiscordRedirectUri());
  if (redirectOrigin) return redirectOrigin;
  return getConfiguredPublicOrigin(publicUrl);
}

function isSecureCookieRequest(req, targetOrigin = "") {
  if (String(targetOrigin || "").startsWith("https://")) return true;
  if (String(req.socket?.encrypted || false) === "true") return true;
  const forwardedProto = String(req.headers["x-forwarded-proto"] || "").trim().toLowerCase().split(",")[0].trim();
  return forwardedProto === "https";
}

function buildDashboardSessionCookie(token, req, targetOrigin) {
  const secure = isSecureCookieRequest(req, targetOrigin);
  const sameSite = secure ? "None" : "Lax";
  return [
    `${getDashboardSessionCookieName()}=${encodeURIComponent(token)}`,
    `Max-Age=${getDashboardSessionTtlSeconds()}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
    "Path=/",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function buildDashboardSessionCookieDeletion(req, targetOrigin) {
  const secure = isSecureCookieRequest(req, targetOrigin);
  const sameSite = secure ? "None" : "Lax";
  return [
    `${getDashboardSessionCookieName()}=`,
    "Max-Age=0",
    "HttpOnly",
    `SameSite=${sameSite}`,
    "Path=/",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

function buildDiscordAuthorizeUrl(stateToken) {
  const params = new URLSearchParams({
    client_id: getDiscordClientId(),
    response_type: "code",
    redirect_uri: getDiscordRedirectUri(),
    scope: getDiscordOauthScopes(),
    state: stateToken,
    prompt: "consent",
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

async function exchangeDiscordCodeForToken(code) {
  const body = new URLSearchParams({
    client_id: getDiscordClientId(),
    client_secret: getDiscordClientSecret(),
    grant_type: "authorization_code",
    code: String(code || "").trim(),
    redirect_uri: getDiscordRedirectUri(),
  });
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`discord_token_exchange_failed:${response.status}`);
  }
  const payload = await response.json();
  const accessToken = String(payload?.access_token || "").trim();
  if (!accessToken) {
    throw new Error("discord_access_token_missing");
  }
  return accessToken;
}

async function fetchDiscordUserProfile(accessToken) {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`discord_user_fetch_failed:${response.status}`);
  }
  const payload = await response.json();
  return {
    id: String(payload?.id || "").trim(),
    username: clipText(payload?.username || "Discord User", 80),
    globalName: clipText(payload?.global_name || "", 80),
    avatar: clipText(payload?.avatar || "", 120),
  };
}

async function fetchDiscordUserGuilds(accessToken) {
  const response = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`discord_guilds_fetch_failed:${response.status}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload
    .map((guild) => ({
      id: String(guild?.id || "").trim(),
      name: clipText(guild?.name || "Guild", 120),
      icon: clipText(guild?.icon || "", 120),
      owner: Boolean(guild?.owner),
      permissions: String(guild?.permissions || "0"),
    }))
    .filter((guild) => /^\d{17,22}$/.test(guild.id));
}

function resolveDashboardGuildsForSession(sessionPayload) {
  const guilds = Array.isArray(sessionPayload?.guilds) ? sessionPayload.guilds : [];
  return guilds
    .filter((guild) => guild && /^\d{17,22}$/.test(String(guild.id || "")) && hasManageGuildPermission(guild.permissions))
    .map((guild) => {
      const entitlement = buildServerCapabilityPayload(guild.id);
      return {
        id: guild.id,
        name: clipText(guild.name || guild.id, 120),
        icon: clipText(guild.icon || "", 120),
        owner: Boolean(guild.owner),
        permissions: String(guild.permissions || "0"),
        tier: entitlement.tier,
        capabilities: entitlement.capabilities,
        limits: entitlement.limits,
        upgradeHints: entitlement.upgradeHints,
        dashboardEnabled: entitlement.capabilities.dashboardAccess === true,
        ultimateEnabled: entitlement.capabilities.advancedAnalytics === true
          || entitlement.capabilities.customStationUrls === true
          || entitlement.capabilities.failoverRules === true,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function resolveDashboardGuildForSession(sessionPayload, serverId) {
  const guildId = String(serverId || "").trim();
  if (!/^\d{17,22}$/.test(guildId)) return null;
  return resolveDashboardGuildsForSession(sessionPayload).find((guild) => guild.id === guildId) || null;
}

function buildDashboardErrorRedirect(origin, errorCode, language = "") {
  const safeOrigin = toOrigin(origin) || "http://localhost";
  const lang = normalizeLanguage(language || "", "");
  const langParam = lang ? `&lang=${encodeURIComponent(lang)}` : "";
  return `${safeOrigin}/?page=dashboard&authError=${encodeURIComponent(String(errorCode || "oauth_error"))}${langParam}`;
}

function resolveDashboardRequestLanguage(req, requestUrl, fallback = getDefaultLanguage()) {
  return resolveRequestLanguage(
    req?.headers || {},
    requestUrl?.searchParams?.get("lang") || "",
    fallback
  );
}

function getDashboardRequestTranslator(req, requestUrl, fallback = getDefaultLanguage()) {
  const language = resolveDashboardRequestLanguage(req, requestUrl, fallback);
  return {
    language,
    t: (de, en) => languagePick(language, de, en),
  };
}

function sendLocalizedError(res, status, language, de, en) {
  sendJson(res, status, { error: languagePick(language, de, en) });
}

function getLocalizedJsonBodyError(language, status) {
  return languagePick(
    language,
    status === 413 ? "Request-Body ist zu groß." : "Ungültiges JSON im Request-Body.",
    status === 413 ? "Request body is too large." : "Invalid JSON in request body."
  );
}

function sortDashboardRuntimes(runtimes) {
  return [...(Array.isArray(runtimes) ? runtimes : [])].sort((a, b) => {
    if (a.role === "commander" && b.role !== "commander") return -1;
    if (a.role !== "commander" && b.role === "commander") return 1;
    return Number(a?.config?.index || 0) - Number(b?.config?.index || 0);
  });
}

function getDashboardStatusSnapshot(runtime) {
  if (typeof runtime?.getDashboardStatus === "function") {
    return runtime.getDashboardStatus();
  }
  if (typeof runtime?.getPublicStatus === "function") {
    return runtime.getPublicStatus();
  }
  return {};
}

function buildDerivedDashboardGuildDetail(runtime, guildId) {
  const state = runtime?.guildState?.get?.(guildId);
  if (!state) return null;

  const guild = runtime?.client?.guilds?.cache?.get?.(guildId) || null;
  const reconnectAttempts = Number(state?.reconnectAttempts || 0) || 0;
  const streamErrorCount = Number(state?.streamErrorCount || 0) || 0;
  const playing = isRuntimePlaybackActive(runtime, guildId, state);
  const voiceConnected = isRuntimeVoiceConnected(runtime, guildId, state, { includeObserved: true });
  const recovering = Boolean(
    state?.currentStationKey
    && state?.shouldReconnect === true
    && (!playing || state?.reconnectTimer || reconnectAttempts > 0)
  );
  if (!playing && !recovering && !state?.currentStationKey && !state?.lastChannelId) {
    return null;
  }

  let listenerCount = 0;
  if (playing && typeof runtime?.getCurrentListenerCount === "function") {
    try {
      listenerCount = Number(runtime.getCurrentListenerCount(guildId, state) || 0) || 0;
    } catch {
      listenerCount = 0;
    }
  }

  return {
    guildId,
    guildName: guild?.name || null,
    stationKey: state?.currentStationKey || null,
    stationName: state?.currentStationName || state?.currentStationKey || null,
    channelId: state?.lastChannelId || null,
    channelName: state?.lastChannelId ? guild?.channels?.cache?.get?.(state.lastChannelId)?.name || null : null,
    listenerCount,
    voiceConnected,
    playing,
    recovering,
    reconnectAttempts,
    streamErrorCount,
    shouldReconnect: state?.shouldReconnect === true,
    meta: state?.currentMeta || null,
    reconnectPending: Boolean(state?.reconnectTimer),
    reconnectInFlight: state?.reconnectInFlight === true,
    streamRestartPending: Boolean(state?.streamRestartTimer),
    voiceConnectInFlight: state?.voiceConnectInFlight === true,
    reconnectCount: Number(state?.reconnectCount || 0) || 0,
    lastReconnectAt: toDashboardIsoTime(state?.lastReconnectAt),
    lastStreamErrorAt: toDashboardIsoTime(state?.lastStreamErrorAt),
    lastProcessExitCode: state?.lastProcessExitCode ?? null,
    lastProcessExitDetail: state?.lastProcessExitDetail || null,
    lastProcessExitAt: toDashboardIsoTime(state?.lastProcessExitAt),
    lastStreamEndReason: state?.lastStreamEndReason || null,
    lastNetworkFailureAt: toDashboardIsoTime(state?.lastNetworkFailureAt),
    voiceDisconnectObservedAt: toDashboardIsoTime(state?.voiceDisconnectObservedAt),
    restoreBlockedUntil: toDashboardIsoTime(state?.restoreBlockedUntil),
    restoreBlockedAt: toDashboardIsoTime(state?.restoreBlockedAt),
    restoreBlockCount: Number(state?.restoreBlockCount || 0) || 0,
    restoreBlockReason: state?.restoreBlockReason || null,
    reconnectCircuitTripCount: Number(state?.reconnectCircuitTripCount || 0) || 0,
    reconnectCircuitOpenUntil: toDashboardIsoTime(state?.reconnectCircuitOpenUntil),
    networkRecoveryDelayMs: typeof runtime?.getNetworkRecoveryDelayMs === "function"
      ? Number(runtime.getNetworkRecoveryDelayMs(guildId) || 0) || 0
      : 0,
  };
}

function resolveDashboardGuildDetail(runtime, guildId, status = null) {
  const snapshot = status || getDashboardStatusSnapshot(runtime);
  const guildDetails = Array.isArray(snapshot?.guildDetails) ? snapshot.guildDetails : [];
  const detail = guildDetails.find((entry) => String(entry?.guildId || "") === String(guildId)) || null;
  return detail || buildDerivedDashboardGuildDetail(runtime, guildId);
}

function runtimeHasGuildContext(runtime, guildId, detail = null) {
  if (runtime?.client?.guilds?.cache?.has?.(guildId) === true) return true;
  return Boolean(detail);
}

function resolveRuntimeForGuild(runtimes, guildId) {
  const sorted = sortDashboardRuntimes(runtimes);

  for (const runtime of sorted) {
    const guild = runtime?.client?.guilds?.cache?.get?.(guildId) || null;
    if (guild) return { runtime, guild };
  }

  return { runtime: sorted[0] || null, guild: null };
}

function toDashboardTimeMs(value) {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return value;
  }
  const text = String(value || "").trim();
  if (/^\d+$/.test(text)) {
    const parsedNumeric = Number.parseInt(text, 10);
    if (Number.isFinite(parsedNumeric) && parsedNumeric > 0) {
      return parsedNumeric;
    }
  }
  const parsedDate = Date.parse(text);
  return Number.isFinite(parsedDate) && parsedDate > 0 ? parsedDate : 0;
}

function toDashboardIsoTime(value) {
  const timestampMs = toDashboardTimeMs(value);
  return timestampMs > 0 ? new Date(timestampMs).toISOString() : null;
}

function getDashboardRemainingMs(value) {
  const timestampMs = toDashboardTimeMs(value);
  if (timestampMs <= 0) return 0;
  return Math.max(0, timestampMs - Date.now());
}

function collectGuildLiveDetails(runtimes, guildId) {
  const rows = [];
  for (const runtime of runtimes) {
    if (typeof runtime?.getPublicStatus !== "function") continue;
    const status = getDashboardStatusSnapshot(runtime);
    const detail = resolveDashboardGuildDetail(runtime, guildId, status);
    if (!detail) continue;
    if (detail?.playing !== true && detail?.recovering !== true) continue;
    rows.push({
      botId: status.botId || status.id || null,
      botName: status.name || "Bot",
      stationKey: detail.stationKey || null,
      stationName: detail.stationName || detail.stationKey || "-",
      channelId: detail.channelId || null,
      channelName: detail.channelName || detail.channelId || "Voice",
      listeners: Number(detail.listenerCount || 0) || 0,
      reconnectAttempts: Number(detail.reconnectAttempts || 0) || 0,
      streamErrorCount: Number(detail.streamErrorCount || 0) || 0,
      recovering: detail?.recovering === true,
      shouldReconnect: detail.shouldReconnect === true,
      voiceGuardPolicy: detail?.voiceGuardPolicy || "default",
      voiceGuardEffectivePolicy: detail?.voiceGuardEffectivePolicy || null,
      voiceGuardLastAction: detail?.voiceGuardLastAction || null,
      voiceGuardLastActionAt: toDashboardIsoTime(detail?.voiceGuardLastActionAt),
      voiceGuardMoveCount: Number(detail?.voiceGuardMoveCount || 0) || 0,
      voiceGuardReturnCount: Number(detail?.voiceGuardReturnCount || 0) || 0,
      voiceGuardDisconnectCount: Number(detail?.voiceGuardDisconnectCount || 0) || 0,
    });
  }
  return rows;
}

function collectGuildBotHealthRows(runtimes, guildId) {
  const rows = [];
  for (const runtime of sortDashboardRuntimes(runtimes)) {
    const status = getDashboardStatusSnapshot(runtime);
    const detail = resolveDashboardGuildDetail(runtime, guildId, status);
    if (!runtimeHasGuildContext(runtime, guildId, detail)) continue;

    const reconnectAttempts = Number(detail?.reconnectAttempts || 0) || 0;
    const streamErrorCount = Number(detail?.streamErrorCount || 0) || 0;
    const playing = detail?.playing === true;
    const recovering = detail?.recovering === true;
    const shouldReconnect = detail?.shouldReconnect === true;

    let botStatus = "idle";
    if (runtime?.client?.isReady?.() !== true) {
      botStatus = "offline";
    } else if (recovering) {
      botStatus = "recovering";
    } else if (playing && (reconnectAttempts > 0 || streamErrorCount > 0)) {
      botStatus = "degraded";
    } else if (playing) {
      botStatus = "streaming";
    }

    rows.push({
      botId: status?.botId || status?.id || runtime?.config?.id || null,
      botName: status?.name || runtime?.config?.name || "Bot",
      role: runtime?.role || status?.role || "worker",
      ready: runtime?.client?.isReady?.() === true,
      status: botStatus,
      playing,
      listeners: Number(detail?.listenerCount || 0) || 0,
      reconnectAttempts,
      streamErrorCount,
      recovering,
      shouldReconnect,
      channelId: detail?.channelId || null,
      channelName: detail?.channelName || detail?.channelId || null,
      stationKey: detail?.stationKey || null,
      stationName: detail?.stationName || detail?.stationKey || null,
      reconnectPending: detail?.reconnectPending === true,
      reconnectInFlight: detail?.reconnectInFlight === true,
      streamRestartPending: detail?.streamRestartPending === true,
      voiceConnectInFlight: detail?.voiceConnectInFlight === true,
      reconnectCount: Number(detail?.reconnectCount || 0) || 0,
      lastReconnectAt: toDashboardIsoTime(detail?.lastReconnectAt),
      lastStreamErrorAt: toDashboardIsoTime(detail?.lastStreamErrorAt),
      lastProcessExitCode: detail?.lastProcessExitCode ?? null,
      lastProcessExitDetail: detail?.lastProcessExitDetail || null,
      lastProcessExitAt: toDashboardIsoTime(detail?.lastProcessExitAt),
      lastStreamEndReason: detail?.lastStreamEndReason || null,
      lastNetworkFailureAt: toDashboardIsoTime(detail?.lastNetworkFailureAt),
      voiceDisconnectObservedAt: toDashboardIsoTime(detail?.voiceDisconnectObservedAt),
      restoreBlockedUntil: toDashboardIsoTime(detail?.restoreBlockedUntil),
      restoreBlockedAt: toDashboardIsoTime(detail?.restoreBlockedAt),
      restoreBlockCount: Number(detail?.restoreBlockCount || 0) || 0,
      restoreBlockReason: detail?.restoreBlockReason || null,
      restoreCooldownMs: getDashboardRemainingMs(detail?.restoreBlockedUntil),
      reconnectCircuitTripCount: Number(detail?.reconnectCircuitTripCount || 0) || 0,
      reconnectCircuitOpenUntil: toDashboardIsoTime(detail?.reconnectCircuitOpenUntil),
      reconnectCircuitRemainingMs: getDashboardRemainingMs(detail?.reconnectCircuitOpenUntil),
      networkRecoveryDelayMs: Number(detail?.networkRecoveryDelayMs || 0) || 0,
      voiceGuardPolicy: detail?.voiceGuardPolicy || "default",
      voiceGuardEffectivePolicy: detail?.voiceGuardEffectivePolicy || null,
      voiceGuardUnlockUntil: toDashboardIsoTime(detail?.voiceGuardUnlockUntil),
      voiceGuardCooldownUntil: toDashboardIsoTime(detail?.voiceGuardCooldownUntil),
      voiceGuardUnlockRemainingMs: getDashboardRemainingMs(detail?.voiceGuardUnlockUntil),
      voiceGuardCooldownRemainingMs: getDashboardRemainingMs(detail?.voiceGuardCooldownUntil),
      voiceGuardMoveCount: Number(detail?.voiceGuardMoveCount || 0) || 0,
      voiceGuardWindowMoveCount: Number(detail?.voiceGuardWindowMoveCount || 0) || 0,
      voiceGuardReturnCount: Number(detail?.voiceGuardReturnCount || 0) || 0,
      voiceGuardDisconnectCount: Number(detail?.voiceGuardDisconnectCount || 0) || 0,
      voiceGuardEscalationCount: Number(detail?.voiceGuardEscalationCount || 0) || 0,
      voiceGuardLastAction: detail?.voiceGuardLastAction || null,
      voiceGuardLastActionAt: toDashboardIsoTime(detail?.voiceGuardLastActionAt),
      voiceGuardLastActionReason: detail?.voiceGuardLastActionReason || null,
      voiceGuardLastExpectedChannelId: detail?.voiceGuardLastExpectedChannelId || null,
      voiceGuardLastActualChannelId: detail?.voiceGuardLastActualChannelId || null,
    });
  }
  return rows;
}

function buildDashboardHealthSummary(serverId, runtimes, {
  liveRows = null,
  listenersNow = null,
  activeStreams = null,
  events = null,
  incidents = null,
} = {}) {
  const botRows = collectGuildBotHealthRows(runtimes, serverId);
  const activeLiveRows = Array.isArray(liveRows) ? liveRows : collectGuildLiveDetails(runtimes, serverId);
  const eventRows = Array.isArray(events) ? events : listScheduledEvents({ guildId: serverId });
  const recentIncidents = Array.isArray(incidents) ? incidents : [];
  const enabledEvents = eventRows.filter((entry) => entry?.enabled !== false);
  const nextEvent = enabledEvents
    .filter((entry) => Number.parseInt(String(entry?.runAtMs || 0), 10) > Date.now())
    .sort((a, b) => Number.parseInt(String(a?.runAtMs || 0), 10) - Number.parseInt(String(b?.runAtMs || 0), 10))[0] || null;

  const managedBots = botRows.length;
  const readyBots = botRows.filter((row) => row.ready).length;
  const liveStreamCount = Number(activeStreams ?? activeLiveRows.length) || 0;
  const activeVoiceChannels = new Set(
    activeLiveRows.map((row) => String(row?.channelId || row?.channelName || "").trim()).filter(Boolean)
  ).size;
  const recoveringStreams = activeLiveRows.filter((row) => row?.recovering === true).length;
  const degradedStreams = activeLiveRows.filter((row) => {
    if (row?.recovering === true) return false;
    const reconnectAttempts = Number(row?.reconnectAttempts || 0) || 0;
    const streamErrors = Number(row?.streamErrorCount || 0) || 0;
    return reconnectAttempts > 0 || streamErrors > 0;
  }).length;
  const reconnectAttempts = activeLiveRows.reduce((sum, row) => sum + (Number(row?.reconnectAttempts || 0) || 0), 0);
  const streamErrors = activeLiveRows.reduce((sum, row) => sum + (Number(row?.streamErrorCount || 0) || 0), 0);
  const unavailableBots = Math.max(0, managedBots - readyBots);

  let status = "healthy";
  if (managedBots <= 0 || (readyBots <= 0 && managedBots > 0)) {
    status = "critical";
  } else if (unavailableBots > 0 || recoveringStreams > 0 || degradedStreams > 0) {
    status = "warning";
  }

  const alerts = [];
  if (managedBots <= 0) {
    alerts.push({ code: "no_bot_available", severity: "critical", count: 1 });
  } else if (unavailableBots > 0) {
    alerts.push({
      code: "bot_unavailable",
      severity: readyBots <= 0 ? "critical" : "warning",
      count: unavailableBots,
    });
  }
  if (recoveringStreams > 0) {
    alerts.push({ code: "stream_recovering", severity: "warning", count: recoveringStreams });
  }
  if (degradedStreams > 0) {
    alerts.push({
      code: "stream_unstable",
      severity: streamErrors >= 3 ? "critical" : "warning",
      count: degradedStreams,
    });
  }

  return {
    status,
    managedBots,
    readyBots,
    unavailableBots,
    liveStreams: liveStreamCount,
    activeVoiceChannels,
    listenersNow: Number(listenersNow ?? 0) || 0,
    recoveringStreams,
    degradedStreams,
    reconnectAttempts,
    streamErrors,
    eventsConfigured: eventRows.length,
    eventsActive: enabledEvents.length,
    nextEventAt: nextEvent?.runAtMs ? new Date(Number(nextEvent.runAtMs)).toISOString() : null,
    nextEventTitle: clipText(nextEvent?.name || "", 120) || null,
    alerts,
    incidents: recentIncidents,
    bots: botRows,
  };
}

function buildDashboardSetupStatus(serverId, tier, runtimes, {
  liveRows = null,
} = {}) {
  const safeServerId = String(serverId || "").trim();
  const safeTier = String(tier || "free").trim().toLowerCase() || "free";
  const maxWorkerSlots = Math.max(0, Number(getPlanLimits(safeTier)?.maxBots || 0) || 0);
  const activeLiveRows = Array.isArray(liveRows) ? liveRows : collectGuildLiveDetails(runtimes, safeServerId);
  const activeStreamCount = activeLiveRows.length;
  const commanderRuntime = sortDashboardRuntimes(runtimes).find((runtime) => String(runtime?.role || "").trim() === "commander") || null;
  const commanderReady = Boolean(
    commanderRuntime?.client?.isReady?.() === true
    && commanderRuntime?.client?.guilds?.cache?.has?.(safeServerId)
  );

  const invitedWorkerCount = sortDashboardRuntimes(runtimes)
    .filter((runtime) => String(runtime?.role || "").trim() !== "commander")
    .filter((runtime) => {
      const workerSlot = Number(runtime?.workerSlot || runtime?.config?.index || 0) || 0;
      if (!workerSlot || workerSlot > maxWorkerSlots) return false;
      const detail = resolveDashboardGuildDetail(runtime, safeServerId);
      return runtimeHasGuildContext(runtime, safeServerId, detail);
    })
    .length;

  const workerInvited = invitedWorkerCount > 0;
  const firstStreamLive = activeStreamCount > 0;

  return {
    commanderReady,
    workerInvited,
    invitedWorkerCount,
    maxWorkerSlots,
    activeStreamCount,
    firstStreamLive,
    completedSteps: [commanderReady, workerInvited, firstStreamLive].filter(Boolean).length,
  };
}

async function buildGuildChannelNameMap(guild, channelIds = []) {
  const uniqueIds = [...new Set((Array.isArray(channelIds) ? channelIds : []).map((value) => String(value || "").trim()).filter(Boolean))];
  if (!guild || !uniqueIds.length) return {};

  try {
    if (typeof guild.channels?.fetch === "function") {
      await guild.channels.fetch();
    }
  } catch {
    // Ignore channel fetch failures and fall back to cached names only.
  }

  return uniqueIds.reduce((map, channelId) => {
    const channel = guild.channels?.cache?.get?.(channelId) || null;
    if (channel?.name) {
      map[channelId] = channel.name;
    }
    return map;
  }, {});
}

async function resolveGuildTextChannel(guild, channelId) {
  const normalizedChannelId = String(channelId || "").trim();
  if (!guild || !normalizedChannelId) return null;

  let channel = guild.channels?.cache?.get?.(normalizedChannelId) || null;
  if (channel) return channel;

  try {
    if (typeof guild.channels?.fetch === "function") {
      channel = await guild.channels.fetch(normalizedChannelId);
    }
  } catch {
    channel = null;
  }

  return channel || null;
}

async function buildDashboardWeeklyDigestPreviewPayload(guildInfo, runtimes, weeklyDigest, language) {
  const digest = normalizeWeeklyDigestConfig(weeklyDigest || {}, language);
  const { guild } = resolveRuntimeForGuild(runtimes, guildInfo.id);
  const stats = getGuildListeningStats(guildInfo.id) || {};
  const dailyStats = await getGuildDailyStats(guildInfo.id, 7);
  const channelNames = await buildGuildChannelNameMap(guild, digest.channelId ? [digest.channelId] : []);
  const guildName = String(guild?.name || guildInfo?.name || guildInfo?.id || "OmniFM");

  const preview = buildWeeklyDigestPreview({
    guildName,
    channelId: digest.channelId,
    channelName: channelNames[digest.channelId] || "",
    stats,
    dailyStats,
    language: digest.language || language,
    now: new Date(),
  });

  return {
    weeklyDigest: digest,
    weeklyDigestMeta: buildWeeklyDigestMeta(digest),
    preview: {
      ...preview,
      embed: buildWeeklyDigestEmbedData({
        guildName,
        channelId: digest.channelId,
        channelName: channelNames[digest.channelId] || "",
        stats,
        dailyStats,
        language: digest.language || language,
        now: preview.generatedAt,
      }),
    },
  };
}

function normalizeDashboardTelemetryPayload(rawTelemetry) {
  const source = rawTelemetry && typeof rawTelemetry === "object" ? rawTelemetry : {};
  const listenersByChannel = Array.isArray(source.listenersByChannel)
    ? source.listenersByChannel
        .filter((item) => item && typeof item === "object")
        .slice(0, 20)
        .map((item) => ({
          name: clipText(item.name || item.channel || "Voice", 80),
          listeners: Math.max(0, Number.parseInt(String(item.listeners || 0), 10) || 0),
        }))
    : [];

  const dailyReport = Array.isArray(source.dailyReport)
    ? source.dailyReport
        .filter((item) => item && typeof item === "object")
        .slice(0, 31)
        .map((item) => ({
          day: clipText(item.day || "", 20),
          starts: Math.max(0, Number.parseInt(String(item.starts || 0), 10) || 0),
          peakListeners: Math.max(0, Number.parseInt(String(item.peakListeners || 0), 10) || 0),
        }))
        .filter((item) => item.day)
    : [];

  const stationBreakdown = Array.isArray(source.stationBreakdown)
    ? source.stationBreakdown
        .filter((item) => item && typeof item === "object")
        .slice(0, 20)
        .map((item) => ({
          name: clipText(item.name || item.station || "Station", 80),
          starts: Math.max(0, Number.parseInt(String(item.starts || 0), 10) || 0),
          peakListeners: Math.max(0, Number.parseInt(String(item.peakListeners || 0), 10) || 0),
        }))
    : [];

  return {
    listenersNow: Math.max(0, Number.parseInt(String(source.listenersNow || 0), 10) || 0),
    activeStreams: Math.max(0, Number.parseInt(String(source.activeStreams || 0), 10) || 0),
    peakListeners: Math.max(0, Number.parseInt(String(source.peakListeners || 0), 10) || 0),
    peakTime: clipText(source.peakTime || "", 80),
    topStation: {
      name: clipText(source?.topStation?.name || source.topStationName || "-", 120) || "-",
      listeners: Math.max(0, Number.parseInt(String(source?.topStation?.listeners || source.topStationListeners || 0), 10) || 0),
    },
    listenersByChannel,
    dailyReport,
    stationBreakdown,
    updatedAt: clipText(source.updatedAt || new Date().toISOString(), 80),
  };
}

function buildEventInsights(events, listeningStats, nowMs = Date.now()) {
  const list = Array.isArray(events) ? events : [];
  const stationStarts = listeningStats?.stationStarts || {};
  const stationListeningMs = listeningStats?.stationListeningMs || {};
  const stationNames = listeningStats?.stationNames || {};

  const configured = list.length;
  const active = list.filter((eventRow) => eventRow?.enabled !== false).length;
  const enabledEvents = list.filter((eventRow) => eventRow?.enabled !== false);
  const nextEvent = enabledEvents
    .filter((eventRow) => Number.parseInt(String(eventRow?.runAtMs || 0), 10) > nowMs)
    .sort((a, b) => Number.parseInt(String(a?.runAtMs || 0), 10) - Number.parseInt(String(b?.runAtMs || 0), 10))[0] || null;

  const repeats = Object.entries(enabledEvents.reduce((map, eventRow) => {
    const repeat = normalizeRepeatMode(eventRow?.repeat || "none");
    map[repeat] = (map[repeat] || 0) + 1;
    return map;
  }, {}))
    .map(([repeat, count]) => ({ repeat, count: Number(count || 0) || 0 }))
    .sort((a, b) => b.count - a.count || a.repeat.localeCompare(b.repeat));

  const topStations = Object.entries(enabledEvents.reduce((map, eventRow) => {
    const stationKey = String(eventRow?.stationKey || "").trim();
    if (!stationKey) return map;
    map[stationKey] = (map[stationKey] || 0) + 1;
    return map;
  }, {}))
    .map(([stationKey, eventCount]) => ({
      stationKey,
      stationName: stationNames?.[stationKey] || stationKey,
      eventCount: Number(eventCount || 0) || 0,
      starts: Number(stationStarts?.[stationKey] || 0) || 0,
      listeningMs: Number(stationListeningMs?.[stationKey] || 0) || 0,
    }))
    .sort((a, b) => b.listeningMs - a.listeningMs || b.eventCount - a.eventCount || a.stationName.localeCompare(b.stationName))
    .slice(0, 8);

  return {
    configured,
    active,
    nextRunAt: nextEvent?.runAtMs ? new Date(Number(nextEvent.runAtMs)).toISOString() : null,
    repeats,
    topStations,
  };
}

async function buildDashboardStatsForGuild(serverId, tier, runtimes) {
  const listeningStats = getGuildListeningStats(serverId) || {};
  const telemetry = normalizeDashboardTelemetryPayload(getDashboardTelemetry(serverId));
  const liveRows = collectGuildLiveDetails(runtimes, serverId);
  const events = listScheduledEvents({ guildId: serverId });
  const permissionRules = getGuildCommandPermissionRules(serverId);
  const healthIncidents = await getRecentRuntimeIncidents(serverId, 20);

  const listenersNow = liveRows.reduce((sum, row) => sum + (Number(row.listeners || 0) || 0), 0);
  const activeStreams = liveRows.length;
  const listenersByChannel = liveRows
    .reduce((map, row) => {
      const key = row.channelId || row.channelName || row.botId || row.botName;
      const current = map.get(key) || { name: row.channelName || row.channelId || "Voice", listeners: 0 };
      current.listeners += Number(row.listeners || 0) || 0;
      map.set(key, current);
      return map;
    }, new Map());
  const telemetryStationBreakdown = Array.isArray(telemetry.stationBreakdown) ? telemetry.stationBreakdown : [];
  const telemetryStationPeakMap = telemetryStationBreakdown.reduce((map, entry) => {
    const key = clipText(entry?.name || "", 120);
    if (!key) return map;
    map.set(key, Math.max(map.get(key) || 0, Number(entry?.peakListeners || 0) || 0));
    return map;
  }, new Map());

  const stationBreakdown = Object.entries(listeningStats.stationStarts || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, starts]) => ({
      name: listeningStats.stationNames?.[name] || name,
      starts: Number(starts || 0) || 0,
      peakListeners: telemetryStationPeakMap.get(listeningStats.stationNames?.[name] || name) || 0,
    }));
  const stationTimeBreakdown = Object.entries(listeningStats.stationListeningMs || {})
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 12)
    .map(([name, listeningMs]) => ({
      name: listeningStats.stationNames?.[name] || name,
      listeningMs: Number(listeningMs || 0) || 0,
      peakListeners: telemetryStationPeakMap.get(listeningStats.stationNames?.[name] || name) || 0,
    }));

  const liveTopStation = liveRows
    .filter((row) => (Number(row.listeners || 0) || 0) > 0)
    .slice()
    .sort((a, b) => b.listeners - a.listeners || String(a.stationName).localeCompare(String(b.stationName)))[0];
  const topStationByStarts = stationBreakdown[0] || null;
  const topStationByListening = stationTimeBreakdown[0] || null;
  const historicalTopStation = topStationByListening || telemetryStationBreakdown[0] || topStationByStarts || null;
  const topStation = liveTopStation
    ? { name: liveTopStation.stationName || "-", listeners: liveTopStation.listeners || 0 }
    : telemetry.topStation?.name && telemetry.topStation.name !== "-"
      ? telemetry.topStation
      : historicalTopStation
        ? {
            name: historicalTopStation.name,
            listeners: historicalTopStation.peakListeners || 0,
            listeningMs: historicalTopStation.listeningMs || 0,
          }
        : { name: "-", listeners: 0 };

  const peakTime = telemetry.peakTime
    || (listeningStats.lastStartedAt ? new Date(listeningStats.lastStartedAt).toISOString() : "");
  const peakListeners = Math.max(
    Number(listeningStats.peakListeners || 0) || 0,
    Number(telemetry.peakListeners || 0) || 0,
    listenersNow
  );

  const basic = {
    listenersNow,
    activeStreams,
    peakListeners,
    peakTime,
    topStation,
    topStationByStarts: topStationByStarts
      ? {
          name: topStationByStarts.name || "-",
          starts: Number(topStationByStarts.starts || 0) || 0,
          peakListeners: Number(topStationByStarts.peakListeners || 0) || 0,
        }
      : null,
    topStationByListening: topStationByListening
      ? {
          name: topStationByListening.name || "-",
          listeningMs: Number(topStationByListening.listeningMs || 0) || 0,
          peakListeners: Number(topStationByListening.peakListeners || 0) || 0,
        }
      : null,
    eventsConfigured: events.length,
    eventsActive: events.filter((item) => item?.enabled !== false).length,
    permRules: Object.keys(permissionRules || {}).length,
    totalStarts: Number(listeningStats.totalStarts || 0),
    totalSessions: Number(listeningStats.totalSessions || 0),
    totalListeningMs: Number(listeningStats.currentTotalListeningMs || listeningStats.totalListeningMs || 0),
    avgSessionMs: Number(listeningStats.avgSessionMs || 0),
    longestSessionMs: Number(listeningStats.longestSessionMs || 0),
    totalConnections: Number(listeningStats.totalConnections || 0),
    totalReconnects: Number(listeningStats.totalReconnects || 0),
    totalReconnectRetries: Number(listeningStats.totalReconnectRetries || 0),
    totalConnectionDisconnects: Number(listeningStats.totalConnectionDisconnects || 0),
    totalConnectionErrors: Number(listeningStats.totalConnectionErrors || 0),
    updatedAt: telemetry.updatedAt || new Date().toISOString(),
    setupStatus: buildDashboardSetupStatus(serverId, tier, runtimes, { liveRows }),
    health: buildDashboardHealthSummary(serverId, runtimes, {
      liveRows,
      listenersNow,
      activeStreams,
      events,
      incidents: healthIncidents,
    }),
  };

  if (tier !== "ultimate") {
    return { basic, advanced: null };
  }

  const unstableStreams = liveRows
    .map((row) => {
      const streamErrors = Number(row.streamErrorCount || 0) || 0;
      const reconnectAttempts = Number(row.reconnectAttempts || 0) || 0;
      const issueScore = (streamErrors * 2) + reconnectAttempts;
      return {
        botId: row.botId,
        botName: row.botName,
        stationKey: row.stationKey,
        stationName: row.stationName,
        channelId: row.channelId,
        channelName: row.channelName,
        listeners: row.listeners,
        streamErrors,
        reconnectAttempts,
        shouldReconnect: row.shouldReconnect === true,
        issueScore,
      };
    })
    .filter((row) => row.issueScore > 0)
    .sort((a, b) => b.issueScore - a.issueScore || b.listeners - a.listeners || a.stationName.localeCompare(b.stationName))
    .slice(0, 8);

  const eventInsights = buildEventInsights(events, listeningStats);

  const advanced = {
    listenersByChannel: listenersByChannel.size
      ? [...listenersByChannel.values()].sort((a, b) => b.listeners - a.listeners || a.name.localeCompare(b.name))
      : telemetry.listenersByChannel,
    dailyReport: telemetry.dailyReport,
    stationBreakdown: stationBreakdown.length ? stationBreakdown : telemetry.stationBreakdown,
    stationTimeBreakdown,
    hours: listeningStats.hours || {},
    daysOfWeek: listeningStats.daysOfWeek || {},
    stationListeningMs: listeningStats.stationListeningMs || {},
    commands: listeningStats.commands || {},
    voiceChannels: listeningStats.voiceChannels || {},
    firstSeenAt: listeningStats.firstSeenAt || 0,
    unstableStreams,
    eventInsights,
  };

  return { basic, advanced };
}

async function buildDashboardDetailStatsPayload(guild, runtimes, days = 30) {
  const safeDays = Math.min(90, Math.max(1, Number.parseInt(String(days || "30"), 10) || 30));
  const [dailyStats, sessionHistory, connectionHealth, listenerTimeline, activeSessions] = await Promise.all([
    getGuildDailyStats(guild.id, safeDays),
    getGuildSessionHistory(guild.id, 50),
    getGuildConnectionHealth(guild.id, safeDays),
    getGuildListenerTimeline(guild.id, 24),
    Promise.resolve(getActiveSessionsForGuild(guild.id)),
  ]);

  const listeningStats = getGuildListeningStats(guild.id) || {};
  const { guild: managedGuild } = resolveRuntimeForGuild(runtimes, guild.id);
  const voiceChannelNames = await buildGuildChannelNameMap(managedGuild, [
    ...Object.keys(listeningStats.voiceChannels || {}),
    ...activeSessions.map((session) => session?.channelId).filter(Boolean),
  ]);
  const events = listScheduledEvents({ guildId: guild.id });
  const eventInsights = buildEventInsights(events, listeningStats);
  const unstableStreams = collectGuildLiveDetails(runtimes, guild.id)
    .map((row) => {
      const streamErrors = Number(row.streamErrorCount || 0) || 0;
      const reconnectAttempts = Number(row.reconnectAttempts || 0) || 0;
      const issueScore = (streamErrors * 2) + reconnectAttempts;
      return {
        botId: row.botId,
        botName: row.botName,
        stationKey: row.stationKey,
        stationName: row.stationName,
        channelId: row.channelId,
        channelName: row.channelName,
        listeners: row.listeners,
        streamErrors,
        reconnectAttempts,
        shouldReconnect: row.shouldReconnect === true,
        issueScore,
      };
    })
    .filter((row) => row.issueScore > 0)
    .sort((a, b) => b.issueScore - a.issueScore || b.listeners - a.listeners || a.stationName.localeCompare(b.stationName))
    .slice(0, 12);
  const connectionHealthWithIds = {
    ...connectionHealth,
    events: Array.isArray(connectionHealth?.events)
      ? connectionHealth.events.map((event) => ({
        ...event,
        id: event?.id || buildDashboardConnectionEventEntryId(event),
      }))
      : [],
  };

  return {
    serverId: guild.id,
    tier: guild.tier,
    days: safeDays,
    listeningStats: {
      totalListeningMs: listeningStats.currentTotalListeningMs || listeningStats.totalListeningMs || 0,
      totalSessions: listeningStats.totalSessions || 0,
      avgSessionMs: listeningStats.avgSessionMs || 0,
      longestSessionMs: listeningStats.longestSessionMs || 0,
      totalStarts: listeningStats.totalStarts || 0,
      peakListeners: listeningStats.peakListeners || 0,
      stationStarts: listeningStats.stationStarts || {},
      stationListeningMs: listeningStats.stationListeningMs || {},
      stationNames: listeningStats.stationNames || {},
      hours: listeningStats.hours || {},
      daysOfWeek: listeningStats.daysOfWeek || {},
      commands: listeningStats.commands || {},
      voiceChannels: listeningStats.voiceChannels || {},
      voiceChannelNames,
      firstSeenAt: listeningStats.firstSeenAt || 0,
    },
    dailyStats,
    sessionHistory: sessionHistory.map((s) => ({
      id: buildDashboardSessionHistoryEntryId(s),
      stationKey: s.stationKey,
      stationName: s.stationName,
      channelId: s.channelId,
      startedAt: s.startedAt,
      endedAt: s.endedAt,
      durationMs: s.durationMs,
      humanListeningMs: s.humanListeningMs,
      peakListeners: s.peakListeners,
      avgListeners: s.avgListeners,
    })),
    connectionHealth: connectionHealthWithIds,
    connectionWindowDays: safeDays,
    listenerTimeline,
    unstableStreams,
    eventInsights,
    activeSessions: activeSessions.map((s) => ({
      botId: s.botId,
      stationKey: s.stationKey,
      stationName: s.stationName,
      channelId: s.channelId,
      currentDurationMs: s.currentDurationMs,
      currentHumanListeningMs: s.currentHumanListeningMs,
      currentAvgListeners: s.currentAvgListeners,
      currentListeners: s.currentListeners,
      peakListeners: s.peakListeners,
    })),
  };
}

function normalizeDashboardRoleToken(rawValue) {
  const text = String(rawValue || "").trim();
  if (!text) return "";
  const mention = text.match(/^<@&(\d{17,22})>$/);
  if (mention) return mention[1];
  return text;
}

async function resolveGuildRoleIds(guild, rawRoles) {
  const roleIds = [];
  const unresolved = [];
  const seen = new Set();
  const roleCollection = guild?.roles?.cache || new Map();

  if (guild?.roles?.fetch) {
    try {
      await guild.roles.fetch();
    } catch {}
  }

  for (const rawRole of Array.isArray(rawRoles) ? rawRoles : []) {
    const token = normalizeDashboardRoleToken(rawRole);
    if (!token) continue;

    let roleId = /^\d{17,22}$/.test(token) ? token : "";
    if (!roleId) {
      const lowerToken = token.toLowerCase();
      const match = [...roleCollection.values()].find((role) => String(role?.name || "").trim().toLowerCase() === lowerToken);
      roleId = String(match?.id || "").trim();
    }

    if (!/^\d{17,22}$/.test(roleId)) {
      unresolved.push(token);
      continue;
    }
    if (seen.has(roleId)) continue;
    seen.add(roleId);
    roleIds.push(roleId);
  }

  return { roleIds, unresolved };
}

function formatDashboardPermissionMapForClient(commandRules, guild) {
  const output = {};
  const roleCollection = guild?.roles?.cache || new Map();
  const supportedCommands = getSupportedPermissionCommands();

  for (const command of supportedCommands) {
    const rule = commandRules?.[command];
    const allowRoleIds = Array.isArray(rule?.allowRoleIds) ? rule.allowRoleIds : [];
    output[command] = allowRoleIds.map((roleId) => roleCollection.get(roleId)?.name || roleId);
  }

  return output;
}

function formatDashboardPermissionRulesForClient(commandRules, guild) {
  const roleCollection = guild?.roles?.cache || new Map();
  return getSupportedPermissionCommands().map((command) => {
    const rule = commandRules?.[command];
    const allowRoleIds = Array.isArray(rule?.allowRoleIds) ? [...new Set(rule.allowRoleIds)] : [];
    return {
      command,
      allowRoleIds,
      allowRoles: allowRoleIds.map((roleId) => ({
        id: roleId,
        name: roleCollection.get(roleId)?.name || roleId,
      })),
    };
  });
}

function extractDashboardPermissionRuleTokens(rawRule) {
  const tokens = [];
  for (const roleId of Array.isArray(rawRule?.allowRoleIds) ? rawRule.allowRoleIds : []) {
    tokens.push(roleId);
  }
  for (const roleEntry of Array.isArray(rawRule?.allowRoles) ? rawRule.allowRoles : []) {
    if (typeof roleEntry === "string") {
      tokens.push(roleEntry);
      continue;
    }
    if (!roleEntry || typeof roleEntry !== "object") continue;
    tokens.push(roleEntry.id || roleEntry.roleId || roleEntry.name || "");
  }
  return tokens.filter(Boolean);
}

async function resolveDashboardPermissionRuleUpdates(guild, body) {
  const supportedCommands = getSupportedPermissionCommands();
  const unresolved = [];
  const resolvedCommands = [];

  if (Array.isArray(body?.rules)) {
    for (const rawRule of body.rules) {
      const command = String(rawRule?.command || "").trim().replace(/^\//, "").toLowerCase();
      if (!supportedCommands.includes(command)) continue;
      const resolved = await resolveGuildRoleIds(guild, extractDashboardPermissionRuleTokens(rawRule));
      if (resolved.unresolved.length) {
        unresolved.push(`${command}: ${resolved.unresolved.join(", ")}`);
        continue;
      }
      resolvedCommands.push({ command, roleIds: resolved.roleIds });
    }
    return { supportedCommands, unresolved, resolvedCommands };
  }

  const incomingMap = body?.commandRoleMap && typeof body.commandRoleMap === "object"
    ? body.commandRoleMap
    : {};
  for (const [rawCommand, rawRoles] of Object.entries(incomingMap)) {
    const command = String(rawCommand || "").trim().replace(/^\//, "").toLowerCase();
    if (!supportedCommands.includes(command)) continue;
    const resolved = await resolveGuildRoleIds(guild, rawRoles);
    if (resolved.unresolved.length) {
      unresolved.push(`${command}: ${resolved.unresolved.join(", ")}`);
      continue;
    }
    resolvedCommands.push({ command, roleIds: resolved.roleIds });
  }
  return { supportedCommands, unresolved, resolvedCommands };
}

function hasOwnDashboardField(payload, field) {
  return Object.prototype.hasOwnProperty.call(payload, field);
}

function formatDashboardDateTimeLocal(runAtMs, timeZone = EVENT_FALLBACK_TIME_ZONE) {
  const utcMs = Number.parseInt(String(runAtMs || 0), 10);
  if (!Number.isFinite(utcMs) || utcMs <= 0) return "";

  const zoned = getZonedPartsFromUtcMs(
    utcMs,
    normalizeEventTimeZone(timeZone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE
  );
  const pad = (value) => String(value || 0).padStart(2, "0");
  return `${zoned.year}-${pad(zoned.month)}-${pad(zoned.day)}T${pad(zoned.hour)}:${pad(zoned.minute)}`;
}

function buildDashboardEventResponse(eventRow) {
  const runAtMs = Number.parseInt(String(eventRow?.runAtMs || 0), 10);
  const timezone = normalizeEventTimeZone(eventRow?.timeZone || eventRow?.timezone, EVENT_FALLBACK_TIME_ZONE)
    || EVENT_FALLBACK_TIME_ZONE;
  const discordScheduledEventId = String(eventRow?.discordScheduledEventId || "").trim() || null;
  const discordSyncError = clipText(eventRow?.discordSyncError || "", 300) || null;

  return {
    id: String(eventRow?.id || ""),
    title: eventRow?.name || "OmniFM Event",
    stationKey: eventRow?.stationKey || "",
    startsAt: runAtMs > 0 ? new Date(runAtMs).toISOString() : "",
    startsAtLocal: formatDashboardDateTimeLocal(runAtMs, timezone),
    timezone,
    channelId: eventRow?.voiceChannelId || "",
    textChannelId: eventRow?.textChannelId || "",
    enabled: eventRow?.enabled !== false,
    repeat: normalizeRepeatMode(eventRow?.repeat || "none"),
    repeatLabelDe: getRepeatLabel(eventRow?.repeat || "none", "de", { runAtMs, timeZone: timezone }),
    repeatLabelEn: getRepeatLabel(eventRow?.repeat || "none", "en", { runAtMs, timeZone: timezone }),
    durationMs: Number(eventRow?.durationMs || 0),
    announceMessage: eventRow?.announceMessage || "",
    description: eventRow?.description || "",
    stageTopic: eventRow?.stageTopic || "",
    createDiscordEvent: eventRow?.createDiscordEvent === true,
    discordScheduledEventId,
    discordEventSynced: eventRow?.createDiscordEvent === true && Boolean(discordScheduledEventId) && !discordSyncError,
    discordSyncError,
    createdByUserId: eventRow?.createdByUserId || "",
    createdAt: eventRow?.createdAt || new Date().toISOString(),
    updatedAt: eventRow?.updatedAt || eventRow?.createdAt || new Date().toISOString(),
  };
}

function buildDashboardPreviewOccurrenceRow(runAtMs, durationMs, timezone) {
  const safeRunAtMs = Number.parseInt(String(runAtMs || 0), 10);
  const safeDurationMs = Math.max(0, Number(durationMs || 0) || 0);
  const safeTimezone = normalizeEventTimeZone(timezone, EVENT_FALLBACK_TIME_ZONE) || EVENT_FALLBACK_TIME_ZONE;
  const endAtMs = safeDurationMs > 0 ? safeRunAtMs + safeDurationMs : 0;

  return {
    runAtMs: safeRunAtMs,
    durationMs: safeDurationMs,
    startsAt: safeRunAtMs > 0 ? new Date(safeRunAtMs).toISOString() : "",
    startsAtLocal: formatDashboardDateTimeLocal(safeRunAtMs, safeTimezone),
    endsAt: endAtMs > 0 ? new Date(endAtMs).toISOString() : "",
    endsAtLocal: endAtMs > 0 ? formatDashboardDateTimeLocal(endAtMs, safeTimezone) : "",
  };
}

function buildDashboardSchedulePreviewRows(eventRow, limit = 5) {
  const rows = [];
  const safeLimit = Math.max(1, Math.min(10, Number(limit || 5) || 5));
  const repeat = normalizeRepeatMode(eventRow?.repeat || "none");
  const timezone = normalizeEventTimeZone(eventRow?.timeZone || eventRow?.timezone, EVENT_FALLBACK_TIME_ZONE)
    || EVENT_FALLBACK_TIME_ZONE;
  let runAtMs = Number.parseInt(String(eventRow?.runAtMs || 0), 10);
  const durationMs = Math.max(0, Number(eventRow?.durationMs || 0) || 0);

  for (let index = 0; index < safeLimit; index += 1) {
    if (!Number.isFinite(runAtMs) || runAtMs <= 0) break;
    rows.push(buildDashboardPreviewOccurrenceRow(runAtMs, durationMs, timezone));
    if (repeat === "none") break;
    runAtMs = computeNextEventRunAtMs(runAtMs, repeat, runAtMs, timezone);
  }

  return rows;
}

function buildDashboardEventConflicts(candidateEvent, scheduledEvents, { language = "de", ignoreEventId = "" } = {}) {
  const candidateRows = buildDashboardSchedulePreviewRows(candidateEvent, 5);
  const seen = new Set();
  const conflicts = [];
  const candidateDurationMs = Math.max(0, Number(candidateEvent?.durationMs || 0) || 0);

  for (const existingEvent of Array.isArray(scheduledEvents) ? scheduledEvents : []) {
    if (!existingEvent || existingEvent.enabled === false) continue;
    if (String(existingEvent.id || "") === String(ignoreEventId || "")) continue;
    if (String(existingEvent.voiceChannelId || "") !== String(candidateEvent?.voiceChannelId || "")) continue;

    const existingRows = buildDashboardSchedulePreviewRows(existingEvent, 5);
    const existingDurationMs = Math.max(0, Number(existingEvent?.durationMs || 0) || 0);
    const existingResponse = buildDashboardEventResponse(existingEvent);

    for (const candidateRow of candidateRows) {
      for (const existingRow of existingRows) {
        let severity = "";
        let message = "";

        if (candidateDurationMs > 0 && existingDurationMs > 0) {
          const candidateEndAtMs = candidateRow.runAtMs + candidateDurationMs;
          const existingEndAtMs = existingRow.runAtMs + existingDurationMs;
          if (candidateRow.runAtMs < existingEndAtMs && existingRow.runAtMs < candidateEndAtMs) {
            severity = "error";
            message = languagePick(
              language,
              `Überlappt mit "${existingEvent.name}" im selben Voice-Channel.`,
              `Overlaps with "${existingEvent.name}" in the same voice channel.`
            );
          }
        } else if (candidateDurationMs <= 0 && existingRow.runAtMs >= candidateRow.runAtMs) {
          severity = "warning";
          message = languagePick(
            language,
            `Dieses Event hat kein Enddatum und könnte "${existingEvent.name}" blockieren.`,
            `This event has no end time and may block "${existingEvent.name}".`
          );
        } else if (existingDurationMs <= 0 && existingRow.runAtMs <= candidateRow.runAtMs) {
          severity = "warning";
          message = languagePick(
            language,
            `"${existingEvent.name}" hat kein Enddatum und könnte dieses Event blockieren.`,
            `"${existingEvent.name}" has no end time and may block this event.`
          );
        }

        if (!severity || !message) continue;

        const key = `${existingEvent.id}:${candidateRow.runAtMs}:${existingRow.runAtMs}:${severity}`;
        if (seen.has(key)) continue;
        seen.add(key);
        conflicts.push({
          severity,
          message,
          eventId: existingResponse.id,
          title: existingResponse.title,
          repeat: existingResponse.repeat,
          repeatLabelDe: existingResponse.repeatLabelDe,
          repeatLabelEn: existingResponse.repeatLabelEn,
          startsAt: existingRow.startsAt,
          startsAtLocal: existingRow.startsAtLocal,
          endsAt: existingRow.endsAt,
          endsAtLocal: existingRow.endsAtLocal,
          channelId: existingResponse.channelId,
        });
      }
    }
  }

  return conflicts.sort((a, b) => {
    const severityOrder = { error: 0, warning: 1 };
    const severityDelta = (severityOrder[a.severity] ?? 99) - (severityOrder[b.severity] ?? 99);
    if (severityDelta !== 0) return severityDelta;
    return String(a.startsAt || "").localeCompare(String(b.startsAt || ""));
  });
}

function parseDashboardStartsAtInput(payload) {
  const localRaw = String(payload?.startsAtLocal || "").trim();
  if (localRaw) {
    return { mode: "local", value: localRaw };
  }

  const legacyRaw = String(payload?.startsAt || payload?.startAt || "").trim();
  if (legacyRaw) {
    return { mode: "legacy_iso", value: legacyRaw };
  }

  return { mode: "unchanged", value: "" };
}

async function validateDashboardEventChannels(runtime, guild, event, language = "de") {
  if (!runtime || !guild) {
    return {
      ok: false,
      message: languagePick(language, "Der Bot ist auf diesem Server aktuell nicht verfügbar.", "The bot is currently unavailable on this server."),
    };
  }

  const me = await runtime.resolveBotMember(guild);
  if (!me) {
    return { ok: false, message: languagePick(language, "Bot-Mitglied im Server konnte nicht geladen werden.", "Could not load the bot member in this server.") };
  }

  const { channel: voiceChannel } = await runtime.resolveGuildVoiceChannel(guild.id, event.voiceChannelId);
  if (!voiceChannel) {
    return { ok: false, message: languagePick(language, "Bitte wähle einen Voice- oder Stage-Channel.", "Please choose a voice or stage channel.") };
  }
  if (event.stageTopic && voiceChannel.type !== ChannelType.GuildStageVoice) {
    return { ok: false, message: languagePick(language, "`stagetopic` funktioniert nur mit Stage-Channels.", "`stagetopic` only works with stage channels.") };
  }

  const voicePerms = voiceChannel.permissionsFor(me);
  if (!voicePerms?.has(PermissionFlagsBits.Connect)) {
    return {
      ok: false,
      message: languagePick(
        language,
        `Ich habe keine Connect-Berechtigung für ${voiceChannel.toString()}.`,
        `I do not have Connect permission for ${voiceChannel.toString()}.`
      ),
    };
  }
  if (voiceChannel.type !== ChannelType.GuildStageVoice && !voicePerms?.has(PermissionFlagsBits.Speak)) {
    return {
      ok: false,
      message: languagePick(
        language,
        `Ich habe keine Speak-Berechtigung für ${voiceChannel.toString()}.`,
        `I do not have Speak permission for ${voiceChannel.toString()}.`
      ),
    };
  }
  if (event.createDiscordEvent) {
    const eventPermError = runtime.validateDiscordScheduledEventPermissions(guild, voiceChannel, language);
    if (eventPermError) {
      return { ok: false, message: eventPermError };
    }
  }

  let textChannel = null;
  if (event.textChannelId) {
    textChannel = guild.channels?.cache?.get(event.textChannelId) || null;
    if (!textChannel && guild.channels?.fetch) {
      textChannel = await guild.channels.fetch(event.textChannelId).catch(() => null);
    }
    if (!textChannel || textChannel.guildId !== guild.id || typeof textChannel.send !== "function") {
      return {
        ok: false,
        message: languagePick(
          language,
          "Der gewählte Text-Channel ist nicht in diesem Server.",
          "The selected text channel is not in this server."
        ),
      };
    }

    const textPerms = textChannel.permissionsFor(me);
    if (!textPerms?.has(PermissionFlagsBits.ViewChannel) || !textPerms?.has(PermissionFlagsBits.SendMessages)) {
      return {
        ok: false,
        message: languagePick(
          language,
          `Ich kann in ${textChannel.toString()} nicht schreiben.`,
          `I cannot send messages in ${textChannel.toString()}.`
        ),
      };
    }
  }

  return { ok: true, voiceChannel, textChannel };
}

function buildDashboardDiscordSyncPatch(event, { discordScheduledEventId = null, discordSyncError = null } = {}) {
  return {
    discordScheduledEventId: discordScheduledEventId || null,
    discordSyncError: clipText(discordSyncError || "", 300) || null,
  };
}

async function normalizeDashboardEventInput(body, {
  guildId,
  botId,
  runtime,
  existingEvent = null,
  language = "de",
} = {}) {
  const payload = body && typeof body === "object" ? body : {};
  const title = clipText(
    hasOwnDashboardField(payload, "title") || hasOwnDashboardField(payload, "name")
      ? payload.title || payload.name
      : (existingEvent?.name || "OmniFM Event"),
    120
  ).trim();
  const stationKey = clipText(
    hasOwnDashboardField(payload, "stationKey") || hasOwnDashboardField(payload, "station")
      ? payload.stationKey || payload.station
      : (existingEvent?.stationKey || ""),
    120
  ).trim().toLowerCase();
  const channelId = String(
    hasOwnDashboardField(payload, "channelId") || hasOwnDashboardField(payload, "voiceChannelId")
      ? payload.channelId || payload.voiceChannelId
      : (existingEvent?.voiceChannelId || "")
  ).trim();
  const textChannelId = String(
    hasOwnDashboardField(payload, "textChannelId")
      ? payload.textChannelId || ""
      : (existingEvent?.textChannelId || "")
  ).trim();
  const timezoneInput = clipText(
    hasOwnDashboardField(payload, "timezone")
      ? payload.timezone
      : (existingEvent?.timeZone || EVENT_FALLBACK_TIME_ZONE),
    80
  );
  const timezone = normalizeEventTimeZone(timezoneInput, EVENT_FALLBACK_TIME_ZONE);
  const repeat = normalizeRepeatMode(
    hasOwnDashboardField(payload, "repeat")
      ? payload.repeat
      : (existingEvent?.repeat || "none")
  );
  const durationMs = Math.max(
    0,
    Number(
      hasOwnDashboardField(payload, "durationMs")
        ? payload.durationMs
        : (existingEvent?.durationMs || 0)
    ) || 0
  );
  const announceMessage = hasOwnDashboardField(payload, "announceMessage")
    ? runtime.normalizeClearableText(payload.announceMessage, 1200)
    : (existingEvent?.announceMessage || null);
  const description = hasOwnDashboardField(payload, "description")
    ? runtime.normalizeClearableText(payload.description, 800)
    : (existingEvent?.description || null);
  const stageTopic = hasOwnDashboardField(payload, "stageTopic")
    ? runtime.normalizeClearableText(payload.stageTopic, 120)
    : (existingEvent?.stageTopic || null);
  const createDiscordEvent = hasOwnDashboardField(payload, "createDiscordEvent")
    ? payload.createDiscordEvent === true
    : existingEvent?.createDiscordEvent === true;
  const enabled = hasOwnDashboardField(payload, "enabled")
    ? payload.enabled !== false
    : existingEvent?.enabled !== false;

  if (!title) return { ok: false, message: languagePick(language, "Titel fehlt.", "Title is required.") };
  if (!stationKey) return { ok: false, message: languagePick(language, "Station-Key fehlt.", "Station key is required.") };
  if (!/^\d{17,22}$/.test(channelId)) return { ok: false, message: languagePick(language, "Voice-Channel-ID fehlt oder ist ungültig.", "Voice channel ID is missing or invalid.") };
  if (textChannelId && !/^\d{17,22}$/.test(textChannelId)) return { ok: false, message: languagePick(language, "Text-Channel-ID ist ungültig.", "Text channel ID is invalid.") };
  if (!timezone) return { ok: false, message: languagePick(language, "Zeitzone ist ungültig.", "Time zone is invalid.") };
  if (!botId) return { ok: false, message: languagePick(language, "Kein geeigneter Bot für dieses Event gefunden.", "No suitable bot was found for this event.") };

  const startInput = parseDashboardStartsAtInput(payload);
  let parsedWindow;
  if (startInput.mode === "legacy_iso") {
    const parsedRunAtMs = Date.parse(startInput.value);
    if (!Number.isFinite(parsedRunAtMs) || parsedRunAtMs <= 0) {
      return { ok: false, message: languagePick(language, "Startzeit ist ungültig.", "Start time is invalid.") };
    }
    parsedWindow = {
      ok: true,
      runAtMs: parsedRunAtMs,
      timeZone: timezone,
      durationMs,
      endAtMs: durationMs > 0 ? parsedRunAtMs + durationMs : 0,
    };
  } else if (startInput.mode === "local") {
    const now = Date.now();
    const parsedStart = buildEventDateTimeFromParts({
      rawDateTime: startInput.value,
      language,
      preferredTimeZone: timezone,
      fallbackRunAtMs: existingEvent?.runAtMs || now,
      nowMs: now,
    });
    if (!parsedStart?.ok) {
      return {
        ok: false,
        message: parsedStart?.message || languagePick(language, "Startzeit ist ungÃ¼ltig.", "Start time is invalid."),
      };
    }

    let runAtMs = Number.parseInt(String(parsedStart.runAtMs || 0), 10);
    const resolvedTimeZone = parsedStart.timeZone || timezone;
    let endAtMs = durationMs > 0 ? runAtMs + durationMs : 0;

    if (!createDiscordEvent && runAtMs <= (now + 60_000) && runAtMs >= (now - 60_000)) {
      runAtMs = now;
      endAtMs = durationMs > 0 ? runAtMs + durationMs : 0;
    }

    parsedWindow = {
      ok: true,
      runAtMs,
      timeZone: resolvedTimeZone,
      durationMs,
      endAtMs,
    };
  } else {
    parsedWindow = runtime.parseEventWindowInput({
      startRaw: startInput.mode === "local" ? startInput.value : undefined,
      baseRunAtMs: existingEvent?.runAtMs || 0,
      baseDurationMs: durationMs,
      requestedTimeZone: timezone,
      allowImmediate: !createDiscordEvent,
    }, language);
  }
  if (!parsedWindow?.ok) {
    return { ok: false, message: parsedWindow?.message || languagePick(language, "Startzeit ist ungültig.", "Start time is invalid.") };
  }
  if (createDiscordEvent && parsedWindow.runAtMs < Date.now() + 60_000) {
    return {
      ok: false,
      message: languagePick(
        language,
        "Mit Discord-Server-Event muss die Startzeit mindestens 60 Sekunden in der Zukunft liegen.",
        "With a Discord server event, the start time must be at least 60 seconds in the future."
      ),
    };
  }
  if (repeat === "weekdays" && !isWorkdayInTimeZone(parsedWindow.runAtMs, parsedWindow.timeZone || timezone)) {
    return {
      ok: false,
      message: languagePick(
        language,
        "Für Werktags-Wiederholung muss die Startzeit auf Montag bis Freitag liegen.",
        "For weekday recurrence, the start time must fall on Monday to Friday."
      ),
    };
  }

  const station = runtime.resolveStationForGuild(guildId, stationKey, language);
  if (!station.ok) {
    return { ok: false, message: station.message };
  }

  return {
    ok: true,
    station,
    parsedWindow,
    event: {
      guildId,
      botId,
      name: title,
      stationKey: station.key,
      voiceChannelId: channelId,
      textChannelId: textChannelId || null,
      announceMessage: announceMessage || null,
      description: description || null,
      stageTopic: stageTopic || null,
      timeZone: parsedWindow.timeZone || timezone,
      createDiscordEvent,
      repeat,
      runAtMs: parsedWindow.runAtMs,
      durationMs: parsedWindow.durationMs > 0 ? parsedWindow.durationMs : 0,
      enabled,
    },
  };
}

function resolveAdminPanelToken() {
  return String(
    process.env.ADMIN_TOKEN
    || getAdminApiToken()
    || process.env.OMNIFM_ADMIN_TOKEN
    || ""
  ).trim();
}

const DASHBOARD_CSRF_HEADER = "x-omnifm-csrf";
const DASHBOARD_CSRF_INTENT = "dashboard-intent";
const DASHBOARD_MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isDashboardSessionMutation(req, requestUrl) {
  const method = String(req?.method || "GET").toUpperCase();
  if (!DASHBOARD_MUTATION_METHODS.has(method)) return false;

  const pathname = String(requestUrl?.pathname || "");
  if (pathname === "/api/auth/logout") return true;
  if (pathname === "/api/dashboard/telemetry") return false;
  return pathname.startsWith("/api/dashboard/");
}

function enforceDashboardMutationIntent(req, res, requestUrl) {
  if (!isDashboardSessionMutation(req, requestUrl)) return true;

  const headerValue = String(req.headers[DASHBOARD_CSRF_HEADER] || "").trim();
  if (headerValue === DASHBOARD_CSRF_INTENT) return true;

  const language = resolveDashboardRequestLanguage(req, requestUrl);
  sendJson(res, 403, {
    error: languagePick(
      language,
      "Dashboard-Aktion blockiert: CSRF-Intent-Header fehlt oder ist ungültig.",
      "Dashboard action blocked: CSRF intent header is missing or invalid."
    ),
  });
  return false;
}

// WICHTIG: _runtimes muss VOR createAdminRoutesHandler deklariert sein,
// da der getter sonst in die TDZ (Temporal Dead Zone) läuft.
let _runtimes = [];

const handleAdminRoutes = createAdminRoutesHandler({
  resolveAdminToken: resolveAdminPanelToken,
  getRuntimes: () => _runtimes,
  getStationHealthReport,
  listLicenses,
  patchLicenseById,
  loadStations,
  log,
  methodNotAllowed,
  sendJson,
  getRecentOperatorIncidents,
  getCommonSecurityHeaders,
  getReleaseInfo: () => buildReleaseInfo({ frontendBuildStamp, webRootSource }),
  getBinaryHealthProbe: getHealthBinaryProbe,
  buildPublicLegalNotice,
  buildPublicPrivacyNotice,
  buildPublicTermsNotice,
  listOffers,
  listRecentRedemptions,
  setOfferActive,
});

function startWebServer(runtimes) {
  _runtimes = runtimes;
  const webInternalPort = Number(process.env.WEB_INTERNAL_PORT || "8080");
  const webPort = Number(process.env.WEB_PORT || "8081");
  const webBind = process.env.WEB_BIND || "0.0.0.0";
  const publicUrl = String(process.env.PUBLIC_WEB_URL || "").trim();

  const server = http.createServer(async (req, res) => {
    let requestUrl;
    try {
      requestUrl = new URL(req.url || "/", "http://localhost");
    } catch {
      sendJson(res, 400, { error: "Ungültige Request-URL." });
      return;
    }

    // Owner/admin routes use their own token/cookie auth and must not be
    // blocked by generic frontend CORS when a reverse proxy rewrites Host.
    if (requestUrl.pathname === "/admin" || requestUrl.pathname === "/admin/" || requestUrl.pathname.startsWith("/api/admin/")) {
      if (await handleAdminRoutes({ req, res, requestUrl })) {
        return;
      }
    }

    // CORS
    const originAllowed = applyCors(req, res, publicUrl);
    if (req.method === "OPTIONS") {
      if (!originAllowed) {
        sendJson(res, 403, { error: "Origin nicht erlaubt." });
        return;
      }
      res.writeHead(204, { ...getCommonSecurityHeaders() });
      res.end();
      return;
    }
    if (!originAllowed) {
      sendJson(res, 403, { error: "Origin nicht erlaubt." });
      return;
    }

    if (!enforceApiRateLimit(req, res, requestUrl.pathname)) {
      return;
    }

    if (!enforceDashboardMutationIntent(req, res, requestUrl)) {
      return;
    }

    // --- Helper to read request body ---
    function readRawBody(maxBytes = 1024 * 1024) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;

        const fail = (status, message, err = null) => {
          if (settled) return;
          settled = true;
          const error = err || new Error(message);
          error.status = status;
          reject(error);
        };

        req.on("data", (chunk) => {
          if (settled) return;
          size += chunk.length;
          if (size > maxBytes) {
            fail(413, "Body too large");
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
        req.on("error", (err) => fail(400, err?.message || "Body read error", err));
      });
    }

    async function readJsonBody() {
      const raw = await readRawBody();
      if (!raw.trim()) return {};
      try {
        return JSON.parse(raw);
      } catch {
        const err = new Error("Invalid JSON");
        err.status = 400;
        throw err;
      }
    }

    // --- API routes ---
    if (await handlePublicRoutes({ req, res, requestUrl, runtimes })) {
      return;
    }

    if (await handleAuthRoutes({ req, res, requestUrl, publicUrl })) {
      return;
    }

    if (await handleDashboardAccessRoute({ req, res, requestUrl })) {
      return;
    }

    if (await handleDiscordBotListRoutes({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    if (await handleBotsGGRoutes({ req, res, requestUrl, runtimes })) {
      return;
    }

    if (await handleTopGGRoutes({ req, res, requestUrl, readJsonBody, readRawBody, runtimes })) {
      return;
    }

    if (await handleVoteEventsRoutes({ req, res, requestUrl })) {
      return;
    }

    if (await handleDashboardStatsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    if (await handleDashboardTelemetryRoute({ req, res, requestUrl, readJsonBody })) {
      return;
    }
    if (await handleDashboardEventsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    if (await handleDashboardPermsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }
    if (await handleDashboardChannelsRoute({ req, res, requestUrl, runtimes })) {
      return;
    }
    if (await handleDashboardEmojisRoute({ req, res, requestUrl, runtimes })) {
      return;
    }

    if (await handleDashboardStationsRoute({ req, res, requestUrl })) {
      return;
    }

    if (await handleDashboardCustomStationsRoute({ req, res, requestUrl, readJsonBody })) {
      return;
    }
    if (await handleDashboardRolesRoute({ req, res, requestUrl, runtimes })) {
      return;
    }

    if (await handleDashboardLicenseRoute({ req, res, requestUrl, readJsonBody })) {
      return;
    }

    if (await handleDashboardSettingsDigestRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    if (await handleDashboardExportsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    if (await handleDashboardSettingsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    // --- Premium API ---
    if (await handlePremiumReadRoutes({ req, res, requestUrl, runtimes })) {
      return;
    }

    if (await handlePremiumBillingRoutes({ req, res, requestUrl, readJsonBody, readRawBody, runtimes, publicUrl })) {
      return;
    }

    if (await handlePremiumOffersRoutes({ req, res, requestUrl, readJsonBody })) {
      return;
    }

    // --- Admin Panel (versteckt, Token-geschützt) ---
    if (await handleAdminRoutes({ req, res, requestUrl })) {
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "API route not found." });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      methodNotAllowed(res, ["GET", "HEAD"]);
      return;
    }

    // --- Static file serving from the built frontend ---
    const normalizedPathname = normalizeSpaPathname(requestUrl.pathname);
    if (normalizedPathname === "/favicon.ico") {
      const faviconFile = path.join(webDir, "img", "bot-1.png");
      sendStaticFile(res, faviconFile, { headOnly: req.method === "HEAD" });
      return;
    }

    // Dashboard SPA: /dashboard und /dashboard/* → dashboard.html
    if (normalizedPathname === "/dashboard" || normalizedPathname.startsWith("/dashboard/")) {
      const legacyDashboardFile = path.join(webDir, "dashboard.html");
      const dashboardFile = fs.existsSync(legacyDashboardFile)
        ? legacyDashboardFile
        : path.join(webDir, "index.html");
      sendStaticFile(res, dashboardFile, { headOnly: req.method === "HEAD" });
      return;
    }

    const shouldServeSpaEntry = SPA_ENTRY_PATHS.has(normalizedPathname);
    const staticPath = shouldServeSpaEntry
      ? "index.html"
      : (normalizedPathname === "/" ? "index.html" : normalizedPathname.replace(/^\/+/, ""));
    const filePath = path.join(webDir, staticPath);

    // 404-Fallback: Wenn statische Datei nicht existiert → 404.html
    const notFoundFile = fs.existsSync(path.join(webDir, "404.html"))
      ? path.join(webDir, "404.html")
      : path.join(rootDir, "web", "404.html");
    sendStaticFile(res, filePath, {
      headOnly: req.method === "HEAD",
      notFoundPath: notFoundFile,
    });
  });

  server.listen(webInternalPort, webBind, () => {
    log("INFO", `Webseite aktiv (container) auf http://${webBind}:${webInternalPort}`);
    log("INFO", `Webseite Host-Port: ${webPort}`);
    log("INFO", `Web-Static-Root: ${webDir}`);
    log("INFO", `Web-Root-Quelle: ${webRootSource}`);
    if (frontendBuildStamp) {
      log("INFO", `Frontend-Build-Timestamp: ${frontendBuildStamp}`);
    }
    if (publicUrl) {
      log("INFO", `Public URL: ${publicUrl}`);
    }
  });

  return server;
}

export { startWebServer };
