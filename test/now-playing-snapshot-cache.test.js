import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-now-playing-cache-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");
process.env.NOW_PLAYING_RECOGNITION_ENABLED = "0";
process.env.NOW_PLAYING_SNAPSHOT_CACHE_MS = "30000";
process.env.NOW_PLAYING_SNAPSHOT_ERROR_CACHE_MS = "5000";

const nowPlaying = await import("../src/services/now-playing.js");
const {
  fetchStreamSnapshot,
  fetchStreamInfo,
  setNowPlayingFetchImplementationForTests,
  clearNowPlayingSnapshotCache,
  getNowPlayingSnapshotCacheStats,
} = nowPlaying;

const METAINT = 16;

function buildIcyBody(streamTitle) {
  const audio = Buffer.alloc(METAINT, 1);
  const metadataText = `StreamTitle='${streamTitle}';`;
  const blocks = Math.ceil(metadataText.length / 16);
  const metadata = Buffer.alloc(blocks * 16, 0);
  metadata.write(metadataText, "utf8");
  const bytes = Buffer.concat([audio, Buffer.from([blocks]), metadata, Buffer.alloc(METAINT, 1)]);
  return new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(bytes));
      controller.close();
    },
  });
}

function createFakeFetcher({ streamTitle = "Artist - Song", fail = false } = {}) {
  const calls = [];
  const fetcher = async (url) => {
    calls.push(url);
    if (fail) throw new Error("connect ECONNREFUSED");
    const headers = new Map([
      ["icy-name", "Test Radio"],
      ["icy-description", "Testing"],
      ["icy-metaint", String(METAINT)],
    ]);
    return {
      ok: true,
      status: 200,
      headers: { get: (name) => headers.get(String(name).toLowerCase()) ?? null },
      body: buildIcyBody(streamTitle),
    };
  };
  return { fetcher, calls };
}

test("guilds on the same station share one metadata request per cache window", async () => {
  clearNowPlayingSnapshotCache();
  const { fetcher, calls } = createFakeFetcher();
  setNowPlayingFetchImplementationForTests(fetcher);
  try {
    const url = "https://radio.example.test/stream";
    const first = await fetchStreamSnapshot(url);
    assert.equal(first.displayTitle, "Artist - Song");
    assert.equal(first.artist, "Artist");
    assert.equal(first.title, "Song");
    assert.equal(first.name, "Test Radio");
    assert.equal(first.metadataSource, "icy");

    const second = await fetchStreamSnapshot(url, { includeCover: false });
    const info = await fetchStreamInfo(url);
    assert.equal(second.displayTitle, "Artist - Song");
    assert.equal(info.displayTitle, "Artist - Song");
    assert.equal(calls.length, 1, "three callers, one provider connection");

    // Callers get copies: mutating one result never leaks into the cache.
    second.displayTitle = "mutated";
    const third = await fetchStreamSnapshot(url);
    assert.equal(third.displayTitle, "Artist - Song");
    assert.equal(calls.length, 1);

    const other = await fetchStreamSnapshot("https://other.example.test/stream");
    assert.equal(other.displayTitle, "Artist - Song");
    assert.equal(calls.length, 2, "a different station is a different request");
    assert.equal(getNowPlayingSnapshotCacheStats().cached, 2);

    const fresh = await fetchStreamSnapshot(url, { maxAgeMs: 0 });
    assert.equal(fresh.displayTitle, "Artist - Song");
    assert.equal(calls.length, 3, "maxAgeMs: 0 forces a new request");
  } finally {
    setNowPlayingFetchImplementationForTests(null);
    clearNowPlayingSnapshotCache();
  }
});

test("concurrent requests for one station are deduplicated while the fetch is in flight", async () => {
  clearNowPlayingSnapshotCache();
  const { fetcher, calls } = createFakeFetcher({ streamTitle: "DJ - Live Set" });
  setNowPlayingFetchImplementationForTests(fetcher);
  try {
    const url = "https://radio.example.test/live";
    const results = await Promise.all([
      fetchStreamSnapshot(url),
      fetchStreamSnapshot(url),
      fetchStreamSnapshot(url),
    ]);
    assert.equal(calls.length, 1);
    for (const result of results) {
      assert.equal(result.displayTitle, "DJ - Live Set");
    }
    assert.equal(getNowPlayingSnapshotCacheStats().inFlight, 0);
  } finally {
    setNowPlayingFetchImplementationForTests(null);
    clearNowPlayingSnapshotCache();
  }
});

test("a failed provider answer is cached briefly and never mutates into a track", async () => {
  clearNowPlayingSnapshotCache();
  const { fetcher, calls } = createFakeFetcher({ fail: true });
  setNowPlayingFetchImplementationForTests(fetcher);
  try {
    const url = "https://down.example.test/stream";
    const first = await fetchStreamSnapshot(url);
    assert.equal(first.metadataStatus, "unavailable");
    assert.equal(first.displayTitle, null);
    const second = await fetchStreamSnapshot(url);
    assert.equal(second.metadataStatus, "unavailable");
    assert.equal(calls.length, 1, "the failure is not retried within the error window");
  } finally {
    setNowPlayingFetchImplementationForTests(null);
    clearNowPlayingSnapshotCache();
  }
});
