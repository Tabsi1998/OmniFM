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
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const MAX_CONCURRENCY = 8;
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const isolate = pathToFileURL(path.join(root, "test", "support", "isolate-test-file.mjs")).href;

const extra = process.argv.slice(2);
const files = extra.filter((argument) => !argument.startsWith("-"));
const options = extra.filter((argument) => argument.startsWith("-"));
const concurrency = Math.max(1, Math.min(MAX_CONCURRENCY, os.availableParallelism() - 1));

const result = spawnSync(process.execPath, [
  "--test",
  "--import", isolate,
  `--test-concurrency=${concurrency}`,
  // Given after the default, so the caller's choice wins.
  ...options,
  ...(files.length ? files : ["test/*.test.js"]),
], { cwd: root, stdio: "inherit" });

if (result.error) throw result.error;
process.exit(result.status ?? 1);
