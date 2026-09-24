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

// Voice encryption (#214): Node's own AES-256-GCM, exactly one sodium binding
// as the fallback for xchacha20, and the DAVE library for end-to-end voice.
const { generateDependencyReport } = await import("@discordjs/voice");
const report = generateDependencyReport();
const lineOf = (name) => report.split(/\r?\n/).find((line) => line.trim().startsWith(`- ${name}:`)) || "";
const installed = (name) => !/:\s*not found\s*$/.test(lineOf(name)) && lineOf(name) !== "";
if (!/:\s*yes\s*$/.test(lineOf("native crypto support for aes-256-gcm"))) {
  throw new Error("Node has no native AES-256-GCM; Discord voice encryption falls back to sodium only.");
}
const sodiumBindings = ["sodium-native", "sodium", "libsodium-wrappers", "@stablelib/xchacha20poly1305", "@noble/ciphers"]
  .filter((name) => installed(name));
if (sodiumBindings.length !== 1 || sodiumBindings[0] !== "sodium-native") {
  throw new Error(`Expected exactly sodium-native as the encryption fallback, found: ${sodiumBindings.join(", ") || "none"}`);
}
if (!installed("@snazzah/davey")) {
  throw new Error("@snazzah/davey (DAVE end-to-end voice encryption) is missing.");
}
console.log("Voice encryption: native AES-256-GCM, sodium-native as the only fallback, DAVE present.");
