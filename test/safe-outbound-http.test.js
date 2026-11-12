import assert from "node:assert/strict";
import net from "node:net";
import { Readable } from "node:stream";
import test from "node:test";

import {
  isPublicOutboundAddress,
  requestPinnedTarget,
  safeFetch,
  validateOutboundUrl,
  validateOutboundUrlWithDns,
} from "../src/lib/safe-outbound-http.js";

function createIncomingResponse(statusCode = 200, { headers = {}, body = "", statusMessage = "OK" } = {}) {
  const incoming = Readable.from(body === "" ? [] : [Buffer.from(body)]);
  incoming.statusCode = statusCode;
  incoming.statusMessage = statusMessage;
  incoming.headers = headers;
  return incoming;
}

test("outbound URL policy rejects private, local, and credential-bearing targets", () => {
  for (const url of [
    "http://127.0.0.1/admin",
    "http://10.0.0.1/",
    "http://169.254.169.254/latest/meta-data",
    "http://0.0.0.0/",
    "http://[::1]/",
    "http://[fe80::1]/",
    "http://[fd00::1]/",
    "http://[::ffff:127.0.0.1]/",
    "http://2130706433/",
    "http://0x7f000001/",
    "http://0177.0.0.1/",
    "http://localhost/",
    "https://metadata.google.internal/",
    "https://user:secret@radio.example/live",
  ]) {
    assert.equal(validateOutboundUrl(url).ok, false, url);
  }

  assert.equal(validateOutboundUrl("https://1.1.1.1/live").ok, true);
  assert.equal(isPublicOutboundAddress("1.1.1.1"), true);
  assert.equal(isPublicOutboundAddress("127.0.0.1"), false);
  assert.equal(isPublicOutboundAddress("::ffff:127.0.0.1"), false);
});

test("outbound DNS validation rejects mixed public and private answers", async () => {
  const result = await validateOutboundUrlWithDns("https://radio.example/live", {
    retryCount: 1,
    lookupFn: async () => [
      { address: "1.1.1.1", family: 4 },
      { address: "127.0.0.1", family: 4 },
    ],
  });

  assert.deepEqual(result, {
    ok: false,
    error: "Lokale/private Hosts sind nicht erlaubt.",
  });
});

test("safe fetch pins a freshly validated address for the request", async () => {
  let lookupCalls = 0;
  let receivedTarget = null;
  let receivedRequest = null;

  const response = await safeFetch("https://radio.example/live", {
    lookupFn: async () => {
      lookupCalls += 1;
      return [{ address: "1.1.1.1", family: 4 }];
    },
    requestImpl: async (target, request) => {
      receivedTarget = target;
      receivedRequest = request;
      return createIncomingResponse(200, { body: "pinned-stream" });
    },
  });

  assert.equal(lookupCalls, 1);
  assert.equal(receivedTarget.address, "1.1.1.1");
  assert.equal(receivedTarget.family, 4);
  assert.equal(receivedRequest.method, "GET");
  assert.equal(response.status, 200);
  assert.equal(await response.text(), "pinned-stream");
});

test("safe fetch revalidates every redirect and blocks a private redirect before connecting", async () => {
  let requestCalls = 0;

  await assert.rejects(
    () => safeFetch("https://radio.example/start", {
      maxRedirects: 0,
      lookupFn: async () => [{ address: "1.1.1.1", family: 4 }],
      requestImpl: async () => {
        requestCalls += 1;
        return createIncomingResponse(302, {
          headers: { location: "http://127.0.0.1/internal" },
          statusMessage: "Found",
        });
      },
    }),
    (error) => error?.code === "OUTBOUND_REDIRECT_NOT_ALLOWED"
  );
  assert.equal(requestCalls, 1);

  requestCalls = 0;
  await assert.rejects(
    () => safeFetch("https://radio.example/start", {
      lookupFn: async () => [{ address: "1.1.1.1", family: 4 }],
      requestImpl: async () => {
        requestCalls += 1;
        return createIncomingResponse(302, {
          headers: { location: "http://127.0.0.1/internal" },
          statusMessage: "Found",
        });
      },
    }),
    (error) => error?.code === "OUTBOUND_ADDRESS_NOT_ALLOWED"
  );
  assert.equal(requestCalls, 1);
});

test("safe fetch removes credential headers when a redirect changes origin", async () => {
  const requests = [];

  const response = await safeFetch("https://radio.example/start", {
    headers: {
      Authorization: "Bearer secret",
      Cookie: "session=secret",
      Host: "radio.example",
      "User-Agent": "OmniFM test",
    },
    lookupFn: async () => [{ address: "1.1.1.1", family: 4 }],
    requestImpl: async (target, request) => {
      requests.push({ url: target.url.toString(), headers: request.headers });
      if (requests.length === 1) {
        return createIncomingResponse(302, {
          headers: { location: "https://cdn.example/live" },
          statusMessage: "Found",
        });
      }
      return createIncomingResponse(200, { body: "safe-stream" });
    },
  });

  assert.equal(await response.text(), "safe-stream");
  assert.equal(requests.length, 2);
  assert.equal(requests[0].headers.Authorization, "Bearer secret");
  assert.equal(requests[0].headers.Cookie, "session=secret");
  assert.equal(requests[1].headers.Authorization, undefined);
  assert.equal(requests[1].headers.Cookie, undefined);
  assert.equal(requests[1].headers.Host, undefined);
  assert.equal(requests[1].headers["User-Agent"], "OmniFM test");
});

test("safe fetch does not expose low-level transport details", async () => {
  await assert.rejects(
    () => safeFetch("https://radio.example/live", {
      lookupFn: async () => [{ address: "1.1.1.1", family: 4 }],
      requestImpl: async () => {
        throw new Error("connect ECONNREFUSED 127.0.0.1:2375");
      },
    }),
    (error) => error?.code === "OUTBOUND_REQUEST_FAILED"
      && error?.message === "Ziel-URL konnte nicht erreicht werden."
      && !error.message.includes("127.0.0.1")
  );
});

// StreamABC (Life Radio Tirol, SUNSHINE LIVE) ends its status line with a bare
// LF and every header line with CRLF, captured byte for byte on 11.11.2026 (#536).
async function withBareLfRadioServer(run) {
  const server = net.createServer((socket) => {
    socket.once("data", () => {
      socket.end("HTTP/1.1 200 OK\nContent-Type: audio/mpeg\r\nContent-Length: 4\r\n\r\n\xff\xfb\xb0\x64", "latin1");
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = /** @type {import("node:net").AddressInfo} */ (server.address());
  const target = { url: new URL(`http://127.0.0.1:${port}/live`), hostname: "127.0.0.1", address: "127.0.0.1", family: 4 };
  try {
    return await run(target);
  } finally {
    server.close();
  }
}

test("a radio server with a bare-LF status line plays with the lenient parser only (#536)", async () => {
  await withBareLfRadioServer(async (target) => {
    await assert.rejects(() => requestPinnedTarget(target), (error) => error?.code === "OUTBOUND_REQUEST_FAILED");

    const incoming = await requestPinnedTarget(target, { lenientHttpParser: true });
    const chunks = [];
    for await (const chunk of incoming) chunks.push(chunk);
    assert.equal(incoming.statusCode, 200);
    assert.equal(incoming.headers["content-type"], "audio/mpeg");
    assert.equal(Buffer.concat(chunks).toString("hex"), "fffbb064");
  });
});

test("a station that redirects to a bare-LF StreamABC target plays, and each restart starts at the station URL (#536)", async () => {
  await withBareLfRadioServer(async (radio) => {
    const firstHops = [];
    let signature = 0;
    const fetchStation = (options) => safeFetch("https://stream.liferadio.example/live/mp3-192/link", {
      ...options,
      lookupFn: async () => [{ address: "1.1.1.1", family: 4 }],
      requestImpl: async (target, request) => {
        if (target.hostname === "stream.liferadio.example") {
          firstHops.push(target.url.toString());
          signature += 1;
          return createIncomingResponse(302, {
            headers: { location: `https://liferadio.streamabc.example/43-mp3-192?sABC=sig${signature}` },
            statusMessage: "Found",
          });
        }
        // The signed StreamABC target, answered by a real socket with its bare-LF status line.
        return requestPinnedTarget(radio, request);
      },
    });

    await assert.rejects(() => fetchStation({}), (error) => error?.code === "OUTBOUND_REQUEST_FAILED");
    const response = await fetchStation({ lenientHttpParser: true });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "audio/mpeg");
    assert.equal(Buffer.from(await response.arrayBuffer()).toString("hex"), "fffbb064");
    // Never the signed target from before: every start asks the station URL again.
    assert.deepEqual(firstHops, [
      "https://stream.liferadio.example/live/mp3-192/link",
      "https://stream.liferadio.example/live/mp3-192/link",
    ]);
  });
});

test("safe fetch hands the lenient parser to every redirect hop and keeps it off by default (#536)", async () => {
  const run = async (options) => {
    const seen = [];
    await safeFetch("https://stream.radio.example/live", {
      ...options,
      lookupFn: async () => [{ address: "1.1.1.1", family: 4 }],
      requestImpl: async (_target, request) => {
        seen.push(request.lenientHttpParser);
        return seen.length === 1
          ? createIncomingResponse(302, { headers: { location: "https://radio.streamabc.example/live?sABC=x" }, statusMessage: "Found" })
          : createIncomingResponse(200, { body: "audio" });
      },
    });
    return seen;
  };

  assert.deepEqual(await run({ lenientHttpParser: true }), [true, true]);
  assert.deepEqual(await run({}), [false, false]);
});
