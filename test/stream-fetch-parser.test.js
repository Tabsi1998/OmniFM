import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

// Every place that opens a radio stream must ask for the lenient HTTP parser,
// or StreamABC stations (bare-LF status line) fail there again (#536). The
// count of followed redirects in these files has to match the opt-ins; a new
// stream fetch without it fails here. Images, webhooks and APIs stay strict
// and are not listed.
const STREAM_FETCHERS = [
  "src/services/stream.js",
  "src/services/now-playing.js",
  "src/services/station-health.js",
  "src/services/audio-recognition.js",
  "src/bot/runtime-failback.js",
  "src/lib/owner-station-test.js",
  "src/lib/owner-stations.js",
];

test("every radio stream fetch asks for the lenient HTTP parser (#536)", () => {
  for (const file of STREAM_FETCHERS) {
    const source = fs.readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
    const fetches = (source.match(/redirect: "follow",/g) || []).length;
    const lenient = (source.match(/lenientHttpParser: true,/g) || []).length;
    assert.ok(fetches > 0, `${file}: no stream fetch found, update this list`);
    assert.equal(lenient, fetches, `${file}: ${fetches} stream fetches, ${lenient} with lenientHttpParser`);
  }
});
