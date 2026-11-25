import test from "node:test";
import assert from "node:assert/strict";

// The hard cases of the OmniFM Radio live state (#592, review): reconnects
// after the grace time, a database that does not answer, shows the bot did
// not see end, stale polls, auto-DJ titles and a forgotten test show.
import { createOmnifmRadioLiveTracker, createOmnifmRadioPoller } from "../src/services/omnifm-radio-live.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const START = Date.parse("2026-11-25T20:00:00Z");
const at = (ms) => new Date(START + ms).toISOString();

function clock(start = START) {
  const time = { at: start };
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

function setup({ store = memoryStore(), now = clock(), ...options } = {}) {
  const events = [];
  const tracker = createOmnifmRadioLiveTracker({ graceMs: MINUTE, pollMs: 30 * SECOND, now, store, onEvent: (event) => events.push(event), ...options });
  return { now, events, tracker, store };
}

const types = (events) => events.map((event) => event.type);
const live = (streamerName = "DJ A", extra = {}) => ({ isLive: true, streamerName, title: "", ...extra });
const OFFLINE = { isLive: false, streamerName: "", title: "Auto-DJ Song" };

function deferred() {
  let resolve;
  const promise = new Promise((_resolve) => { resolve = _resolve; });
  return { promise, resolve };
}

// ---------------------------------------------------------------- 1: reconnect after the grace time

test("a reconnect after the grace time is a new show, even without a tick in between", async () => {
  const { tracker, events, now } = setup();
  await tracker.observe(live("DJ A"), "webhook");
  now.advance(10 * MINUTE);
  await tracker.observe(OFFLINE, "webhook");
  now.advance(55 * SECOND);
  await tracker.observe(OFFLINE, "poll");
  now.advance(30 * SECOND);
  await tracker.observe(live("DJ B"), "webhook");
  assert.deepEqual(types(events), ["start", "end", "start"]);
  assert.equal(events[1].show.endedAt, at(10 * MINUTE), "A ended when it dropped");
  assert.equal(tracker.snapshot().current.streamerName, "DJ B");
});

// ---------------------------------------------------------------- 2: a database that does not answer

test("a failed load never overwrites the stored shows or announces a running show again", async () => {
  const stored = {
    current: { isLive: true, streamerName: "DJ A", title: "", startedAt: at(0), endedAt: null, source: "webhook", offlineSince: null },
    shows: [1, 2, 3].map((index) => ({ streamerName: "DJ A", title: `Show ${index}`, startedAt: at(-index * 24 * 60 * MINUTE), endedAt: at(-index * 24 * 60 * MINUTE + 30 * MINUTE), source: "poll" })),
  };
  const store = memoryStore(stored);
  let failures = 1;
  const realLoad = store.load.bind(store);
  store.load = async () => {
    if (failures > 0) {
      failures -= 1;
      throw new Error("MongoDB weg");
    }
    return realLoad();
  };
  const { tracker, events, now } = setup({ store, now: clock(START + 5 * MINUTE) });
  assert.equal(await tracker.load(), false);
  now.advance(30 * SECOND);
  await tracker.observe(live("DJ A"), "poll");
  assert.deepEqual(events, [], "the running show is not announced again");
  assert.equal(tracker.snapshot().shows.length, 3);
  assert.equal(store.peek().shows.length, 3, "the stored history is intact");
  assert.equal(tracker.snapshot().current.startedAt, at(0));
});

test("while the state cannot be read nothing is stored and nothing announced", async () => {
  const store = memoryStore();
  store.load = async () => { throw new Error("MongoDB weg"); };
  const { tracker, events } = setup({ store });
  await tracker.observe(live("DJ A"), "webhook");
  await tracker.tick();
  assert.equal((await tracker.startTestShow()).ok, false);
  assert.deepEqual(events, []);
  assert.equal(store.saves, 0);
  assert.equal(tracker.snapshot().readable, false);
});

test("a hanging database cannot block the live state for good", async () => {
  const store = memoryStore();
  let hang = true;
  const realSave = store.save.bind(store);
  store.save = (state) => (hang ? new Promise(() => {}) : realSave(state));
  const { tracker, events, now } = setup({ store, storeTimeoutMs: 20 });
  await tracker.observe(live("DJ A"), "webhook");
  assert.deepEqual(types(events), ["start"], "the event goes out although the save hangs");
  hang = false;
  now.advance(MINUTE);
  await tracker.observe(OFFLINE, "poll");
  assert.ok(tracker.snapshot().current.offlineSince, "the next observation still runs");
});

// ---------------------------------------------------------------- 3: a gap the bot did not see

test("a new broadcast after a gap the bot missed ends the old show and starts the new one", async () => {
  const store = memoryStore({
    current: { isLive: true, streamerName: "DJ A", title: "", startedAt: at(0), endedAt: null, source: "webhook", offlineSince: null },
    shows: [],
    track: { lastLiveAt: at(30 * MINUTE) },
  });
  // The bot was down for three hours; A ended, B went live at 22:30.
  const { tracker, events } = setup({ store, now: clock(START + 210 * MINUTE) });
  await tracker.observe(live("DJ B", { liveSince: at(150 * MINUTE) }), "poll");
  assert.deepEqual(types(events), ["end", "start"]);
  assert.equal(events[0].show.streamerName, "DJ A");
  assert.equal(events[0].show.endedAt, at(150 * MINUTE));
  assert.equal(events[1].show.streamerName, "DJ B");
  assert.equal(tracker.snapshot().current.startedAt, at(150 * MINUTE));
});

test("the same broadcast after a restart, or a short drop between two polls, stays one show", async () => {
  const sameBroadcast = setup({
    store: memoryStore({ current: { isLive: true, streamerName: "DJ A", startedAt: at(0), source: "poll" }, shows: [], track: { lastLiveAt: at(30 * MINUTE) } }),
    now: clock(START + 40 * MINUTE),
  });
  await sameBroadcast.tracker.observe(live("DJ A", { liveSince: at(0) }), "poll");
  assert.deepEqual(sameBroadcast.events, []);

  // Seen live at 20:30:00, AzuraCast says it reconnected at 20:30:20: not seen offline, 20 s gap.
  const shortDrop = setup({
    store: memoryStore({ current: { isLive: true, streamerName: "DJ A", startedAt: at(0), source: "poll" }, shows: [], track: { lastLiveAt: at(30 * MINUTE) } }),
    now: clock(START + 30 * MINUTE + 30 * SECOND),
  });
  await shortDrop.tracker.observe(live("DJ A", { liveSince: at(30 * MINUTE + 20 * SECOND) }), "poll");
  assert.deepEqual(shortDrop.events, []);
  assert.equal(shortDrop.tracker.snapshot().current.startedAt, at(0));
});

// ---------------------------------------------------------------- 4: the test show

test("a forgotten test show ends by itself after 10 minutes and stays out of the history", async () => {
  const { tracker, events, now } = setup();
  await tracker.startTestShow();
  assert.equal(tracker.snapshot().current.source, "test", "listeners can tell a test apart");
  now.advance(9 * MINUTE);
  await tracker.tick();
  assert.equal(tracker.snapshot().current.isLive, true);
  now.advance(2 * MINUTE);
  await tracker.tick();
  assert.equal(tracker.snapshot().current.isLive, false);
  assert.deepEqual(events.map((event) => [event.type, event.show.source]), [["start", "test"], ["end", "test"]]);
  assert.equal(events[1].show.durationMs, 10 * MINUTE);
  assert.deepEqual(tracker.snapshot().shows, []);
  assert.equal(tracker.snapshot().testShows.length, 1);
});

// ---------------------------------------------------------------- 5: stale polls

test("a poll that started before the last webhook does not overwrite it", async () => {
  const { tracker, events, now } = setup();
  const answer = deferred();
  const poller = createOmnifmRadioPoller({ tracker, fetchNowPlaying: () => answer.promise, intervalMs: 30 * SECOND, now });
  const polling = poller.pollOnce();
  now.advance(SECOND);
  await tracker.observe(live("DJ A"), "webhook");
  now.advance(SECOND);
  answer.resolve({ ok: true, isLive: false, songText: "Auto-DJ Song" });
  await polling;
  assert.equal(tracker.snapshot().current.isLive, true);
  assert.equal(tracker.snapshot().current.offlineSince, null, "the old offline answer is dropped");
  assert.deepEqual(types(events), ["start"]);
});

test("a poll that started after the webhook counts", async () => {
  const { tracker, now } = setup();
  await tracker.observe(live("DJ A"), "webhook");
  now.advance(SECOND);
  const poller = createOmnifmRadioPoller({ tracker, fetchNowPlaying: async () => ({ ok: true, isLive: false, songText: "Auto-DJ Song" }), intervalMs: 30 * SECOND, now });
  await poller.pollOnce();
  assert.equal(tracker.snapshot().current.offlineSince, at(SECOND));
});

// ---------------------------------------------------------------- 6: the show title

test("the last auto-DJ song is no show title; a new text after going live is", async () => {
  const { tracker, events, now } = setup();
  await tracker.observe({ ...OFFLINE, title: "Artist - Auto-DJ Song" }, "poll");
  now.advance(10 * SECOND);
  await tracker.observe(live("DJ Tabsi", { title: "Artist - Auto-DJ Song" }), "webhook");
  assert.equal(events[0].show.title, "", "the start message names only the DJ");
  now.advance(30 * SECOND);
  await tracker.observe(live("DJ Tabsi", { title: "Artist - Auto-DJ Song" }), "poll");
  assert.equal(tracker.snapshot().current.title, "");
  now.advance(30 * SECOND);
  await tracker.observe(live("DJ Tabsi", { title: "Tabsi live: Abendshow" }), "poll");
  assert.equal(tracker.snapshot().current.title, "Tabsi live: Abendshow");
  now.advance(30 * SECOND);
  await tracker.observe(live("DJ Tabsi", { title: "Artist - Next Song" }), "poll");
  assert.equal(tracker.snapshot().current.title, "Tabsi live: Abendshow", "the title stays once found");
});

test("without a text from before going live the first live text is not trusted", async () => {
  const { tracker, events } = setup();
  await tracker.observe(live("DJ Tabsi", { title: "Artist - Auto-DJ Song" }), "poll");
  assert.equal(events[0].show.title, "");
  assert.equal(tracker.snapshot().current.title, "");
});

// ---------------------------------------------------------------- 10: shutdown

test("stopping the poller waits for the poll that is running", async () => {
  const { tracker } = setup();
  const answer = deferred();
  const poller = createOmnifmRadioPoller({
    tracker,
    fetchNowPlaying: () => answer.promise,
    intervalMs: 30 * SECOND,
    setIntervalFn: () => ({ unref() {} }),
    clearIntervalFn: () => {},
  });
  poller.start();
  let stopped = false;
  const stopping = poller.stop().then(() => { stopped = true; });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(stopped, false, "still waiting for the answer");
  answer.resolve({ ok: true, isLive: true, streamerName: "DJ A" });
  await stopping;
  assert.equal(stopped, true);
  assert.equal(tracker.snapshot().current.isLive, true, "the last answer was still applied");
});
