// ============================================================
// OmniFM: the bot's nine languages (#477)
// ============================================================
// The bot writes every text in German and English with t(de, en). The other seven
// languages of the website (#306) look the English text up in
// src/i18n/bot/<code>.json, like the dashboard's tables; a text a table does
// not have yet shows in English. Values go into a text as placeholders, so
// each language keeps its own word order:
//   German "Läuft jetzt: {station}", English "Now playing: {station}", params { station }
// scripts/extract-bot-strings.mjs finds every text; test/bot-languages.test.js
// checks the tables.
import fs from "node:fs";

export const BOT_LANGUAGES = Object.freeze(["de", "en", "fr", "es", "it", "pl", "tr", "pt", "nl"]);
/** The languages that come from a table; German and English are written in the code. */
export const TABLE_LANGUAGES = Object.freeze(BOT_LANGUAGES.filter((code) => code !== "de" && code !== "en"));
/** Each language's own name, for /language and the dashboard. */
export const BOT_LANGUAGE_NAMES = Object.freeze({
  de: "Deutsch",
  en: "English",
  fr: "Français",
  es: "Español",
  it: "Italiano",
  pl: "Polski",
  tr: "Türkçe",
  pt: "Português",
  nl: "Nederlands",
});
const LOCALES = Object.freeze({
  de: "de-DE", en: "en-US", fr: "fr-FR", es: "es-ES", it: "it-IT", pl: "pl-PL", tr: "tr-TR", pt: "pt-BR", nl: "nl-NL",
});

/** A language code or a Discord locale ("es-419", "pt-BR") as one of the nine, else the fallback. */
export function normalizeBotLanguage(input, fallback = "en") {
  const code = String(input || "").trim().toLowerCase().split(/[-_]/)[0];
  if (BOT_LANGUAGES.includes(code)) return code;
  return BOT_LANGUAGES.includes(fallback) ? fallback : "en";
}

/** The locale for dates and numbers in a language. */
export function botLocale(language) {
  return LOCALES[normalizeBotLanguage(language)];
}

const tables = new Map();

/** One language's table, read once; a missing or broken file is an empty table. */
export function botTable(language) {
  if (!TABLE_LANGUAGES.includes(language)) return null;
  if (!tables.has(language)) {
    let table;
    try {
      table = JSON.parse(fs.readFileSync(new URL(`../i18n/bot/${language}.json`, import.meta.url), "utf8"));
    } catch {
      table = {};
    }
    tables.set(language, table && typeof table === "object" ? table : {});
  }
  return tables.get(language);
}

/** {name} filled from params; a placeholder without a value stays as it is. */
export function fillPlaceholders(text, params) {
  if (!params || typeof text !== "string") return text;
  return text.replace(/\{(\w+)\}/g, (match, key) => (Object.prototype.hasOwnProperty.call(params, key) ? String(params[key]) : match));
}

/**
 * A text in a language: the German or the English one from the code, or the
 * English text's translation from the table.
 * @param {string} language
 * @param {any} de
 * @param {any} en
 * @param {Record<string, unknown>} [params]
 */
export function botText(language, de, en, params) {
  const lang = normalizeBotLanguage(language);
  let text = en;
  if (lang === "de") text = de;
  else if (lang !== "en" && typeof en === "string") text = botTable(lang)?.[en] ?? en;
  return fillPlaceholders(text, params);
}

/**
 * t(de, en, params) for one language.
 * @param {string} language
 * @returns {(de: any, en: any, params?: Record<string, unknown>) => any}
 */
export function botTranslator(language) {
  const lang = normalizeBotLanguage(language);
  return (de, en, params) => botText(lang, de, en, params);
}
