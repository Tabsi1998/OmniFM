import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

import { createLiveHub, liveSignature, sseMessage } from "../src/lib/dashboard-live.js";
import { createDashboardLiveRouteHandler } from "../src/api/routes/dashboard-live.js";
import { forwardToRuntime } from "../src/api/runtime-forward.js";

// The dashboard listens instead of asking (#502).

function fakeTimers() {
  const intervals = new Map();
  let next = 1;
  return {
    setInterval(fn, ms) {
      const id = next;
      next += 1;
      intervals.set(id, { fn, ms });
      return id;
    },
    clearInterval(id) {
      intervals.delete(id);
    },
    run(ms) {
      for (const entry of [...intervals.values()]) if (entry.ms === ms) entry.fn();
    },
    get count() {
      return intervals.size;
    },
  };
}

function watcherOf(hub, { guildId = "g1", sessionKey = "s1", address = "1.1.1.1", data, allowed = () => true } = {}) {
  const written = [];
  const state = { ended: false, data };
  const stop = hub.watch({
    guildId,
    sessionKey,
    address,
    snapshot: () => state.data,
    stillAllowed: allowed,
    write: (text) => written.push(text),
    end: () => { state.ended = true; },
  });
  return { written, state, stop };
}

const live = (written) => written.filter((text) => text.startsWith("event: live")).map((text) => JSON.parse(text.split("data: ")[1]));

test("the first snapshot goes out at once; after that only a change, and the ticking values once a minute", () => {
  const timers = fakeTimers();
  let clock = 0;
  const hub = createLiveHub({ timers, now: () => clock, tickMs: 2000, heartbeatMs: 25000, refreshMs: 60000 });
  const row = { botId: "b1", listeners: 3, uptimeSec: 100 };
  const one = watcherOf(hub, { data: { serverId: "g1", streams: [row], listenersNow: 3, runtimeUptimeSec: 100, totalListeningMs: 5 } });
  assert.equal(live(one.written).length, 1, "at once");

  // Uptime and minutes grow: no change.
  one.state.data = { serverId: "g1", streams: [{ ...row, uptimeSec: 102 }], listenersNow: 3, runtimeUptimeSec: 102, totalListeningMs: 9 };
  clock = 2000;
  timers.run(2000);
  assert.equal(live(one.written).length, 1, "growing values alone are no change");

  // A listener joins: a change.
  one.state.data = { ...one.state.data, streams: [{ ...row, listeners: 4, uptimeSec: 104 }], listenersNow: 4 };
  clock = 4000;
  timers.run(2000);
  assert.equal(live(one.written).at(-1).listenersNow, 4);

  // A minute without a change: the ticking values come along anyway.
  one.state.data = { ...one.state.data, runtimeUptimeSec: 164 };
  clock = 64_100;
  timers.run(2000);
  assert.equal(live(one.written).at(-1).runtimeUptimeSec, 164);
  assert.equal(live(one.written).length, 3);
});

test("one look per server and round, however many tabs watch it; a heartbeat keeps proxies open", () => {
  const timers = fakeTimers();
  const hub = createLiveHub({ timers, tickMs: 2000, heartbeatMs: 25000 });
  let looks = 0;
  const written = [];
  for (let tab = 0; tab < 3; tab += 1) {
    hub.watch({
      guildId: "g1",
      sessionKey: `s${tab}`,
      address: "1.1.1.1",
      snapshot: () => { looks += 1; return { serverId: "g1", listenersNow: looks }; },
      stillAllowed: () => true,
      write: (text) => written.push(text),
      end: () => {},
    });
  }
  looks = 0;
  timers.run(2000);
  assert.equal(looks, 1, "one snapshot for three tabs");
  timers.run(25000);
  assert.equal(written.filter((text) => text === ": ping\n\n").length, 3);
});

test("a watcher signed out or without the server is let go; no watcher, no timers", () => {
  const timers = fakeTimers();
  const hub = createLiveHub({ timers, tickMs: 2000, heartbeatMs: 25000 });
  let allowed = true;
  const one = watcherOf(hub, { data: { serverId: "g1" }, allowed: () => allowed });
  assert.equal(timers.count, 2);
  allowed = false;
  timers.run(2000);
  assert.equal(one.state.ended, true, "the stream ends");
  assert.equal(hub.size, 0);
  assert.equal(timers.count, 0, "nothing ticks for nobody");

  const two = watcherOf(hub, { data: { serverId: "g1" } });
  two.stop();
  assert.equal(hub.size, 0);
  assert.equal(timers.count, 0);
});

test("a stream that cannot be written to is dropped", () => {
  const timers = fakeTimers();
  const hub = createLiveHub({ timers, tickMs: 2000, heartbeatMs: 25000 });
  hub.watch({
    guildId: "g1", sessionKey: "s", address: "a", snapshot: () => ({ serverId: "g1" }), stillAllowed: () => true,
    write: () => { throw new Error("socket gone"); }, end: () => {},
  });
  assert.equal(hub.size, 0);
});

test("a few streams per sign-in and per address", () => {
  const hub = createLiveHub({ timers: fakeTimers(), maxPerSession: 2, maxPerAddress: 3 });
  watcherOf(hub, { sessionKey: "s1", address: "a" });
  watcherOf(hub, { sessionKey: "s1", address: "a" });
  assert.equal(hub.hasRoom("s1", "a"), false, "the third of one sign-in");
  assert.equal(hub.hasRoom("s2", "a"), true);
  watcherOf(hub, { sessionKey: "s2", address: "a" });
  assert.equal(hub.hasRoom("s3", "a"), false, "the fourth of one address");
  assert.equal(hub.hasRoom("s3", "b"), true);
});

test("the change signature leaves out what grows by the second", () => {
  assert.equal(
    liveSignature({ a: 1, streams: [{ uptimeSec: 1 }], runtimeUptimeSec: 1, totalListeningMs: 1 }),
    liveSignature({ a: 1, streams: [{ uptimeSec: 9 }], runtimeUptimeSec: 9, totalListeningMs: 9 }),
  );
  assert.equal(sseMessage("live", { a: 1 }), "event: live\ndata: {\"a\":1}\n\n");
});

function routeWith({ session = { id: "u" }, guild = { id: "g1", tier: "pro" }, capabilities = ["dashboard_basic", "dashboard_access"], hub } = {}) {
  const calls = [];
  const handle = createDashboardLiveRouteHandler({
    buildDashboardLiveSnapshot: (id, tier, runtimes, options) => ({ serverId: id, tier, withStats: options.withStats }),
    getClientIp: () => "203.0.113.9",
    getCommonSecurityHeaders: () => ({ "X-Frame-Options": "DENY" }),
    getDashboardRequestTranslator: () => ({ language: "en" }),
    getDashboardSession: () => ({ session, token: "secret-token" }),
    methodNotAllowed: (res) => { res.status = 405; },
    resolveDashboardGuildForSession: (current, id) => (current && id === guild.id ? guild : null),
    sendLocalizedError: (res, status, language, de, en) => { res.status = status; res.error = en; },
    serverHasCapability: (id, capability) => capabilities.includes(capability),
    hub: hub || createLiveHub({ timers: fakeTimers() }),
  });
  const response = () => {
    const res = { written: [], headers: null, status: 0 };
    res.writeHead = (status, headers) => { res.status = status; res.headers = headers; };
    res.write = (text) => { res.written.push(text); return true; };
    res.end = () => { res.ended = true; };
    return res;
  };
  const request = (url, method = "GET") => {
    const listeners = {};
    const req = { method, headers: {}, on: (name, fn) => { listeners[name] = fn; } };
    const res = response();
    return { req, res, listeners, run: () => handle({ req, res, requestUrl: new URL(url, "http://omnifm.test"), runtimes: [] }) };
  };
  return { request, calls };
}

test("the route: signed in, the server's own, the right plan; then a stream with the first message", async () => {
  assert.equal(await routeWith().request("/api/dashboard/stats").run(), false, "other paths are not this route's");

  const post = routeWith().request("/api/dashboard/live?serverId=g1", "POST");
  await post.run();
  assert.equal(post.res.status, 405);

  const anonymous = routeWith({ session: null }).request("/api/dashboard/live?serverId=g1");
  await anonymous.run();
  assert.equal(anonymous.res.status, 401);

  const foreign = routeWith().request("/api/dashboard/live?serverId=other");
  await foreign.run();
  assert.equal(foreign.res.status, 403);

  const noPlan = routeWith({ capabilities: [] }).request("/api/dashboard/live?serverId=g1");
  await noPlan.run();
  assert.equal(noPlan.res.status, 403);

  const ok = routeWith().request("/api/dashboard/live?serverId=g1");
  assert.equal(await ok.run(), true);
  assert.equal(ok.res.status, 200);
  assert.equal(ok.res.headers["Content-Type"], "text/event-stream; charset=utf-8");
  assert.equal(ok.res.headers["Cache-Control"], "no-store");
  assert.equal(ok.res.headers["X-Accel-Buffering"], "no", "nginx must not collect the messages");
  assert.equal(ok.res.headers["X-Frame-Options"], "DENY", "the usual security headers");
  assert.equal(ok.res.written[0], "retry: 10000\n\n");
  assert.deepEqual(JSON.parse(ok.res.written[1].split("data: ")[1]), { serverId: "g1", tier: "pro", withStats: true });
  assert.equal(typeof ok.listeners.close, "function", "the stream ends with the connection");

  const free = routeWith({ capabilities: ["dashboard_basic"] }).request("/api/dashboard/live?serverId=g1");
  await free.run();
  assert.equal(JSON.parse(free.res.written[1].split("data: ")[1]).withStats, false, "Free: the streams only");
});

test("the route: the fifth stream of one sign-in is refused, a closed one frees its place", async () => {
  const hub = createLiveHub({ timers: fakeTimers() });
  const { request } = routeWith({ hub });
  const open = [];
  for (let tab = 0; tab < 4; tab += 1) {
    const stream = request("/api/dashboard/live?serverId=g1");
    // eslint-disable-next-line no-await-in-loop -- one tab after the other
    await stream.run();
    assert.equal(stream.res.status, 200);
    open.push(stream);
  }
  const fifth = request("/api/dashboard/live?serverId=g1");
  await fifth.run();
  assert.equal(fifth.res.status, 429);
  open[0].listeners.close();
  const again = request("/api/dashboard/live?serverId=g1");
  await again.run();
  assert.equal(again.res.status, 200);
});

test("the public entry closes the commander's side when the visitor leaves a stream", async (t) => {
  let upstreamClosed = null;
  const commander = http.createServer((req, res) => {
    upstreamClosed = new Promise((resolve) => { req.socket.on("close", resolve); });
    res.writeHead(200, { "Content-Type": "text/event-stream" });
    res.write(": open\n\n");
  });
  commander.listen(0, "127.0.0.1");
  await once(commander, "listening");
  const entry = http.createServer((req, res) => forwardToRuntime(req, res, `http://127.0.0.1:${commander.address().port}`, { connectTimeoutMs: 1000 }));
  entry.listen(0, "127.0.0.1");
  await once(entry, "listening");
  t.after(() => { entry.close(); commander.close(); });

  const controller = new AbortController();
  const answer = await fetch(`http://127.0.0.1:${entry.address().port}/api/dashboard/live?serverId=1`, { signal: controller.signal });
  const reader = answer.body.getReader();
  const first = await reader.read();
  assert.match(new TextDecoder().decode(first.value), /: open/);
  controller.abort();
  const closed = await Promise.race([upstreamClosed.then(() => true), new Promise((resolve) => { setTimeout(() => resolve(false), 3000); })]);
  assert.equal(closed, true, "the commander's side went with the visitor");
});
