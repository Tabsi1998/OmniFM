import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { rotateDirectory, selectBackupsToKeep, weekKey } from "../scripts/rotate-backups.mjs";

const DAY = 86400000;
const NOW = Date.UTC(2026, 8, 24, 4, 15);

function nightly(days) {
  return Array.from({ length: days }, (_, index) => ({
    name: `mongodb-omnifm-${index}.archive.gz`,
    time: NOW - index * DAY,
  }));
}

test("a year of nightly backups keeps 14 days, 8 weeks and 6 months", () => {
  const entries = nightly(365);
  const keep = selectBackupsToKeep(entries, { daily: 14, weekly: 8, monthly: 6 });
  // The newest 14 nights, plus the newest of older weeks and months.
  for (let index = 0; index < 14; index += 1) assert.ok(keep.has(`mongodb-omnifm-${index}.archive.gz`), `night ${index}`);
  assert.ok(keep.size >= 14 && keep.size <= 14 + 8 + 6, `kept ${keep.size}`);
  const oldest = Math.max(...[...keep].map((name) => Number(name.match(/-(\d+)\.archive/)[1])));
  // Sixth month back from 24 September is April; its newest night is 30 April.
  assert.equal(oldest, 147, `oldest kept backup is ${oldest} days old`);
});

test("several backups on one day count once; the newest of that day stays", () => {
  const entries = [
    { name: "a-morning", time: NOW - 3 * 3600000 },
    { name: "b-update", time: NOW - 1 * 3600000 },
    { name: "c-yesterday", time: NOW - DAY },
    { name: "d-two-days", time: NOW - 2 * DAY },
    { name: "e-three-days", time: NOW - 3 * DAY },
  ];
  const keep = selectBackupsToKeep(entries, { daily: 2, weekly: 0, monthly: 0 });
  // The three newest always stay; beyond that only the newest per day counts.
  assert.deepEqual([...keep].sort(), ["a-morning", "b-update", "c-yesterday"]);
});

test("ISO weeks follow the Thursday rule", () => {
  assert.equal(weekKey(Date.UTC(2026, 0, 1)), "2026-W01");
  assert.equal(weekKey(Date.UTC(2027, 0, 1)), "2026-W53");
  assert.equal(weekKey(Date.UTC(2026, 8, 24)), "2026-W39");
});

test("rotation removes old archives with their checksum and dump log", (t) => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-rotate-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (let index = 0; index < 20; index += 1) {
    const name = `mongodb-omnifm-${String(index).padStart(2, "0")}.archive.gz`;
    for (const suffix of ["", ".sha256", ".log"]) {
      const file = path.join(directory, `${name}${suffix}`);
      fs.writeFileSync(file, "x");
      const time = new Date(NOW - index * DAY);
      fs.utimesSync(file, time, time);
    }
  }
  fs.writeFileSync(path.join(directory, ".last-restore-check.json"), "{}");

  const dry = rotateDirectory(directory, { dryRun: true, retention: { daily: 5, weekly: 0, monthly: 0 } });
  assert.equal(dry.removed.length, 15);
  assert.equal(fs.readdirSync(directory).length, 61, "a dry run deletes nothing");

  const run = rotateDirectory(directory, { retention: { daily: 5, weekly: 0, monthly: 0 } });
  assert.equal(run.kept.length, 5);
  const left = fs.readdirSync(directory).sort();
  assert.equal(left.length, 5 * 3 + 1);
  assert.ok(left.includes(".last-restore-check.json"), "other files are never touched");
  assert.ok(left.includes("mongodb-omnifm-00.archive.gz.log"));
  assert.ok(!left.some((name) => name.startsWith("mongodb-omnifm-05")));
});
