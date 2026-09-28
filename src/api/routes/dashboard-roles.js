export function createDashboardRolesRouteHandler(deps) {
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

  return async function handleDashboardRolesRoute(context) {
    const { req, res, requestUrl, runtimes } = context;

    if (requestUrl.pathname !== "/api/dashboard/roles") {
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
      sendLocalizedError(res, 403, language, "Kein Zugriff.", "No access.");
      return true;
    }
    if (!serverHasCapability(guildInfo.id, "role_permissions")) {
      sendLocalizedError(res, 403, language, "Berechtigungen sind erst ab Pro verfügbar.", "Permissions are only available from Pro.");
      return true;
    }

    const { guild } = resolveRuntimeForGuild(runtimes, guildInfo.id);
    if (!guild) {
      sendJson(res, 200, { roles: [] });
      return true;
    }

    try {
      await guild.roles.fetch();
    } catch {}

    const roles = [];
    for (const [, role] of guild.roles.cache) {
      if (role.managed || role.name === "@everyone") continue;
      roles.push({
        id: role.id,
        name: role.name,
        color: role.hexColor || "#99AAB5",
        position: role.position || 0,
      });
    }

    roles.sort((a, b) => b.position - a.position);
    sendJson(res, 200, { roles });
    return true;
  };
}
