export function createDashboardPermsRouteHandler(deps) {
  const {
    formatDashboardPermissionMapForClient,
    formatDashboardPermissionRulesForClient,
    getDashboardRequestTranslator,
    getDashboardSession,
    getGuildCommandPermissionRules,
    getLocalizedJsonBodyError,
    methodNotAllowed,
    resetCommandPermissions,
    resolveDashboardGuildForSession,
    resolveDashboardPermissionRuleUpdates,
    resolveRuntimeForGuild,
    sendJson,
    sendLocalizedError,
    serverHasCapability,
    setCommandRolePermission,
  } = deps;

  return async function handleDashboardPermsRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;

    if (requestUrl.pathname !== "/api/dashboard/perms") {
      return false;
    }

    const { language } = getDashboardRequestTranslator(req, requestUrl);
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
    if (!serverHasCapability(guildInfo.id, "role_permissions")) {
      sendLocalizedError(res, 403, language, "Berechtigungen sind erst ab Pro verfügbar.", "Permissions are only available from Pro.");
      return true;
    }

    const { guild } = resolveRuntimeForGuild(runtimes, guildInfo.id);
    if (guild?.roles?.fetch) {
      try {
        await guild.roles.fetch();
      } catch {}
    }

    if (req.method === "GET") {
      const rules = getGuildCommandPermissionRules(guildInfo.id);
      sendJson(res, 200, {
        serverId: guildInfo.id,
        tier: guildInfo.tier,
        rules: formatDashboardPermissionRulesForClient(rules, guild),
        commandRoleMap: formatDashboardPermissionMapForClient(rules, guild),
        updatedAt: null,
      });
      return true;
    }

    if (req.method === "PUT") {
      try {
        const body = await readJsonBody();
        const { supportedCommands, unresolved, resolvedCommands } = await resolveDashboardPermissionRuleUpdates(guild, body);

        if (unresolved.length) {
          sendJson(res, 400, {
            error: language === "de"
              ? `Folgende Rollen konnten nicht aufgelöst werden: ${unresolved.join(" | ")}`
              : `The following roles could not be resolved: ${unresolved.join(" | ")}`,
          });
          return true;
        }

        for (const command of supportedCommands) {
          resetCommandPermissions(guildInfo.id, command);
        }

        for (const item of resolvedCommands) {
          for (const roleId of item.roleIds) {
            setCommandRolePermission(guildInfo.id, item.command, roleId, "allow");
          }
        }

        const rules = getGuildCommandPermissionRules(guildInfo.id);
        sendJson(res, 200, {
          success: true,
          serverId: guildInfo.id,
          rules: formatDashboardPermissionRulesForClient(rules, guild),
          commandRoleMap: formatDashboardPermissionMapForClient(rules, guild),
          updatedAt: new Date().toISOString(),
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
          return true;
        }
        sendLocalizedError(res, 500, language, "Berechtigungen konnten nicht gespeichert werden.", "Permissions could not be saved.");
      }
      return true;
    }

    methodNotAllowed(res, ["GET", "PUT"]);
    return true;
  };
}
