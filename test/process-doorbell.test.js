import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";

import {
  DOORBELL_MESSAGE_TYPE,
  onDoorbell,
  relayDoorbellMessage,
  ringDoorbell,
  waitForDoorbell,
} from "../src/core/process-doorbell.js";
import { WorkerBridgeService } from "../src/bot/worker-bridge-service.js";

function fakeProcess({ connected = true } = {}) {
  const proc = new EventEmitter();
  proc.connected = connected;
  proc.sent = [];
  proc.send = (message, callback) => {
    proc.sent.push(message);
    callback?.();
    return true;
  };
  return proc;
}

function ring(proc, topic, detail) {
  proc.emit("message", { type: DOORBELL_MESSAGE_TYPE, topic, detail });
}

test("a ring reaches the listeners of its topic only", () => {
  const proc = fakeProcess();
  const heard = [];
  const stop = onDoorbell("worker-command", (detail) => heard.push(detail.workerId), proc);

  ring(proc, "worker-command", { workerId: "bot-2" });
  ring(proc, "worker-command-done", { commandId: "c1" });
  proc.emit("message", { type: "something-else", topic: "worker-command", detail: { workerId: "x" } });
  stop();
  ring(proc, "worker-command", { workerId: "bot-3" });

  assert.deepEqual(heard, ["bot-2"]);
  assert.equal(ringDoorbell("worker-command", { workerId: "bot-4" }, proc), true);
  assert.deepEqual(proc.sent, [{ type: DOORBELL_MESSAGE_TYPE, topic: "worker-command", detail: { workerId: "bot-4" } }]);
});

test("without an IPC channel nothing rings and nothing listens", () => {
  const proc = fakeProcess({ connected: false });
  let heard = false;
  onDoorbell("worker-command", () => { heard = true; }, proc);
  ring(proc, "worker-command", {});
  assert.equal(heard, false);
  assert.equal(ringDoorbell("worker-command", {}, proc), false);
  assert.equal(ringDoorbell("worker-command", {}, {}), false, "a process without send");
});

test("waiting for a ring ends early on a matching ring and otherwise times out", async () => {
  const proc = fakeProcess();
  const woken = waitForDoorbell("worker-command-done", {
    timeoutMs: 5_000,
    match: (detail) => detail.commandId === "c2",
    proc,
  });
  ring(proc, "worker-command-done", { commandId: "c1" });
  ring(proc, "worker-command-done", { commandId: "c2" });
  assert.equal(await woken, true);

  const started = Date.now();
  assert.equal(await waitForDoorbell("worker-command-done", { timeoutMs: 30, proc }), false);
  assert.ok(Date.now() - started >= 25);
});

test("the supervisor passes a ring to every other connected child", () => {
  const commander = fakeProcess();
  const workerA = fakeProcess();
  const workerB = fakeProcess();
  const exiting = fakeProcess({ connected: false });
  const message = { type: DOORBELL_MESSAGE_TYPE, topic: "worker-command", detail: { workerId: "bot-2" } };

  const delivered = relayDoorbellMessage([commander, workerA, workerB, exiting], commander, message);
  assert.equal(delivered, 2);
  assert.equal(commander.sent.length, 0, "never back to the sender");
  assert.deepEqual(workerA.sent, [message]);
  assert.deepEqual(workerB.sent, [message]);
  assert.equal(exiting.sent.length, 0);
  assert.equal(relayDoorbellMessage([workerA], commander, { type: "log", text: "x" }), 0, "other messages stay");
});

function fakeBridge(commands) {
  const queue = [...commands];
  const calls = [];
  return {
    calls,
    async claimNextWorkerCommand(workerId) {
      calls.push(`claim:${workerId}`);
      return queue.shift() || null;
    },
    async completeWorkerCommand(commandId) { calls.push(`complete:${commandId}`); },
    async failWorkerCommand(commandId) { calls.push(`fail:${commandId}`); },
    async publishWorkerSnapshot() {},
    async clearWorkerSnapshot() {},
    push(command) { queue.push(command); },
  };
}

function command(commandId, guildId, type = "play") {
  return { commandId, type, payload: { guildId } };
}

test("a tick drains every pending command, one server in order, servers in parallel", async () => {
  const bridge = fakeBridge([
    command("a1", "guild-a", "play"),
    command("b1", "guild-b", "play"),
    command("a2", "guild-a", "stop"),
  ]);
  const events = [];
  const service = new WorkerBridgeService(
    { config: { id: "bot-2", name: "OmniFM 2" }, client: { guilds: { cache: new Map() } } },
    { bridge, doorbell: { isDoorbellConnected: () => true, onDoorbell: () => () => {} } }
  );
  service.publishSnapshot = async () => {};
  service.executeCommand = async (cmd) => {
    events.push(`start:${cmd.commandId}`);
    await new Promise((resolve) => setTimeout(resolve, cmd.commandId === "a1" ? 30 : 5));
    events.push(`end:${cmd.commandId}`);
    return { ok: true };
  };

  await service.tickCommands();

  assert.deepEqual(bridge.calls.filter((call) => call.startsWith("complete:")).sort(), ["complete:a1", "complete:a2", "complete:b1"]);
  assert.ok(events.indexOf("end:a1") < events.indexOf("start:a2"), "guild-a keeps its order");
  assert.ok(events.indexOf("start:b1") < events.indexOf("end:a1"), "guild-b does not wait for guild-a");
  assert.equal(bridge.calls.filter((call) => call.startsWith("claim:")).length, 4, "three commands and one empty claim");
});

test("a ring during a tick makes the worker look again right after it", async () => {
  const bridge = fakeBridge([command("a1", "guild-a")]);
  const service = new WorkerBridgeService(
    { config: { id: "bot-2", name: "OmniFM 2" } },
    { bridge, doorbell: { isDoorbellConnected: () => true, onDoorbell: () => () => {} } }
  );
  service.publishSnapshot = async () => {};
  let rang = false;
  service.executeCommand = async () => {
    // A second command arrives and rings while the first one runs.
    if (!rang) {
      rang = true;
      bridge.push(command("a2", "guild-a"));
      await service.tickCommands();
    }
    return { ok: true };
  };

  await service.tickCommands();
  assert.deepEqual(bridge.calls.filter((call) => call.startsWith("complete:")), ["complete:a1", "complete:a2"]);
});

test("the worker ticks on a ring for itself, ignores rings for others and polls slowly with the doorbell", async () => {
  let listener = null;
  let ticks = 0;
  const service = new WorkerBridgeService(
    { config: { id: "bot-2", name: "OmniFM 2" } },
    {
      bridge: fakeBridge([]),
      doorbell: {
        isDoorbellConnected: () => true,
        onDoorbell: (topic, handler) => {
          assert.equal(topic, "worker-command");
          listener = handler;
          return () => { listener = null; };
        },
      },
    }
  );
  service.publishSnapshot = async () => {};
  service.tickCommands = async () => { ticks += 1; };

  await service.start();
  listener({ workerId: "bot-3" });
  listener({ workerId: "bot-2" });
  assert.equal(ticks, 1);
  assert.equal(service.getCommandPollMs(), 5_000);
  await service.stop();
  assert.equal(listener, null, "stop removes the listener");
});

test("a ring travels between two real child processes through the relay", async () => {
  const { spawn } = await import("node:child_process");
  const doorbellUrl = new URL("../src/core/process-doorbell.js", import.meta.url).href;
  const listenerSource = `
    const { onDoorbell } = await import(${JSON.stringify(doorbellUrl)});
    onDoorbell("worker-command", (detail) => {
      process.stdout.write("heard:" + detail.workerId);
      process.exit(0);
    });
    process.send({ type: "ready" });
    setTimeout(() => process.exit(3), 10000);
  `;
  const ringerSource = `
    const { ringDoorbell } = await import(${JSON.stringify(doorbellUrl)});
    process.on("message", (message) => {
      if (message?.type !== "go") return;
      ringDoorbell("worker-command", { workerId: "bot-7" });
      setTimeout(() => process.exit(0), 200);
    });
    setTimeout(() => process.exit(3), 10000);
  `;
  const start = (source) => spawn(process.execPath, ["--input-type=module", "-e", source], {
    stdio: ["ignore", "pipe", "inherit", "ipc"],
  });
  const listener = start(listenerSource);
  const ringer = start(ringerSource);
  const children = [listener, ringer];
  for (const child of children) {
    child.on("message", (message) => relayDoorbellMessage(children, child, message));
  }

  let output = "";
  listener.stdout.on("data", (chunk) => { output += chunk; });
  await new Promise((resolve) => listener.on("message", (message) => message?.type === "ready" && resolve()));
  ringer.send({ type: "go" });
  const code = await new Promise((resolve) => listener.on("exit", resolve));
  await new Promise((resolve) => (ringer.exitCode !== null ? resolve() : ringer.on("exit", resolve)));

  assert.equal(code, 0);
  assert.equal(output.trim(), "heard:bot-7");
});
