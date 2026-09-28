// ============================================================
// OmniFM: the slash commands in more languages (#306)
// ============================================================
// One JSON file per language in command-translations/, keyed by the English
// text of commands.js, so anyone can add or fix a language without touching
// code. German stays in commands.js next to the English. A text without a
// translation shows in English in that language, as Discord does anyway.
// Format tokens stay as they are in every language: HH:MM, DD.MM.YYYY,
// {event}, today/tomorrow and clear are what the commands read.
import fs from "node:fs";
import { fileURLToPath } from "node:url";

/** Discord locale -> translation file. Spanish serves Spain and Latin America. */
export const COMMAND_LOCALE_FILES = Object.freeze({
  fr: "fr",
  "es-ES": "es",
  "es-419": "es",
  it: "it",
  pl: "pl",
  tr: "tr",
  "pt-BR": "pt-BR",
  nl: "nl",
});

const tables = Object.fromEntries([...new Set(Object.values(COMMAND_LOCALE_FILES))].map((file) => [
  file,
  JSON.parse(fs.readFileSync(fileURLToPath(new URL(`./command-translations/${file}.json`, import.meta.url)), "utf8")),
]));

/** The translation table of one file, e.g. "fr". */
export function commandTranslationTable(file) {
  return tables[file] || {};
}

/**
 * The localizations of one text: German as given, the other languages from
 * their files.
 * @param {string} english
 * @param {string} [german]
 * @returns {Record<string, string>}
 */
export function commandLocalizations(english, german) {
  /** @type {Record<string, string>} */
  const out = {};
  if (german) out.de = german;
  for (const [locale, file] of Object.entries(COMMAND_LOCALE_FILES)) {
    const text = tables[file]?.[english];
    if (text) out[locale] = text;
  }
  return out;
}
