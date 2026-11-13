import assert from "node:assert/strict";
import test from "node:test";

import { checkStation } from "../src/services/station-health.js";
import { HTML_PAGE, mp3Frames, withStreamServer } from "./support/stream-probe-server.mjs";

// #538: the health check calls a station "up" and playable in Discord only
// when the stream sends audio; a page, a login wall or a HEAD answer is not.

const check = (key, fetchImpl) => checkStation(key, "Test FM", "http://radio.test/live", { fetchImpl });

test("a station that sends MP3 is up and playable in Discord", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg", "icy-name": "Test  FM live" });
    res.end(mp3Frames());
  }, async (fetchImpl) => {
    const entry = await check("health-mp3", fetchImpl);
    assert.deepEqual(
      [entry.status, entry.ok, entry.reachable, entry.authorized, entry.playableAudio, entry.discordOk, entry.format, entry.httpStatus, entry.reasonCode, entry.error],
      ["up", true, true, true, true, true, "mp3", 200, "ok", null],
    );
    assert.deepEqual([entry.consecutiveFailures, entry.consecutiveSuccesses, entry.streamName], [0, 1, "Test FM live"]);
    assert.equal(typeof entry.responseTimeMs, "number");
  });
});

test("HEAD 200 on a page is not a working station", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html", "icy-name": "Fake" });
    res.end(req.method === "HEAD" ? undefined : HTML_PAGE);
  }, async (fetchImpl, state) => {
    const entry = await check("health-html", fetchImpl);
    assert.deepEqual(
      [entry.status, entry.ok, entry.reachable, entry.authorized, entry.playableAudio, entry.discordOk, entry.format, entry.reasonCode],
      ["down", false, true, true, false, false, "html", "not_audio"],
    );
    assert.equal(entry.error, "Kein Audio (HTML-Seite)");
    assert.deepEqual([entry.consecutiveFailures, entry.consecutiveSuccesses, entry.streamName], [1, 0, null]);
    assert.deepEqual(state.requests.map((request) => request.method), ["GET"]);
  });
});

test("401 is reachable, but neither up nor playable", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(401);
    res.end();
  }, async (fetchImpl) => {
    const entry = await check("health-401", fetchImpl);
    assert.deepEqual(
      [entry.status, entry.ok, entry.reachable, entry.authorized, entry.playableAudio, entry.discordOk, entry.httpStatus],
      ["down", false, true, false, false, false, 401],
    );
    assert.equal(entry.error, "HTTP 401 (Zugriff verweigert)");
  });
});

test("a station that cannot be reached is down and not reachable", async () => {
  const entry = await check("health-gone", async () => { throw new Error("connect failed"); });
  assert.deepEqual(
    [entry.status, entry.reachable, entry.authorized, entry.discordOk, entry.httpStatus, entry.error, entry.consecutiveFailures],
    ["down", false, null, false, null, "Nicht erreichbar (connect failed)", 1],
  );
});
