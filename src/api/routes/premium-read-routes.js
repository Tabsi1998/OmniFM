import { loadOwnerConfigRaw } from "../../lib/owner-config.js";
import { premiumPricing, premiumTiers } from "../../lib/owner-public.js";

export function createPremiumReadRoutesHandler(deps) {
  const {
    buildInviteUrlForRuntime,
    calculateUpgradePrice,
    getBotAccessForTier,
    getDashboardRequestTranslator,
    getLicense,
    getTierConfig,
    isAdminApiRequest,
    isProTrialEnabled,
    languagePick,
    methodNotAllowed,
    sanitizeLicenseForApi,
    sendJson,
  } = deps;

  return async function handlePremiumReadRoutes(context) {
    const { req, res, requestUrl, runtimes } = context;

    if (requestUrl.pathname === "/api/premium/check") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      const serverId = requestUrl.searchParams.get("serverId");
      if (!serverId || !/^\d{17,22}$/.test(serverId)) {
        sendJson(res, 400, {
          error: languagePick(language, "serverId muss 17-22 Ziffern sein.", "serverId must be 17-22 digits."),
        });
        return true;
      }

      const tierConfig = getTierConfig(serverId);
      const license = getLicense(serverId);
      const includeSensitive = isAdminApiRequest(req);
      sendJson(res, 200, {
        serverId,
        tier: tierConfig.tier,
        name: tierConfig.name,
        bitrate: tierConfig.bitrate,
        reconnectMs: tierConfig.reconnectMs,
        maxBots: tierConfig.maxBots,
        license: sanitizeLicenseForApi(license, includeSensitive),
      });
      return true;
    }

    if (requestUrl.pathname === "/api/premium/invite-links") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      const serverId = requestUrl.searchParams.get("serverId");
      if (!serverId || !/^\d{17,22}$/.test(serverId)) {
        sendJson(res, 400, {
          error: languagePick(language, "serverId muss 17-22 Ziffern sein.", "serverId must be 17-22 digits."),
        });
        return true;
      }

      const tierConfig = getTierConfig(serverId);
      const links = runtimes.map((runtime) => {
        const botTier = runtime.config.requiredTier || "free";
        const access = getBotAccessForTier(runtime.config, tierConfig);
        return {
          botId: runtime.config.id,
          name: runtime.config.name,
          index: runtime.config.index,
          role: runtime.role || "worker",
          requiredTier: botTier,
          hasAccess: access.hasAccess,
          blockedReason: access.reason,
          inviteUrl: access.hasAccess ? buildInviteUrlForRuntime(runtime) : null,
        };
      });

      sendJson(res, 200, { serverId, serverTier: tierConfig.tier, bots: links });
      return true;
    }

    if (requestUrl.pathname === "/api/premium/tiers") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, premiumTiers(await loadOwnerConfigRaw()));
      return true;
    }

    if (requestUrl.pathname !== "/api/premium/pricing") {
      return false;
    }

    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return true;
    }

    // Prices and features from the owner's plans (#288, FastAPI contract).
    const serverId = String(requestUrl.searchParams.get("serverId") || "").trim();
    let license = null;
    let upgrade = null;
    if (/^\d{17,22}$/.test(serverId)) {
      license = getLicense(serverId);
      if (license && !license.expired && (license.tier || license.plan) === "pro") {
        upgrade = calculateUpgradePrice(license, "ultimate") || null;
      }
    }
    sendJson(res, 200, premiumPricing(await loadOwnerConfigRaw(), { license, upgrade, trialEnabled: isProTrialEnabled() }));
    return true;
  };
}
