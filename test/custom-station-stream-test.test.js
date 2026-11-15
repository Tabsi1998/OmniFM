import assert from "node:assert/strict";
import { once } from "node:events";
import http from "node:http";
import test from "node:test";

import { createStreamTestLimiter, streamTestBlocklist, testCustomStationStream } from "../src/lib/custom-station-stream-test.js";
import { getRecentLogsSince } from "../src/lib/logging.js";
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

test("ports of services that are no stream are refused on every hop, like a private address (#537 review)", async () => {
  await withServer((req, res) => {
    if (req.url === "/to-redis") {
      res.writeHead(302, { Location: "https://radio.example:6379/" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(mp3Frames(8));
  }, async (run, requests) => {
    for (const url of ["https://radio.example:22/", "http://radio.example:3306/", "http://radio.example:27017/", "http://radio.example:2375/containers/json"]) {
      // eslint-disable-next-line no-await-in-loop -- one URL after the other
      const answer = await run(url);
      assert.deepEqual([answer.result, answer.detail], ["private_target", "STREAM_TEST_PORT_BLOCKED"], url);
    }
    // A port from the setting.
    const configured = await run("https://radio.example:9443/live", { blocklist: streamTestBlocklist({ CUSTOM_STATION_TEST_BLOCKED_PORTS: "9443" }, {}) });
    assert.deepEqual([configured.result, configured.detail], ["private_target", "STREAM_TEST_PORT_BLOCKED"]);
    assert.deepEqual(requests, [], "nothing was asked on a blocked port");

    // The first hop is fine, the redirect goes to Redis: refused before connecting.
    const redirected = await run("https://radio.example/to-redis");
    assert.deepEqual([redirected.result, redirected.detail, redirected.redirects], ["private_target", "STREAM_TEST_PORT_BLOCKED", 1]);
    assert.deepEqual(requests, ["radio.example/to-redis"]);

    // The usual Icecast ports stay allowed, OmniFM's own API port too: the
    // own host is blocked by its addresses, not by port.
    const ownApiPort = { blocklist: streamTestBlocklist({ WEB_INTERNAL_PORT: "8080", WEB_PORT: "8081" }, {}) };
    for (const url of ["http://radio.example:8000/live", "http://radio.example:8080/live", "http://radio.example:8081/live"]) {
      // eslint-disable-next-line no-await-in-loop -- one URL after the other
      assert.equal((await run(url, ownApiPort)).result, "playable", url);
    }
  });
});

test("blocked hosts, IPs, ranges and the machine's own addresses are refused on every hop (#537 review)", async () => {
  const blocklist = streamTestBlocklist(
    { CUSTOM_STATION_TEST_BLOCKED_HOSTS: "Own.example., 45.33.32.0/24, 151.101.1.1, 2a00:1450::/32, not a cidr/99" },
    { eth0: [{ address: "185.199.108.153" }, { address: "fe80::1" }], lo: [{ address: "127.0.0.1" }] },
  );
  await withServer((req, res) => {
    if (req.url === "/to-cdn") {
      res.writeHead(302, { Location: "https://cdn.example/live" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(mp3Frames(8));
  }, async (run, requests) => {
    const check = async (url) => {
      const answer = await run(url, { blocklist });
      return answer.result === "private_target" ? answer.detail : answer.result;
    };
    assert.equal(await check("https://own.example/live"), "STREAM_TEST_HOST_BLOCKED", "the host itself");
    assert.equal(await check("https://api.own.example/live"), "STREAM_TEST_HOST_BLOCKED", "and its subdomains");
    assert.equal(await check("https://ranged.example/live"), "STREAM_TEST_HOST_BLOCKED", "a DNS answer inside the range");
    assert.equal(await check("https://self.example/live"), "STREAM_TEST_HOST_BLOCKED", "the machine's own public address");
    assert.equal(await check("https://v6.example/live"), "STREAM_TEST_HOST_BLOCKED", "an IPv6 range");
    assert.deepEqual(requests, []);
    assert.equal(await check("https://radio.example/to-cdn"), "STREAM_TEST_HOST_BLOCKED", "a redirect to a blocked address");
    assert.deepEqual(requests, ["radio.example/to-cdn"]);
    assert.equal(await check("https://notown.example/live"), "playable", "a name that only ends the same way");
  }, { dns: { "ranged.example": "45.33.32.156", "cdn.example": "151.101.1.1", "self.example": "185.199.108.153", "v6.example": "2a00:1450:4001::1" } });
});

test("the blocked ports and the rate limit come from the settings (#537 review)", () => {
  const defaults = streamTestBlocklist({ WEB_PORT: "8081", WEB_INTERNAL_PORT: "8080", OMNIFM_NODE_API_PORT: "8002" }, {});
  assert.deepEqual([...defaults.ports].sort((a, b) => a - b), [22, 23, 25, 110, 143, 445, 2375, 2376, 3306, 5432, 6379, 9200, 9300, 11211, 27017, 27018], "only the service ports");
  assert.deepEqual([...streamTestBlocklist({ CUSTOM_STATION_TEST_BLOCKED_PORTS: "8000,22" }, {}).ports], [8000, 22], "the setting replaces the list");

  const saved = { max: process.env.CUSTOM_STATION_TEST_RATE_MAX, window: process.env.CUSTOM_STATION_TEST_RATE_WINDOW_MS };
  try {
    process.env.CUSTOM_STATION_TEST_RATE_MAX = "2";
    process.env.CUSTOM_STATION_TEST_RATE_WINDOW_MS = "10000";
    const now = 5_000_000;
    const take = createStreamTestLimiter({ now: () => now });
    assert.deepEqual([take(["user:1"]), take(["user:1"]), take(["user:1"])], [0, 0, 10]);
  } finally {
    for (const [name, value] of [["CUSTOM_STATION_TEST_RATE_MAX", saved.max], ["CUSTOM_STATION_TEST_RATE_WINDOW_MS", saved.window]]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
});

const SERVICE_PORTS = [22, 23, 25, 110, 143, 445, 2375, 2376, 3306, 5432, 6379, 9200, 9300, 11211, 27017, 27018];
const sortedPorts = (blocklist) => [...blocklist.ports].sort((a, b) => a - b);

test("a typo in the blocked ports never opens them: bad entries are skipped with a warning (#537 review)", () => {
  const warnings = [];
  const warn = (message) => warnings.push(message);
  // Commas, spaces or both.
  const mixed = streamTestBlocklist({ CUSTOM_STATION_TEST_BLOCKED_PORTS: "22 3306,  6379 ,x 99999 -1 8o80 0" }, {}, warn);
  assert.deepEqual(sortedPorts(mixed), [22, 3306, 6379]);
  assert.deepEqual(warnings, ["[custom-station-test] CUSTOM_STATION_TEST_BLOCKED_PORTS: ungültige Einträge ignoriert: x, 99999, -1, 8o80, 0"]);

  // Nothing valid left: the default list, not an empty one.
  warnings.length = 0;
  const broken = streamTestBlocklist({ CUSTOM_STATION_TEST_BLOCKED_PORTS: "x; y" }, {}, warn);
  assert.deepEqual(sortedPorts(broken), SERVICE_PORTS);
  assert.equal(warnings.length, 2);
  assert.match(warnings[1], /keinen gültigen Port, es gilt die Standardliste/);

  // Unset or blank: the default, without a warning.
  warnings.length = 0;
  assert.deepEqual(sortedPorts(streamTestBlocklist({ CUSTOM_STATION_TEST_BLOCKED_PORTS: "  " }, {}, warn)), SERVICE_PORTS);
  assert.deepEqual(sortedPorts(streamTestBlocklist({}, {}, warn)), SERVICE_PORTS);
  assert.deepEqual(warnings, []);
});

test("bad blocked hosts are skipped with a warning, the rest still counts (#537 review)", () => {
  const warnings = [];
  const blocklist = streamTestBlocklist(
    { CUSTOM_STATION_TEST_BLOCKED_HOSTS: "Own.example. 203.0.113.10/33, 999.1.1.1 bad_host! 45.33.32.0/24 2a00:1450::/32 fe80::zz 151.101.1.1" },
    {},
    (message) => warnings.push(message),
  );
  assert.deepEqual(blocklist.hosts, ["own.example", "45.33.32.0/24", "2a00:1450::/32", "151.101.1.1"]);
  assert.deepEqual(warnings, ["[custom-station-test] CUSTOM_STATION_TEST_BLOCKED_HOSTS: ungültige Einträge ignoriert: 203.0.113.10/33, 999.1.1.1, bad_host!, fe80::zz"]);
});

test("a settings warning reaches the log once, not with every test (#537 review)", () => {
  const before = getRecentLogsSince(0).at(-1)?.seq || 0;
  const env = { CUSTOM_STATION_TEST_BLOCKED_PORTS: "22 once-only-typo" };
  streamTestBlocklist(env, {});
  streamTestBlocklist(env, {});
  const logged = getRecentLogsSince(before).filter((entry) => entry.message.includes("once-only-typo"));
  assert.deepEqual(logged.map((entry) => [entry.level, entry.source]), [["WARN", "custom-station-test"]]);
});
