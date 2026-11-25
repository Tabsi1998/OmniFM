import test from "node:test";
import assert from "node:assert/strict";

// Live detection of OmniFM Radio (#592): one live state for every display,
// fed by the AzuraCast webhook and the 30 s poll; a short drop is no new show.
import { getOmnifmRadioLiveSettings } from "../src/services/omnifm-radio-config.js";
import {
  createOmnifmRadioLiveTracker,
  createOmnifmRadioPoller,
  onOmnifmRadioLiveEvent,
  emitOmnifmRadioLiveEvent,
} from "../src/services/omnifm-radio-live.js";
import { createOmnifmRadioLiveStore } from "../src/omnifm-radio-live-store.js";

const SECOND = 1000;
const START = Date.parse("2026-11-25T20:00:00Z");

function clock(at = START) {
  const time = { at };
  const now = () => time.at;
  now.advance = (ms) => { time.at += ms; };
  return now;
}

function memoryStore(initial = null) {
  let stored = initial;
  return {
    saves: 0,
    async load() { return stored; },
    async save(state) { this.saves += 1; stored = JSON.parse(JSON.stringify(state)); },
    peek: () => stored,
  };
}

function setup({ graceMs = 60 * SECOND, store = memoryStore() } = {}) {
  const now = clock();
  const events = [];
  const tracker = createOmnifmRadioLiveTracker({ graceMs, now, store, onEvent: (event) => events.push(event) });
  return { now, events, tracker, store };
}

const LIVE = { isLive: true, streamerName: "DJ Tabsi", title: "Abendshow" };
const OFFLINE = { isLive: false, streamerName: "", title: "Auto-DJ Song" };

test("the live settings: secret, poll interval and grace time with their defaults", () => {
  const defaults = getOmnifmRadioLiveSettings({});
  assert.equal(defaults.webhookSecret, "");
  assert.equal(defaults.pollMs, 30_000);
  assert.equal(defaults.graceMs, 60_000);

  const set = getOmnifmRadioLiveSettings({
    OMNIFM_RADIO_WEBHOOK_SECRET: "  a-long-enough-secret-123  ",
    OMNIFM_RADIO_POLL_MS: "15000",
    OMNIFM_RADIO_LIVE_GRACE_MS: "90000",
  });
  assert.equal(set.webhookSecret, "a-long-enough-secret-123");
  assert.equal(set.pollMs, 15_000);
  assert.equal(set.graceMs, 90_000);
});

test("a short secret keeps the webhook off instead of guarding it weakly", () => {
  const settings = getOmnifmRadioLiveSettings({ OMNIFM_RADIO_WEBHOOK_SECRET: "geheim" });
  assert.equal(settings.webhookSecret, "");
  assert.equal(settings.webhookSecretTooShort, true);
  assert.equal(getOmnifmRadioLiveSettings({ OMNIFM_RADIO_WEBHOOK_SECRET: "   " }).webhookSecretTooShort, false);
});

test("nonsense intervals fall back to the defaults, polling never faster than 5 s", () => {
  const settings = getOmnifmRadioLiveSettings({ OMNIFM_RADIO_POLL_MS: "0", OMNIFM_RADIO_LIVE_GRACE_MS: "-5" });
  assert.equal(settings.pollMs, 30_000);
  assert.equal(settings.graceMs, 60_000);
  assert.equal(getOmnifmRadioLiveSettings({ OMNIFM_RADIO_POLL_MS: "1000" }).pollMs, 5_000);
  assert.equal(getOmnifmRadioLiveSettings({ OMNIFM_RADIO_LIVE_GRACE_MS: "0" }).graceMs, 0);
});

test("going live starts one show with DJ, title and start time", async () => {
  const { tracker, events, store } = setup();
  await tracker.observe(OFFLINE, "poll");
  await tracker.observe(LIVE, "poll");
  const { current } = tracker.snapshot();
  assert.equal(current.isLive, true);
  assert.equal(current.streamerName, "DJ Tabsi");
  assert.equal(current.title, "Abendshow");
  assert.equal(current.startedAt, new Date(START).toISOString());
  assert.equal(current.source, "poll");
  assert.deepEqual(events.map((event) => event.type), ["start"]);
  assert.equal(events[0].show.streamerName, "DJ Tabsi");
  assert.equal(store.peek().current.isLive, true, "the state is stored");
});

test("AzuraCast's broadcast start is the show's start when it is plausible", async () => {
  const { tracker } = setup();
  const liveSince = new Date(START - 45 * SECOND).toISOString();
  await tracker.observe({ ...LIVE, liveSince }, "webhook");
  assert.equal(tracker.snapshot().current.startedAt, liveSince);

  const future = setup();
  await future.tracker.observe({ ...LIVE, liveSince: new Date(START + 3600 * SECOND).toISOString() }, "webhook");
  assert.equal(future.tracker.snapshot().current.startedAt, new Date(START).toISOString(), "a start in the future does not count");
});

test("going offline ends the show only after the grace time, with the real end and duration", async () => {
  const { tracker, events, now } = setup();
  await tracker.observe(LIVE, "poll");
  now.advance(72 * 60 * SECOND);
  await tracker.observe(OFFLINE, "poll");
  assert.equal(tracker.snapshot().current.isLive, true, "still live within the grace time");
  now.advance(30 * SECOND);
  await tracker.observe(OFFLINE, "poll");
  assert.equal(tracker.snapshot().current.isLive, true);
  now.advance(30 * SECOND);
  await tracker.observe(OFFLINE, "poll");
  const { current, shows } = tracker.snapshot();
  assert.equal(current.isLive, false);
  assert.equal(current.endedAt, new Date(START + 72 * 60 * SECOND).toISOString(), "ended when it dropped");
  assert.deepEqual(events.map((event) => event.type), ["start", "end"]);
  assert.equal(events[1].show.durationMs, 72 * 60 * SECOND);
  assert.equal(shows.length, 1);
  assert.equal(shows[0].streamerName, "DJ Tabsi");
});

test("a 30 s drop is no new show, a 90 s drop is", async () => {
  const short = setup();
  await short.tracker.observe(LIVE, "poll");
  short.now.advance(10 * 60 * SECOND);
  await short.tracker.observe(OFFLINE, "webhook");
  short.now.advance(30 * SECOND);
  await short.tracker.observe(LIVE, "webhook");
  short.now.advance(5 * 60 * SECOND);
  await short.tracker.observe(LIVE, "poll");
  assert.deepEqual(short.events.map((event) => event.type), ["start"], "reconnect within 60 s: same show");
  assert.equal(short.tracker.snapshot().current.startedAt, new Date(START).toISOString());

  const long = setup();
  await long.tracker.observe(LIVE, "poll");
  long.now.advance(10 * 60 * SECOND);
  await long.tracker.observe(OFFLINE, "webhook");
  long.now.advance(90 * SECOND);
  await long.tracker.tick();
  await long.tracker.observe(LIVE, "webhook");
  assert.deepEqual(long.events.map((event) => event.type), ["start", "end", "start"], "after 90 s: a new show");
  assert.equal(long.tracker.snapshot().shows.length, 1);
});

test("webhook and poll reporting the same show give one start", async () => {
  const { tracker, events, now } = setup();
  await Promise.all([tracker.observe(LIVE, "webhook"), tracker.observe(LIVE, "poll")]);
  now.advance(30 * SECOND);
  await tracker.observe(LIVE, "poll");
  assert.deepEqual(events.map((event) => event.type), ["start"]);
  assert.equal(tracker.snapshot().current.source, "webhook");
});

test("being offline and staying offline sends nothing", async () => {
  const { tracker, events } = setup();
  await tracker.observe(OFFLINE, "poll");
  await tracker.tick();
  assert.deepEqual(events, []);
  assert.equal(tracker.snapshot().current.isLive, false);
});

test("the history keeps the newest 50 shows", async () => {
  const { tracker, now } = setup({ graceMs: 0 });
  for (let index = 0; index < 53; index += 1) {
    // eslint-disable-next-line no-await-in-loop -- one show after the other
    await tracker.observe({ ...LIVE, title: `Show ${index}` }, "poll");
    now.advance(60 * SECOND);
    // eslint-disable-next-line no-await-in-loop -- one show after the other
    await tracker.observe(OFFLINE, "poll");
    // eslint-disable-next-line no-await-in-loop -- one show after the other
    await tracker.tick();
  }
  const { shows } = tracker.snapshot();
  assert.equal(shows.length, 50);
  assert.equal(shows[0].title, "Show 52", "newest first");
});

test("a restart keeps a running show: no second start", async () => {
  const store = memoryStore();
  const first = setup({ store });
  await first.tracker.observe(LIVE, "poll");

  const again = setup({ store });
  await again.tracker.load();
  await again.tracker.observe(LIVE, "poll");
  assert.deepEqual(again.events, []);
  assert.equal(again.tracker.snapshot().current.isLive, true);
});

test("the test show starts and ends without streaming, marked as test", async () => {
  const { tracker, events, now } = setup();
  const started = await tracker.startTestShow();
  assert.equal(started.ok, true);
  assert.equal(tracker.snapshot().current.source, "test");
  assert.equal(tracker.snapshot().current.isLive, true);
  // The poll sees AzuraCast offline: that does not end the test show.
  now.advance(5 * 60 * SECOND);
  await tracker.observe(OFFLINE, "poll");
  await tracker.tick();
  assert.equal(tracker.snapshot().current.isLive, true);
  now.advance(60 * SECOND);
  const ended = await tracker.endTestShow();
  assert.equal(ended.ok, true);
  assert.deepEqual(events.map((event) => [event.type, event.show.source]), [["start", "test"], ["end", "test"]]);
  assert.equal(events[1].show.durationMs, 6 * 60 * SECOND);
  assert.equal(tracker.snapshot().testShows[0].source, "test");
  assert.deepEqual(tracker.snapshot().shows, [], "a test never lands in the real history");
});

test("a test show never touches a real one", async () => {
  const { tracker, events } = setup();
  await tracker.observe(LIVE, "webhook");
  assert.equal((await tracker.startTestShow()).ok, false);
  assert.equal((await tracker.endTestShow()).ok, false, "the console cannot end a real show");
  assert.equal(tracker.snapshot().current.isLive, true);
  assert.deepEqual(events.map((event) => event.type), ["start"]);
});

test("going live during a test show ends the test and starts the real show", async () => {
  const { tracker, events } = setup();
  await tracker.startTestShow();
  await tracker.observe(LIVE, "webhook");
  assert.deepEqual(events.map((event) => [event.type, event.show.source]), [["start", "test"], ["end", "test"], ["start", "webhook"]]);
  assert.equal(tracker.snapshot().current.source, "webhook");
});

test("a failing listener does not stop the others", () => {
  const seen = [];
  const offBroken = onOmnifmRadioLiveEvent(() => { throw new Error("kaputt"); });
  const offRejecting = onOmnifmRadioLiveEvent(async () => { throw new Error("auch kaputt"); });
  const off = onOmnifmRadioLiveEvent((event) => seen.push(event.type));
  emitOmnifmRadioLiveEvent({ type: "start", show: {} });
  offBroken();
  offRejecting();
  off();
  emitOmnifmRadioLiveEvent({ type: "end", show: {} });
  assert.deepEqual(seen, ["start"], "unsubscribed listeners hear nothing");
});

// ---------------------------------------------------------------- polling

function fakeNowPlaying(results) {
  const calls = [];
  const fn = async (options) => {
    calls.push(options);
    const next = results.length > 1 ? results.shift() : results[0];
    return typeof next === "function" ? next() : next;
  };
  fn.calls = calls;
  return fn;
}

test("the poll detects live and offline", async () => {
  const { tracker, events, now } = setup();
  const fetchNowPlaying = fakeNowPlaying([
    { ok: true, isLive: true, streamerName: "DJ Tabsi", songText: "Abendshow", title: "Abendshow", liveSince: null },
    { ok: true, isLive: false, streamerName: "", songText: "Auto-DJ", title: "Auto-DJ", liveSince: null },
  ]);
  const poller = createOmnifmRadioPoller({ tracker, fetchNowPlaying, intervalMs: 30 * SECOND, now });
  await poller.pollOnce();
  assert.equal(tracker.snapshot().current.isLive, true);
  assert.equal(fetchNowPlaying.calls[0].force, true, "the poll never reads the cache");
  now.advance(30 * SECOND);
  await poller.pollOnce();
  now.advance(61 * SECOND);
  await poller.pollOnce();
  assert.equal(tracker.snapshot().current.isLive, false);
  assert.deepEqual(events.map((event) => event.type), ["start", "end"]);
});

test("an API failure keeps the state", async () => {
  const { tracker, events, now } = setup();
  await tracker.observe(LIVE, "poll");
  const poller = createOmnifmRadioPoller({
    tracker,
    fetchNowPlaying: fakeNowPlaying([{ ok: false, reason: "http_502" }, () => { throw new Error("ECONNRESET"); }]),
    intervalMs: 30 * SECOND,
    now,
  });
  for (let round = 0; round < 6; round += 1) {
    now.advance(30 * SECOND);
    // eslint-disable-next-line no-await-in-loop -- one poll after the other
    await poller.pollOnce();
  }
  assert.equal(tracker.snapshot().current.isLive, true);
  assert.equal(tracker.snapshot().current.offlineSince, null);
  assert.deepEqual(events.map((event) => event.type), ["start"]);
});

test("the poll timer runs every interval and stops cleanly", async () => {
  const { tracker } = setup();
  const fetchNowPlaying = fakeNowPlaying([{ ok: true, isLive: false }]);
  const timers = [];
  const poller = createOmnifmRadioPoller({
    tracker,
    fetchNowPlaying,
    intervalMs: 30 * SECOND,
    setIntervalFn: (fn, ms) => { const timer = { fn, ms, cleared: false, unref() {} }; timers.push(timer); return timer; },
    clearIntervalFn: (timer) => { timer.cleared = true; },
  });
  poller.start();
  assert.equal(timers[0].ms, 30 * SECOND);
  await timers[0].fn();
  poller.stop();
  assert.equal(timers[0].cleared, true);
  assert.ok(fetchNowPlaying.calls.length >= 1);
});

// ---------------------------------------------------------------- store

function fakeDb() {
  const docs = new Map();
  return {
    docs,
    collection(name) {
      return {
        findOne: async (filter) => {
          const doc = docs.get(`${name}:${filter._id}`);
          return doc ? JSON.parse(JSON.stringify(doc)) : null;
        },
        updateOne: async (filter, update, options) => {
          const key = `${name}:${filter._id}`;
          if (!docs.has(key) && !options?.upsert) return { matchedCount: 0 };
          docs.set(key, { _id: filter._id, ...(docs.get(key) || {}), ...JSON.parse(JSON.stringify(update.$set)) });
          return { matchedCount: 1 };
        },
      };
    },
  };
}

test("the store keeps the state in MongoDB, one document", async () => {
  const db = fakeDb();
  const store = createOmnifmRadioLiveStore({ getDatabase: () => db });
  assert.equal(await store.load(), null);
  await store.save({ current: { isLive: true, streamerName: "DJ Tabsi" }, shows: [{ title: "A" }] });
  assert.equal(db.docs.size, 1);
  const loaded = await store.load();
  assert.equal(loaded.current.streamerName, "DJ Tabsi");
  assert.deepEqual(loaded.shows, [{ title: "A" }]);
});

test("without MongoDB the store keeps the state in memory", async () => {
  const store = createOmnifmRadioLiveStore({ getDatabase: () => null });
  await store.save({ current: { isLive: false }, shows: [] });
  assert.deepEqual(await store.load(), { current: { isLive: false }, shows: [], testShows: [], track: null });
});

test("a broken stored document is read as a clean offline state", async () => {
  const store = memoryStore({ current: { isLive: "yes", streamerName: 42, startedAt: "kein Datum" }, shows: "nope" });
  const { tracker } = setup({ store });
  await tracker.load();
  const { current, shows } = tracker.snapshot();
  assert.equal(current.isLive, false);
  assert.equal(current.startedAt, null);
  assert.deepEqual(shows, []);
});

// ---------------------------------------------------------------- service

test("the service runs only when OmniFM Radio is on, and stops cleanly", async () => {
  const { startOmnifmRadioLiveService, getOmnifmRadioLiveService, stopOmnifmRadioLiveService } = await import("../src/services/omnifm-radio-live.js");
  assert.equal(await startOmnifmRadioLiveService({ env: { OMNIFM_RADIO_ENABLED: "0" } }), null);
  assert.equal(getOmnifmRadioLiveService(), null);

  const fetchNowPlaying = fakeNowPlaying([{ ok: true, isLive: true, streamerName: "DJ Tabsi", songText: "Abendshow" }]);
  const service = await startOmnifmRadioLiveService({
    env: { OMNIFM_RADIO_WEBHOOK_SECRET: "ein-langes-geheimnis-fuer-azuracast", OPERATOR_ALERT_RADIO_LIVE: "0" },
    store: memoryStore(),
    fetchNowPlaying,
  });
  try {
    assert.equal(getOmnifmRadioLiveService(), service);
    assert.equal(service.settings.webhookSecret, "ein-langes-geheimnis-fuer-azuracast");
    // The first poll runs right away.
    for (let wait = 0; wait < 50 && !service.tracker.snapshot().current.isLive; wait += 1) {
      // eslint-disable-next-line no-await-in-loop -- wait for the first poll
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(service.tracker.snapshot().current.isLive, true);
  } finally {
    stopOmnifmRadioLiveService();
  }
  assert.equal(getOmnifmRadioLiveService(), null);
});
