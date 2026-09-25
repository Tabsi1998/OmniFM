function sortCustomStations(stations) {
  return stations.sort((a, b) => {
    const folderCompare = String(a.folder || "").localeCompare(String(b.folder || ""));
    if (folderCompare !== 0) return folderCompare;
    return a.name.localeCompare(b.name);
  });
}

export function createDashboardCustomStationsRouteHandler(deps) {
  const {
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
  } = deps;

  return async function handleDashboardCustomStationsRoute(context) {
    const { req, res, requestUrl, readJsonBody } = context;

    if (requestUrl.pathname !== "/api/dashboard/custom-stations") {
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
      sendLocalizedError(res, 403, language, "Dashboard ist erst ab Pro verfügbar.", "Dashboard is only available from Pro.");
      return true;
    }
    if (!serverHasCapability(guildInfo.id, "custom_station_urls")) {
      sendLocalizedError(
        res,
        403,
        language,
        "Custom-Stationen sind nur für Ultimate verfügbar.",
        "Custom stations are only available for Ultimate."
      );
      return true;
    }

    if (req.method === "GET") {
      const stations = getCustomStations(guildInfo.id);
      const list = sortCustomStations(
        Object.entries(stations).map(([key, station]) => mapDashboardCustomStation(key, station, guildInfo.id))
      );
      sendJson(res, 200, { stations: list, tier: guildInfo.tier });
      return true;
    }

    if (req.method === "POST") {
      try {
        const body = await readJsonBody();
        const key = clipText(body?.key || "", 80).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
        const name = clipText(body?.name || "", 120).trim();
        const url = clipText(body?.url || "", 500).trim();
        if (!key || !name || !url) {
          sendLocalizedError(res, 400, language, "Key, Name und URL sind erforderlich.", "Key, name and URL are required.");
          return true;
        }

        const result = await addCustomStation(guildInfo.id, key, {
          name,
          url,
          genre: clipText(body?.genre || "", 80),
          folder: clipText(body?.folder || "", 80),
          tags: Array.isArray(body?.tags)
            ? body.tags.map((tag) => clipText(tag || "", 40))
            : clipText(body?.tags || "", 240),
        });
        if (!result?.success) {
          sendJson(res, 400, {
            error: translateCustomStationErrorMessage(
              result?.error || languagePick(language, "Station konnte nicht hinzugefügt werden.", "Station could not be added."),
              language
            ),
          });
          return true;
        }

        sendJson(res, 201, { success: true, station: mapDashboardCustomStation(result.key, result.station, guildInfo.id) });
      } catch (err) {
        sendJson(res, 400, {
          error: translateCustomStationErrorMessage(
            err?.message || languagePick(language, "Ungültige Anfrage.", "Invalid request."),
            language
          ),
        });
      }
      return true;
    }

    if (req.method === "DELETE") {
      const key = requestUrl.searchParams.get("key");
      if (!key) {
        sendLocalizedError(res, 400, language, "Station-Key fehlt.", "Station key is missing.");
        return true;
      }
      const result = removeCustomStation(guildInfo.id, key);
      sendJson(res, 200, { success: !!result, key });
      return true;
    }

    if (req.method === "PUT") {
      try {
        const body = await readJsonBody();
        const key = clipText(body?.key || "", 80).trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
        if (!key) {
          sendLocalizedError(res, 400, language, "Station-Key fehlt.", "Station key is missing.");
          return true;
        }

        const existing = getCustomStations(guildInfo.id);
        if (!existing[key]) {
          sendLocalizedError(res, 404, language, "Station nicht gefunden.", "Station was not found.");
          return true;
        }

        const current = existing[key];
        const updated = {
          name: clipText(body?.name || current.name || key, 120).trim(),
          url: clipText(body?.url || current.url || "", 500).trim(),
          genre: clipText(body?.genre !== undefined ? body.genre : (current.genre || ""), 80),
          folder: clipText(body?.folder !== undefined ? body.folder : (current.folder || ""), 80),
          tags: Array.isArray(body?.tags)
            ? body.tags.map((tag) => clipText(tag || "", 40))
            : (body?.tags !== undefined ? clipText(body.tags || "", 240) : (current.tags || [])),
        };

        const result = await updateCustomStation(guildInfo.id, key, updated);
        if (!result?.success) {
          sendJson(res, 400, {
            error: translateCustomStationErrorMessage(
              result?.error || languagePick(language, "Station konnte nicht aktualisiert werden.", "Station could not be updated."),
              language
            ),
          });
          return true;
        }

        sendJson(res, 200, { success: true, station: mapDashboardCustomStation(result.key, result.station, guildInfo.id) });
      } catch (err) {
        sendJson(res, 400, {
          error: translateCustomStationErrorMessage(
            err?.message || languagePick(language, "Ungültige Anfrage.", "Invalid request."),
            language
          ),
        });
      }
      return true;
    }

    methodNotAllowed(res, ["GET", "POST", "PUT", "DELETE"]);
    return true;
  };
}
