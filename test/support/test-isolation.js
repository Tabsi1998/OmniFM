// What keeps the test files of a parallel unit run apart (#553). Pure helpers:
// isolate-test-file.mjs applies them inside every test process, and
// scripts/run-unit-tests.mjs uses them to clean up after the run.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TEST_FILE = /\.test\.[cm]?js$/;

/** The name a test file goes by: its file name without .test.js, or "" for anything else. */
export function testFileName(file) {
  const base = path.basename(String(file || ""));
  return TEST_FILE.test(base) ? base.replace(TEST_FILE, "") : "";
}

/** <base>_<name>, made a valid MongoDB database name (at most 63 bytes, no /\. "$*<>:|?). */
export function isolatedDatabaseName(base, name) {
  const clean = `${base || "omnifm_test"}_${name}`.replace(/[^A-Za-z0-9_-]/g, "_");
  if (clean.length <= 63) return clean;
  const hash = crypto.createHash("sha1").update(clean).digest("hex").slice(0, 8);
  return `${clean.slice(0, 54)}_${hash}`;
}

/**
 * Gives one test file its own database and runtime data directory, in env.
 *
 * The runtime data directory is always a new one, even when env already names
 * one: a directory set for the whole run (local_check.py passes its own
 * environment on) would otherwise be shared by every file running at once.
 * It is created under tmpRoot (the run's own folder, see run-unit-tests.mjs).
 */
export function isolateTestFile(env, file, tmpRoot = os.tmpdir()) {
  const name = testFileName(file);
  if (!name) return null;
  env.DB_NAME = isolatedDatabaseName(env.DB_NAME, name);
  fs.mkdirSync(tmpRoot, { recursive: true });
  const runtimeDir = fs.mkdtempSync(path.join(tmpRoot, `omnifm-test-${name.slice(0, 40)}-`));
  env.OMNIFM_RUNTIME_DATA_DIR = runtimeDir;
  return { name, databaseName: env.DB_NAME, runtimeDir };
}
