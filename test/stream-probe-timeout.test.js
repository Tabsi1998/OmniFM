import assert from "node:assert/strict";
import { PassThrough } from "node:stream";
import test from "node:test";

import { probeWithTimeout } from "../src/services/stream.js";

// #539: the timer of the demuxProbe race is always cleared, and a probe that
// hangs or fails closes the incoming stream instead of leaving it open.

const activeTimers = () => process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;

test("a probe that answers clears its timer and leaves the stream open", async () => {
  const before = activeTimers();
  const stream = new PassThrough();
  const result = await probeWithTimeout(stream, { timeoutMs: 60_000, probe: async (s) => ({ stream: s, type: "arbitrary" }) });

  assert.equal(result.stream, stream);
  assert.equal(stream.destroyed, false);
  assert.equal(activeTimers(), before);
  stream.destroy();
});

test("a probe that never answers times out and closes the stream", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  const stream = new PassThrough();
  const pending = probeWithTimeout(stream, { timeoutMs: 15_000, probe: () => new Promise(() => {}) });
  t.mock.timers.tick(15_000);

  await assert.rejects(pending, /demuxProbe Timeout nach 15000ms/);
  assert.equal(stream.destroyed, true);
});

test("a probe that fails closes the stream and passes the error on", async () => {
  const stream = new PassThrough();
  await assert.rejects(
    probeWithTimeout(stream, { timeoutMs: 15_000, probe: async () => { throw new Error("kein Audio"); } }),
    /kein Audio/,
  );
  assert.equal(stream.destroyed, true);
});

test("many broken attempts leave no timers behind", async () => {
  const before = activeTimers();
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const stream = new PassThrough();
    // eslint-disable-next-line no-await-in-loop -- one attempt after the other, like restarts
    await assert.rejects(probeWithTimeout(stream, { timeoutMs: 60_000, probe: async () => { throw new Error("kaputt"); } }));
  }
  assert.equal(activeTimers(), before);
});
