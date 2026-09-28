import test from "node:test";
import assert from "node:assert/strict";

// #306: the slash commands in French, Spanish, Italian, Polish, Turkish,
// Brazilian Portuguese and Dutch. Every language has every description, the
// tokens the commands read stay as they are, and no translation is left over.
const { buildCommandsJson } = await import("../src/commands.js");
const { COMMAND_LOCALE_FILES, commandTranslationTable } = await import("../src/config/command-translations.js");

const LOCALES = Object.keys(COMMAND_LOCALE_FILES);
const FILES = [...new Set(Object.values(COMMAND_LOCALE_FILES))];
const TOKENS = [/\{[a-z]+\}/g, /HH:MM/g, /DD\.MM\.YYYY/g, /YYYY-MM-DD/g, /today\/tomorrow/g, /\bclear\b/g, /OMNI-XXXX-XXXX-XXXX/g, /\[(Pro|Ultimate)\]/g, /\//g];

/** Every description and every choice of the commands, with their localizations. */
function allTexts() {
  const texts = [];
  const visit = (node, path) => {
    texts.push({ kind: "description", path, english: node.description, localized: node.description_localizations || {} });
    for (const option of node.options || []) {
      visit(option, `${path} ${option.name}`);
      for (const choice of option.choices || []) {
        texts.push({ kind: "choice", path: `${path} ${option.name}=${choice.value}`, english: choice.name, localized: choice.name_localizations || {} });
      }
    }
  };
  for (const command of buildCommandsJson()) visit(command, `/${command.name}`);
  return texts;
}

test("every language has every description of every command, subcommand and option", () => {
  const missing = [];
  for (const text of allTexts().filter((entry) => entry.kind === "description")) {
    for (const locale of LOCALES) {
      if (!text.localized[locale]) missing.push(`${locale} ${text.path}: ${text.english}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("choices whose German name differs have every language; numbers stay numbers", () => {
  const missing = [];
  for (const text of allTexts().filter((entry) => entry.kind === "choice")) {
    const needs = text.localized.de && text.localized.de !== text.english;
    for (const locale of LOCALES) {
      if (needs && !text.localized[locale]) missing.push(`${locale} ${text.path}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("translations fit Discord, keep the tokens the commands read, and none is left over", () => {
  const used = new Set(allTexts().map((text) => text.english));
  for (const file of FILES) {
    const table = commandTranslationTable(file);
    for (const [english, translated] of Object.entries(table)) {
      assert.ok(used.has(english), `${file}: "${english}" is not a text of the commands any more`);
      assert.ok(translated.length >= 1 && translated.length <= 100, `${file}: "${translated}" must be 1-100 characters`);
      assert.notEqual(translated.trim(), "", `${file}: "${english}"`);
      for (const pattern of TOKENS) {
        const want = (english.match(pattern) || []).length;
        const got = (translated.match(pattern) || []).length;
        assert.equal(got, want, `${file}: "${translated}" keeps ${pattern} from "${english}"`);
      }
    }
  }
});

test("the Spanish of Spain also serves Latin America, and German stays next to the English", () => {
  const play = buildCommandsJson().find((command) => command.name === "play");
  assert.equal(play.description_localizations["es-419"], play.description_localizations["es-ES"]);
  assert.equal(play.description_localizations.de, "Startet einen Radio-Stream in deinem Voice-Channel");
  assert.equal(play.description_localizations.fr, "Lancer une radio dans ton salon vocal");
  const sleep = buildCommandsJson().find((command) => command.name === "sleep");
  const duration = sleep.options.find((option) => option.name === "duration");
  assert.deepEqual(duration.choices.find((choice) => choice.value === "15").name_localizations, { de: "15 min" }, "numbers are not translated");
  assert.equal(duration.choices.find((choice) => choice.value === "off").name_localizations.nl, "Uit");
});

test("every command stays within Discord's 4000 characters, counting the longest language of each field", () => {
  const longest = (text, localized = {}) => Math.max(String(text || "").length, ...Object.values(localized || {}).map((value) => String(value).length));
  const size = (node) => {
    let total = longest(node.name, node.name_localizations) + longest(node.description, node.description_localizations);
    for (const option of node.options || []) {
      total += size(option);
      for (const choice of option.choices || []) total += longest(choice.name, choice.name_localizations) + String(choice.value).length;
    }
    return total;
  };
  for (const command of buildCommandsJson()) assert.ok(size(command) <= 4000, `/${command.name}: ${size(command)} characters`);
});
