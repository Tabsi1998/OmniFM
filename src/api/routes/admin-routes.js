// ============================================================
// OmniFM: Admin-Panel API-Routen
// Zugang: ADMIN_TOKEN, API_ADMIN_TOKEN oder ADMIN_API_TOKEN in .env setzen
// URL:    /admin  (nicht verlinkt, nur für Betreiber)
// Auth:   Owner-Login-Cookie ODER Authorization: Bearer xxx ODER X-Admin-Token ODER legacy ?token=xxx
//
// Endpunkte:
//   GET  /admin                  → Owner-Login oder Admin-Panel HTML
//   POST /api/admin/session      → Owner-Login und HttpOnly-Cookie setzen
//   POST /api/admin/logout       → Owner-Login-Cookie löschen
//   GET  /api/admin/overview     → Bot-Status, Guilds, Lizenzen
//   GET  /api/admin/diagnostics  → Owner-Diagnose ohne Secret-Werte
//   GET  /api/admin/operations   → update.sh/Owner-GUI Paritaetskarte
//   GET  /api/admin/licenses     → Alle Lizenzen
//   POST /api/admin/licenses/:id → Lizenz patchen (aktivieren, verlängern, sperren)
//   GET  /api/admin/guilds       → Alle Guilds mit Status
//   GET  /api/admin/logs         → Letzte Operator-Incidents
//   GET  /api/admin/stations     → Alle Stationen (inkl. Health-Status)
//   POST /api/admin/stations     → Station hinzufügen/bearbeiten
// ============================================================

export function createAdminRoutesHandler(deps) {
  const {
    ADMIN_TOKEN,
    getStationHealthReport,
    listLicenses,
    patchLicenseById,
    loadStations,
    log,
    methodNotAllowed,
    sendJson,
    getRecentOperatorIncidents,
    resolveAdminToken,
    getCommonSecurityHeaders,
    getReleaseInfo,
    getBinaryHealthProbe,
  } = deps;

  function getRuntimes() {
    const value = typeof deps.getRuntimes === "function"
      ? deps.getRuntimes()
      : deps.runtimes;
    return Array.isArray(value) ? value : [];
  }

  function getStationCatalogCount() {
    const stationsData = loadStations?.() || {};
    return Object.keys(stationsData?.stations || {}).length;
  }

  function hasEnvValue(name) {
    return String(process.env[name] || "").trim().length > 0;
  }

  function envAny(names) {
    return names.some((name) => hasEnvValue(name));
  }

  function serviceStatus(configured, { required = false } = {}) {
    if (configured) return "configured";
    return required ? "missing" : "optional";
  }

  function collectAdminDiagnostics() {
    const runtimes = getRuntimes();
    const runtimeRows = runtimes.map((runtime) => {
      const stats = runtime.collectStats?.() || {};
      return {
        name: runtime.config?.name || "?",
        role: runtime.role || "worker",
        workerSlot: runtime.workerSlot ?? runtime.config?.index ?? null,
        online: Boolean(runtime.client?.isReady?.()),
        guilds: Number(stats.servers || runtime.client?.guilds?.cache?.size || 0) || 0,
        connections: Number(stats.connections || 0) || 0,
        listeners: Number(stats.listeners || 0) || 0,
        uptime: runtime.startedAt ? Math.floor((Date.now() - runtime.startedAt) / 1000) : null,
      };
    });

    const stationsData = loadStations?.() || {};
    const stationHealth = getStationHealthReport?.() || [];
    const stationCatalogCount = Object.keys(stationsData?.stations || {}).length;
    const stationsUp = stationHealth.filter((station) => station.status === "up").length;
    const stationsDown = stationHealth.filter((station) => station.status === "down").length;
    const stationTotal = Math.max(stationCatalogCount, stationHealth.length);

    const licenses = Object.values(listLicenses?.() || {});
    const activeLicenses = licenses.filter((license) => license?.active && !license?.expired).length;
    const expiredLicenses = licenses.filter((license) => license?.expired || (license?.expiresAt && new Date(license.expiresAt) < new Date())).length;
    const rawIncidents = getRecentOperatorIncidents?.() || [];
    const incidents = Array.isArray(rawIncidents)
      ? rawIncidents
      : Array.isArray(rawIncidents?.incidents) ? rawIncidents.incidents : [];
    const binaryProbe = typeof getBinaryHealthProbe === "function" ? getBinaryHealthProbe() : null;
    const processMode = String(process.env.OMNIFM_PROCESS_MODE || process.env.BOT_MODE || process.env.RUNTIME_ROLE || "monolith").trim().toLowerCase() || "monolith";
    const mongoRequired = ["split", "commander", "worker"].includes(processMode) || Number(process.env.BOT_COUNT || "1") > 1;
    const mongoConfigured = hasEnvValue("MONGO_URL") || ["1", "true", "yes"].includes(String(process.env.MONGO_ENABLED || "").trim().toLowerCase());
    const onlineBots = runtimeRows.filter((runtime) => runtime.online).length;
    const commanderOnline = runtimeRows.some((runtime) => runtime.role === "commander" && runtime.online);
    const workers = runtimeRows.filter((runtime) => runtime.role !== "commander");
    const workersOnline = workers.filter((runtime) => runtime.online).length;

    const alerts = [];
    if (!resolveConfiguredAdminToken()) alerts.push({ severity: "critical", code: "admin_token_missing", message: "API_ADMIN_TOKEN ist nicht gesetzt." });
    if (runtimeRows.length === 0) alerts.push({ severity: "critical", code: "no_runtime", message: "Keine Bot-Runtime ist am Webserver registriert." });
    else if (onlineBots === 0) alerts.push({ severity: "critical", code: "all_bots_offline", message: "Keine Bot-Runtime ist online." });
    else if (onlineBots < runtimeRows.length) alerts.push({ severity: "warning", code: "bot_offline", message: "Mindestens eine Bot-Runtime ist offline." });
    if (stationTotal > 0 && stationsDown > 0) alerts.push({ severity: "warning", code: "stations_down", message: `${stationsDown} Station(en) sind im Healthcheck defekt.` });
    if (mongoRequired && !mongoConfigured) alerts.push({ severity: "critical", code: "mongo_required", message: "Split/Worker-Betrieb braucht MongoDB, aber Mongo ist nicht konfiguriert." });
    if (binaryProbe?.ffmpeg && binaryProbe.ffmpeg.available === false) alerts.push({ severity: "warning", code: "ffmpeg_missing", message: "ffmpeg wurde nicht gefunden." });
    if (binaryProbe?.fpcalc && binaryProbe.fpcalc.available === false) alerts.push({ severity: "warning", code: "fpcalc_missing", message: "fpcalc wurde nicht gefunden." });

    const status = alerts.some((alert) => alert.severity === "critical")
      ? "critical"
      : alerts.some((alert) => alert.severity === "warning") ? "warning" : "healthy";

    return {
      status,
      generatedAt: new Date().toISOString(),
      runtime: {
        processMode,
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        processUptime: Math.floor(process.uptime()),
        memory: process.memoryUsage(),
        bots: {
          total: runtimeRows.length,
          online: onlineBots,
          commanderOnline,
          workersTotal: workers.length,
          workersOnline,
        },
        rows: runtimeRows,
      },
      infrastructure: {
        adminToken: { configured: Boolean(resolveConfiguredAdminToken()), status: serviceStatus(Boolean(resolveConfiguredAdminToken()), { required: true }) },
        mongo: { configured: mongoConfigured, required: mongoRequired, status: serviceStatus(mongoConfigured, { required: mongoRequired }) },
        stripe: { configured: envAny(["STRIPE_SECRET_KEY", "STRIPE_API_KEY"]), webhookConfigured: hasEnvValue("STRIPE_WEBHOOK_SECRET"), status: serviceStatus(envAny(["STRIPE_SECRET_KEY", "STRIPE_API_KEY"])) },
        smtp: { configured: envAny(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"]), fromConfigured: hasEnvValue("SMTP_FROM"), status: serviceStatus(envAny(["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM"])) },
        webhooks: { configured: envAny(["DISCORDBOTLIST_WEBHOOK_SECRET", "TOPGG_WEBHOOK_SECRET", "BOTSGG_WEBHOOK_SECRET"]), status: serviceStatus(envAny(["DISCORDBOTLIST_WEBHOOK_SECRET", "TOPGG_WEBHOOK_SECRET", "BOTSGG_WEBHOOK_SECRET"])) },
        publicWebUrl: { configured: hasEnvValue("PUBLIC_WEB_URL"), status: serviceStatus(hasEnvValue("PUBLIC_WEB_URL")) },
      },
      binaries: binaryProbe ? {
        checkedAt: binaryProbe.checkedAt ? new Date(binaryProbe.checkedAt).toISOString() : null,
        ffmpeg: binaryProbe.ffmpeg || null,
        fpcalc: binaryProbe.fpcalc || null,
      } : null,
      stations: {
        total: stationTotal,
        catalog: stationCatalogCount,
        checked: stationHealth.length,
        up: stationsUp,
        down: stationsDown,
        unknown: Math.max(0, stationTotal - stationsUp - stationsDown),
      },
      licenses: {
        total: licenses.length,
        active: activeLicenses,
        expired: expiredLicenses,
      },
      incidents: {
        total: incidents.length,
        errors: incidents.filter((incident) => String(incident?.level || "").toUpperCase() === "ERROR").length,
        warnings: incidents.filter((incident) => String(incident?.level || "").toUpperCase() === "WARN").length,
        recent: incidents.slice(0, 10).map((incident) => ({
          timestamp: incident?.timestamp || incident?.time || null,
          level: incident?.level || "INFO",
          message: String(incident?.message || incident?.msg || "").slice(0, 240),
        })),
      },
      release: typeof getReleaseInfo === "function" ? getReleaseInfo() : null,
      alerts,
    };
  }

  function buildOwnerOperationsManifest() {
    const operations = [
      {
        id: "update-full",
        area: "Deployment",
        title: "Update & Rebuild",
        cli: "./update.sh --update",
        webStatus: "planned",
        risk: "high",
        description: "Code aktualisieren, Container neu bauen und Deploy-Gates ausfuehren.",
        webEntry: "Noch nicht als Web-Aktion freigeschaltet",
        nextStep: "Web-Jobqueue mit Confirm-Step, Audit-Log und Rollback-/Log-Ausgabe."
      },
      {
        id: "update-rolling",
        area: "Deployment",
        title: "Rolling Worker Update",
        cli: "./update.sh --update-rolling",
        webStatus: "planned",
        risk: "high",
        description: "Worker nacheinander aktualisieren, ohne alles gleichzeitig hart zu stoppen.",
        webEntry: "Noch nicht als Web-Aktion freigeschaltet",
        nextStep: "Nur mit laufender Jobqueue, Fortschritt, Timeout und Abbruchschutz."
      },
      {
        id: "update-commander",
        area: "Deployment",
        title: "Commander Update",
        cli: "./update.sh --update-commander",
        webStatus: "planned",
        risk: "high",
        description: "Nur den Commander neu bauen oder neu starten.",
        webEntry: "Noch nicht als Web-Aktion freigeschaltet",
        nextStep: "Gezielte Commander-Aktion mit Healthcheck vor/nach dem Lauf."
      },
      {
        id: "bots",
        area: "Bots",
        title: "Bots verwalten",
        cli: "./update.sh --bots",
        webStatus: "partial",
        risk: "medium",
        description: "Bots anzeigen, hinzufuegen, bearbeiten, entfernen, Commander setzen und Rollen pruefen.",
        webEntry: "Tabs Bots, Diagnose und Guilds zeigen Runtime-/Worker-Zustand bereits read-only.",
        nextStep: "Bot-Konfiguration editierbar machen, aber Tokens nur write-only und mit Audit-Log."
      },
      {
        id: "bot-show",
        area: "Bots",
        title: "Bots anzeigen",
        cli: "./update.sh --show-bots",
        webStatus: "available",
        risk: "low",
        description: "Konfigurierte Commander-/Worker-Bots und Online-Zustand anzeigen.",
        webEntry: "Tab Bots und Tab Diagnose",
        nextStep: "Invite-Links und Rollenmatrix in die Bot-Zeilen aufnehmen."
      },
      {
        id: "bot-mutate",
        area: "Bots",
        title: "Bot-Konfiguration aendern",
        cli: "./update.sh --add-bot / --edit-bot / --remove-bot / --set-commander / --show-roles",
        webStatus: "planned",
        risk: "high",
        description: "Bot-Tokens, Client-IDs, Tiers, Rollen und Commander-Zuweisung pflegen.",
        webEntry: "Noch nicht als Web-Aktion freigeschaltet",
        nextStep: "Validierter Bot-Editor mit Token-Maskierung, Confirm-Step und Restart-Hinweis."
      },
      {
        id: "stripe",
        area: "Billing",
        title: "Stripe einrichten",
        cli: "./update.sh --stripe",
        webStatus: "partial",
        risk: "high",
        description: "Stripe Keys, Webhook Secret und Checkout URLs konfigurieren.",
        webEntry: "Diagnose zeigt nur, ob Stripe und Webhook konfiguriert sind.",
        nextStep: "Write-only Secret-Editor mit Validierung und keinem Klartext-Readback."
      },
      {
        id: "premium",
        area: "Billing",
        title: "Premium verwalten",
        cli: "./update.sh --premium",
        webStatus: "partial",
        risk: "medium",
        description: "Lizenzen, Plaene, Laufzeiten, Seats und Zuordnungen pflegen.",
        webEntry: "Tab Lizenzen kann bestehende Lizenzen bearbeiten.",
        nextStep: "Alle Premium-CLI-Funktionen inkl. neue Lizenz/Trial/Verlaengerung sauber abbilden."
      },
      {
        id: "offers",
        area: "Billing",
        title: "Codes verwalten",
        cli: "./update.sh --offers",
        webStatus: "planned",
        risk: "medium",
        description: "Coupons, Referrals und direkte Gratis-Lizenzen erstellen und pruefen.",
        webEntry: "Noch nicht als Web-Aktion freigeschaltet",
        nextStep: "Offer-Editor mit Preview, Limits und Redemption-Status."
      },
      {
        id: "email",
        area: "Settings",
        title: "E-Mail/SMTP einrichten",
        cli: "./update.sh --email",
        webStatus: "partial",
        risk: "high",
        description: "SMTP Host, Port, TLS, Absender und Admin-Mail konfigurieren.",
        webEntry: "Diagnose zeigt nur, ob SMTP konfiguriert ist.",
        nextStep: "Write-only SMTP-Editor plus Testmail-Aktion mit Audit-Log."
      },
      {
        id: "settings",
        area: "Settings",
        title: "Einstellungen",
        cli: "./update.sh --settings",
        webStatus: "partial",
        risk: "medium",
        description: "Web-Port, Domain, Public URL, CORS, Trial, Integrationen, Legal, Dashboard, Commands und Betrieb.",
        webEntry: "Diagnose und diese Operations-Ansicht decken Read-only Status ab.",
        nextStep: "Config-Editor pro Bereich, Secrets getrennt als write-only."
      },
      {
        id: "settings-admin",
        area: "Settings",
        title: "Owner/Admin Login Token",
        cli: "./update.sh --settings admin",
        webStatus: "partial",
        risk: "low",
        description: "Owner-Login ueber API_ADMIN_TOKEN fuer /admin.",
        webEntry: "/admin Login und Diagnose Admin Token Status",
        nextStep: "Token-Rotation im Web nur mit Re-Auth und Anzeige genau einmal."
      },
      {
        id: "settings-dashboard",
        area: "Settings",
        title: "Dashboard OAuth",
        cli: "./update.sh --settings dashboard / --dashboard-settings",
        webStatus: "partial",
        risk: "high",
        description: "Discord OAuth Client, Secret, Redirect und Session Cookie konfigurieren.",
        webEntry: "Diagnose zeigt Public URL und Grundstatus indirekt.",
        nextStep: "OAuth-Editor mit Redirect-URI-Hilfe und Secret write-only."
      },
      {
        id: "settings-commands",
        area: "Settings",
        title: "Slash Commands & Sync",
        cli: "./update.sh --settings commands",
        webStatus: "planned",
        risk: "medium",
        description: "Command Registration Mode, Cleanup und Sync-Retry konfigurieren.",
        webEntry: "Noch nicht als Web-Aktion freigeschaltet",
        nextStep: "Command-Sync-Status, sichere manuelle Sync-Aktion und Modus-Editor."
      },
      {
        id: "settings-legal",
        area: "Settings",
        title: "Legal Setup",
        cli: "./update.sh --settings legal",
        webStatus: "planned",
        risk: "medium",
        description: "Impressum, Datenschutz und Terms-Angaben pflegen.",
        webEntry: "Oeffentliche Legal-APIs zeigen die gerenderten Angaben.",
        nextStep: "Legal-Editor mit Pflichtfeld-Validierung und Vorschau."
      },
      {
        id: "settings-logs",
        area: "Operations",
        title: "Logs & Docker Cleanup Settings",
        cli: "./update.sh --settings logs",
        webStatus: "partial",
        risk: "medium",
        description: "Log-Rotation und Docker-Prune-Vorgaben konfigurieren.",
        webEntry: "Tab Logs zeigt Operator-Incidents read-only.",
        nextStep: "Cleanup-Konfiguration editierbar machen und Prune als Job ausfuehren."
      },
      {
        id: "status",
        area: "Operations",
        title: "Status & Logs",
        cli: "./update.sh --status / --status quick / --status live / --status local-live",
        webStatus: "partial",
        risk: "low",
        description: "Status, Health, Logs und Cockpit-Ansichten.",
        webEntry: "Tabs Bots, Diagnose, Guilds, Stationen und Logs",
        nextStep: "Live-Log-Streaming und Status-Historie im Web."
      },
      {
        id: "cleanup",
        area: "Operations",
        title: "Speicher Cleanup",
        cli: "./update.sh --cleanup",
        webStatus: "planned",
        risk: "high",
        description: "Logs, Backups und Docker-Cache aufraeumen.",
        webEntry: "Noch nicht als Web-Aktion freigeschaltet",
        nextStep: "Dry-run, Confirm-Step, Ergebnisprotokoll und harte Pfadbegrenzung."
      },
      {
        id: "doctor",
        area: "Operations",
        title: "Doctor Check",
        cli: "./update.sh --doctor",
        webStatus: "partial",
        risk: "low",
        description: "System, OAuth, JSON, Runtime und Infrastruktur pruefen.",
        webEntry: "Tab Diagnose und /api/admin/diagnostics",
        nextStep: "Doctor-Checks mit gleicher Tiefe wie CLI als strukturierte Web-Checks."
      },
      {
        id: "recognition-test",
        area: "Audio",
        title: "Recognition Test",
        cli: "./update.sh --recognition-test <URL>",
        webStatus: "planned",
        risk: "medium",
        description: "Audio-Fingerprint/Metadata-Test fuer eine Stream-URL.",
        webEntry: "Noch nicht als Web-Aktion freigeschaltet",
        nextStep: "URL-Testformular mit Timeout, Ergebnisdetails und Rate-Limit."
      }
    ];
    const summary = operations.reduce((acc, operation) => {
      acc[operation.webStatus] = (acc[operation.webStatus] || 0) + 1;
      acc.byArea[operation.area] = (acc.byArea[operation.area] || 0) + 1;
      return acc;
    }, { available: 0, partial: 0, planned: 0, byArea: {} });
    return {
      generatedAt: new Date().toISOString(),
      source: "update.sh",
      total: operations.length,
      summary,
      operations
    };
  }

  const ADMIN_COOKIE_NAME = "omnifm_owner";
  const ADMIN_COOKIE_MAX_AGE_SECONDS = 12 * 60 * 60;

  function resolveConfiguredAdminToken() {
    return String(resolveAdminToken?.() || ADMIN_TOKEN || "").trim();
  }

  function parseCookies(cookieHeader) {
    const cookies = new Map();
    for (const part of String(cookieHeader || "").split(";")) {
      const [rawName, ...rawValueParts] = part.trim().split("=");
      if (!rawName) continue;
      const rawValue = rawValueParts.join("=");
      try {
        cookies.set(rawName, decodeURIComponent(rawValue || ""));
      } catch {
        cookies.set(rawName, rawValue || "");
      }
    }
    return cookies;
  }

  function getAdminTokenFromRequest(req, requestUrl) {
    const authHeader = String(req.headers?.authorization || "").trim();
    const bearerToken = authHeader.startsWith("Bearer ")
      ? authHeader.slice(7).trim()
      : "";
    const headerToken = String(req.headers?.["x-admin-token"] || "").trim();
    const queryToken = String(requestUrl?.searchParams?.get("token") || "").trim();
    const cookieToken = String(parseCookies(req.headers?.cookie).get(ADMIN_COOKIE_NAME) || "").trim();
    return bearerToken || headerToken || queryToken || cookieToken;
  }

  function isAdminTokenValue(token) {
    const adminToken = resolveConfiguredAdminToken();
    return Boolean(adminToken) && String(token || "").trim() === adminToken;
  }

  /**
   * Prüft ob der Request einen gültigen Owner/Admin-Token hat.
   */
  function isAuthorized(req, requestUrl) {
    return isAdminTokenValue(getAdminTokenFromRequest(req, requestUrl));
  }

  function shouldUseSecureAdminCookie(req) {
    const forwardedProto = String(req.headers?.["x-forwarded-proto"] || "").toLowerCase();
    const publicUrl = String(process.env.PUBLIC_WEB_URL || "").toLowerCase();
    return forwardedProto.split(",")[0].trim() === "https" || publicUrl.startsWith("https://");
  }

  function buildAdminCookie(token, req) {
    const secure = shouldUseSecureAdminCookie(req) ? "; Secure" : "";
    return `${ADMIN_COOKIE_NAME}=${encodeURIComponent(token)}; Max-Age=${ADMIN_COOKIE_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Strict${secure}`;
  }

  function clearAdminCookie(req) {
    const secure = shouldUseSecureAdminCookie(req) ? "; Secure" : "";
    return `${ADMIN_COOKIE_NAME}=; Max-Age=0; Path=/; HttpOnly; SameSite=Strict${secure}`;
  }

  function redirect(res, location, extraHeaders = {}) {
    res.writeHead(303, {
      ...(typeof getCommonSecurityHeaders === "function" ? getCommonSecurityHeaders() : {}),
      ...extraHeaders,
      "Location": location,
      "Cache-Control": "no-store",
    });
    res.end();
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

  function readRequestBody(req, limitBytes = 4096) {
    return new Promise((resolve, reject) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
        if (body.length > limitBytes) reject(new Error("Request body too large"));
      });
      req.on("end", () => resolve(body));
      req.on("error", reject);
    });
  }

  function parseSessionPayload(rawBody, contentType) {
    if (String(contentType || "").includes("application/x-www-form-urlencoded")) {
      return Object.fromEntries(new URLSearchParams(rawBody));
    }
    try {
      return JSON.parse(rawBody || "{}");
    } catch {
      return {};
    }
  }

  function unauthorized(res) {
    res.writeHead(401, {
      ...(typeof getCommonSecurityHeaders === "function" ? getCommonSecurityHeaders() : {}),
      "Content-Type": "text/plain",
      "Cache-Control": "no-store",
      "WWW-Authenticate": 'Bearer realm="OmniFM Admin"',
    });
    res.end("Unauthorized");
  }

  return async function handleAdminRoutes(context) {
    const { req, res, requestUrl } = context;
    const pathname = requestUrl?.pathname || "";

    // ---- Admin-Panel HTML ----
    if (pathname === "/admin" || pathname === "/admin/") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }

      const queryToken = String(requestUrl?.searchParams?.get("token") || "").trim();
      if (queryToken) {
        if (isAdminTokenValue(queryToken)) {
          redirect(res, "/admin", { "Set-Cookie": buildAdminCookie(queryToken, req) });
          return true;
        }
        res.writeHead(401, {
          ...(typeof getCommonSecurityHeaders === "function" ? getCommonSecurityHeaders() : {}),
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(buildAdminLoginHtml("Der Admin-Token ist ungültig."));
        return true;
      }

      if (!isAuthorized(req, requestUrl)) {
        res.writeHead(200, {
          ...(typeof getCommonSecurityHeaders === "function" ? getCommonSecurityHeaders() : {}),
          "Content-Type": "text/html; charset=utf-8",
          "Cache-Control": "no-store",
        });
        res.end(buildAdminLoginHtml());
        return true;
      }

      res.writeHead(200, {
        ...(typeof getCommonSecurityHeaders === "function" ? getCommonSecurityHeaders() : {}),
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store",
      });
      res.end(buildAdminHtml());
      return true;
    }

    if (pathname === "/api/admin/session") {
      if (req.method !== "POST") { methodNotAllowed(res, ["POST"]); return true; }
      const contentType = String(req.headers?.["content-type"] || "");
      const wantsHtmlRedirect = contentType.includes("application/x-www-form-urlencoded");
      try {
        const payload = parseSessionPayload(await readRequestBody(req), contentType);
        const token = String(payload?.token || "").trim();
        if (!isAdminTokenValue(token)) {
          log?.("WARN", "[Owner] Admin login fehlgeschlagen");
          if (wantsHtmlRedirect) {
            res.writeHead(401, {
              ...(typeof getCommonSecurityHeaders === "function" ? getCommonSecurityHeaders() : {}),
              "Content-Type": "text/html; charset=utf-8",
              "Cache-Control": "no-store",
            });
            res.end(buildAdminLoginHtml("Der Admin-Token ist ungültig."));
          } else {
            sendAdminJson(res, 401, { ok: false, error: "Invalid admin token" });
          }
          return true;
        }
        log?.("INFO", "[Owner] Admin login erfolgreich");
        if (wantsHtmlRedirect) {
          redirect(res, "/admin", { "Set-Cookie": buildAdminCookie(token, req) });
        } else {
          sendAdminJson(res, 200, { ok: true, role: "owner" }, { "Set-Cookie": buildAdminCookie(token, req) });
        }
        return true;
      } catch (err) {
        sendAdminJson(res, 400, { ok: false, error: err?.message || "Invalid login request" });
        return true;
      }
    }

    if (pathname === "/api/admin/logout") {
      if (req.method !== "POST") { methodNotAllowed(res, ["POST"]); return true; }
      log?.("INFO", "[Owner] Admin logout");
      const wantsHtmlRedirect = String(req.headers?.accept || "").includes("text/html");
      if (wantsHtmlRedirect) redirect(res, "/admin", { "Set-Cookie": clearAdminCookie(req) });
      else sendAdminJson(res, 200, { ok: true }, { "Set-Cookie": clearAdminCookie(req) });
      return true;
    }

    // ---- API: Nur /api/admin/* ----
    if (!pathname.startsWith("/api/admin/") && pathname !== "/api/admin") return false;

    if (!isAuthorized(req, requestUrl)) { unauthorized(res); return true; }

    // GET /api/admin/overview
    if (pathname === "/api/admin/overview" || pathname === "/api/admin") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }

      const botStats = getRuntimes().map((r) => {
        const stats = r.collectStats?.() || {};
        return {
          name: r.config?.name || "?",
          role: r.role || "worker",
          online: Boolean(r.client?.isReady?.()),
          guilds: Number(stats.servers || 0),
          connections: Number(stats.connections || 0),
          listeners: Number(stats.listeners || 0),
          uptime: r.startedAt ? Math.floor((Date.now() - r.startedAt) / 1000) : null,
        };
      });

      const licenses = listLicenses?.() || {};
      const licenseList = Object.values(licenses);
      const activeLicenses = licenseList.filter((l) => l?.active && !l?.expired).length;
      const expiredLicenses = licenseList.filter((l) => l?.expired || (l?.expiresAt && new Date(l.expiresAt) < new Date())).length;

      const stationHealth = getStationHealthReport?.() || [];
      const stationCatalogCount = getStationCatalogCount();
      const stationsUp = stationHealth.filter((s) => s.status === "up").length;
      const stationsDown = stationHealth.filter((s) => s.status === "down").length;

      sendJson(res, 200, {
        bots: botStats,
        licenses: { total: licenseList.length, active: activeLicenses, expired: expiredLicenses },
        stations: { total: Math.max(stationCatalogCount, stationHealth.length), up: stationsUp, down: stationsDown },
        release: typeof getReleaseInfo === "function" ? getReleaseInfo() : null,
        serverTime: new Date().toISOString(),
      });
      return true;
    }

    // GET /api/admin/diagnostics
    if (pathname === "/api/admin/diagnostics") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      sendJson(res, 200, collectAdminDiagnostics());
      return true;
    }

    // GET /api/admin/operations
    if (pathname === "/api/admin/operations") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      sendJson(res, 200, buildOwnerOperationsManifest());
      return true;
    }

    // GET /api/admin/licenses
    if (pathname === "/api/admin/licenses") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const licenses = listLicenses?.() || {};
      sendJson(res, 200, { licenses });
      return true;
    }

    // POST /api/admin/licenses/:id
    const licenseMatch = pathname.match(/^\/api\/admin\/licenses\/([^/]+)$/);
    if (licenseMatch) {
      if (req.method !== "POST" && req.method !== "PATCH") { methodNotAllowed(res, ["POST", "PATCH"]); return true; }
      const licenseId = decodeURIComponent(licenseMatch[1]);
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        try {
          const patch = JSON.parse(body || "{}");
          // Sicherheit: Nur erlaubte Felder patchen
          const allowed = ["active", "expired", "expiresAt", "plan", "tier", "seats", "linkedServerIds", "contactEmail", "notes"];
          const safePatch = {};
          for (const key of allowed) {
            if (key in patch) safePatch[key] = patch[key];
          }
          patchLicenseById?.(licenseId, safePatch);
          log?.("INFO", `[Admin] Lizenz ${licenseId} gepatcht: ${JSON.stringify(safePatch)}`);
          sendJson(res, 200, { ok: true, licenseId, patched: safePatch });
        } catch (err) {
          sendJson(res, 400, { ok: false, error: err?.message || "Ungültiger Body" });
        }
      });
      return true;
    }

    // GET /api/admin/guilds
    if (pathname === "/api/admin/guilds") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const guilds = [];
      for (const runtime of getRuntimes()) {
        if (!runtime.client?.isReady?.()) continue;
        for (const [guildId, guild] of (runtime.client.guilds?.cache || new Map()).entries()) {
          const state = runtime.getState?.(guildId) || {};
          guilds.push({
            id: guildId,
            name: guild.name || "?",
            memberCount: guild.memberCount || 0,
            bot: runtime.config?.name || "?",
            playing: Boolean(state.playing),
            station: state.currentStationKey || null,
            volume: state.volume ?? null,
          });
        }
      }
      guilds.sort((a, b) => (b.memberCount || 0) - (a.memberCount || 0));
      sendJson(res, 200, { guilds, total: guilds.length });
      return true;
    }

    // GET /api/admin/logs
    if (pathname === "/api/admin/logs") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const rawIncidents = getRecentOperatorIncidents?.() || [];
    const incidents = Array.isArray(rawIncidents)
      ? rawIncidents
      : Array.isArray(rawIncidents?.incidents) ? rawIncidents.incidents : [];
      sendJson(res, 200, { incidents });
      return true;
    }

    // GET /api/admin/stations
    if (pathname === "/api/admin/stations") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const stationsData = loadStations?.() || {};
      const healthReport = getStationHealthReport?.() || [];
      const healthMap = Object.fromEntries(healthReport.map((h) => [h.key, h]));

      const stations = Object.entries(stationsData?.stations || {}).map(([key, s]) => ({
        key,
        name: s.name || key,
        url: s.url || null,
        tier: s.tier || "free",
        genre: s.genre || null,
        health: healthMap[key] || null,
      }));

      sendJson(res, 200, { stations, total: stations.length });
      return true;
    }

    return false;
  };
}

// ============================================================
// Owner-Login HTML
// ============================================================
function buildAdminLoginHtml(errorMessage = "") {
  const errorHtml = errorMessage
    ? `<p class="login-error" role="alert">${escapeHtml(errorMessage)}</p>`
    : "";
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>OmniFM Owner Login</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0a;color:#e4e4e7;min-height:100vh;display:flex;align-items:center;justify-content:center;padding:24px}
    .login{width:min(420px,100%);background:#111;border:1px solid #222;border-radius:12px;padding:28px}
    .brand{display:flex;align-items:center;gap:10px;margin-bottom:20px}
    .brand h1{font-size:16px;font-weight:800;color:#00F0FF;letter-spacing:.1em}
    .badge{font-size:10px;background:#FF2A2A;color:#fff;padding:2px 8px;border-radius:20px;font-weight:700}
    label{display:block;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px}
    input{width:100%;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;padding:11px 12px;font-size:14px;outline:none}
    input:focus{border-color:#00F0FF}
    button{width:100%;margin-top:14px;background:#00F0FF;color:#050505;border:none;border-radius:8px;padding:11px 14px;font-size:13px;font-weight:800;cursor:pointer}
    .hint{margin-top:14px;color:#71717a;font-size:12px;line-height:1.5}
    .login-error{margin-bottom:14px;color:#FF2A2A;font-size:13px}
  </style>
</head>
<body>
  <main class="login">
    <div class="brand">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg>
      <h1>OMNIFM OWNER LOGIN</h1>
      <span class="badge">INTERN</span>
    </div>
    ${errorHtml}
    <form method="post" action="/api/admin/session" autocomplete="off">
      <label for="adminTokenInput">Admin API Token</label>
      <input id="adminTokenInput" name="token" type="password" required autofocus autocomplete="current-password"/>
      <button type="submit">Anmelden</button>
    </form>
    <p class="hint">Der Token kommt aus <code>API_ADMIN_TOKEN</code> beziehungsweise <code>ADMIN_API_TOKEN</code>. Nach dem Login wird er als HttpOnly-Cookie gespeichert und nicht in der URL angezeigt.</p>
  </main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
// ============================================================
// Admin-Panel HTML (Single-Page, inline CSS+JS, kein Framework)
// ============================================================
function buildAdminHtml() {
  return `<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width,initial-scale=1"/>
  <title>OmniFM Admin</title>
  <style>
    *,*::before,*::after{box-sizing:border-box;margin:0;padding:0}
    body{font-family:'Segoe UI',system-ui,sans-serif;background:#0a0a0a;color:#e4e4e7;min-height:100vh}
    .topbar{background:#111;border-bottom:1px solid #222;padding:12px 24px;display:flex;align-items:center;gap:12px}
    .topbar h1{font-size:16px;font-weight:700;color:#00F0FF;letter-spacing:0.1em}
    .topbar .badge{font-size:10px;background:#FF2A2A;color:#fff;padding:2px 8px;border-radius:20px;font-weight:700}
    .container{max-width:1200px;margin:0 auto;padding:24px}
    .grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:16px;margin-bottom:24px}
    .card{background:#111;border:1px solid #222;border-radius:12px;padding:20px}
    .card h3{font-size:11px;font-weight:700;letter-spacing:0.1em;color:#71717a;text-transform:uppercase;margin-bottom:8px}
    .card .val{font-size:28px;font-weight:800;font-family:monospace}
    .card .sub{font-size:12px;color:#52525b;margin-top:4px}
    .cyan{color:#00F0FF}.green{color:#39FF14}.red{color:#FF2A2A}.amber{color:#FFB800}.purple{color:#BD00FF}
    .section{background:#111;border:1px solid #222;border-radius:12px;margin-bottom:24px;overflow:hidden}
    .section-header{padding:16px 20px;border-bottom:1px solid #222;display:flex;align-items:center;justify-content:space-between}
    .section-header h2{font-size:13px;font-weight:700;letter-spacing:0.05em}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{padding:10px 16px;text-align:left;font-size:11px;font-weight:700;letter-spacing:0.08em;color:#71717a;text-transform:uppercase;border-bottom:1px solid #1a1a1a}
    td{padding:10px 16px;border-bottom:1px solid #1a1a1a;color:#d4d4d8}
    tr:last-child td{border-bottom:none}
    tr:hover td{background:#161616}
    .badge-online{display:inline-block;width:8px;height:8px;border-radius:50%;background:#39FF14;margin-right:6px}
    .badge-offline{display:inline-block;width:8px;height:8px;border-radius:50%;background:#FF2A2A;margin-right:6px}
    .badge-up{color:#39FF14;font-size:11px;font-weight:700}
    .badge-down{color:#FF2A2A;font-size:11px;font-weight:700}
    .badge-unknown{color:#71717a;font-size:11px;font-weight:700}
    .btn{padding:6px 14px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:none}
    .btn-cyan{background:#00F0FF;color:#050505}
    .btn-red{background:#FF2A2A;color:#fff}
    .btn-amber{background:#FFB800;color:#050505}
    .tabs{display:flex;gap:4px;padding:12px 20px;border-bottom:1px solid #222}
    .tab{padding:6px 16px;border-radius:8px;font-size:12px;font-weight:700;cursor:pointer;border:none;background:transparent;color:#71717a}
    .tab.active{background:#1a1a1a;color:#fff}
    #content{padding:0}
    .loading{padding:40px;text-align:center;color:#52525b;font-size:13px}
    .error-msg{padding:16px 20px;color:#FF2A2A;font-size:13px}
    .refresh-btn{font-size:11px;color:#52525b;cursor:pointer;background:none;border:none;padding:4px 8px;border-radius:6px}
    .refresh-btn:hover{color:#fff;background:#1a1a1a}
    input[type=text],input[type=email]{background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;padding:8px 12px;font-size:13px;outline:none;width:100%}
    .modal{display:none;position:fixed;inset:0;background:rgba(0,0,0,0.8);z-index:100;align-items:center;justify-content:center}
    .modal.open{display:flex}
    .modal-box{background:#111;border:1px solid #333;border-radius:16px;padding:28px;max-width:480px;width:100%;max-height:80vh;overflow-y:auto}
    .modal-box h3{font-size:15px;font-weight:700;margin-bottom:16px}
    .form-row{margin-bottom:12px}
    .form-row label{display:block;font-size:11px;font-weight:700;color:#71717a;text-transform:uppercase;letter-spacing:0.08em;margin-bottom:6px}
    .form-actions{display:flex;gap:8px;margin-top:16px}
    .toolbar{display:flex;gap:10px;align-items:center;flex-wrap:wrap;padding:14px 16px;border-bottom:1px solid #222;background:#0d0d0d}
    .toolbar input,.toolbar select{width:auto;min-width:170px;background:#1a1a1a;border:1px solid #333;border-radius:8px;color:#fff;padding:8px 10px;font-size:12px;outline:none}
    .toolbar input{min-width:240px;flex:1}
    .summary-row{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px;padding:14px 16px;border-bottom:1px solid #222;background:#0f0f0f}
    .summary-pill{border:1px solid #222;background:#151515;border-radius:10px;padding:10px 12px}
    .summary-pill strong{display:block;font-size:18px;font-family:monospace}
    .summary-pill span{display:block;margin-top:3px;font-size:11px;color:#71717a;text-transform:uppercase;letter-spacing:0.08em}
    .problem-row td{background:rgba(255,42,42,0.06)}
    .warning-row td{background:rgba(255,184,0,0.05)}
    .row-actions{display:flex;gap:6px;flex-wrap:wrap}
    .mini-btn{border:1px solid #333;background:#1a1a1a;color:#d4d4d8;border-radius:7px;padding:4px 8px;font-size:11px;cursor:pointer}
    .mini-btn:hover{border-color:#00F0FF;color:#fff}
    .station-url{max-width:360px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;color:#71717a;font-family:monospace;font-size:11px}
    .empty-state{padding:32px 16px;text-align:center;color:#71717a;font-size:13px}
    .cmd{font-family:'Consolas','JetBrains Mono',monospace;font-size:11px;color:#a1a1aa;background:#090909;border:1px solid #222;border-radius:6px;padding:4px 6px;display:inline-block}
  </style>
</head>
<body>
  <div class="topbar">
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#00F0FF" stroke-width="2"><circle cx="12" cy="12" r="2"/><path d="M16.24 7.76a6 6 0 0 1 0 8.49m-8.48-.01a6 6 0 0 1 0-8.49"/></svg>
    <h1>OMNIFM ADMIN</h1>
    <span class="badge">INTERN</span>
    <span style="margin-left:auto;font-size:12px;color:#52525b" id="serverTime"></span>
    <button class="refresh-btn" onclick="loadAll()">↻ Aktualisieren</button>
    <button class="refresh-btn" onclick="logoutAdmin()">Logout</button>
  </div>

  <div class="container">
    <!-- Stats Grid -->
    <div class="grid" id="statsGrid">
      <div class="card"><h3>Bots Online</h3><div class="val cyan" id="statBots">–</div><div class="sub">von gesamt</div></div>
      <div class="card"><h3>Guilds</h3><div class="val green" id="statGuilds">–</div><div class="sub">aktive Server</div></div>
      <div class="card"><h3>Lizenzen</h3><div class="val amber" id="statLicenses">–</div><div class="sub">aktiv / gesamt</div></div>
      <div class="card"><h3>Stationen</h3><div class="val" id="statStations">–</div><div class="sub" id="statStationsSub">UP / DOWN</div></div>
      <div class="card"><h3>Release</h3><div class="val purple" id="statRelease">–</div><div class="sub" id="statReleaseSub">Commit / Status</div></div>
    </div>

    <!-- Tabs -->
    <div class="section">
      <div class="tabs">
        <button class="tab active" onclick="showTab('bots', this)">🤖 Bots</button>
        <button class="tab" onclick="showTab('diagnostics', this)">🧭 Diagnose</button>
        <button class="tab" onclick="showTab('guilds', this)">🏠 Guilds</button>
        <button class="tab" onclick="showTab('licenses', this)">🔑 Lizenzen</button>
        <button class="tab" onclick="showTab('stations', this)">📻 Stationen</button>
        <button class="tab" onclick="showTab('logs', this)">📋 Logs</button>
        <button class="tab" onclick="showTab('operations', this)">⚙️ Betrieb</button>
      </div>
      <div id="content"><div class="loading">Lade Daten...</div></div>
    </div>
  </div>

  <!-- Lizenz-Edit Modal -->
  <div class="modal" id="licenseModal" onclick="if(event.target===this)closeLicenseModal()">
    <div class="modal-box">
      <h3>Lizenz bearbeiten</h3>
      <input type="hidden" id="editLicenseId"/>
      <div class="form-row"><label>Plan</label><input type="text" id="editPlan" placeholder="free / pro / ultimate"/></div>
      <div class="form-row"><label>Aktiv</label><input type="text" id="editActive" placeholder="true / false"/></div>
      <div class="form-row"><label>Abläuft am (ISO)</label><input type="text" id="editExpiresAt" placeholder="2025-12-31T00:00:00.000Z"/></div>
      <div class="form-row"><label>Seats</label><input type="text" id="editSeats" placeholder="1"/></div>
      <div class="form-row"><label>Notizen</label><input type="text" id="editNotes" placeholder="Interne Notiz..."/></div>
      <div class="form-actions">
        <button class="btn btn-cyan" onclick="saveLicense()">Speichern</button>
        <button class="btn" style="background:#1a1a1a;color:#fff" onclick="closeLicenseModal()">Abbrechen</button>
        <button class="btn btn-red" onclick="revokeLicense()">Sperren</button>
      </div>
      <p id="licenseEditStatus" style="margin-top:10px;font-size:12px;color:#52525b"></p>
    </div>
  </div>

  <script>
    const TOKEN = new URLSearchParams(location.search).get('token') || '';
    const AUTH = TOKEN ? '?token=' + encodeURIComponent(TOKEN) : '';

    async function logoutAdmin() {
      await fetch('/api/admin/logout' + AUTH, { method: 'POST' }).catch(() => null);
      window.location.href = '/admin';
    }

    async function api(path) {
      const r = await fetch('/api/admin/' + path + AUTH);
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }

    async function apiPost(path, body) {
      const r = await fetch('/api/admin/' + path + AUTH, {
        method: 'POST',
        headers: {'Content-Type':'application/json'},
        body: JSON.stringify(body)
      });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.json();
    }

    let currentTab = 'bots';
    let cachedData = {};
    let stationFilters = { search: '', health: 'all', tier: 'all' };
    let operationFilters = { search: '', status: 'all', area: 'all' };

    function showTab(tab, trigger) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      if (trigger) trigger.classList.add('active');
      else {
        const index = ['bots','diagnostics','guilds','licenses','stations','logs','operations'].indexOf(tab);
        const buttons = document.querySelectorAll('.tab');
        if (buttons[index]) buttons[index].classList.add('active');
      }
      renderTab(tab);
    }

    function renderTab(tab) {
      const el = document.getElementById('content');
      const d = cachedData;
      if (tab === 'diagnostics') {
        if (!d.diagnostics) { el.innerHTML = '<div class="loading">Lade Diagnose...</div>'; return; }
        el.innerHTML = renderDiagnostics(d.diagnostics);
      } else if (tab === 'bots') {
        if (!d.overview) { el.innerHTML = '<div class="loading">Lade...</div>'; return; }
        el.innerHTML = '<table><thead><tr><th>Bot</th><th>Rolle</th><th>Status</th><th>Guilds</th><th>Verbindungen</th><th>Zuhörer</th><th>Uptime</th></tr></thead><tbody>' +
          d.overview.bots.map(b => '<tr>' +
            '<td><b>' + esc(b.name) + '</b></td>' +
            '<td style="color:#71717a">' + esc(b.role) + '</td>' +
            '<td>' + (b.online ? '<span class="badge-online"></span><span class="green">Online</span>' : '<span class="badge-offline"></span><span class="red">Offline</span>') + '</td>' +
            '<td>' + b.guilds + '</td>' +
            '<td>' + b.connections + '</td>' +
            '<td>' + b.listeners + '</td>' +
            '<td style="color:#71717a">' + (b.uptime != null ? fmtUptime(b.uptime) : '–') + '</td>' +
          '</tr>').join('') + '</tbody></table>';
      } else if (tab === 'guilds') {
        if (!d.guilds) { el.innerHTML = '<div class="loading">Lade...</div>'; return; }
        el.innerHTML = '<table><thead><tr><th>Server</th><th>ID</th><th>Mitglieder</th><th>Bot</th><th>Spielt</th><th>Station</th></tr></thead><tbody>' +
          d.guilds.guilds.slice(0,200).map(g => '<tr>' +
            '<td><b>' + esc(g.name) + '</b></td>' +
            '<td style="font-family:monospace;color:#71717a;font-size:11px">' + esc(g.id) + '</td>' +
            '<td>' + g.memberCount + '</td>' +
            '<td style="color:#71717a">' + esc(g.bot) + '</td>' +
            '<td>' + (g.playing ? '<span class="green">▶ Ja</span>' : '<span style="color:#52525b">–</span>') + '</td>' +
            '<td style="color:#71717a;font-size:12px">' + esc(g.station || '–') + '</td>' +
          '</tr>').join('') + '</tbody></table>' +
          (d.guilds.total > 200 ? '<div style="padding:12px 16px;font-size:12px;color:#52525b">Zeige 200 von ' + d.guilds.total + ' Guilds</div>' : '');
      } else if (tab === 'licenses') {
        if (!d.licenses) { el.innerHTML = '<div class="loading">Lade...</div>'; return; }
        const lics = Object.entries(d.licenses.licenses || {});
        el.innerHTML = '<table><thead><tr><th>ID</th><th>Plan</th><th>Aktiv</th><th>Läuft ab</th><th>Seats</th><th>E-Mail</th><th>Aktion</th></tr></thead><tbody>' +
          lics.map(([id, l]) => {
            const expired = l.expiresAt && new Date(l.expiresAt) < new Date();
            return '<tr>' +
              '<td style="font-family:monospace;font-size:11px;color:#71717a">' + esc(id.slice(0,16)) + '…</td>' +
              '<td><b style="color:' + planColor(l.plan||l.tier) + '">' + esc(l.plan||l.tier||'free') + '</b></td>' +
              '<td>' + (l.active && !expired ? '<span class="green">✓</span>' : '<span class="red">✗</span>') + '</td>' +
              '<td style="font-size:12px;color:' + (expired?'#FF2A2A':'#71717a') + '">' + (l.expiresAt ? l.expiresAt.slice(0,10) : '–') + '</td>' +
              '<td>' + (l.seats||1) + '</td>' +
              '<td style="font-size:12px;color:#71717a">' + esc(l.contactEmail||'–') + '</td>' +
              '<td><button class="btn btn-amber" style="font-size:11px;padding:4px 10px" onclick="editLicense(' + JSON.stringify(id) + ')">Bearbeiten</button></td>' +
            '</tr>';
          }).join('') + '</tbody></table>';
      } else if (tab === 'stations') {
        if (!d.stations) { el.innerHTML = '<div class="loading">Lade...</div>'; return; }
        const stations = (d.stations.stations || []).slice().sort(sortStations);
        const filteredStations = stations.filter(matchesStationFilter);
        const summary = buildStationSummary(stations);
        el.innerHTML =
          '<div class="summary-row">' +
            summaryPill(summary.total, 'Gesamt', '') +
            summaryPill(summary.up, 'Online', 'green') +
            summaryPill(summary.down, 'Defekt', 'red') +
            summaryPill(summary.unknown, 'Nicht geprüft', 'amber') +
          '</div>' +
          '<div class="toolbar">' +
            '<input id="stationSearch" type="text" placeholder="Station suchen: Key, Name, Genre, URL..." value="' + escAttr(stationFilters.search) + '" oninput="setStationFilter(\\'search\\', this.value)"/>' +
            '<select id="stationHealthFilter" onchange="setStationFilter(\\'health\\', this.value)">' +
              option('all', 'Alle, Probleme oben', stationFilters.health) +
              option('down', 'Nur defekt', stationFilters.health) +
              option('unknown', 'Nur nicht geprüft', stationFilters.health) +
              option('up', 'Nur online', stationFilters.health) +
            '</select>' +
            '<select id="stationTierFilter" onchange="setStationFilter(\\'tier\\', this.value)">' +
              option('all', 'Alle Pläne', stationFilters.tier) +
              option('free', 'Free', stationFilters.tier) +
              option('pro', 'Pro', stationFilters.tier) +
              option('ultimate', 'Ultimate', stationFilters.tier) +
            '</select>' +
          '</div>' +
          (filteredStations.length
            ? '<table><thead><tr><th>Status</th><th>Key</th><th>Name</th><th>Tier</th><th>Antwortzeit</th><th>Fehler</th><th>Stream</th><th>Aktionen</th></tr></thead><tbody>' +
              filteredStations.map(s => {
                const status = getStationHealthState(s);
                const rowClass = status === 'down' ? ' class="problem-row"' : (status === 'unknown' ? ' class="warning-row"' : '');
                return '<tr' + rowClass + '>' +
                  '<td>' + healthBadge(s.health) + '</td>' +
                  '<td style="font-family:monospace;font-size:11px;color:#71717a">' + esc(s.key) + '</td>' +
                  '<td><b>' + esc(s.name) + '</b><div style="font-size:11px;color:#52525b">' + esc(s.genre || '') + '</div></td>' +
                  '<td style="color:' + planColor(s.tier) + ';font-size:11px;font-weight:700">' + esc(s.tier||'free') + '</td>' +
                  '<td style="font-size:12px;color:#71717a">' + (s.health?.responseTimeMs != null ? s.health.responseTimeMs + 'ms' : '–') + '</td>' +
                  '<td style="font-size:12px;color:' + (s.health?.consecutiveFailures > 0 ? '#FF2A2A' : '#52525b') + '">' + (s.health?.consecutiveFailures || 0) + '</td>' +
                  '<td><div class="station-url" title="' + escAttr(s.url || '') + '">' + esc(s.url || '–') + '</div></td>' +
                  '<td><div class="row-actions">' +
                    (s.url ? '<a class="mini-btn" href="' + escAttr(s.url) + '" target="_blank" rel="noopener">Öffnen</a>' : '') +
                    '<button class="mini-btn" onclick="copyText(' + JSON.stringify(s.key) + ')">Key</button>' +
                    (s.url ? '<button class="mini-btn" onclick="copyText(' + JSON.stringify(s.url) + ')">URL</button>' : '') +
                  '</div></td>' +
                '</tr>';
              }).join('') + '</tbody></table>'
            : '<div class="empty-state">Keine Station passt zu diesen Filtern.</div>');
      } else if (tab === 'logs') {
        if (!d.logs) { el.innerHTML = '<div class="loading">Lade...</div>'; return; }
        const incidents = d.logs.incidents || [];
        if (!incidents.length) { el.innerHTML = '<div class="loading">Keine Incidents.</div>'; return; }
        el.innerHTML = '<table><thead><tr><th>Zeit</th><th>Level</th><th>Nachricht</th></tr></thead><tbody>' +
          incidents.slice(0,100).map(i => '<tr>' +
            '<td style="font-size:11px;color:#71717a;white-space:nowrap">' + esc(i.timestamp||i.time||'') + '</td>' +
            '<td><span style="color:' + levelColor(i.level) + ';font-size:11px;font-weight:700">' + esc(i.level||'INFO') + '</span></td>' +
            '<td style="font-size:12px;max-width:600px;overflow:hidden;text-overflow:ellipsis">' + esc(String(i.message||i.msg||'')) + '</td>' +
          '</tr>').join('') + '</tbody></table>';
      } else if (tab === 'operations') {
        if (!d.operations) { el.innerHTML = '<div class="loading">Lade Betrieb...</div>'; return; }
        el.innerHTML = renderOperations(d.operations);
      }
    }

    async function loadAll() {
      document.getElementById('serverTime').textContent = 'Lädt...';
      try {
        const [overview, guilds, licenses, stations, logs, diagnostics, operations] = await Promise.allSettled([
          api('overview'), api('guilds'), api('licenses'), api('stations'), api('logs'), api('diagnostics'), api('operations')
        ]);
        if (overview.status === 'fulfilled') {
          cachedData.overview = overview.value;
          const o = overview.value;
          const onlineBots = o.bots.filter(b => b.online).length;
          document.getElementById('statBots').textContent = onlineBots + '/' + o.bots.length;
          document.getElementById('statBots').className = 'val ' + (onlineBots === o.bots.length ? 'green' : onlineBots > 0 ? 'amber' : 'red');
          const totalGuilds = o.bots.reduce((s,b) => s + b.guilds, 0);
          document.getElementById('statGuilds').textContent = totalGuilds;
          document.getElementById('statLicenses').textContent = o.licenses.active + '/' + o.licenses.total;
          const stationTotal = Number(o.stations.total || 0) || 0;
          const stationUnknown = Math.max(0, stationTotal - Number(o.stations.up || 0) - Number(o.stations.down || 0));
          document.getElementById('statStations').textContent = stationTotal;
          document.getElementById('statStationsSub').textContent = o.stations.up + ' online / ' + o.stations.down + ' defekt / ' + stationUnknown + ' offen';
          document.getElementById('statStations').className = 'val ' + (o.stations.down > 0 ? 'red' : stationUnknown > 0 ? 'amber' : 'green');
          const release = o.release || {};
          document.getElementById('statRelease').textContent = release.commit || 'unknown';
          document.getElementById('statReleaseSub').textContent = 'v' + (release.appVersion || 'unknown') + ' / deploy ' + (release.lastDeployStatus || 'unknown') + ' / smoke ' + (release.lastLiveSmokeStatus || 'unknown');
          document.getElementById('serverTime').textContent = new Date(o.serverTime).toLocaleTimeString('de-AT');
        }
        if (guilds.status === 'fulfilled') cachedData.guilds = guilds.value;
        if (licenses.status === 'fulfilled') cachedData.licenses = licenses.value;
        if (stations.status === 'fulfilled') cachedData.stations = stations.value;
        if (logs.status === 'fulfilled') cachedData.logs = logs.value;
        if (diagnostics.status === 'fulfilled') cachedData.diagnostics = diagnostics.value;
        if (operations.status === 'fulfilled') cachedData.operations = operations.value;
        renderTab(currentTab);
      } catch(e) {
        document.getElementById('content').innerHTML = '<div class="error-msg">Fehler: ' + esc(e.message) + '</div>';
      }
    }

    function renderOperations(payload) {
      const operations = Array.isArray(payload.operations) ? payload.operations : [];
      const filtered = operations.filter(matchesOperationFilter);
      const areas = Array.from(new Set(operations.map(o => o.area).filter(Boolean))).sort();
      const summary = payload.summary || {};
      return '<div class="summary-row">' +
          summaryPill(payload.total || operations.length, 'update.sh Funktionen', '') +
          summaryPill(summary.available || 0, 'Web fertig', 'green') +
          summaryPill(summary.partial || 0, 'Teilweise Web', 'amber') +
          summaryPill(summary.planned || 0, 'Noch CLI-only', 'red') +
        '</div>' +
        '<div class="toolbar">' +
          '<input id="operationSearch" type="text" placeholder="Funktion suchen: Update, Bots, Stripe, Doctor..." value="' + escAttr(operationFilters.search) + '" oninput="setOperationFilter(\\'search\\', this.value)"/>' +
          '<select id="operationStatusFilter" onchange="setOperationFilter(\\'status\\', this.value)">' +
            option('all', 'Alle Status', operationFilters.status) +
            option('available', 'Web fertig', operationFilters.status) +
            option('partial', 'Teilweise Web', operationFilters.status) +
            option('planned', 'Noch CLI-only', operationFilters.status) +
          '</select>' +
          '<select id="operationAreaFilter" onchange="setOperationFilter(\\'area\\', this.value)">' +
            option('all', 'Alle Bereiche', operationFilters.area) +
            areas.map(area => option(area, area, operationFilters.area)).join('') +
          '</select>' +
        '</div>' +
        (filtered.length
          ? '<table><thead><tr><th>Bereich</th><th>Funktion</th><th>Web-Stand</th><th>Risiko</th><th>CLI</th><th>Owner-Menue</th><th>Naechster Ausbau</th></tr></thead><tbody>' +
            filtered.map(op => '<tr>' +
              '<td style="color:#71717a">' + esc(op.area || '-') + '</td>' +
              '<td><b>' + esc(op.title || op.id) + '</b><div style="font-size:12px;color:#71717a;margin-top:3px">' + esc(op.description || '') + '</div></td>' +
              '<td>' + operationStatusBadge(op.webStatus) + '</td>' +
              '<td>' + riskBadge(op.risk) + '</td>' +
              '<td><span class="cmd">' + esc(op.cli || '') + '</span></td>' +
              '<td style="font-size:12px;color:#a1a1aa">' + esc(op.webEntry || '-') + '</td>' +
              '<td style="font-size:12px;color:#71717a">' + esc(op.nextStep || '-') + '</td>' +
            '</tr>').join('') + '</tbody></table>'
          : '<div class="empty-state">Keine Funktion passt zu diesen Filtern.</div>');
    }

    function renderDiagnostics(diag) {
      const runtime = diag.runtime || {};
      const bots = runtime.bots || {};
      const infra = diag.infrastructure || {};
      const binaries = diag.binaries || {};
      const alerts = diag.alerts || [];
      const services = [
        ['Admin Token', infra.adminToken],
        ['MongoDB', infra.mongo],
        ['Stripe', infra.stripe],
        ['SMTP Mail', infra.smtp],
        ['Vote Webhooks', infra.webhooks],
        ['Public Web URL', infra.publicWebUrl],
      ];
      const binaryRows = [
        ['ffmpeg', binaries.ffmpeg],
        ['fpcalc', binaries.fpcalc],
      ];
      return '<div class="summary-row">' +
          summaryPill(diag.status || 'unknown', 'Gesamtstatus', statusColor(diag.status)) +
          summaryPill((bots.online || 0) + '/' + (bots.total || 0), 'Bots online', (bots.online === bots.total && bots.total > 0) ? 'green' : 'amber') +
          summaryPill((diag.stations?.down || 0), 'Stationen defekt', (diag.stations?.down || 0) > 0 ? 'red' : 'green') +
          summaryPill((diag.incidents?.errors || 0), 'Recent Errors', (diag.incidents?.errors || 0) > 0 ? 'red' : 'green') +
        '</div>' +
        (alerts.length ? '<div class="toolbar">' + alerts.map(a => '<span class="mini-btn" style="border-color:' + alertColor(a.severity) + ';color:' + alertColor(a.severity) + '">' + esc(a.severity || 'info').toUpperCase() + ': ' + esc(a.message || a.code || '') + '</span>').join('') + '</div>' : '') +
        '<table><thead><tr><th>Bereich</th><th>Status</th><th>Details</th></tr></thead><tbody>' +
          '<tr><td><b>Runtime</b></td><td>' + statusBadge(diag.status) + '</td><td style="font-size:12px;color:#71717a">' + esc(runtime.processMode || 'monolith') + ' · Node ' + esc(runtime.node || '') + ' · ' + esc(runtime.platform || '') + ' · Uptime ' + fmtUptime(runtime.processUptime || 0) + '</td></tr>' +
          '<tr><td><b>Commander / Worker</b></td><td>' + statusBadge(bots.commanderOnline || bots.workersOnline > 0 ? 'healthy' : 'warning') + '</td><td style="font-size:12px;color:#71717a">Commander ' + boolLabel(bots.commanderOnline) + ' · Worker ' + esc(bots.workersOnline || 0) + '/' + esc(bots.workersTotal || 0) + '</td></tr>' +
          '<tr><td><b>Stationen</b></td><td>' + statusBadge((diag.stations?.down || 0) > 0 ? 'warning' : 'healthy') + '</td><td style="font-size:12px;color:#71717a">Gesamt ' + esc(diag.stations?.total || 0) + ' · geprüft ' + esc(diag.stations?.checked || 0) + ' · online ' + esc(diag.stations?.up || 0) + ' · defekt ' + esc(diag.stations?.down || 0) + '</td></tr>' +
          '<tr><td><b>Lizenzen</b></td><td>' + statusBadge('healthy') + '</td><td style="font-size:12px;color:#71717a">Aktiv ' + esc(diag.licenses?.active || 0) + ' · abgelaufen ' + esc(diag.licenses?.expired || 0) + ' · gesamt ' + esc(diag.licenses?.total || 0) + '</td></tr>' +
          services.map(([name, service]) => '<tr><td><b>' + esc(name) + '</b></td><td>' + statusBadge(service?.status) + '</td><td style="font-size:12px;color:#71717a">configured=' + boolLabel(service?.configured) + (service?.required ? ' · required=true' : '') + (service?.webhookConfigured != null ? ' · webhook=' + boolLabel(service.webhookConfigured) : '') + '</td></tr>').join('') +
          binaryRows.map(([name, binary]) => '<tr><td><b>' + esc(name) + '</b></td><td>' + statusBadge(binary?.available ? 'healthy' : 'warning') + '</td><td style="font-size:12px;color:#71717a">' + esc(binary?.version || 'nicht gefunden') + '</td></tr>').join('') +
        '</tbody></table>' +
        '<div class="section-header"><h2>Runtimes</h2><span style="font-size:12px;color:#71717a">' + esc(diag.generatedAt || '') + '</span></div>' +
        '<table><thead><tr><th>Name</th><th>Rolle</th><th>Status</th><th>Guilds</th><th>Verbindungen</th><th>Zuhörer</th><th>Uptime</th></tr></thead><tbody>' +
          (runtime.rows || []).map(r => '<tr><td><b>' + esc(r.name) + '</b></td><td style="color:#71717a">' + esc(r.role) + '</td><td>' + statusBadge(r.online ? 'healthy' : 'critical') + '</td><td>' + esc(r.guilds || 0) + '</td><td>' + esc(r.connections || 0) + '</td><td>' + esc(r.listeners || 0) + '</td><td style="color:#71717a">' + (r.uptime != null ? fmtUptime(r.uptime) : '–') + '</td></tr>').join('') +
        '</tbody></table>';
    }

    function boolLabel(value) {
      return value ? 'ja' : 'nein';
    }

    function statusColor(status) {
      if (status === 'healthy' || status === 'configured') return 'green';
      if (status === 'critical' || status === 'missing') return 'red';
      return 'amber';
    }

    function alertColor(severity) {
      if (severity === 'critical') return '#FF2A2A';
      if (severity === 'warning') return '#FFB800';
      return '#00F0FF';
    }

    function statusBadge(status) {
      const color = statusColor(status);
      const label = status === 'healthy' ? 'OK' : status === 'configured' ? 'KONFIGURIERT' : status === 'critical' ? 'KRITISCH' : status === 'missing' ? 'FEHLT' : status === 'optional' ? 'OPTIONAL' : 'WARNUNG';
      return '<span class="' + (color === 'green' ? 'badge-up' : color === 'red' ? 'badge-down' : 'badge-unknown') + '">' + esc(label) + '</span>';
    }

    function editLicense(id) {
      const l = cachedData.licenses?.licenses?.[id];
      if (!l) return;
      document.getElementById('editLicenseId').value = id;
      document.getElementById('editPlan').value = l.plan || l.tier || 'free';
      document.getElementById('editActive').value = String(l.active !== false);
      document.getElementById('editExpiresAt').value = l.expiresAt || '';
      document.getElementById('editSeats').value = l.seats || 1;
      document.getElementById('editNotes').value = l.notes || '';
      document.getElementById('licenseEditStatus').textContent = '';
      document.getElementById('licenseModal').classList.add('open');
    }

    function closeLicenseModal() {
      document.getElementById('licenseModal').classList.remove('open');
    }

    async function saveLicense() {
      const id = document.getElementById('editLicenseId').value;
      const patch = {
        plan: document.getElementById('editPlan').value.trim(),
        active: document.getElementById('editActive').value.trim() === 'true',
        expiresAt: document.getElementById('editExpiresAt').value.trim() || null,
        seats: parseInt(document.getElementById('editSeats').value) || 1,
        notes: document.getElementById('editNotes').value.trim() || null,
      };
      try {
        await apiPost('licenses/' + encodeURIComponent(id), patch);
        document.getElementById('licenseEditStatus').textContent = '✓ Gespeichert';
        document.getElementById('licenseEditStatus').style.color = '#39FF14';
        setTimeout(() => { closeLicenseModal(); loadAll(); }, 800);
      } catch(e) {
        document.getElementById('licenseEditStatus').textContent = '✗ Fehler: ' + e.message;
        document.getElementById('licenseEditStatus').style.color = '#FF2A2A';
      }
    }

    async function revokeLicense() {
      if (!confirm('Lizenz wirklich sperren?')) return;
      const id = document.getElementById('editLicenseId').value;
      try {
        await apiPost('licenses/' + encodeURIComponent(id), { active: false, expired: true });
        closeLicenseModal();
        loadAll();
      } catch(e) {
        document.getElementById('licenseEditStatus').textContent = '✗ ' + e.message;
      }
    }

    function esc(s) {
      return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
    }
    function escAttr(s) {
      return esc(s).replace(/'/g,'&#39;');
    }
    function option(value, label, selected) {
      return '<option value="' + escAttr(value) + '"' + (String(value) === String(selected) ? ' selected' : '') + '>' + esc(label) + '</option>';
    }
    function setStationFilter(key, value) {
      stationFilters[key] = String(value || '').trim();
      renderTab('stations');
    }
    function setOperationFilter(key, value) {
      operationFilters[key] = String(value || '').trim();
      renderTab('operations');
    }
    function matchesOperationFilter(operation) {
      if (operationFilters.status !== 'all' && String(operation?.webStatus || '') !== operationFilters.status) return false;
      if (operationFilters.area !== 'all' && String(operation?.area || '') !== operationFilters.area) return false;
      const needle = String(operationFilters.search || '').toLowerCase();
      if (!needle) return true;
      return [operation?.id, operation?.area, operation?.title, operation?.description, operation?.cli, operation?.webEntry, operation?.nextStep]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    }
    function operationStatusBadge(status) {
      if (status === 'available') return '<span class="badge-up">WEB FERTIG</span>';
      if (status === 'partial') return '<span class="badge-unknown">TEILWEISE</span>';
      return '<span class="badge-down">CLI-ONLY</span>';
    }
    function riskBadge(risk) {
      if (risk === 'high') return '<span class="badge-down">HOCH</span>';
      if (risk === 'medium') return '<span class="badge-unknown">MITTEL</span>';
      return '<span class="badge-up">NIEDRIG</span>';
    }
    function getStationHealthState(station) {
      const status = String(station?.health?.status || '').trim().toLowerCase();
      if (status === 'up' || status === 'down') return status;
      return 'unknown';
    }
    function stationHealthRank(station) {
      const status = getStationHealthState(station);
      if (status === 'down') return 0;
      if (status === 'unknown') return 1;
      return 2;
    }
    function sortStations(a, b) {
      const byHealth = stationHealthRank(a) - stationHealthRank(b);
      if (byHealth) return byHealth;
      const failures = Number(b?.health?.consecutiveFailures || 0) - Number(a?.health?.consecutiveFailures || 0);
      if (failures) return failures;
      return String(a?.key || '').localeCompare(String(b?.key || ''));
    }
    function matchesStationFilter(station) {
      const health = getStationHealthState(station);
      if (stationFilters.health !== 'all' && health !== stationFilters.health) return false;
      if (stationFilters.tier !== 'all' && String(station?.tier || 'free') !== stationFilters.tier) return false;
      const needle = String(stationFilters.search || '').toLowerCase();
      if (!needle) return true;
      return [station?.key, station?.name, station?.genre, station?.tier, station?.url]
        .some((value) => String(value || '').toLowerCase().includes(needle));
    }
    function buildStationSummary(stations) {
      return (stations || []).reduce((acc, station) => {
        acc.total += 1;
        acc[getStationHealthState(station)] += 1;
        return acc;
      }, { total: 0, up: 0, down: 0, unknown: 0 });
    }
    function summaryPill(value, label, color) {
      const cls = color ? ' class="' + escAttr(color) + '"' : '';
      return '<div class="summary-pill"><strong' + cls + '>' + esc(value) + '</strong><span>' + esc(label) + '</span></div>';
    }
    async function copyText(value) {
      const text = String(value || '');
      if (!text) return;
      try {
        await navigator.clipboard.writeText(text);
      } catch {
        const input = document.createElement('textarea');
        input.value = text;
        document.body.appendChild(input);
        input.select();
        document.execCommand('copy');
        input.remove();
      }
    }
    function planColor(p) {
      if (p === 'ultimate') return '#BD00FF';
      if (p === 'pro') return '#FFB800';
      return '#39FF14';
    }
    function levelColor(l) {
      if (l === 'ERROR') return '#FF2A2A';
      if (l === 'WARN') return '#FFB800';
      return '#71717a';
    }
    function healthBadge(h) {
      if (!h) return '<span class="badge-unknown">NICHT GEPRÜFT</span>';
      if (h.status === 'up') return '<span class="badge-up">▲ UP</span>';
      if (h.status === 'down') return '<span class="badge-down">▼ DOWN</span>';
      return '<span class="badge-unknown">UNKLAR</span>';
    }
    function fmtUptime(s) {
      const h = Math.floor(s/3600), m = Math.floor((s%3600)/60);
      return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
    }

    // Auto-Refresh alle 30s
    loadAll();
    setInterval(loadAll, 30000);
  </script>
</body>
</html>`;
}
