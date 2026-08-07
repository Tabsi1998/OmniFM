import { loadDashboardGuildSettings } from "./dashboard-guild-settings.js";

function sortCustomStations(stations) {
  return stations.sort((a, b) => {
    const folderCompare = String(a.folder || "").localeCompare(String(b.folder || ""));
    if (folderCompare !== 0) return folderCompare;
    return a.name.localeCompare(b.name);
  });
}

export function createDashboardExportsRouteHandler(deps) {
  const {
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
  } = deps;

  return async function handleDashboardExportsRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;

    if (requestUrl.pathname === "/api/dashboard/exports/webhook-test") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
        return true;
      }

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
      if (!serverHasCapability(guildInfo.id, "exports_webhooks")) {
        sendLocalizedError(res, 403, language, "Exporte und Webhooks sind nur fuer Ultimate verfuegbar.", "Exports and webhooks are only available for Ultimate.");
        return true;
      }

      try {
        const body = await readJsonBody();
        const currentSettings = await loadDashboardGuildSettings(guildInfo.id);
        const candidateConfig = body?.exportsWebhook && typeof body.exportsWebhook === "object"
          ? mergeDashboardExportsWebhookConfigWithStoredSecret(
            body.exportsWebhook,
            currentSettings.exportsWebhook || {}
          )
          : currentSettings.exportsWebhook || {};
        const validatedWebhook = await validateDashboardExportsWebhookConfig(candidateConfig);
        if (!validatedWebhook.ok) {
          sendJson(res, 400, { error: validatedWebhook.error });
          return true;
        }
        if (!validatedWebhook.config.url) {
          sendLocalizedError(
            res,
            400,
            language,
            "Bitte zuerst eine Webhook-URL hinterlegen.",
            "Please configure a webhook URL first."
          );
          return true;
        }

        const payload = buildDashboardWebhookPayload("test", {
          server: {
            id: guildInfo.id,
            name: guildInfo.name || "",
            tier: guildInfo.tier,
          },
          actor: session.user || null,
          payload: {
            message: languagePick(
              language,
              "Dies ist ein manueller Dashboard-Test fuer OmniFM Exporte/Webhooks.",
              "This is a manual dashboard test for OmniFM exports/webhooks."
            ),
            enabled: validatedWebhook.config.enabled === true,
            events: validatedWebhook.config.events,
          },
        });

        const delivery = await deliverDashboardWebhook(validatedWebhook.config, "test", payload);
        if (!delivery.delivered) {
          sendJson(res, 502, {
            error: delivery.error || languagePick(language, "Webhook-Test fehlgeschlagen.", "Webhook test failed."),
            delivery,
          });
          return true;
        }

        sendJson(res, 200, {
          success: true,
          serverId: guildInfo.id,
          tier: guildInfo.tier,
          payloadPreview: payload,
          delivery,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
          return true;
        }
        sendLocalizedError(res, 500, language, "Webhook-Test konnte nicht gesendet werden.", "Webhook test could not be sent.");
      }
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/exports/stats") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }

      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }

      const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guild) {
        sendLocalizedError(res, 403, language, "Kein Zugriff.", "No access.");
        return true;
      }
      if (!serverHasCapability(guild.id, "exports_webhooks")) {
        sendLocalizedError(res, 403, language, "Exporte sind nur fuer Ultimate verfuegbar.", "Exports are only available for Ultimate.");
        return true;
      }

      try {
        const detailPayload = await buildDashboardDetailStatsPayload(
          guild,
          runtimes,
          requestUrl.searchParams.get("days") || "30"
        );
        const summaryPayload = await buildDashboardStatsForGuild(guild.id, guild.tier, runtimes);
        const exportPayload = {
          exportType: "stats",
          exportedAt: new Date().toISOString(),
          serverId: guild.id,
          tier: guild.tier,
          basic: summaryPayload.basic,
          advanced: summaryPayload.advanced,
          detail: detailPayload,
        };

        let webhookDelivery = null;
        const settings = await loadDashboardGuildSettings(guild.id);
        const webhookConfig = settings.exportsWebhook || {};
        if (shouldDeliverDashboardWebhook(webhookConfig, "stats_exported")) {
          webhookDelivery = await deliverDashboardWebhook(
            webhookConfig,
            "stats_exported",
            buildDashboardWebhookPayload("stats_exported", {
              server: {
                id: guild.id,
                name: guild.name || "",
                tier: guild.tier,
              },
              actor: session.user || null,
              payload: {
                exportType: "stats",
                days: detailPayload.days,
                totalSessions: detailPayload.listeningStats.totalSessions,
                dailyPoints: detailPayload.dailyStats.length,
              },
            })
          );
        }

        sendJson(res, 200, {
          ...exportPayload,
          webhookDelivery,
        });
      } catch (err) {
        log("ERROR", `Dashboard stats export error: ${err?.message || err}`);
        sendLocalizedError(res, 500, language, "Stats-Export konnte nicht erstellt werden.", "Stats export could not be created.");
      }
      return true;
    }

    if (requestUrl.pathname !== "/api/dashboard/exports/custom-stations") {
      return false;
    }

    const { language } = getDashboardRequestTranslator(req, requestUrl);
    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return true;
    }

    const { session } = getDashboardSession(req);
    if (!session) {
      sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
      return true;
    }

    const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
    if (!guild) {
      sendLocalizedError(res, 403, language, "Kein Zugriff.", "No access.");
      return true;
    }
    if (!serverHasCapability(guild.id, "exports_webhooks")) {
      sendLocalizedError(res, 403, language, "Exporte sind nur fuer Ultimate verfuegbar.", "Exports are only available for Ultimate.");
      return true;
    }

    const stations = sortCustomStations(
      Object.entries(getCustomStations(guild.id) || {})
        .map(([key, station]) => mapDashboardCustomStation(key, station))
    );

    let webhookDelivery = null;
    try {
      const settings = await loadDashboardGuildSettings(guild.id);
      const webhookConfig = settings.exportsWebhook || {};
      if (shouldDeliverDashboardWebhook(webhookConfig, "custom_stations_exported")) {
        const folderCount = new Set(stations.map((station) => station.folder).filter(Boolean)).size;
        webhookDelivery = await deliverDashboardWebhook(
          webhookConfig,
          "custom_stations_exported",
          buildDashboardWebhookPayload("custom_stations_exported", {
            server: {
              id: guild.id,
              name: guild.name || "",
              tier: guild.tier,
            },
            actor: session.user || null,
            payload: {
              exportType: "custom_stations",
              stationCount: stations.length,
              folderCount,
            },
          })
        );
      }
    } catch (err) {
      log("WARN", `Dashboard custom station export webhook error: ${err?.message || err}`);
    }

    sendJson(res, 200, {
      exportType: "custom_stations",
      exportedAt: new Date().toISOString(),
      serverId: guild.id,
      tier: guild.tier,
      stations,
      webhookDelivery,
    });
    return true;
  };
}
