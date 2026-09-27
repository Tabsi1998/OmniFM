import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// #293: src/api stays in modules a person can read; no file over 800 lines.
const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "src", "api");
const MAX_LINES = 800;

function listJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return listJsFiles(full);
    return entry.name.endsWith(".js") ? [full] : [];
  });
}

test("no file in src/api is longer than 800 lines", () => {
  const tooLong = listJsFiles(API_DIR)
    .map((file) => ({ file: path.relative(API_DIR, file), lines: fs.readFileSync(file, "utf8").split("\n").length }))
    .filter((entry) => entry.lines > MAX_LINES);
  assert.deepEqual(tooLong, [], "split these files into route or helper modules");
});
