import test, { after } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

// #464: the plan's bitrate reaches Discord. The bot sets the volume itself,
// so discord.js encodes the audio once more; without a bitrate on that
// encoder every plan sent libopus' default of about 99 kbit/s. Measured on
// the packets discord.js hands to Discord.
const scratchDir = fs.mkdtempSync(path.join(os.tmpdir(), "omnifm-bitrate-"));
process.env.OMNIFM_RUNTIME_DATA_DIR = scratchDir;
process.env.LOGS_DIR = path.join(scratchDir, "logs");

const { StreamType, createAudioResource } = await import("@discordjs/voice");
const { applyEncoderBitrate, buildTranscodeProfile } = await import("../src/lib/helpers.js");
const { PLAN_LIMITS, PLAN_ORDER } = await import("../src/config/plan-features.js");

after(() => fs.rmSync(scratchDir, { recursive: true, force: true, maxRetries: 3 }));

/** Stereo PCM at 48 kHz full of noise, so the encoder has to spend its bits. */
function noise(seconds) {
  const samples = 48_000 * 2 * seconds;
  const pcm = Buffer.alloc(samples * 2);
  let seed = 7;
  for (let index = 0; index < samples; index += 1) {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    pcm.writeInt16LE(((seed >> 8) % 20000) - 10000, index * 2);
  }
  return pcm;
}

/** The bitrate of the Opus packets discord.js would send, over five seconds. */
async function sentKbps(kbps) {
  const resource = createAudioResource(Readable.from([noise(6)]), { inputType: StreamType.Raw, inlineVolume: true });
  if (kbps) assert.equal(applyEncoderBitrate(resource, kbps), true);
  let bytes = 0;
  let packets = 0;
  while (packets < 250 && !resource.ended) {
    const packet = resource.read();
    if (packet) {
      bytes += packet.length;
      packets += 1;
    } else {
      // eslint-disable-next-line no-await-in-loop -- waiting for the encoder, a moment at a time
      await Promise.race([once(resource.playStream, "readable"), new Promise((resolve) => setTimeout(resolve, 20))]);
    }
  }
  resource.playStream.destroy();
  assert.equal(packets, 250, "five seconds of packets");
  return (bytes * 8) / (packets * 0.02) / 1000;
}

test("each plan's bitrate reaches Discord instead of libopus' default", async () => {
  const unset = await sentKbps(null);
  assert.ok(unset > 80 && unset < 120, `without a bitrate the encoder sends its default: ${unset.toFixed(0)} kbit/s`);
  for (const plan of PLAN_ORDER) {
    const kbps = buildTranscodeProfile({ bitrateOverride: PLAN_LIMITS[plan].bitrate }).requestedKbps;
    // eslint-disable-next-line no-await-in-loop -- one plan after the other, so they do not share the CPU
    const sent = await sentKbps(kbps);
    assert.ok(Math.abs(sent - kbps) / kbps < 0.1, `${plan}: ${sent.toFixed(0)} kbit/s instead of ${kbps}`);
  }
});

test("the bitrate goes to whichever Opus module encodes, within Opus' limits", () => {
  assert.equal(applyEncoderBitrate(null, 128), false);
  assert.equal(applyEncoderBitrate({}, 128), false, "a resource without an encoder");
  const native = [];
  const resource = { encoder: { encoder: { applyEncoderCTL: (...args) => native.push(args) } } };
  assert.equal(applyEncoderBitrate(resource, 0), false, "no bitrate, nothing set");
  assert.equal(applyEncoderBitrate(resource, 900), true);
  assert.equal(applyEncoderBitrate(resource, 1), true);
  assert.deepEqual(native, [[4002, 510_000], [4002, 6000]], "capped at 510k and raised to 6k");
  // opusscript, prism's other Opus module, names the call encoderCTL.
  const script = [];
  assert.equal(applyEncoderBitrate({ encoder: { encoder: { encoderCTL: (...args) => script.push(args) } } }, 128), true);
  assert.deepEqual(script, [[4002, 128_000]]);
});
