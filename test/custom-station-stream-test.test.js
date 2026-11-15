import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import { createStreamTestLimiter, testCustomStationStream } from "../src/lib/custom-station-stream-test.js";
import { requestPinnedTarget } from "../src/lib/safe-outbound-http.js";
import { HTML_PAGE, mp3Frames } from "./support/stream-probe-server.mjs";

// "Stream testen" for a server's own station (#537): the real safeFetch and
// the real audio probe against a local server. DNS answers come from the
// table below; every connection goes to the local server, so a test can only
// reach it through the policy's own checks.

const PUBLIC_ADDRESS = "93.184.216.34";

async function withServer(handler, fn, { dns = {} } = {}) {
  const requests = [];
  const sockets = new Set();
  const server = http.createServer((req, res) => {
    requests.push(`${req.headers.host}${req.url}`);
    handler(req, res);
  });
  server.on("connection", (socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  const options = {
    timeoutMs: 2_000,
    lookupFn: async (hostname) => {
      const answer = dns[hostname] ?? PUBLIC_ADDRESS;
      if (answer === "ENOTFOUND") throw Object.assign(new Error(`getaddrinfo ENOTFOUND ${hostname}`), { code: "ENOTFOUND" });
      return [{ address: answer, family: 4 }];
    },
    // Only the connection is pinned to the local server; the host header stays.
    requestImpl: (target, request) => requestPinnedTarget({
      url: new URL(`${target.url.pathname}${target.url.search}`, `http://127.0.0.1:${port}`),
      hostname: "127.0.0.1",
      address: "127.0.0.1",
      family: 4,
    }, { ...request, headers: { ...request.headers, Host: target.url.host } }),
  };
  try {
    return await fn((url, extra = {}) => testCustomStationStream(url, { ...options, ...extra }), requests);
  } finally {
    for (const socket of sockets) socket.destroy();
    server.close();
    await once(server, "close");
  }
}

const publicPart = ({ host: _host, detail: _detail, ...answer }) => answer;

test("an MP3 stream is playable, with format and bitrate, and the answer names no address (#537)", async () => {
  await withServer((_req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg", "icy-br": "128,128", "icy-name": "Lounge 10.0.0.7" });
    res.end(mp3Frames(8));
  }, async (run) => {
    const answer = await run("https://radio.example/live.mp3?token=s3cret&sABC=signed");
    assert.deepEqual(
      [answer.ok, answer.result, answer.httpStatus, answer.format, answer.bitrateKbps, answer.redirects],
      [true, "playable", 200, "mp3", 128, 0],
    );
    const sent = JSON.stringify(publicPart(answer));
    for (const secret of ["s3cret", "signed", "radio.example", PUBLIC_ADDRESS, "127.0.0.1", "10.0.0.7", "Lounge"]) {
      assert.equal(sent.includes(secret), false, `${secret} stays on the server`);
    }
    assert.equal(answer.host, "radio.example", "the log gets the host, without path or query");
  });
});

test("a redirect to a private address is refused before anything connects there (#537)", async () => {
  await withServer((req, res) => {
    res.writeHead(302, { Location: "http://127.0.0.1:8000/admin" });
    res.end();
  }, async (run, requests) => {
    const answer = await run("https://radio.example/live");
    assert.deepEqual([answer.ok, answer.result, answer.redirects], [false, "private_target", 1]);
    assert.deepEqual(requests, ["radio.example/live"], "only the public hop was asked");
  });

  // A name that resolves into the private network, behind a redirect.
  await withServer((req, res) => {
    res.writeHead(301, { Location: "https://cdn.example/stream" });
    res.end();
  }, async (run, requests) => {
    const answer = await run("https://radio.example/live");
    assert.equal(answer.result, "private_target");
    assert.deepEqual(requests, ["radio.example/live"]);
  }, { dns: { "cdn.example": "10.0.0.5" } });
});

test("a private or broken address is refused without a request (#537)", async () => {
  await withServer(() => assert.fail("no request"), async (run, requests) => {
    for (const url of ["http://192.168.1.20/stream", "http://localhost:8000/", "http://[::1]/live", "https://box.local/live"]) {
      // eslint-disable-next-line no-await-in-loop -- one URL after the other
      assert.equal((await run(url)).result, "private_target", url);
    }
    for (const url of ["", "radio.example/live", "ftp://radio.example/live", "https://user:pass@radio.example/live", "javascript:alert(1)"]) {
      // eslint-disable-next-line no-await-in-loop -- one URL after the other
      assert.equal((await run(url)).result, "invalid_url", url);
    }
    assert.equal((await run("https://gone.example/live")).result, "dns_failed");
    assert.deepEqual(requests, []);
  }, { dns: { "gone.example": "ENOTFOUND" } });
});

test("redirects: more than three is too many, one without a target is broken (#537)", async () => {
  await withServer((req, res) => {
    const hop = Number(new URL(req.url, "http://x").searchParams.get("hop") || 0);
    res.writeHead(302, { Location: `/live?hop=${hop + 1}` });
    res.end();
  }, async (run, requests) => {
    const answer = await run("https://radio.example/live");
    assert.deepEqual([answer.result, answer.redirects], ["too_many_redirects", 4]);
    assert.equal(requests.length, 4);
  });

  await withServer((_req, res) => {
    res.writeHead(302);
    res.end();
  }, async (run) => {
    assert.equal((await run("https://radio.example/live")).result, "bad_redirect");
  });

  await withServer((_req, res) => {
    res.writeHead(302, { Location: "ftp://radio.example/live" });
    res.end();
  }, async (run) => {
    assert.equal((await run("https://radio.example/live")).result, "bad_redirect");
  });
});

test("401, 403, 429 and other statuses each get their own result (#537)", async () => {
  const statuses = { "/401": 401, "/403": 403, "/429": 429, "/404": 404, "/503": 503 };
  await withServer((req, res) => {
    res.writeHead(statuses[req.url] || 500, { "Content-Type": "text/plain" });
    res.end("nope");
  }, async (run) => {
    const results = {};
    for (const path of Object.keys(statuses)) {
      // eslint-disable-next-line no-await-in-loop -- one URL after the other
      const answer = await run(`https://radio.example${path}`);
      results[path] = [answer.result, answer.httpStatus];
    }
    assert.deepEqual(results, {
      "/401": ["unauthorized", 401],
      "/403": ["forbidden", 403],
      "/429": ["rate_limited", 429],
      "/404": ["http_error", 404],
      "/503": ["http_error", 503],
    });
  });
});

test("a web page, a playlist and HLS are no audio, whatever the Content-Type says (#537)", async () => {
  const bodies = {
    "/page": ["audio/mpeg", HTML_PAGE],
    "/list.m3u": ["audio/x-mpegurl", Buffer.from("#EXTM3U\n#EXTINF:-1,Radio\nhttps://radio.example/live.mp3\n")],
    "/hls.m3u8": ["application/vnd.apple.mpegurl", Buffer.from("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:10\nseg1.aac\n")],
  };
  await withServer((req, res) => {
    const [type, body] = bodies[req.url];
    res.writeHead(200, { "Content-Type": type });
    res.end(body);
  }, async (run) => {
    const page = await run("https://radio.example/page");
    assert.deepEqual([page.ok, page.result, page.format], [false, "not_audio", "html"]);
    const list = await run("https://radio.example/list.m3u");
    assert.deepEqual([list.result, list.format], ["playlist", "playlist"]);
    const hls = await run("https://radio.example/hls.m3u8");
    assert.deepEqual([hls.result, hls.format], ["playlist", "hls"]);
  });
});

test("a server that keeps quiet is a timeout; a refused connection is unreachable (#537)", async () => {
  await withServer((req, res) => {
    // Headers for one, nothing at all for the other.
    if (req.url === "/headers-only") { res.writeHead(200, { "Content-Type": "audio/mpeg" }); res.flushHeaders(); }
  }, async (run) => {
    const startedAt = Date.now();
    assert.equal((await run("https://radio.example/silent", { timeoutMs: 300 })).result, "timeout");
    assert.equal((await run("https://radio.example/headers-only", { timeoutMs: 300 })).result, "timeout");
    assert.ok(Date.now() - startedAt < 3_000, "the time limit holds");
  });

  const refused = await testCustomStationStream("https://radio.example/live", {
    lookupFn: async () => [{ address: PUBLIC_ADDRESS, family: 4 }],
    requestImpl: async () => { throw Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }); },
  });
  assert.deepEqual([refused.result, refused.detail], ["unreachable", "ECONNREFUSED"]);
});

test("the limiter allows a few tests a minute per key and then names the wait (#537)", () => {
  let now = 1_000_000;
  const take = createStreamTestLimiter({ max: 3, windowMs: 60_000, now: () => now });
  for (let index = 0; index < 3; index += 1) assert.equal(take(["user:1", "server:A"]), 0);
  assert.equal(take(["user:1", "server:A"]), 60, "the user is out of tests");
  assert.equal(take(["user:1", "server:B"]), 60, "another server does not help the same user");
  assert.equal(take(["user:2", "server:A"]), 60, "another admin of the same server waits too");
  assert.equal(take(["user:2", "server:B"]), 0);
  now += 30_000;
  assert.equal(take(["user:1", "server:C"]), 30);
  now += 30_001;
  assert.equal(take(["user:1", "server:A"]), 0, "a minute later it works again");
});
