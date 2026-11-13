// The parallel unit runner and the isolation of its test files (#553).
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  MAX_CONCURRENCY, defaultConcurrency, dropRecordedDatabases, splitArguments, testArguments,
} from "../scripts/run-unit-tests.mjs";
import {
  DATABASE_RECORD, isIsolatedDatabaseName, isolateTestFile, isolatedDatabaseName, recordedDatabases, testFileName,
} from "./support/test-isolation.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("the runner leaves a core free and runs at most 8 files at once", () => {
  assert.equal(defaultConcurrency(1), 1);
  assert.equal(defaultConcurrency(2), 1);
  assert.equal(defaultConcurrency(4), 3);
  assert.equal(defaultConcurrency(64), MAX_CONCURRENCY);
});

test("the runner passes options after its default, files instead of the whole suite", () => {
  const all = testArguments([], { cores: 16, preload: "file:///isolate.mjs" });
  assert.deepEqual(all.args, ["--test", "--import", "file:///isolate.mjs", "--test-concurrency=8", "test/*.test.js"]);
  assert.deepEqual(all.files, []);

  const serial = testArguments(["--test-concurrency=1", "test/charts.test.js"], { cores: 16, preload: "p" });
  assert.deepEqual(serial.args, ["--test", "--import", "p", "--test-concurrency=8", "--test-concurrency=1",
    "test/charts.test.js"]);
  assert.deepEqual(serial.files, ["test/charts.test.js"]);
});

test("the runner keeps the value of an option with it, in both forms", () => {
  assert.deepEqual(splitArguments(["--test-name-pattern", "charts", "test/charts.test.js"]), {
    options: ["--test-name-pattern", "charts"], files: ["test/charts.test.js"],
  });
  assert.deepEqual(splitArguments(["--test-name-pattern=charts", "--test-only"]), {
    options: ["--test-name-pattern=charts", "--test-only"], files: [],
  });
  const { args } = testArguments(["--test-name-pattern", "charts"], { cores: 4, preload: "p" });
  assert.deepEqual(args.slice(-3), ["--test-name-pattern", "charts", "test/*.test.js"], "the value does not replace the suite");
  assert.throws(() => splitArguments(["--test-only", "charts"]), /--option=value/);
  assert.throws(() => splitArguments(["--test-name-pattern"]), /needs a value/);
});

test("every test file gets a database name of its own, valid for MongoDB", () => {
  assert.equal(testFileName("C:\\repo\\test\\charts.test.js"), "charts");
  assert.equal(testFileName("/repo/test/charts.test.mjs"), "charts");
  assert.equal(testFileName("/repo/scripts/stations.mjs"), "");
  assert.equal(isolatedDatabaseName("omnifm_local", "charts"), "omnifm_local_unit_charts");
  assert.equal(isolatedDatabaseName("", "charts"), "omnifm_test_unit_charts");
  assert.notEqual(isolatedDatabaseName("omnifm_local", "a"), isolatedDatabaseName("omnifm_local", "b"));
  assert.equal(isolatedDatabaseName("omnifm.local", "a b"), "omnifm_local_unit_a_b");
  // test/staging.test.js must never get the name of the real staging database.
  assert.notEqual(isolatedDatabaseName("omnifm", "staging"), "omnifm_staging");
  assert.equal(isIsolatedDatabaseName("omnifm_staging"), false);

  const long = "x".repeat(80);
  const first = isolatedDatabaseName("omnifm_local", `${long}-first`);
  const second = isolatedDatabaseName("omnifm_local", `${long}-second`);
  assert.ok(first.length <= 63 && second.length <= 63);
  assert.notEqual(first, second, "the hash keeps long names apart");
  const longBase = isolatedDatabaseName("b".repeat(70), `${long}-third`);
  assert.ok(longBase.length <= 63 && isIsolatedDatabaseName(longBase), longBase);
});

test("a test file gets a fresh runtime directory even when the run already names one", (t) => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-isolation-"));
  t.after(() => fs.rmSync(tmpRoot, { recursive: true, force: true }));
  const shared = path.join(tmpRoot, "shared");
  const first = { DB_NAME: "omnifm_local", OMNIFM_RUNTIME_DATA_DIR: shared };
  const second = { DB_NAME: "omnifm_local", OMNIFM_RUNTIME_DATA_DIR: shared };

  const a = isolateTestFile(first, "/repo/test/alpha.test.js", tmpRoot);
  const b = isolateTestFile(second, "/repo/test/beta.test.js", tmpRoot);

  assert.equal(first.DB_NAME, "omnifm_local_unit_alpha");
  assert.equal(second.DB_NAME, "omnifm_local_unit_beta");
  assert.deepEqual(recordedDatabases(tmpRoot), ["omnifm_local_unit_alpha", "omnifm_local_unit_beta"]);
  assert.notEqual(first.OMNIFM_RUNTIME_DATA_DIR, shared);
  assert.notEqual(first.OMNIFM_RUNTIME_DATA_DIR, second.OMNIFM_RUNTIME_DATA_DIR);
  assert.ok(fs.statSync(a.runtimeDir).isDirectory() && fs.statSync(b.runtimeDir).isDirectory());
  assert.equal(isolateTestFile({}, "/repo/scripts/tool.mjs", tmpRoot), null, "only test files are touched");
});

test("the runner isolates every file and --test-concurrency=1 runs them one after the other", (t) => {
  const work = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-runner-"));
  t.after(() => fs.rmSync(work, { recursive: true, force: true }));
  const probe = path.join(work, "probe.jsonl");
  const env = { ...process.env, UNIT_RUNNER_PROBE_FILE: probe, DB_NAME: "omnifm_probe",
    OMNIFM_RUNTIME_DATA_DIR: path.join(work, "shared") };
  // The probes run as a test run of their own, not as children of this one.
  delete env.NODE_TEST_CONTEXT;
  delete env.MONGO_URL;

  const result = spawnSync(process.execPath, [path.join(repoRoot, "scripts", "run-unit-tests.mjs"),
    "--test-concurrency=1", "test/fixtures/unit-runner/probe-first.test.js",
    "test/fixtures/unit-runner/probe-second.test.js"], { cwd: repoRoot, env, encoding: "utf8", timeout: 120000 });
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.doesNotMatch(result.stderr, /left behind|could not/);

  const runs = fs.readFileSync(probe, "utf8").trim().split("\n").map((line) => JSON.parse(line))
    .sort((left, right) => left.start - right.start);
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((run) => run.db).sort(), ["omnifm_probe_unit_probe-first", "omnifm_probe_unit_probe-second"]);
  assert.ok(runs.every((run) => run.fresh && run.runtimeDir !== env.OMNIFM_RUNTIME_DATA_DIR));
  assert.notEqual(runs[0].runtimeDir, runs[1].runtimeDir);
  assert.ok(runs.every((run) => !fs.existsSync(run.runtimeDir)), "the runtime directories are removed");
  assert.ok(runs[0].end <= runs[1].start, "one after the other");
});

test("the clean-up drops only databases this run recorded, and reports what failed", async (t) => {
  const runRoot = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-drop-"));
  t.after(() => fs.rmSync(runRoot, { recursive: true, force: true }));
  // A hand-written line without the marker (the real staging database) is ignored.
  fs.writeFileSync(path.join(runRoot, DATABASE_RECORD),
    "omnifm_unit_charts\nomnifm_unit_charts\nomnifm_staging\nomnifm_unit_broken\nomnifm_unit_gone\n");
  assert.deepEqual(recordedDatabases(runRoot), ["omnifm_unit_charts", "omnifm_unit_broken", "omnifm_unit_gone"]);

  const calls = [];
  const client = {
    db(name) {
      return {
        admin: () => ({
          listDatabases: async () => ({
            databases: ["admin", "omnifm", "omnifm_staging", "omnifm_unit_other", "omnifm_unit_charts", "omnifm_unit_broken"]
              .map((entry) => ({ name: entry })),
          }),
        }),
        dropDatabase: async () => {
          calls.push(name);
          if (name === "omnifm_unit_broken") throw new Error("not authorised");
          return true;
        },
      };
    },
  };
  const result = await dropRecordedDatabases(client, runRoot);
  assert.deepEqual(calls, ["omnifm_unit_charts", "omnifm_unit_broken"]);
  assert.deepEqual(result.dropped, ["omnifm_unit_charts"]);
  assert.deepEqual(result.failed, ["omnifm_unit_broken (not authorised)"]);
  assert.deepEqual(await dropRecordedDatabases(client, path.join(runRoot, "missing")), { dropped: [], failed: [] });
});
