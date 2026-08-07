import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import {
  isPublicOutboundAddress,
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
