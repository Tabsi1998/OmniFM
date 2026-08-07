import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { OpusEncoder } = require("@discordjs/opus");

const sampleRate = 48_000;
const channels = 2;
const samplesPerChannel = 960;
const pcm = Buffer.alloc(samplesPerChannel * channels * 2);
const encoder = new OpusEncoder(sampleRate, channels);

try {
  const packet = encoder.encode(pcm);
  if (!Buffer.isBuffer(packet) || packet.length === 0) {
    throw new Error("The native Opus encoder did not produce an audio packet.");
  }

  const decoded = encoder.decode(packet);
  if (!Buffer.isBuffer(decoded) || decoded.length !== pcm.length) {
    throw new Error(`The native Opus decoder returned ${decoded?.length ?? 0} bytes; expected ${pcm.length}.`);
  }

  console.log(`Native Opus encode/decode smoke passed (${packet.length}-byte packet, ${decoded.length}-byte PCM frame).`);
} finally {
  encoder.delete?.();
}
