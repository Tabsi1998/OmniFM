import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const forbiddenTrackedFiles = new Set([
  "bot-state.json",
  "dashboard.json",
  "premium.json",
  "custom-stations.json",
  "command-permissions.json",
  "guild-languages.json",
  "song-history.json",
  "listening-stats.json",
  "scheduled-events.json",
  "coupons.json",
  "discordbotlist.json",
  "botsgg.json",
  "topgg.json",
  "vote-events.json",
  "operator-incidents.json",
  "runtime-incidents.json",
]);

const forbiddenTrackedPrefixes = [
  "bot-state/",
  "song-history/",
  "logs/",
  "test_reports/",
  ".update-backups/",
  "memory/",
];

function normalizeGitPath(rawPath) {
  return String(rawPath || "").replace(/\\/g, "/").trim();
}

function listTrackedFiles() {
  return execFileSync("git", ["ls-files"], {
    cwd: repoRoot,
    encoding: "utf8",
  })
    .split(/\r?\n/)
    .map(normalizeGitPath)
    .filter(Boolean);
}

function assertCleanGitignore() {
  const gitignore = fs.readFileSync(path.join(repoRoot, ".gitignore"), "utf8");
  const lines = gitignore.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  assert.equal(lines.includes("-e"), false, ".gitignore contains a broken '-e' entry");

  const seen = new Set();
  const duplicates = [];
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (seen.has(line)) duplicates.push(line);
    seen.add(line);
  }
  assert.deepEqual(duplicates, [], `.gitignore contains duplicate entries: ${duplicates.join(", ")}`);
}

function isForbiddenTrackedRuntimePath(filePath) {
  if (forbiddenTrackedFiles.has(filePath)) return true;
  if (filePath.endsWith(".json.bak") || filePath.endsWith(".lock") || filePath.endsWith(".log")) return true;
  return forbiddenTrackedPrefixes.some((prefix) => filePath.startsWith(prefix));
}

function assertNoTrackedRuntimeArtifacts() {
  const tracked = listTrackedFiles();
  const forbidden = tracked.filter(isForbiddenTrackedRuntimePath);
  assert.deepEqual(
    forbidden,
    [],
    `Runtime artifacts must not be tracked: ${forbidden.join(", ")}`
  );

  assert.equal(
    tracked.includes("stations.json"),
    true,
    "stations.json is the intentional versioned station catalog"
  );
}

assertCleanGitignore();
assertNoTrackedRuntimeArtifacts();
console.log("Repo hygiene check passed.");
