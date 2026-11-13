#!/usr/bin/env node
// Writes frontend/public/sitemap.xml from the addresses the pages themselves
// announce (getLanguageAlternates in frontend/src/lib/seo.js): every language
// plus x-default, so sitemap and page always agree (#529).
// After changing pages or languages: node scripts/generate-sitemap.mjs
// test/sitemap.test.js fails while the checked-in file differs.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getLanguageAlternates, getPageSeo } from "../frontend/src/lib/seo.js";

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
  const urls = SITEMAP_PAGES.map(({ page, changefreq, priority }) => [
    "  <url>",
    // German keeps the addresses the site always had (/impressum, ...).
    `    <loc>${getPageSeo(page, "de").canonicalUrl}</loc>`,
    ...getLanguageAlternates(page).map(({ hreflang, href }) => `    <xhtml:link rel="alternate" hreflang="${hreflang}" href="${href}" />`),
    `    <changefreq>${changefreq}</changefreq>`,
    `    <priority>${priority}</priority>`,
    "  </url>",
  ]);
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
