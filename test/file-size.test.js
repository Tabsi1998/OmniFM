import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #293, #295, #296: files a person can read. A file in src/ or frontend/src/
// has at most 800 lines. KNOWN_LONG_FILES is the way to let a file in only for
// a while: it may not grow and leaves the list once it is split (the test
// says when).
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MAX_LINES = 800;
const SOURCE_DIRS = ["src", "frontend/src"];
const KNOWN_LONG_FILES = {};

function listSourceFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listSourceFiles(full);
    return /\.(m?jsx?)$/.test(entry.name) ? [full] : [];
  });
}

function lineCount(file) {
  const text = fs.readFileSync(file, "utf8");
  const lines = text.split("\n").length;
  return text.endsWith("\n") ? lines - 1 : lines;
}

test("no source file grows past 800 lines, and the long ones do not grow", () => {
  const problems = [];
  for (const dir of SOURCE_DIRS) {
    for (const file of listSourceFiles(path.join(ROOT, dir))) {
      const rel = path.relative(ROOT, file).replaceAll("\\", "/");
      const lines = lineCount(file);
      const known = KNOWN_LONG_FILES[rel];
      if (known !== undefined && lines > known) problems.push(`${rel}: ${lines} lines, was ${known}; split it instead of growing it`);
      if (known === undefined && lines > MAX_LINES) problems.push(`${rel}: ${lines} lines, more than ${MAX_LINES}; split it into topic modules`);
    }
  }
  assert.deepEqual(problems, []);
});

test("a split file leaves the list of long files", () => {
  const stale = Object.entries(KNOWN_LONG_FILES)
    .filter(([rel]) => !fs.existsSync(path.join(ROOT, rel)) || lineCount(path.join(ROOT, rel)) <= MAX_LINES)
    .map(([rel]) => rel);
  assert.deepEqual(stale, [], "remove these from KNOWN_LONG_FILES");
});
