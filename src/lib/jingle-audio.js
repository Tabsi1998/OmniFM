// ============================================================
// OmniFM: the servers' jingles (#309), the pure part
// ============================================================
// An Ultimate server uploads a short jingle in the dashboard. It plays over
// the ducked music when someone starts or switches the station and/or on the
// full hour in the server's time zone. It is kept as the PCM the bot mixes
// (48 kHz, stereo, 16 bit; src/lib/jingle-mixer.js), at most 10 seconds,
// brought to one loudness when it comes in (src/services/jingle-processing.js).
import { FRAME_BYTES, SAMPLE_RATE, CHANNELS } from "./jingle-mixer.js";
import { DEFAULT_SEASON_TIME_ZONE, localTime } from "./seasons.js";

export const JINGLE_MAX_MS = 10_000;
// Codecs add a little silence at the ends: a file of exactly 10 s may decode a bit longer.
export const JINGLE_TOLERANCE_MS = 250;
export const JINGLE_MIN_MS = 500;
// The uploaded file; 10 s of 48 kHz 24-bit stereo WAV is about 2.9 MB.
export const JINGLE_UPLOAD_MAX_BYTES = 6 * 1024 * 1024;
export const JINGLE_NAME_MAX = 80;
// EBU R128 like the streaming services: the jingle sits on the ducked music
// about as loud as a song.
export const JINGLE_LOUDNESS = Object.freeze({ integrated: -14, truePeak: -1.5, range: 11 });

const BYTES_PER_SECOND = SAMPLE_RATE * FRAME_BYTES;

/** @param {Buffer} pcm */
export function pcmDurationMs(pcm) {
  return Math.round(((pcm?.length || 0) / BYTES_PER_SECOND) * 1000);
}

/**
 * The audio formats a jingle may come in, by their first bytes. ffmpeg then
 * reads the file with that demuxer only (src/services/jingle-processing.js).
 * @param {Buffer} file
 * @returns {"wav" | "mp3" | "ogg" | "flac" | "mov" | "matroska" | null}
 */
export function sniffAudioFormat(file) {
  if (!Buffer.isBuffer(file) || file.length < 12) return null;
  const ascii = (start, end) => file.toString("latin1", start, end);
  if (ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE") return "wav";
  if (ascii(0, 4) === "OggS") return "ogg";
  if (ascii(0, 4) === "fLaC") return "flac";
  if (ascii(4, 8) === "ftyp") return "mov";
  if (file[0] === 0x1a && file[1] === 0x45 && file[2] === 0xdf && file[3] === 0xa3) return "matroska";
  if (ascii(0, 3) === "ID3") return "mp3";
  // An MPEG audio frame: 11 sync bits and a layer (0 would be AAC in ADTS).
  if (file[0] === 0xff && (file[1] & 0xe0) === 0xe0 && ((file[1] >> 1) & 0x03) !== 0) return "mp3";
  return null;
}

/**
 * The upload's bytes from a data URL or plain base64.
 * @returns {{ ok: true, file: Buffer } | { ok: false, error: "empty" | "invalid" | "size" }}
 */
export function decodeUpload(value, { maxBytes = JINGLE_UPLOAD_MAX_BYTES } = {}) {
  const text = String(value || "").trim().replace(/^data:[^,]*;base64,/i, "").replace(/\s+/g, "");
  if (!text) return { ok: false, error: "empty" };
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(text)) return { ok: false, error: "invalid" };
  if (Math.floor((text.length * 3) / 4) > maxBytes + 2) return { ok: false, error: "size" };
  const file = Buffer.from(text, "base64");
  if (!file.length) return { ok: false, error: "empty" };
  if (file.length > maxBytes) return { ok: false, error: "size" };
  return { ok: true, file };
}

/** The file's name as the dashboard shows it: no folders, no control characters. */
export function cleanJingleName(value) {
  const base = String(value || "").split(/[\\/]/).pop() || "";
  // eslint-disable-next-line no-control-regex -- control characters go
  const name = base.replace(/[\u0000-\u001f\u007f]/g, "").replace(/\s+/g, " ").trim().slice(0, JINGLE_NAME_MAX);
  return name || "Jingle";
}

/**
 * A WAV file around the stored PCM, for listening in the dashboard.
 * @param {Buffer} pcm
 */
export function wavFromPcm(pcm) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0, "latin1");
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8, "latin1");
  header.write("fmt ", 12, "latin1");
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(CHANNELS, 22);
  header.writeUInt32LE(SAMPLE_RATE, 24);
  header.writeUInt32LE(BYTES_PER_SECOND, 28);
  header.writeUInt16LE(FRAME_BYTES, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36, "latin1");
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

/**
 * The server's two switches. A server that never chose hears its jingle when
 * the station is started or switched, not on the hour.
 * @returns {{ onSwitch: boolean, onHour: boolean }}
 */
export function normalizeJingleSettings(raw) {
  const source = raw && typeof raw === "object" ? raw : {};
  return { onSwitch: source.onSwitch !== false, onHour: source.onHour === true };
}

/**
 * The full hour a moment belongs to in a time zone while it is still in the
 * first minute of that hour ("2026-10-02T14" from 14:00:00 to 14:00:59),
 * otherwise null. The hour that comes twice when the clocks go back is one.
 */
export function fullHourKey(moment = new Date(), timeZone = DEFAULT_SEASON_TIME_ZONE) {
  const local = localTime(moment, timeZone);
  if (local.minute !== 0) return null;
  const pad = (value) => String(value).padStart(2, "0");
  return `${local.year}-${pad(local.month)}-${pad(local.day)}T${pad(local.hour)}`;
}

/**
 * Every time zone's full hour falls on a quarter of a UTC hour (India :30,
 * Nepal :45), so the clock looks at the servers only then.
 */
export function mayBeFullHourSomewhere(moment = new Date()) {
  return moment.getUTCMinutes() % 15 === 0;
}

/**
 * What loudnorm measured (print_format=json, the last JSON block of ffmpeg's
 * output). Silence measures "-inf", which reads as NaN here.
 * @returns {{ inputI: number, inputTp: number, inputLra: number, inputThresh: number, targetOffset: number } | null}
 */
export function parseLoudnormStats(stderr) {
  const text = String(stderr || "");
  const start = text.lastIndexOf("{");
  const end = text.lastIndexOf("}");
  if (start < 0 || end < start) return null;
  let raw;
  try {
    raw = JSON.parse(text.slice(start, end + 1));
  } catch {
    return null;
  }
  const value = (key) => Number.parseFloat(String(raw?.[key] ?? ""));
  return {
    inputI: value("input_i"),
    inputTp: value("input_tp"),
    inputLra: value("input_lra"),
    inputThresh: value("input_thresh"),
    targetOffset: value("target_offset"),
  };
}

/** Whether loudnorm heard anything at all; silence or near silence is no jingle. */
export function isAudible(stats) {
  return Boolean(stats) && Number.isFinite(stats.inputI) && stats.inputI > -70
    && Number.isFinite(stats.inputTp) && Number.isFinite(stats.inputLra) && Number.isFinite(stats.inputThresh);
}

/**
 * loudnorm's filter: without stats the measuring pass, with them the linear
 * pass that applies one gain to the whole jingle, so it keeps its dynamics.
 */
export function loudnormFilter(stats = null) {
  const { integrated, truePeak, range } = JINGLE_LOUDNESS;
  const target = `loudnorm=I=${integrated}:TP=${truePeak}:LRA=${range}`;
  if (!stats) return `${target}:print_format=json`;
  const fixed = (value) => Number(value).toFixed(2);
  const offset = Number.isFinite(stats.targetOffset) ? `:offset=${fixed(stats.targetOffset)}` : "";
  return `${target}:measured_I=${fixed(stats.inputI)}:measured_TP=${fixed(stats.inputTp)}`
    + `:measured_LRA=${fixed(stats.inputLra)}:measured_thresh=${fixed(stats.inputThresh)}${offset}:linear=true:print_format=summary`;
}
