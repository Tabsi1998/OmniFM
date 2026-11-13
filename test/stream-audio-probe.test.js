import assert from "node:assert/strict";
import { once } from "node:events";
import test from "node:test";

import { detectAudioFormat, probeStreamAudio, stationOutageText, stationRecoveryText } from "../src/lib/stream-audio-probe.js";
import { HTML_PAGE, aacFrames, mp3Frames, mpegFrames, withIcyMetadata, withStreamServer } from "./support/stream-probe-server.mjs";

// #538: one small GET probe decides whether a station sends audio. The
// answer keeps "the server answers", "we are let in" and "this plays in
// Discord" apart, and it looks at the bytes, not at the Content-Type.

const URL_UNDER_TEST = "http://radio.test/live";
const activeTimers = () => process.getActiveResourcesInfo().filter((name) => name === "Timeout").length;

test("MP3 bytes from a 200 answer are playable audio", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg", "icy-name": "Lounge FM", "icy-br": "128" });
    res.end(mp3Frames());
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl });
    assert.deepEqual(
      [probe.httpStatus, probe.reachable, probe.authorized, probe.playableAudio, probe.format, probe.reasonCode, probe.error],
      [200, true, true, true, "mp3", "ok", null],
    );
    assert.deepEqual([probe.icyName, probe.bitrate, probe.contentType], ["Lounge FM", "128", "audio/mpeg"]);
  });
});

test("a page that answers HEAD with 200 but GET with HTML is not playable, and HEAD is never asked", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(req.method === "HEAD" ? undefined : HTML_PAGE);
  }, async (fetchImpl, state) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl });
    assert.deepEqual(
      [probe.httpStatus, probe.reachable, probe.authorized, probe.playableAudio, probe.format, probe.reasonCode],
      [200, true, true, false, "html", "not_audio"],
    );
    assert.match(probe.error, /Kein Audio/);
    assert.deepEqual(state.requests.map((request) => request.method), ["GET"]);
  });
});

test("401 means the server answers, but nothing is playable", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(401, { "WWW-Authenticate": "Basic" });
    res.end("login");
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl });
    assert.deepEqual(
      [probe.httpStatus, probe.reachable, probe.authorized, probe.playableAudio, probe.reasonCode],
      [401, true, false, false, "unauthorized"],
    );
    assert.match(probe.error, /HTTP 401/);
  });
});

test("404 is neither reachable nor playable", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(404);
    res.end("gone");
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl });
    assert.deepEqual(
      [probe.httpStatus, probe.reachable, probe.playableAudio, probe.reasonCode, probe.error],
      [404, false, false, "http_error", "HTTP 404"],
    );
  });
});

test("206 with audio is playable", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(206, { "Content-Type": "audio/aac", "Content-Range": "bytes 0-799/*" });
    res.end(aacFrames());
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl });
    assert.deepEqual([probe.httpStatus, probe.playableAudio, probe.format], [206, true, "aac"]);
  });
});

test("a redirect to audio is followed", async () => {
  await withStreamServer((req, res) => {
    if (req.url === "/live") {
      res.writeHead(302, { Location: "/real.mp3" });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(mp3Frames());
  }, async (fetchImpl, state) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl });
    assert.deepEqual([probe.httpStatus, probe.playableAudio, probe.format], [200, true, "mp3"]);
    assert.deepEqual(state.requests.map((request) => request.url), ["/live", "/real.mp3"]);
  });
});

test("403 means the server answers, but refuses us", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(403);
    res.end("forbidden");
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl });
    assert.deepEqual(
      [probe.httpStatus, probe.reachable, probe.authorized, probe.playableAudio, probe.reasonCode, probe.error],
      [403, true, false, false, "unauthorized", "HTTP 403 (Zugriff verweigert)"],
    );
  });
});

test("MP3 bytes under a wrong Content-Type are playable", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(mp3Frames());
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl });
    assert.deepEqual([probe.playableAudio, probe.format], [true, "mp3"]);
  });
});

test("an HTML body under audio/mpeg is not playable", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(HTML_PAGE);
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl });
    assert.deepEqual([probe.reachable, probe.playableAudio, probe.format, probe.reasonCode], [true, false, "html", "not_audio"]);
  });
});

test("an endless stream is cut off after the byte limit and the connection is closed", async () => {
  const before = activeTimers();
  let closed = null;
  let sent = 0;
  await withStreamServer((req, res) => {
    closed = once(res, "close");
    res.writeHead(200, { "Content-Type": "application/octet-stream" });
    // Bytes no signature matches, so the probe has to stop at its limit.
    const chunk = Buffer.alloc(4096, 0x01);
    const timer = setInterval(() => { sent += chunk.length; res.write(chunk); }, 2);
    res.once("close", () => clearInterval(timer));
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl, maxBytes: 16 * 1024, timeoutMs: 5000 });
    assert.equal(probe.playableAudio, false);
    assert.equal(probe.reasonCode, "unknown_format");
    assert.equal(probe.bytesRead, 16 * 1024);
    await closed;
    assert.ok(sent < 1024 * 1024, `the server kept sending: ${sent} bytes`);
    assert.equal(activeTimers(), before, "no timer left behind");
  });
});

test("audio is recognised as soon as it is there, without reading up to the limit", async () => {
  let closed = null;
  await withStreamServer((req, res) => {
    closed = once(res, "close");
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    const timer = setInterval(() => res.write(mp3Frames(2)), 2);
    res.once("close", () => clearInterval(timer));
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl, maxBytes: 64 * 1024 });
    assert.equal(probe.playableAudio, true);
    assert.ok(probe.bytesRead < 64 * 1024, `read ${probe.bytesRead} bytes`);
    await closed;
  });
});

test("a server that sends headers and then nothing times out and is closed", async () => {
  const before = activeTimers();
  let closed = null;
  await withStreamServer((req, res) => {
    closed = once(res, "close");
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.flushHeaders();
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl, timeoutMs: 300 });
    assert.deepEqual(
      [probe.httpStatus, probe.reachable, probe.playableAudio, probe.reasonCode, probe.timedOut, probe.bytesRead],
      [200, true, false, "no_data", true, 0],
    );
    assert.equal(probe.error, "Keine Audiodaten erhalten (nach 300 ms)");
    await closed;
    assert.equal(activeTimers(), before, "no timer left behind");
  });
});

test("a server that never answers is a timeout, not reachable", async () => {
  await withStreamServer(() => {}, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl, timeoutMs: 300 });
    assert.deepEqual(
      [probe.httpStatus, probe.reachable, probe.authorized, probe.playableAudio, probe.reasonCode, probe.timedOut],
      [null, false, null, false, "timeout", true],
    );
    assert.equal(probe.error, "Timeout nach 300 ms");
  });
});

test("a failed request is a network error", async () => {
  const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl: async () => { throw new Error("network down"); } });
  assert.deepEqual(
    [probe.httpStatus, probe.reachable, probe.playableAudio, probe.reasonCode, probe.timedOut, probe.error],
    [null, false, false, "network_error", false, "network down"],
  );
});

test("the stream fetch asks for the lenient parser and follows redirects (#536)", async () => {
  let seen = null;
  await probeStreamAudio(URL_UNDER_TEST, {
    userAgent: "OmniFM-Test/1.0",
    fetchImpl: async (url, options) => { seen = options; return new Response(mp3Frames()); },
  });
  assert.deepEqual(
    [seen.method, seen.redirect, seen.lenientHttpParser, seen.headers["User-Agent"]],
    ["GET", "follow", true, "OmniFM-Test/1.0"],
  );
});

test("signatures: MP3, AAC, Ogg, FLAC", () => {
  const format = (bytes) => detectAudioFormat(bytes, { final: true }).format;
  assert.equal(format(mp3Frames(2)), "mp3");
  assert.equal(format(aacFrames(2)), "aac");
  // A live stream starts in the middle of a frame.
  assert.equal(format(Buffer.concat([Buffer.alloc(123, 0x3c), mp3Frames(3)])), "mp3");
  // An ID3 tag in front is skipped.
  const id3 = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 4, 0, 0, 0, 0, 0, 20]), Buffer.alloc(20), mp3Frames(2)]);
  assert.equal(format(id3), "mp3");
  assert.equal(format(Buffer.concat([Buffer.from("OggS"), Buffer.alloc(24), Buffer.from("OpusHead"), Buffer.alloc(40)])), "opus");
  assert.equal(format(Buffer.concat([Buffer.from("OggS"), Buffer.alloc(24), Buffer.from("\x01vorbis"), Buffer.alloc(40)])), "vorbis");
  assert.equal(format(Buffer.concat([Buffer.from("fLaC"), Buffer.alloc(60)])), "flac");
});

test("signatures: the other MPEG audio kinds, and padded frames", () => {
  const format = (bytes) => detectAudioFormat(bytes, { final: true }).format;
  assert.equal(format(mpegFrames([0xf3, 0x80, 0x00], 208)), "mp3", "MPEG-2 layer III, 64 kbit/s, 22.05 kHz");
  assert.equal(format(mpegFrames([0xf3, 0x82, 0x00], 209)), "mp3", "the same with padding");
  assert.equal(format(mpegFrames([0xe3, 0x40, 0x00], 208)), "mp3", "MPEG-2.5 layer III, 32 kbit/s, 11.025 kHz");
  assert.equal(format(mpegFrames([0xfd, 0xa4, 0x00], 576)), "mp3", "MPEG-1 layer II, 192 kbit/s, 48 kHz");
  // 128 kbit/s at 44.1 kHz: every few frames one is a byte longer.
  const mixed = Buffer.concat([mpegFrames([0xfb, 0x90, 0x00], 417, 1), mpegFrames([0xfb, 0x92, 0x00], 418, 1), mpegFrames([0xfb, 0x90, 0x00], 417, 1)]);
  assert.equal(format(mixed), "mp3", "padded and unpadded frames in a row");
  // A header whose length is off by one is not followed by a second frame.
  assert.equal(format(mpegFrames([0xf3, 0x80, 0x00], 209)), null);
});

test("signatures: only a real ID3v2 header counts as a tag", () => {
  const verdict = (bytes, final = true) => detectAudioFormat(bytes, { final });
  assert.deepEqual(verdict(Buffer.from("ID3 is a tag format for MP3 files. This page explains it.")), { format: "text", kind: "text" });
  // Version 9 does not exist; size bytes never have the top bit set.
  assert.equal(verdict(Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 9, 0, 0, 0, 0, 0x7f, 0x7f]), Buffer.alloc(200, 0x01)])).kind, "unknown");
  assert.equal(verdict(Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0, 0x80, 0x00]), Buffer.alloc(200, 0x01)])).kind, "unknown");
  // A tag with a cover picture is longer than the whole probe: undecided
  // while more is coming, MP3 once the probe has read all it will read.
  const bigTag = Buffer.concat([Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0x02, 0x00, 0x00]), Buffer.alloc(4096, 0x01)]);
  assert.deepEqual(verdict(bigTag, false), { format: null, kind: "unknown" });
  assert.deepEqual(detectAudioFormat(bigTag, { final: true, full: true }), { format: "mp3", kind: "audio" });
  // The body stopped before the probe was full: a tag header alone proves nothing.
  assert.deepEqual(verdict(bigTag, true), { format: null, kind: "unknown" });
});

test("ICY metadata between the audio bytes does not hide the frames", async () => {
  const body = withIcyMetadata(mp3Frames(8), 400);
  await withStreamServer((req, res) => {
    assert.equal(req.headers["icy-metadata"], "1");
    res.writeHead(200, { "Content-Type": "audio/mpeg", "icy-metaint": "400", "icy-name": "Meta FM" });
    res.end(body);
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl });
    assert.deepEqual([probe.playableAudio, probe.format, probe.icyName], [true, "mp3", "Meta FM"]);
  });
  // Without the icy-metaint header nothing is cut out of the body.
  assert.equal(detectAudioFormat(body, { final: true }).format, null);
});

test("words for the owner: not playable is not offline", () => {
  assert.equal(stationOutageText("Test FM (test)", { reachable: false, error: "Timeout nach 8000 ms" }), "Sender Test FM (test) ist offline: Timeout nach 8000 ms");
  assert.equal(stationOutageText("Test FM (test)", { reachable: true, error: "Kein Audio (HTML-Seite)" }), "Sender Test FM (test) ist nicht spielbar: Kein Audio (HTML-Seite)");
  assert.equal(stationOutageText("x", {}), "Sender x ist offline: nicht erreichbar");
  // "up" means playable now, whatever was wrong before.
  assert.equal(stationRecoveryText("Test FM (test)"), "Sender Test FM (test) ist wieder spielbar");
});

test("signatures: one stray sync word is not audio", () => {
  const stray = Buffer.alloc(2048, 0x01);
  stray.set([0xff, 0xfb, 0x90, 0x00], 100);
  assert.deepEqual(detectAudioFormat(stray, { final: true }), { format: null, kind: "unknown" });
});

test("signatures: pages, JSON and playlists are text, not audio", () => {
  const verdict = (text) => detectAudioFormat(Buffer.from(text), { final: true });
  assert.deepEqual(verdict("\ufeff  <html><body>hi</body></html>"), { format: "html", kind: "text" });
  assert.deepEqual(verdict('{"error":"not found"}'), { format: "json", kind: "text" });
  assert.deepEqual(verdict("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\nseg1.ts\n"), { format: "hls", kind: "playlist" });
  assert.deepEqual(verdict("#EXTM3U\nhttp://radio.test/live.mp3\n"), { format: "playlist", kind: "playlist" });
  assert.deepEqual(verdict("[playlist]\nFile1=http://radio.test/live.mp3\n"), { format: "playlist", kind: "playlist" });
  assert.deepEqual(verdict("Service temporarily unavailable"), { format: "text", kind: "text" });
  // Too little to tell while the body is still coming in.
  assert.deepEqual(detectAudioFormat(Buffer.from("<ht"), { final: false }), { format: null, kind: "unknown" });
});

test("an HLS playlist is reported as a playlist the bot cannot play", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "application/vnd.apple.mpegurl" });
    res.end("#EXTM3U\n#EXT-X-VERSION:3\n#EXT-X-TARGETDURATION:6\nseg1.ts\n");
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl });
    assert.deepEqual([probe.reachable, probe.playableAudio, probe.format, probe.reasonCode], [true, false, "hls", "playlist"]);
  });
});

test("binary data without a known signature counts as audio only when it is sent as audio", async () => {
  const body = Buffer.alloc(8192, 0x01);
  const probeAs = (contentType) => withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": contentType });
    res.end(body);
  }, (fetchImpl) => probeStreamAudio(URL_UNDER_TEST, { fetchImpl }));

  const mp4 = await probeAs("audio/mp4");
  assert.deepEqual([mp4.playableAudio, mp4.format, mp4.reasonCode], [true, "unknown", "ok"]);
  const download = await probeAs("application/octet-stream");
  assert.deepEqual([download.playableAudio, download.format, download.reasonCode], [false, null, "unknown_format"]);
});

test("a few unknown bytes and then silence are not playable, whatever the Content-Type says", async () => {
  const stalledAfter = (size) => withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mp4" });
    res.write(Buffer.alloc(size, 0x01));
  }, (fetchImpl) => probeStreamAudio(URL_UNDER_TEST, { fetchImpl, timeoutMs: 300 }));

  const trickle = await stalledAfter(1024);
  assert.deepEqual(
    [trickle.playableAudio, trickle.format, trickle.reasonCode, trickle.timedOut, trickle.bytesRead],
    [false, null, "unknown_format", true, 1024],
  );
  assert.equal(trickle.error, "Kein erkennbares Audioformat (nach 300 ms)");
  // Enough of it, and the stream counts even though it then stalls.
  const enough = await stalledAfter(8192);
  assert.deepEqual([enough.playableAudio, enough.format, enough.reasonCode], [true, "unknown", "ok"]);
});

test("an ID3 header and then nothing is not a station", async () => {
  // A valid header that announces a 32 KB tag; the server hangs after it.
  const header = Buffer.from([0x49, 0x44, 0x33, 3, 0, 0, 0, 0x02, 0x00, 0x00]);
  await withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.write(header);
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl, timeoutMs: 300 });
    assert.deepEqual([probe.playableAudio, probe.format, probe.timedOut, probe.bytesRead], [false, null, true, 10]);
    assert.equal(probe.error, "Kein erkennbares Audioformat (nach 300 ms)");
  });
  // The same tag filling the whole probe is an MP3 file with a cover picture.
  await withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(Buffer.concat([header, Buffer.alloc(20 * 1024, 0x01)]));
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl, maxBytes: 16 * 1024 });
    assert.deepEqual([probe.playableAudio, probe.format, probe.bytesRead], [true, "mp3", 16 * 1024]);
  });
});

test("a tiny finished file sent as audio is not a station", async () => {
  await withStreamServer((req, res) => {
    res.writeHead(200, { "Content-Type": "audio/mpeg" });
    res.end(Buffer.alloc(300, 0x01));
  }, async (fetchImpl) => {
    const probe = await probeStreamAudio(URL_UNDER_TEST, { fetchImpl });
    assert.deepEqual(
      [probe.playableAudio, probe.format, probe.reasonCode, probe.timedOut, probe.error],
      [false, null, "unknown_format", false, "Kein erkennbares Audioformat"],
    );
  });
});
