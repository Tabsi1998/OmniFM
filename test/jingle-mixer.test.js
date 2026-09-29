import test from "node:test";
import assert from "node:assert/strict";
import { Readable } from "node:stream";

// The jingle prototype (#309): the mixer ducks the music under a jingle and
// brings it back, whatever sizes the PCM chunks come in.
const { JingleMixer, toSamples } = await import("../scripts/jingle-prototype/jingle-mixer.mjs");

/** Stereo PCM with every sample at `value`. */
function pcm(frames, value) {
  const buffer = Buffer.alloc(frames * 4);
  for (let index = 0; index < frames * 2; index += 1) buffer.writeInt16LE(value, index * 2);
  return buffer;
}

async function run(mixer, chunks) {
  const parts = [];
  mixer.on("data", (part) => parts.push(part));
  const done = new Promise((resolve, reject) => {
    mixer.on("end", resolve);
    mixer.on("error", reject);
  });
  Readable.from(chunks).pipe(mixer);
  await done;
  return Buffer.concat(parts);
}

test("without a jingle the music passes unchanged", async () => {
  const music = pcm(480, 1000);
  const out = await run(new JingleMixer(), [music]);
  assert.deepEqual(out, music);
});

test("under the jingle the music is ducked and the jingle added; afterwards it comes back", async () => {
  // fadeMs 0 rounds up to one frame, so the levels are exact from the second frame on.
  const mixer = new JingleMixer({ duck: 0.5, fadeMs: 0 });
  mixer.play(pcm(100, 200));
  const out = toSamples(await run(mixer, [pcm(300, 1000)]));
  assert.equal(out[2 * 50], 1000 * 0.5 + 200, "inside the jingle");
  assert.equal(out[2 * 250], 1000, "after the jingle and the fade");
  assert.equal(mixer.busy, false);
});

test("chunks cut anywhere, even inside a frame, give the same sound as one chunk", async () => {
  const music = Buffer.alloc(4 * 1000);
  for (let index = 0; index < 2000; index += 1) music.writeInt16LE(Math.round(Math.sin(index / 7) * 8000), index * 2);
  const jingle = pcm(400, 3000);

  const whole = new JingleMixer({ duck: 0.3, fadeMs: 2 });
  whole.play(jingle);
  const expected = await run(whole, [music]);

  const pieces = [];
  for (let offset = 0, size = 3; offset < music.length; offset += size, size = (size * 7) % 61 + 1) {
    pieces.push(music.subarray(offset, Math.min(music.length, offset + size)));
  }
  const split = new JingleMixer({ duck: 0.3, fadeMs: 2 });
  split.play(jingle);
  assert.deepEqual(await run(split, pieces), expected);
});

test("loud music and a loud jingle are clipped, not wrapped around", async () => {
  const mixer = new JingleMixer({ duck: 1, fadeMs: 0, gain: 1 });
  mixer.play(pcm(10, 30000));
  const out = toSamples(await run(mixer, [pcm(10, 30000)]));
  assert.equal(Math.max(...out), 32767);
  assert.ok(Math.min(...out) > 0, "no sample wrapped to negative");
});

test("an incomplete last frame is dropped, never half played", async () => {
  const out = await run(new JingleMixer(), [pcm(3, 500), Buffer.from([1, 2, 3])]);
  assert.equal(out.length, 12);
});
