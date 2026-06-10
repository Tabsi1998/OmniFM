import fs from "node:fs";
import path from "node:path";
import { getDb, isConnected } from "../../lib/db.js";

function buildPublicBotTotals(bots) {
  return bots.reduce(
    (acc, bot) => {
      acc.servers += Number(bot.servers) || 0;
      acc.users += Number(bot.users) || 0;
      acc.connections += Number(bot.connections) || 0;
      acc.listeners += Number(bot.listeners) || 0;
      return acc;
    },
    { servers: 0, users: 0, connections: 0, listeners: 0 }
  );
}

function buildWorkerPayload(runtime, fallbackIndex = 0) {
  const status = runtime.getPublicStatus?.() || {};
  const stats = runtime.collectStats?.() || {};
  const activeStreams = Number(
    runtime.getPlayingGuildCount?.()
    ?? status.connections
    ?? status.listeners
    ?? 0
  ) || 0;
  const servers = Number(stats.servers ?? status.servers ?? status.guilds ?? 0) || 0;
  const index = Number(runtime?.config?.index || fallbackIndex || 0) || fallbackIndex || 0;

  return {
    id: runtime?.config?.id || null,
    botId: runtime?.config?.id || null,
    index,
    name: runtime?.config?.name || `Bot ${index || "?"}`,
    role: runtime?.role || "worker",
    requiredTier: runtime?.config?.requiredTier || "free",
    color: status.color || (runtime?.role === "commander" ? "#00F0FF" : "#39FF14"),
    online: Boolean(runtime?.client?.isReady?.()),
    servers,
    activeStreams,
  };
}

export function createPublicRoutesHandler(deps) {
  const {
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
    getReleaseInfo,
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
  } = deps;

  return async function handlePublicRoutes(context) {
    const { req, res, requestUrl, runtimes } = context;

    if (requestUrl.pathname === "/api/bots") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      const bots = runtimes.map((runtime) => runtime.getPublicStatus());
      sendJson(res, 200, { bots, totals: buildPublicBotTotals(bots) });
      return true;
    }

    if (requestUrl.pathname === "/api/workers") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }

      const sortedRuntimes = [...runtimes].sort(
        (a, b) => Number(a?.config?.index || 0) - Number(b?.config?.index || 0)
      );
      const commanderRuntime = sortedRuntimes.find((runtime) => runtime.role === "commander") || sortedRuntimes[0] || null;
      const workers = sortedRuntimes
        .filter((runtime) => runtime !== commanderRuntime)
        .map((runtime, position) => buildWorkerPayload(runtime, position + 1));

      sendJson(res, 200, {
        architecture: "commander_worker",
        commander: commanderRuntime ? buildWorkerPayload(commanderRuntime, 1) : null,
        workers,
        tiers: {
          free: { maxWorkers: Number(TIERS.free?.maxBots || 2) },
          pro: { maxWorkers: Number(TIERS.pro?.maxBots || 8) },
          ultimate: { maxWorkers: Number(TIERS.ultimate?.maxBots || 16) },
        },
      });
      return true;
    }

    if (requestUrl.pathname === "/api/commands") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, { commands: API_COMMANDS });
      return true;
    }

    if (requestUrl.pathname === "/api/stats") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      const bots = runtimes.map((runtime) => runtime.getPublicStatus());
      const totals = buildPublicBotTotals(bots);
      const publicStations = buildPublicStationCatalog(loadStations());
      sendJson(res, 200, {
        ...totals,
        bots: runtimes.length,
        stations: publicStations.total,
        freeStations: publicStations.freeStations,
        proStations: publicStations.proStations,
        ultimateStations: publicStations.ultimateStations,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/stations") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      const publicStations = buildPublicStationCatalog(loadStations());
      sendJson(res, 200, {
        defaultStationKey: publicStations.defaultStationKey,
        qualityPreset: publicStations.qualityPreset,
        total: publicStations.total,
        stations: publicStations.stations,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/legal") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, buildPublicLegalNotice());
      return true;
    }

    if (requestUrl.pathname === "/api/privacy") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, buildPublicPrivacyNotice());
      return true;
    }

    if (requestUrl.pathname === "/api/terms") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, buildPublicTermsNotice());
      return true;
    }

    if (requestUrl.pathname === "/api/health") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      const readyBots = runtimes.filter((runtime) => runtime.client.isReady()).length;
      sendJson(res, 200, {
        ok: true,
        status: "online",
        brand: BRAND.name,
        timestamp: new Date().toISOString(),
        uptimeSec: Math.floor((Date.now() - appStartTime) / 1000),
        bots: runtimes.length,
        readyBots,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/health/detail") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      if (!isAdminApiRequest(req)) {
        sendJson(res, 401, {
          error: languagePick(language, "Nicht autorisiert. API-Admin-Token erforderlich.", "Unauthorized. API admin token required."),
        });
        return true;
      }

      const binaryProbe = getHealthBinaryProbe();
      const readyBots = runtimes.filter((runtime) => runtime.client.isReady()).length;
      const runtimeDetails = runtimes.map((runtime) => {
        const snapshot = runtime.buildStatusSnapshot();
        return {
          id: snapshot.id,
          name: snapshot.name,
          role: snapshot.role,
          requiredTier: snapshot.requiredTier,
          ready: snapshot.ready,
          servers: snapshot.servers,
          listeners: snapshot.listeners,
          connections: snapshot.connections,
          uptimeSec: snapshot.uptimeSec,
          error: snapshot.error,
        };
      });

      sendJson(res, 200, {
        ok: true,
        status: readyBots > 0 ? "online" : "degraded",
        brand: BRAND.name,
        timestamp: new Date().toISOString(),
        uptimeSec: Math.floor((Date.now() - appStartTime) / 1000),
        container: {
          pid: process.pid,
          nodeVersion: process.version,
          platform: process.platform,
          arch: process.arch,
          webRootSource,
          frontendBuildStamp,
        },
        release: typeof getReleaseInfo === "function" ? getReleaseInfo() : null,
        discord: {
          bots: runtimes.length,
          readyBots,
          runtimes: runtimeDetails,
        },
        db: {
          connected: isConnected(),
          database: getDb()?.databaseName || null,
          fallbackActive: !isConnected(),
        },
        stripe: {
          configured: Boolean(getStripeSecretKey()),
        },
        binaries: {
          ffmpeg: binaryProbe.ffmpeg,
          fpcalc: binaryProbe.fpcalc,
        },
        stores: {
          dashboardSessions: {
            backend: "json-file",
            filePresent: fs.existsSync(path.join(rootDir, "dashboard.json")),
          },
          premiumLicenses: {
            backend: "json-file",
            filePresent: fs.existsSync(path.join(rootDir, "premium.json")),
          },
          commandPermissions: {
            backend: "json-file",
            filePresent: fs.existsSync(path.join(rootDir, "command-permissions.json")),
          },
          customStations: {
            backend: "json-file",
            filePresent: fs.existsSync(path.join(rootDir, "custom-stations.json")),
          },
          listeningStats: {
            backend: isConnected() ? "mongodb+json-fallback" : "json-fallback",
            dbConnected: isConnected(),
          },
        },
      });
      return true;
    }

    if (requestUrl.pathname !== "/api/stats/global") {
      return false;
    }

    const { language } = getDashboardRequestTranslator(req, requestUrl);
    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return true;
    }

    try {
      const globalStats = await getGlobalStats();
      sendJson(res, 200, globalStats);
    } catch (err) {
      log("ERROR", `Global stats error: ${err?.message || err}`);
      sendLocalizedError(res, 500, language, "Globale Statistiken konnten nicht geladen werden.", "Global statistics could not be loaded.");
    }
    return true;
  };
}
