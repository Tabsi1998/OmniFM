#!/usr/bin/env node
// The unit suite, several test files at once (#553).
//
// Every file runs in a process of its own; test/support/isolate-test-file.mjs
// gives each one its own MongoDB database and runtime data directory, so they
// no longer have to wait for each other. At most 8 at once, and one core is
// left free: more processes than that only add start-up time and load on a
// machine that checks several branches at a time.
//
//   npm run test:unit                                   all files, in parallel
//   npm run test:unit -- --test-concurrency=1           one after the other
//   npm run test:unit -- test/charts.test.js            only these files
//   npm run test:unit -- --test-name-pattern "charts"   options with a value: both forms
//
// After the run the databases the test files were given are dropped (only
// those recorded in this run's folder) and the folder is removed; whatever
// could not be cleaned up is reported on stderr.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { RUNTIME_FOLDER, recordedDatabases } from "../test/support/test-isolation.js";

export const MAX_CONCURRENCY = 8;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isolate = pathToFileURL(path.join(root, "test", "support", "isolate-test-file.mjs")).href;

// Options of node and its test runner that take a value. Written as
// `--option value`, the value is not a file.
const OPTIONS_WITH_VALUE = new Set([
  "--test-name-pattern", "--test-skip-pattern", "--test-reporter", "--test-reporter-destination",
  "--test-concurrency", "--test-timeout", "--test-shard", "--test-coverage-include",
  "--test-coverage-exclude", "--test-coverage-branches", "--test-coverage-functions",
  "--test-coverage-lines", "--test-global-setup", "--test-isolation", "--import", "--require", "-r",
  "--conditions", "-C", "--env-file", "--max-old-space-size",
]);
const TEST_PATH = /\.[cm]?js$|\*/;

/** How many files at once on a machine with this many cores. */
export function defaultConcurrency(cores) {
  return Math.max(1, Math.min(MAX_CONCURRENCY, Number(cores || 1) - 1));
}

/** Splits a command line into node options (values kept with them) and test files. */
export function splitArguments(argv) {
  const files = [];
  const options = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument.startsWith("-")) {
      options.push(argument);
      if (!argument.includes("=") && OPTIONS_WITH_VALUE.has(argument)) {
        if (index + 1 >= argv.length) throw new Error(`${argument} needs a value`);
        index += 1;
        options.push(argv[index]);
      }
    } else if (TEST_PATH.test(argument)) {
      files.push(argument);
    } else {
      throw new Error(`"${argument}" is neither a test file nor the value of a known option;`
        + " give option values as --option=value");
    }
  }
  return { files, options };
}

/**
 * The node arguments for the given command line. The caller's options come
 * after the default concurrency, so `--test-concurrency=1` wins.
 */
export function testArguments(argv, { cores = os.availableParallelism(), preload = isolate } = {}) {
  const { files, options } = splitArguments(argv);
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

/**
 * Drops the databases this run's test files were given and that exist.
 * client is a connected MongoClient (or anything with its admin()/db() shape).
 * Returns what could not be dropped.
 */
export async function dropRecordedDatabases(client, runRoot) {
  const recorded = new Set(recordedDatabases(runRoot));
  if (!recorded.size) return { dropped: [], failed: [] };
  const { databases } = await client.db().admin().listDatabases({ nameOnly: true });
  const dropped = [];
  const failed = [];
  for (const { name } of databases) {
    if (!recorded.has(name)) continue;
    try {
      // eslint-disable-next-line no-await-in-loop -- one after the other, a handful of drops
      await client.db(name).dropDatabase();
      dropped.push(name);
    } catch (error) {
      failed.push(`${name} (${error?.message || error})`);
    }
  }
  return { dropped, failed };
}

function warn(text) {
  process.stderr.write(`[run-unit-tests] ${text}\n`);
}

async function dropDatabases(runRoot) {
  const url = String(process.env.MONGO_URL || "").trim();
  if (!url || !recordedDatabases(runRoot).length) return;
  let client = null;
  try {
    const { MongoClient } = await import("mongodb");
    client = new MongoClient(url, { serverSelectionTimeoutMS: 5000 });
    await client.connect();
    const { failed } = await dropRecordedDatabases(client, runRoot);
    if (failed.length) warn(`could not drop the test databases: ${failed.join(", ")}`);
  } catch (error) {
    warn(`could not drop the test databases on ${url.replace(/\/\/[^@/]*@/, "//***@")}: ${error?.message || error}`);
  } finally {
    await client?.close().catch(() => null);
  }
}

function removeRunFolder(runRoot) {
  let left;
  try {
    left = fs.readdirSync(path.join(runRoot, RUNTIME_FOLDER));
  } catch {
    left = [];
  }
  if (left.length) warn(`${left.length} runtime data directories were left behind: ${left.join(", ")}`);
  try {
    fs.rmSync(runRoot, { recursive: true, force: true, maxRetries: 3 });
  } catch (error) {
    warn(`could not remove ${runRoot}: ${error?.code || error?.message || error}`);
  }
}

async function main() {
  let parsed;
  try {
    parsed = testArguments(process.argv.slice(2));
  } catch (error) {
    warn(error.message);
    process.exit(2);
  }
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-unit-"));
  const result = spawnSync(process.execPath, parsed.args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, OMNIFM_TEST_TMP_ROOT: runRoot },
  });
  await dropDatabases(runRoot);
  removeRunFolder(runRoot);
  if (result.error) throw result.error;
  process.exit(result.status ?? 1);
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  await main();
}
