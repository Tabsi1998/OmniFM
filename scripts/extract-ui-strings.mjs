#!/usr/bin/env node
// OmniFM: the texts of the dashboard in every language (#306).
// The dashboard writes its texts as t('Deutsch', 'English', params); every
// other language looks the English text up in frontend/src/i18n/ui/<code>.json.
// This finds every such call, so the tables and the test know what exists.
//
//   node scripts/extract-ui-strings.mjs            list the English texts
//   node scripts/extract-ui-strings.mjs --dynamic  list calls built from ${…} (must be none)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SOURCES = [path.join(root, "frontend", "src", "components"), path.join(root, "frontend", "src", "lib")];
// Labels written as { de: '…', en: '…' } and passed to t(label.de, label.en),
// in the dashboard and in the plan file's capability names.
const LABEL_FILES = [path.join(root, "src", "config", "plan-features.js")];
// The owner console is German only; its texts are not part of the site's languages.
const SKIP = [/\.test\.js$/, /[\\/]owner[\\/]/, /Owner[A-Z][A-Za-z]*\.js$/];

function walk(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (entry.name.endsWith(".js") && !SKIP.some((pattern) => pattern.test(full))) found.push(full);
  }
  return found;
}

/** Reads one JS string literal at `index` (' " or `); returns { value, end, dynamic } or null. */
function readString(source, index) {
  const quote = source[index];
  if (!["'", '"', "`"].includes(quote)) return null;
  let value = "";
  let dynamic = false;
  for (let position = index + 1; position < source.length; position += 1) {
    const char = source[position];
    if (char === "\\") {
      const next = source[position + 1];
      const escapes = { n: "\n", t: "\t", "'": "'", '"': '"', "`": "`", "\\": "\\" };
      if (next === "u") {
        const hex = source.slice(position + 2, position + 6);
        value += String.fromCharCode(Number.parseInt(hex, 16));
        position += 5;
      } else {
        value += escapes[next] ?? next;
        position += 1;
      }
      continue;
    }
    if (quote === "`" && char === "$" && source[position + 1] === "{") dynamic = true;
    if (char === quote) return { value, end: position + 1, dynamic };
    value += char;
  }
  return null;
}

/** Every t(german, english[, params]) call of the dashboard. */
export function extractUiCalls() {
  const calls = [];
  for (const file of SOURCES.flatMap((directory) => walk(directory))) {
    const source = fs.readFileSync(file, "utf8");
    const pattern = /(?<![\w.$])t\(\s*/g;
    for (const match of source.matchAll(pattern)) {
      const german = readString(source, match.index + match[0].length);
      if (!german) continue;
      let cursor = german.end;
      while (/\s/.test(source[cursor])) cursor += 1;
      if (source[cursor] !== ",") continue;
      cursor += 1;
      while (/\s/.test(source[cursor])) cursor += 1;
      const english = readString(source, cursor);
      if (!english) continue;
      const line = source.slice(0, match.index).split("\n").length;
      calls.push({ file: path.relative(root, file).replace(/\\/g, "/"), line, german: german.value, english: english.value, dynamic: german.dynamic || english.dynamic });
    }
  }
  return calls;
}

/** Every { de: '…', en: '…' } label, in the dashboard and the plan file. */
export function extractLabelPairs() {
  const pairs = [];
  for (const file of [...SOURCES.flatMap((directory) => walk(directory)), ...LABEL_FILES]) {
    const source = fs.readFileSync(file, "utf8");
    for (const match of source.matchAll(/(?<![\w$])de:\s*/g)) {
      const german = readString(source, match.index + match[0].length);
      if (!german) continue;
      let cursor = german.end;
      while (/\s/.test(source[cursor])) cursor += 1;
      if (source[cursor] !== ",") continue;
      cursor += 1;
      while (/\s/.test(source[cursor])) cursor += 1;
      if (!source.startsWith("en:", cursor)) continue;
      cursor += 3;
      while (/\s/.test(source[cursor])) cursor += 1;
      const english = readString(source, cursor);
      if (!english) continue;
      pairs.push({ file: path.relative(root, file).replace(/\\/g, "/"), german: german.value, english: english.value, dynamic: german.dynamic || english.dynamic });
    }
  }
  return pairs;
}

/** The English texts a language table needs, each once. */
export function uiStrings() {
  const texts = [...extractUiCalls(), ...extractLabelPairs()].filter((entry) => !entry.dynamic).map((entry) => entry.english);
  return [...new Set(texts)].sort();
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  if (process.argv.includes("--dynamic")) {
    for (const call of extractUiCalls().filter((entry) => entry.dynamic)) console.log(`${call.file}:${call.line}  ${call.english}`);
  } else {
    const strings = uiStrings();
    for (const text of strings) console.log(text);
    console.error(`${strings.length} texts`);
  }
}
