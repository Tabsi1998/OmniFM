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
  assert.ok(snapshot.actions.some((action) => action.id === "status-quick"));
  assert.equal(snapshot.actions.find((action) => action.id === "status-quick")?.requiresConfirmation, false);
  assert.match(snapshot.actions.find((action) => action.id === "status-quick")?.command || "", /update\.sh --status quick/);
  assert.ok(snapshot.actions.some((action) => action.id === "cleanup-dry-run"));
  assert.equal(snapshot.actions.find((action) => action.id === "cleanup-dry-run")?.requiresConfirmation, false);
  assert.match(snapshot.actions.find((action) => action.id === "cleanup-dry-run")?.command || "", /update\.sh --cleanup dry-run/);
  assert.equal(snapshot.actions.find((action) => action.id === "system-doctor")?.requiresConfirmation, true);
  assert.equal(snapshot.actions.find((action) => action.id === "system-doctor")?.confirmationValue, "system-doctor");
  assert.equal(snapshot.actions.find((action) => action.id === "deploy-slash-commands")?.requiresConfirmation, true);
  assert.equal(snapshot.actions.find((action) => action.id === "deploy-slash-commands")?.confirmationValue, "deploy-slash-commands");
  const recognitionTest = snapshot.actions.find((action) => action.id === "recognition-test");
  assert.equal(recognitionTest?.requiresConfirmation, true);
  assert.equal(recognitionTest?.confirmationValue, "recognition-test");
  assert.equal(recognitionTest?.inputFields?.some((field) => field.key === "url" && field.type === "url"), true);
  assert.match(recognitionTest?.command || "", /<url>/);
  assert.equal(snapshot.actions.some((action) => /rm\s+-rf|powershell|cmd\.exe/i.test(action.command)), false);
  assert.equal(snapshot.summary.totalActions, snapshot.actions.length);
  assert.ok(snapshot.summary.byRisk.low >= 1);
  assert.ok(snapshot.summary.byArea.Operations >= 1);

  const started = startOwnerJob("rollback-plan");
  assert.equal(started.actionId, "rollback-plan");
  assert.equal(started.status, "running");

  const completed = await waitForJob(started.id);
  assert.equal(completed.status, "succeeded");
  assert.equal(completed.exitCode, 0);
  assert.match(completed.output, /Rollback plan:/);

  assert.throws(() => startOwnerJob("not-allowed"), /Unbekannte Owner-Aktion/);
  assert.throws(
    () => startOwnerJob("recognition-test", { input: { url: "http://localhost:9000/radio.mp3" } }),
    /lokales oder privates Ziel/,
  );
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
