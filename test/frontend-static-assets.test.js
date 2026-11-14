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
  const frontendPackage = JSON.parse(
    fs.readFileSync(path.join(repoRoot, "frontend", "package.json"), "utf8")
  );

  assert.equal(frontendPackage.devDependencies["react-scripts"], undefined);
  // Vite must stay pinned to one exact version so every deployment builds
  // with the same toolchain; the version itself moves with dependency updates.
  assert.match(frontendPackage.devDependencies.vite, /^\d+\.\d+\.\d+$/);
  assert.ok(Number(frontendPackage.devDependencies.vite.split(".")[0]) >= 8);
  assert.equal(frontendPackage.scripts.build, "vite build");

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
    fs.existsSync(path.join(repoRoot, "web")),
    false,
    "the legacy standalone web/ folder was removed in the rework and must not come back"
  );
});

test("Vite entry document references the React mount and module entry", () => {
  const indexHtml = fs.readFileSync(
    path.join(repoRoot, "frontend", "index.html"),
    "utf8"
  );

  assert.match(indexHtml, /<div id="root"><\/div>/);
  assert.match(indexHtml, /<script type="module" src="\/src\/index\.js"><\/script>/);
  assert.doesNotMatch(indexHtml, /src=["']\/app\.js["']/i);
  assert.doesNotMatch(indexHtml, /href=["']\/styles\.css["']/i);
  assert.equal(
    fs.existsSync(path.join(repoRoot, "frontend", "public", "index.html")),
    false,
    "Vite must have a single root entry document"
  );
});

test("pages behind a login are noindex, public pages stay indexable (#528)", () => {
  for (const page of ["dashboard", "dashboard-classic", "dashboard-studio", "admin"]) {
    for (const language of ["de", "en", "fr"]) {
      assert.equal(getPageSeo(page, language).robots, "noindex,follow", `${page} (${language})`);
    }
  }
  for (const page of ["home", "stations", "premium", "faq", "start", "imprint", "privacy", "terms", "charts", "status"]) {
    assert.equal(getPageSeo(page, "en").robots, "index,follow", page);
  }
});

test("React SEO assets and base metadata are present", () => {
  const publicDir = path.join(repoRoot, "frontend", "public");
  const indexHtml = fs.readFileSync(path.join(repoRoot, "frontend", "index.html"), "utf8");
  const robotsTxt = fs.readFileSync(path.join(publicDir, "robots.txt"), "utf8");
  const sitemapXml = fs.readFileSync(path.join(publicDir, "sitemap.xml"), "utf8");
  const manifest = JSON.parse(fs.readFileSync(path.join(publicDir, "manifest.json"), "utf8"));

  // No static canonical or og:url: the bare address is only the x-default,
  // seo.js sets the page's own address (#529). 404.html and noindex.html are copies.
  assert.doesNotMatch(indexHtml, /rel="canonical"|property="og:url"/);
  assert.match(indexHtml, /<meta name="google-site-verification" content="2ZCoKiPvrZJ_fKLyyE4SDbATwbL6yDX-iwI82ghmpSM" \/>/);
  assert.doesNotMatch(indexHtml, /googletagmanager\.com\/gtag\/js/i, "analytics must load only after explicit consent");
  assert.doesNotMatch(indexHtml, /gtag\(['"]config['"]/i, "the static document must not initialize tracking");
  assert.match(indexHtml, /property="og:title"/);
  assert.match(indexHtml, /name="twitter:card"/);
  assert.match(indexHtml, /application\/ld\+json/);
  assert.match(indexHtml, /"@type": "SoftwareApplication"/);
  assert.match(indexHtml, /"@type": "FAQPage"/);

  assert.match(robotsTxt, /User-agent: \*/);
  assert.match(robotsTxt, /Sitemap: https:\/\/omnifm\.xyz\/sitemap\.xml/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/\?lang=de<\/loc>/);
  assert.doesNotMatch(sitemapXml, /omnifm\.xyz\/(dashboard|admin)/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/stations\?lang=de<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/premium\?lang=de<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/faq\?lang=de<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/start\?lang=de<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/impressum\?lang=de<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/datenschutz\?lang=de<\/loc>/);
  assert.match(sitemapXml, /<loc>https:\/\/omnifm\.xyz\/nutzungsbedingungen\?lang=de<\/loc>/);
  assert.equal(manifest.name, "OmniFM");
  // The installed app opens the dashboard (#305); the id keeps an earlier install the same app.
  assert.equal(manifest.start_url, "/dashboard");
  assert.equal(manifest.id, "/");
  assert.ok(manifest.icons.some((icon) => icon.purpose === "maskable" && icon.sizes === "512x512"), "a maskable icon for Android");
  assert.ok(manifest.icons.length > 0, "the manifest declares icons");
  for (const icon of manifest.icons) {
    // Width and height of a PNG sit in its IHDR chunk at bytes 16-23. The
    // declared size must be the real one; a landscape picture once stood
    // here labelled 512x512 (#258).
    const png = fs.readFileSync(path.join(publicDir, icon.src));
    const size = `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
    assert.equal(icon.type, "image/png", icon.src);
    assert.equal(size, icon.sizes, `${icon.src} is ${size}, the manifest says ${icon.sizes}`);
  }
});

test("SEO helper returns route-specific canonical metadata and structured data", () => {
  const homeSeo = getPageSeo("home", "en");
  assert.equal(homeSeo.canonicalUrl, "https://omnifm.xyz/?lang=en");
  assert.match(homeSeo.title, /24\/7 Radio/);

  const imprintSeo = getPageSeo("imprint", "de");
  assert.equal(imprintSeo.canonicalUrl, "https://omnifm.xyz/impressum?lang=de");
  assert.match(imprintSeo.description, /Pflichtangaben/);

  const privacySeo = getPageSeo("privacy", "en");
  assert.equal(privacySeo.canonicalUrl, "https://omnifm.xyz/privacy?lang=en");
  assert.match(privacySeo.title, /Privacy policy/);

  const stationsSeo = getPageSeo("stations", "de");
  assert.equal(stationsSeo.canonicalUrl, "https://omnifm.xyz/stations?lang=de");
  assert.match(stationsSeo.title, /Stationen/);
  assert.match(stationsSeo.description, /Discord-Radio/);

  const premiumSeo = getPageSeo("premium", "en");
  assert.equal(premiumSeo.canonicalUrl, "https://omnifm.xyz/premium?lang=en");
  assert.match(premiumSeo.title, /Free, Pro and Ultimate/);
  assert.match(premiumSeo.description, /audio quality/i);

  const faqSeo = getPageSeo("faq", "de");
  assert.equal(faqSeo.canonicalUrl, "https://omnifm.xyz/faq?lang=de");
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

test("SEO content strategy documents bilingual intents and page goals", { skip: "docs/ wurde beim Rework entfernt — SEO-Intents leben jetzt in frontend/src/lib/seo.js" }, () => {});
