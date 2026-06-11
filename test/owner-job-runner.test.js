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
  assert.equal(snapshot.actions.find((action) => action.id === "system-doctor")?.requiresConfirmation, true);
  assert.equal(snapshot.actions.find((action) => action.id === "system-doctor")?.confirmationValue, "system-doctor");
  assert.equal(snapshot.actions.find((action) => action.id === "deploy-slash-commands")?.requiresConfirmation, true);
  assert.equal(snapshot.actions.find((action) => action.id === "deploy-slash-commands")?.confirmationValue, "deploy-slash-commands");
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

test("owner job runner calls finish hook once with sanitized public job", async () => {
  resetOwnerJobsForTests();

  const finishedJobs = [];
  const started = startOwnerJob("rollback-plan", {
    onFinish: (job) => finishedJobs.push(job),
  });

  const completed = await waitForJob(started.id);
  assert.equal(completed.status, "succeeded");
  assert.equal(finishedJobs.length, 1);
  assert.equal(finishedJobs[0].id, started.id);
  assert.equal(finishedJobs[0].status, "succeeded");
  assert.equal(Object.hasOwn(finishedJobs[0], "onFinish"), false);

  resetOwnerJobsForTests();
});
