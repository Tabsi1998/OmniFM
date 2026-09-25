import test from "node:test";
import assert from "node:assert/strict";

import {
  alertEnabled,
  alertFailoverExhausted,
  createCooldown,
  createPlaybackLoopTracker,
  createWorkerAvailabilityWatch,
  describeDiskSpace,
  isDiskSpaceLow,
} from "../src/services/operator-alerts.js";

const MINUTE = 60_000;

function clock(start = 1_000_000) {
  let time = start;
  return { now: () => time, advance: (ms) => { time += ms; } };
}

function worker(name, ready) {
  return { config: { name }, ready, isReady() { return this.ready; } };
}

test("a silent worker alerts once after the grace time and once when it is back", () => {
  const time = clock();
  const events = [];
  const watch = createWorkerAvailabilityWatch({ offlineAfterMs: 3 * MINUTE, notify: (event) => events.push(event), now: time.now });
  const one = worker("Worker 1", true);
  const two = worker("Worker 2", true);

  watch.observe([one, two]);
  one.ready = false;
  watch.observe([one, two]);
  time.advance(2 * MINUTE);
  watch.observe([one, two]);
  assert.equal(events.length, 0, "a short restart stays quiet");

  time.advance(2 * MINUTE);
  watch.observe([one, two]);
  time.advance(MINUTE);
  watch.observe([one, two]);
  assert.deepEqual(events.map((event) => [event.kind, event.name]), [["offline", "Worker 1"]]);

  one.ready = true;
  watch.observe([one, two]);
  assert.deepEqual(events.map((event) => event.kind), ["offline", "back"]);
  assert.equal(events[1].offlineMs, 5 * MINUTE);
});

test("a worker that comes up within the grace time after the start never alerts", () => {
  const time = clock();
  const events = [];
  const watch = createWorkerAvailabilityWatch({ offlineAfterMs: 3 * MINUTE, notify: (event) => events.push(event), now: time.now });
  const starting = worker("Worker 3", false);
  watch.observe([starting]);
  time.advance(MINUTE);
  starting.ready = true;
  watch.observe([starting]);
  assert.deepEqual(events, []);
});

test("unexpected playback transitions alert at the threshold within the window, then wait", () => {
  const time = clock();
  const alerts = [];
  const tracker = createPlaybackLoopTracker({
    threshold: 3, windowMs: 15 * MINUTE, cooldownMs: 60 * MINUTE, notify: (event) => alerts.push(event), now: time.now,
  });
  tracker.record("g1", { from: "playing", to: "idle" });
  time.advance(20 * MINUTE);
  tracker.record("g1", { from: "playing", to: "idle" });
  tracker.record("g1", { from: "playing", to: "idle" });
  assert.equal(alerts.length, 0, "the first one fell out of the window");

  assert.equal(tracker.record("g1", { from: "paused", to: "connecting" }), true);
  assert.equal(alerts[0].count, 3);
  assert.equal(tracker.record("g1", {}), false, "no second alert within the cooldown");
  assert.equal(tracker.record("g2", {}), false, "other servers count on their own");
});

test("disk space counts as low under the percentage or the absolute minimum", () => {
  const space = describeDiskSpace({ blocks: 1000, bsize: 4096 * 1024, bavail: 50 });
  assert.equal(Math.round(space.freePercent), 5);
  assert.equal(isDiskSpaceLow(space, { minPercent: 10, minBytes: 1 }), true);
  assert.equal(isDiskSpaceLow({ freeBytes: 1024 ** 3, freePercent: 50 }, { minPercent: 10, minBytes: 2 * 1024 ** 3 }), true);
  assert.equal(isDiskSpaceLow({ freeBytes: 50 * 1024 ** 3, freePercent: 40 }, { minPercent: 10, minBytes: 2 * 1024 ** 3 }), false);
});

test("every alert kind can be switched off", () => {
  assert.equal(alertEnabled("DISK_SPACE", {}), true);
  assert.equal(alertEnabled("DISK_SPACE", { OPERATOR_ALERT_DISK_SPACE: "0" }), false);
});

test("a dead station raises one failover alert, not one per server", async () => {
  const env = { OPERATOR_FAILOVER_ALERT_COOLDOWN_MS: String(30 * MINUTE) };
  assert.equal(await alertFailoverExhausted({ stationKey: "test-station-a", stationName: "A", guildName: "one" }, env), true);
  assert.equal(await alertFailoverExhausted({ stationKey: "test-station-a", stationName: "A", guildName: "two" }, env), false);
  assert.equal(await alertFailoverExhausted({ stationKey: "test-station-b", stationName: "B", guildName: "one" }, env), true);
  assert.equal(
    await alertFailoverExhausted({ stationKey: "test-station-c" }, { OPERATOR_ALERT_FAILOVER_EXHAUSTED: "0" }),
    false,
  );
});

test("a cooldown lets a key through once per interval", () => {
  const time = clock();
  const cooldown = createCooldown(time.now);
  assert.equal(cooldown.ready("a", MINUTE), true);
  assert.equal(cooldown.ready("a", MINUTE), false);
  time.advance(MINUTE);
  assert.equal(cooldown.ready("a", MINUTE), true);
});
