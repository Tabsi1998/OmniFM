import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  changelogSection,
  groupChanges,
  nextVersion,
  parseConventionalTitle,
  parseMergeLog,
  renderNotes,
} from "../scripts/release.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("conventional pull request titles give type, breaking flag and text", () => {
  assert.deepEqual(parseConventionalTitle("feat(runtime): record playback phases"), { type: "feat", breaking: false, title: "record playback phases" });
  assert.deepEqual(parseConventionalTitle("fix!: drop the old API"), { type: "fix", breaking: true, title: "drop the old API" });
  assert.equal(parseConventionalTitle("Update README").type, "other");
});

test("merge commits of pull requests become changelog entries", () => {
  const log = "Merge pull request #315 from x/y\x00feat(runtime): alert the operator\n\x1e"
    + "Merge pull request #312 from x/z\x00fix(ci): count HSTS\n\x1e"
    + "Merge branch 'main' into feature\x00\n\x1e";
  const changes = parseMergeLog(log);
  assert.deepEqual(changes.map((change) => [change.number, change.type]), [[315, "feat"], [312, "fix"]]);
  assert.equal(renderNotes(groupChanges(changes)), "### Neu\n\n- alert the operator (#315)\n\n### Behoben\n\n- count HSTS (#312)");
});

test("the next version follows the changes", () => {
  assert.equal(nextVersion("3.1.0", [{ type: "fix" }]), "3.1.1");
  assert.equal(nextVersion("3.1.0", [{ type: "fix" }, { type: "feat" }]), "3.2.0");
  assert.equal(nextVersion("3.1.0", [{ type: "fix", breaking: true }]), "4.0.0");
});

test("the version in package.json has its section in CHANGELOG.md", () => {
  const { version } = JSON.parse(fs.readFileSync(path.join(repoRoot, "package.json"), "utf8"));
  const lock = JSON.parse(fs.readFileSync(path.join(repoRoot, "package-lock.json"), "utf8"));
  assert.equal(lock.version, version, "package-lock.json has the same version");
  const section = changelogSection(fs.readFileSync(path.join(repoRoot, "CHANGELOG.md"), "utf8"), version);
  assert.ok(section.length > 100, `CHANGELOG.md describes ${version}`);
  assert.doesNotMatch(section, /^## /m, "the section stops at the next version");
});
