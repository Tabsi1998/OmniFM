import { logError } from "../../lib/logging.js";

function normalizeIncidentStatusFilter(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "open" || normalized === "acknowledged") return normalized;
  return "all";
}

function normalizeIncidentLimit(value, fallback = 20) {
  const parsed = Number.parseInt(String(value || fallback), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(20, parsed));
}

export function createDashboardStatsRouteHandler(deps) {
  const {
    acknowledgeRuntimeIncident,
    buildDashboardDetailStatsPayload,
    buildDashboardStatsForGuild,
    getDashboardRequestTranslator,
    getDashboardSession,
    getDb,
    getLocalizedJsonBodyError,
    getRecentRuntimeIncidents,
    languagePick,
    methodNotAllowed,
    resetGuildStats,
    resolveDashboardGuildForSession,
    sendJson,
    sendLocalizedError,
    serverHasCapability,
  } = deps;

  return async function handleDashboardStatsRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;

    if (!requestUrl.pathname.startsWith("/api/dashboard/stats")) {
      return false;
    }

    if (requestUrl.pathname === "/api/dashboard/stats/incidents") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "GET" && req.method !== "PATCH") {
        methodNotAllowed(res, ["GET", "PATCH"]);
        return true;
      }

      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }

      const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guild) {
        sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
        return true;
      }
      if (!serverHasCapability(guild.id, "basic_health")) {
        sendLocalizedError(
          res,
          403,
          language,
          "Health-Ansicht ist erst ab Pro verfuegbar.",
          "Health view is only available from Pro."
        );
        return true;
      }

      const statusFilter = normalizeIncidentStatusFilter(requestUrl.searchParams.get("status"));
      const limit = normalizeIncidentLimit(requestUrl.searchParams.get("limit"), 20);

      if (req.method === "GET") {
        const incidents = await getRecentRuntimeIncidents(guild.id, limit, { status: statusFilter });
        sendJson(res, 200, {
          serverId: guild.id,
          tier: guild.tier,
          statusFilter,
          incidents,
        });
        return true;
      }

      let body;
      try {
        body = await readJsonBody();
      } catch (err) {
        const status = err?.statusCode || 400;
        sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
        return true;
      }

      const incidentId = String(body?.incidentId || "").trim();
      if (!incidentId) {
        sendLocalizedError(
          res,
          400,
          language,
          "Incident-ID fehlt.",
          "Incident id is required."
        );
        return true;
      }

      const updatedIncident = await acknowledgeRuntimeIncident(guild.id, incidentId, {
        id: session?.user?.id || null,
        username: session?.user?.username || session?.user?.globalName || null,
      });
      if (!updatedIncident) {
        sendLocalizedError(
          res,
          404,
          language,
          "Vorfall nicht gefunden.",
          "Incident not found."
        );
        return true;
      }

      sendJson(res, 200, {
        success: true,
        serverId: guild.id,
        incident: updatedIncident,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/stats") {
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
        sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
        return true;
      }
      if (!serverHasCapability(guild.id, "dashboard_access")) {
        sendLocalizedError(res, 403, language, "Dashboard ist erst ab Pro verfuegbar.", "Dashboard is only available from Pro.");
        return true;
      }

      const statsPayload = await buildDashboardStatsForGuild(guild.id, guild.tier, runtimes);
      sendJson(res, 200, {
        serverId: guild.id,
        tier: guild.tier,
        basic: statsPayload.basic,
        advanced: serverHasCapability(guild.id, "advanced_analytics") ? statsPayload.advanced : null,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/stats/reset") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "DELETE") {
        methodNotAllowed(res, ["DELETE"]);
        return true;
      }

      const { session } = getDashboardSession(req);
      if (!session) {
        sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
        return true;
      }

      const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
      if (!guild) {
        sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
        return true;
      }
      if (!serverHasCapability(guild.id, "dashboard_access")) {
        sendLocalizedError(res, 403, language, "Dashboard ist erst ab Pro verfuegbar.", "Dashboard is only available from Pro.");
        return true;
      }

      const guildId = guild.id;
      const deletedCounts = {};
      try {
        const db = getDb();
        if (db) {
          // The song plays and the months of the year review (#301) are statistics too.
          for (const collectionName of ["daily_stats", "listening_sessions", "listener_snapshots", "song_plays", "year_review_months"]) {
            // eslint-disable-next-line no-await-in-loop -- one delete after the other; each count goes into the answer
            const result = await db.collection(collectionName).deleteMany({ guildId });
            deletedCounts[collectionName] = result.deletedCount || 0;
          }
          const statsResult = await db.collection("guild_stats").deleteMany({ guildId });
          deletedCounts.guild_stats = statsResult.deletedCount || 0;
        }
        if (typeof resetGuildStats === "function") {
          resetGuildStats(guildId);
        }
      } catch (err) {
        logError("[DashboardStats] Reset failed", err, {
          context: {
            source: "dashboard-stats-reset",
            route: "/api/dashboard/stats/reset",
            guildId,
          },
          includeStack: true,
        });
        sendJson(res, 500, {
          error: languagePick(
            language,
            "Statistiken konnten gerade nicht zurueckgesetzt werden.",
            "Statistics could not be reset right now."
          ),
        });
        return true;
      }

      sendJson(res, 200, { success: true, serverId: guildId, deleted: deletedCounts });
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/stats/detail") {
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
        sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
        return true;
      }
      if (!serverHasCapability(guild.id, "advanced_analytics")) {
        sendLocalizedError(
          res,
          403,
          language,
          "Detaillierte Statistiken sind nur fuer Ultimate verfuegbar.",
          "Detailed statistics are only available for Ultimate."
        );
        return true;
      }

      try {
        const detailPayload = await buildDashboardDetailStatsPayload(
          guild,
          runtimes,
          requestUrl.searchParams.get("days") || "30"
        );
        sendJson(res, 200, detailPayload);
      } catch (err) {
        logError("[DashboardStats] Detail load failed", err, {
          context: {
            source: "dashboard-stats-detail",
            route: "/api/dashboard/stats/detail",
            guildId: guild?.id || "",
          },
          includeStack: true,
        });
        sendLocalizedError(
          res,
          500,
          language,
          "Detaillierte Statistiken konnten nicht geladen werden.",
          "Detailed statistics could not be loaded."
        );
      }
      return true;
    }

    return false;
  };
}
