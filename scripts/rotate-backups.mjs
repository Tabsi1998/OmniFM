#!/usr/bin/env node
// Thins out the backup archives of the nightly omnifm-backup.timer (#259):
// the newest archive of each of the last 14 days, 8 weeks and 6 months stays,
// and the three newest always stay. Checksums and dump logs go with their
// archive.
//
//   node scripts/rotate-backups.mjs <dir> [<dir> ...] [--dry-run]
//
// OMNIFM_BACKUP_KEEP_DAILY, _WEEKLY and _MONTHLY change the three counts.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ARCHIVE = /^(mongodb-.+\.archive\.gz|runtime-data-.+\.tar\.gz)$/;
const SIDECARS = [".sha256", ".log"];
const ALWAYS_KEEP = 3;

function positiveInt(raw, fallback) {
  const value = Number.parseInt(String(raw ?? ""), 10);
  return Number.isFinite(value) && value >= 0 ? value : fallback;
}

export function retentionFromEnv(env = process.env) {
  return {
    daily: positiveInt(env.OMNIFM_BACKUP_KEEP_DAILY, 14),
    weekly: positiveInt(env.OMNIFM_BACKUP_KEEP_WEEKLY, 8),
    monthly: positiveInt(env.OMNIFM_BACKUP_KEEP_MONTHLY, 6),
  };
}

function dayKey(time) {
  return new Date(time).toISOString().slice(0, 10);
}

function monthKey(time) {
  return new Date(time).toISOString().slice(0, 7);
}

export function weekKey(time) {
  // ISO week: the Thursday of a week decides its year and number.
  const date = new Date(time);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const yearStart = Date.UTC(date.getUTCFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - yearStart) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/**
 * Which archives to keep. `entries` are { name, time } with time in ms.
 * Per bucket (day, ISO week, month) the newest archive counts; the newest
 * `count` buckets of each kind are kept.
 */
export function selectBackupsToKeep(entries, retention = retentionFromEnv()) {
  const newestFirst = [...entries].sort((a, b) => b.time - a.time);
  const keep = new Set(newestFirst.slice(0, ALWAYS_KEEP).map((entry) => entry.name));
  for (const [count, key] of [[retention.daily, dayKey], [retention.weekly, weekKey], [retention.monthly, monthKey]]) {
    const seen = new Set();
    for (const entry of newestFirst) {
      const bucket = key(entry.time);
      if (seen.has(bucket)) continue;
      if (seen.size >= count) break;
      seen.add(bucket);
      keep.add(entry.name);
    }
  }
  return keep;
}

export function rotateDirectory(directory, { dryRun = false, retention = retentionFromEnv() } = {}) {
  if (!fs.existsSync(directory)) return { kept: [], removed: [] };
  const entries = fs.readdirSync(directory)
    .filter((name) => ARCHIVE.test(name))
    .map((name) => ({ name, time: fs.statSync(path.join(directory, name)).mtimeMs }));
  const keep = selectBackupsToKeep(entries, retention);
  const removed = [];
  for (const { name } of entries) {
    if (keep.has(name)) continue;
    removed.push(name);
    if (dryRun) continue;
    for (const suffix of ["", ...SIDECARS]) {
      fs.rmSync(path.join(directory, `${name}${suffix}`), { force: true });
    }
  }
  return { kept: entries.filter(({ name }) => keep.has(name)).map(({ name }) => name), removed };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const directories = args.filter((arg) => !arg.startsWith("--"));
  if (directories.length === 0) {
    console.error("Usage: node scripts/rotate-backups.mjs <dir> [<dir> ...] [--dry-run]");
    process.exit(2);
  }
  for (const directory of directories) {
    const { kept, removed } = rotateDirectory(directory, { dryRun });
    console.log(`[OK] ${directory}: ${kept.length} kept, ${removed.length} ${dryRun ? "would be removed" : "removed"}`);
    for (const name of removed) console.log(`  - ${name}`);
  }
}
