// The dashboard listens instead of asking (#502): GET /api/dashboard/live?serverId=…
// is a stream of Server-Sent Events. The first message comes at once, then
// one whenever what the overview shows changes (src/lib/dashboard-live.js).
// Every plan gets the streams, Pro and up also the minutes listened and the
// setup status, the same as /api/dashboard/playback/now and /api/dashboard/stats.
import { createHash } from "node:crypto";
import { LIVE_RETRY_MS, createLiveHub } from "../../lib/dashboard-live.js";

export function createDashboardLiveRouteHandler(deps) {
  const {
    buildDashboardLiveSnapshot,
    getClientIp,
    getCommonSecurityHeaders,
    getDashboardRequestTranslator,
    getDashboardSession,
    methodNotAllowed,
    resolveDashboardGuildForSession,
    sendLocalizedError,
    serverHasCapability,
    hub = createLiveHub(),
  } = deps;

  return async function handleDashboardLiveRoute(context) {
    const { req, res, requestUrl, runtimes = [] } = context;
    if (requestUrl.pathname !== "/api/dashboard/live") return false;

    const { language } = getDashboardRequestTranslator(req, requestUrl);
    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return true;
    }
    const { session, token } = getDashboardSession(req);
    if (!session) {
      sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
      return true;
    }
    const guild = resolveDashboardGuildForSession(session, requestUrl.searchParams.get("serverId"));
    if (!guild) {
      sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
      return true;
    }
    if (!serverHasCapability(guild.id, "dashboard_basic")) {
      sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
      return true;
    }

    // Counted per sign-in (never the token itself) and per visitor address.
    const sessionKey = createHash("sha256").update(String(token)).digest("hex").slice(0, 24);
    const address = String(getClientIp(req) || "unknown");
    if (!hub.hasRoom(sessionKey, address)) {
      sendLocalizedError(res, 429, language, "Zu viele offene Live-Verbindungen.", "Too many open live connections.");
      return true;
    }

    res.writeHead(200, {
      ...getCommonSecurityHeaders(),
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-store",
      Connection: "keep-alive",
      // nginx passes the messages on at once instead of collecting them.
      "X-Accel-Buffering": "no",
    });
    // A browser that lost the stream asks again after ten seconds, not three.
    res.write(`retry: ${LIVE_RETRY_MS}\n\n`);

    const stop = hub.watch({
      guildId: guild.id,
      sessionKey,
      address,
      snapshot: () => buildDashboardLiveSnapshot(guild.id, guild.tier, runtimes, {
        withStats: serverHasCapability(guild.id, "dashboard_access"),
      }),
      // Signed out, or no longer allowed on the server: the stream ends.
      stillAllowed: () => {
        const current = getDashboardSession(req).session;
        return Boolean(current && resolveDashboardGuildForSession(current, guild.id) && serverHasCapability(guild.id, "dashboard_basic"));
      },
      write: (text) => res.write(text),
      end: () => res.end(),
    });
    req.on("close", stop);
    return true;
  };
}
