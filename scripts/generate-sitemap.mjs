#!/usr/bin/env node
// Writes frontend/public/sitemap.xml from the addresses the pages themselves
// announce (getLanguageAlternates in frontend/src/lib/seo.js): one <url> per
// language address with every language plus x-default, so sitemap and page
// always agree (#529).
// After changing pages or languages: node scripts/generate-sitemap.mjs
// test/sitemap.test.js fails while the checked-in file differs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLanguageAlternates } from "../frontend/src/lib/seo.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const SITEMAP_PATH = path.join(repoRoot, "frontend", "public", "sitemap.xml");

// The indexable pages; the dashboard and /admin stay out (#528).
export const SITEMAP_PAGES = Object.freeze([
  { page: "home", changefreq: "weekly", priority: "1.0" },
  { page: "stations", changefreq: "weekly", priority: "0.8" },
  { page: "premium", changefreq: "monthly", priority: "0.8" },
  { page: "faq", changefreq: "monthly", priority: "0.7" },
  { page: "start", changefreq: "monthly", priority: "0.8" },
  { page: "imprint", changefreq: "monthly", priority: "0.3" },
  { page: "privacy", changefreq: "monthly", priority: "0.4" },
  { page: "terms", changefreq: "monthly", priority: "0.4" },
  { page: "charts", changefreq: "weekly", priority: "0.5" },
  { page: "status", changefreq: "hourly", priority: "0.3" },
]);

export function buildSitemapXml() {
  // One <url> per language address, each listing every alternate plus
  // x-default, as Google asks for; the bare address is only the x-default.
  const urls = SITEMAP_PAGES.flatMap(({ page, changefreq, priority }) => {
    const alternates = getLanguageAlternates(page);
    const links = alternates.map(({ hreflang, href }) => `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}" />`);
    return alternates
      .filter(({ hreflang }) => hreflang !== "x-default")
      .map(({ href }) => [
        "  <url>",
        `    <loc>${href}</loc>`,
        ...links,
        `    <changefreq>${changefreq}</changefreq>`,
        `    <priority>${priority}</priority>`,
        "  </url>",
      ]);
  });
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
    ...urls.flat(),
    "</urlset>",
    "",
  ].join("\n");
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  fs.writeFileSync(SITEMAP_PATH, buildSitemapXml(), "utf8");
  console.log(`Wrote ${path.relative(repoRoot, SITEMAP_PATH)} (${SITEMAP_PAGES.length} pages).`);
}
