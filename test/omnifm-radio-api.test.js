import test from "node:test";
import assert from "node:assert/strict";

import { getOmnifmRadioConfig } from "../src/services/omnifm-radio-config.js";
import {
  clearOmnifmRadioApiCache,
  fetchOmnifmRadioNowPlaying,
  normalizeAzuracastNowPlaying,
  setOmnifmRadioFetchForTests,
} from "../src/services/omnifm-radio-api.js";

const config = getOmnifmRadioConfig({});

function azuracast({ live = false, streamer = "", start = null, song = {} } = {}) {
  return {
    station: { shortcode: "omnifm_radio" },
    listeners: { total: 4, unique: 3, current: 3 },
    live: { is_live: live, streamer_name: streamer, broadcast_start: start, art: null },
    now_playing: { streamer: "DJ Tabsi", song: { text: "Artist - Song", artist: "Artist", title: "Song", ...song } },
    is_online: true,
  };
}

test.afterEach(() => setOmnifmRadioFetchForTests(null));

test("AzuraCast now playing becomes one OmniFM state, auto DJ and live", () => {
  const autoDj = normalizeAzuracastNowPlaying(azuracast(), { now: 0 });
  assert.equal(autoDj.isLive, false);
  assert.equal(autoDj.streamerName, "", "the last DJ's name in now_playing does not count as live");
  assert.equal(autoDj.songText, "Artist - Song");
  assert.equal(autoDj.listeners, 3);

  const live = normalizeAzuracastNowPlaying(azuracast({ live: true, streamer: "DJ Tabsi", start: 1_764_000_000 }), { now: 0 });
  assert.equal(live.isLive, true);
  assert.equal(live.streamerName, "DJ Tabsi");
  assert.equal(live.liveSince, new Date(1_764_000_000 * 1000).toISOString());
});

test("a broken or missing AzuraCast answer gives ok false, never an exception", async () => {
  clearOmnifmRadioApiCache();
  setOmnifmRadioFetchForTests(async () => new Response("nope", { status: 503 }));
  assert.deepEqual(await fetchOmnifmRadioNowPlaying({ config, force: true }), { ok: false, reason: "http_503" });

  setOmnifmRadioFetchForTests(async () => { const error = new Error("timeout"); error.code = "OUTBOUND_TIMEOUT"; throw error; });
  assert.deepEqual(await fetchOmnifmRadioNowPlaying({ config, force: true }), { ok: false, reason: "OUTBOUND_TIMEOUT" });

  setOmnifmRadioFetchForTests(async () => new Response("{not json", { status: 200 }));
  assert.equal((await fetchOmnifmRadioNowPlaying({ config, force: true })).ok, false);

  assert.deepEqual(
    await fetchOmnifmRadioNowPlaying({ config: getOmnifmRadioConfig({ OMNIFM_RADIO_ENABLED: "0" }) }),
    { ok: false, reason: "disabled" },
  );
});

test("the now playing answer is cached briefly and asked with a time limit", async () => {
  clearOmnifmRadioApiCache();
  const calls = [];
  setOmnifmRadioFetchForTests(async (url, options) => {
    calls.push({ url, options });
    return new Response(JSON.stringify(azuracast({ live: true, streamer: "DJ Tabsi" })), { status: 200 });
  });
  const first = await fetchOmnifmRadioNowPlaying({ config, now: 1_000 });
  const second = await fetchOmnifmRadioNowPlaying({ config, now: 5_000 });
  assert.equal(first.isLive, true);
  assert.equal(second, first);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://radio.omnifm.xyz/api/nowplaying/omnifm_radio");
  assert.equal(calls[0].options.timeoutMs, 5_000);
  await fetchOmnifmRadioNowPlaying({ config, now: 20_000 });
  assert.equal(calls.length, 2, "after the cache time it asks again");
});
