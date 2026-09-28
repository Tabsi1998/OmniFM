// ============================================================
// OmniFM: the owner console's API on Node (#288), FastAPI's contract
// ============================================================
// The owner console is the React app (frontend, /admin). These routes answer
// it exactly like FastAPI's backend/routers/admin*.py, on the same MongoDB
// collections. Access like FastAPI's _admin_guard(): the owner token
// (API_ADMIN_TOKEN) in X-Admin-Token or "Authorization: Bearer"; no cookie,
// no ?token= in the address. 503 without a configured token, else 401.
//
//   POST /api/admin/login                 check the owner token
//   GET  /api/admin/overview              bots, servers, licences, revenue
//   GET  /api/admin/guilds | workers | monitoring | failover-history
//   GET  /api/admin/integrations, POST /api/admin/integrations/test
//   GET  /api/admin/audit | discord/logs | activity
//   GET/PUT /api/admin/config             owner settings, secrets masked
//   GET/POST /api/admin/licenses, PATCH/DELETE /api/admin/licenses/:key
//   GET  /api/admin/archive, POST /api/admin/archive/:id/restore
//   GET/POST /api/admin/stations, GET /api/admin/stations/list,
//   POST /api/admin/stations/test | health, DELETE /api/admin/stations/:key
// ============================================================

import { recordOwnerAudit } from "../../lib/owner-audit-store.js";
import { syncDiscordOauthFromOwnerConfig } from "../../lib/discord-oauth-settings.js";
import {
  OWNER_ROLE_LABELS,
  accessSettings,
  accountForDiscordUser,
  createOwnerSession,
  csrfSatisfied,
  deleteOwnerSession,
  ownerSessionCookie,
  ownerSessionTokenFrom,
  resolveOwnerIdentity,
  roleAllows,
  roleMaySaveSection,
  tokenLoginEnabled,
  validateAccessSave,
} from "../../lib/owner-access.js";
import { refreshOwnerSettings } from "../../lib/owner-settings-cache.js";
import { getClientIp, safeTokenEquals } from "../../lib/api-helpers.js";
import { getDb, isConnected } from "../../lib/db.js";
import {
  OWNER_CONFIG_ID,
  OWNER_CONFIG_SECTIONS,
  configSectionFrom,
  loadOwnerConfigRaw,
  mergedSectionForSave,
  ownerConfigResponse,
  sectionResponse,
} from "../../lib/owner-config.js";
import { licenseRows, parseIntLike } from "../../lib/owner-licenses.js";
import {
  FAILOVER_HISTORY_EVENTS,
  TIER_PRICE_CENTS,
  commanderIndex,
  configBool,
  directorySetting,
  formatFailoverHistoryRow,
  integrationFlags,
  isDiscordOauthConfigured,
  liveRuntimeTotals,
  loadConfiguredBots,
  monitoringResponse,
  readReleaseInfo,
  readRuntimeHealthFresh,
  runtimeGuildDirectory,
  stationSummary,
  systemSetting,
  workersResponse,
} from "../../lib/owner-monitoring.js";
import { isAllowedOperatorWebhookUrl } from "../../services/operator-webhook.js";
import nodemailer from "nodemailer";
import { reloadPremiumStore } from "../../premium-store.js";
import { SERVER_DATA_RETENTION_DAYS, listGuildDepartures } from "../../guild-departures-store.js";
import { createAdminLicenseRoutes } from "./admin-license-routes.js";
import { createAdminStatusRoutes } from "./admin-status-routes.js";
import { createAdminSuggestionRoutes } from "./admin-suggestion-routes.js";
import { createAdminStationRoutes, loadCatalogFileStations } from "./admin-station-routes.js";

export function readRequestBody(req, limitBytes = 4096) {
  const maxBytes = Math.max(1, Math.floor(Number(limitBytes) || 4096));

  return new Promise((resolve, reject) => {
    let settled = false;
    let size = 0;
    const chunks = [];
    let onData = null;
    let onEnd = null;
    let onError = null;

    const cleanup = () => {
      if (onData) req.removeListener?.("data", onData);
      if (onEnd) req.removeListener?.("end", onEnd);
      if (onError) req.removeListener?.("error", onError);
    };

    const fail = (message, statusCode = 413) => {
      if (settled) return;
      settled = true;
      cleanup();

      chunks.length = 0;

      // Stop retaining request data immediately, but drain the stream so the
      // route can still return a meaningful 413 response on a keep-alive
      // connection instead of tearing down the entire socket.
      try {
        req.resume?.();
      } catch {
        // The route handler still returns the bounded-request error below.
      }

      const error = new Error(message);
      error.statusCode = statusCode;
      reject(error);
    };

    const declaredLength = Number.parseInt(String(req.headers?.["content-length"] || ""), 10);
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      fail("Request body too large");
      return;
    }

    onData = (chunk) => {
      if (settled) return;
      const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      size += buffer.length;
      if (size > maxBytes) {
        fail("Request body too large");
        return;
      }
      chunks.push(buffer);
    };

    onEnd = () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(Buffer.concat(chunks).toString("utf8"));
    };

    onError = (error) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(error);
    };

    req.on("data", onData);
    req.on("end", onEnd);
    req.on("error", onError);
  });
}

export function createAdminRoutesHandler(deps) {
  const {
    ADMIN_TOKEN,
    log,
    methodNotAllowed,
    sendJson,
    resolveAdminToken,
    getCommonSecurityHeaders,
    // The Discord user of the dashboard session in this request, or null (#283).
    readDashboardUser = () => null,
    isSecureRequest = () => false,
    isDiscordLoginConfigured = () => false,
  } = deps;

  function resolveConfiguredAdminToken() {
    return String(resolveAdminToken?.() || ADMIN_TOKEN || "").trim();
  }

  /** The owner token from X-Admin-Token or "Authorization: Bearer", like FastAPI's is_admin_request(). */
  function getAdminTokenFromRequest(req) {
    const headerToken = String(req.headers?.["x-admin-token"] || "").trim();
    if (headerToken) return headerToken;
    const authHeader = String(req.headers?.authorization || "").trim();
    return /^bearer\s+/i.test(authHeader) ? authHeader.replace(/^bearer\s+/i, "").trim() : "";
  }

  function isAdminTokenValue(token) {
    const adminToken = resolveConfiguredAdminToken();
    return Boolean(adminToken) && tokenLoginEnabled() && safeTokenEquals(String(token || "").trim(), adminToken);
  }

  function sendAdminJson(res, status, payload, extraHeaders = {}) {
    res.writeHead(status, {
      ...(typeof getCommonSecurityHeaders === "function" ? getCommonSecurityHeaders() : {}),
      ...extraHeaders,
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify(payload));
  }

  function getRequestAuditMeta(req) {
    return {
      ip: getClientIp(req),
      userAgent: String(req.headers?.["user-agent"] || "").slice(0, 200),
      origin: String(req.headers?.origin || "").slice(0, 200),
    };
  }

  /** The checks of POST /api/admin/integrations/test, like FastAPI's check_all(). */
  async function runIntegrationTests(names, sendTestAlert) {
    const raw = await loadOwnerConfigRaw();
    const db = isConnected() ? getDb() : null;
    const results = {};
    const clipMessage = (value) => String(value?.message || value || "").slice(0, 160);
    if (names.includes("mongo")) {
      try {
        if (!db) throw new Error("MongoDB ist nicht verbunden");
        await db.command({ ping: 1 });
        results.mongo = { ok: true, message: "MongoDB antwortet." };
      } catch (err) {
        results.mongo = { ok: false, message: clipMessage(err) };
      }
    }
    if (names.includes("discordoauth")) {
      const ok = isDiscordOauthConfigured(raw);
      results.discordOAuth = { ok, message: ok ? "OAuth-Konfiguration vollständig." : "Client ID, Secret oder Redirect URI fehlt." };
    }
    if (names.includes("smtp")) {
      const host = String(systemSetting(raw, "smtp", "host", "SMTP_HOST") || "").trim();
      if (!host) {
        results.smtp = { ok: false, message: "SMTP Host fehlt." };
      } else {
        const port = parseIntLike(systemSetting(raw, "smtp", "port", "SMTP_PORT", 587), 587);
        const user = String(systemSetting(raw, "smtp", "user", "SMTP_USER") || "").trim();
        const pass = String(systemSetting(raw, "smtp", "password", "SMTP_PASS") || "");
        try {
          const transport = nodemailer.createTransport({
            host, port, secure: configBool(systemSetting(raw, "smtp", "secure", "SMTP_SECURE", false)),
            auth: user ? { user, pass } : undefined, connectionTimeout: 10_000, greetingTimeout: 10_000,
          });
          await transport.verify();
          transport.close?.();
          results.smtp = { ok: true, message: "SMTP-Verbindung und Anmeldung erfolgreich." };
        } catch (err) {
          results.smtp = { ok: false, message: clipMessage(err) };
        }
      }
    }
    if (names.includes("recognition")) {
      const enabled = configBool(systemSetting(raw, "audioRecognition", "enabled", "NOW_PLAYING_RECOGNITION_ENABLED", false));
      const hasKey = Boolean(systemSetting(raw, "audioRecognition", "apiKey", "ACOUSTID_API_KEY"));
      results.recognition = { ok: enabled && hasKey, message: enabled && hasKey ? "Song-Erkennung ist vollständig konfiguriert." : "Aktivierung oder API Key fehlt." };
    }
    if (names.includes("songhistory")) {
      const enabled = configBool(systemSetting(raw, "songHistory", "enabled", "SONG_HISTORY_ENABLED", true), true);
      results.songHistory = { ok: enabled && Boolean(db), message: enabled && db ? "Song-Verlauf und MongoDB sind aktiv." : "Song-Verlauf ist deaktiviert oder MongoDB fehlt." };
    }
    if (names.includes("operatoralerts")) {
      // "check all" only looks at the setting; the button sends a real test alert (#260).
      const url = String(systemSetting(raw, "operatorAlerts", "webhookUrl", "OPERATOR_WEBHOOK_URL") || "").trim();
      if (!url) {
        results.operatorAlerts = { ok: false, message: "Keine Webhook-URL für Betreiber-Alarme gesetzt." };
      } else if (!isAllowedOperatorWebhookUrl(url)) {
        results.operatorAlerts = { ok: false, message: "Die URL ist kein Discord-Webhook (https://discord.com/api/webhooks/…)." };
      } else if (!sendTestAlert) {
        results.operatorAlerts = { ok: true, message: "Webhook-URL ist gesetzt." };
      } else {
        const mention = String(systemSetting(raw, "operatorAlerts", "mention", "OPERATOR_WEBHOOK_MENTION") || "").trim();
        try {
          const response = await fetch(url, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            redirect: "manual",
            signal: AbortSignal.timeout(10_000),
            body: JSON.stringify({
              username: "OmniFM Operator",
              content: mention || null,
              embeds: [{ title: "🧪 Testalarm", description: "So sehen Betreiber-Alarme von OmniFM aus. Die Einrichtung stimmt.", color: 0x00f0ff }],
            }),
          });
          results.operatorAlerts = response.status < 300
            ? { ok: true, message: "Testalarm gesendet, schau in den Discord-Kanal." }
            : { ok: false, message: `Discord antwortet mit HTTP ${response.status}.` };
        } catch (err) {
          results.operatorAlerts = { ok: false, message: clipMessage(err) };
        }
      }
    }
    const directories = {
      discordbotlist: ["discordBotList", "DISCORDBOTLIST_TOKEN", "DISCORDBOTLIST_BOT_ID", "Discord Bot List"],
      botsgg: ["botsGG", "BOTSGG_TOKEN", "BOTSGG_BOT_ID", "Bots.gg"],
      topgg: ["topGG", "TOPGG_TOKEN", "TOPGG_BOT_ID", "Top.gg"],
    };
    for (const [name, [directory, tokenEnv, botIdEnv, label]] of Object.entries(directories)) {
      if (!names.includes(name)) continue;
      const enabled = configBool(directorySetting(raw, directory, "enabled", tokenEnv.replace("TOKEN", "ENABLED"), false));
      const token = String(directorySetting(raw, directory, "token", tokenEnv) || "").trim();
      const botId = String(directorySetting(raw, directory, "botId", botIdEnv) || "").trim();
      const complete = enabled && Boolean(token) && /^\d{17,22}$/.test(botId);
      results[directory] = { ok: complete, message: complete ? `${label} ist vollständig konfiguriert.` : `${label}: Aktivierung, Token oder gültige Bot-ID fehlt.` };
    }
    return results;
  }

  function auditOwnerAction(req, event) {
    try {
      // The person behind the request (#283): the Discord account, or "owner" for the script token like FastAPI.
      return recordOwnerAudit({
        actor: req.ownerIdentity?.actor || "owner",
        ...event,
        metadata: {
          ...getRequestAuditMeta(req),
          ...(event?.metadata && typeof event.metadata === "object" ? event.metadata : {}),
        },
      });
    } catch (err) {
      log?.("WARN", `[Owner] Audit konnte nicht geschrieben werden: ${err?.message || String(err)}`);
      return null;
    }
  }

  // Licenses, activity and archive; the station catalogue (#293).
  const routeDeps = { sendJson, methodNotAllowed, auditOwnerAction, readRequestBody };
  const handleLicenseRoutes = createAdminLicenseRoutes(routeDeps);
  const handleStationRoutes = createAdminStationRoutes(routeDeps);
  // The notices of the public status page (#299).
  const handleStatusRoutes = createAdminStatusRoutes(routeDeps);
  // The queue of station suggestions (#303).
  const handleSuggestionRoutes = createAdminSuggestionRoutes(routeDeps);

  return async function handleAdminRoutes(context) {
    const { req, res, requestUrl } = context;
    const pathname = requestUrl?.pathname || "";

    // POST /api/admin/login: the owner console checks its token (#288, like FastAPI).
    if (pathname === "/api/admin/login") {
      if (req.method !== "POST") { methodNotAllowed(res, ["POST"]); return true; }
      if (!resolveConfiguredAdminToken()) {
        sendAdminJson(res, 503, { error: "Owner-API ist nicht konfiguriert (API_ADMIN_TOKEN fehlt)." });
        return true;
      }
      let bodyToken;
      try {
        bodyToken = String(JSON.parse(await readRequestBody(req) || "{}")?.token || "").trim();
      } catch {
        bodyToken = "";
      }
      const token = bodyToken || getAdminTokenFromRequest(req);
      if (token && isAdminTokenValue(token)) {
        sendAdminJson(res, 200, { ok: true, role: "owner" });
      } else {
        sendAdminJson(res, 401, { error: "Ungueltiger Owner-Token." });
      }
      return true;
    }

    // /api/admin/session: sign in with Discord, who is signed in, sign out (#283).
    if (pathname === "/api/admin/session") {
      if (req.method === "GET") {
        const identity = await resolveOwnerIdentity(req, { adminToken: resolveConfiguredAdminToken() });
        sendAdminJson(res, 200, identity
          ? { authenticated: true, via: identity.via, role: identity.role, roleLabel: OWNER_ROLE_LABELS[identity.role], user: identity.user }
          : { authenticated: false, discordLogin: Boolean(isDiscordLoginConfigured()) });
        return true;
      }
      if (req.method === "DELETE") {
        await deleteOwnerSession(ownerSessionTokenFrom(req));
        sendAdminJson(res, 200, { ok: true }, { "Set-Cookie": ownerSessionCookie("", { secure: isSecureRequest(req) }) });
        return true;
      }
      if (req.method !== "POST") { methodNotAllowed(res, ["GET", "POST", "DELETE"]); return true; }
      // No foreign page may sign someone in: the header needs a script of this site.
      if (!csrfSatisfied(req, { via: "discord" })) {
        sendAdminJson(res, 403, { error: "CSRF-Schutz: Anmeldung nur aus der Owner-Konsole." });
        return true;
      }
      const user = await readDashboardUser(req);
      if (!user?.id) {
        sendAdminJson(res, 401, { error: "Nicht mit Discord angemeldet." });
        return true;
      }
      const account = accountForDiscordUser(user.id);
      if (!account) {
        req.ownerIdentity = { actor: `${user.globalName || user.username || "Discord"} (${user.id})` };
        auditOwnerAction(req, { action: "owner.login", status: "denied", target: String(user.id), summary: `Discord-Konto ${user.globalName || user.username || user.id} ohne Zugang` });
        sendAdminJson(res, 403, { error: "Dieses Discord-Konto hat keinen Zugang zur Owner-Konsole." });
        return true;
      }
      const session = await createOwnerSession({ discordId: account.discordId, name: account.name });
      req.ownerIdentity = { via: "discord", role: account.role, actor: `${account.name} (${account.discordId})` };
      auditOwnerAction(req, { action: "owner.login", status: "success", target: account.discordId, summary: `Anmeldung über Discord (${OWNER_ROLE_LABELS[account.role]})` });
      sendAdminJson(res, 200, {
        authenticated: true,
        via: "discord",
        role: account.role,
        roleLabel: OWNER_ROLE_LABELS[account.role],
        user: { id: account.discordId, name: account.name },
      }, { "Set-Cookie": ownerSessionCookie(session.token, { secure: isSecureRequest(req) }) });
      return true;
    }

    // ---- Only /api/admin/* from here: the script token or a Discord owner session (#283) ----
    if (!pathname.startsWith("/api/admin/")) return false;
    const identity = await resolveOwnerIdentity(req, { adminToken: resolveConfiguredAdminToken() });
    if (!identity) {
      if (!resolveConfiguredAdminToken() && !accessSettings().accounts.length) {
        sendAdminJson(res, 503, { error: "Owner-API ist nicht konfiguriert (API_ADMIN_TOKEN fehlt)." });
      } else {
        sendAdminJson(res, 401, { error: "Nicht autorisiert. Gueltiger Owner-Token erforderlich." });
      }
      return true;
    }
    if (!csrfSatisfied(req, identity)) {
      sendAdminJson(res, 403, { error: "CSRF-Schutz: Änderungen nur aus der Owner-Konsole." });
      return true;
    }
    req.ownerIdentity = identity;
    if (!roleAllows(identity.role, req.method, pathname)) {
      auditOwnerAction(req, { action: "owner.denied", status: "denied", target: `${req.method} ${pathname}`, summary: `Rolle ${OWNER_ROLE_LABELS[identity.role]} darf das nicht` });
      sendAdminJson(res, 403, { error: `Deine Rolle (${OWNER_ROLE_LABELS[identity.role]}) darf das nicht.` });
      return true;
    }

    // ---- Monitoring, overview and logs with FastAPI's contract (#288) ----
    const monitoringDb = () => (isConnected() ? getDb() : null);

    // GET /api/admin/overview
    if (pathname === "/api/admin/overview") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const db = monitoringDb();
      const raw = await loadOwnerConfigRaw();
      const rows = licenseRows(await reloadPremiumStore());
      const active = rows.filter((row) => row.active);
      const byPlan = {};
      let mrr = 0;
      let seatsSold = 0;
      for (const row of active) {
        byPlan[row.plan] = (byPlan[row.plan] || 0) + 1;
        seatsSold += row.seats;
        mrr += ((TIER_PRICE_CENTS[row.plan] || 0) / 100) * row.seats;
      }
      const stations = await stationSummary(db, loadCatalogFileStations);
      const bots = loadConfiguredBots(raw);
      const live = liveRuntimeTotals(await readRuntimeHealthFresh(db));
      const commander = bots.find((bot) => bot.index === commanderIndex()) || bots[0] || null;
      const flags = await integrationFlags(db, raw);
      const directoryToken = (directory, envKey) => Boolean(String(directorySetting(raw, directory, "token", envKey) || "").trim());
      sendJson(res, 200, {
        generatedAt: new Date().toISOString(),
        brand: "OmniFM",
        release: readReleaseInfo(),
        licenses: { total: rows.length, active: active.length, expired: rows.filter((row) => row.expired).length, byPlan, seatsSold },
        revenue: { mrr: Math.round(mrr * 100) / 100, arr: Math.round(mrr * 12 * 100) / 100, currency: "EUR" },
        stations: { free: stations.free, pro: stations.pro, total: stations.total },
        bots: { configured: bots.length, online: live.botsOnline, commander: commander?.name ?? null },
        guilds: { managed: live.servers, live: live.live },
        integrations: {
          mongo: flags.mongo,
          discordOAuth: flags.discordOAuth,
          smtp: flags.smtp,
          discordBotList: directoryToken("discordBotList", "DISCORDBOTLIST_TOKEN"),
          botsGG: directoryToken("botsGG", "BOTSGG_TOKEN"),
          topGG: directoryToken("topGG", "TOPGG_TOKEN"),
          recognition: flags.recognition,
        },
      });
      return true;
    }

    // GET /api/admin/guilds
    if (pathname === "/api/admin/guilds") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const db = monitoringDb();
      const health = await readRuntimeHealthFresh(db);
      const guilds = Object.values(await runtimeGuildDirectory(db, health))
        .sort((a, b) => String(a.name || "").toLowerCase().localeCompare(String(b.name || "").toLowerCase()));
      sendJson(res, 200, { guilds, count: guilds.length, live: Boolean(health) });
      return true;
    }

    // GET /api/admin/server-retention: servers OmniFM was removed from, and when their data goes (#285)
    if (pathname === "/api/admin/server-retention") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const pending = (await listGuildDepartures()).map((departure) => ({
        guildId: departure.guildId,
        guildName: departure.guildName || "",
        leftAt: departure.leftAt,
        deleteAfter: departure.deleteAfter,
        ownerNotified: Boolean(departure.ownerNotifiedAt),
      }));
      sendJson(res, 200, { retentionDays: SERVER_DATA_RETENTION_DAYS, pending, count: pending.length });
      return true;
    }

    // GET /api/admin/workers
    if (pathname === "/api/admin/workers") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      sendJson(res, 200, await workersResponse(monitoringDb(), await loadOwnerConfigRaw()));
      return true;
    }

    // GET /api/admin/monitoring
    if (pathname === "/api/admin/monitoring") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      sendJson(res, 200, await monitoringResponse(monitoringDb()));
      return true;
    }

    // GET /api/admin/failover-history
    if (pathname === "/api/admin/failover-history") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const limit = Math.max(1, Math.min(500, parseIntLike(requestUrl.searchParams.get("limit") ?? 100, 100)));
      let history = [];
      const db = monitoringDb();
      if (db) {
        try {
          history = (await db.collection("runtime_incidents").find({ eventKey: { $in: [...FAILOVER_HISTORY_EVENTS] } }, { projection: { _id: 0 } })
            .sort({ timestamp: -1 }).limit(limit).toArray()).map(formatFailoverHistoryRow);
        } catch {
          history = [];
        }
      }
      sendJson(res, 200, { history, count: history.length });
      return true;
    }

    // GET /api/admin/integrations
    if (pathname === "/api/admin/integrations") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const db = monitoringDb();
      const raw = await loadOwnerConfigRaw();
      const premium = await reloadPremiumStore();
      const directoryStatus = (directory, enabledEnv, tokenEnv, botIdEnv) => {
        const enabled = configBool(directorySetting(raw, directory, "enabled", enabledEnv, false));
        const token = String(directorySetting(raw, directory, "token", tokenEnv) || "").trim();
        const botId = String(directorySetting(raw, directory, "botId", botIdEnv) || "").trim();
        return { enabled, configured: enabled && Boolean(token) && /^\d{17,22}$/.test(botId), botId: botId || null };
      };
      const dblToken = String(directorySetting(raw, "discordBotList", "token", "DISCORDBOTLIST_TOKEN") || "").trim();
      const dblBotId = String(directorySetting(raw, "discordBotList", "botId", "DISCORDBOTLIST_BOT_ID") || "").trim() || String(process.env.BOT_1_CLIENT_ID || "").trim();
      const dblState = premium.discordBotListState && typeof premium.discordBotListState === "object" ? premium.discordBotListState : {};
      const dblVotes = dblState.votes && typeof dblState.votes === "object" ? dblState.votes : {};
      const dbl = {
        configured: configBool(directorySetting(raw, "discordBotList", "enabled", "DISCORDBOTLIST_ENABLED", Boolean(dblToken))) && Boolean(dblToken) && /^\d{17,22}$/.test(dblBotId),
        botId: dblBotId || null,
        statsScope: String(directorySetting(raw, "discordBotList", "statsScope", "DISCORDBOTLIST_STATS_SCOPE", "aggregate")).trim().toLowerCase() === "aggregate" ? "aggregate" : "commander",
        state: {
          commands: dblState.commands || {},
          stats: dblState.stats || {},
          votes: { totalVotes: parseIntLike(dblVotes.totalVotes, 0), recent: (Array.isArray(dblVotes.recent) ? dblVotes.recent : []).slice(0, 10) },
        },
      };
      const flags = await integrationFlags(db, raw);
      sendJson(res, 200, {
        discordBotList: dbl,
        botDirectories: {
          discordBotList: dbl,
          botsGG: directoryStatus("botsGG", "BOTSGG_ENABLED", "BOTSGG_TOKEN", "BOTSGG_BOT_ID"),
          topGG: directoryStatus("topGG", "TOPGG_ENABLED", "TOPGG_TOKEN", "TOPGG_BOT_ID"),
        },
        config: {
          ...flags,
          songHistory: configBool(systemSetting(raw, "songHistory", "enabled", "SONG_HISTORY_ENABLED", true), true),
          discordBotList: configBool(directorySetting(raw, "discordBotList", "enabled", "DISCORDBOTLIST_ENABLED", false)),
          botsGG: configBool(directorySetting(raw, "botsGG", "enabled", "BOTSGG_ENABLED", false)),
          topGG: configBool(directorySetting(raw, "topGG", "enabled", "TOPGG_ENABLED", false)),
        },
      });
      return true;
    }

    // POST /api/admin/integrations/test ("Testalarm senden" among others)
    if (pathname === "/api/admin/integrations/test") {
      if (req.method !== "POST") { methodNotAllowed(res, ["POST"]); return true; }
      let body;
      try { body = JSON.parse(await readRequestBody(req) || "{}") || {}; } catch { body = {}; }
      const requested = String(body.integration || "all").trim().toLowerCase();
      const supported = ["mongo", "discordoauth", "smtp", "recognition", "songhistory", "discordbotlist", "botsgg", "topgg", "operatoralerts"];
      const names = requested === "all" ? supported : [requested];
      if (!names.every((name) => supported.includes(name))) { sendJson(res, 400, { error: "Unbekannte Integration." }); return true; }
      const results = await runIntegrationTests(names, requested === "operatoralerts");
      auditOwnerAction(req, {
        action: "integrations.test",
        status: "success",
        target: requested,
        summary: Object.entries(results).map(([key, value]) => `${key}=${value.ok ? "ok" : "fail"}`).join("; "),
      });
      sendJson(res, 200, { ok: Object.values(results).every((item) => item.ok), results, checkedAt: new Date().toISOString() });
      return true;
    }

    // GET /api/admin/audit
    if (pathname === "/api/admin/audit") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      let audit = [];
      const db = monitoringDb();
      if (db) {
        try {
          audit = await db.collection("owner_audit").find({}, { projection: { _id: 0 } }).sort({ at: -1 }).limit(200).toArray();
        } catch {
          audit = [];
        }
      }
      sendJson(res, 200, { audit, count: audit.length });
      return true;
    }

    // GET /api/admin/discord/logs
    if (pathname === "/api/admin/discord/logs") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const discord = configSectionFrom(await loadOwnerConfigRaw(), "discord");
      const commander = discord.commander || {};
      const workers = Array.isArray(discord.workers) ? discord.workers : [];
      const connected = Boolean(String(commander.token || "").trim());
      let logs = [];
      const db = monitoringDb();
      if (db) {
        try {
          logs = await db.collection("owner_audit").find({ action: { $regex: "^(config|discord|station)" } }, { projection: { _id: 0 } }).sort({ at: -1 }).limit(60).toArray();
        } catch {
          logs = [];
        }
      }
      sendJson(res, 200, {
        connected,
        commanderConfigured: Boolean(String(commander.clientId || "").trim()),
        workerCount: workers.length,
        note: connected
          ? "Commander-Token gesetzt. Der Node-Bot bootet beim nächsten ./start.sh (oder ./update.sh) automatisch aus dieser Konfiguration – keine .env-Tokens nötig."
          : "Noch kein Commander-Token gesetzt. Trage Token + Client ID ein; der Bot startet dann automatisch über ./start.sh aus dieser Owner-Konfiguration.",
        logs,
      });
      return true;
    }

    // GET/PUT /api/admin/config: the owner console's settings (#288, same contract as FastAPI)
    if (pathname === "/api/admin/config") {
      if (req.method === "GET") {
        sendJson(res, 200, ownerConfigResponse(await loadOwnerConfigRaw()));
        return true;
      }
      if (req.method !== "PUT") { methodNotAllowed(res, ["GET", "PUT"]); return true; }
      let body;
      try {
        body = JSON.parse(await readRequestBody(req, 256 * 1024) || "null");
      } catch {
        body = null;
      }
      if (!body || typeof body !== "object" || Array.isArray(body)) {
        sendJson(res, 400, { error: "Ungueltiger Body." });
        return true;
      }
      const section = String(body.section || "").trim();
      const data = body.data;
      if (!OWNER_CONFIG_SECTIONS.includes(section)) {
        sendJson(res, 400, { error: `Unbekannter Config-Abschnitt: ${section}` });
        return true;
      }
      if (!data || typeof data !== "object") {
        sendJson(res, 400, { error: "data muss ein Objekt oder eine Liste sein." });
        return true;
      }
      if (!roleMaySaveSection(req.ownerIdentity?.role, section)) {
        sendJson(res, 403, { error: `Deine Rolle (${OWNER_ROLE_LABELS[req.ownerIdentity?.role] || "?"}) darf diesen Bereich nicht speichern.` });
        return true;
      }
      let saveData = data;
      if (section === "access") {
        const checked = validateAccessSave(data);
        if (!checked.ok) {
          sendJson(res, 400, { error: checked.error });
          return true;
        }
        saveData = checked.access;
      }
      if (!isConnected() || !getDb()) {
        sendJson(res, 503, { error: "Keine Datenbank verbunden \u2013 Speichern nicht m\u00f6glich." });
        return true;
      }
      try {
        const raw = await loadOwnerConfigRaw();
        const next = section === "access" ? saveData : mergedSectionForSave(raw, section, saveData);
        await getDb().collection("owner_config").updateOne({ _id: OWNER_CONFIG_ID }, { $set: { [section]: next } }, { upsert: true });
        // A new Discord login or plan price works at once, not only after the next sync.
        if (section === "system") await syncDiscordOauthFromOwnerConfig().catch(() => false);
        await refreshOwnerSettings();
        auditOwnerAction(req, { action: "config.update", status: "success", target: section, summary: "aktualisiert" });
        sendJson(res, 200, { ok: true, section, data: sectionResponse({ ...raw, [section]: next }, section) });
      } catch (err) {
        auditOwnerAction(req, { action: "config.update", status: "failed", target: section, summary: err?.message || "Speichern fehlgeschlagen" });
        sendJson(res, 500, { error: "Speichern fehlgeschlagen." });
      }
      return true;
    }

    // Licenses, activity and archive; the station catalogue (#293).
    if (await handleLicenseRoutes(context)) return true;
    if (await handleStatusRoutes(context)) return true;
    if (await handleSuggestionRoutes(context)) return true;
    return handleStationRoutes(context);
  };
}

// ============================================================
// Owner-Login HTML
// ============================================================
