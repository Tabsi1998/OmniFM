// What keeps the test files of a parallel unit run apart (#553). Pure helpers:
// isolate-test-file.mjs applies them inside every test process, and
// scripts/run-unit-tests.mjs uses them to clean up after the run.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_FILE = /\.test\.[cm]?js$/;

// The part every per-file database carries. No real database has it: without
// it, test/staging.test.js would get <DB_NAME>_staging, the name of the real
// staging database (scripts/staging.sh), and the clean-up would drop it.
export const UNIT_MARKER = "_unit_";

// The file in the run's folder that lists every database a test file was given.
export const DATABASE_RECORD = "databases.txt";
// The folder in the run's folder that holds the runtime data directories.
export const RUNTIME_FOLDER = "runtime";

/** The name a test file goes by: its file name without .test.js, or "" for anything else. */
export function testFileName(file) {
  const base = path.basename(String(file || ""));
  return TEST_FILE.test(base) ? base.replace(TEST_FILE, "") : "";
}

/** <base>_unit_<name>, a valid MongoDB database name (at most 63 bytes, no /\. "$*<>:|?). */
export function isolatedDatabaseName(base, name) {
  const prefix = `${String(base || "omnifm_test").replace(/[^A-Za-z0-9_-]/g, "_")}${UNIT_MARKER}`;
  const clean = `${prefix}${String(name).replace(/[^A-Za-z0-9_-]/g, "_")}`;
  if (clean.length <= 63) return clean;
  const hash = crypto.createHash("sha1").update(clean).digest("hex").slice(0, 8);
  // The marker always survives the cut: a long DB_NAME shortens the name part, never the marker.
  const head = prefix.length > 45 ? `${prefix.slice(0, 45 - UNIT_MARKER.length)}${UNIT_MARKER}` : prefix;
  return `${head}${clean.slice(prefix.length).slice(0, 54 - head.length)}_${hash}`;
}

/** Whether a database name is one this runner hands out. */
export function isIsolatedDatabaseName(name) {
  return String(name || "").includes(UNIT_MARKER);
}

/**
 * Gives one test file its own database and runtime data directory, in env.
 *
 * The runtime data directory is always a new one, even when env already names
 * one: a directory set for the whole run (local_check.py passes its own
 * environment on) would otherwise be shared by every file running at once.
 * With a run folder (runRoot, from run-unit-tests.mjs) the directory is made
 * in it and the database name is recorded there, so the runner drops only
 * databases this run handed out.
 */
export function isolateTestFile(env, file, runRoot = "") {
  const name = testFileName(file);
  if (!name) return null;
  env.DB_NAME = isolatedDatabaseName(env.DB_NAME, name);
  const parent = runRoot ? path.join(runRoot, RUNTIME_FOLDER) : os.tmpdir();
  fs.mkdirSync(parent, { recursive: true });
  const runtimeDir = fs.mkdtempSync(path.join(parent, `omnifm-test-${name.slice(0, 40)}-`));
  env.OMNIFM_RUNTIME_DATA_DIR = runtimeDir;
  if (runRoot) fs.appendFileSync(path.join(runRoot, DATABASE_RECORD), `${env.DB_NAME}\n`);
  return { name, databaseName: env.DB_NAME, runtimeDir };
}

/** The databases recorded in a run folder: unique, and only names with the marker. */
export function recordedDatabases(runRoot) {
  let text;
  try {
    text = fs.readFileSync(path.join(runRoot, DATABASE_RECORD), "utf8");
  } catch {
    return [];
  }
  return [...new Set(text.split(/\r?\n/).map((line) => line.trim()).filter(isIsolatedDatabaseName))];
}
