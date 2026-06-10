import assert from "node:assert/strict";
import test from "node:test";

import {
  getOwnerJob,
  getOwnerJobsSnapshot,
  resetOwnerJobsForTests,
  startOwnerJob,
} from "../src/lib/owner-job-runner.js";

async function waitForJob(jobId, { timeoutMs = 10_000 } = {}) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const job = getOwnerJob(jobId);
    if (job && job.status !== "running") return job;
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Timed out waiting for owner job ${jobId}`);
}

test("owner job runner exposes only allowlisted actions and captures output", async () => {
  resetOwnerJobsForTests();

  const snapshot = getOwnerJobsSnapshot();
  assert.ok(snapshot.actions.some((action) => action.id === "rollback-plan"));
  assert.equal(snapshot.actions.some((action) => /rm\s+-rf|powershell|cmd\.exe/i.test(action.command)), false);

  const started = startOwnerJob("rollback-plan");
  assert.equal(started.actionId, "rollback-plan");
  assert.equal(started.status, "running");

  const completed = await waitForJob(started.id);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.exitCode, 0);
  assert.match(completed.output, /Rollback plan:/);

  assert.throws(() => startOwnerJob("not-allowed"), /Unbekannte Owner-Aktion/);
  resetOwnerJobsForTests();
});
