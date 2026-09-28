// The website and the dashboard in nine languages (#306): every language has
// every text, with the same placeholders, and nothing is left over.
import test from "node:test";
import assert from "node:assert/strict";

import { uiStrings, extractUiCalls } from "../scripts/extract-ui-strings.mjs";
import {
  LANGUAGE_CODES,
  copyFor,
  intlLocaleFor,
  loadLanguage,
  normalizeLanguage,
  ownCopyFor,
  translatorFor,
  uiTableFor,
} from "../frontend/src/i18n/languages.js";
import { PLAN_FEATURES, PLAN_ORDER } from "../src/config/plan-features.js";
import { PLAN_FEATURE_TEXTS, planCardLinesIn } from "../src/config/plan-feature-texts.js";
import { getFaqEntries, getLanguageAlternates, getPageSeo } from "../frontend/src/lib/seo.js";

const OTHER_LANGUAGES = LANGUAGE_CODES.filter((code) => code !== "de" && code !== "en");
// Identifiers the page works with, not text: they stay as in English.
const IDENTIFIERS = new Set(["key", "href", "page", "n"]);

// The seven other languages come as their own files; the tests load them all first.
const loadAll = () => Promise.all(OTHER_LANGUAGES.map((code) => loadLanguage(code)));

const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

/** Where a language's own texts differ in shape from the English ones. */
function shapeDifferences(english, own, path = "") {
  if (Array.isArray(english)) {
    if (!Array.isArray(own)) return [`${path}: should be a list`];
    if (own.length !== english.length) return [`${path}: ${own.length} entries, English has ${english.length}`];
    return english.flatMap((entry, index) => shapeDifferences(entry, own[index], `${path}[${index}]`));
  }
  if (english && typeof english === "object") {
    if (!own || typeof own !== "object" || Array.isArray(own)) return [`${path}: should be an object`];
    const found = [];
    for (const key of Object.keys(english)) {
      if (!(key in own)) found.push(`${path}.${key}: missing`);
      else if (IDENTIFIERS.has(key) && own[key] !== english[key]) found.push(`${path}.${key}: must stay ${JSON.stringify(english[key])}`);
      else found.push(...shapeDifferences(english[key], own[key], `${path}.${key}`));
    }
    for (const key of Object.keys(own)) if (!(key in english)) found.push(`${path}.${key}: not in English`);
    return found;
  }
  if (typeof own !== typeof english) return [`${path}: ${typeof own}, English has ${typeof english}`];
  if (typeof own === "string" && english.trim() && !own.trim()) return [`${path}: empty`];
  return [];
}

test("the website speaks nine languages; the rest falls back to English", () => {
  assert.deepEqual([...LANGUAGE_CODES], ["de", "en", "fr", "es", "it", "pl", "tr", "pt", "nl"]);
  assert.equal(normalizeLanguage("fr-CA"), "fr");
  assert.equal(normalizeLanguage("pt-PT"), "pt");
  assert.equal(normalizeLanguage("ja-JP"), "en");
  assert.equal(intlLocaleFor("pt"), "pt-BR");
});

test("every language has every website text, in the shape of the English one", async () => {
  await loadAll();
  for (const code of OTHER_LANGUAGES) {
    assert.deepEqual(shapeDifferences(copyFor("en"), ownCopyFor(code)), [], code);
  }
});

test("every dashboard text is translated, with its placeholders, and none is left over", async () => {
  const texts = uiStrings();
  assert.ok(texts.length > 500, "the dashboard texts are found");
  await loadAll();
  for (const code of OTHER_LANGUAGES) {
    const table = uiTableFor(code);
    assert.deepEqual(texts.filter((text) => typeof table[text] !== "string" || !table[text].trim()), [], `${code}: missing`);
    assert.deepEqual(Object.keys(table).filter((text) => !texts.includes(text)), [], `${code}: no longer used`);
    const broken = texts.filter((text) => placeholders(text).join() !== placeholders(table[text]).join());
    assert.deepEqual(broken, [], `${code}: placeholders differ`);
  }
});

test("no dashboard text is put together from pieces the tables cannot know", () => {
  assert.deepEqual(extractUiCalls().filter((call) => call.dynamic).map((call) => `${call.file}:${call.line}`), []);
});

test("the translator fills placeholders and falls back to English", async () => {
  await loadLanguage("fr");
  const t = translatorFor("fr");
  assert.equal(t("Läuft jetzt: {station}", "Now playing: {station}", { station: "Lofi" }), "En cours : Lofi");
  assert.equal(t("Gibt es nicht", "Does not exist"), "Does not exist");
  assert.equal(translatorFor("de")("Hallo {name}", "Hello {name}", { name: "Ada" }), "Hallo Ada");
});

test("the plan lines exist in every language, for every plan", () => {
  for (const code of OTHER_LANGUAGES) {
    const texts = PLAN_FEATURE_TEXTS[code];
    assert.ok(texts, code);
    assert.deepEqual(PLAN_FEATURES.map((feature) => feature.key).filter((key) => typeof texts[key] !== "function"), [], `${code}: missing lines`);
    assert.equal(typeof texts.intro, "function", `${code}: intro`);
    const english = PLAN_ORDER.map((plan) => planCardLinesIn(plan, { language: "en" }));
    PLAN_ORDER.forEach((plan, index) => {
      const card = planCardLinesIn(plan, { language: code, context: { freeStations: 20, allStations: 120 } });
      assert.equal(card.lines.length, english[index].lines.length, `${code} ${plan}: as many lines as English`);
      assert.ok(card.lines.every((line) => line.trim()), `${code} ${plan}: no empty line`);
      if (plan !== "free") assert.match(card.intro, /Free|Pro/, `${code} ${plan}: intro names the plan below`);
    });
  }
});

test("each language has its own titles, address and FAQ for search engines", async () => {
  await loadAll();
  for (const code of OTHER_LANGUAGES) {
    const seo = getPageSeo("premium", code);
    assert.equal(seo.language, code);
    assert.equal(seo.canonicalUrl, `https://omnifm.xyz/premium?lang=${code}`);
    assert.notEqual(seo.title, getPageSeo("premium", "en").title, `${code}: own title`);
    assert.equal(getFaqEntries(code).length, getFaqEntries("en").length);
  }
  assert.equal(getPageSeo("imprint", "de").canonicalUrl, "https://omnifm.xyz/impressum", "German keeps its addresses");
  const alternates = Object.fromEntries(getLanguageAlternates("imprint").map((entry) => [entry.hreflang, entry.href]));
  assert.equal(Object.keys(alternates).length, LANGUAGE_CODES.length + 1, "every language plus x-default");
  assert.equal(alternates.de, "https://omnifm.xyz/impressum");
  assert.equal(alternates.fr, "https://omnifm.xyz/imprint?lang=fr");
  assert.equal(alternates["pt-BR"], "https://omnifm.xyz/imprint?lang=pt");
  assert.equal(alternates["x-default"], "https://omnifm.xyz/imprint");
});
