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
//   GET  /api/admin/config       → Owner-Einstellungen ohne Secret-Werte
//   POST /api/admin/config       → Erlaubte Owner-Einstellungen in .env speichern
//   POST /api/admin/config/secrets → Erlaubte Secrets write-only in .env speichern
//   GET  /api/admin/legal        → Legal/Privacy/Terms Readiness und Preview
//   GET  /api/admin/mail         → SMTP-Status ohne Secret-Werte
//   POST /api/admin/mail/test    → SMTP-Testmail senden
//   GET  /api/admin/audit        → Owner-Audit-Log ohne Secret-Werte
//   GET  /api/admin/jobs         → Erlaubte Owner-Jobs und letzte Laeufe
//   POST /api/admin/jobs         → Erlaubten Owner-Job starten
//   GET  /api/admin/jobs/:id     → Einzelnen Owner-Job abrufen
//   GET  /api/admin/licenses     → Alle Lizenzen
//   POST /api/admin/licenses/:id → Lizenz patchen (aktivieren, verlängern, sperren)
//   GET  /api/admin/guilds       → Alle Guilds mit Status
//   GET  /api/admin/logs         → Letzte Operator-Incidents
//   GET  /api/admin/log-files    → Erlaubte lokale Logdateien
//   GET  /api/admin/log-files/:name → Tail einer erlaubten lokalen Logdatei
//   GET  /api/admin/stations     → Alle Stationen (inkl. Health-Status)
//   POST /api/admin/stations     → Station hinzufügen/bearbeiten
// ============================================================

import { getOwnerConfigSnapshot, patchOwnerConfig, patchOwnerSecrets } from "../../lib/owner-config-store.js";
import { getOwnerJob, getOwnerJobsSnapshot, startOwnerJob } from "../../lib/owner-job-runner.js";
import { getOwnerAuditSnapshot, recordOwnerAudit } from "../../lib/owner-audit-store.js";
import { getOwnerLogFileSnapshot, getOwnerLogFilesSnapshot } from "../../lib/owner-log-files.js";
import { TEST_CONFIRMATION_VALUE, getOwnerMailStatus, sendOwnerTestMail } from "../../lib/owner-mail-test.js";

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
    buildPublicLegalNotice,
    buildPublicPrivacyNotice,
    buildPublicTermsNotice,
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
        webEntry: "Tab Aktionen zeigt Release-Preflight-Plan und Rollback-Plan als sichere Jobs.",
        nextStep: "Echter Update-Lauf erst mit Confirm-Step, Audit-Log und Rollback-/Log-Ausgabe."
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
        webStatus: "available",
        risk: "high",
        description: "SMTP Host, Port, TLS, Absender und Admin-Mail konfigurieren.",
        webEntry: "Tab Einstellungen kann SMTP-Basisdaten und SMTP_PASS write-only speichern und eine bestaetigte Testmail senden.",
        nextStep: "Optional spaeter: SMTP-Fehlerdiagnose detaillierter strukturieren."
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
        webStatus: "available",
        risk: "medium",
        description: "Command Registration Mode, Cleanup und Sync-Retry konfigurieren.",
        webEntry: "Tab Einstellungen kann Command-Modus, Cleanup-Flags und Sync-Retry speichern; Tab Aktionen kann Slash-Commands bestaetigt deployen.",
        nextStep: "Optional spaeter: Command-Sync-Ergebnis strukturierter auswerten."
      },
      {
        id: "settings-legal",
        area: "Settings",
        title: "Legal Setup",
        cli: "./update.sh --settings legal",
        webStatus: "available",
        risk: "medium",
        description: "Impressum, Datenschutz und Terms-Angaben pflegen.",
        webEntry: "Tab Einstellungen kann Legal-, Privacy- und Terms-Werte speichern und zeigt Readiness plus Vorschau.",
        nextStep: "Nach rechtlicher Pruefung nur noch Inhalte pflegen und oeffentliche Seiten erneut pruefen."
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
        webStatus: "available",
        risk: "low",
        description: "System, OAuth, JSON, Runtime und Infrastruktur pruefen.",
        webEntry: "Tab Aktionen kann update.sh --doctor als begrenzten Owner-Job starten; Tab Diagnose zeigt strukturierte Kurzdiagnose.",
        nextStep: "Doctor-Ausgabe schrittweise in strukturierte Web-Checks ueberfuehren."
      },
      {
        id: "recognition-test",
        area: "Audio",
        title: "Recognition Test",
        cli: "./update.sh --recognition-test <URL>",
        webStatus: "available",
        risk: "medium",
        description: "Audio-Fingerprint/Metadata-Test fuer eine Stream-URL.",
        webEntry: "Tab Aktionen kann Recognition-Test mit Stream-URL, Confirm und Audit starten.",
        nextStep: "Ergebnisdetails spaeter strukturierter auswerten und anzeigen."
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

  function compactMissingFields(fields) {
    return Array.from(new Set((Array.isArray(fields) ? fields : [])
      .map((field) => String(field || "").trim())
      .filter(Boolean)));
  }

  function buildOwnerLegalReadiness() {
    const legal = typeof buildPublicLegalNotice === "function" ? buildPublicLegalNotice() : null;
    const privacy = typeof buildPublicPrivacyNotice === "function" ? buildPublicPrivacyNotice() : null;
    const terms = typeof buildPublicTermsNotice === "function" ? buildPublicTermsNotice() : null;
    const sections = [
      {
        id: "legal",
        title: "Impressum",
        route: "/api/legal",
        configured: Boolean(legal?.isConfigured),
        missingCoreFields: compactMissingFields(legal?.missingCoreFields),
      },
      {
        id: "privacy",
        title: "Datenschutz",
        route: "/api/privacy",
        configured: Boolean(privacy?.isConfigured),
        missingCoreFields: compactMissingFields(privacy?.missingCoreFields),
      },
      {
        id: "terms",
        title: "Nutzungsbedingungen",
        route: "/api/terms",
        configured: Boolean(terms?.isConfigured),
        missingCoreFields: compactMissingFields(terms?.missingCoreFields),
      },
    ];
    return {
      generatedAt: new Date().toISOString(),
      configured: sections.every((section) => section.configured),
      sections,
      preview: {
        legal: {
          productName: legal?.legal?.productName || "",
          providerName: legal?.legal?.providerName || "",
          legalForm: legal?.legal?.legalForm || "",
          address: [legal?.legal?.streetAddress, [legal?.legal?.postalCode, legal?.legal?.city].filter(Boolean).join(" ")].filter(Boolean).join(", "),
          email: legal?.legal?.email || "",
          website: legal?.legal?.website || "",
        },
        privacy: {
          controllerName: privacy?.controller?.name || "",
          contactEmail: privacy?.contact?.email || "",
          hostingProvider: privacy?.hosting?.provider || "",
          authorityName: privacy?.authority?.name || "",
        },
        terms: {
          providerName: terms?.operator?.providerName || "",
          contactEmail: terms?.contact?.email || "",
          website: terms?.contact?.website || "",
          effectiveDate: terms?.contact?.effectiveDate || "",
          governingLaw: terms?.contact?.governingLaw || "",
        },
      },
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

  function getRequestAuditMeta(req) {
    const forwardedFor = String(req.headers?.["x-forwarded-for"] || "").split(",")[0].trim();
    return {
      ip: forwardedFor || req.socket?.remoteAddress || "",
      userAgent: String(req.headers?.["user-agent"] || "").slice(0, 200),
      origin: String(req.headers?.origin || "").slice(0, 200),
    };
  }

  function auditOwnerAction(req, event) {
    try {
      return recordOwnerAudit({
        actor: "owner",
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
          auditOwnerAction(req, {
            action: "owner.login",
            status: "failed",
            summary: "Owner-Login fehlgeschlagen",
          });
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
        auditOwnerAction(req, {
          action: "owner.login",
          status: "success",
          summary: "Owner-Login erfolgreich",
        });
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
      auditOwnerAction(req, {
        action: "owner.logout",
        status: "success",
        summary: "Owner-Logout",
      });
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

    // GET/POST /api/admin/config
    if (pathname === "/api/admin/config") {
      if (req.method === "GET") {
        sendJson(res, 200, getOwnerConfigSnapshot());
        return true;
      }
      if (req.method === "POST" || req.method === "PATCH") {
        try {
          const payload = JSON.parse(await readRequestBody(req) || "{}");
          const snapshot = patchOwnerConfig(payload);
          const keys = Array.isArray(snapshot.updatedKeys) ? snapshot.updatedKeys.join(", ") : "";
          log?.("INFO", `[Owner] Einstellungen gespeichert: ${keys || "keine Aenderung"}`);
          auditOwnerAction(req, {
            action: "owner.config.update",
            status: "success",
            target: "env",
            summary: `Owner-Einstellungen gespeichert: ${keys || "keine Aenderung"}`,
            metadata: { updatedKeys: snapshot.updatedKeys || [] },
          });
          sendJson(res, 200, { ok: true, ...snapshot });
        } catch (err) {
          auditOwnerAction(req, {
            action: "owner.config.update",
            status: "failed",
            target: "env",
            summary: err?.message || "Ungueltige Owner-Einstellungen",
          });
          sendJson(res, err?.statusCode || 400, { ok: false, error: err?.message || "Ungueltige Owner-Einstellungen" });
        }
        return true;
      }
      methodNotAllowed(res, ["GET", "POST", "PATCH"]);
      return true;
    }

    // GET /api/admin/legal
    if (pathname === "/api/admin/legal") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      sendJson(res, 200, buildOwnerLegalReadiness());
      return true;
    }

    // POST /api/admin/config/secrets
    if (pathname === "/api/admin/config/secrets") {
      if (req.method !== "POST" && req.method !== "PATCH") { methodNotAllowed(res, ["POST", "PATCH"]); return true; }
      try {
        const payload = JSON.parse(await readRequestBody(req) || "{}");
        const snapshot = patchOwnerSecrets(payload);
        const keys = Array.isArray(snapshot.updatedKeys) ? snapshot.updatedKeys.join(", ") : "";
        log?.("INFO", `[Owner] Secrets aktualisiert: ${keys || "keine Aenderung"}`);
        auditOwnerAction(req, {
          action: "owner.config.secrets.update",
          status: "success",
          target: "env",
          summary: `Owner-Secrets aktualisiert: ${keys || "keine Aenderung"}`,
          metadata: { updatedKeys: snapshot.updatedKeys || [] },
        });
        sendJson(res, 200, { ok: true, ...snapshot });
      } catch (err) {
        auditOwnerAction(req, {
          action: "owner.config.secrets.update",
          status: "failed",
          target: "env",
          summary: err?.message || "Ungueltige Owner-Secrets",
        });
        sendJson(res, err?.statusCode || 400, { ok: false, error: err?.message || "Ungueltige Owner-Secrets" });
      }
      return true;
    }

    // GET /api/admin/mail
    if (pathname === "/api/admin/mail") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      sendJson(res, 200, getOwnerMailStatus());
      return true;
    }

    // POST /api/admin/mail/test
    if (pathname === "/api/admin/mail/test") {
      if (req.method !== "POST") { methodNotAllowed(res, ["POST"]); return true; }
      try {
        const payload = JSON.parse(await readRequestBody(req) || "{}");
        if (String(payload?.confirm || "").trim() !== TEST_CONFIRMATION_VALUE) {
          auditOwnerAction(req, {
            action: "owner.mail.test",
            status: "denied",
            target: String(payload?.to || getOwnerMailStatus().defaultRecipient || ""),
            summary: "SMTP-Testmail ohne passende Bestaetigung abgelehnt",
            metadata: { requiresConfirmation: true },
          });
          sendJson(res, 400, {
            ok: false,
            error: `Bestaetigung erforderlich. Sende confirm=${TEST_CONFIRMATION_VALUE}.`,
            requiresConfirmation: true,
            confirmationValue: TEST_CONFIRMATION_VALUE,
          });
          return true;
        }
        const result = await sendOwnerTestMail(payload);
        auditOwnerAction(req, {
          action: "owner.mail.test",
          status: "success",
          target: result.to,
          summary: `SMTP-Testmail gesendet an ${result.toMasked || result.to}`,
          metadata: { to: result.toMasked || result.to, sentAt: result.sentAt },
        });
        sendJson(res, 200, result);
      } catch (err) {
        auditOwnerAction(req, {
          action: "owner.mail.test",
          status: "failed",
          target: "",
          summary: err?.message || "SMTP-Testmail konnte nicht gesendet werden",
        });
        sendJson(res, err?.statusCode || 500, { ok: false, error: err?.message || "SMTP-Testmail konnte nicht gesendet werden" });
      }
      return true;
    }

    // GET /api/admin/audit
    if (pathname === "/api/admin/audit") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const limit = Number.parseInt(String(requestUrl?.searchParams?.get("limit") || "100"), 10);
      sendJson(res, 200, getOwnerAuditSnapshot({ limit }));
      return true;
    }

    // GET/POST /api/admin/jobs
    if (pathname === "/api/admin/jobs") {
      if (req.method === "GET") {
        sendJson(res, 200, getOwnerJobsSnapshot());
        return true;
      }
      if (req.method === "POST") {
        let actionId = "";
        try {
          const payload = JSON.parse(await readRequestBody(req) || "{}");
          actionId = String(payload?.actionId || "").trim();
          const action = getOwnerJobsSnapshot().actions.find((entry) => entry.id === actionId);
          if (action?.requiresConfirmation && String(payload?.confirm || "").trim() !== action.confirmationValue) {
            auditOwnerAction(req, {
              action: "owner.job.start",
              status: "denied",
              target: actionId,
              summary: `Owner-Job ohne passende Bestaetigung abgelehnt: ${actionId}`,
              metadata: { risk: action.risk, requiresConfirmation: true },
            });
            sendJson(res, 400, {
              ok: false,
              error: `Bestaetigung erforderlich. Sende confirm=${action.confirmationValue}.`,
              requiresConfirmation: true,
              confirmationValue: action.confirmationValue,
            });
            return true;
          }
          const requestAuditMeta = getRequestAuditMeta(req);
          const job = startOwnerJob(actionId, {
            input: payload?.input && typeof payload.input === "object" ? payload.input : payload,
            onFinish: (completedJob) => {
              try {
                recordOwnerAudit({
                  actor: "owner",
                  action: "owner.job.finish",
                  status: completedJob.status === "succeeded" ? "success" : "failed",
                  target: completedJob.actionId,
                  summary: `Owner-Job beendet: ${completedJob.actionId} (${completedJob.status})`,
                  metadata: {
                    ...requestAuditMeta,
                    jobId: completedJob.id,
                    risk: completedJob.risk,
                    exitCode: completedJob.exitCode,
                    signal: completedJob.signal,
                    timedOut: completedJob.timedOut,
                    durationMs: completedJob.durationMs,
                    outputTruncated: completedJob.outputTruncated,
                  },
                });
              } catch (err) {
                log?.("WARN", `[Owner] Job-Abschluss-Audit konnte nicht geschrieben werden: ${err?.message || String(err)}`);
              }
            },
          });
          log?.("INFO", `[Owner] Job gestartet: ${job.actionId} (${job.id})`);
          auditOwnerAction(req, {
            action: "owner.job.start",
            status: "success",
            target: job.actionId,
            summary: `Owner-Job gestartet: ${job.actionId}`,
            metadata: { jobId: job.id, risk: job.risk },
          });
          sendJson(res, 202, { ok: true, job });
        } catch (err) {
          auditOwnerAction(req, {
            action: "owner.job.start",
            status: "failed",
            target: actionId || undefined,
            summary: err?.message || "Owner-Job konnte nicht gestartet werden",
          });
          sendJson(res, err?.statusCode || 400, { ok: false, error: err?.message || "Owner-Job konnte nicht gestartet werden" });
        }
        return true;
      }
      methodNotAllowed(res, ["GET", "POST"]);
      return true;
    }

    // GET /api/admin/jobs/:id
    const jobMatch = pathname.match(/^\/api\/admin\/jobs\/([^/]+)$/);
    if (jobMatch) {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const job = getOwnerJob(decodeURIComponent(jobMatch[1]));
      if (!job) {
        sendJson(res, 404, { ok: false, error: "Owner-Job nicht gefunden" });
        return true;
      }
      sendJson(res, 200, { ok: true, job });
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
      try {
        const patch = JSON.parse(await readRequestBody(req) || "{}");
        // Sicherheit: Nur erlaubte Felder patchen
        const allowed = ["active", "expired", "expiresAt", "plan", "tier", "seats", "linkedServerIds", "contactEmail", "notes"];
        const safePatch = {};
        for (const key of allowed) {
          if (key in patch) safePatch[key] = patch[key];
        }
        patchLicenseById?.(licenseId, safePatch);
        log?.("INFO", `[Admin] Lizenz ${licenseId} gepatcht: ${JSON.stringify(safePatch)}`);
        auditOwnerAction(req, {
          action: "owner.license.patch",
          status: "success",
          target: licenseId,
          summary: `Lizenz gepatcht: ${licenseId}`,
          metadata: { patchedKeys: Object.keys(safePatch) },
        });
        sendJson(res, 200, { ok: true, licenseId, patched: safePatch });
      } catch (err) {
        auditOwnerAction(req, {
          action: "owner.license.patch",
          status: "failed",
          target: licenseId,
          summary: err?.message || "Ungueltiger Body",
        });
        sendJson(res, 400, { ok: false, error: err?.message || "Ungültiger Body" });
      }
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

    // GET /api/admin/log-files
    if (pathname === "/api/admin/log-files") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      try {
        sendJson(res, 200, await getOwnerLogFilesSnapshot());
      } catch (err) {
        sendJson(res, 500, { ok: false, error: err?.message || "Logdateien konnten nicht geladen werden" });
      }
      return true;
    }

    // GET /api/admin/log-files/:name
    const logFileMatch = pathname.match(/^\/api\/admin\/log-files\/([^/]+)$/);
    if (logFileMatch) {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      try {
        const limit = Number.parseInt(String(requestUrl?.searchParams?.get("limit") || "300"), 10);
        const bytes = Number.parseInt(String(requestUrl?.searchParams?.get("bytes") || "80000"), 10);
        const snapshot = await getOwnerLogFileSnapshot(decodeURIComponent(logFileMatch[1]), { lines: limit, bytes });
        sendJson(res, 200, snapshot);
      } catch (err) {
        sendJson(res, err?.statusCode || 500, { ok: false, error: err?.message || "Logdatei konnte nicht geladen werden" });
      }
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
    .config-group{border-top:1px solid #222;padding:16px 0}
    .config-group:first-child{border-top:0;padding-top:0}
    .config-group h3{font-size:13px;color:#e4e4e7;margin-bottom:4px}
    .config-group p{font-size:12px;color:#71717a;margin-bottom:10px}
    .config-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:10px}
    .config-field{background:#0b0b0b;border:1px solid #202020;border-radius:8px;padding:10px}
    .config-field label{display:flex;justify-content:space-between;gap:8px;font-size:11px;color:#a1a1aa;margin-bottom:6px}
    .config-field code{font-size:10px;color:#52525b}
    .config-field input,.config-field select{width:100%;background:#111;border:1px solid #333;color:#e4e4e7;border-radius:7px;padding:8px;font-size:12px}
    .config-status{font-size:12px;color:#71717a;margin-left:8px}
    .job-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px;margin-bottom:16px}
    .job-card{background:#0b0b0b;border:1px solid #202020;border-radius:8px;padding:12px}
    .job-card h3{font-size:13px;margin-bottom:6px;color:#e4e4e7}
    .job-card p{font-size:12px;color:#71717a;min-height:34px;margin-bottom:10px}
    .job-inputs{display:grid;gap:8px;margin:10px 0}
    .job-inputs label{display:grid;gap:5px;font-size:11px;color:#a1a1aa}
    .job-inputs input{width:100%;background:#111;border:1px solid #333;color:#e4e4e7;border-radius:7px;padding:8px;font-size:12px}
    .job-output{white-space:pre-wrap;background:#050505;border:1px solid #222;border-radius:8px;padding:12px;color:#d4d4d8;font-family:'Consolas','JetBrains Mono',monospace;font-size:11px;line-height:1.45;max-height:360px;overflow:auto}
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
        <button class="tab" onclick="showTab('config', this)">🔧 Einstellungen</button>
        <button class="tab" onclick="showTab('jobs', this)">▶ Aktionen</button>
        <button class="tab" onclick="showTab('audit', this)">🧾 Audit</button>
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
      const payload = await r.json().catch(() => null);
      if (!r.ok) throw new Error(payload?.error || ('HTTP ' + r.status));
      return payload;
    }

    let currentTab = 'bots';
    let cachedData = {};
    let stationFilters = { search: '', health: 'all', tier: 'all' };
    let operationFilters = { search: '', status: 'all', area: 'all' };
    let selectedLogFile = '';

    function showTab(tab, trigger) {
      currentTab = tab;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      if (trigger) trigger.classList.add('active');
      else {
        const index = ['bots','diagnostics','guilds','licenses','stations','logs','operations','config','jobs','audit'].indexOf(tab);
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
        if (!d.logs || !d.logFiles) { el.innerHTML = '<div class="loading">Lade Logs...</div>'; return; }
        el.innerHTML = renderLogs(d.logs, d.logFiles);
      } else if (tab === 'operations') {
        if (!d.operations) { el.innerHTML = '<div class="loading">Lade Betrieb...</div>'; return; }
        el.innerHTML = renderOperations(d.operations);
      } else if (tab === 'config') {
        if (!d.config) { el.innerHTML = '<div class="loading">Lade Einstellungen...</div>'; return; }
        el.innerHTML = renderConfig(d.config);
      } else if (tab === 'jobs') {
        if (!d.jobs) { el.innerHTML = '<div class="loading">Lade Aktionen...</div>'; return; }
        el.innerHTML = renderJobs(d.jobs);
      } else if (tab === 'audit') {
        if (!d.audit) { el.innerHTML = '<div class="loading">Lade Audit...</div>'; return; }
        el.innerHTML = renderAudit(d.audit);
      }
    }

    async function loadAll() {
      document.getElementById('serverTime').textContent = 'Lädt...';
      try {
        const [overview, guilds, licenses, stations, logs, logFiles, diagnostics, operations, config, legal, mail, jobs, audit] = await Promise.allSettled([
          api('overview'), api('guilds'), api('licenses'), api('stations'), api('logs'), api('log-files'), api('diagnostics'), api('operations'), api('config'), api('legal'), api('mail'), api('jobs'), api('audit')
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
        if (logFiles.status === 'fulfilled') cachedData.logFiles = logFiles.value;
        if (diagnostics.status === 'fulfilled') cachedData.diagnostics = diagnostics.value;
        if (operations.status === 'fulfilled') cachedData.operations = operations.value;
        if (config.status === 'fulfilled') cachedData.config = config.value;
        if (legal.status === 'fulfilled') cachedData.legal = legal.value;
        if (mail.status === 'fulfilled') cachedData.mail = mail.value;
        if (jobs.status === 'fulfilled') cachedData.jobs = jobs.value;
        if (audit.status === 'fulfilled') cachedData.audit = audit.value;
        renderTab(currentTab);
      } catch(e) {
        document.getElementById('content').innerHTML = '<div class="error-msg">Fehler: ' + esc(e.message) + '</div>';
      }
    }

    function renderLegalReadiness(payload) {
      if (!payload) return '<div class="config-group"><h3>Legal Readiness</h3><div class="loading">Lade Legal-Status...</div></div>';
      const sections = Array.isArray(payload.sections) ? payload.sections : [];
      const previewRows = [
        ['Anbieter', payload.preview?.legal?.providerName],
        ['Rechtsform', payload.preview?.legal?.legalForm],
        ['Adresse', payload.preview?.legal?.address],
        ['Legal E-Mail', payload.preview?.legal?.email],
        ['Webseite', payload.preview?.legal?.website],
        ['Datenschutz Kontakt', payload.preview?.privacy?.contactEmail],
        ['Hosting', payload.preview?.privacy?.hostingProvider],
        ['Terms Kontakt', payload.preview?.terms?.contactEmail],
        ['Terms URL', payload.preview?.terms?.website],
        ['Gueltig ab', payload.preview?.terms?.effectiveDate],
        ['Recht', payload.preview?.terms?.governingLaw],
      ].filter(row => String(row[1] || '').trim());
      return '<div class="config-group">' +
        '<h3>Legal Readiness</h3>' +
        '<p>Prueft die oeffentlichen Payloads fuer Impressum, Datenschutz und Terms gegen die aktuell geladenen Einstellungen.</p>' +
        '<div class="summary-row">' +
          summaryPill(payload.configured ? 'OK' : 'OFFEN', 'Gesamtstatus', payload.configured ? 'green' : 'amber') +
          sections.map(section => summaryPill(section.configured ? 'OK' : 'FEHLT', section.title || section.id, section.configured ? 'green' : 'red')).join('') +
        '</div>' +
        (sections.length ? '<table><thead><tr><th>Bereich</th><th>Route</th><th>Status</th><th>Fehlende Pflichtfelder</th></tr></thead><tbody>' +
          sections.map(section => '<tr>' +
            '<td><b>' + esc(section.title || section.id) + '</b></td>' +
            '<td><span class="cmd">' + esc(section.route || '-') + '</span></td>' +
            '<td>' + statusBadge(section.configured ? 'configured' : 'missing') + '</td>' +
            '<td style="font-size:12px;color:#71717a">' + esc((section.missingCoreFields || []).join(', ') || '-') + '</td>' +
          '</tr>').join('') + '</tbody></table>' : '') +
        (previewRows.length ? '<table style="margin-top:10px"><thead><tr><th>Vorschau</th><th>Wert</th></tr></thead><tbody>' +
          previewRows.map(row => '<tr><td style="color:#71717a">' + esc(row[0]) + '</td><td>' + esc(row[1]) + '</td></tr>').join('') +
          '</tbody></table>' : '<div class="empty-state">Noch keine Legal-Vorschauwerte gesetzt.</div>') +
      '</div>';
    }

    function renderConfig(payload) {
      const groups = Array.isArray(payload.groups) ? payload.groups : [];
      const secrets = Array.isArray(payload.secrets) ? payload.secrets : [];
      const configuredSecrets = secrets.filter(s => s.configured).length;
      const updated = Array.isArray(payload.updatedKeys) ? payload.updatedKeys : [];
      const mail = cachedData.mail || {};
      const legal = cachedData.legal || null;
      return '<div class="summary-row">' +
          summaryPill(payload.envFile?.writable ? 'OK' : 'FEHLT', '.env schreibbar', payload.envFile?.writable ? 'green' : 'red') +
          summaryPill(groups.reduce((sum, group) => sum + (group.fields?.length || 0), 0), 'Editierbare Werte', '') +
          summaryPill(configuredSecrets + '/' + secrets.length, 'Secrets gesetzt', configuredSecrets === secrets.length ? 'green' : 'amber') +
          summaryPill(payload.restartRequired ? 'JA' : 'NEIN', 'Neustart noetig', payload.restartRequired ? 'amber' : 'green') +
        '</div>' +
        '<div class="toolbar">' +
          '<span class="cmd">' + esc(payload.envFile?.path || '.env') + '</span>' +
          '<button class="btn btn-cyan" onclick="saveConfig()">Speichern</button>' +
          '<span id="configSaveStatus" class="config-status">' + (updated.length ? 'Gespeichert: ' + esc(updated.join(', ')) + ' - Container neu starten.' : 'Nur nicht geheime Werte sind editierbar.') + '</span>' +
        '</div>' +
        renderLegalReadiness(legal) +
        '<div class="config-group">' +
          '<h3>SMTP Test</h3>' +
          '<p>Sendet eine echte Testmail ueber die aktuell gesetzte SMTP-Konfiguration. Passwortwerte bleiben write-only.</p>' +
          '<div class="summary-row">' +
            summaryPill(mail.configured ? 'OK' : 'FEHLT', 'SMTP konfiguriert', mail.configured ? 'green' : 'red') +
            summaryPill(mail.host || '-', 'Host', mail.host ? 'green' : 'amber') +
            summaryPill(mail.defaultRecipientMasked || '-', 'Standard-Empfaenger', mail.defaultRecipient ? 'green' : 'amber') +
            summaryPill(mail.tlsMode || 'auto', 'TLS Modus', '') +
          '</div>' +
          '<div class="toolbar">' +
            '<input id="smtpTestRecipient" type="email" value="' + escAttr(mail.defaultRecipient || '') + '" placeholder="Empfaenger fuer Testmail"/>' +
            '<button class="btn btn-amber" onclick="sendSmtpTestMail()">Testmail senden</button>' +
            '<span id="smtpTestStatus" class="config-status">' + (mail.missing?.length ? 'Fehlt: ' + esc(mail.missing.join(', ')) : 'Bereit fuer SMTP-Test.') + '</span>' +
          '</div>' +
        '</div>' +
        groups.map(group => '<div class="config-group">' +
          '<h3>' + esc(group.title || group.id) + '</h3>' +
          '<p>' + esc(group.description || '') + '</p>' +
          '<div class="config-grid">' + (group.fields || []).map(renderConfigField).join('') + '</div>' +
        '</div>').join('') +
        '<div class="config-group">' +
          '<h3>Secrets</h3>' +
          '<p>Geheime Werte werden nie angezeigt. Leere Felder bleiben unveraendert; eingetragene Werte werden write-only gespeichert.</p>' +
          '<div class="toolbar">' +
            '<button class="btn btn-amber" onclick="saveSecrets()">Secrets speichern</button>' +
            '<span id="secretSaveStatus" class="config-status">Owner-Token und Bot-Token bleiben in diesem Schritt read-only.</span>' +
          '</div>' +
          '<table><thead><tr><th>Bereich</th><th>Name</th><th>Status</th><th>Quelle</th></tr></thead><tbody>' +
          secrets.map(secret => '<tr><td style="color:#71717a">' + esc(secret.group || '-') + '</td><td><b>' + esc(secret.label || secret.key) + '</b><div style="font-size:11px;color:#52525b">' + esc(secret.key) + '</div>' + (secret.writeOnly ? '<input data-secret-key="' + escAttr(secret.key) + '" type="password" autocomplete="new-password" placeholder="Neuen Wert setzen..." style="margin-top:7px;width:100%;background:#111;border:1px solid #333;color:#e4e4e7;border-radius:7px;padding:8px;font-size:12px"/>' : '<div style="font-size:11px;color:#71717a;margin-top:7px">Read-only Status</div>') + '</td><td>' + statusBadge(secret.configured ? 'configured' : 'missing') + '</td><td style="font-size:12px;color:#71717a">' + esc(secret.source || '-') + '</td></tr>').join('') +
          '</tbody></table>' +
        '</div>';
    }

    function renderConfigField(field) {
      const value = field.value == null ? '' : String(field.value);
      const source = field.source ? ' · ' + field.source : '';
      const keyAttr = escAttr(field.key);
      const label = '<label><span>' + esc(field.label || field.key) + '</span><code>' + esc(field.key) + source + '</code></label>';
      if (field.type === 'boolean') {
        return '<div class="config-field">' + label +
          '<select data-config-key="' + keyAttr + '">' +
            option('', 'Nicht gesetzt', value) +
            option('1', 'Aktiv', value) +
            option('0', 'Aus', value) +
          '</select></div>';
      }
      if (field.type === 'enum' && Array.isArray(field.values)) {
        return '<div class="config-field">' + label +
          '<select data-config-key="' + keyAttr + '">' +
            field.values.map(v => option(v, v, value)).join('') +
          '</select></div>';
      }
      const inputType = field.type === 'integer' ? 'number' : field.type === 'email' ? 'email' : field.type === 'date' ? 'date' : field.type === 'url' ? 'url' : 'text';
      const attrs = [
        'data-config-key="' + keyAttr + '"',
        'type="' + inputType + '"',
        'value="' + escAttr(value) + '"',
        field.example ? 'placeholder="' + escAttr(field.example) + '"' : '',
        field.min != null ? 'min="' + escAttr(field.min) + '"' : '',
        field.max != null ? 'max="' + escAttr(field.max) + '"' : '',
      ].filter(Boolean).join(' ');
      return '<div class="config-field">' + label + '<input ' + attrs + '/></div>';
    }

    function renderLogs(logsPayload, filesPayload) {
      const incidents = Array.isArray(logsPayload.incidents) ? logsPayload.incidents : [];
      const files = Array.isArray(filesPayload.files) ? filesPayload.files : [];
      if (!selectedLogFile && files.length) selectedLogFile = files[0].name;
      const currentFile = cachedData.currentLogFile;
      return '<div class="summary-row">' +
          summaryPill(incidents.length, 'Operator Incidents', incidents.some(i => String(i.level || '').toUpperCase() === 'ERROR') ? 'amber' : 'green') +
          summaryPill(files.length, 'Logdateien', files.length ? 'green' : 'amber') +
          summaryPill(filesPayload.logsDir ? 'OK' : 'FEHLT', 'Log-Ordner', filesPayload.logsDir ? 'green' : 'red') +
          summaryPill(currentFile?.truncated ? 'TAIL' : 'VOLL', 'Anzeige', currentFile?.truncated ? 'amber' : 'green') +
        '</div>' +
        '<div class="section-header"><h2>Operator Incidents</h2><span style="font-size:12px;color:#71717a">strukturierte Fehlerereignisse</span></div>' +
        (incidents.length
          ? '<table><thead><tr><th>Zeit</th><th>Level</th><th>Nachricht</th></tr></thead><tbody>' +
            incidents.slice(0,100).map(i => '<tr>' +
              '<td style="font-size:11px;color:#71717a;white-space:nowrap">' + esc(i.timestamp||i.time||'') + '</td>' +
              '<td><span style="color:' + levelColor(i.level) + ';font-size:11px;font-weight:700">' + esc(i.level||'INFO') + '</span></td>' +
              '<td style="font-size:12px;max-width:600px;overflow:hidden;text-overflow:ellipsis">' + esc(String(i.message||i.msg||'')) + '</td>' +
            '</tr>').join('') + '</tbody></table>'
          : '<div class="empty-state">Keine Operator-Incidents.</div>') +
        '<div class="section-header"><h2>Lokale Logdateien</h2><button class="mini-btn" onclick="refreshSelectedLogFile()">Tail aktualisieren</button></div>' +
        '<div class="toolbar">' +
          '<select id="ownerLogFileSelect" onchange="selectOwnerLogFile(this.value)">' +
            files.map(file => option(file.name, file.name + ' · ' + formatBytes(file.size), selectedLogFile)).join('') +
          '</select>' +
          '<span class="cmd">' + esc(filesPayload.logsDir || 'logs') + '</span>' +
        '</div>' +
        renderCurrentLogFile(currentFile, files);
    }

    function renderCurrentLogFile(currentFile, files) {
      if (!files.length) return '<div class="empty-state">Keine erlaubten Logdateien gefunden.</div>';
      if (!currentFile || currentFile.name !== selectedLogFile) {
        setTimeout(refreshSelectedLogFile, 0);
        return '<div class="loading">Lade Log-Tail...</div>';
      }
      const rows = Array.isArray(currentFile.lines) ? currentFile.lines : [];
      return '<div class="toolbar">' +
          '<span class="cmd">' + esc(currentFile.name) + '</span>' +
          '<span style="font-size:12px;color:#71717a">Groesse ' + esc(formatBytes(currentFile.size)) + ' · geaendert ' + esc(formatDateTime(currentFile.modifiedAt)) + '</span>' +
        '</div>' +
        (rows.length
          ? '<table><thead><tr><th>Zeit</th><th>Level</th><th>Nachricht</th></tr></thead><tbody>' +
            rows.map(row => '<tr>' +
              '<td style="font-size:11px;color:#71717a;white-space:nowrap">' + esc(row.timestamp || '-') + '</td>' +
              '<td><span style="color:' + levelColor(row.level) + ';font-size:11px;font-weight:700">' + esc(row.level || 'INFO') + '</span></td>' +
              '<td style="font-size:12px;font-family:Consolas,monospace;white-space:pre-wrap">' + esc(row.message || '') + '</td>' +
            '</tr>').join('') + '</tbody></table>'
          : '<div class="empty-state">Diese Logdatei enthaelt keine Zeilen.</div>');
    }

    async function selectOwnerLogFile(name) {
      selectedLogFile = String(name || '');
      cachedData.currentLogFile = null;
      renderTab('logs');
      await refreshSelectedLogFile();
    }

    async function refreshSelectedLogFile() {
      if (!selectedLogFile) return;
      try {
        cachedData.currentLogFile = await api('log-files/' + encodeURIComponent(selectedLogFile));
      } catch (e) {
        cachedData.currentLogFile = { name: selectedLogFile, lines: [{ level: 'ERROR', message: e.message }] };
      }
      if (currentTab === 'logs') renderTab('logs');
    }

    async function saveConfig() {
      const status = document.getElementById('configSaveStatus');
      const values = {};
      document.querySelectorAll('[data-config-key]').forEach((input) => {
        values[input.getAttribute('data-config-key')] = input.value;
      });
      if (status) {
        status.textContent = 'Speichere...';
        status.style.color = '#71717a';
      }
      try {
        const result = await apiPost('config', { values });
        cachedData.config = result;
        cachedData.legal = await api('legal').catch(() => cachedData.legal);
        if (status) {
          status.textContent = 'Gespeichert. Container/Service danach neu starten, damit alle Bereiche die Werte sicher uebernehmen.';
          status.style.color = '#39FF14';
        }
        renderTab('config');
      } catch (e) {
        if (status) {
          status.textContent = 'Fehler: ' + e.message;
          status.style.color = '#FF2A2A';
        }
      }
    }

    async function saveSecrets() {
      const status = document.getElementById('secretSaveStatus');
      const values = {};
      document.querySelectorAll('[data-secret-key]').forEach((input) => {
        if (String(input.value || '').trim()) values[input.getAttribute('data-secret-key')] = input.value;
      });
      if (!Object.keys(values).length) {
        if (status) {
          status.textContent = 'Keine neuen Secret-Werte eingetragen.';
          status.style.color = '#FFB800';
        }
        return;
      }
      if (!confirm('Secrets write-only speichern? Bestehende leere Felder bleiben unveraendert.')) return;
      if (status) {
        status.textContent = 'Speichere Secrets...';
        status.style.color = '#71717a';
      }
      try {
        const result = await apiPost('config/secrets', { values });
        cachedData.config = result;
        if (status) {
          status.textContent = 'Secrets gespeichert. Container/Service danach neu starten, damit alle Bereiche die Werte sicher uebernehmen.';
          status.style.color = '#39FF14';
        }
        renderTab('config');
      } catch (e) {
        if (status) {
          status.textContent = 'Fehler: ' + e.message;
          status.style.color = '#FF2A2A';
        }
      }
    }

    async function sendSmtpTestMail() {
      const status = document.getElementById('smtpTestStatus');
      const input = document.getElementById('smtpTestRecipient');
      const to = String(input?.value || '').trim();
      const confirmationValue = cachedData.mail?.confirmationValue || 'send-test-email';
      const typed = prompt('SMTP-Testmail wirklich senden? Tippe exakt: ' + confirmationValue);
      if (typed == null) return;
      if (status) {
        status.textContent = 'Sende Testmail...';
        status.style.color = '#71717a';
      }
      try {
        const result = await apiPost('mail/test', { to, confirm: typed.trim() });
        cachedData.mail = await api('mail');
        if (status) {
          status.textContent = 'Testmail gesendet an ' + (result.toMasked || result.to || to);
          status.style.color = '#39FF14';
        }
      } catch (e) {
        if (status) {
          status.textContent = 'Fehler: ' + e.message;
          status.style.color = '#FF2A2A';
        }
      }
    }

    function renderAudit(payload) {
      const events = Array.isArray(payload.events) ? payload.events : [];
      return '<div class="summary-row">' +
          summaryPill(payload.total || events.length, 'Audit Events', '') +
          summaryPill(events.filter(e => e.status === 'failed' || e.status === 'denied').length, 'Fehler/Denied', events.some(e => e.status === 'failed' || e.status === 'denied') ? 'amber' : 'green') +
          summaryPill(events.length, 'Angezeigt', '') +
          summaryPill(payload.file ? 'OK' : 'FEHLT', 'Audit-Datei', payload.file ? 'green' : 'red') +
        '</div>' +
        (events.length
          ? '<table><thead><tr><th>Zeit</th><th>Status</th><th>Aktion</th><th>Ziel</th><th>Zusammenfassung</th><th>Meta</th></tr></thead><tbody>' +
            events.map(event => '<tr>' +
              '<td style="font-size:11px;color:#71717a;white-space:nowrap">' + esc(formatDateTime(event.timestamp)) + '</td>' +
              '<td>' + auditStatusBadge(event.status) + '</td>' +
              '<td><b>' + esc(event.action || '-') + '</b><div style="font-size:11px;color:#52525b">' + esc(event.actor || 'owner') + '</div></td>' +
              '<td style="font-size:12px;color:#71717a">' + esc(event.target || '-') + '</td>' +
              '<td style="font-size:12px;max-width:380px">' + esc(event.summary || '-') + '</td>' +
              '<td><span class="cmd">' + esc(compactJson(event.metadata || {})) + '</span></td>' +
            '</tr>').join('') + '</tbody></table>'
          : '<div class="empty-state">Noch keine Owner-Audit-Events.</div>');
    }

    function renderJobInputs(action) {
      const fields = Array.isArray(action.inputFields) ? action.inputFields : [];
      if (!fields.length) return '';
      return '<div class="job-inputs">' + fields.map(field => {
        const type = field.type === 'url' ? 'url' : field.type === 'email' ? 'email' : field.type === 'integer' ? 'number' : 'text';
        return '<label>' +
          '<span>' + esc(field.label || field.key) + '</span>' +
          '<input data-job-action="' + escAttr(action.id) + '" data-job-input-key="' + escAttr(field.key) + '" type="' + type + '"' +
            (field.required ? ' required' : '') +
            (field.placeholder ? ' placeholder="' + escAttr(field.placeholder) + '"' : '') +
          '/>' +
        '</label>';
      }).join('') + '</div>';
    }

    function renderJobs(payload) {
      const actions = Array.isArray(payload.actions) ? payload.actions : [];
      const jobs = Array.isArray(payload.jobs) ? payload.jobs : [];
      const running = jobs.find(job => job.status === 'running');
      return '<div class="summary-row">' +
          summaryPill(actions.length, 'Erlaubte Aktionen', '') +
          summaryPill(payload.running ? 'JA' : 'NEIN', 'Job laeuft', payload.running ? 'amber' : 'green') +
          summaryPill(jobs.length, 'Letzte Jobs', '') +
        '</div>' +
        '<div class="job-grid">' +
          actions.map(action => '<div class="job-card">' +
            '<h3>' + esc(action.title || action.id) + '</h3>' +
            '<p>' + esc(action.description || '') + '</p>' +
            renderJobInputs(action) +
            '<div style="display:flex;gap:8px;align-items:center;justify-content:space-between">' +
              riskBadge(action.risk) +
              '<button class="btn btn-cyan" style="font-size:11px;padding:6px 10px" ' + (payload.running ? 'disabled' : '') + ' onclick="startOwnerJob(' + JSON.stringify(action.id) + ',' + JSON.stringify(Boolean(action.requiresConfirmation)) + ',' + JSON.stringify(action.confirmationValue || '') + ')">Starten</button>' +
            '</div>' +
            '<div style="margin-top:8px"><span class="cmd">' + esc(action.command || '') + '</span></div>' +
          '</div>').join('') +
        '</div>' +
        '<div class="section-header"><h2>Job-Ausgabe</h2><button class="mini-btn" onclick="refreshJobs()">Aktualisieren</button></div>' +
        (jobs.length
          ? '<table><thead><tr><th>Aktion</th><th>Status</th><th>Start</th><th>Dauer</th><th>Exit</th></tr></thead><tbody>' +
            jobs.slice(0, 10).map(job => '<tr onclick="selectOwnerJob(' + JSON.stringify(job.id) + ')" style="cursor:pointer">' +
              '<td><b>' + esc(job.title || job.actionId) + '</b><div style="font-size:11px;color:#52525b">' + esc(job.id) + '</div></td>' +
              '<td>' + jobStatusBadge(job.status) + '</td>' +
              '<td style="font-size:12px;color:#71717a">' + esc(formatDateTime(job.startedAt)) + '</td>' +
              '<td style="font-size:12px;color:#71717a">' + (job.durationMs != null ? Math.round(job.durationMs / 1000) + 's' : 'laeuft') + '</td>' +
              '<td style="font-size:12px;color:#71717a">' + (job.exitCode == null ? '-' : esc(job.exitCode)) + '</td>' +
            '</tr>').join('') + '</tbody></table>' +
            '<pre class="job-output" id="jobOutput">' + esc((running || jobs[0])?.output || 'Noch keine Ausgabe.') + '</pre>'
          : '<div class="empty-state">Noch keine Owner-Jobs gestartet.</div>');
    }

    async function refreshJobs() {
      try {
        cachedData.jobs = await api('jobs');
        renderTab('jobs');
        if (cachedData.jobs?.running) setTimeout(refreshJobs, 2500);
      } catch (e) {
        document.getElementById('content').innerHTML = '<div class="error-msg">Fehler: ' + esc(e.message) + '</div>';
      }
    }

    async function startOwnerJob(actionId, requiresConfirmation, confirmationValue) {
      let confirmValue = '';
      const input = {};
      let missingInput = '';
      document.querySelectorAll('[data-job-action]').forEach((field) => {
        if (field.getAttribute('data-job-action') !== actionId) return;
        const key = field.getAttribute('data-job-input-key');
        const value = String(field.value || '').trim();
        if (field.required && !value) missingInput = key || 'Eingabe';
        if (key) input[key] = value;
      });
      if (missingInput) {
        alert('Pflichtfeld fehlt: ' + missingInput);
        return;
      }
      if (requiresConfirmation) {
        const typed = prompt('Diese Owner-Aktion braucht eine Bestätigung. Tippe exakt: ' + confirmationValue);
        if (typed == null) return;
        confirmValue = typed.trim();
      } else if (!confirm('Owner-Aktion starten? Es kann immer nur ein Job gleichzeitig laufen.')) {
        return;
      }
      try {
        await apiPost('jobs', { actionId, confirm: confirmValue, input });
        await refreshJobs();
      } catch (e) {
        alert('Job konnte nicht gestartet werden: ' + e.message);
      }
    }

    async function selectOwnerJob(jobId) {
      try {
        const result = await api('jobs/' + encodeURIComponent(jobId));
        const output = document.getElementById('jobOutput');
        if (output) output.textContent = result.job?.output || 'Keine Ausgabe.';
      } catch (e) {
        alert('Job konnte nicht geladen werden: ' + e.message);
      }
    }

    function jobStatusBadge(status) {
      if (status === 'succeeded') return '<span class="badge-up">OK</span>';
      if (status === 'running') return '<span class="badge-unknown">LAEUFT</span>';
      return '<span class="badge-down">FEHLER</span>';
    }

    function auditStatusBadge(status) {
      if (status === 'success') return '<span class="badge-up">OK</span>';
      if (status === 'failed' || status === 'denied') return '<span class="badge-down">FEHLER</span>';
      return '<span class="badge-unknown">INFO</span>';
    }

    function compactJson(value) {
      try {
        const text = JSON.stringify(value || {});
        return text.length > 160 ? text.slice(0, 157) + '...' : text;
      } catch {
        return '{}';
      }
    }

    function formatDateTime(value) {
      if (!value) return '-';
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) return value;
      return date.toLocaleString('de-AT');
    }

    function formatBytes(value) {
      const bytes = Number(value || 0) || 0;
      if (bytes < 1024) return bytes + ' B';
      if (bytes < 1024 * 1024) return Math.round(bytes / 1024) + ' KB';
      return (bytes / 1024 / 1024).toFixed(1) + ' MB';
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
