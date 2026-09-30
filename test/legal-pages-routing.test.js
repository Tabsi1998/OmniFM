import { readFileSync } from "node:fs";
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
import { upsertOffer } from "../src/coupon-store.js";

// The version comes from package.json, so a release does not break the tests.
const PACKAGE_VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const frontendBuildDir = path.join(repoRoot, "frontend", "build");
const frontendIndexPath = path.join(frontendBuildDir, "index.html");
const frontendRobotsPath = path.join(frontendBuildDir, "robots.txt");
const frontendSitemapPath = path.join(frontendBuildDir, "sitemap.xml");
const frontendManifestPath = path.join(frontendBuildDir, "manifest.json");
const frontendBotIconDir = path.join(frontendBuildDir, "img");
const frontendBotIconPath = path.join(frontendBotIconDir, "bot-1.png");
const couponsPath = path.join(repoRoot, "coupons.json");
const couponsBackupPath = path.join(repoRoot, "coupons.json.bak");

// The end-to-end routing test alone sends about 60 API requests from 127.0.0.1,
// which is the default per-minute limit shared by every test in this file.
// Whether it hit 429 depended only on how fast the run was (#223). The limiter
// reads these values per request, and web-server-dashboard.test.js does the same.
process.env.API_RATE_LIMIT_MAX = "1000";
process.env.API_RATE_LIMIT_PREMIUM_MAX = "200";
process.env.API_RATE_LIMIT_WEBHOOK_MAX = "1000";

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
    assert.doesNotMatch(csp, /fonts\.(googleapis|gstatic)\.com/i, "the fonts come from this site (#467)");
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
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/start?lang=de"), "start");
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/anleitung"), "start");
  assert.equal(resolvePageFromUrl("https://omnifm.xyz/?page=guide"), "start");
  assert.equal(getCanonicalPagePath("terms", "de"), "/nutzungsbedingungen");
  assert.equal(getCanonicalPagePath("stations", "de"), "/stations");
  assert.equal(getCanonicalPagePath("premium", "en"), "/premium");
  assert.equal(getCanonicalPagePath("faq", "de"), "/faq");
  assert.equal(getCanonicalPagePath("start", "en"), "/start");
  assert.equal(buildPageHref("de", "terms"), "/nutzungsbedingungen?lang=de");
  assert.equal(buildPageHref("de", "stations"), "/stations?lang=de");
  assert.equal(buildPageHref("en", "premium"), "/premium?lang=en");
  assert.equal(buildPageHref("en", "privacy"), "/privacy?lang=en");
});

test("startWebServer serves SPA entry for clean legal paths and exposes terms payload", async () => {
  const ownerEnvDir = await fs.mkdtemp(path.join(os.tmpdir(), "omnifm-admin-config-"));
  const ownerAuditFile = path.join(ownerEnvDir, "owner-audit.json");
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
    OMNIFM_OWNER_AUDIT_FILE: ownerAuditFile,
    SMTP_PASS: undefined,
    ADMIN_EMAIL: "owner@it-tabelander.at",
    DISCORD_CLIENT_SECRET: undefined,
  });
  const indexSnapshot = await snapshotFile(frontendIndexPath);
  const robotsSnapshot = await snapshotFile(frontendRobotsPath);
  const sitemapSnapshot = await snapshotFile(frontendSitemapPath);
  const manifestSnapshot = await snapshotFile(frontendManifestPath);
  const botIconSnapshot = await snapshotFile(frontendBotIconPath);
  const couponsSnapshot = await snapshotFile(couponsPath);
  const couponsBackupSnapshot = await snapshotFile(couponsBackupPath);
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
  upsertOffer({
    code: "OWNERREAD",
    kind: "coupon",
    active: true,
    percentOff: 10,
    ownerLabel: "Owner Route Test",
    note: "seeded by legal-pages-routing",
    createdBy: "test-suite",
    updatedBy: "test-suite",
  });

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

    const guideResponse = await fetch(`http://127.0.0.1:${port}/start?lang=en`);
    assert.equal(guideResponse.status, 200);
    assert.match(await guideResponse.text(), /legal-routing-marker/);

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

    // The owner console is the React app; the old HTML admin page, its cookie
    // login and the ?token= address are gone (#288). /api/admin/* takes the
    // owner token in a header only, like FastAPI.
    const oldAdminPageResponse = await fetch(`http://127.0.0.1:${port}/admin?token=admin-route-token`, { redirect: "manual" });
    assert.equal(oldAdminPageResponse.headers.get("set-cookie"), null);
    assert.doesNotMatch(await oldAdminPageResponse.text(), /OMNIFM OWNER LOGIN|OMNIFM ADMIN/);

    const adminUnauthorizedResponse = await fetch(`http://127.0.0.1:${port}/api/admin/overview`);
    assert.equal(adminUnauthorizedResponse.status, 401);
    assert.equal((await adminUnauthorizedResponse.json()).error, "Nicht autorisiert. Gültiger Owner-Token erforderlich.");
    const refusedAttempts = [
      { url: "/api/admin/overview?token=admin-route-token", headers: {} },
      { url: "/api/admin/overview", headers: { Cookie: "omnifm_owner=admin-route-token" } },
      { url: "/api/admin/overview", headers: { "X-Admin-Token": "wrong-token" } },
    ];
    const refusedResponses = await Promise.all(refusedAttempts.map((attempt) => (
      fetch(`http://127.0.0.1:${port}${attempt.url}`, { headers: attempt.headers })
    )));
    refusedResponses.forEach((response, index) => {
      const attempt = refusedAttempts[index];
      assert.equal(response.status, 401, `${attempt.url} ${JSON.stringify(attempt.headers)} must not open the owner API`);
    });
    const ownerHeaders = { "X-Admin-Token": "admin-route-token" };
    // /api/admin/session is the Discord sign-in of #283 now: without a session nobody is signed in.
    const sessionAnswer = await fetch(`http://127.0.0.1:${port}/api/admin/session`);
    assert.equal((await sessionAnswer.json()).authenticated, false);
    const bearerResponse = await fetch(`http://127.0.0.1:${port}/api/admin/workers`, {
      headers: { Authorization: "Bearer admin-route-token" },
    });
    assert.equal(bearerResponse.status, 200);

    const adminOverviewResponse = await fetch(`http://127.0.0.1:${port}/api/admin/overview`, { headers: ownerHeaders });
    assert.equal(adminOverviewResponse.status, 200);
    const adminOverview = await adminOverviewResponse.json();
    // The owner console's overview with FastAPI's contract (#288).
    assert.equal(adminOverview.brand, "OmniFM");
    assert.ok(adminOverview.stations.total > 0);
    assert.equal(adminOverview.release?.version, PACKAGE_VERSION);
    assert.equal(typeof adminOverview.bots.configured, "number");
    assert.equal(typeof adminOverview.integrations.mongo, "boolean");

    const adminStationsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/stations`, { headers: ownerHeaders });
    assert.equal(adminStationsResponse.status, 200);
    const adminStations = await adminStationsResponse.json();
    // FastAPI's summary (#288): counts by tier and a sample, from stations.json without MongoDB.
    assert.ok(adminStations.total > 0);
    assert.equal(adminStations.total, adminStations.free + adminStations.pro);
    assert.ok(Array.isArray(adminStations.sample) && adminStations.sample.length > 0);
    assert.ok(adminStations.sample.every((station) => station.key && station.tier));

    const adminGuildsResponse = await fetch(`http://127.0.0.1:${port}/api/admin/guilds`, { headers: ownerHeaders });
    assert.equal(adminGuildsResponse.status, 200);
    const adminGuilds = await adminGuildsResponse.json();
    assert.ok(Array.isArray(adminGuilds.guilds));
    assert.equal(adminGuilds.count, adminGuilds.guilds.length);

    // Routes only the old page had: the .env editor, jobs that start scripts,
    // log files, offers, the mail test. None of them exists any more.
    const removedRoutes = [
      ["POST", "/api/admin/logout"], ["GET", "/api/admin/diagnostics"],
      ["GET", "/api/admin/operations"], ["GET", "/api/admin/env"], ["POST", "/api/admin/env/secrets"],
      ["GET", "/api/admin/jobs"], ["GET", "/api/admin/log-files"], ["GET", "/api/admin/logs"],
      ["GET", "/api/admin/offers"], ["GET", "/api/admin/mail"], ["GET", "/api/admin/legal"],
      ["POST", "/api/admin/stations/any-station/test"],
    ];
    const removedResponses = await Promise.all(removedRoutes.map(([method, route]) => (
      fetch(`http://127.0.0.1:${port}${route}`, {
        method,
        headers: { ...ownerHeaders, "Content-Type": "application/json" },
        body: method === "POST" ? "{}" : undefined,
      })
    )));
    removedResponses.forEach((response, index) => {
      const [method, route] = removedRoutes[index];
      assert.equal(response.status, 404, `${method} ${route} should be gone`);
    });

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
    await restoreFile(couponsPath, couponsSnapshot);
    await restoreFile(couponsBackupPath, couponsBackupSnapshot);
    await fs.rm(ownerEnvDir, { recursive: true, force: true });
    restoreEnv();
  }
});
