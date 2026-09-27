import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #293, #295: files a person can read. A file in src/ has at most 800
// lines. The ones below were longer before the limit; they may not grow and
// leave this list once they are split (the test says when).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LINES = 800;
const KNOWN_LONG_FILES = {
  "src/bot/runtime.js": 1474,
  "src/bot/runtime-recovery.js": 1357,
  "src/bot/runtime-streams.js": 1200,
  "src/bot/now-playing/now-playing-methods.js": 1161,
  "src/bot/runtime-panels.js": 1141,
  "src/bot/runtime-events.js": 1043,
  "src/premium-cli.js": 1007,
  "src/services/payment.js": 961,
  "src/bot/commands/playback-commands.js": 897,
};

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(m?js)$/.test(entry.name) ? [full] : [];
  });
}

function lineCount(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

test("no file in src/ grows past 800 lines, and the long ones do not grow", () => {
  const problems = [];
  for (const file of listSourceFiles(path.join(ROOT, "src"))) {
    const rel = path.relative(ROOT, file).replaceAll("\\", "/");
    const lines = lineCount(file);
    const known = KNOWN_LONG_FILES[rel];
    if (known !== undefined && lines > known) problems.push(`${rel}: ${lines} lines, was ${known}; split it instead of growing it`);
    if (known === undefined && lines > MAX_LINES) problems.push(`${rel}: ${lines} lines, more than ${MAX_LINES}; split it into topic modules`);
  }
  assert.deepEqual(problems, []);
});

test("a split file leaves the list of long files", () => {
  const stale = Object.entries(KNOWN_LONG_FILES)
    .filter(([rel]) => !fs.existsSync(path.join(ROOT, rel)) || lineCount(path.join(ROOT, rel)) <= MAX_LINES)
    .map(([rel]) => rel);
  assert.deepEqual(stale, [], "remove these from KNOWN_LONG_FILES");
});
