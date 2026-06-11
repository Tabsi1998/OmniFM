import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { startWebServer } from "../src/api/server.js";
import {
  buildPageHref,
  getCanonicalPagePath,
  resolvePageFromUrl,
} from "../frontend/src/lib/pageRouting.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const frontendBuildDir = path.join(repoRoot, "frontend", "build");
const frontendIndexPath = path.join(frontendBuildDir, "index.html");
const frontendRobotsPath = path.join(frontendBuildDir, "robots.txt");
const frontendSitemapPath = path.join(frontendBuildDir, "sitemap.xml");
const frontendManifestPath = path.join(frontendBuildDir, "manifest.json");
const frontendBotIconDir = path.join(frontendBuildDir, "img");
const frontendBotIconPath = path.join(frontendBotIconDir, "bot-1.png");

async function snapshotFile(filePath) {
  try {
    return {
      exists: true,
      content: await fs.readFile(filePath),
    };
  } catch {
    return { exists: false, content: null };
  }
}

async function restoreFile(filePath, snapshot) {
  if (snapshot?.exists) {
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, snapshot.content);
    return;
  }
  await fs.rm(filePath, { force: true });
}

function setEnv(overrides) {
  const previous = new Map();
  for (const [key, value] of Object.entries(overrides)) {
    previous.set(key, process.env[key]);
    if (value === undefined || value === null) {
      delete process.env[key];
    } else {
      process.env[key] = String(value);
    }
  }
  return () => {
    for (const [key, value] of previous.entries()) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
}

function createAdminRuntimeStub() {
  const guilds = new Map([[
    "123456789012345678",
    { id: "123456789012345678", name: "Admin Test Guild", memberCount: 42 },
  ]]);

  return {
    role: "commander",
    startedAt: Date.now() - 10_000,
    config: { name: "OmniFM Admin Test" },
    client: {
      isReady: () => true,
      guilds: { cache: guilds },
    },
    collectStats: () => ({
      servers: 1,
      connections: 2,
      listeners: 3,
    }),
    getState: () => ({
      playing: true,
      currentStationKey: "rock",
      volume: 70,
    }),
  };
}

function assertCommonSecurityHeaders(headers, { expectGoogleAssets = false } = {}) {
  assert.equal(headers.get("x-content-type-options"), "nosniff");
  assert.equal(headers.get("x-frame-options"), "DENY");
  assert.equal(headers.get("referrer-policy"), "no-referrer");
  assert.equal(headers.get("x-permitted-cross-domain-policies"), "none");
  assert.match(headers.get("permissions-policy") || "", /camera=\(\).*microphone=\(\)/i);

  const csp = headers.get("content-security-policy") || "";
  assert.match(csp, /default-src 'self'/);
  assert.match(csp, /object-src 'none'/);
  assert.match(csp, /frame-ancestors 'none'/);
  if (expectGoogleAssets) {
    assert.match(csp, /googletagmanager\.com/i);
    assert.match(csp, /google-analytics\.com/i);
    assert.match(csp, /fonts\.googleapis\.com/i);
  }
}

test("pageRouting resolves aliases and localized legal paths", () => {
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/?page=imprint"), "imprint");
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/?page=terms"), "terms");
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/nutzungsbedingungen?lang=de"), "terms");
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/terms-of-service"), "terms");
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/stations?lang=de"), "stations");
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/premium"), "premium");
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/pricing"), "premium");
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/faq"), "faq");
  assert.equal(getCanonicalPagePath("terms", "de"), "/nutzungsbedingungen");
  assert.equal(getCanonicalPagePath("stations", "de"), "/stations");
  assert.equal(getCanonicalPagePath("premium", "en"), "/premium");
  assert.equal(getCanonicalPagePath("faq", "de"), "/faq");
  assert.equal(buildPageHref("de", "terms"), "/nutzungsbedingungen?lang=de");
  assert.equal(buildPageHref("de", "stations"), "/stations?lang=de");
  assert.equal(buildPageHref("en", "premium"), "/premium?lang=en");
  assert.equal(buildPageHref("en", "privacy"), "/privacy?lang=en");
});

test("startWebServer serves SPA entry for clean legal paths and exposes terms payload", async () => {
  const ownerEnvDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-admin-config-"));
  const ownerEnvFile = path.join(ownerEnvDir, ".env");
  const ownerAuditFile = path.join(ownerEnvDir, "owner-audit.json");
  const ownerLogsDir = path.join(ownerEnvDir, "logs");
  await fs.writeFile(
    ownerEnvFile,
    "PUBLIC_WEB_URL=https://omnifm.xyz\nAPI_ADMIN_TOKEN=admin-route-token\nLOG_MAX_MB=5\n",
    "utf8"
  );
  await fs.mkdir(ownerLogsDir, { recursive: true });
  await fs.writeFile(
    path.join(ownerLogsDir, "bot.log"),
    "[2026-06-11T06:00:00.000Z] [INFO] owner test token=must-not-leak\n",
    "utf8"
  );
  const restoreEnv = setEnv({
    WEB_INTERNAL_PORT: "0",
    WEB_PORT: "0",
    WEB_BIND: "127.0.0.1",
    PUBLIC_WEB_URL: "http://127.0.0.1",
    CORS_ALLOWED_ORIGINS: "",
    CORS_ORIGINS: "",
    WEB_DOMAIN: "",
    API_ADMIN_TOKEN: "admin-route-token",
    LEGAL_PRODUCT_NAME: "OmniFM",
    LEGAL_PROVIDER_NAME: "IT-Tabelander",
    LEGAL_LEGAL_FORM: "Kleinunternehmen",
    LEGAL_STREET_ADDRESS: "Tabelander Street 1",
    LEGAL_POSTAL_CODE: "1010",
    LEGAL_CITY: "Vienna",
    LEGAL_EMAIL: "legal@it-tabelander.at",
    LEGAL_WEBSITE: "https://omnifm.xyz",
    PRIVACY_CONTACT_EMAIL: "privacy@it-tabelander.at",
    TERMS_CONTACT_EMAIL: "terms@it-tabelander.at",
    TERMS_SUPPORT_URL: "https://omnifm.xyz/terms",
    TERMS_EFFECTIVE_DATE: "2026-03-11",
    TERMS_GOVERNING_LAW: "Law of the Republic of Austria",
    OMNIFM_RELEASE_SHA: "abcdef1234567890",
    OMNIFM_RELEASE_BRANCH: "main",
    OMNIFM_DEPLOYED_AT: "2026-06-10T18:00:00.000Z",
    OMNIFM_LAST_DEPLOY_STATUS: "success",
    OMNIFM_LAST_LIVE_SMOKE_STATUS: "success",
    OMNIFM_ENV_FILE: ownerEnvFile,
    OMNIFM_OWNER_AUDIT_FILE: ownerAuditFile,
    OMNIFM_OWNER_LOGS_DIR: ownerLogsDir,
    STRIPE_SECRET_KEY: undefined,
    SMTP_PASS: undefined,
    ADMIN_EMAIL: "owner@it-tabelander.at",
    DISCORD_CLIENT_SECRET: undefined,
  });
  const indexSnapshot = await snapshotFile(frontendIndexPath);
  const robotsSnapshot = await snapshotFile(frontendRobotsPath);
  const sitemapSnapshot = await snapshotFile(frontendSitemapPath);
  const manifestSnapshot = await snapshotFile(frontendManifestPath);
  const botIconSnapshot = await snapshotFile(frontendBotIconPath);
  await fs.mkdir(frontendBuildDir, { recursive: true });
  await fs.writeFile(
    frontendIndexPath,
    "<!doctype html><html><body>legal-routing-marker</body></html>",
    "utf8"
  );
  await fs.writeFile(frontendRobotsPath, "User-agent: *\nSitemap: https://omnifm.xyz/sitemap.xml\n", "utf8");
  await fs.writeFile(frontendSitemapPath, "<?xml version=\"1.0\"?><urlset><url><loc>https://omnifm.xyz/</loc></url></urlset>", "utf8");
  await fs.writeFile(frontendManifestPath, JSON.stringify({ name: "OmniFM", start_url: "/" }), "utf8");
  await fs.mkdir(frontendBotIconDir, { recursive: true });
  await fs.writeFile(frontendBotIconPath, Buffer.from([0x89, 0x50, 0x4e, 0x47]));

  const server = startWebServer([createAdminRuntimeStub()]);
  await once(server, "listening");
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;

  try {
    const termsPageResponse = await fetch(`http://127.0.0.1:${port}/nutzungsbedingungen?lang=de`);
    assert.equal(termsPageResponse.status, 200);
    assertCommonSecurityHeaders(termsPageResponse.headers, { expectGoogleAssets: true });
    assert.match(await termsPageResponse.text(), /legal-routing-marker/);

    const dashboardPageResponse = await fetch(`http://127.0.0.1:${port}/dashboard`);
    assert.equal(dashboardPageResponse.status, 200);
    assert.match(await dashboardPageResponse.text(), /legal-routing-marker/);

    const stationsPageResponse = await fetch(`http://127.0.0.1:${port}/stations?lang=de`);
    assert.equal(stationsPageResponse.status, 200);
    assert.match(await stationsPageResponse.text(), /legal-routing-marker/);

    const premiumPageResponse = await fetch(`http://127.0.0.1:${port}/premium?lang=en`);
    assert.equal(premiumPageResponse.status, 200);
    assert.match(await premiumPageResponse.text(), /legal-routing-marker/);

    const faqPageResponse = await fetch(`http://127.0.0.1:${port}/faq`);
    assert.equal(faqPageResponse.status, 200);
    assert.match(await faqPageResponse.text(), /legal-routing-marker/);

    const robotsResponse = await fetch(`http://127.0.0.1:${port}/robots.txt`);
    assert.equal(robotsResponse.status, 200);
    assertCommonSecurityHeaders(robotsResponse.headers);
    assert.match(robotsResponse.headers.get("content-type") || "", /text\/plain/i);
    assert.match(await robotsResponse.text(), /Sitemap: https:\/\/omnifm\.xyz\/sitemap\.xml/);

    const sitemapResponse = await fetch(`http://127.0.0.1:${port}/sitemap.xml`);
    assert.equal(sitemapResponse.status, 200);
    assert.match(sitemapResponse.headers.get("content-type") || "", /application\/xml/i);
    assert.match(await sitemapResponse.text(), /https:\/\/omnifm\.xyz\//);

    const manifestResponse = await fetch(`http://127.0.0.1:${port}/manifest.json`);
    assert.equal(manifestResponse.status, 200);
    assert.equal((await manifestResponse.json()).name, "OmniFM");

    const faviconResponse = await fetch(`http://127.0.0.1:${port}/favicon.ico`);
    assert.equal(faviconResponse.status, 200);
    assert.match(faviconResponse.headers.get("content-type") || "", /image\/png/i);

    const notFoundPageResponse = await fetch(`http://127.0.0.1:${port}/definitely-missing-page`);
    assert.equal(notFoundPageResponse.status, 404);
    assert.match(await notFoundPageResponse.text(), /404/);

    const adminLoginResponse = await fetch(`http://127.0.0.1:${port}/admin`);
    assert.equal(adminLoginResponse.status, 200);
    assertCommonSecurityHeaders(adminLoginResponse.headers);
    const adminLoginHtml = await adminLoginResponse.text();
    assert.match(adminLoginHtml, /OMNIFM OWNER LOGIN/);
    assert.match(adminLoginHtml, /adminTokenInput/);

    const adminOverviewUnauthorizedResponse = await fetch(`http://127.0.0.1:${port}/api/admin/overview`);
    assert.equal(adminOverviewUnauthorizedResponse.status, 401);

    const invalidAdminSessionResponse = await fetch(`http://127.0.0.1:${port}/api/admin/session`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: "wrong-token" }).toString(),
      redirect: "manual",
    });
    assert.equal(invalidAdminSessionResponse.status, 401);

    const adminSessionResponse = await fetch(`http://127.0.0.1:${port}/api/admin/session`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token: "admin-route-token" }).toString(),
      redirect: "manual",
    });
    assert.equal(adminSessionResponse.status, 303);
    assert.equal(adminSessionResponse.headers.get("location"), "/admin");
    const adminCookie = adminSessionResponse.headers.get("set-cookie") || "";
    assert.match(adminCookie, /omnifm_owner=admin-route-token/);
    assert.match(adminCookie, /HttpOnly/);
    assert.match(adminCookie, /SameSite=Strict/);
    const adminCookieHeader = adminCookie.split(";")[0];

    const proxiedAdminSessionResponse = await fetch(`http://127.0.0.1:${port}/api/admin/session`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://omnifm.xyz",
      },
      body: new URLSearchParams({ token: "admin-route-token" }).toString(),
      redirect: "manual",
    });
    assert.equal(proxiedAdminSessionResponse.status, 303);
    assert.equal(proxiedAdminSessionResponse.headers.get("location"), "/admin");

    const adminPanelResponse = await fetch(`http://127.0.0.1:${port}/admin`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminPanelResponse.status, 200);
    assertCommonSecurityHeaders(adminPanelResponse.headers);
    const adminPanelHtml = await adminPanelResponse.text();
    assert.match(adminPanelHtml, /OMNIFM ADMIN/);
    assert.match(adminPanelHtml, /stationSearch/);
    assert.match(adminPanelHtml, /copyText/);
    assert.match(adminPanelHtml, /statRelease/);
    assert.match(adminPanelHtml, /Diagnose/);
    assert.match(adminPanelHtml, /Betrieb/);
    assert.match(adminPanelHtml, /Einstellungen/);
    assert.match(adminPanelHtml, /Aktionen/);
    assert.match(adminPanelHtml, /Audit/);
    assert.match(adminPanelHtml, /renderOperations/);
    assert.match(adminPanelHtml, /renderConfig/);
    assert.match(adminPanelHtml, /renderLegalReadiness/);
    assert.match(adminPanelHtml, /saveSecrets/);
    assert.match(adminPanelHtml, /sendSmtpTestMail/);
    assert.match(adminPanelHtml, /renderJobs/);
    assert.match(adminPanelHtml, /renderAudit/);
    assert.match(adminPanelHtml, /renderLogs/);
    assert.match(adminPanelHtml, /stationRoleBadge/);
    assert.match(adminPanelHtml, /testStationStream/);

    const adminOverviewResponse = await fetch(`http://127.0.0.1:${port}/api/admin/overview`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminOverviewResponse.status, 200);
    const adminOverview = await adminOverviewResponse.json();
    assert.equal(adminOverview.bots.length, 1);
    assert.equal(adminOverview.bots[0].guilds, 1);
    assert.ok(adminOverview.stations.total > 0);
    assert.equal(adminOverview.release?.appVersion, "3.0.0");
    assert.equal(adminOverview.release?.commit, "abcdef123456");
    assert.equal(adminOverview.release?.branch, "main");
    assert.equal(adminOverview.release?.lastDeployStatus, "success");
    assert.equal(adminOverview.release?.lastLiveSmokeStatus, "success");

    const adminDiagnosticsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/diagnostics`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminDiagnosticsResponse.status, 200);
    const adminDiagnostics = await adminDiagnosticsResponse.json();
    assert.equal(adminDiagnostics.runtime.bots.total, 1);
    assert.equal(adminDiagnostics.runtime.bots.online, 1);
    assert.equal(adminDiagnostics.infrastructure.adminToken.configured, true);
    assert.equal(typeof adminDiagnostics.infrastructure.mongo.configured, "boolean");
    assert.equal(adminDiagnostics.release?.appVersion, "3.0.0");
    assert.ok(adminDiagnostics.stations.total > 0);
    assert.ok(Array.isArray(adminDiagnostics.alerts));

    const adminStationsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/stations`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminStationsResponse.status, 200);
    const adminStations = await adminStationsResponse.json();
    assert.ok(adminStations.total > 0);
    assert.ok(Array.isArray(adminStations.stations));
    assert.equal(typeof adminStations.locked, "boolean");
    assert.equal(typeof adminStations.qualityPreset, "string");
    assert.ok(Array.isArray(adminStations.fallbackKeys));
    assert.equal(typeof adminStations.tierSummary.free, "number");
    assert.ok(adminStations.stations.some((station) => Object.hasOwn(station, "isDefault")));
    if (adminStations.defaultStationKey) {
      assert.ok(adminStations.stations.some((station) => station.key === adminStations.defaultStationKey && station.isDefault));
    }

    const missingStationTestResponse = await fetch(`http://127.0.0.1:${port}/api/admin/stations/not-existing/test`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    assert.equal(missingStationTestResponse.status, 404);
    const missingStationTest = await missingStationTestResponse.json();
    assert.match(missingStationTest.error, /Station nicht gefunden/);

    const adminOperationsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/operations`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminOperationsResponse.status, 200);
    const adminOperations = await adminOperationsResponse.json();
    assert.equal(adminOperations.source, "update.sh");
    assert.ok(adminOperations.total >= 20);
    assert.ok(Array.isArray(adminOperations.operations));
    assert.ok(adminOperations.operations.some((operation) => operation.cli === "./update.sh --update"));
    assert.ok(adminOperations.operations.some((operation) => operation.cli === "./update.sh --settings admin"));
    assert.ok(adminOperations.operations.some((operation) => operation.cli === "./update.sh --recognition-test <URL>"));
    assert.ok(adminOperations.operations.some((operation) => (
      operation.id === "settings-commands" && operation.webStatus === "available"
    )));
    assert.ok(adminOperations.operations.some((operation) => (
      operation.id === "settings-legal" && operation.webStatus === "available"
    )));
    assert.ok(adminOperations.operations.some((operation) => (
      operation.id === "recognition-test" && operation.webStatus === "available"
    )));
    assert.ok(adminOperations.operations.some((operation) => (
      operation.id === "status"
      && operation.webStatus === "available"
      && operation.cli.includes("containers")
      && operation.cli.includes("storage")
    )));
    assert.ok(adminOperations.operations.some((operation) => (
      operation.id === "bot-roles"
      && operation.webStatus === "available"
      && operation.cli === "./update.sh --show-roles"
    )));
    assert.ok(adminOperations.summary.available >= 1);
    assert.ok(adminOperations.summary.planned >= 1);

    const adminLogFilesResponse = await fetch(`http://127.0.0.1:${port}/api/admin/log-files`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminLogFilesResponse.status, 200);
    const adminLogFiles = await adminLogFilesResponse.json();
    assert.equal(adminLogFiles.logsDir, ownerLogsDir);
    assert.ok(adminLogFiles.files.some((file) => file.name === "bot.log"));

    const adminLogFileResponse = await fetch(`http://127.0.0.1:${port}/api/admin/log-files/bot.log`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminLogFileResponse.status, 200);
    const adminLogFile = await adminLogFileResponse.json();
    assert.equal(adminLogFile.name, "bot.log");
    assert.ok(adminLogFile.lines.some((line) => /owner test/.test(line.message)));
    assert.doesNotMatch(JSON.stringify(adminLogFile), /must-not-leak/);

    const invalidAdminLogFileResponse = await fetch(`http://127.0.0.1:${port}/api/admin/log-files/..%2F.env`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(invalidAdminLogFileResponse.status, 404);

    const adminConfigResponse = await fetch(`http://127.0.0.1:${port}/api/admin/config`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminConfigResponse.status, 200);
    const adminConfig = await adminConfigResponse.json();
    assert.equal(adminConfig.envFile.path, ownerEnvFile);
    assert.ok(adminConfig.groups.some((group) => group.id === "legal"));
    assert.ok(adminConfig.groups.some((group) => group.id === "integrations"));
    assert.ok(adminConfig.groups.some((group) => group.fields.some((field) => field.key === "PUBLIC_WEB_URL")));
    assert.ok(adminConfig.groups.some((group) => group.fields.some((field) => field.key === "SMTP_HOST")));
    assert.ok(adminConfig.groups.some((group) => group.fields.some((field) => field.key === "ADMIN_EMAIL")));
    assert.ok(adminConfig.groups.some((group) => group.fields.some((field) => (
      field.key === "SMTP_TLS_MODE" && field.values.includes("plain") && field.values.includes("smtps")
    ))));
    assert.ok(adminConfig.secrets.some((secret) => secret.key === "API_ADMIN_TOKEN" && secret.configured));
    assert.ok(adminConfig.secrets.some((secret) => secret.key === "STRIPE_SECRET_KEY" && secret.writeOnly));

    const adminLegalResponse = await fetch(`http://127.0.0.1:${port}/api/admin/legal`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminLegalResponse.status, 200);
    const adminLegal = await adminLegalResponse.json();
    assert.equal(adminLegal.configured, true);
    assert.ok(adminLegal.sections.every((section) => section.configured));
    assert.ok(adminLegal.sections.some((section) => section.id === "legal" && section.route === "/api/legal"));
    assert.equal(adminLegal.preview.legal.providerName, "IT-Tabelander");
    assert.equal(adminLegal.preview.privacy.contactEmail, "privacy@it-tabelander.at");
    assert.equal(adminLegal.preview.terms.contactEmail, "terms@it-tabelander.at");
    assert.doesNotMatch(JSON.stringify(adminLegal), /admin-route-token|sk_live_owner_test|smtp-owner-test/);

    const adminMailResponse = await fetch(`http://127.0.0.1:${port}/api/admin/mail`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminMailResponse.status, 200);
    const adminMail = await adminMailResponse.json();
    assert.equal(adminMail.configured, false);
    assert.equal(adminMail.defaultRecipient, "owner@it-tabelander.at");
    assert.equal(adminMail.confirmationValue, "send-test-email");
    assert.doesNotMatch(JSON.stringify(adminMail), /smtp-owner-test|admin-route-token/);

    const unconfirmedMailTestResponse = await fetch(`http://127.0.0.1:${port}/api/admin/mail/test`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ to: "owner@it-tabelander.at" }),
    });
    assert.equal(unconfirmedMailTestResponse.status, 400);
    const unconfirmedMailTest = await unconfirmedMailTestResponse.json();
    assert.equal(unconfirmedMailTest.requiresConfirmation, true);
    assert.equal(unconfirmedMailTest.confirmationValue, "send-test-email");

    const adminConfigPatchResponse = await fetch(`http://127.0.0.1:${port}/api/admin/config`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ values: { PUBLIC_WEB_URL: "https://omnifm.xyz", DEFAULT_LANGUAGE: "de", API_ADMIN_TOKEN: "must-not-save" } }),
    });
    assert.equal(adminConfigPatchResponse.status, 400);

    const adminConfigSaveResponse = await fetch(`http://127.0.0.1:${port}/api/admin/config`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ values: { PUBLIC_WEB_URL: "https://omnifm.xyz", DEFAULT_LANGUAGE: "de", LOG_MAX_MB: "9" } }),
    });
    assert.equal(adminConfigSaveResponse.status, 200);
    const adminConfigSave = await adminConfigSaveResponse.json();
    assert.equal(adminConfigSave.ok, true);
    assert.equal(adminConfigSave.restartRequired, true);
    assert.ok(adminConfigSave.updatedKeys.includes("DEFAULT_LANGUAGE"));
    assert.match(await fs.readFile(ownerEnvFile, "utf8"), /DEFAULT_LANGUAGE=de/);

    const invalidSecretSaveResponse = await fetch(`http://127.0.0.1:${port}/api/admin/config/secrets`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ values: { API_ADMIN_TOKEN: "must-not-save" } }),
    });
    assert.equal(invalidSecretSaveResponse.status, 400);

    const secretSaveResponse = await fetch(`http://127.0.0.1:${port}/api/admin/config/secrets`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ values: { STRIPE_SECRET_KEY: "sk_live_owner_test", SMTP_PASS: "smtp-owner-test", DISCORD_CLIENT_SECRET: "" } }),
    });
    assert.equal(secretSaveResponse.status, 200);
    const secretSave = await secretSaveResponse.json();
    assert.equal(secretSave.ok, true);
    assert.ok(secretSave.updatedKeys.includes("STRIPE_SECRET_KEY"));
    assert.ok(secretSave.secrets.some((secret) => secret.key === "STRIPE_SECRET_KEY" && secret.configured && !Object.hasOwn(secret, "value")));
    const secretEnvContent = await fs.readFile(ownerEnvFile, "utf8");
    assert.match(secretEnvContent, /STRIPE_SECRET_KEY=sk_live_owner_test/);
    assert.match(secretEnvContent, /SMTP_PASS=smtp-owner-test/);

    const adminAuditResponse = await fetch(`http://127.0.0.1:${port}/api/admin/audit`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminAuditResponse.status, 200);
    const adminAudit = await adminAuditResponse.json();
    assert.equal(adminAudit.file, ownerAuditFile);
    assert.ok(adminAudit.events.some((event) => event.action === "owner.login" && event.status === "success"));
    assert.ok(adminAudit.events.some((event) => (
      event.action === "owner.mail.test"
      && event.status === "denied"
      && event.metadata.requiresConfirmation === true
    )));
    assert.ok(adminAudit.events.some((event) => event.action === "owner.config.update" && event.metadata.updatedKeys.includes("DEFAULT_LANGUAGE")));
    assert.ok(adminAudit.events.some((event) => event.action === "owner.config.secrets.update" && event.metadata.updatedKeys.includes("STRIPE_SECRET_KEY")));
    assert.doesNotMatch(JSON.stringify(adminAudit), /sk_live_owner_test|smtp-owner-test|admin-route-token/);

    const adminJobsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/jobs`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminJobsResponse.status, 200);
    const adminJobs = await adminJobsResponse.json();
    assert.ok(adminJobs.actions.some((action) => action.id === "rollback-plan"));
    assert.ok(adminJobs.actions.some((action) => action.id === "status-quick" && action.requiresConfirmation === false));
    for (const actionId of [
      "status-containers",
      "status-health",
      "status-docker-logs",
      "status-local-logs",
      "status-mongo",
      "status-storage",
    ]) {
      assert.ok(adminJobs.actions.some((action) => action.id === actionId && action.requiresConfirmation === false));
    }
    assert.ok(adminJobs.actions.some((action) => action.id === "bot-config-show" && action.requiresConfirmation === false));
    assert.ok(adminJobs.actions.some((action) => action.id === "bot-roles-show" && action.requiresConfirmation === false));
    assert.ok(adminJobs.actions.some((action) => action.id === "cleanup-dry-run" && action.requiresConfirmation === false));
    assert.ok(adminJobs.actions.some((action) => (
      action.id === "cleanup-run"
      && action.requiresConfirmation
      && action.confirmationValue === "cleanup-run"
    )));
    assert.ok(adminJobs.actions.some((action) => action.id === "split-preflight"));
    assert.equal(adminJobs.summary.totalActions, adminJobs.actions.length);
    assert.ok(adminJobs.summary.byArea.Operations >= 1);
    assert.deepEqual(adminJobs.summary.byStatus, { running: 0, succeeded: 0, failed: 0 });
    assert.deepEqual(adminJobs.summary.outputTotals, { warnings: 0, errors: 0 });
    assert.ok(adminJobs.actions.some((action) => (
      action.id === "deploy-slash-commands"
      && action.requiresConfirmation
      && action.confirmationValue === "deploy-slash-commands"
    )));
    assert.ok(adminJobs.actions.some((action) => (
      action.id === "system-doctor"
      && action.requiresConfirmation
      && action.confirmationValue === "system-doctor"
    )));
    assert.ok(adminJobs.actions.some((action) => (
      action.id === "recognition-test"
      && action.requiresConfirmation
      && action.confirmationValue === "recognition-test"
      && action.inputFields?.some((field) => field.key === "url" && field.type === "url")
    )));

    const invalidAdminJobResponse = await fetch(`http://127.0.0.1:${port}/api/admin/jobs`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "rm-random-things" }),
    });
    assert.equal(invalidAdminJobResponse.status, 404);

    const unconfirmedAdminJobResponse = await fetch(`http://127.0.0.1:${port}/api/admin/jobs`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "system-doctor" }),
    });
    assert.equal(unconfirmedAdminJobResponse.status, 400);
    const unconfirmedAdminJob = await unconfirmedAdminJobResponse.json();
    assert.equal(unconfirmedAdminJob.requiresConfirmation, true);
    assert.equal(unconfirmedAdminJob.confirmationValue, "system-doctor");

    const unconfirmedCommandDeployResponse = await fetch(`http://127.0.0.1:${port}/api/admin/jobs`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "deploy-slash-commands" }),
    });
    assert.equal(unconfirmedCommandDeployResponse.status, 400);
    const unconfirmedCommandDeploy = await unconfirmedCommandDeployResponse.json();
    assert.equal(unconfirmedCommandDeploy.requiresConfirmation, true);
    assert.equal(unconfirmedCommandDeploy.confirmationValue, "deploy-slash-commands");

    const unconfirmedRecognitionResponse = await fetch(`http://127.0.0.1:${port}/api/admin/jobs`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "recognition-test", input: { url: "https://example.com/radio.mp3" } }),
    });
    assert.equal(unconfirmedRecognitionResponse.status, 400);
    const unconfirmedRecognition = await unconfirmedRecognitionResponse.json();
    assert.equal(unconfirmedRecognition.requiresConfirmation, true);
    assert.equal(unconfirmedRecognition.confirmationValue, "recognition-test");

    const unconfirmedCleanupResponse = await fetch(`http://127.0.0.1:${port}/api/admin/jobs`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "cleanup-run" }),
    });
    assert.equal(unconfirmedCleanupResponse.status, 400);
    const unconfirmedCleanup = await unconfirmedCleanupResponse.json();
    assert.equal(unconfirmedCleanup.requiresConfirmation, true);
    assert.equal(unconfirmedCleanup.confirmationValue, "cleanup-run");

    const privateRecognitionResponse = await fetch(`http://127.0.0.1:${port}/api/admin/jobs`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({
        actionId: "recognition-test",
        confirm: "recognition-test",
        input: { url: "http://localhost:9000/radio.mp3" },
      }),
    });
    assert.equal(privateRecognitionResponse.status, 400);
    const privateRecognition = await privateRecognitionResponse.json();
    assert.match(privateRecognition.error, /lokales oder privates Ziel/);

    const adminJobStartResponse = await fetch(`http://127.0.0.1:${port}/api/admin/jobs`, {
      method: "POST",
      headers: { Cookie: adminCookieHeader, "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "rollback-plan" }),
    });
    assert.equal(adminJobStartResponse.status, 202);
    const adminJobStart = await adminJobStartResponse.json();
    assert.equal(adminJobStart.ok, true);
    assert.equal(adminJobStart.job.actionId, "rollback-plan");

    let adminJobResult = null;
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const pollResponse = await fetch(`http://127.0.0.1:${port}/api/admin/jobs/${encodeURIComponent(adminJobStart.job.id)}`, {
        headers: { Cookie: adminCookieHeader },
      });
      assert.equal(pollResponse.status, 200);
      adminJobResult = await pollResponse.json();
      if (adminJobResult.job.status !== "running") break;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    assert.equal(adminJobResult.job.status, "succeeded");
    assert.match(adminJobResult.job.output, /Rollback plan:/);
    assert.ok(adminJobResult.job.outputSummary.lines >= 1);
    assert.equal(typeof adminJobResult.job.outputSummary.lastLine, "string");
    assert.equal(adminJobResult.job.outputSummary.truncated, false);

    const adminAuditAfterJobResponse = await fetch(`http://127.0.0.1:${port}/api/admin/audit`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminAuditAfterJobResponse.status, 200);
    const adminAuditAfterJob = await adminAuditAfterJobResponse.json();
    assert.ok(adminAuditAfterJob.events.some((event) => event.action === "owner.job.start" && event.target === "rollback-plan"));
    assert.ok(adminAuditAfterJob.events.some((event) => (
      event.action === "owner.job.start"
      && event.target === "system-doctor"
      && event.status === "denied"
      && event.metadata.requiresConfirmation === true
    )));
    assert.ok(adminAuditAfterJob.events.some((event) => (
      event.action === "owner.job.start"
      && event.target === "deploy-slash-commands"
      && event.status === "denied"
      && event.metadata.requiresConfirmation === true
    )));
    assert.ok(adminAuditAfterJob.events.some((event) => (
      event.action === "owner.job.start"
      && event.target === "recognition-test"
      && event.status === "denied"
      && event.metadata.requiresConfirmation === true
    )));
    assert.ok(adminAuditAfterJob.events.some((event) => (
      event.action === "owner.job.start"
      && event.target === "cleanup-run"
      && event.status === "denied"
      && event.metadata.requiresConfirmation === true
    )));
    assert.ok(adminAuditAfterJob.events.some((event) => (
      event.action === "owner.job.finish"
      && event.target === "rollback-plan"
      && event.status === "success"
      && event.metadata.jobId === adminJobStart.job.id
      && event.metadata.exitCode === 0
    )));

    const adminGuildsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/guilds`, {
      headers: { Cookie: adminCookieHeader },
    });
    assert.equal(adminGuildsResponse.status, 200);
    const adminGuilds = await adminGuildsResponse.json();
    assert.equal(adminGuilds.total, 1);

    const termsApiResponse = await fetch(`http://127.0.0.1:${port}/api/terms`);
    assert.equal(termsApiResponse.status, 200);
    assertCommonSecurityHeaders(termsApiResponse.headers);
    const termsData = await termsApiResponse.json();

    const legalApiResponse = await fetch(`http://127.0.0.1:${port}/api/legal`);
    assert.equal(legalApiResponse.status, 200);
    const legalData = await legalApiResponse.json();

    const privacyApiResponse = await fetch(`http://127.0.0.1:${port}/api/privacy`);
    assert.equal(privacyApiResponse.status, 200);
    const privacyData = await privacyApiResponse.json();

    assert.equal(legalData.legal?.productName, "OmniFM");
    assert.equal(legalData.legal?.providerName, "IT-Tabelander");
    assert.equal(legalData.legal?.legalForm, "Kleinunternehmen");
    assert.equal(privacyData.productName, "OmniFM");
    assert.equal(privacyData.controller?.name, "IT-Tabelander");
    assert.equal(privacyData.features?.googleAnalyticsEnabled, true);
    assert.equal(privacyData.features?.googleAnalyticsMeasurementId, "G-J5X0ZZ5E3Z");
    assert.equal(privacyData.features?.cookieConsentStorageKey, "omnifm.cookieConsent.v1");
    assert.equal(termsData.productName, "OmniFM");
    assert.equal(termsData.operator?.providerName, "IT-Tabelander");
    assert.equal(termsData.contact?.email, "terms@it-tabelander.at");
    assert.equal(termsData.contact?.website, "https://omnifm.xyz/terms");

    const publicLegalPayload = JSON.stringify({ legalData, privacyData, termsData });
    assert.doesNotMatch(publicLegalPayload, /OmniFM Test Operator|OmniFM Example Operator/i);
    assert.doesNotMatch(publicLegalPayload, /Fabian Tabelander\s*-\s*OmniFM/i);
    assert.doesNotMatch(publicLegalPayload, /legal@example\.com|privacy@example\.com|terms@example\.com/i);
    assert.doesNotMatch(publicLegalPayload, /Example Street|localhost|127\.0\.0\.1/i);

    process.env.LEGAL_PROVIDER_NAME = "OmniFM Example Operator";
    process.env.LEGAL_STREET_ADDRESS = "Example Street 1";
    process.env.LEGAL_EMAIL = "legal@example.com";
    process.env.LEGAL_WEBSITE = "http://localhost:8081";
    process.env.PUBLIC_WEB_URL = "http://127.0.0.1";

    const placeholderLegalResponse = await fetch(`http://127.0.0.1:${port}/api/legal`);
    assert.equal(placeholderLegalResponse.status, 200);
    const placeholderLegalData = await placeholderLegalResponse.json();
    assert.equal(placeholderLegalData.legal?.productName, "OmniFM");
    assert.equal(placeholderLegalData.legal?.providerName, "");
    assert.equal(placeholderLegalData.legal?.streetAddress, "");
    assert.equal(placeholderLegalData.legal?.email, "");
    assert.equal(placeholderLegalData.legal?.website, "");
    assert.deepEqual(
      placeholderLegalData.missingCoreFields.filter((field) => (
        field === "providerName" || field === "streetAddress" || field === "email"
      )),
      ["providerName", "streetAddress", "email"]
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
    await restoreFile(frontendIndexPath, indexSnapshot);
    await restoreFile(frontendRobotsPath, robotsSnapshot);
    await restoreFile(frontendSitemapPath, sitemapSnapshot);
    await restoreFile(frontendManifestPath, manifestSnapshot);
    await restoreFile(frontendBotIconPath, botIconSnapshot);
    await fs.rm(ownerEnvDir, { recursive: true, force: true });
    restoreEnv();
  }
});
