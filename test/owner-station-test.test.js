import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import { testOwnerStationStream } from "../src/lib/owner-station-test.js";

async function withHttpServer(handler, fn) {
  const server = http.createServer(handler);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  try {
    const { port } = server.address();
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
    await once(server, "close");
  }
}

test("owner station stream test reports successful configured station URL", async () => {
  await withHttpServer((req, res) => {
    assert.equal(req.headers["user-agent"], "OmniFM-OwnerStationTest/1.0");
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(req.method === "HEAD" ? "" : "ok");
  }, async (baseUrl) => {
    const result = await testOwnerStationStream({
      key: "localtest",
      name: "Local Test",
      url: `${baseUrl}/stream.mp3`,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "up");
    assert.equal(result.method, "HEAD");
    assert.equal(result.httpStatus, 200);
    assert.equal(result.key, "localtest");
    assert.equal(result.name, "Local Test");
    assert.equal(result.error, null);
    assert.equal(typeof result.responseTimeMs, "number");
  });
});

test("owner station stream test falls back to ranged GET when HEAD fails", async () => {
  await withHttpServer((req, res) => {
    if (req.method === "HEAD") {
      req.socket.destroy();
      return;
    }
    assert.equal(req.method, "GET");
    assert.equal(req.headers.range, "bytes=0-0");
    res.writeHead(206, { "Content-Type": "audio/mpeg" });
    res.end("o");
  }, async (baseUrl) => {
    const result = await testOwnerStationStream({
      key: "fallback",
      name: "Fallback",
      url: `${baseUrl}/stream.mp3`,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "up");
    assert.equal(result.method, "GET");
    assert.equal(result.httpStatus, 206);
  });
});

test("owner station stream test falls back to ranged GET when HEAD is not allowed", async () => {
  await withHttpServer((req, res) => {
    if (req.method === "HEAD") {
      res.writeHead(405, { Allow: "GET" });
      res.end();
      return;
    }
    assert.equal(req.method, "GET");
    assert.equal(req.headers.range, "bytes=0-0");
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end("o");
  }, async (baseUrl) => {
    const result = await testOwnerStationStream({
      key: "head405",
      name: "Head 405",
      url: `${baseUrl}/stream.mp3`,
    });

    assert.equal(result.ok, true);
    assert.equal(result.status, "up");
    assert.equal(result.method, "GET");
    assert.equal(result.httpStatus, 200);
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
});
