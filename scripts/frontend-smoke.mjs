#!/usr/bin/env node
// Playwright smoke of the built website (#294): each page a visitor, a server
// admin or the owner opens first loads in Chromium, shows what it is for, and
// throws no JavaScript error. The site is scripts/local-site-proxy.mjs: pages
// from `serve` with serve.json and /api from a real Node API, one address as in
// production. Only the dashboard's Discord login is mocked; there every area
// is opened. Every page and every dashboard area passes axe without a serious
// or critical finding (#488-#490): every control has a name, every text its
// contrast.
//
//   node scripts/frontend-smoke.mjs <site-url>
//
// Exit 1 with one line per broken page.
import fs from "node:fs";
import { createRequire } from "node:module";
import { chromium } from "playwright";
import { PLAN_CAPABILITIES } from "../src/config/plan-features.js";

const base = String(process.argv[2] || "").replace(/\/+$/, "");
if (!base) {
  console.error("usage: node scripts/frontend-smoke.mjs <site-url>");
  process.exit(2);
}

const SERVER = "123456789012345678";
// Every capability of the plan file (#413), all switched on.
const CAPABILITIES = Object.fromEntries(Object.values(PLAN_CAPABILITIES).map((entry) => [entry.apiKey, true]));
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
const DASHBOARD_LIVE = { serverId: SERVER, streams: [], listenersNow: 0, activeStreams: 0, runtimeUptimeSec: 0 };
const DASHBOARD_AREAS = ["overview", "stations", "events", "roles", "stats", "subscription", "settings"];

const PAGES = [
  { name: "Startseite", path: "/", shows: '[data-testid="hero-title"]', lean: true },
  { name: "Sender", path: "/sender", shows: '[data-testid="station-browser"]', lean: true },
  { name: "Preise", path: "/preise", shows: '[data-testid="premium-section"]', lean: true },
  { name: "Erste Schritte", path: "/start", shows: '[data-testid="start-guide"]', lean: true },
  { name: "Impressum", path: "/impressum", shows: '[data-testid="impressum-section"]' },
  { name: "Datenschutz", path: "/datenschutz", shows: '[data-testid="privacy-section"]' },
  { name: "Nutzungsbedingungen", path: "/nutzungsbedingungen", shows: '[data-testid="terms-section"]' },
  { name: "Status", path: "/status", shows: '[data-testid="status-content"][aria-busy="false"]', lean: true },
  { name: "Charts", path: "/charts", shows: '[data-testid="charts-content"][aria-busy="false"]', lean: true },
  { name: "Dashboard (angemeldet)", path: "/dashboard", shows: '[data-testid="guild-nav-overview"]', mockDashboard: true },
  { name: "Owner-Konsole (Login)", path: "/admin", shows: '[data-testid="admin-token-input"]' },
  // #487: an address the site does not have: HTTP 404, the not-found page, noindex.
  { name: "Unbekannte Adresse", path: "/gibt-es-nicht", shows: '[data-testid="not-found-page"]', status: 404 },
  // #308: the Activity outside Discord shows where it runs; Discord alone may frame it.
  { name: "Discord-Activity", path: "/activity/", shows: '[data-testid="activity-outside"]', lean: true, activity: true },
];

// #296: the public pages load neither the charts nor the dashboard nor the
// owner console; each leaves a marker in its code that shows if it came along.
const LEAN_MARKERS = [
  ["recharts-wrapper", "Diagramm-Code"],
  ["guild-perms-matrix", "Server-Dashboard"],
  ["admin-token-input", "Owner-Konsole"],
];

// The rules of WCAG 2.1 A and AA that axe tests by itself.
const AXE_SOURCE = fs.readFileSync(createRequire(import.meta.url).resolve("axe-core/axe.min.js"), "utf8");
const AXE_TAGS = ["wcag2a", "wcag2aa", "wcag21aa"];

async function axeRun(tab) {
  await tab.addScriptTag({ content: AXE_SOURCE });
  return tab.evaluate(async (tags) => {
    // In the page: globalThis is its window.
    const result = await globalThis.axe.run(globalThis.document, { resultTypes: ["violations"], runOnly: { type: "tag", values: tags } });
    return result.violations
      .filter((violation) => violation.impact === "serious" || violation.impact === "critical")
      .map((violation) => `${violation.id} ${violation.nodes.length}x, z. B. ${violation.nodes[0].target.join(" ")}`);
  }, AXE_TAGS);
}

// A fade-in that still runs mixes its colours; what is still there a moment later counts.
async function accessibilityFindings(tab) {
  const first = await axeRun(tab);
  if (!first.length) return first;
  await tab.waitForTimeout(1500);
  return axeRun(tab);
}

// Third-party resources (fonts, analytics) may fail offline; the page itself must not.
const ignoredConsole = (text) => /Failed to load resource|net::ERR_|googletagmanager|google-analytics/i.test(text);

const browser = await chromium.launch();
const problems = [];
try {
  for (const page of PAGES) {
    // The page checks run without the service worker (#305); the app check below has it.
    // eslint-disable-next-line no-await-in-loop -- one page after the other, readable output
    const context = await browser.newContext({ locale: "de-DE", serviceWorkers: "block" });
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
        // The overview listens on a stream of events (#502), not JSON.
        if (path === "/api/dashboard/live") {
          return route.fulfill({ status: 200, contentType: "text/event-stream", body: `retry: 60000\n\nevent: live\ndata: ${JSON.stringify(DASHBOARD_LIVE)}\n\n` });
        }
        return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(DASHBOARD_ANSWERS[path] ?? {}) });
      });
    }
    try {
      // eslint-disable-next-line no-await-in-loop
      const response = await tab.goto(`${base}${page.path}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      const expected = page.status || 200;
      if (!response || (expected === 200 ? response.status() >= 400 : response.status() !== expected)) {
        errors.push(`HTTP ${response ? response.status() : "keine Antwort"} statt ${expected}`);
      }
      // Only the Activity may be framed, and only by Discord (#308); every other page never.
      const headers = response?.headers() || {};
      const ancestors = /frame-ancestors ([^;]*)/.exec(headers["content-security-policy"] || "")?.[1] || "";
      if (page.activity) {
        if (headers["x-frame-options"]) errors.push(`X-Frame-Options ${headers["x-frame-options"]} sperrt Discord aus`);
        if (!ancestors.includes("https://discord.com")) errors.push(`frame-ancestors erlaubt Discord nicht (${ancestors || "fehlt"})`);
      } else if (headers["x-frame-options"] !== "DENY" || ancestors !== "'none'") {
        errors.push(`darf in einem Frame erscheinen (X-Frame-Options ${headers["x-frame-options"] || "fehlt"}, frame-ancestors ${ancestors || "fehlt"})`);
      }
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
          // The Activity is a page of its own: none of the website's chunks.
          if (page.activity && /\/assets\/(vendor|index)-/.test(new URL(script.url()).pathname)) {
            errors.push(`lädt Website-Code mit (${new URL(script.url()).pathname})`);
          }
        }
      }
      // eslint-disable-next-line no-await-in-loop
      for (const line of await accessibilityFindings(tab)) errors.push(`Barrierefreiheit: ${line}`);
      if (page.mockDashboard) {
        for (const area of DASHBOARD_AREAS) {
          // eslint-disable-next-line no-await-in-loop -- one area after the other, like a person clicks
          await tab.click(`[data-testid="guild-nav-${area}"]`, { timeout: 10_000 });
          // eslint-disable-next-line no-await-in-loop
          await tab.waitForTimeout(300);
          // eslint-disable-next-line no-await-in-loop
          for (const line of await accessibilityFindings(tab)) errors.push(`Barrierefreiheit (${area}): ${line}`);
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

  // #497: the header's menu switches the start page to French in place, and
  // the choice still counts on the next visit, whatever the browser says.
  {
    const context = await browser.newContext({ locale: "de-DE", serviceWorkers: "block" });
    const tab = await context.newPage();
    try {
      await tab.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await tab.click('[data-testid="language-menu-button"]', { timeout: 20_000 });
      await tab.click('[data-testid="language-option-fr"]', { timeout: 5_000 });
      // In the page: globalThis is its window.
      await tab.waitForFunction(() => globalThis.document.documentElement.lang === "fr"
        && new URL(globalThis.location.href).searchParams.get("lang") === "fr", null, { timeout: 10_000 });
      await tab.goto(`${base}/`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      await tab.waitForFunction(() => globalThis.document.documentElement.lang === "fr", null, { timeout: 10_000 });
      console.log("ok  Sprachwahl (/): Französisch gewählt, beim nächsten Besuch noch da");
    } catch (error) {
      problems.push(`Sprachwahl (/): ${String(error.message).split("\n")[0]}`);
    } finally {
      await context.close();
    }
  }

  // #501: the sections below the first screen draw only when they come near
  // and grow when their data comes; /preise and /#faq still land on them.
  for (const [where, selector] of [["/preise", '[data-testid="premium-section"]'], ["/#faq", "#faq"]]) {
    // eslint-disable-next-line no-await-in-loop -- one address after the other
    const context = await browser.newContext({ locale: "de-DE", serviceWorkers: "block" });
    // eslint-disable-next-line no-await-in-loop
    const tab = await context.newPage();
    try {
      // eslint-disable-next-line no-await-in-loop
      await tab.goto(`${base}${where}`, { waitUntil: "domcontentloaded", timeout: 30_000 });
      // eslint-disable-next-line no-await-in-loop
      await tab.waitForSelector(selector, { timeout: 20_000 });
      // eslint-disable-next-line no-await-in-loop
      await tab.waitForTimeout(1500);
      // eslint-disable-next-line no-await-in-loop
      const top = await tab.evaluate((wanted) => Math.round(globalThis.document.querySelector(wanted).getBoundingClientRect().top), selector);
      if (Math.abs(top) > 120) problems.push(`Sprung (${where}): ${selector} steht bei ${top} px statt oben`);
      else console.log(`ok  Sprung (${where}): ${selector} oben (${top} px)`);
    } catch (error) {
      problems.push(`Sprung (${where}): ${String(error.message).split("\n")[0]}`);
    } finally {
      // eslint-disable-next-line no-await-in-loop
      await context.close();
    }
  }

  // #305: Chrome's own check whether the site installs as an app, and the
  // service worker that keeps the build files takes over.
  const context = await browser.newContext({ locale: "de-DE" });
  const tab = await context.newPage();
  try {
    await tab.goto(`${base}/`, { waitUntil: "load", timeout: 30_000 });
    const worker = await tab.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then((registration) => registration.active?.scriptURL || null),
      new Promise((resolve) => { setTimeout(() => resolve(null), 15_000); }),
    ]));
    const cdp = await context.newCDPSession(tab);
    const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
    const errors = installabilityErrors.map((error) => error.errorId);
    if (!worker) errors.push("kein Service-Worker aktiv");
    if (errors.length) problems.push(`App (/): nicht installierbar: ${errors.join(", ")}`);
    else console.log("ok  App (/): installierbar, Service-Worker aktiv");
  } catch (error) {
    problems.push(`App (/): ${String(error.message).split("\n")[0]}`);
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}

if (problems.length) {
  for (const line of problems) console.log(`FEHLER  ${line}`);
  process.exit(1);
}
console.log(`${PAGES.length} Seiten geprüft, alle in Ordnung; als App installierbar.`);
