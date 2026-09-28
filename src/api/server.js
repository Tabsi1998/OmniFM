// ============================================================
// OmniFM: Web Server & API Routes
// ============================================================
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { startOwnerSettingsRefresh } from "../lib/owner-settings-cache.js";
import { forwardToRuntime, isRuntimePath } from "./runtime-forward.js";
import { startOwnerStatusService } from "../services/owner-status/service.js";
import { startStatusSampler } from "../services/status-page.js";
import { startDiscordOauthSync } from "../lib/discord-oauth-settings.js";
import { createAdminRoutesHandler } from "./routes/admin-routes.js";
import { log, webDir, webRootSource, frontendBuildStamp } from "../lib/logging.js";
import { languagePick } from "../lib/language.js";
import {
  getCommonSecurityHeaders,
  sendJson,
  methodNotAllowed,
  sendStaticFile,
  applyCors,
  getAdminApiToken,
  enforceApiRateLimit,
} from "../lib/api-helpers.js";
import { findDashboardAuthSession } from "../dashboard-store.js";
import {
  isDiscordOauthConfigured,
  isSecureCookieRequest,
  resolveDashboardRequestLanguage,
  resolveDashboardSessionToken,
} from "./helpers/session.js";
import {
  handleAuthRoutes,
  handleBotsGGRoutes,
  handleDashboardAccessRoute,
  handleDashboardBotProfileRoute,
  handleDashboardChannelsRoute,
  handleDashboardCustomStationsRoute,
  handleDashboardEmojisRoute,
  handleDashboardEventsRoute,
  handleDashboardExportsRoute,
  handleDashboardLicenseRoute,
  handleDashboardPanelDesignRoute,
  handleDashboardPermsRoute,
  handleDashboardRolesRoute,
  handleDashboardSettingsDigestRoute,
  handleDashboardSettingsRoute,
  handleDashboardStationsRoute,
  handleDashboardStatsRoute,
  handleDashboardTelemetryRoute,
  handleDiscordBotListRoutes,
  handleOwnerStatusRoutes,
  handlePremiumBillingRoutes,
  handlePremiumOffersRoutes,
  handlePremiumReadRoutes,
  handlePublicRoutes,
  handleShareRoutes,
  handleStationLogoRoutes,
  handleTopGGRoutes,
  handleVoteEventsRoutes,
  setRuntimeForwardTarget,
} from "./route-handlers.js";

const SPA_ENTRY_PATHS = new Set([
  "/",
  "/dashboard",
  "/stations",
  "/sender",
  "/premium",
  "/pricing",
  "/preise",
  "/faq",
  "/fragen",
  "/imprint",
  "/impressum",
  "/privacy",
  "/privacy-policy",
  "/datenschutz",
  "/terms",
  "/tos",
  "/terms-of-service",
  "/nutzungsbedingungen",
  "/agb",
  "/status",
  "/charts",
]);

function normalizeSpaPathname(pathname) {
  const raw = String(pathname || "/").trim();
  if (!raw) return "/";
  const withLeadingSlash = raw.startsWith("/") ? raw : `/${raw}`;
  if (withLeadingSlash.length === 1) return withLeadingSlash;
  return withLeadingSlash.replace(/\/+$/, "");
}

function resolveAdminPanelToken() {
  return String(
    process.env.ADMIN_TOKEN
    || getAdminApiToken()
    || process.env.OMNIFM_ADMIN_TOKEN
    || ""
  ).trim();
}

const DASHBOARD_CSRF_HEADER = "x-omnifm-csrf";
const DASHBOARD_CSRF_INTENT = "dashboard-intent";
const DASHBOARD_MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

function isDashboardSessionMutation(req, requestUrl) {
  const method = String(req?.method || "GET").toUpperCase();
  if (!DASHBOARD_MUTATION_METHODS.has(method)) return false;

  const pathname = String(requestUrl?.pathname || "");
  if (pathname === "/api/auth/logout") return true;
  if (pathname === "/api/dashboard/telemetry") return false;
  return pathname.startsWith("/api/dashboard/");
}

function enforceDashboardMutationIntent(req, res, requestUrl) {
  if (!isDashboardSessionMutation(req, requestUrl)) return true;

  const headerValue = String(req.headers[DASHBOARD_CSRF_HEADER] || "").trim();
  if (headerValue === DASHBOARD_CSRF_INTENT) return true;

  const language = resolveDashboardRequestLanguage(req, requestUrl);
  sendJson(res, 403, {
    error: languagePick(
      language,
      "Dashboard-Aktion blockiert: CSRF-Intent-Header fehlt oder ist ungültig.",
      "Dashboard action blocked: CSRF intent header is missing or invalid."
    ),
  });
  return false;
}

const handleAdminRoutes = createAdminRoutesHandler({
  resolveAdminToken: resolveAdminPanelToken,
  log,
  methodNotAllowed,
  sendJson,
  getCommonSecurityHeaders,
  // Discord sign-in of the owner console (#283): the dashboard's login session,
  // straight from MongoDB, since the commander created it seconds ago (#292).
  readDashboardUser: async (req) => {
    const token = resolveDashboardSessionToken(req);
    return token ? (await findDashboardAuthSession(token))?.user || null : null;
  },
  isSecureRequest: (req) => isSecureCookieRequest(req, process.env.PUBLIC_WEB_URL),
  isDiscordLoginConfigured: () => isDiscordOauthConfigured(),
});

/**
 * @param {any[]} runtimes the bots of this process ([] for the public entry)
 * @param {{ forwardRuntimeTo?: string }} [options] forwardRuntimeTo: the
 *   commander's Node API. Set for the public entry (#290): the paths that need
 *   the bots go there, and login sync and cockpit run in the commander only.
 */
function startWebServer(runtimes, { forwardRuntimeTo = "" } = {}) {
  setRuntimeForwardTarget(forwardRuntimeTo);
  if (!forwardRuntimeTo) {
    // A new OAuth secret from the owner console works without a restart.
    startDiscordOauthSync();
    // The owner cockpit checks every service every 5 minutes (#355).
    startOwnerStatusService(runtimes);
  }
  // Plan prices of the owner console (#289).
  startOwnerSettingsRefresh();
  // The public status page measures every minute (#299); the public entry and
  // the commander both do, a minute counts once.
  startStatusSampler();
  const webInternalPort = Number(process.env.WEB_INTERNAL_PORT || "8080");
  const webPort = Number(process.env.WEB_PORT || "8081");
  const webBind = process.env.WEB_BIND || "0.0.0.0";
  const publicUrl = String(process.env.PUBLIC_WEB_URL || "").trim();

  const server = http.createServer(async (req, res) => {
    let requestUrl;
    try {
      requestUrl = new URL(req.url || "/", "http://localhost");
    } catch {
      sendJson(res, 400, { error: "Ungültige Request-URL." });
      return;
    }

    // The public entry passes what needs the bots to the commander, which
    // applies its own CORS, CSRF and rate limits (#290).
    if (forwardRuntimeTo && isRuntimePath(requestUrl.pathname)) {
      forwardToRuntime(req, res, forwardRuntimeTo, { securityHeaders: getCommonSecurityHeaders() });
      return;
    }

    // Owner routes use their own token auth and must not be blocked by
    // generic frontend CORS when a reverse proxy rewrites Host. They are
    // still rate-limited before parsing any potentially large body.
    if (requestUrl.pathname.startsWith("/api/admin/")) {
      if (!enforceApiRateLimit(req, res, requestUrl.pathname)) {
        return;
      }
      if (await handleAdminRoutes({ req, res, requestUrl })) {
        return;
      }
    }

    // CORS
    const originAllowed = applyCors(req, res, publicUrl);
    if (req.method === "OPTIONS") {
      if (!originAllowed) {
        sendJson(res, 403, { error: "Origin nicht erlaubt." });
        return;
      }
      res.writeHead(204, { ...getCommonSecurityHeaders() });
      res.end();
      return;
    }
    if (!originAllowed) {
      sendJson(res, 403, { error: "Origin nicht erlaubt." });
      return;
    }

    if (!enforceApiRateLimit(req, res, requestUrl.pathname)) {
      return;
    }

    if (!enforceDashboardMutationIntent(req, res, requestUrl)) {
      return;
    }

    // --- Helper to read request body ---
    function readRawBody(maxBytes = 1024 * 1024) {
      return new Promise((resolve, reject) => {
        const chunks = [];
        let size = 0;
        let settled = false;

        const fail = (status, message, err = null) => {
          if (settled) return;
          settled = true;
          const error = err || new Error(message);
          error.status = status;
          reject(error);
        };

        req.on("data", (chunk) => {
          if (settled) return;
          size += chunk.length;
          if (size > maxBytes) {
            fail(413, "Body too large");
            return;
          }
          chunks.push(chunk);
        });
        req.on("end", () => {
          if (settled) return;
          settled = true;
          resolve(Buffer.concat(chunks).toString("utf8"));
        });
        req.on("error", (err) => fail(400, err?.message || "Body read error", err));
      });
    }

    // A route may allow a larger body, e.g. the bot look's pictures (#280).
    async function readJsonBody({ maxBytes } = {}) {
      const raw = await readRawBody(maxBytes);
      if (!raw.trim()) return {};
      try {
        return JSON.parse(raw);
      } catch {
        const err = new Error("Invalid JSON");
        err.status = 400;
        throw err;
      }
    }

    // --- API routes ---
    if (await handleShareRoutes({ req, res, requestUrl, runtimes })) {
      return;
    }
    if (await handleStationLogoRoutes({ req, res, requestUrl })) {
      return;
    }
    if (await handleOwnerStatusRoutes({ req, res, requestUrl, readJsonBody })) {
      return;
    }

    if (await handlePublicRoutes({ req, res, requestUrl, runtimes })) {
      return;
    }

    if (await handleAuthRoutes({ req, res, requestUrl, publicUrl })) {
      return;
    }

    if (await handleDashboardAccessRoute({ req, res, requestUrl })) {
      return;
    }

    if (await handleDiscordBotListRoutes({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    if (await handleBotsGGRoutes({ req, res, requestUrl, runtimes })) {
      return;
    }

    if (await handleTopGGRoutes({ req, res, requestUrl, readJsonBody, readRawBody, runtimes })) {
      return;
    }

    if (await handleVoteEventsRoutes({ req, res, requestUrl })) {
      return;
    }

    if (await handleDashboardStatsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    if (await handleDashboardTelemetryRoute({ req, res, requestUrl, readJsonBody })) {
      return;
    }
    if (await handleDashboardEventsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    if (await handleDashboardPanelDesignRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }
    if (await handleDashboardBotProfileRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    if (await handleDashboardPermsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }
    if (await handleDashboardChannelsRoute({ req, res, requestUrl, runtimes })) {
      return;
    }
    if (await handleDashboardEmojisRoute({ req, res, requestUrl, runtimes })) {
      return;
    }

    if (await handleDashboardStationsRoute({ req, res, requestUrl })) {
      return;
    }

    if (await handleDashboardCustomStationsRoute({ req, res, requestUrl, readJsonBody })) {
      return;
    }
    if (await handleDashboardRolesRoute({ req, res, requestUrl, runtimes })) {
      return;
    }

    if (await handleDashboardLicenseRoute({ req, res, requestUrl, readJsonBody })) {
      return;
    }

    if (await handleDashboardSettingsDigestRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    if (await handleDashboardExportsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    if (await handleDashboardSettingsRoute({ req, res, requestUrl, readJsonBody, runtimes })) {
      return;
    }

    // --- Premium API ---
    if (await handlePremiumReadRoutes({ req, res, requestUrl, runtimes })) {
      return;
    }

    if (await handlePremiumBillingRoutes({ req, res, requestUrl, readJsonBody, readRawBody, runtimes, publicUrl })) {
      return;
    }

    if (await handlePremiumOffersRoutes({ req, res, requestUrl, readJsonBody })) {
      return;
    }

    // --- Admin Panel (versteckt, Token-geschützt) ---
    if (await handleAdminRoutes({ req, res, requestUrl })) {
      return;
    }

    if (requestUrl.pathname.startsWith("/api/")) {
      sendJson(res, 404, { error: "API route not found." });
      return;
    }

    if (req.method !== "GET" && req.method !== "HEAD") {
      methodNotAllowed(res, ["GET", "HEAD"]);
      return;
    }

    // --- Static file serving from the built frontend ---
    const normalizedPathname = normalizeSpaPathname(requestUrl.pathname);
    if (normalizedPathname === "/favicon.ico") {
      const faviconFile = path.join(webDir, "img", "bot-1.png");
      sendStaticFile(res, faviconFile, { headOnly: req.method === "HEAD" });
      return;
    }

    // Dashboard SPA: /dashboard und /dashboard/* → dashboard.html
    if (normalizedPathname === "/dashboard" || normalizedPathname.startsWith("/dashboard/")) {
      const legacyDashboardFile = path.join(webDir, "dashboard.html");
      const dashboardFile = fs.existsSync(legacyDashboardFile)
        ? legacyDashboardFile
        : path.join(webDir, "index.html");
      sendStaticFile(res, dashboardFile, { headOnly: req.method === "HEAD" });
      return;
    }

    const shouldServeSpaEntry = SPA_ENTRY_PATHS.has(normalizedPathname);
    const staticPath = shouldServeSpaEntry
      ? "index.html"
      : (normalizedPathname === "/" ? "index.html" : normalizedPathname.replace(/^\/+/, ""));
    const filePath = path.join(webDir, staticPath);

    // 404-Fallback: optionales 404.html aus dem Frontend-Build.
    const notFoundFile = path.join(webDir, "404.html");
    sendStaticFile(res, filePath, {
      headOnly: req.method === "HEAD",
      notFoundPath: notFoundFile,
    });
  });

  server.listen(webInternalPort, webBind, () => {
    log("INFO", `Webseite aktiv (container) auf http://${webBind}:${webInternalPort}`);
    log("INFO", `Webseite Host-Port: ${webPort}`);
    log("INFO", `Web-Static-Root: ${webDir}`);
    log("INFO", `Web-Root-Quelle: ${webRootSource}`);
    if (frontendBuildStamp) {
      log("INFO", `Frontend-Build-Timestamp: ${frontendBuildStamp}`);
    }
    if (publicUrl) {
      log("INFO", `Public URL: ${publicUrl}`);
    }
  });

  return server;
}

export { startWebServer };
