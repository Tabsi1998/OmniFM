#!/usr/bin/env node
// Lint ratchet (#209). Runs ESLint over the repository (eslint.config.js) and
// compares the findings with the "eslint" list in scripts/ci-baseline.json.
// A finding is identified by file, rule and its number within that pair, so
// moving code around does not count as a new finding. New findings fail,
// resolved ones pass and are reported so the baseline can shrink.
//
//   npm run lint                check against the baseline
//   npm run lint -- --record    accept the current findings as the baseline
//   npm run lint:fix            let ESLint fix what it can
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = fileURLToPath(new URL("..", import.meta.url));
const baselinePath = path.join(root, "scripts", "ci-baseline.json");
const record = process.argv.includes("--record");

const eslint = new ESLint({ cwd: root });
const results = await eslint.lintFiles(["."]);

const byFileAndRule = new Map();
const unparsable = [];
for (const result of results) {
  const file = path.relative(root, result.filePath).split(path.sep).join("/");
  for (const message of result.messages) {
    if (message.fatal) {
      unparsable.push(`${file}:${message.line}: ${message.message}`);
      continue;
    }
    // Reports without a rule are about disable comments that no longer match.
    const rule = message.ruleId || "unused-disable-directive";
    const key = `${file}::${rule}`;
    if (!byFileAndRule.has(key)) byFileAndRule.set(key, []);
    byFileAndRule.get(key).push(`${file}:${message.line}:${message.column} ${rule}: ${message.message}`);
  }
}

// A file ESLint cannot parse is never debt.
if (unparsable.length) {
  console.error(`ESLint cannot parse ${unparsable.length} places:\n  ${unparsable.join("\n  ")}`);
  process.exit(1);
}

const found = new Set();
for (const [key, lines] of byFileAndRule) {
  lines.forEach((_, index) => found.add(`${key}::${index + 1}`));
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));

if (record) {
  baseline.eslint = [...found].sort();
  const sorted = Object.fromEntries(Object.keys(baseline).sort().map((key) => [key, baseline[key]]));
  fs.writeFileSync(baselinePath, `${JSON.stringify(sorted, null, 2)}\n`);
  console.log(`baseline recorded: ${found.size} ESLint findings`);
  process.exit(0);
}

const known = new Set(baseline.eslint || []);
const added = [...found].filter((id) => !known.has(id)).sort();
if (added.length) {
  const keys = [...new Set(added.map((id) => id.split("::").slice(0, 2).join("::")))];
  console.error(`${added.length} new ESLint findings. Every finding of the affected file and rule:`);
  for (const key of keys) {
    for (const line of byFileAndRule.get(key)) console.error(`  ${line}`);
  }
  console.error("Fix them, or run `npm run lint -- --record` to accept them into scripts/ci-baseline.json.");
  process.exit(1);
}

const resolved = [...known].filter((id) => !found.has(id)).length;
let summary = found.size ? `${found.size} known ESLint findings` : "no ESLint findings";
if (resolved) summary += `; ${resolved} resolved since the baseline, run \`npm run lint -- --record\` to lock that in`;
console.log(summary);
