function sortCustomStations(stations) {
  return stations.sort((a, b) => {
    const folderCompare = String(a.folder || "").localeCompare(String(b.folder || ""));
    if (folderCompare !== 0) return folderCompare;
    return a.name.localeCompare(b.name);
  });
}

function formatStationList(stationsByKey) {
  return Object.entries(stationsByKey)
    .map(([key, station]) => ({
      key,
      name: station?.name || key,
      url: station?.url || "",
      genre: station?.genre || "",
      country: station?.country || "",
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function createDashboardStationsRouteHandler(deps) {
  const {
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
  } = deps;

  return async function handleDashboardStationsRoute(context) {
    const { req, res, requestUrl } = context;

    if (requestUrl.pathname !== "/api/dashboard/stations") {
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

    const guildInfo = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
    if (!guildInfo) {
      sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
      return true;
    }
    if (!serverHasCapability(guildInfo.id, "dashboard_basic")) {
      sendLocalizedError(res, 403, language, "Dashboard ist erst ab Pro verfügbar.", "Dashboard is only available from Pro.");
      return true;
    }

    const allStations = loadStations();
    const tierStations = filterStationsByTier(allStations.stations || {}, guildInfo.tier);
    const freeStations = {};
    const proStations = {};
    const ultimateStations = {};

    for (const [key, station] of Object.entries(tierStations)) {
      const tier = String(station?.tier || "free").toLowerCase();
      if (tier === "ultimate") {
        ultimateStations[key] = station;
      } else if (tier === "pro") {
        proStations[key] = station;
      } else {
        freeStations[key] = station;
      }
    }

    const customStations = serverHasCapability(guildInfo.id, "custom_station_urls")
      ? getCustomStations(guildInfo.id)
      : {};
    const custom = sortCustomStations(
      Object.entries(customStations).map(([key, station]) => mapDashboardCustomStation(key, station))
    );

    sendJson(res, 200, {
      free: formatStationList(freeStations),
      pro: formatStationList(proStations),
      ultimate: formatStationList(ultimateStations),
      custom,
      tier: guildInfo.tier,
    });
    return true;
  };
}
