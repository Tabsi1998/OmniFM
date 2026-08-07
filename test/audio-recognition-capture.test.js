import assert from "node:assert/strict";
import test from "node:test";

import { buildCaptureFfmpegArgs } from "../src/services/audio-recognition.js";

test("audio recognition passes a checked stream through stdin instead of letting ffmpeg fetch a URL", () => {
  const args = buildCaptureFfmpegArgs("C:/tmp/omnifm-fingerprint/sample.wav");
  const inputIndex = args.indexOf("-i");

  assert.equal(args[inputIndex + 1], "pipe:0");
  assert.equal(args.some((value) => /^https?:\/\//i.test(String(value))), false);
  assert.equal(args.includes("-reconnect"), false);
  assert.equal(args.includes("-reconnect_streamed"), false);
});
