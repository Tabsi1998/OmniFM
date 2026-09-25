import test from "node:test";
import assert from "node:assert/strict";

import { createAuthRoutesHandler } from "../src/api/routes/auth-routes.js";

function createResponseCapture() {
  return {
    statusCode: 0,
    headers: {},
    body: "",
    writeHead(statusCode, headers = {}) {
      this.statusCode = statusCode;
      this.headers = { ...headers };
    },
    end(body = "") {
      this.body += String(body || "");
    },
  };
}

function createAuthRouteHandler(overrides = {}) {
  return createAuthRoutesHandler({
    buildDashboardErrorRedirect: (origin, errorCode, language = "") =>
      `${origin}/?page=dashboard&authError=${encodeURIComponent(errorCode)}&lang=${encodeURIComponent(language)}`,
    buildDashboardSessionCookie: () => "omnifm_session=test-session",
    buildDashboardSessionCookieDeletion: () => "omnifm_session=; Max-Age=0",
    buildDiscordAuthorizeUrl: (stateToken, redirectUri) => `https://discord.example/authorize?state=${stateToken}&redirect_uri=${encodeURIComponent(redirectUri || "")}`,
    getDiscordRedirectUri: () => "https://app.example/api/auth/discord/callback",
    deleteDashboardAuthSession: () => false,
    exchangeDiscordCodeForToken: async () => "discord-access-token",
    fetchDiscordUserGuilds: async () => [],
    fetchDiscordUserProfile: async () => ({ id: "123", username: "Tester" }),
    getCommonSecurityHeaders: () => ({ "Cache-Control": "no-store" }),
    getConfiguredPublicOrigin: () => "https://app.example",
    getDashboardSession: () => ({ session: null, token: "" }),
    getDashboardSessionTtlSeconds: () => 3600,
    getDefaultLanguage: () => "en",
    getDiscordOauthStateTtlSeconds: () => 600,
    getFrontendBaseOrigin: () => "https://evil.example",
    isAllowedFrontendOrigin: (origin) => origin === "https://app.example",
    isDiscordOauthConfigured: () => true,
    languagePick: (_language, de, en) => en,
    log: () => null,
    methodNotAllowed: () => {
      throw new Error("methodNotAllowed should not be reached in this test");
    },
    normalizeLanguage: (value, fallback) => String(value || fallback || "").trim() || String(fallback || "").trim(),
    popDashboardOauthState: () => null,
    resolveDashboardGuildsForSession: (session) => session?.guilds || [],
    resolveDashboardRequestLanguage: () => "de",
    sanitizeDashboardPage: (page) => String(page || "").trim() || "dashboard",
    sendJson: (res, status, payload) => {
      res.statusCode = status;
      res.payload = payload;
    },
    setDashboardAuthSession: () => null,
    setDashboardOauthState: () => null,
    ...overrides,
  });
}

test("discord login stores only trusted frontend origins in oauth state", async () => {
  let storedToken = "";
  let storedPayload = null;
  const handler = createAuthRouteHandler({
    setDashboardOauthState: (token, payload) => {
      storedToken = token;
      storedPayload = payload;
    },
  });

  const req = {
    method: "GET",
    headers: {
      origin: "https://evil.example",
    },
  };
  const res = {};
  const requestUrl = new URL("http://localhost/api/auth/discord/login?nextPage=settings&lang=de");

  const handled = await handler({ req, res, requestUrl, publicUrl: "https://app.example" });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 200);
  assert.equal(res.payload.oauthConfigured, true);
  assert.equal(typeof storedToken, "string");
  assert.ok(storedToken.length > 0);
  assert.equal(storedPayload.origin, "https://app.example");
  assert.equal(storedPayload.language, "de");
  assert.equal(storedPayload.nextPage, "settings");
  // The token exchange later has to name the same redirect URI.
  assert.equal(storedPayload.redirectUri, "https://app.example/api/auth/discord/callback");
  assert.match(res.payload.authUrl, /redirect_uri=https%3A%2F%2Fapp\.example%2Fapi%2Fauth%2Fdiscord%2Fcallback/);
});

test("the login link of the server dashboard sends the browser on to Discord, not to a JSON page", async () => {
  // Live 2026-09-25: "Mit Discord anmelden" (a plain link with ?redirect=1) showed the JSON.
  let stored = null;
  const handler = createAuthRouteHandler({ setDashboardOauthState: (_token, payload) => { stored = payload; } });
  const res = createResponseCapture();
  await handler({
    req: { method: "GET", headers: {} },
    res,
    requestUrl: new URL("http://localhost/api/auth/discord/login?redirect=1&nextPage=dashboard"),
    publicUrl: "https://app.example",
  });
  assert.equal(res.statusCode, 302);
  assert.match(res.headers.Location, /^https:\/\/discord\.example\/authorize\?state=.+&redirect_uri=https%3A%2F%2Fapp\.example/);
  assert.equal(stored.nextPage, "dashboard");

  const notConfigured = createAuthRouteHandler({ isDiscordOauthConfigured: () => false });
  const refused = createResponseCapture();
  await notConfigured({
    req: { method: "GET", headers: {} },
    res: refused,
    requestUrl: new URL("http://localhost/api/auth/discord/login?redirect=1"),
    publicUrl: "https://app.example",
  });
  assert.equal(refused.statusCode, 302);
  assert.equal(refused.headers.Location, "https://app.example/?page=dashboard&authError=oauth_not_configured&lang=de");
});

test("discord callback falls back to the configured frontend origin and keeps the saved language", async () => {
  let storedSessionToken = "";
  let storedSessionPayload = null;
  let exchangedWith = null;
  const handler = createAuthRouteHandler({
    exchangeDiscordCodeForToken: async (code, redirectUri) => {
      exchangedWith = redirectUri;
      return "discord-access-token";
    },
    popDashboardOauthState: () => ({
      origin: "https://evil.example",
      redirectUri: "https://app.example/api/auth/discord/callback",
      language: "de",
      nextPage: "settings",
      createdAt: 1,
      expiresAt: 9999999999,
    }),
    setDashboardAuthSession: (token, payload) => {
      storedSessionToken = token;
      storedSessionPayload = payload;
    },
  });

  const req = {
    method: "GET",
    headers: {},
  };
  const res = createResponseCapture();
  const requestUrl = new URL("http://localhost/api/auth/discord/callback?code=demo-code&state=demo-state");

  const handled = await handler({ req, res, requestUrl, publicUrl: "https://app.example" });

  assert.equal(handled, true);
  assert.equal(res.statusCode, 302);
  assert.equal(res.headers.Location, "https://app.example/?page=settings&lang=de");
  assert.equal(res.headers["Set-Cookie"], "omnifm_session=test-session");
  assert.equal(typeof storedSessionToken, "string");
  assert.ok(storedSessionToken.length > 0);
  assert.deepEqual(storedSessionPayload.user, { id: "123", username: "Tester" });
  assert.deepEqual(storedSessionPayload.guilds, []);
  assert.equal(exchangedWith, "https://app.example/api/auth/discord/callback");
});
