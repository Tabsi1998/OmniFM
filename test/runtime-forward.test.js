import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { once } from "node:events";

import { forwardRequestHeaders, forwardToRuntime, isRuntimePath, RUNTIME_UNAVAILABLE } from "../src/api/runtime-forward.js";

test("only the paths that need the bots go to the commander (#290)", () => {
  for (const path of ["/api/auth/session", "/api/dashboard", "/api/dashboard/stats", "/api/share/station/x", "/api/station-logos/a.png", "/api/owner/status"]) {
    assert.equal(isRuntimePath(path), true, path);
  }
  for (const path of ["/api/admin/config", "/api/stats", "/api/premium/webhook", "/api/authx", "/api/dashboards"]) {
    assert.equal(isRuntimePath(path), false, path);
  }
});

test("forwarded headers: caller appended, same-origin Origin dropped, hop-by-hop left behind", () => {
  const same = forwardRequestHeaders({
    host: "omnifm.xyz",
    origin: "https://omnifm.xyz",
    "x-forwarded-for": "203.0.113.7",
    connection: "keep-alive",
    "transfer-encoding": "chunked",
    cookie: "omnifm_session=abc",
    "content-length": "12",
  }, { clientIp: "10.0.0.2" });
  assert.equal(same.origin, undefined, "same origin is legitimate; the CSRF header still guards changes");
  assert.equal(same["x-forwarded-for"], "203.0.113.7, 10.0.0.2");
  assert.equal(same["x-forwarded-proto"], "http");
  assert.equal(same["x-forwarded-host"], "omnifm.xyz");
  assert.equal(same.cookie, "omnifm_session=abc");
  assert.equal(same["content-length"], "12", "the body passes unchanged, so its length stays");
  assert.equal(same.connection, undefined);
  assert.equal(same["transfer-encoding"], undefined);

  const foreign = forwardRequestHeaders({ host: "omnifm.xyz", origin: "https://evil.example", "x-forwarded-proto": "https" });
  assert.equal(foreign.origin, "https://evil.example", "a foreign origin goes on, so the commander refuses it");
  assert.equal(foreign["x-forwarded-proto"], "https");
});

test("a restarting commander gives 503 with Retry-After; a running one answers through", async (t) => {
  const commander = http.createServer((req, res) => {
    let body = "";
    req.on("data", (chunk) => { body += chunk; });
    req.on("end", () => {
      res.writeHead(201, { "Content-Type": "application/json", "Set-Cookie": ["a=1", "b=2"] });
      res.end(JSON.stringify({ path: req.url, body, forwardedFor: req.headers["x-forwarded-for"] }));
    });
  });
  commander.listen(0, "127.0.0.1");
  await once(commander, "listening");
  const target = `http://127.0.0.1:${commander.address().port}`;
  let current = target;
  const entry = http.createServer((req, res) => forwardToRuntime(req, res, current, { connectTimeoutMs: 1000 }));
  entry.listen(0, "127.0.0.1");
  await once(entry, "listening");
  t.after(() => { entry.close(); commander.close(); });
  const base = `http://127.0.0.1:${entry.address().port}`;

  const answer = await fetch(`${base}/api/dashboard/settings?serverId=1`, { method: "PUT", body: "{\"a\":1}" });
  assert.equal(answer.status, 201);
  assert.deepEqual(answer.headers.getSetCookie(), ["a=1", "b=2"]);
  const echoed = await answer.json();
  assert.deepEqual([echoed.path, echoed.body], ["/api/dashboard/settings?serverId=1", "{\"a\":1}"]);
  assert.match(echoed.forwardedFor, /127\.0\.0\.1/);

  commander.close();
  current = "http://127.0.0.1:1";
  const down = await fetch(`${base}/api/auth/session`);
  assert.equal(down.status, 503);
  assert.equal(down.headers.get("retry-after"), "5");
  assert.deepEqual(await down.json(), { error: RUNTIME_UNAVAILABLE, retryable: true });
});
