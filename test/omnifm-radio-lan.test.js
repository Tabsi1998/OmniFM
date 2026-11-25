import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

import { safeFetch, validateOutboundUrl } from "../src/lib/safe-outbound-http.js";
import { getOmnifmRadioConfig } from "../src/services/omnifm-radio-config.js";
import { isOmnifmRadioUrl } from "../src/services/omnifm-radio-station.js";
import { createOmnifmRadioPoller } from "../src/services/omnifm-radio-live.js";

// #599: the server cannot reach its own public address (no hairpin NAT), so it
// reaches AzuraCast over OMNIFM_RADIO_INTERNAL_URL instead.

function incoming(statusCode = 200, { headers = {}, body = "" } = {}) {
  const response = Readable.from(body === "" ? [] : [Buffer.from(body)]);
  response.statusCode = statusCode;
  response.statusMessage = "OK";
  response.headers = headers;
  return response;
}

function withEnv(patch, fn) {
  const before = Object.fromEntries(Object.keys(patch).map((name) => [name, process.env[name]]));
  for (const [name, value] of Object.entries(patch)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  const restore = () => {
    for (const [name, value] of Object.entries(before)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  };
  return Promise.resolve().then(fn).finally(restore);
}

const INTERNAL = { OMNIFM_RADIO_INTERNAL_URL: "http://192.168.2.253:8080", OMNIFM_RADIO_BASE_URL: undefined };
const noLookup = async () => { throw new Error("the internal address is an IP, no DNS needed"); };

test("a request to the public radio host goes to the internal address, path and query kept", () => withEnv(INTERNAL, async () => {
  const seen = [];
  const response = await safeFetch("https://radio.omnifm.xyz/api/nowplaying/omnifm_radio?x=1", {
    lookupFn: noLookup,
    requestImpl: async (target) => {
      seen.push(target);
      return incoming(200, { body: "{}" });
    },
  });
  assert.equal(response.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].url.toString(), "http://192.168.2.253:8080/api/nowplaying/omnifm_radio?x=1");
  assert.equal(seen[0].address, "192.168.2.253");
}));

test("the stream of OmniFM Radio is fetched over the internal address too, also after a redirect back to the public host", () => withEnv(INTERNAL, async () => {
  const urls = [];
  const response = await safeFetch("https://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3", {
    lookupFn: noLookup,
    lenientHttpParser: true,
    requestImpl: async (target) => {
      urls.push(target.url.toString());
      if (urls.length === 1) return incoming(302, { headers: { location: "https://radio.omnifm.xyz/listen/omnifm_radio/radio.aac" } });
      return incoming(200, { body: "audio" });
    },
  });
  assert.equal(response.status, 200);
  assert.deepEqual(urls, [
    "http://192.168.2.253:8080/listen/omnifm_radio/radio.mp3",
    "http://192.168.2.253:8080/listen/omnifm_radio/radio.aac",
  ]);
}));

test("naming the internal address directly stays refused: custom stations, webhooks, anything else", () => withEnv(INTERNAL, async () => {
  assert.equal(validateOutboundUrl("http://192.168.2.253:8080/listen/omnifm_radio/radio.mp3").ok, false);
  await assert.rejects(
    safeFetch("http://192.168.2.253:8080/api/nowplaying/omnifm_radio", { requestImpl: async () => incoming(200) }),
    (error) => error.code === "OUTBOUND_ADDRESS_NOT_ALLOWED",
  );
  await assert.rejects(
    safeFetch("http://192.168.2.253:9000/", { requestImpl: async () => incoming(200) }),
    (error) => error.code === "OUTBOUND_ADDRESS_NOT_ALLOWED",
  );
  // A redirect from the internal AzuraCast to another private address is refused as well.
  await assert.rejects(
    safeFetch("https://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3", {
      lookupFn: noLookup,
      requestImpl: async () => incoming(302, { headers: { location: "http://192.168.2.1/admin" } }),
    }),
    (error) => error.code === "OUTBOUND_ADDRESS_NOT_ALLOWED",
  );
  assert.equal(isOmnifmRadioUrl("http://192.168.2.253:8080/listen/omnifm_radio/radio.mp3", getOmnifmRadioConfig()), true, "a custom station on the internal address is OmniFM Radio, so it is refused");
}));

test("without OMNIFM_RADIO_INTERNAL_URL nothing changes: the public host is asked as before", () => withEnv({ OMNIFM_RADIO_INTERNAL_URL: undefined }, async () => {
  const seen = [];
  await safeFetch("https://radio.omnifm.xyz/api/nowplaying/omnifm_radio", {
    lookupFn: async () => [{ address: "87.247.213.69", family: 4 }],
    requestImpl: async (target) => {
      seen.push(target);
      return incoming(200, { body: "{}" });
    },
  });
  assert.equal(seen[0].url.toString(), "https://radio.omnifm.xyz/api/nowplaying/omnifm_radio");
  assert.equal(seen[0].address, "87.247.213.69");
  assert.equal(getOmnifmRadioConfig({}).internalUrl, "");
  assert.equal(getOmnifmRadioConfig({ OMNIFM_RADIO_INTERNAL_URL: "http://192.168.2.253:8080/egal" }).internalUrl, "http://192.168.2.253:8080");
  assert.equal(getOmnifmRadioConfig({ OMNIFM_RADIO_INTERNAL_URL: "ftp://x" }).internalUrl, "");
}));

test("other hosts are never rerouted, even with the internal address set", () => withEnv(INTERNAL, async () => {
  const seen = [];
  await safeFetch("https://stream.laut.fm/drill", {
    lookupFn: async () => [{ address: "1.1.1.1", family: 4 }],
    requestImpl: async (target) => {
      seen.push(target);
      return incoming(200);
    },
  });
  assert.equal(seen[0].url.toString(), "https://stream.laut.fm/drill");
}));

test("the poller says since when AzuraCast does not answer and when it works again", async () => {
  const observed = [];
  const tracker = { observe: async (observation) => { observed.push(observation); }, tick: async () => {} };
  let answer = { ok: false, reason: "OUTBOUND_TIMEOUT" };
  let clock = 1_000;
  const poller = createOmnifmRadioPoller({
    tracker,
    fetchNowPlaying: async () => answer,
    intervalMs: 30_000,
    now: () => clock,
    setIntervalFn: () => null,
    clearIntervalFn: () => {},
  });
  await poller.pollOnce();
  clock = 31_000;
  await poller.pollOnce();
  let status = poller.status();
  assert.equal(status.lastError, "OUTBOUND_TIMEOUT");
  assert.equal(status.failingSince, new Date(1_000).toISOString(), "since the first failure, not the last");
  assert.equal(status.lastOkAt, null);
  assert.equal(observed.length, 0, "a failed poll never changes the live state");

  answer = { ok: true, isLive: true, streamerName: "DJ Tabsi", songText: "", liveSince: null };
  clock = 61_000;
  await poller.pollOnce();
  status = poller.status();
  assert.equal(status.lastError, null);
  assert.equal(status.failingSince, null);
  assert.equal(status.lastOkAt, new Date(61_000).toISOString());
  assert.equal(observed.length, 1);
});
