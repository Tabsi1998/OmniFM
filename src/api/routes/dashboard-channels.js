export function createDashboardChannelsRouteHandler(deps) {
  const {
    getDashboardRequestTranslator,
    getDashboardSession,
    methodNotAllowed,
    resolveDashboardGuildForSession,
    resolveRuntimeForGuild,
    sendJson,
    sendLocalizedError,
    serverHasCapability,
  } = deps;

  return async function handleDashboardChannelsRoute(context) {
    const { req, res, requestUrl, runtimes } = context;

    if (requestUrl.pathname !== "/api/dashboard/channels") {
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

    const { guild } = resolveRuntimeForGuild(runtimes, guildInfo.id);
    if (!guild) {
      sendJson(res, 200, { voiceChannels: [], textChannels: [] });
      return true;
    }

    try {
      await guild.channels.fetch();
    } catch {}

    const voiceChannels = [];
    const textChannels = [];
    for (const [, channel] of guild.channels.cache) {
      const entry = {
        id: channel.id,
        name: channel.name,
        position: channel.position || 0,
        parentName: channel.parent?.name || "",
      };
      if (channel.type === 2 || channel.type === 13) {
        voiceChannels.push({ ...entry, type: channel.type === 13 ? "stage" : "voice" });
      } else if (channel.type === 0) {
        textChannels.push(entry);
      }
    }

    voiceChannels.sort((a, b) => a.position - b.position);
    textChannels.sort((a, b) => a.position - b.position);
    sendJson(res, 200, { voiceChannels, textChannels });
    return true;
  };
}
