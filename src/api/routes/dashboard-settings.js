import { getDb, isConnected } from "../../lib/db.js";
import { logError } from "../../lib/logging.js";
import { loadDashboardGuildSettings } from "./dashboard-guild-settings.js";
import { resolveUserFacingErrorMessage } from "../../lib/user-facing-errors.js";

export function createDashboardSettingsRouteHandler(deps) {
  const {
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
    mergeDashboardExportsWebhookConfigWithStoredSecret,
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
  } = deps;

  return async function handleDashboardSettingsRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;

    if (requestUrl.pathname !== "/api/dashboard/settings") {
      return false;
    }

    const { language } = getDashboardRequestTranslator(req, requestUrl);
    const { session } = getDashboardSession(req);
    if (!session) {
      sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
      return true;
    }
    const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
    if (!guildInfo) {
      sendLocalizedError(res, 403, language, "Kein Zugriff.", "No access.");
      return true;
    }
    if (!serverHasCapability(guildInfo.id, "dashboard_access")) {
      sendLocalizedError(res, 403, language, "Dashboard ist erst ab Pro verfuegbar.", "Dashboard is only available from Pro.");
      return true;
    }

    if (req.method === "GET") {
      const settings = await loadDashboardGuildSettings(guildInfo.id);
      const weeklyDigest = {
        ...normalizeWeeklyDigestConfig(settings.weeklyDigest || {}, language),
        language,
      };
      const failoverChain = resolveDashboardFailoverChain(settings);
      const fallbackStation = getPrimaryFailoverStation(failoverChain, settings.fallbackStation || "");
      const voiceGuard = buildResolvedVoiceGuardConfig(settings.voiceGuard || {}, {
        featureEnabled: serverHasCapability(guildInfo.id, "voice_guard"),
      });
      sendJson(res, 200, {
        guildId: guildInfo.id,
        tier: guildInfo.tier,
        capabilities: buildServerCapabilityPayload(guildInfo.id).capabilities,
        weeklyDigest,
        weeklyDigestMeta: buildWeeklyDigestMeta(weeklyDigest, {
          lastSentAt: settings.weeklyDigestLastSent || null,
        }),
        failoverChain,
        failoverChainPreview: buildDashboardFailoverChainPreview(guildInfo.id, failoverChain, fallbackStation),
        fallbackStation,
        fallbackStationPreview: buildDashboardFallbackStationPreview(guildInfo.id, fallbackStation),
        incidentAlerts: buildDashboardIncidentAlertsResponse(settings.incidentAlerts || {}),
        exportsWebhook: buildDashboardExportsWebhookResponse(settings.exportsWebhook || {}),
        voiceGuard,
      });
      return true;
    }

    if (req.method === "PUT") {
      try {
        const body = await readJsonBody();
        const updates = { guildId: guildInfo.id };
        let currentSettings = null;
        const getCurrentSettings = async () => {
          if (currentSettings === null) {
            currentSettings = await loadDashboardGuildSettings(guildInfo.id);
          }
          return currentSettings;
        };

        if (body?.weeklyDigest && typeof body.weeklyDigest === "object") {
          if (!serverHasCapability(guildInfo.id, "weekly_digest")) {
            sendLocalizedError(res, 403, language, "Woechentlicher Digest ist erst ab Pro verfuegbar.", "Weekly digest is only available from Pro.");
            return true;
          }
          updates.weeklyDigest = normalizeWeeklyDigestConfig(body.weeklyDigest, language);
          if (updates.weeklyDigest.enabled && !updates.weeklyDigest.channelId) {
            sendLocalizedError(
              res,
              400,
              language,
              "Fuer einen aktiven Digest muss ein Text-Channel ausgewaehlt werden.",
              "An active digest requires a selected text channel."
            );
            return true;
          }
        }

        if (body?.failoverChain !== undefined || body?.fallbackStation !== undefined) {
          if (!serverHasCapability(guildInfo.id, "failover_rules")) {
            sendLocalizedError(res, 403, language, "Fallback-Station ist nur fuer Ultimate verfuegbar.", "Fallback station is only available for Ultimate.");
            return true;
          }
          const rawFailoverInput = body?.failoverChain !== undefined
            ? (Array.isArray(body.failoverChain)
              ? body.failoverChain.map((value) => clipText(value || "", 120))
              : clipText(body.failoverChain || "", 120))
            : clipText(body?.fallbackStation || "", 120);
          const normalizedFailoverChain = normalizeFailoverChain(rawFailoverInput);
          const failoverPreviews = buildDashboardFailoverChainPreview(guildInfo.id, normalizedFailoverChain);
          const invalidPreview = failoverPreviews.find((preview) => preview.valid !== true) || null;
          if (invalidPreview) {
            sendLocalizedError(
              res,
              400,
              language,
              "Die gewaehlte Fallback-Station ist fuer diesen Server nicht verfuegbar.",
              "The selected fallback station is not available for this server."
            );
            return true;
          }
          updates.failoverChain = normalizedFailoverChain;
          updates.fallbackStation = getPrimaryFailoverStation(normalizedFailoverChain, "");
        }

        if (body?.exportsWebhook && typeof body.exportsWebhook === "object") {
          if (!serverHasCapability(guildInfo.id, "exports_webhooks")) {
            sendLocalizedError(res, 403, language, "Exporte und Webhooks sind nur fuer Ultimate verfuegbar.", "Exports and webhooks are only available for Ultimate.");
            return true;
          }
          const candidateWebhook = mergeDashboardExportsWebhookConfigWithStoredSecret(
            body.exportsWebhook,
            (await getCurrentSettings()).exportsWebhook || {}
          );
          const validatedWebhook = await validateDashboardExportsWebhookConfig(candidateWebhook);
          if (!validatedWebhook.ok) {
            sendJson(res, 400, { error: validatedWebhook.error });
            return true;
          }
          if (validatedWebhook.config.enabled && !validatedWebhook.config.url) {
            sendLocalizedError(
              res,
              400,
              language,
              "Fuer aktive Export-Webhooks muss eine URL hinterlegt werden.",
              "An active export webhook requires a configured URL."
            );
            return true;
          }
          updates.exportsWebhook = validatedWebhook.config;
        }

        if (body?.incidentAlerts && typeof body.incidentAlerts === "object") {
          if (!serverHasCapability(guildInfo.id, "exports_webhooks")) {
            sendLocalizedError(res, 403, language, "Incident-Alerts sind nur fuer Ultimate verfuegbar.", "Incident alerts are only available for Ultimate.");
            return true;
          }
          const validatedIncidentAlerts = validateDashboardIncidentAlertsConfig(body.incidentAlerts);
          if (!validatedIncidentAlerts.ok) {
            sendJson(res, 400, { error: validatedIncidentAlerts.error });
            return true;
          }
          if (validatedIncidentAlerts.config.enabled && !validatedIncidentAlerts.config.channelId) {
            sendLocalizedError(
              res,
              400,
              language,
              "Fuer aktive Incident-Alerts muss ein Text-Channel ausgewaehlt werden.",
              "An active incident alert requires a selected text channel."
            );
            return true;
          }
          updates.incidentAlerts = validatedIncidentAlerts.config;
        }

        if (body?.voiceGuard && typeof body.voiceGuard === "object") {
          if (!serverHasCapability(guildInfo.id, "voice_guard")) {
            sendLocalizedError(res, 403, language, "Voice Guard ist auf diesem Server aktuell nicht verfuegbar.", "Voice guard is not currently available on this server.");
            return true;
          }
          const validatedVoiceGuard = validateVoiceGuardSettings(body.voiceGuard);
          if (!validatedVoiceGuard.ok) {
            sendJson(res, 400, { error: validatedVoiceGuard.error });
            return true;
          }
          updates.voiceGuard = validatedVoiceGuard.config;
        }

        if (!isConnected() || !getDb()) {
          sendLocalizedError(
            res,
            503,
            language,
            "Der Dienst ist gerade voruebergehend nicht verfuegbar.",
            "The service is temporarily unavailable."
          );
          return true;
        }

        const savedSettings = await getCurrentSettings();
        await getDb().collection("guild_settings").updateOne(
          { guildId: guildInfo.id },
          { $set: updates },
          { upsert: true }
        );
        if (Object.prototype.hasOwnProperty.call(updates, "voiceGuard") && Array.isArray(runtimes)) {
          for (const runtime of runtimes) {
            if (typeof runtime?.refreshVoiceGuardSettingsForGuild !== "function") continue;
            // eslint-disable-next-line no-await-in-loop
            await runtime.refreshVoiceGuardSettingsForGuild(guildInfo.id, { force: true }).catch(() => null);
          }
        }

        const weeklyDigest = updates.weeklyDigest
          || normalizeWeeklyDigestConfig(savedSettings.weeklyDigest || {}, language);
        const failoverChain = Object.prototype.hasOwnProperty.call(updates, "failoverChain")
          ? normalizeFailoverChain(updates.failoverChain || [])
          : resolveDashboardFailoverChain(savedSettings);
        const fallbackStation = Object.prototype.hasOwnProperty.call(updates, "fallbackStation")
          ? String(updates.fallbackStation || "").trim().toLowerCase()
          : getPrimaryFailoverStation(failoverChain, savedSettings.fallbackStation || "");
        const incidentAlerts = Object.prototype.hasOwnProperty.call(updates, "incidentAlerts")
          ? buildDashboardIncidentAlertsResponse(updates.incidentAlerts)
          : buildDashboardIncidentAlertsResponse(savedSettings.incidentAlerts || {});
        const exportsWebhook = Object.prototype.hasOwnProperty.call(updates, "exportsWebhook")
          ? buildDashboardExportsWebhookResponse(updates.exportsWebhook)
          : buildDashboardExportsWebhookResponse(savedSettings.exportsWebhook || {});
        const voiceGuard = Object.prototype.hasOwnProperty.call(updates, "voiceGuard")
          ? buildResolvedVoiceGuardConfig(updates.voiceGuard, {
            featureEnabled: serverHasCapability(guildInfo.id, "voice_guard"),
          })
          : buildResolvedVoiceGuardConfig(savedSettings.voiceGuard || {}, {
            featureEnabled: serverHasCapability(guildInfo.id, "voice_guard"),
          });

        sendJson(res, 200, {
          success: true,
          guildId: guildInfo.id,
          tier: guildInfo.tier,
          capabilities: buildServerCapabilityPayload(guildInfo.id).capabilities,
          weeklyDigest,
          weeklyDigestMeta: buildWeeklyDigestMeta(weeklyDigest, {
            lastSentAt: savedSettings.weeklyDigestLastSent || null,
          }),
          failoverChain,
          failoverChainPreview: buildDashboardFailoverChainPreview(guildInfo.id, failoverChain, fallbackStation),
          fallbackStation,
          fallbackStationPreview: buildDashboardFallbackStationPreview(guildInfo.id, fallbackStation),
          incidentAlerts,
          exportsWebhook,
          voiceGuard,
        });
      } catch (err) {
        logError("[DashboardSettings] Save failed", err, {
          context: {
            source: "dashboard-settings",
            route: "/api/dashboard/settings",
            guildId: guildInfo?.id || "",
          },
          includeStack: true,
        });
        sendJson(res, 400, {
          error: resolveUserFacingErrorMessage(language, err, {
            fallbackDe: "Die Einstellungen konnten gerade nicht gespeichert werden.",
            fallbackEn: "The settings could not be saved right now.",
          }),
        });
      }
      return true;
    }

    methodNotAllowed(res, ["GET", "PUT"]);
    return true;
  };
}
