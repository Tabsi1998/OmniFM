import { randomBytes } from "node:crypto";

export function createAuthRoutesHandler(deps) {
  const {
    buildDashboardErrorRedirect,
    buildDashboardSessionCookie,
    buildDashboardSessionCookieDeletion,
    buildDiscordAuthorizeUrl,
    getDiscordRedirectUri,
    deleteDashboardAuthSession,
    exchangeDiscordCodeForToken,
    fetchDiscordUserGuilds,
    fetchDiscordUserProfile,
    getCommonSecurityHeaders,
    getConfiguredPublicOrigin,
    getDashboardSession,
    getDashboardSessionTtlSeconds,
    getDefaultLanguage,
    getDiscordOauthStateTtlSeconds,
    getFrontendBaseOrigin,
    isAllowedFrontendOrigin,
    isDiscordOauthConfigured,
    languagePick,
    log,
    methodNotAllowed,
    normalizeLanguage,
    popDashboardOauthState,
    resolveDashboardGuildsForSession,
    resolveDashboardRequestLanguage,
    sanitizeDashboardPage,
    sendJson,
    setDashboardAuthSession,
    setDashboardOauthState,
  } = deps;

  function resolveTrustedFrontendOrigin(req, publicUrl, preferredOrigin = "") {
    const candidateOrigin = getFrontendBaseOrigin(req, publicUrl, preferredOrigin);
    if (
      candidateOrigin
      && (
        typeof isAllowedFrontendOrigin !== "function"
        || isAllowedFrontendOrigin(candidateOrigin, publicUrl)
      )
    ) {
      return candidateOrigin;
    }
    return typeof getConfiguredPublicOrigin === "function"
      ? getConfiguredPublicOrigin(publicUrl)
      : candidateOrigin;
  }

  return async function handleAuthRoutes(context) {
    const { req, res, requestUrl, publicUrl } = context;

    if (requestUrl.pathname === "/api/auth/discord/login") {
      const requestLanguage = resolveDashboardRequestLanguage(req, requestUrl);
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      // A plain link (<a href="...?redirect=1">) navigates the browser here: it
      // gets sent on to Discord, not a JSON page. The website's fetch gets JSON.
      const browserRedirect = requestUrl.searchParams.get("redirect") === "1";
      if (!isDiscordOauthConfigured()) {
        if (browserRedirect) {
          res.writeHead(302, {
            ...getCommonSecurityHeaders(),
            Location: buildDashboardErrorRedirect(resolveTrustedFrontendOrigin(req, publicUrl), "oauth_not_configured", requestLanguage),
          });
          res.end();
          return true;
        }
        sendJson(res, 503, {
          error: languagePick(requestLanguage, "Discord OAuth ist noch nicht konfiguriert.", "Discord OAuth is not configured yet."),
          oauthConfigured: false,
        });
        return true;
      }

      const nextPage = sanitizeDashboardPage(requestUrl.searchParams.get("nextPage"));
      const stateToken = randomBytes(24).toString("base64url");
      const frontendOrigin = resolveTrustedFrontendOrigin(req, publicUrl);
      const redirectUri = getDiscordRedirectUri();
      const nowTs = Math.floor(Date.now() / 1000);
      setDashboardOauthState(stateToken, {
        nextPage,
        language: requestLanguage,
        origin: frontendOrigin,
        redirectUri,
        createdAt: nowTs,
        expiresAt: nowTs + getDiscordOauthStateTtlSeconds(),
      });

      const authUrl = buildDiscordAuthorizeUrl(stateToken, redirectUri);
      if (browserRedirect) {
        res.writeHead(302, { ...getCommonSecurityHeaders(), Location: authUrl });
        res.end();
        return true;
      }
      sendJson(res, 200, {
        oauthConfigured: true,
        authUrl,
        state: stateToken,
      });
      return true;
    }

    if (requestUrl.pathname === "/api/auth/discord/callback") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }

      const code = String(requestUrl.searchParams.get("code") || "").trim();
      const stateToken = String(requestUrl.searchParams.get("state") || "").trim();
      const fallbackOrigin = resolveTrustedFrontendOrigin(req, publicUrl);
      const statePayload = popDashboardOauthState(stateToken);
      const frontendOrigin = statePayload
        ? resolveTrustedFrontendOrigin(req, publicUrl, statePayload.origin || "")
        : fallbackOrigin;
      const oauthLanguage = normalizeLanguage(statePayload?.language, getDefaultLanguage());

      if (!isDiscordOauthConfigured()) {
        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: buildDashboardErrorRedirect(frontendOrigin, "oauth_not_configured", oauthLanguage),
        });
        res.end();
        return true;
      }
      if (!statePayload) {
        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: buildDashboardErrorRedirect(frontendOrigin, "invalid_state", oauthLanguage),
        });
        res.end();
        return true;
      }
      if (!code) {
        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: buildDashboardErrorRedirect(frontendOrigin, "missing_code", oauthLanguage),
        });
        res.end();
        return true;
      }

      try {
        const accessToken = await exchangeDiscordCodeForToken(code, statePayload.redirectUri || undefined);
        const userProfile = await fetchDiscordUserProfile(accessToken);
        const guilds = await fetchDiscordUserGuilds(accessToken);
        const sessionToken = randomBytes(32).toString("base64url");
        const nowTs = Math.floor(Date.now() / 1000);
        setDashboardAuthSession(sessionToken, {
          user: userProfile,
          guilds,
          createdAt: nowTs,
          expiresAt: nowTs + getDashboardSessionTtlSeconds(),
        });

        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: `${frontendOrigin}/?page=${sanitizeDashboardPage(statePayload.nextPage)}&lang=${encodeURIComponent(oauthLanguage)}`,
          "Set-Cookie": buildDashboardSessionCookie(sessionToken, req, frontendOrigin),
        });
        res.end();
      } catch (err) {
        log("ERROR", `Discord OAuth callback failed: ${err?.message || err}`);
        res.writeHead(302, {
          ...getCommonSecurityHeaders(),
          Location: buildDashboardErrorRedirect(frontendOrigin, "oauth_exchange_failed", oauthLanguage),
        });
        res.end();
      }
      return true;
    }

    if (requestUrl.pathname === "/api/auth/session") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }

      const { session } = getDashboardSession(req);
      if (!session) {
        sendJson(res, 200, {
          authenticated: false,
          oauthConfigured: isDiscordOauthConfigured(),
          user: null,
          guilds: [],
        });
        return true;
      }

      sendJson(res, 200, {
        authenticated: true,
        oauthConfigured: isDiscordOauthConfigured(),
        user: session.user || null,
        guilds: resolveDashboardGuildsForSession(session),
        expiresAt: session.expiresAt || null,
      });
      return true;
    }

    if (requestUrl.pathname !== "/api/auth/logout") {
      return false;
    }

    if (req.method !== "POST") {
      methodNotAllowed(res, ["POST"]);
      return true;
    }

    const { token } = getDashboardSession(req);
    if (token) {
      deleteDashboardAuthSession(token);
    }
    res.writeHead(200, {
      ...getCommonSecurityHeaders(),
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
      "Set-Cookie": buildDashboardSessionCookieDeletion(req, resolveTrustedFrontendOrigin(req, publicUrl)),
    });
    res.end(JSON.stringify({ success: true }));
    return true;
  };
}
