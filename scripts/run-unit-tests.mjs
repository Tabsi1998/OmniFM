#!/usr/bin/env node
// The unit suite, several test files at once (#553).
//
// Every file runs in a process of its own; test/support/isolate-test-file.mjs
// gives each one its own MongoDB database and runtime data directory, so they
// no longer have to wait for each other. At most 8 at once, and one core is
// left free: more processes than that only add start-up time and load on a
// machine that checks several branches at a time.
//
//   npm run test:unit                              all files, in parallel
//   npm run test:unit -- --test-concurrency=1      one after the other
//   npm run test:unit -- test/charts.test.js       only these files
//
// After the run the per-file databases are dropped and the run's temporary
// folder is removed; whatever could not be cleaned up is reported on stderr.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { isolatedDatabaseName, testFileName } from "../test/support/test-isolation.js";

export const MAX_CONCURRENCY = 8;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isolate = pathToFileURL(path.join(root, "test", "support", "isolate-test-file.mjs")).href;

/** How many files at once on a machine with this many cores. */
export function defaultConcurrency(cores) {
  return Math.max(1, Math.min(MAX_CONCURRENCY, Number(cores || 1) - 1));
}

/**
 * The node arguments for the given command line. The caller's options come
 * after the default concurrency, so `--test-concurrency=1` wins.
 */
export function testArguments(argv, { cores = os.availableParallelism(), preload = isolate } = {}) {
  const files = argv.filter((argument) => !argument.startsWith("-"));
  const options = argv.filter((argument) => argument.startsWith("-"));
  return {
    files,
    args: [
      "--test",
      "--import", preload,
      `--test-concurrency=${defaultConcurrency(cores)}`,
      ...options,
      ...(files.length ? files : ["test/*.test.js"]),
    ],
  };
}

function warn(text) {
  process.stderr.write(`[run-unit-tests] ${text}\n`);
}

/** The test files a run covers, for the database names to drop. */
function coveredTestFiles(files) {
  if (files.length) return files;
  return fs.readdirSync(path.join(root, "test")).filter((name) => testFileName(name));
}

async function dropDatabases(files) {
  const url = String(process.env.MONGO_URL || "").trim();
  if (!url) return;
  const names = new Set(coveredTestFiles(files)
    .map((file) => isolatedDatabaseName(process.env.DB_NAME, testFileName(file)))
    .filter(Boolean));
  let client = null;
  try {
    const { MongoClient } = await import("mongodb");
    client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
    const present = databases.map((entry) => entry.name).filter((name) => names.has(name));
    const failed = [];
    for (const name of present) {
      // eslint-disable-next-line no-await-in-loop -- one after the other, a handful of drops
      await client.db(name).dropDatabase().catch((error) => failed.push(`${name} (${error?.message || error})`));
    }
    if (failed.length) warn(`could not drop the test databases: ${failed.join(", ")}`);
  } catch (error) {
    warn(`could not drop the test databases on ${url.replace(/\/\/[^@/]*@/, "//***@")}: ${error?.message || error}`);
  } finally {
    await client?.close().catch(() => null);
  }
}

function removeTemporaryRoot(tmpRoot) {
  let left;
  try {
    left = fs.readdirSync(tmpRoot);
  } catch {
    return;
  }
  if (left.length) warn(`${left.length} runtime data directories were left behind: ${left.join(", ")}`);
  try {
    fs.rmSync(tmpRoot, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    warn(`could not remove ${tmpRoot}: ${error?.code || error?.message || error}`);
  }
}

async function main() {
  const { files, args } = testArguments(process.argv.slice(2));
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-unit-"));
  const result = spawnSync(process.execPath, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, OMNIFM_TEST_TMP_ROOT: tmpRoot },
  });
  removeTemporaryRoot(tmpRoot);
  await dropDatabases(files);
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
