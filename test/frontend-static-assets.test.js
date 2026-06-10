import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildStructuredData, getFaqEntries, getPageSeo } from "../frontend/src/lib/seo.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

test("React public folder does not ship legacy standalone frontend assets", () => {
  const reactPublicDir = path.join(repoRoot, "frontend", "public");
  const legacyWebDir = path.join(repoRoot, "web");

  assert.equal(
    fs.existsSync(path.join(reactPublicDir, "app.js")),
    false,
    "frontend/public/app.js would be copied to frontend/build/app.js by the React build"
  );
  assert.equal(
    fs.existsSync(path.join(reactPublicDir, "styles.css")),
    false,
    "frontend/public/styles.css would be copied to frontend/build/styles.css by the React build"
  );

  assert.equal(
    fs.existsSync(path.join(legacyWebDir, "app.js")),
    true,
    "web/app.js remains the explicit legacy fallback asset"
  );
  assert.equal(
    fs.existsSync(path.join(legacyWebDir, "styles.css")),
    true,
    "web/styles.css remains the explicit legacy fallback asset"
  );
});

test("React public index references only the React mount and no legacy root assets", () => {
  const indexHtml = fs.readFileSync(
    path.join(repoRoot, "frontend", "public", "index.html"),
    "utf8"
  );

  assert.match(indexHtml, /<div id="root"><\/div>/);
  assert.doesNotMatch(indexHtml, /src=["']\/app\.js["']/i);
  assert.doesNotMatch(indexHtml, /href=["']\/styles\.css["']/i);
});

test("React public SEO assets and base metadata are present", () => {
  const publicDir = path.join(repoRoot, "frontend", "public");
  const indexHtml = fs.readFileSync(path.join(publicDir, "index.html"), "utf8");
  const robotsTxt = fs.readFileSync(path.join(publicDir, "robots.txt"), "utf8");
  const sitemapXml = fs.readFileSync(path.join(publicDir, "sitemap.xml"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, "manifest.json"), "utf8"));

  assert.match(indexHtml, /<link rel="canonical" href="https:\/\/omnifm\.xyz\/"/);
  assert.match(indexHtml, /<meta name="google-site-verification" content="2ZCoKiPvrZJ_fKLyyE4SDbATwbL6yDX-iwI82ghmpSM" \/>/);
  assert.doesNotMatch(indexHtml, /googletagmanager\.com\/gtag\/js\?id=G-J5X0ZZ5E3Z/i);
  assert.doesNotMatch(indexHtml, /gtag\(['"]config['"],\s*['"]G-J5X0ZZ5E3Z/i);
  assert.match(indexHtml, /property="og:title"/);
  assert.match(indexHtml, /name="twitter:card"/);
  assert.match(indexHtml, /application\/ld\+json/);
  assert.match(indexHtml, /"@type": "SoftwareApplication"/);
  assert.match(indexHtml, /"@type": "FAQPage"/);

  assert.match(robotsTxt, /User-agent: \*/);
  assert.match(robotsTxt, /Sitemap: https:\/\/omnifm\.xyz\/sitemap\.xml/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/dashboard<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/stations<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/premium<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/faq<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/impressum<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/datenschutz<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/nutzungsbedingungen<\/loc>/);
  assert.equal(manifest.name, "OmniFM");
  assert.equal(manifest.start_url, "/");
  assert.equal(manifest.icons[0].src, "/img/bot-1.png");
});

test("SEO helper returns route-specific canonical metadata and structured data", () => {
  const homeSeo = getPageSeo("home", "en");
  assert.equal(homeSeo.canonicalUrl, "https://omnifm.xyz/");
  assert.match(homeSeo.title, /24\/7 Radio/);

  const imprintSeo = getPageSeo("imprint", "de");
  assert.equal(imprintSeo.canonicalUrl, "https://omnifm.xyz/impressum");
  assert.match(imprintSeo.description, /Pflichtangaben/);

  const privacySeo = getPageSeo("privacy", "en");
  assert.equal(privacySeo.canonicalUrl, "https://omnifm.xyz/privacy");
  assert.match(privacySeo.title, /Privacy policy/);

  const stationsSeo = getPageSeo("stations", "de");
  assert.equal(stationsSeo.canonicalUrl, "https://omnifm.xyz/stations");
  assert.match(stationsSeo.title, /Stationen/);
  assert.match(stationsSeo.description, /Discord-Radio/);

  const premiumSeo = getPageSeo("premium", "en");
  assert.equal(premiumSeo.canonicalUrl, "https://omnifm.xyz/premium");
  assert.match(premiumSeo.title, /Free, Pro and Ultimate/);
  assert.match(premiumSeo.description, /audio quality/i);

  const faqSeo = getPageSeo("faq", "de");
  assert.equal(faqSeo.canonicalUrl, "https://omnifm.xyz/faq");
  assert.match(faqSeo.title, /FAQ/);

  const structuredData = buildStructuredData(faqSeo);
  const types = structuredData["@graph"].map((entry) => entry["@type"]);
  assert.ok(types.includes("Organization"));
  assert.ok(types.includes("WebSite"));
  assert.ok(types.includes("SoftwareApplication"));
  assert.ok(types.includes("FAQPage"));

  const organization = structuredData["@graph"].find((entry) => entry["@type"] === "Organization");
  assert.equal(organization.name, "IT-Tabelander");
  assert.equal(organization.brand.name, "OmniFM");

  const faqPage = structuredData["@graph"].find((entry) => entry["@type"] === "FAQPage");
  assert.ok(faqPage.mainEntity.some((entry) => /Was ist OmniFM/.test(entry.name)));
  assert.ok(faqPage.mainEntity.some((entry) => /Wer betreibt OmniFM/.test(entry.name)));

  const englishFaq = getFaqEntries("en");
  assert.ok(englishFaq.some((entry) => /Who operates OmniFM/.test(entry.question)));
});

test("SEO content strategy documents bilingual intents and page goals", () => {
  const strategy = fs.readFileSync(path.join(repoRoot, "docs", "seo-content-strategy.md"), "utf8");

  assert.match(strategy, /German Intent Map/);
  assert.match(strategy, /English Intent Map/);
  assert.match(strategy, /Discord Radio Bot/);
  assert.match(strategy, /24\/7 Discord music bot/);
  assert.match(strategy, /\/stations/);
  assert.match(strategy, /\/premium/);
  assert.match(strategy, /\/faq/);
  assert.match(strategy, /OmniFM` is the product name/);
  assert.match(strategy, /IT-Tabelander` is the operator/);
});
