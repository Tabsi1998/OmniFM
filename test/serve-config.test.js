import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { SERVE_CONFIG_PATH, buildServeConfig, renderServeConfig } from "../scripts/write-serve-config.mjs";
import { ACTIVITY_FRAME_ANCESTORS, buildContentSecurityPolicy } from "../src/config/security-headers.js";
import { getCommonSecurityHeaders } from "../src/lib/api-helpers.js";

function headersFor(config, source) {
  const rule = config.headers.find((entry) => entry.source === source);
  assert.ok(rule, `no header rule for ${source}`);
  return Object.fromEntries(rule.headers.map(({ key, value }) => [key, value]));
}

test("frontend/serve.json is written from src/config/security-headers.js", () => {
  assert.equal(fs.readFileSync(SERVE_CONFIG_PATH, "utf8"), renderServeConfig());
});

test("the website sends the headers the live smoke check expects", () => {
  const config = buildServeConfig();
  const headers = { ...headersFor(config, "**"), ...headersFor(config, "!activity/**") };
  assert.equal(headers["X-Content-Type-Options"], "nosniff");
  assert.equal(headers["X-Frame-Options"], "DENY");
  assert.equal(headers["Referrer-Policy"], "no-referrer");
  assert.match(headers["Permissions-Policy"], /camera=\(\).*microphone=\(\)/);
  assert.match(headers["Content-Security-Policy"], /default-src 'self'.*object-src 'none'.*frame-ancestors 'none'/);
  assert.match(headers["Content-Security-Policy"], /googletagmanager\.com/);
  assert.doesNotMatch(headers["Content-Security-Policy"], /fonts\.(googleapis|gstatic)\.com/, "the fonts come from this site (#467)");
  assert.match(headers["Strict-Transport-Security"], /max-age=\d+/);
});

test("the website and the Node API share one content security policy", () => {
  assert.equal(headersFor(buildServeConfig(), "!activity/**")["Content-Security-Policy"], buildContentSecurityPolicy());
  assert.equal(getCommonSecurityHeaders()["Content-Security-Policy"], buildContentSecurityPolicy());
});

test("only the site's pages get index.html; any other address stays a 404 (#487); assets cached for good", async () => {
  const config = buildServeConfig();
  const { WEBSITE_PAGE_PATHS } = await import("../frontend/src/lib/pageRouting.js");
  assert.deepEqual(config.rewrites[0], { source: "/activity", destination: "/activity/index.html" });
  const pages = config.rewrites.slice(1);
  assert.ok(pages.every((rule) => rule.destination === "/index.html" && !rule.source.includes(":")), "named pages only, no pattern");
  for (const page of ["/sender", "/preise", "/impressum", "/dashboard", "/admin", "/status", "/charts", "/start"]) {
    assert.ok(pages.some((rule) => rule.source === page) && pages.some((rule) => rule.source === `${page}/`), page);
  }
  assert.equal(pages.length, (WEBSITE_PAGE_PATHS.length - 1) * 2, "every page of the app, with and without a slash");
  assert.equal(pages.some((rule) => rule.source === "/gibt-es-nicht"), false);
  assert.match(headersFor(config, "assets/**")["Cache-Control"], /immutable/);
  assert.equal(headersFor(config, "favicon.ico")["Content-Type"], "image/x-icon");
});

test("the website's fonts come from this site, and every font it names is there (#467)", () => {
  const html = fs.readFileSync(new URL("../frontend/index.html", import.meta.url), "utf8");
  assert.doesNotMatch(html, /fonts\.(googleapis|gstatic)\.com/, "no request to Google Fonts");
  const faces = [...html.matchAll(/url\((\/assets\/fonts\/[^)]+\.woff2)\)/g)].map((match) => match[1]);
  assert.equal(faces.length, 8, "four families, each in Latin and Latin Extended");
  for (const file of faces) assert.ok(fs.existsSync(new URL(`../frontend/public${file}`, import.meta.url)), `${file} exists`);
  const preloads = [...html.matchAll(/rel="preload" href="([^"]+\.woff2)"/g)].map((match) => match[1]);
  assert.equal(preloads.length, 2, "body text and headline");
  assert.deepEqual(preloads.filter((file) => !faces.includes(file)), [], "a preloaded font is one the page declares");
  for (const slug of ["syne", "dm-sans", "jetbrains-mono", "outfit"]) {
    const licence = fs.readFileSync(new URL(`../frontend/public/assets/fonts/OFL-${slug}.txt`, import.meta.url), "utf8");
    assert.match(licence, /SIL OPEN FONT LICENSE/, `licence of ${slug}`);
  }
});

test("only the Discord Activity may be framed, and only by Discord (#308)", () => {
  const config = buildServeConfig();
  const common = headersFor(config, "**");
  assert.equal(common["X-Frame-Options"], undefined, "the frame rules are not in the rule for everything");
  assert.equal(common["Content-Security-Policy"], undefined);
  const site = headersFor(config, "!activity/**");
  assert.equal(site["X-Frame-Options"], "DENY");
  assert.match(site["Content-Security-Policy"], /frame-ancestors 'none'/);
  const activity = headersFor(config, "activity/**");
  assert.equal(activity["X-Frame-Options"], undefined, "a DENY would contradict the frame rule");
  assert.deepEqual(ACTIVITY_FRAME_ANCESTORS, ["https://discord.com", "https://*.discord.com", "https://*.discordsays.com"]);
  assert.match(activity["Content-Security-Policy"], /frame-ancestors https:\/\/discord\.com https:\/\/\*\.discord\.com https:\/\/\*\.discordsays\.com;/);
  // Everything else in the Activity's policy is the site's.
  assert.equal(activity["Content-Security-Policy"].replace(/frame-ancestors [^;]*/, "frame-ancestors 'none'"), buildContentSecurityPolicy());
  // The rule for the site comes before the Activity's, the rule for everything first.
  assert.deepEqual(config.headers.slice(0, 3).map((rule) => rule.source), ["**", "!activity/**", "activity/**"]);
});
