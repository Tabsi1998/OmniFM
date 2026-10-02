#!/usr/bin/env node
// OmniFM: the list of bot texts still to translate (#477), src/i18n/bot/missing.json.
// Records what is open now: texts some table lacks, calls built from ${…},
// and the number of language switches outside t(). It only ever records a
// shorter list; a longer one means something new is untranslated, and that
// is fixed by translating it, not by recording it.
//
//   node scripts/record-bot-missing.mjs           record (refuses to grow)
//   node scripts/record-bot-missing.mjs --first   the very first list
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { botStrings, extractBotCalls } from "./extract-bot-strings.mjs";
import { TABLE_LANGUAGES, botTable } from "../src/lib/bot-i18n.js";

const root = fileURLToPath(new URL("..", import.meta.url));
const FILE = path.join(root, "src", "i18n", "bot", "missing.json");
const SWITCH = /(?:\bisDe|\blanguage\s*===\s*["']de["'])\s*\?\s*["'`]/g;

function languageSwitches() {
  let found = 0;
  const walk = (directory) => {
    for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
      const full = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (full !== path.join(root, "src", "api")) walk(full);
      } else if (entry.name.endsWith(".js")) {
        found += (fs.readFileSync(full, "utf8").match(SWITCH) || []).length;
      }
    }
  };
  walk(path.join(root, "src"));
  return found;
}

const next = {
  note: "Bot texts not yet in every table (#477). Only ever shorter: node scripts/record-bot-missing.mjs",
  texts: botStrings().filter((text) => TABLE_LANGUAGES.some((code) => typeof botTable(code)[text] !== "string")),
  dynamic: extractBotCalls().filter((call) => call.dynamic).map((call) => `${call.file}: ${call.en}`).sort(),
  languageSwitches: languageSwitches(),
};

if (!process.argv.includes("--first")) {
  const before = JSON.parse(fs.readFileSync(FILE, "utf8"));
  const grown = [
    ...next.texts.filter((text) => !before.texts.includes(text)).map((text) => `text: ${text}`),
    ...next.dynamic.filter((entry) => next.dynamic.filter((x) => x === entry).length > before.dynamic.filter((x) => x === entry).length).map((entry) => `\${…}: ${entry}`),
    ...(next.languageSwitches > before.languageSwitches ? [`language switches: ${before.languageSwitches} -> ${next.languageSwitches}`] : []),
  ];
  if (grown.length) {
    console.error(`The list would grow; translate these instead:\n${[...new Set(grown)].join("\n")}`);
    process.exit(1);
  }
  console.log(`texts ${before.texts.length} -> ${next.texts.length}, \${…} ${before.dynamic.length} -> ${next.dynamic.length}, switches ${before.languageSwitches} -> ${next.languageSwitches}`);
}
fs.writeFileSync(FILE, `${JSON.stringify(next, null, 2)}\n`);
