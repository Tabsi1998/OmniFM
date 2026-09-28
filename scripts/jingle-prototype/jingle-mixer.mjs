// ============================================================
// OmniFM: the jingle prototype (#309), the mixer
// ============================================================
// Mixes a short jingle into the PCM of a running stream: the music ducks
// while the jingle plays and comes back with a short fade, so the stream
// neither stops nor reconnects. PCM is what ffmpeg hands discord.js:
// 48 kHz, stereo, signed 16 bit, little endian. Not part of the bot yet;
// measure.mjs shows what it costs.
import { Transform } from "node:stream";

export const SAMPLE_RATE = 48_000;
export const CHANNELS = 2;
// One stereo frame: two channels of 16 bit.
const FRAME_BYTES = 4;

const clamp = (value) => (value > 32767 ? 32767 : (value < -32768 ? -32768 : value));

/** A PCM buffer as 16-bit samples, whole stereo frames only. */
export function toSamples(pcm) {
  const usable = pcm.length - (pcm.length % FRAME_BYTES);
  const samples = new Int16Array(usable / 2);
  for (let index = 0; index < samples.length; index += 1) samples[index] = pcm.readInt16LE(index * 2);
  return samples;
}

export class JingleMixer extends Transform {
  /**
   * @param {{ duck?: number, fadeMs?: number, gain?: number }} [options]
   *   duck: the music's level under the jingle (0..1); fadeMs: how long the
   *   music takes to go down and to come back; gain: the jingle's level.
   */
  constructor({ duck = 0.3, fadeMs = 250, gain = 1 } = {}) {
    super();
    this.duck = Math.min(1, Math.max(0, duck));
    this.fadeSamples = Math.max(1, Math.round((fadeMs / 1000) * SAMPLE_RATE)) * CHANNELS;
    this.gain = gain;
    /** @type {Int16Array | null} */
    this.jingle = null;
    this.position = 0;
    this.pending = Buffer.alloc(0);
  }

  /** Starts a jingle (16-bit samples or a PCM buffer) from its beginning, over whatever plays. */
  play(jingle) {
    this.jingle = Buffer.isBuffer(jingle) ? toSamples(jingle) : jingle;
    this.position = 0;
  }

  /** Whether a jingle or its fade back is still running. */
  get busy() {
    return this.jingle !== null;
  }

  _transform(chunk, _encoding, callback) {
    const data = this.pending.length ? Buffer.concat([this.pending, chunk]) : chunk;
    const usable = data.length - (data.length % FRAME_BYTES);
    // A chunk may end inside a frame; the rest waits for the next one.
    this.pending = usable < data.length ? Buffer.from(data.subarray(usable)) : Buffer.alloc(0);
    if (!usable) {
      callback();
      return;
    }
    if (!this.jingle) {
      callback(null, data.subarray(0, usable));
      return;
    }
    const out = Buffer.from(data.subarray(0, usable));
    this.mix(out);
    callback(null, out);
  }

  /** Ducks the music and adds the jingle, sample by sample, in place. */
  mix(out) {
    const jingle = this.jingle;
    const total = jingle.length;
    const fade = this.fadeSamples;
    // A jingle shorter than the fade: the music goes down only while it plays.
    const down = Math.max(1, Math.min(fade, total));
    const samples = out.length / 2;
    for (let index = 0; index < samples; index += 1) {
      const position = this.position + index;
      let level = 1;
      if (position < down) level = 1 - (1 - this.duck) * (position / down);
      else if (position < total) level = this.duck;
      else if (position < total + fade) level = this.duck + (1 - this.duck) * ((position - total) / fade);
      const voice = position < total ? jingle[position] * this.gain : 0;
      out.writeInt16LE(clamp(Math.round(out.readInt16LE(index * 2) * level + voice)), index * 2);
    }
    this.position += samples;
    if (this.position >= total + fade) {
      this.jingle = null;
      this.position = 0;
    }
  }

  _flush(callback) {
    // An incomplete last frame cannot be played; it goes.
    this.pending = Buffer.alloc(0);
    callback();
  }
}
