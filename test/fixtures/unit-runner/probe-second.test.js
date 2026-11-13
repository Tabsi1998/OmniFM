// The second probe for test/unit-runner.test.js, run by scripts/run-unit-tests.mjs:
// it notes when it ran and which database and runtime directory it was given.
import test from "node:test";
import fs from "node:fs";

test("probe notes its isolation", async () => {
  const start = Date.now();
  const runtimeDir = process.env.OMNIFM_RUNTIME_DATA_DIR;
  const fresh = fs.existsSync(runtimeDir) && fs.readdirSync(runtimeDir).length === 0;
  await new Promise((resolve) => setTimeout(resolve, 400));
  fs.appendFileSync(process.env.UNIT_RUNNER_PROBE_FILE, `${JSON.stringify({
    start, end: Date.now(), db: process.env.DB_NAME, runtimeDir, fresh,
  })}\n`);
});
