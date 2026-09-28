export function createDashboardEmojisRouteHandler(deps) {
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

  return async function handleDashboardEmojisRoute(context) {
    const { req, res, requestUrl, runtimes } = context;

    if (requestUrl.pathname !== "/api/dashboard/emojis") {
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
      sendJson(res, 200, { emojis: [] });
      return true;
    }

    try {
      await guild.emojis.fetch();
    } catch {}

    const emojis = [];
    for (const [, emoji] of guild.emojis.cache) {
      emojis.push({
        id: emoji.id,
        name: emoji.name || "",
        animated: !!emoji.animated,
        url: emoji.animated
          ? `https://cdn.discordapp.com/emojis/${emoji.id}.gif?size=48`
          : `https://cdn.discordapp.com/emojis/${emoji.id}.webp?size=48`,
        requiresColons: emoji.requiresColons !== false,
        managed: !!emoji.managed,
        available: emoji.available !== false,
      });
    }

    emojis.sort((a, b) => a.name.localeCompare(b.name));
    sendJson(res, 200, { emojis });
    return true;
  };
}
