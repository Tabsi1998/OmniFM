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

test("only the bot's own radio paths are rerouted, by GET, with the same scheme and port and no credentials", () => withEnv(INTERNAL, async () => {
  const route = async (url, options = {}) => {
    const seen = [];
    await safeFetch(url, {
      lookupFn: async () => [{ address: "87.247.213.69", family: 4 }],
      requestImpl: async (target) => {
        seen.push(target.url.toString());
        return incoming(200);
      },
      ...options,
    }).catch((error) => seen.push(`error:${error.code}`));
    return seen[0];
  };
  assert.equal(await route("https://radio.omnifm.xyz/api/admin/settings"), "https://radio.omnifm.xyz/api/admin/settings", "other AzuraCast paths stay public");
  assert.equal(await route("https://radio.omnifm.xyz/api/nowplaying/other_station"), "https://radio.omnifm.xyz/api/nowplaying/other_station");
  assert.equal(await route("https://radio.omnifm.xyz/listen/omnifm_radio/../../api/admin"), "https://radio.omnifm.xyz/api/admin", "dot segments are resolved before the path check");
  assert.equal(await route("https://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3", { method: "POST" }), "https://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3", "a POST (webhook) is never rerouted");
  assert.equal(await route("https://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3", { requireHttps: true }), "https://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3", "callers that need https stay on https");
  assert.equal(await route("http://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3"), "http://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3", "another scheme is not the configured host");
  assert.equal(await route("https://radio.omnifm.xyz:8443/listen/omnifm_radio/radio.mp3"), "https://radio.omnifm.xyz:8443/listen/omnifm_radio/radio.mp3", "another port is not the configured host");
  assert.equal(await route("https://u:p@radio.omnifm.xyz/listen/omnifm_radio/radio.mp3"), "error:OUTBOUND_CREDENTIALS_NOT_ALLOWED");
  assert.equal(await route("https://radio.omnifm.xyz.evil.example/listen/omnifm_radio/radio.mp3"), "https://radio.omnifm.xyz.evil.example/listen/omnifm_radio/radio.mp3");
}));

test("a path like //other.host or a backslash never turns into another host", () => withEnv(INTERNAL, async () => {
  const urls = [
    "https://radio.omnifm.xyz//evil.example/x",
    "https://radio.omnifm.xyz/\\evil.example/x",
    "https://radio.omnifm.xyz/listen/omnifm_radio//evil.example/x",
  ];
  for (const url of urls) {
    const seen = [];
    // eslint-disable-next-line no-await-in-loop -- one address after the other
    await safeFetch(url, {
      lookupFn: async () => [{ address: "87.247.213.69", family: 4 }],
      requestImpl: async (target) => {
        seen.push(target);
        return incoming(200);
      },
    });
    const host = seen[0].url.hostname;
    assert.ok(host === "radio.omnifm.xyz" || host === "192.168.2.253", `${url} went to ${host}`);
  }
}));

test("OMNIFM_RADIO_ENABLED=0 turns the rerouting off", () => withEnv({ ...INTERNAL, OMNIFM_RADIO_ENABLED: "0" }, async () => {
  const seen = [];
  await safeFetch("https://radio.omnifm.xyz/api/nowplaying/omnifm_radio", {
    lookupFn: async () => [{ address: "87.247.213.69", family: 4 }],
    requestImpl: async (target) => {
      seen.push(target.url.toString());
      return incoming(200);
    },
  });
  assert.deepEqual(seen, ["https://radio.omnifm.xyz/api/nowplaying/omnifm_radio"]);
}));

test("a relative redirect of the internal AzuraCast counts from the public address and is rerouted again", () => withEnv(INTERNAL, async () => {
  const urls = [];
  await safeFetch("https://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3", {
    lookupFn: noLookup,
    requestImpl: async (target) => {
      urls.push(target.url.toString());
      return urls.length === 1 ? incoming(302, { headers: { location: "/listen/omnifm_radio/radio.aac" } }) : incoming(200);
    },
  });
  assert.deepEqual(urls, [
    "http://192.168.2.253:8080/listen/omnifm_radio/radio.mp3",
    "http://192.168.2.253:8080/listen/omnifm_radio/radio.aac",
  ]);
}));

test("a foreign host cannot redirect straight to the internal address", () => withEnv(INTERNAL, async () => {
  await assert.rejects(
    safeFetch("https://stream.example.org/live", {
      lookupFn: async () => [{ address: "1.1.1.1", family: 4 }],
      requestImpl: async () => incoming(302, { headers: { location: "http://192.168.2.253:8080/api/nowplaying/omnifm_radio" } }),
    }),
    (error) => error.code === "OUTBOUND_ADDRESS_NOT_ALLOWED",
  );
}));

test("the internal address takes no credentials, so config and safeFetch agree", () => {
  assert.equal(getOmnifmRadioConfig({ OMNIFM_RADIO_INTERNAL_URL: "http://u:p@192.168.2.253:8080" }).internalUrl, "");
});

test("behind /listen/<station>/ only one plain file name is rerouted, nothing encoded, no deeper path", () => withEnv(INTERNAL, async () => {
  const hostOf = async (url) => {
    const seen = [];
    await safeFetch(url, {
      lookupFn: async () => [{ address: "87.247.213.69", family: 4 }],
      requestImpl: async (target) => {
        seen.push(target.url.hostname);
        return incoming(200);
      },
    });
    return seen[0];
  };
  assert.equal(await hostOf("https://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3"), "192.168.2.253");
  assert.equal(await hostOf("https://radio.omnifm.xyz/listen/omnifm_radio/radio_192.aac"), "192.168.2.253");
  for (const url of [
    "https://radio.omnifm.xyz/listen/omnifm_radio/..%2F..%2Fapi%2Fadmin",
    "https://radio.omnifm.xyz/listen/omnifm_radio/x%2F..%2F..%2Fradio%2F8000%2Fadmin%2F",
    "https://radio.omnifm.xyz/listen/omnifm_radio/..%5Cadmin",
    "https://radio.omnifm.xyz/listen/omnifm_radio/admin/stats",
    "https://radio.omnifm.xyz/listen/omnifm_radio/",
    "https://radio.omnifm.xyz/api/nowplaying/omnifm_radio/",
  ]) {
    // eslint-disable-next-line no-await-in-loop -- one address after the other
    assert.equal(await hostOf(url), "radio.omnifm.xyz", `${url} stays public`);
  }
}));

test("a base URL with a path prefix keeps the now-playing poll on the internal address", () => withEnv({
  ...INTERNAL,
  OMNIFM_RADIO_BASE_URL: "https://radio.omnifm.xyz/azura",
}, async () => {
  const seen = [];
  await safeFetch("https://radio.omnifm.xyz/azura/api/nowplaying/omnifm_radio", {
    lookupFn: noLookup,
    requestImpl: async (target) => {
      seen.push(target.url.toString());
      return incoming(200, { body: "{}" });
    },
  });
  assert.deepEqual(seen, ["http://192.168.2.253:8080/azura/api/nowplaying/omnifm_radio"]);
}));

test("a caller that allows only https is never rerouted to the http internal address", () => withEnv(INTERNAL, async () => {
  const seen = [];
  await safeFetch("https://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3", {
    allowedProtocols: ["https:"],
    lookupFn: async () => [{ address: "87.247.213.69", family: 4 }],
    requestImpl: async (target) => {
      seen.push(target.url.toString());
      return incoming(200);
    },
  });
  assert.deepEqual(seen, ["https://radio.omnifm.xyz/listen/omnifm_radio/radio.mp3"]);
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
