// Dashboard: what plays on a server and what can be done about it.
// Every plan (#413): which bot plays what where, switch its station, stop it.
// Pro and up (basic health, #304): the playback timeline of the last 24
// hours, restart a bot's station or connect it to its voice channel again.
// The dashboard is for the people who manage the server.
import { readPlaybackTimeline } from "../../playback-timeline-store.js";
import { buildLiveView } from "../../lib/playback-timeline.js";
import { collectGuildLiveDetails } from "../helpers/runtime-status.js";

const ACTIONS = Object.freeze({
  "/api/dashboard/playback/restart": { action: "restart", capability: "basic_health" },
  "/api/dashboard/playback/reconnect": { action: "reconnect", capability: "basic_health" },
  "/api/dashboard/playback/switch": { action: "switch", capability: "dashboard_basic" },
  "/api/dashboard/playback/stop": { action: "stop", capability: "dashboard_basic" },
});
const READS = Object.freeze({
  "/api/dashboard/playback": "basic_health",
  "/api/dashboard/playback/now": "dashboard_basic",
});

/** The bots that play on the server now: through the commander's workers, or a single bot itself. */
export async function playingBots(runtimes, guildId) {
  const commander = runtimes.find((runtime) => runtime?.role === "commander" && runtime.workerManager) || null;
  if (commander) {
    await commander.workerManager.refreshRemoteStates?.().catch(() => null);
    return commander.workerManager.getStreamingWorkers(guildId) || [];
  }
  return runtimes.filter((runtime) => runtime?.getState?.(guildId)?.currentStationKey);
}

/** One stream as the dashboard lists it: the bot, where it plays, what and how. */
function streamRow(row) {
  return {
    botId: row.botId,
    botName: row.botName,
    stationKey: row.stationKey,
    stationName: row.stationName,
    channelId: row.channelId,
    channelName: row.channelName,
    listeners: row.listeners,
    recovering: row.recovering === true,
    failoverActive: row.failoverActive === true,
    desiredStationKey: row.desiredStationKey || null,
    desiredStationName: row.desiredStationName || null,
    failbackNextProbeAt: row.failbackNextProbeAt || 0,
    parkedReason: row.parkedReason || null,
    serverMuted: row.serverMuted === true,
    uptimeSec: row.uptimeSec || 0,
  };
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
    const readCapability = READS[requestUrl.pathname] || null;
    if (!action && !readCapability) return false;

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
    const capability = action ? action.capability : readCapability;
    if (!serverHasCapability(guildInfo.id, capability)) {
      sendLocalizedError(res, 403, language, "Die Live-Ansicht gibt es ab Pro.", "The live view is available from Pro.");
      return true;
    }

    if (requestUrl.pathname === "/api/dashboard/playback") {
      sendJson(res, 200, buildLiveView(await readPlaybackTimeline(guildInfo.id)));
      return true;
    }
    if (requestUrl.pathname === "/api/dashboard/playback/now") {
      await playingBots(runtimes, guildInfo.id);
      sendJson(res, 200, { streams: collectGuildLiveDetails(runtimes, guildInfo.id).map(streamRow) });
      return true;
    }

    const botId = String(body.botId || "").trim();
    const bot = (await playingBots(runtimes, guildInfo.id)).find((candidate) => String(candidate?.config?.id || "") === botId);
    if (!bot) {
      sendLocalizedError(res, 404, language, "Dieser Bot spielt auf dem Server gerade nicht.", "This bot is not playing on the server right now.");
      return true;
    }

    let result;
    if (action.action === "switch") {
      // The station of the server's plan, checked like /play does it.
      const commander = runtimes.find((runtime) => runtime?.role === "commander" && typeof runtime.resolveStationForGuild === "function") || null;
      const station = commander?.resolveStationForGuild(guildInfo.id, String(body.stationKey || ""), language) || { ok: false };
      if (!station.ok) {
        sendJson(res, 400, { error: station.message || (language === "de" ? "Diesen Sender gibt es für den Server nicht." : "This station is not available for the server.") });
        return true;
      }
      const row = collectGuildLiveDetails(runtimes, guildInfo.id).find((entry) => String(entry.botId || "") === botId);
      if (!row?.channelId) {
        sendLocalizedError(res, 409, language, "Der Bot ist gerade in keinem Sprachkanal.", "The bot is not in a voice channel right now.");
        return true;
      }
      bot.clearScheduledEventPlaybackInGuild?.(guildInfo.id);
      result = await Promise.resolve(bot.playInGuild(guildInfo.id, row.channelId, station.key, station.stations))
        .catch((err) => ({ ok: false, error: String(err?.message || err) }));
      if (result?.ok) {
        sendJson(res, 200, { ok: true, action: "switch", stationKey: station.key, stationName: station.station?.name || station.key });
        return true;
      }
    } else if (action.action === "stop") {
      result = await Promise.resolve(bot.stopInGuild(guildInfo.id)).catch((err) => ({ ok: false, error: String(err?.message || err) }));
    } else {
      result = action.action === "restart"
        ? await bot.restartStationFromDashboard(guildInfo.id).catch((err) => ({ ok: false, error: String(err?.message || err) }))
        : await bot.reconnectVoiceFromDashboard(guildInfo.id).catch((err) => ({ ok: false, error: String(err?.message || err) }));
    }
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
    sendJson(res, 200, { ok: true, action: action.action });
    return true;
  };
}
