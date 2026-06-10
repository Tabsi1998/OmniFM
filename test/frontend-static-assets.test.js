import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { buildStructuredData, getPageSeo } from "../frontend/src/lib/seo.js";

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
  assert.match(indexHtml, /property="og:title"/);
  assert.match(indexHtml, /name="twitter:card"/);
  assert.match(indexHtml, /application\/ld\+json/);
  assert.match(indexHtml, /"@type": "SoftwareApplication"/);
  assert.match(indexHtml, /"@type": "FAQPage"/);

  assert.match(robotsTxt, /User-agent: \*/);
  assert.match(robotsTxt, /Sitemap: https:\/\/omnifm\.xyz\/sitemap\.xml/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/dashboard<\/loc>/);
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

  const structuredData = buildStructuredData(homeSeo);
  const types = structuredData["@graph"].map((entry) => entry["@type"]);
  assert.ok(types.includes("Organization"));
  assert.ok(types.includes("WebSite"));
  assert.ok(types.includes("SoftwareApplication"));
  assert.ok(types.includes("FAQPage"));
});
