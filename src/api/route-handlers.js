// OmniFM API: every route handler of the Node API, wired with its helpers.
// Split out of src/api/server.js (#293).
import { createDashboardChannelsRouteHandler } from "./routes/dashboard-channels.js";
import { createDashboardPlaybackRouteHandler } from "./routes/dashboard-playback.js";
import { createAuthRoutesHandler } from "./routes/auth-routes.js";
import { createDashboardCustomStationsRouteHandler } from "./routes/dashboard-custom-stations.js";
import { createDashboardAccessRouteHandler } from "./routes/dashboard-access.js";
import { createDashboardEmojisRouteHandler } from "./routes/dashboard-emojis.js";
import { createDashboardEventsRouteHandler } from "./routes/dashboard-events.js";
import { createDashboardExportsRouteHandler } from "./routes/dashboard-exports.js";
import { createDashboardLicenseRouteHandler } from "./routes/dashboard-license.js";
import { createDashboardPermsRouteHandler } from "./routes/dashboard-perms.js";
import { createDashboardBotProfileRouteHandler } from "./routes/dashboard-bot-profile.js";
import { createDashboardPanelDesignRouteHandler } from "./routes/dashboard-panel-design.js";
import { createDashboardRolesRouteHandler } from "./routes/dashboard-roles.js";
import { createDashboardSettingsDigestRouteHandler } from "./routes/dashboard-settings-digest.js";
import { buildWeeklyDigestMessage } from "../services/weekly-digest-service.js";
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
import { runtimeApiReachable } from "./runtime-forward.js";
import { createShareRoutesHandler } from "./routes/share-routes.js";
import { createStationLogoRoutesHandler } from "./routes/station-logo-routes.js";
import { createOwnerStatusRoutesHandler } from "./routes/owner-status-routes.js";
import { getOwnerStatusService } from "../services/owner-status/service.js";
import { WEBSITE_URL } from "../bot/runtime-links.js";
import { log, webRootSource, frontendBuildStamp, rootDir } from "../lib/logging.js";
import { buildReleaseInfo } from "../lib/release-info.js";
import {
  TIERS,
  clipText,
  normalizeDuration,
  normalizeSeats,
  isValidEmailAddress,
  calculatePrice,
  calculateUpgradePrice,
  durationPricingInEuro,
  seatPricingInEuro,
  sanitizeOfferCode,
  isProTrialEnabled,
  PRO_TRIAL_MONTHS,
  DURATION_OPTIONS,
  SEAT_OPTIONS,
  getPricePerMonthCents,
} from "../lib/helpers.js";
import {
  normalizeLanguage,
  getDefaultLanguage,
  resolveLanguageFromAcceptLanguage,
} from "../i18n.js";
import {
  languagePick,
  translateCustomStationErrorMessage,
  translateScheduledEventStoreMessage,
} from "../lib/language.js";
import { getRepeatLabel } from "../lib/event-time.js";
import {
  getCommonSecurityHeaders,
  sendJson,
  methodNotAllowed,
  isAdminApiRequest,
  sanitizeLicenseForApi,
  API_COMMANDS,
  getBotAccessForTier,
  buildInviteUrlForRuntime,
  resolvePublicWebsiteUrl,
  getConfiguredPublicOrigin,
  isAllowedFrontendOrigin,
} from "../lib/api-helpers.js";
import { buildWeeklyDigestMeta, normalizeWeeklyDigestConfig } from "../lib/weekly-digest.js";
import {
  mergeDashboardExportsWebhookConfigWithStoredSecret,
  validateDashboardExportsWebhookConfig,
  shouldDeliverDashboardWebhook,
  buildDashboardWebhookPayload,
  deliverDashboardWebhook,
} from "../lib/dashboard-webhooks.js";
import { validateDashboardIncidentAlertsConfig } from "../lib/dashboard-incident-alerts.js";
import { buildResolvedVoiceGuardConfig, validateVoiceGuardSettings } from "../lib/voice-guard.js";
import { getPrimaryFailoverStation, normalizeFailoverChain } from "../lib/failover-chain.js";
import { loadStations, filterStationsByTier } from "../stations-store.js";
import { buildPublicStationCatalog } from "../lib/public-stations.js";
import {
  getGuildStations as getCustomStations,
  addGuildStation as addCustomStation,
  updateGuildStation as updateCustomStation,
  removeGuildStation as removeCustomStation,
} from "../custom-stations.js";
import { getTier, serverHasCapability } from "../core/entitlements.js";
import {
  updateLicenseContactEmail,
} from "../premium-store.js";
import {
  resolveCheckoutOfferForRequest,
  activateOfferGrant,
  activateProTrial,
} from "../services/payment.js";
import {
  listOffers,
  upsertOffer,
  deleteOffer,
  setOfferActive,
  listRecentRedemptions,
  getOffer,
} from "../coupon-store.js";
import { BRAND } from "../config/plans.js";
import {
  setDashboardTelemetry,
  setDashboardOauthState,
  popDashboardOauthState,
  setDashboardAuthSession,
  deleteDashboardAuthSession,
} from "../dashboard-store.js";
import { getDb } from "../lib/db.js";
import {
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
import { getGlobalStats, resetGuildStats } from "../listening-stats-store.js";
import {
  getRecentRuntimeIncidents,
  acknowledgeRuntimeIncident,
} from "../runtime-incidents-store.js";
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
import {
  buildDashboardDiscordSyncPatch,
  buildDashboardEventConflicts,
  buildDashboardEventResponse,
  buildDashboardSchedulePreviewRows,
  normalizeDashboardEventInput,
  validateDashboardEventChannels,
} from "./helpers/events.js";
import {
  buildDashboardExportsWebhookResponse,
  buildDashboardIncidentAlertsResponse,
  buildDashboardLicensePayload,
  buildServerCapabilityPayload,
  getLicense,
  getTierConfig,
  mapDashboardCustomStation,
  maskDashboardEmail,
} from "./helpers/license.js";
import {
  formatDashboardPermissionMapForClient,
  formatDashboardPermissionRulesForClient,
  resolveDashboardPermissionRuleUpdates,
} from "./helpers/permissions.js";
import {
  buildPublicLegalNotice,
  buildPublicPrivacyNotice,
  buildPublicTermsNotice,
  getHealthBinaryProbe,
} from "./helpers/public.js";
import { resolveGuildTextChannel, resolveRuntimeForGuild } from "./helpers/runtime-status.js";
import {
  buildDashboardErrorRedirect,
  buildDashboardSessionCookie,
  buildDashboardSessionCookieDeletion,
  buildDiscordAuthorizeUrl,
  exchangeDiscordCodeForToken,
  fetchDiscordUserGuilds,
  fetchDiscordUserProfile,
  getDashboardRequestTranslator,
  getDashboardSession,
  getDashboardSessionTtlSeconds,
  getDiscordOauthStateTtlSeconds,
  getDiscordRedirectUri,
  getFrontendBaseOrigin,
  getLocalizedJsonBodyError,
  isDiscordOauthConfigured,
  resolveDashboardGuildForSession,
  resolveDashboardGuildsForSession,
  resolveDashboardRequestLanguage,
  sanitizeDashboardPage,
  sendLocalizedError,
} from "./helpers/session.js";
import {
  buildDashboardFailoverChainPreview,
  buildDashboardFallbackStationPreview,
  resolveDashboardFailoverChain,
} from "./helpers/stations.js";
import {
  buildDashboardDetailStatsPayload,
  buildDashboardStatsForGuild,
  buildDashboardWeeklyDigestPreviewPayload,
  normalizeDashboardTelemetryPayload,
} from "./helpers/stats.js";

const appStartTime = Date.now();

export const handleDashboardLicenseRoute = createDashboardLicenseRouteHandler({
  BRAND,
  TIERS,
  activateOfferGrant,
  buildDashboardLicensePayload,
  calculatePrice,
  getDashboardSession,
  getLicense,
  getLocalizedJsonBodyError,
  isValidEmailAddress,
  log,
  maskDashboardEmail,
  methodNotAllowed,
  normalizeDuration,
  normalizeLanguage,
  normalizeSeats,
  resolveCheckoutOfferForRequest,
  resolveDashboardGuildForSession,
  resolveDashboardRequestLanguage,
  resolvePublicWebsiteUrl,
  sanitizeOfferCode,
  sendJson,
  sendLocalizedError,
  updateLicenseContactEmail,
});

// The bot's own look per server (#280).
export const handleDashboardBotProfileRoute = createDashboardBotProfileRouteHandler({
  getDashboardRequestTranslator,
  getDashboardSession,
  getLocalizedJsonBodyError,
  languagePick,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  sendJson,
  sendLocalizedError,
});

// The look of the now-playing panel per server (#281).
export const handleDashboardPanelDesignRoute = createDashboardPanelDesignRouteHandler({
  getDashboardRequestTranslator,
  getDashboardSession,
  getLocalizedJsonBodyError,
  languagePick,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  sendJson,
  sendLocalizedError,
});

export const handleDashboardPermsRoute = createDashboardPermsRouteHandler({
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

// Logos of the servers' own stations (#340).
export const handleStationLogoRoutes = createStationLogoRoutesHandler();

// The owner cockpit (#355).
export const handleOwnerStatusRoutes = createOwnerStatusRoutesHandler({ getService: getOwnerStatusService });

// Link previews for Discord (#279); the invite page links to the commander.
export const handleShareRoutes = createShareRoutesHandler({
  websiteUrl: WEBSITE_URL,
  getInviteUrl: (runtimes) => {
    const commander = (Array.isArray(runtimes) ? runtimes : []).find((runtime) => runtime?.role === "commander");
    return commander ? buildInviteUrlForRuntime(commander) : null;
  },
});

// The commander's Node API when this process is the public entry (#290).
let runtimeForwardTarget = "";

export function setRuntimeForwardTarget(target) {
  runtimeForwardTarget = target;
}

export const handlePublicRoutes = createPublicRoutesHandler({
  getRuntimeApiStatus: async () => (runtimeForwardTarget ? runtimeApiReachable(runtimeForwardTarget) : null),
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

export const handleAuthRoutes = createAuthRoutesHandler({
  buildDashboardErrorRedirect,
  buildDashboardSessionCookie,
  buildDashboardSessionCookieDeletion,
  buildDiscordAuthorizeUrl,
  getDiscordRedirectUri,
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

export const handleDashboardAccessRoute = createDashboardAccessRouteHandler({
  buildServerCapabilityPayload,
  getDashboardRequestTranslator,
  getDashboardSession,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  resolveDashboardGuildsForSession,
  sendJson,
  sendLocalizedError,
});

export const handleDiscordBotListRoutes = createDiscordBotListRoutesHandler({
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

export const handleBotsGGRoutes = createBotsGGRoutesHandler({
  fetchBotsGGPublicBotSummary,
  getBotsGGStatus,
  getDashboardRequestTranslator,
  isAdminApiRequest,
  languagePick,
  methodNotAllowed,
  sendJson,
  syncBotsGGStats,
});

export const handleTopGGRoutes = createTopGGRoutesHandler({
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

export const handleVoteEventsRoutes = createVoteEventsRoutesHandler({
  getDashboardRequestTranslator,
  getVoteEventsState,
  isAdminApiRequest,
  languagePick,
  methodNotAllowed,
  sendJson,
});

export const handlePremiumReadRoutes = createPremiumReadRoutesHandler({
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

export const handlePremiumBillingRoutes = createPremiumBillingRoutesHandler({
  BRAND,
  SEAT_OPTIONS,
  TIERS,
  activateOfferGrant,
  activateProTrial,
  calculatePrice,
  getDashboardRequestTranslator,
  getDefaultLanguage,
  getLocalizedJsonBodyError,
  isProTrialEnabled,
  isValidEmailAddress,
  log,
  methodNotAllowed,
  normalizeDuration,
  normalizeLanguage,
  normalizeSeats,
  resolveCheckoutOfferForRequest,
  resolveLanguageFromAcceptLanguage,
  sanitizeOfferCode,
  sendJson,
});

export const handlePremiumOffersRoutes = createPremiumOffersRoutesHandler({
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

export const handleDashboardSettingsRoute = createDashboardSettingsRouteHandler({
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
  mergeDashboardExportsWebhookConfigWithStoredSecret,
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

export const handleDashboardStatsRoute = createDashboardStatsRouteHandler({
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

export const handleDashboardEventsRoute = createDashboardEventsRouteHandler({
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

export const handleDashboardChannelsRoute = createDashboardChannelsRouteHandler({
  getDashboardRequestTranslator,
  getDashboardSession,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
});

// The live view of a server (#304).
export const handleDashboardPlaybackRoute = createDashboardPlaybackRouteHandler({
  getDashboardRequestTranslator,
  getDashboardSession,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
});

export const handleDashboardTelemetryRoute = createDashboardTelemetryRouteHandler({
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

export const handleDashboardEmojisRoute = createDashboardEmojisRouteHandler({
  getDashboardRequestTranslator,
  getDashboardSession,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
});

export const handleDashboardStationsRoute = createDashboardStationsRouteHandler({
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

export const handleDashboardCustomStationsRoute = createDashboardCustomStationsRouteHandler({
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

export const handleDashboardSettingsDigestRoute = createDashboardSettingsDigestRouteHandler({
  buildDashboardWeeklyDigestPreviewPayload,
  buildWeeklyDigestMessage,
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

export const handleDashboardExportsRoute = createDashboardExportsRouteHandler({
  buildDashboardDetailStatsPayload,
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
  mergeDashboardExportsWebhookConfigWithStoredSecret,
  resolveDashboardGuildForSession,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
  shouldDeliverDashboardWebhook,
  validateDashboardExportsWebhookConfig,
});

export const handleDashboardRolesRoute = createDashboardRolesRouteHandler({
  getDashboardRequestTranslator,
  getDashboardSession,
  methodNotAllowed,
  resolveDashboardGuildForSession,
  resolveRuntimeForGuild,
  sendJson,
  sendLocalizedError,
  serverHasCapability,
});
