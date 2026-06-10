import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs/promises";
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
    restoreEnv();
  }
});
