#!/usr/bin/env node

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function readText(relativePath) {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

function assertIncludes(text, needle, message) {
  assert.ok(text.includes(needle), message || `Missing required text: ${needle}`);
}

function assertMatches(text, regex, message) {
  assert.match(text, regex, message);
}

// docs/ wurde beim Rework entfernt — die Prüfung fokussiert auf die live ausgelieferten Assets.
const indexHtml = readText("frontend/public/index.html");
const robots = readText("frontend/public/robots.txt");
const sitemap = readText("frontend/public/sitemap.xml");
const googleSiteVerificationToken = "2ZCoKiPvrZJ_fKLyyE4SDbATwbL6yDX-iwI82ghmpSM";

assertMatches(
  indexHtml,
  new RegExp(`<meta\\s+name=["']google-site-verification["']\\s+content=["']${googleSiteVerificationToken}["']\\s*/?>`, "i"),
  "frontend/public/index.html must keep the active Google verification meta tag in the homepage head"
);

assertMatches(robots, /User-agent:\s*\*/i, "robots.txt must allow a generic crawler directive");
assertMatches(
  robots,
  /Sitemap:\s*https:\/\/omnifm\.xyz\/sitemap\.xml/i,
  "robots.txt must point crawlers to the canonical sitemap"
);

for (const expectedUrl of [
  "https://omnifm.xyz/",
  "https://omnifm.xyz/stations",
  "https://omnifm.xyz/premium",
  "https://omnifm.xyz/faq",
  "https://omnifm.xyz/dashboard",
  "https://omnifm.xyz/impressum",
  "https://omnifm.xyz/datenschutz",
  "https://omnifm.xyz/nutzungsbedingungen",
]) {
  assertIncludes(sitemap, `<loc>${expectedUrl}</loc>`, `sitemap.xml missing ${expectedUrl}`);
}

console.log("Search Console readiness check passed.");
