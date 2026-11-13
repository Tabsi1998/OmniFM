import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { LANGUAGE_CODES } from "../frontend/src/i18n/languages.js";
import { resolvePageFromUrl } from "../frontend/src/lib/pageRouting.js";
import { NOINDEX_PAGES, getLanguageAlternates, getPageSeo } from "../frontend/src/lib/seo.js";
import { SITEMAP_PATH, buildSitemapXml } from "../scripts/generate-sitemap.mjs";

const sitemapXml = fs.readFileSync(SITEMAP_PATH, "utf8").replace(/\r\n/g, "\n");

/** Each <url> of the checked-in sitemap: its loc and its hreflang -> href links. */
function sitemapEntries() {
  return [...sitemapXml.matchAll(/<url>([\s\S]*?)<\/url>/g)].map(([, body]) => ({
    loc: body.match(/<loc>([^<]+)<\/loc>/)[1],
    links: [...body.matchAll(/<xhtml:link rel="alternate" hreflang="([^"]+)" href="([^"]+)" \/>/g)].map(([, hreflang, href]) => ({ hreflang, href })),
  }));
}

test("the checked-in sitemap is what scripts/generate-sitemap.mjs writes (#529)", () => {
  assert.equal(sitemapXml, buildSitemapXml(), "run: node scripts/generate-sitemap.mjs");
});

test("every sitemap page lists the same languages as the page itself (#529)", () => {
  const entries = sitemapEntries();
  assert.ok(entries.length > 0);
  for (const { loc, links } of entries) {
    const page = resolvePageFromUrl(loc);
    assert.equal(links.length, LANGUAGE_CODES.length + 1, `${loc}: every language plus x-default`);
    assert.deepEqual(links, getLanguageAlternates(page), loc);
    assert.ok(links.some(({ href }) => href === loc), `${loc}: its own address is one of the alternates`);
    assert.equal(getPageSeo(page, "en").robots, "index,follow", `${loc}: only indexable pages`);
    assert.ok(!NOINDEX_PAGES.includes(page), `${loc}: no page behind a login (#528)`);
  }
});
