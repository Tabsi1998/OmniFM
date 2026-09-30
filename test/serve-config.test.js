import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { SERVE_CONFIG_PATH, buildServeConfig, renderServeConfig } from "../scripts/write-serve-config.mjs";
import { buildContentSecurityPolicy } from "../src/config/security-headers.js";
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
  const headers = headersFor(buildServeConfig(), "**");
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
  assert.equal(headersFor(buildServeConfig(), "**")["Content-Security-Policy"], buildContentSecurityPolicy());
  assert.equal(getCommonSecurityHeaders()["Content-Security-Policy"], buildContentSecurityPolicy());
});

test("only page paths fall back to index.html, hashed assets are cached for good", () => {
  const config = buildServeConfig();
  assert.deepEqual(config.rewrites, [{ source: "/:path([^.]+)", destination: "/index.html" }]);
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
