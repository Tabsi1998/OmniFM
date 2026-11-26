import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// #604: under `set -o pipefail`, `systemctl … | grep -q …` fails whenever grep
// stops reading early and systemctl gets SIGPIPE writing its footer. update.sh
// then reported "Discord-Bot läuft NICHT" although the bot ran. grep without -q
// reads all input, so the pipeline's status is grep's.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function shellScripts() {
  return execFileSync("git", ["ls-files", "*.sh"], { cwd: repoRoot, encoding: "utf8" })
    .split(/\r?\n/)
    .filter(Boolean);
}

test("no shell script pipes systemctl into grep -q", () => {
  const found = [];
  for (const rel of shellScripts()) {
    const lines = fs.readFileSync(path.join(repoRoot, rel), "utf8").split(/\r?\n/);
    lines.forEach((line, index) => {
      if (/systemctl\b[^|#]*\|\s*grep\s+-[A-Za-z]*q/.test(line)) found.push(`${rel}:${index + 1}`);
    });
  }
  assert.deepEqual(found, [], "use `grep … >/dev/null` after systemctl, not `grep -q` (pipefail + SIGPIPE)");
});

test("update.sh asks systemd for the bot without grep -q", () => {
  const update = fs.readFileSync(path.join(repoRoot, "update.sh"), "utf8");
  assert.match(update, /systemctl list-unit-files "\$UNIT_PREFIX-bot\.service" 2>\/dev\/null \| grep "\^\$UNIT_PREFIX-bot\.service" >\/dev\/null/);
});
