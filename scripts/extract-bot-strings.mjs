#!/usr/bin/env node
// OmniFM: the bot's texts in every language (#477).
// The bot writes its texts as t('Deutsch', 'English', params) or
// languagePick(language, 'Deutsch', 'English'); every other language looks
// the English text up in src/i18n/bot/<code>.json. This finds every such call
// under src/ (not the HTTP answers in src/api), so the tables and the test
// know what exists. A text that puts
// values in with ${…} cannot be looked up; it has to use {placeholders}.
//
//   node scripts/extract-bot-strings.mjs            list the English texts
//   node scripts/extract-bot-strings.mjs --dynamic  list the calls built from ${…}
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const SOURCE = path.join(root, "src");
// The HTTP answers to the website and the dashboard know only German and
// English so far; the bot is everything else.
const SKIP = [path.join(SOURCE, "api") + path.sep];
// Files whose texts are ["Deutsch", "English"] pairs instead of t() calls.
const PAIR_FILES = [path.join(SOURCE, "discord", "ui", "notice-catalog.js")];
const PAIR = /\[\s*("(?:[^"\\\n]|\\.)*")\s*,\s*("(?:[^"\\\n]|\\.)*")\s*[,\]]/g;
// German first, English second: the argument positions per function.
const CALLS = [
  { pattern: /(?<![\w$.])t\(/g, de: 0, en: 1 },
  { pattern: /(?<![\w$])languagePick\(/g, de: 1, en: 2 },
  { pattern: /(?<![\w$])botText\(/g, de: 1, en: 2 },
];

function walk(directory, found = []) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(full, found);
    else if (entry.name.endsWith(".js")) found.push(full);
  }
  return found;
}

/** One JS string literal at `index` (' " or `): { value, end, dynamic } or null. */
function readString(source, index) {
  const quote = source[index];
  if (!["'", '"', "`"].includes(quote)) return null;
  let value = "";
  let dynamic = false;
  for (let position = index + 1; position < source.length; position += 1) {
    const char = source[position];
    if (char === "\\") {
      const next = source[position + 1];
      const escapes = { n: "\n", t: "\t", "'": "'", '"': '"', "`": "`", "\\": "\\", $: "$" };
      if (next === "u" && source[position + 2] === "{") {
        const close = source.indexOf("}", position);
        value += String.fromCodePoint(Number.parseInt(source.slice(position + 3, close), 16));
        position = close;
      } else if (next === "u") {
        value += String.fromCharCode(Number.parseInt(source.slice(position + 2, position + 6), 16));
        position += 5;
      } else {
        value += escapes[next] ?? next;
        position += 1;
      }
      continue;
    }
    if (quote === "`" && char === "$" && source[position + 1] === "{") {
      dynamic = true;
      // Skip the expression, braces balanced; strings inside count.
      let depth = 0;
      for (position += 1; position < source.length; position += 1) {
        const inner = source[position];
        if (inner === "{") depth += 1;
        else if (inner === "}") {
          depth -= 1;
          if (depth === 0) break;
        } else if (["'", '"', "`"].includes(inner)) {
          const nested = readString(source, position);
          if (nested) position = nested.end;
        }
      }
      value += "${…}";
      continue;
    }
    if (char === quote) return { value, end: position, dynamic };
    if (quote !== "`" && char === "\n") return null;
    value += char;
  }
  return null;
}

/** The arguments of a call whose "(" is at `open`: strings read, other expressions skipped. */
function readArguments(source, open, max = 3) {
  const args = [];
  let position = open + 1;
  while (args.length < max && position < source.length) {
    while (/\s/.test(source[position])) position += 1;
    if (source[position] === ")") break;
    const literal = readString(source, position);
    let end;
    if (literal) {
      end = literal.end + 1;
      while (/\s/.test(source[end])) end += 1;
      // "a" + b and the like are expressions, not a text.
      args.push([",", ")"].includes(source[end]) ? { kind: "string", ...literal } : { kind: "expression" });
    } else {
      args.push({ kind: "expression" });
      end = position;
    }
    // On to the comma or the closing parenthesis at this level.
    let depth = 0;
    for (position = end; position < source.length; position += 1) {
      const char = source[position];
      if (["'", '"', "`"].includes(char)) {
        const skipped = readString(source, position);
        if (skipped) position = skipped.end;
        continue;
      }
      if ("([{".includes(char)) depth += 1;
      else if (")]}".includes(char)) {
        if (depth === 0) return args;
        depth -= 1;
      } else if (char === "," && depth === 0) {
        position += 1;
        break;
      }
    }
  }
  return args;
}

/** Every call with a German and an English text, with its file and line. */
export function extractBotCalls() {
  const calls = [];
  for (const file of walk(SOURCE)) {
    if (SKIP.some((prefix) => file.startsWith(prefix))) continue;
    const source = fs.readFileSync(file, "utf8");
    const relative = path.relative(root, file).split(path.sep).join("/");
    if (PAIR_FILES.includes(file)) {
      for (const match of source.matchAll(PAIR)) {
        calls.push({
          file: relative,
          line: source.slice(0, match.index).split("\n").length,
          de: JSON.parse(match[1]),
          en: JSON.parse(match[2]),
          dynamic: false,
        });
      }
    }
    for (const call of CALLS) {
      for (const match of source.matchAll(call.pattern)) {
        const open = match.index + match[0].length - 1;
        const args = readArguments(source, open, Math.max(call.de, call.en) + 1);
        const de = args[call.de];
        const en = args[call.en];
        if (de?.kind !== "string" || en?.kind !== "string") continue;
        calls.push({
          file: relative,
          line: source.slice(0, match.index).split("\n").length,
          de: de.value,
          en: en.value,
          dynamic: de.dynamic || en.dynamic,
        });
      }
    }
  }
  return calls;
}

/** The English texts the tables need, sorted. */
export function botStrings() {
  return [...new Set(extractBotCalls().filter((call) => !call.dynamic).map((call) => call.en))].sort();
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const calls = extractBotCalls();
  if (process.argv.includes("--dynamic")) {
    for (const call of calls.filter((entry) => entry.dynamic)) console.log(`${call.file}:${call.line}  ${call.en}`);
  } else {
    for (const text of botStrings()) console.log(text);
  }
  console.error(`${calls.length} calls, ${botStrings().length} texts, ${calls.filter((entry) => entry.dynamic).length} built from \${…}`);
}
