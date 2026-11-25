import test from "node:test";
import assert from "node:assert/strict";

import { close as closeDb, connect as connectDb, getDb } from "../src/lib/db.js";
import {
  claimNextWorkerCommand,
  completeWorkerCommand,
  createWorkerCommand,
  getWorkerCommand,
  waitForWorkerCommandResult,
} from "../src/core/worker-bridge.js";

const hasMongoConfig = Boolean(String(process.env.MONGO_URL || "").trim());

test("timed-out pending worker commands are cancelled before a worker can claim them", {
  skip: !hasMongoConfig,
}, async (t) => {
  await connectDb();
  const db = getDb();
  assert.ok(db, "MongoDB must be available for the worker bridge regression test");

  const workerId = `worker-timeout-test-${process.pid}-${Date.now()}`;
  t.after(async () => {
    await db.collection("worker_bridge_commands").deleteMany({ workerId }).catch(() => null);
    await closeDb().catch(() => null);
  });

  const command = await createWorkerCommand(workerId, "stop", { guildId: "guild-timeout-test" }, {
    timeoutMs: 5_000,
  });

  await assert.rejects(
    waitForWorkerCommandResult(command.commandId, { timeoutMs: 2_000, pollMs: 100 }),
    // Cancelled while still pending: certainly not started (#593 releases its claim then).
    (error) => /Worker-Command Timeout\./.test(error.message) && error.notStarted === true
  );

  const cancelled = await getWorkerCommand(command.commandId);
  assert.equal(cancelled?.status, "cancelled");
  assert.equal(cancelled?.error, "Worker-Command Timeout.");
  assert.ok(cancelled?.cancelledAt);
  assert.equal(await claimNextWorkerCommand(workerId), null);

  // A late worker completion must not revive a command that timed out pending.
  await completeWorkerCommand(command.commandId, { ok: true });
  const afterLateCompletion = await getWorkerCommand(command.commandId);
  assert.equal(afterLateCompletion?.status, "cancelled");
});

test("a timed-out command the worker had already taken may still run: not marked as not started", {
  skip: !hasMongoConfig,
}, async (t) => {
  await connectDb();
  const db = getDb();
  const workerId = `worker-claimed-test-${process.pid}-${Date.now()}`;
  t.after(async () => {
    await db.collection("worker_bridge_commands").deleteMany({ workerId }).catch(() => null);
    await closeDb().catch(() => null);
  });
  const command = await createWorkerCommand(workerId, "radioAnnounce", { guildId: "guild-claimed-test" }, { timeoutMs: 5_000 });
  assert.ok(await claimNextWorkerCommand(workerId), "the worker took it");
  await assert.rejects(
    waitForWorkerCommandResult(command.commandId, { timeoutMs: 2_000, pollMs: 100 }),
    (error) => /Worker-Command Timeout\./.test(error.message) && error.notStarted !== true
  );
});
