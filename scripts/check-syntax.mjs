#!/usr/bin/env node
// Parses every JavaScript module under src/ and scripts/ with `node --check`.
// It replaces the list of 150 files kept by hand in package.json (#209): a new
// module is checked without anyone remembering to add it. start.sh runs it
// before switching a deployment, so it needs nothing but Node.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const DIRECTORIES = ["src", "scripts"];
const EXTENSIONS = new Set([".js", ".mjs"]);

function collect(directory, found) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) collect(full, found);
    else if (EXTENSIONS.has(path.extname(entry.name))) found.push(full);
  }
  return found;
}

function parse(file) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["--check", file], { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.on("close", (code) => resolve({ file, code, stderr }));
  });
}

const files = DIRECTORIES
  .filter((directory) => fs.existsSync(path.join(root, directory)))
  .flatMap((directory) => collect(path.join(root, directory), []))
  .sort();
const failures = [];
let next = 0;

async function worker() {
  while (next < files.length) {
    // Take the index before awaiting, or two workers parse the same file.
    const index = next;
    next += 1;
    const result = await parse(files[index]);
    if (result.code !== 0) failures.push(result);
  }
}

await Promise.all(Array.from({ length: Math.max(2, Math.min(8, os.cpus().length)) }, worker));

if (failures.length) {
  for (const failure of failures) {
    console.error(`${path.relative(root, failure.file)}:\n${failure.stderr.trim()}\n`);
  }
  console.error(`${failures.length} of ${files.length} modules do not parse.`);
  process.exitCode = 1;
} else {
  console.log(`${files.length} modules parse.`);
}
