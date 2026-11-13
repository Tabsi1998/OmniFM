import assert from "node:assert/strict";
import test from "node:test";

import { testOwnerStationStream } from "../src/lib/owner-station-test.js";
import { HTML_PAGE, mp3Frames, withStreamServer } from "./support/stream-probe-server.mjs";

const station = (key) => ({ key, name: "Local Test", url: "http://radio.test/stream.mp3" });

test("owner station stream test reports a station that sends audio", async () => {
  await withStreamServer((req, res) => {
    assert.equal(req.headers["user-agent"], "OmniFM-OwnerStationTest/1.0");
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(mp3Frames());
  }, async (fetchImpl) => {
    const result = await testOwnerStationStream(station("localtest"), { fetchImpl });

    assert.equal(result.ok, true);
    assert.equal(result.status, "up");
    assert.equal(result.method, "GET");
    assert.equal(result.httpStatus, 200);
    assert.deepEqual([result.reachable, result.authorized, result.playableAudio, result.format, result.reasonCode], [true, true, true, "mp3", "ok"]);
    assert.equal(result.key, "localtest");
    assert.equal(result.name, "Local Test");
    assert.equal(result.error, null);
    assert.equal(typeof result.responseTimeMs, "number");
  });
});

// #538: HEAD is not asked at all, so a server that mishandles it does not matter.
test("owner station stream test works when HEAD fails or is not allowed", async () => {
  for (const refuseHead of [(req) => req.socket.destroy(), (req, res) => { res.writeHead(405, { Allow: "GET" }); res.end(); }]) {
    // eslint-disable-next-line no-await-in-loop -- one server after the other
    await withStreamServer((req, res) => {
      if (req.method === "HEAD") {
        refuseHead(req, res);
        return;
      }
      res.writeHead(206, { "Content-Type": "audio/mpeg" });
      res.end(mp3Frames());
    }, async (fetchImpl) => {
      const result = await testOwnerStationStream(station("nohead"), { fetchImpl });
      assert.deepEqual([result.ok, result.status, result.method, result.httpStatus], [true, "up", "GET", 206]);
    });
  }
});

test("owner station stream test refuses a page that answers HEAD with 200 (#538)", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(req.method === "HEAD" ? undefined : HTML_PAGE);
  }, async (fetchImpl) => {
    const result = await testOwnerStationStream(station("page"), { fetchImpl });
    assert.deepEqual(
      [result.ok, result.status, result.httpStatus, result.reachable, result.authorized, result.playableAudio, result.format, result.reasonCode],
      [false, "down", 200, true, true, false, "html", "not_audio"],
    );
    assert.equal(result.error, "Kein Audio (HTML-Seite)");
  });
});

test("owner station stream test: 401 is reachable but not playable (#538)", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(401);
    res.end();
  }, async (fetchImpl) => {
    const result = await testOwnerStationStream(station("locked"), { fetchImpl });
    assert.deepEqual(
      [result.ok, result.status, result.httpStatus, result.reachable, result.authorized, result.playableAudio, result.error],
      [false, "down", 401, true, false, false, "HTTP 401 (Zugriff verweigert)"],
    );
  });
});

test("owner station stream test rejects invalid configured URLs before fetching", async () => {
  await assert.rejects(
    () => testOwnerStationStream({ key: "bad", name: "Bad", url: "ftp://example.com/live" }),
    /http:\/\/ oder https:\/\//,
  );
});

test("owner station stream test returns down result for fetch failures", async () => {
  const result = await testOwnerStationStream(
    { key: "fail", name: "Fail", url: "https://radio.example/live" },
    { fetchImpl: async () => { throw new Error("network down"); } },
  );

  assert.equal(result.ok, false);
  assert.equal(result.status, "down");
  assert.equal(result.error, "network down");
  assert.equal(result.httpStatus, null);
  assert.equal(result.reachable, false);
});
