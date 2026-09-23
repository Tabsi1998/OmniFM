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
  "owner-audit.json",
]);

const forbiddenTrackedPrefixes = [
  "bot-state/",
  "song-history/",
  "logs/",
  "runtime-data/",
  "runtime-data.pre-restore-",
  ".runtime-data-restore.",
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
  if (
    filePath.endsWith(".json.bak")
    || filePath.endsWith(".lock")
    || filePath.endsWith(".log")
    || /\.json\.(?:tmp-|corrupt-)/.test(filePath)
    || filePath.endsWith(".tmp")
  ) return true;
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

// UTF-8 text that was decoded as Windows-1252 and saved again: an umlaut turns
// into two Latin-1 characters, an emoji into four. Users see it in bot replies and on the
// dashboard (#208). Written with escapes so this file does not match itself.
const CP1252_CONTINUATION = "\u0080-\u00BF\u20AC\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030"
  + "\u0160\u2039\u0152\u017D\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161"
  + "\u203A\u0153\u017E\u0178";
const MOJIBAKE_PATTERN = new RegExp(
  `[\u00C2-\u00DF][${CP1252_CONTINUATION}]|[\u00E0-\u00EF][${CP1252_CONTINUATION}]{2}|\u00F0[${CP1252_CONTINUATION}]{3}`
);
const TEXT_EXTENSIONS = new Set([".js", ".mjs", ".cjs", ".jsx", ".py", ".md", ".html", ".css", ".sh", ".yml", ".yaml"]);

function assertNoMojibake() {
  const findings = [];
  for (const filePath of listTrackedFiles()) {
    if (!TEXT_EXTENSIONS.has(path.extname(filePath).toLowerCase())) continue;
    if (filePath.startsWith("frontend/public/")) continue;
    let text;
    try {
      text = fs.readFileSync(path.join(repoRoot, filePath), "utf8");
    } catch {
      continue;
    }
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
      if (MOJIBAKE_PATTERN.test(line)) findings.push(`${filePath}:${index + 1}`);
    });
  }
  assert.deepEqual(
    findings,
    [],
    `Double-encoded UTF-8 (mojibake) found, save these lines as UTF-8: ${findings.slice(0, 20).join(", ")}`
  );
}

assertCleanGitignore();
assertNoTrackedRuntimeArtifacts();
assertNoMojibake();
console.log("Repo hygiene check passed.");
