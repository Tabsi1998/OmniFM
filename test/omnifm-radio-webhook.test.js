import test from "node:test";
import assert from "node:assert/strict";

// The AzuraCast webhook of OmniFM Radio (#592): a public endpoint guarded by
// a secret (the Basic-auth password AzuraCast sends). It may change nothing
// but the live state; without a secret it does not exist.
import {
  createOmnifmRadioWebhookHandler,
  createOwnerRadioRoutesHandler,
} from "../src/api/routes/omnifm-radio-routes.js";
import { createOmnifmRadioLiveTracker } from "../src/services/omnifm-radio-live.js";
import { getApiRateLimitSpec } from "../src/lib/api-rate-limit.js";
import { isRuntimePath } from "../src/api/runtime-forward.js";

const SECRET = "ein-langes-geheimnis-fuer-azuracast";

function azuracast({ live = true, streamer = "DJ Tabsi", shortcode = "omnifm_radio" } = {}) {
  return {
    station: { shortcode },
    live: { is_live: live, streamer_name: live ? streamer : "", broadcast_start: null, art: null },
    now_playing: { song: { text: "Abendshow", title: "Abendshow", artist: "" } },
    is_online: true,
  };
}

const basic = (user, password) => `Basic ${Buffer.from(`${user}:${password}`, "utf8").toString("base64")}`;

function setup({ secret = SECRET, enabled = true, service = undefined } = {}) {
  const logs = [];
  const events = [];
  const tracker = createOmnifmRadioLiveTracker({
    store: { load: async () => null, save: async () => {} },
    onEvent: (event) => events.push(event),
  });
  const running = service === undefined ? { tracker } : service;
  const handler = createOmnifmRadioWebhookHandler({
    getService: () => running,
    getSettings: () => ({ enabled, station: "omnifm_radio", webhookSecret: secret }),
    log: (level, message) => logs.push({ level, message }),
  });
  const call = async ({ method = "POST", path = "/api/radio/webhook", authorization, body = azuracast() } = {}) => {
    const raw = typeof body === "string" ? body : JSON.stringify(body);
    const res = {
      headers: {},
      writeHead(status, headers = {}) { this.status = status; Object.assign(this.headers, headers); },
      setHeader(name, value) { this.headers[name] = value; },
      end(payload) { this.body = payload ? JSON.parse(payload) : null; },
    };
    let read = false;
    const readRawBody = async (maxBytes = 1024 * 1024) => {
      read = true;
      if (Buffer.byteLength(raw) > maxBytes) throw Object.assign(new Error("Body too large"), { status: 413 });
      return raw;
    };
    const req = { method, headers: authorization ? { authorization } : {}, socket: { remoteAddress: "203.0.113.7" } };
    const handled = await handler({ req, res, requestUrl: new URL(`https://omnifm.xyz${path}`), readRawBody });
    return { handled, res, read };
  };
  return { call, logs, events, tracker };
}

test("the right secret is accepted and the live state follows the payload", async () => {
  const { call, events, tracker } = setup();
  const { res } = await call({ authorization: basic("azuracast", SECRET) });
  assert.equal(res.status, 200);
  assert.equal(res.body.isLive, true);
  assert.equal(tracker.snapshot().current.streamerName, "DJ Tabsi");
  assert.equal(tracker.snapshot().current.source, "webhook");
  assert.deepEqual(events.map((event) => event.type), ["start"]);

  const offline = await call({ authorization: basic("azuracast", SECRET), body: azuracast({ live: false }) });
  assert.equal(offline.res.status, 200);
  assert.ok(tracker.snapshot().current.offlineSince, "offline starts the grace time");
});

test("the user name does not matter, a colon in the password does", async () => {
  const { call } = setup({ secret: "teil-eins:teil-zwei-und-mehr" });
  assert.equal((await call({ authorization: basic("irgendwer", "teil-eins:teil-zwei-und-mehr") })).res.status, 200);
  assert.equal((await call({ authorization: basic("irgendwer", "teil-eins") })).res.status, 401);
});

test("a wrong or missing secret is refused before the body is read, and logged without it", async () => {
  const { call, logs, events } = setup();
  for (const authorization of [undefined, basic("azuracast", "falsch"), basic("azuracast", `${SECRET}x`), `Bearer ${SECRET}`, "Basic !!!", basic("", "")]) {
    // eslint-disable-next-line no-await-in-loop -- one request after the other
    const { res, read } = await call({ authorization });
    assert.equal(res.status, 401, String(authorization));
    assert.equal(read, false, "an unknown caller never gets its body read");
  }
  assert.deepEqual(events, []);
  assert.ok(logs.length >= 1);
  assert.ok(logs.every((entry) => !entry.message.includes(SECRET)), "the secret never reaches the log");
  assert.ok(logs.some((entry) => entry.message.includes("203.0.113.7")), "the caller's address is logged");
});

test("without a secret the endpoint does not exist", async () => {
  for (const options of [{ secret: "" }, { enabled: false }]) {
    const { call } = setup(options);
    // eslint-disable-next-line no-await-in-loop -- one setup after the other
    const { res, handled } = await call({ authorization: basic("azuracast", SECRET) });
    assert.equal(handled, true);
    assert.equal(res.status, 404);
  }
});

test("an oversized body is refused", async () => {
  const { call, events } = setup();
  const huge = { ...azuracast(), padding: "x".repeat(300 * 1024) };
  const { res } = await call({ authorization: basic("azuracast", SECRET), body: huge });
  assert.equal(res.status, 413);
  assert.deepEqual(events, []);
});

test("only a now-playing payload of the own station counts", async () => {
  const { call, events } = setup();
  const auth = basic("azuracast", SECRET);
  assert.equal((await call({ authorization: auth, body: "kein json" })).res.status, 400);
  assert.equal((await call({ authorization: auth, body: { live: "yes" } })).res.status, 400, "no is_live: not read as offline");
  assert.equal((await call({ authorization: auth, body: [] })).res.status, 400);
  assert.equal((await call({ authorization: auth, body: azuracast({ shortcode: "andere_station" }) })).res.status, 422);
  assert.deepEqual(events, []);
});

test("other methods and paths; an unknown caller learns nothing about the method", async () => {
  const { call } = setup();
  assert.equal((await call({ method: "GET" })).res.status, 401, "the secret is checked before the method");
  assert.equal((await call({ method: "GET", authorization: basic("azuracast", SECRET) })).res.status, 405);
  assert.equal((await call({ path: "/api/radio/other" })).handled, false);
});

test("before the live detection runs the webhook says so", async () => {
  const { call } = setup({ service: null });
  assert.equal((await call({ authorization: basic("azuracast", SECRET) })).res.status, 503);
});

test("the webhook counts as a webhook for the rate limit and reaches the commander", () => {
  assert.equal(getApiRateLimitSpec("/api/radio/webhook").scope, "webhook");
  assert.equal(isRuntimePath("/api/radio/webhook"), true);
});

// ---------------------------------------------------------------- owner console

function ownerSetup({ role = "owner", running = true } = {}) {
  const tracker = createOmnifmRadioLiveTracker({ store: { load: async () => null, save: async () => {} }, onEvent: () => {} });
  const handler = createOwnerRadioRoutesHandler({
    getService: () => (running ? { tracker, settings: { webhookSecret: "", webhookSecretTooShort: true, pollMs: 30_000, graceMs: 60_000 }, config: { enabled: true, station: "omnifm_radio" } } : null),
    resolveIdentity: async (req) => (req.headers["x-test-role"] ? { via: "token", role: req.headers["x-test-role"] } : null),
  });
  const call = async (method, path, body = {}, headers = { "x-test-role": role }) => {
    const res = { writeHead(status) { this.status = status; }, setHeader() {}, end(payload) { this.body = payload ? JSON.parse(payload) : null; } };
    const handled = await handler({ req: { method, headers }, res, requestUrl: new URL(`https://omnifm.xyz${path}`), readJsonBody: async () => body });
    return { handled, res };
  };
  return { call, tracker };
}

test("the owner console reads the live state and runs the test show", async () => {
  const { call, tracker } = ownerSetup();
  const read = await call("GET", "/api/owner/radio");
  assert.equal(read.res.status, 200);
  assert.equal(read.res.body.current.isLive, false);
  assert.equal(read.res.body.webhook, false, "says whether the webhook is set, never the secret");
  assert.equal(read.res.body.webhookSecretTooShort, true, "the console can say why it is off");
  assert.equal(read.res.body.canTest, true);
  assert.equal(read.res.body.current.source, null);

  const started = await call("POST", "/api/owner/radio/test-show", { action: "start" });
  assert.equal(started.res.status, 200);
  assert.equal(started.res.body.current.isLive, true);
  assert.equal(tracker.snapshot().current.source, "test");
  assert.equal((await call("POST", "/api/owner/radio/test-show", { action: "start" })).res.status, 409);

  const ended = await call("POST", "/api/owner/radio/test-show", { action: "end" });
  assert.equal(ended.res.status, 200);
  assert.equal(ended.res.body.testShows[0].source, "test");
  assert.deepEqual(ended.res.body.shows, [], "a test is no show in the history");
  assert.equal((await call("POST", "/api/owner/radio/test-show", { action: "wipe" })).res.status, 400);
});

test("the console's radio routes need an owner, and the test show the owner role", async () => {
  const { call } = ownerSetup({ role: "support" });
  assert.equal((await call("GET", "/api/owner/radio", {}, {})).res.status, 401);
  const read = await call("GET", "/api/owner/radio");
  assert.equal(read.res.status, 200, "every role reads");
  assert.equal(read.res.body.canTest, false, "the console hides the test button");
  assert.equal((await call("POST", "/api/owner/radio/test-show", { action: "start" })).res.status, 403);
  assert.equal((await ownerSetup({ running: false }).call("GET", "/api/owner/radio")).res.body.enabled, false);
});
