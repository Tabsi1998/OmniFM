// Loaded into every test file's process by `npm run test:unit` (#553).
//
// node --test runs each file in a process of its own, several at once. What
// processes still share is the MongoDB database named in DB_NAME and the
// runtime data directory (the repository itself without
// OMNIFM_RUNTIME_DATA_DIR). This gives each file both of its own, derived from
// its name, before any test code runs, so files cannot see each other's data:
//
//   DB_NAME                   <DB_NAME or omnifm_test>_<file name>
//   OMNIFM_RUNTIME_DATA_DIR   a fresh temporary directory, removed on exit
//                             (the logs of a test run go to logs/test inside it)
//
// A file that sets these itself still wins: its assignment runs after this.
// An OMNIFM_RUNTIME_DATA_DIR the caller set on purpose is left alone. Outside
// the test runner (no NODE_TEST_CONTEXT) nothing changes.
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const file = process.argv[1] || "";

if (process.env.NODE_TEST_CONTEXT && /\.test\.[cm]?js$/.test(file)) {
  const name = path.basename(file).replace(/\.test\.[cm]?js$/, "");
  process.env.DB_NAME = isolatedDatabaseName(process.env.DB_NAME || "omnifm_test", name);

  if (!String(process.env.OMNIFM_RUNTIME_DATA_DIR || "").trim()) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `omnifm-test-${name.slice(0, 40)}-`));
    process.env.OMNIFM_RUNTIME_DATA_DIR = dir;
    process.on("exit", () => {
      try {
        fs.rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
      } catch {
        // A file still open on Windows: the temporary directory is left behind.
      }
    });
  }
}

// MongoDB database names are at most 63 bytes and must not contain /\. "$*<>:|?
function isolatedDatabaseName(base, name) {
  const clean = `${base}_${name}`.replace(/[^A-Za-z0-9_-]/g, "_");
  if (clean.length <= 63) return clean;
  const hash = crypto.createHash("sha1").update(clean).digest("hex").slice(0, 8);
  return `${clean.slice(0, 54)}_${hash}`;
}
