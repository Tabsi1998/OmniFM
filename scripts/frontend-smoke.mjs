#!/usr/bin/env node
// Playwright smoke of the built website (#294): each page a visitor, a server
// admin or the owner opens first loads in Chromium, shows what it is for, and
// throws no JavaScript error. The site is scripts/local-site-proxy.mjs: pages
// from `serve` with serve.json and /api from a real Node API, one address as in
// production. Only the dashboard's Discord login is mocked; there every area
// is opened.
//
//   node scripts/frontend-smoke.mjs <site-url>
//
// Exit 1 with one line per broken page.
import { chromium } from "playwright";

const base = String(process.argv[2] || "").replace(/\/+$/, "");
if (!base) {
  console.error("usage: node scripts/frontend-smoke.mjs <site-url>");
  process.exit(2);
}

const SERVER = "123456789012345678";
const CAPABILITIES = Object.fromEntries([
  "dashboardAccess", "eventScheduler", "rolePermissions", "weeklyDigest", "basicHealth", "customStationUrls",
  "advancedAnalytics", "failoverRules", "licenseWorkspace", "exportsWebhooks", "voiceGuard",
].map((key) => [key, true]));
const DASHBOARD_ANSWERS = {
  "/api/auth/session": {
    authenticated: true,
    oauthConfigured: true,
    user: { id: "1", username: "smoke" },
    guilds: [{ id: SERVER, name: "Radio Club", tier: "ultimate", dashboardEnabled: true, capabilities: CAPABILITIES, limits: {}, upgradeHints: {} }],
  },
  "/api/dashboard/license": { tier: "ultimate", dashboardEnabled: true, ultimateEnabled: true, license: null },
  "/api/dashboard/stats": { tier: "ultimate", basic: null, advanced: null },
  "/api/dashboard/events": { events: [] },
  "/api/dashboard/perms": { rules: [], commandRoleMap: {} },
  "/api/dashboard/roles": { roles: [] },
  "/api/dashboard/channels": { voiceChannels: [], textChannels: [], channels: [] },
  "/api/dashboard/stations": { stations: [], free: [], pro: [], ultimate: [], custom: [] },
  "/api/dashboard/custom-stations": { stations: [], limit: 50 },
  "/api/dashboard/settings": { settings: {} },
};
const DASHBOARD_AREAS = ["overview", "stations", "events", "roles", "stats", "subscription", "settings"];

const PAGES = [
  { name: "Startseite", path: "/", shows: '[data-testid="hero-title"]', lean: true },
  { name: "Sender", path: "/sender", shows: '[data-testid="station-browser"]', lean: true },
  { name: "Preise", path: "/preise", shows: '[data-testid="premium-section"]', lean: true },
  { name: "Impressum", path: "/impressum", shows: '[data-testid="impressum-section"]' },
  { name: "Datenschutz", path: "/datenschutz", shows: '[data-testid="privacy-section"]' },
  { name: "Nutzungsbedingungen", path: "/nutzungsbedingungen", shows: '[data-testid="terms-section"]' },
  { name: "Status", path: "/status", shows: '[data-testid="status-content"][aria-busy="false"]', lean: true },
  { name: "Charts", path: "/charts", shows: '[data-testid="charts-content"][aria-busy="false"]', lean: true },
  { name: "Dashboard (angemeldet)", path: "/dashboard", shows: '[data-testid="guild-nav-overview"]', mockDashboard: true },
  { name: "Owner-Konsole (Login)", path: "/admin", shows: '[data-testid="admin-token-input"]' },
];

// #296: the public pages load neither the charts nor the dashboard nor the
// owner console; each leaves a marker in its code that shows if it came along.
const LEAN_MARKERS = [
  ["recharts-wrapper", "Diagramm-Code"],
  ["guild-perms-matrix", "Server-Dashboard"],
  ["admin-token-input", "Owner-Konsole"],
];

// Third-party resources (fonts, analytics) may fail offline; the page itself must not.
const ignoredConsole = (text) => /Failed to load resource|net::ERR_|googletagmanager|google-analytics/i.test(text);

const browser = await chromium.launch();
const problems = [];
try {
  for (const page of PAGES) {
    // eslint-disable-next-line no-await-in-loop -- one page after the other, readable output
    const context = await browser.newContext({ locale: "de-DE" });
    // eslint-disable-next-line no-await-in-loop
    const tab = await context.newPage();
    const errors = [];
    const scripts = [];
    tab.on("response", (response) => {
      if (response.request().resourceType() === "script") scripts.push(response);
    });
    tab.on("pageerror", (error) => errors.push(`JavaScript-Fehler: ${error.message}`));
    tab.on("console", (message) => {
      if (message.type() === "error" && !ignoredConsole(message.text())) errors.push(`Konsole: ${message.text().slice(0, 200)}`);
    });
    // The dashboard page gets a signed-in Discord session instead of the real login.
    if (page.mockDashboard) {
      // eslint-disable-next-line no-await-in-loop
      await tab.route(/\/api\/(auth|dashboard)\//, (route) => {
        const path = new URL(route.request().url()).pathname;
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DASHBOARD_ANSWERS[path] ?? {}) });
      });
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await tab.goto(`${base}${page.path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      if (!response || response.status() >= 400) errors.push(`HTTP ${response ? response.status() : "keine Antwort"}`);
      // eslint-disable-next-line no-await-in-loop
      await tab.waitForSelector(page.shows, { state: "visible", timeout: 20_000 });
      // A moment for effects that run after the first paint.
      // eslint-disable-next-line no-await-in-loop
      await tab.waitForTimeout(500);
      if (page.lean) {
        for (const script of scripts) {
          // eslint-disable-next-line no-await-in-loop -- one script after the other
          const code = await script.text().catch(() => "");
          for (const [marker, what] of LEAN_MARKERS) {
            if (code.includes(marker)) errors.push(`lädt ${what} mit (${new URL(script.url()).pathname})`);
          }
        }
      }
      if (page.mockDashboard) {
        for (const area of DASHBOARD_AREAS) {
          // eslint-disable-next-line no-await-in-loop -- one area after the other, like a person clicks
          await tab.click(`[data-testid="guild-nav-${area}"]`, { timeout: 10_000 });
          // eslint-disable-next-line no-await-in-loop
          await tab.waitForTimeout(300);
        }
      }
    } catch (error) {
      errors.push(`zeigt ${page.shows} nicht: ${String(error.message).split("\n")[0]}`);
    }
    if (errors.length) problems.push(`${page.name} (${page.path}): ${errors.join(" | ")}`);
    else console.log(`ok  ${page.name} (${page.path})`);
    // eslint-disable-next-line no-await-in-loop
    await context.close();
  }
} finally {
  await browser.close();
}

if (problems.length) {
  for (const line of problems) console.log(`FEHLER  ${line}`);
  process.exit(1);
}
console.log(`${PAGES.length} Seiten geprüft, alle in Ordnung.`);
