// Loaded into every test file's process by `npm run test:unit` (#553).
//
// node --test runs each file in a process of its own, several at once. What
// processes still share is the MongoDB database named in DB_NAME and the
// runtime data directory (the repository itself without
// OMNIFM_RUNTIME_DATA_DIR). This gives each file both of its own, derived from
// its name, before any test code runs, so files cannot see each other's data:
//
//   DB_NAME                   <DB_NAME or omnifm_test>_unit_<file name>
//   OMNIFM_RUNTIME_DATA_DIR   always a fresh temporary directory, removed on
//                             exit (the logs of a test run go to logs/test in it)
//
// A file that sets these itself still wins: its assignment runs after this.
// Outside the test runner (no NODE_TEST_CONTEXT) nothing changes. The runner
// drops the databases after the run and reports what could not be removed.
import fs from "node:fs";

import { isolateTestFile } from "./test-isolation.js";

if (process.env.NODE_TEST_CONTEXT) {
  // The run's folder from run-unit-tests.mjs; without it the system temp folder.
  const isolated = isolateTestFile(process.env, process.argv[1], process.env.OMNIFM_TEST_TMP_ROOT || "");
  if (isolated) {
    process.on("exit", () => {
      try {
        fs.rmSync(isolated.runtimeDir, { recursive: true, force: true, maxRetries: 3 });
      } catch (error) {
        // Synchronous on purpose: the process is exiting, a stream write may be lost.
        fs.writeSync(2, `\n[isolate-test-file] ${isolated.name}: runtime data directory left behind: `
          + `${isolated.runtimeDir} (${error?.code || error?.message || error})\n`);
      }
    });
  }
}
