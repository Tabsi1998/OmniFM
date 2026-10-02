import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// The bot in nine languages (#477): German and English in the code, the
// other seven in src/i18n/bot/<code>.json keyed by the English text. Until
// every text is translated, src/i18n/bot/missing.json lists what is still
// open; that list may only get shorter.
const {
  BOT_LANGUAGES, TABLE_LANGUAGES, botLocale, botTable, botText, botTranslator, fillPlaceholders, normalizeBotLanguage,
} = await import("../src/lib/bot-i18n.js");
const { botStrings, extractBotCalls } = await import("../scripts/extract-bot-strings.mjs");
const { languagePick, resolveLanguageFromDiscordLocale } = await import("../src/lib/language.js");

const root = fileURLToPath(new URL("..", import.meta.url));
const missing = JSON.parse(fs.readFileSync(path.join(root, "src/i18n/bot/missing.json"), "utf8"));
const placeholders = (text) => [...String(text).matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

test("a Discord locale becomes one of the nine languages; any other is English", () => {
  assert.deepEqual(BOT_LANGUAGES, ["de", "en", "fr", "es", "it", "pl", "tr", "pt", "nl"]);
  for (const [locale, language] of [["de", "de"], ["en-GB", "en"], ["en-US", "en"], ["fr", "fr"], ["es-ES", "es"], ["es-419", "es"], ["it", "it"], ["pl", "pl"], ["tr", "tr"], ["pt-BR", "pt"], ["nl", "nl"], ["ja", "en"], ["sv-SE", "en"]]) {
    assert.equal(resolveLanguageFromDiscordLocale(locale), language, locale);
  }
  assert.equal(normalizeBotLanguage("", "de"), "de", "no locale: the fallback");
  assert.equal(botLocale("pt"), "pt-BR");
  assert.equal(botLocale("fr"), "fr-FR");
});

test("t(de, en, params): German, English, or the English text's translation, with placeholders filled", () => {
  const [some] = Object.entries(botTable("fr") || {});
  if (some) {
    assert.equal(botText("fr", "x", some[0]), some[1], "a translated text comes from the table");
  }
  assert.equal(botText("fr", "Nur deutsch", "Not in any table"), "Not in any table", "a missing translation shows in English");
  const t = botTranslator("de");
  assert.equal(t("Läuft: {station}", "Playing: {station}", { station: "Groove Salad" }), "Läuft: Groove Salad");
  assert.equal(botTranslator("en")("Läuft: {station}", "Playing: {station}", { station: "Groove Salad" }), "Playing: Groove Salad");
  assert.equal(fillPlaceholders("Use {station} in the template", null), "Use {station} in the template", "without params braces stay");
  assert.equal(fillPlaceholders("{a} and {b}", { a: 1 }), "1 and {b}", "a placeholder without a value stays");
  assert.equal(languagePick("de", "Ja", "Yes"), "Ja");
  assert.equal(languagePick("xx", "Ja", "Yes"), languagePick("", "Ja", "Yes"), "an unknown language is the installation's default");
  assert.equal(botText("fr", { de: 1 }, { en: 2 }).en, 2, "something that is not a text passes through");
});

test("every bot text is translated in every language, except what is still listed as missing", () => {
  const texts = botStrings();
  assert.ok(texts.length > 500, "the bot's texts are found");
  const textSet = new Set(texts);
  const open = new Set(missing.texts);
  for (const code of TABLE_LANGUAGES) {
    const table = botTable(code);
    assert.ok(table, `${code}: a table`);
    assert.deepEqual(texts.filter((text) => !open.has(text) && (typeof table[text] !== "string" || !table[text].trim())), [], `${code}: missing translations`);
    assert.deepEqual(Object.keys(table).filter((text) => !textSet.has(text)), [], `${code}: no longer used`);
    assert.deepEqual(Object.keys(table).filter((text) => placeholders(text).join() !== placeholders(table[text]).join()), [], `${code}: placeholders differ`);
  }
  assert.deepEqual(missing.texts.filter((text) => !textSet.has(text)), [], "listed as missing but no longer in the code: remove them from missing.json");
  assert.deepEqual(
    missing.texts.filter((text) => TABLE_LANGUAGES.every((code) => typeof botTable(code)[text] === "string")),
    [],
    "listed as missing but translated in every language: remove them from missing.json",
  );
});

test("no new text built from ${…}: values go in as {placeholders}; the list only shrinks", () => {
  const dynamic = extractBotCalls().filter((call) => call.dynamic).map((call) => `${call.file}: ${call.en}`).sort();
  const listed = [...missing.dynamic].sort();
  const count = (list) => list.reduce((map, entry) => map.set(entry, (map.get(entry) || 0) + 1), new Map());
  const now = count(dynamic);
  const before = count(listed);
  assert.deepEqual([...now].filter(([entry, n]) => n > (before.get(entry) || 0)).map(([entry]) => entry), [], "new texts built from ${…}");
  assert.deepEqual([...before].filter(([entry, n]) => n > (now.get(entry) || 0)).map(([entry]) => entry), [], "fixed: remove them from missing.json");
});

test("every translator is botTranslator, so placeholders are always filled", () => {
  // (de, en) => …, (german, english) => … and (...parts) => parts[0] are translators of their own.
  const own = /\(\s*_?(?:de|german)\s*,\s*_?(?:en|english)\s*\)\s*=>|\(\s*\.\.\.(\w+)\s*\)\s*=>\s*\1\[0\]/;
  const found = [];
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.name.endsWith(".js") && own.test(fs.readFileSync(full, "utf8"))) found.push(path.relative(root, full));
    }
  };
  walk(path.join(root, "src"));
  assert.deepEqual(found, [], "use botTranslator(language) from src/lib/bot-i18n.js");
});

test("no new language switch outside t(): isDe ? \"…\" : \"…\" stays English in the other languages", () => {
  const pattern = /(?:\bisDe|\blanguage\s*===\s*["']de["'])\s*\?\s*["'`]/g;
  let found = 0;
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (full !== path.join(root, "src", "api")) walk(full);
      } else if (entry.name.endsWith(".js")) {
        found += (fs.readFileSync(full, "utf8").match(pattern) || []).length;
      }
    }
  };
  walk(path.join(root, "src"));
  assert.ok(found <= missing.languageSwitches, `${found} language switches outside t(), the list allows ${missing.languageSwitches}`);
  assert.equal(found, missing.languageSwitches, `fewer language switches now: set languageSwitches in missing.json to ${found}`);
});
