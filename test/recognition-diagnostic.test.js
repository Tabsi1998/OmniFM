import assert from "node:assert/strict";
import test from "node:test";

import { runRecognitionDiagnostic } from "../scripts/recognition-diagnostic.mjs";

test("recognition diagnostic rejects an unsafe target before any stream work starts", async () => {
  let streamCalls = 0;
  let recognitionCalls = 0;
  const report = await runRecognitionDiagnostic("http://internal.example/radio", {
    validateUrl: async (url, options) => {
      assert.equal(url, "http://internal.example/radio");
      assert.deepEqual(options, { allowedProtocols: ["http:", "https:"] });
      return { ok: false, error: "Lokale/private Hosts sind nicht erlaubt." };
    },
    fetchSnapshot: async () => {
      streamCalls += 1;
      return null;
    },
    recognizeTrack: async () => {
      recognitionCalls += 1;
      return null;
    },
  });

  assert.equal(report.ok, false);
  assert.match(report.error, /Lokale\/private Hosts/);
  assert.equal(report.recognition.attempted, false);
  assert.equal(streamCalls, 0);
  assert.equal(recognitionCalls, 0);
});

test("recognition diagnostic only hands the DNS-validated URL to safe runtime services", async () => {
  const calls = [];
  const report = await runRecognitionDiagnostic("https://radio.example/start", {
    validateUrl: async () => ({ ok: true, url: "https://radio.example/final" }),
    fetchSnapshot: async (url, options) => {
      calls.push({ kind: "snapshot", url, options });
      return {
        metadataSource: "icy",
        metadataStatus: "ok",
        displayTitle: "Artist - Track",
        artist: "Artist",
        title: "Track",
        album: "Album",
      };
    },
    recognizeTrack: async (url, options) => {
      calls.push({ kind: "recognition", url, options });
      return { artist: "Artist", title: "Track" };
    },
  });

  assert.equal(report.ok, true);
  assert.equal(report.error, null);
  assert.equal(report.url, "https://radio.example/final");
  assert.equal(report.stream.displayTitle, "Artist - Track");
  assert.equal(report.recognition.attempted, true);
  assert.deepEqual(report.recognition.result, { artist: "Artist", title: "Track" });
  assert.deepEqual(calls, [
    {
      kind: "snapshot",
      url: "https://radio.example/final",
      options: { includeCover: false, allowRecognition: false },
    },
    {
      kind: "recognition",
      url: "https://radio.example/final",
      options: { existingTrack: null },
    },
  ]);
});
