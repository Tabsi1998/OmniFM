import fs from "node:fs";
import { getDb, isConnected, isMongoRequested } from "../../lib/db.js";
import { resolveRuntimeDataPath } from "../../lib/runtime-data-path.js";
import { loadOwnerConfigRaw } from "../../lib/owner-config.js";
import { loadConfiguredBots, readReleaseInfo, readRuntimeHealthFresh } from "../../lib/owner-monitoring.js";
import {
  coverLookup,
  healthDocFromRuntimes,
  marketingResponse,
  publicBotsResponse,
  publicStatsResponse,
} from "../../lib/owner-public.js";
import { statusResponse } from "../../services/status-page.js";
import { weeklyChart } from "../../services/charts.js";
import { normalizeOwnerSeasons } from "../../lib/seasons.js";
import { websiteChart, websiteCover, websiteMarketing } from "../../lib/public-images.js";
import { ownerSettings } from "../../lib/owner-settings-cache.js";

/** The API contract the owner console and start.sh expect. */
export const BACKEND_CONTRACT_VERSION = "owner-live-v5";

/**
 * The live numbers for the website: the bots' health document
 * in MongoDB (all processes of a split setup, fresh for 30 seconds). Without
 * one (no MongoDB, or right after the start) the ready bots of this process
 * stand in; with none of them the numbers stay 0.
 */
async function readPublicLiveDoc(runtimes) {
  if (isConnected() && getDb()) {
    const doc = await readRuntimeHealthFresh(getDb());
    if (doc) return doc;
  }
  return runtimes.some((runtime) => runtime.client?.isReady?.()) ? healthDocFromRuntimes(runtimes) : null;
}

// GET /api/status is public: one answer for 15 seconds, so a crowd on the
// status page during an outage costs MongoDB one read (#299).
const STATUS_CACHE_MS = 15_000;
let statusCache = { at: 0, body: null };

async function cachedStatusResponse() {
  const now = Date.now();
  if (!statusCache.body || now - statusCache.at >= STATUS_CACHE_MS) {
    const db = isConnected() ? getDb() : null;
    statusCache = { at: now, body: await statusResponse(db, await loadOwnerConfigRaw({ db }), process.env, { now }) };
  }
  return statusCache.body;
}

/** The configured bots (environment, else owner console); a lone process without either lists its own. */
async function readConfiguredBots(runtimes) {
  const configured = loadConfiguredBots(await loadOwnerConfigRaw());
  if (configured.length || !runtimes.length) return configured;
  return runtimes.map((runtime) => runtime.getPublicStatus());
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
    getRuntimeApiStatus,
    getReleaseInfo,
    isAdminApiRequest,
    languagePick,
    loadStations,
    log,
    methodNotAllowed,
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
      const configured = await readConfiguredBots(runtimes);
      sendJson(res, 200, publicBotsResponse(configured, await readPublicLiveDoc(runtimes)));
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

    if (requestUrl.pathname === "/api/status") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, await cachedStatusResponse());
      return true;
    }

    // The OmniFM charts (#300): the last week across all servers, cached 10 minutes.
    if (requestUrl.pathname === "/api/charts") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      // Logos and covers from this site (#469); the Discord post keeps the originals.
      sendJson(res, 200, websiteChart(await weeklyChart(isConnected() ? getDb() : null)));
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
      const configured = await readConfiguredBots(runtimes);
      const catalog = buildPublicStationCatalog(loadStations());
      sendJson(res, 200, publicStatsResponse(configured, await readPublicLiveDoc(runtimes), catalog));
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
      sendJson(res, 200, await buildPublicLegalNotice());
      return true;
    }

    // The owner's main switch per season (#427); the website works out the date itself.
    if (requestUrl.pathname === "/api/season") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, { enabled: normalizeOwnerSeasons(ownerSettings()?.seasons).enabled });
      return true;
    }

    if (requestUrl.pathname === "/api/privacy") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, await buildPublicPrivacyNotice());
      return true;
    }

    if (requestUrl.pathname === "/api/terms") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, await buildPublicTermsNotice());
      return true;
    }

    if (requestUrl.pathname === "/api/marketing") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, websiteMarketing(marketingResponse(await loadOwnerConfigRaw())));
      return true;
    }

    if (requestUrl.pathname === "/api/cover") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      const params = requestUrl.searchParams;
      sendJson(res, 200, websiteCover(await coverLookup({
        artist: params.get("artist") || "",
        title: params.get("title") || "",
        term: params.get("term") || "",
      })));
      return true;
    }

    if (requestUrl.pathname === "/api/health") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      // Contract, release and services, 503 when MongoDB is gone,
      // plus the bots of this process. MongoDB counts when MONGO_URL names it
      // and this process asked for it; a process on the JSON files stays ready.
      const readyBots = runtimes.filter((runtime) => runtime.client.isReady()).length;
      const mongo = isConnected();
      const mongoWanted = isMongoRequested() && Boolean(String(process.env.MONGO_URL || "").trim());
      const ready = mongo || !mongoWanted;
      sendJson(res, ready ? 200 : 503, {
        ok: ready,
        ready,
        status: ready ? "online" : "degraded",
        brand: BRAND.name,
        contractVersion: BACKEND_CONTRACT_VERSION,
        release: readReleaseInfo(),
        services: {
          api: true,
          mongo,
          dashboardBackend: "node",
          // The public entry reports whether the commander answers.
          ...await getRuntimeApiStatus?.().then((reachable) => (reachable === null ? {} : { dashboardApi: reachable })),
        },
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
        binaries: {
          ffmpeg: binaryProbe.ffmpeg,
          fpcalc: binaryProbe.fpcalc,
        },
        stores: {
          dashboardSessions: {
            backend: "json-file",
            filePresent: fs.existsSync(resolveRuntimeDataPath("dashboard.json")),
          },
          premiumLicenses: {
            backend: "json-file",
            filePresent: fs.existsSync(resolveRuntimeDataPath("premium.json")),
          },
          commandPermissions: {
            backend: "json-file",
            filePresent: fs.existsSync(resolveRuntimeDataPath("command-permissions.json")),
          },
          customStations: {
            backend: "json-file",
            filePresent: fs.existsSync(resolveRuntimeDataPath("custom-stations.json")),
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
