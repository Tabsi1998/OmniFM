// Dashboard: the live view of a server (#304). GET gives the playback timeline
// of every bot on it over the last 24 hours; POST restarts a bot's station or
// connects it to its voice channel again. Pro and up (basic health), like the
// health view; the dashboard is for the people who manage the server.
import { readPlaybackTimeline } from "../../playback-timeline-store.js";
import { buildLiveView } from "../../lib/playback-timeline.js";

const ACTIONS = Object.freeze({
  "/api/dashboard/playback/restart": "restart",
  "/api/dashboard/playback/reconnect": "reconnect",
});

/** The bots that play on the server now: through the commander's workers, or a single bot itself. */
async function playingBots(runtimes, guildId) {
  const commander = runtimes.find((runtime) => runtime?.role === "commander" && runtime.workerManager) || null;
  if (commander) {
    await commander.workerManager.refreshRemoteStates?.().catch(() => null);
    return commander.workerManager.getStreamingWorkers(guildId) || [];
  }
  return runtimes.filter((runtime) => runtime?.getState?.(guildId)?.currentStationKey);
}

export function createDashboardPlaybackRouteHandler(deps) {
  const {
    getDashboardRequestTranslator,
    getDashboardSession,
    methodNotAllowed,
    resolveDashboardGuildForSession,
    sendJson,
    sendLocalizedError,
    serverHasCapability,
  } = deps;

  return async function handleDashboardPlaybackRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes = [] } = context;
    const action = ACTIONS[requestUrl.pathname] || null;
    if (requestUrl.pathname !== "/api/dashboard/playback" && !action) return false;

    const { language } = getDashboardRequestTranslator(req, requestUrl);
    const expectedMethod = action ? "POST" : "GET";
    if (req.method !== expectedMethod) {
      methodNotAllowed(res, [expectedMethod]);
      return true;
    }
    const { session } = getDashboardSession(req);
    if (!session) {
      sendLocalizedError(res, 401, language, "Nicht eingeloggt.", "Not signed in.");
      return true;
    }

    let body = {};
    if (action) {
      try {
        body = (await readJsonBody()) || {};
      } catch {
        sendLocalizedError(res, 400, language, "Ungültige Anfrage.", "Invalid request.");
        return true;
      }
    }
    const guildInfo = resolveDashboardGuildForSession(session, action ? body.serverId : requestUrl.searchParams.get("serverId"));
    if (!guildInfo) {
      sendLocalizedError(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
      return true;
    }
    if (!serverHasCapability(guildInfo.id, "basic_health")) {
      sendLocalizedError(res, 403, language, "Die Live-Ansicht gibt es ab Pro.", "The live view is available from Pro.");
      return true;
    }

    if (!action) {
      sendJson(res, 200, buildLiveView(await readPlaybackTimeline(guildInfo.id)));
      return true;
    }

    const botId = String(body.botId || "").trim();
    const bot = (await playingBots(runtimes, guildInfo.id)).find((candidate) => String(candidate?.config?.id || "") === botId);
    if (!bot) {
      sendLocalizedError(res, 404, language, "Dieser Bot spielt auf dem Server gerade nicht.", "This bot is not playing on the server right now.");
      return true;
    }
    const result = action === "restart"
      ? await bot.restartStationFromDashboard(guildInfo.id).catch((err) => ({ ok: false, error: String(err?.message || err) }))
      : await bot.reconnectVoiceFromDashboard(guildInfo.id).catch((err) => ({ ok: false, error: String(err?.message || err) }));
    if (!result?.ok) {
      if (result?.error === "busy") {
        sendLocalizedError(res, 409, language, "Der Bot verbindet gerade schon neu. Einen Moment warten.", "The bot is already reconnecting. Wait a moment.");
      } else if (result?.error === "not-playing") {
        sendLocalizedError(res, 409, language, "Dieser Bot spielt gerade nichts.", "This bot is not playing anything right now.");
      } else {
        sendLocalizedError(res, 502, language, "Der Bot hat nicht geantwortet. Später noch einmal versuchen.", "The bot did not answer. Try again later.");
      }
      return true;
    }
    sendJson(res, 200, { ok: true, action });
    return true;
  };
}
