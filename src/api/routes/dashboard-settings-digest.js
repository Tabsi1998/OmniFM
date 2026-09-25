import { loadDashboardGuildSettings } from "./dashboard-guild-settings.js";

export function createDashboardSettingsDigestRouteHandler(deps) {
  const {
    buildDashboardWeeklyDigestPreviewPayload,
    buildWeeklyDigestMessage,
    getDashboardRequestTranslator,
    getDashboardSession,
    getLocalizedJsonBodyError,
    methodNotAllowed,
    normalizeWeeklyDigestConfig,
    resolveDashboardGuildForSession,
    resolveGuildTextChannel,
    resolveRuntimeForGuild,
    sendJson,
    sendLocalizedError,
    serverHasCapability,
  } = deps;

  return async function handleDashboardSettingsDigestRoute(context) {
    const { req, res, requestUrl, readJsonBody, runtimes } = context;

    if (requestUrl.pathname === "/api/dashboard/settings/digest-preview") {
      const { language } = getDashboardRequestTranslator(req, requestUrl);
      if (req.method !== "POST") {
        methodNotAllowed(res, ["POST"]);
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
      if (!serverHasCapability(guildInfo.id, "weekly_digest")) {
        sendLocalizedError(res, 403, language, "Woechentlicher Digest ist erst ab Pro verfuegbar.", "Weekly digest is only available from Pro.");
        return true;
      }

      try {
        const body = await readJsonBody();
        const currentSettings = await loadDashboardGuildSettings(guildInfo.id);
        const weeklyDigest = body?.weeklyDigest && typeof body.weeklyDigest === "object"
          ? body.weeklyDigest
          : currentSettings.weeklyDigest || {};
        const previewPayload = await buildDashboardWeeklyDigestPreviewPayload(guildInfo, runtimes, weeklyDigest, language);
        sendJson(res, 200, {
          success: true,
          serverId: guildInfo.id,
          tier: guildInfo.tier,
          ...previewPayload,
        });
      } catch (err) {
        const status = Number(err?.status || 0);
        if (status === 400 || status === 413) {
          sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
          return true;
        }
        sendLocalizedError(res, 500, language, "Digest-Vorschau konnte nicht geladen werden.", "Digest preview could not be loaded.");
      }
      return true;
    }

    if (requestUrl.pathname !== "/api/dashboard/settings/digest-test") {
      return false;
    }

    const { language } = getDashboardRequestTranslator(req, requestUrl);
    if (req.method !== "POST") {
      methodNotAllowed(res, ["POST"]);
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
    if (!serverHasCapability(guildInfo.id, "weekly_digest")) {
      sendLocalizedError(res, 403, language, "Woechentlicher Digest ist erst ab Pro verfuegbar.", "Weekly digest is only available from Pro.");
      return true;
    }

    try {
      const body = await readJsonBody();
      const digest = normalizeWeeklyDigestConfig(body?.weeklyDigest || {}, language);
      if (!digest.channelId) {
        sendLocalizedError(
          res,
          400,
          language,
          "Fuer einen Test-Digest muss ein Text-Channel ausgewaehlt werden.",
          "A text channel is required for a test digest."
        );
        return true;
      }

      const { guild } = resolveRuntimeForGuild(runtimes, guildInfo.id);
      if (!guild) {
        sendLocalizedError(
          res,
          503,
          language,
          "Der Bot ist aktuell nicht mit diesem Server verbunden.",
          "The bot is not connected to this server right now."
        );
        return true;
      }

      const channel = await resolveGuildTextChannel(guild, digest.channelId);
      if (!channel || typeof channel.send !== "function") {
        sendLocalizedError(
          res,
          400,
          language,
          "Der ausgewaehlte Text-Channel ist nicht verfuegbar.",
          "The selected text channel is not available."
        );
        return true;
      }

      const previewPayload = await buildDashboardWeeklyDigestPreviewPayload(guildInfo, runtimes, digest, language);
      // The same Components V2 message the weekly run sends (#278).
      const { payload } = await buildWeeklyDigestMessage(guildInfo.id, {
        guildName: guild.name,
        config: digest,
      });
      await channel.send(payload);
      sendJson(res, 200, {
        success: true,
        serverId: guildInfo.id,
        tier: guildInfo.tier,
        channelId: digest.channelId,
        channelName: previewPayload.preview.channelName || channel.name || "",
        sentAt: new Date().toISOString(),
        ...previewPayload,
      });
    } catch (err) {
      const status = Number(err?.status || 0);
      if (status === 400 || status === 413) {
        sendJson(res, status, { error: getLocalizedJsonBodyError(language, status) });
        return true;
      }
      sendLocalizedError(res, 500, language, "Test-Digest konnte nicht gesendet werden.", "Test digest could not be sent.");
    }

    return true;
  };
}
