// ============================================================
// OmniFM: an uploaded jingle becomes the PCM the bot mixes (#309)
// ============================================================
// Three short ffmpeg runs, the uploaded file is read only by the first:
//   1. decode: the demuxer of the file's first bytes and nothing but its
//      input (no playlists, no other files), at most 10.5 s of PCM
//   2. measure the loudness of that PCM (loudnorm, EBU R128)
//   3. bring it to -14 LUFS with one gain (linear), with 20 ms fades so it
//      starts and ends without a click
// At most two uploads are worked on at once; ffmpeg gets 20 s per run.
import { spawn } from "node:child_process";

import { CHANNELS, SAMPLE_RATE } from "../lib/jingle-mixer.js";
import {
  JINGLE_MAX_MS,
  JINGLE_MIN_MS,
  JINGLE_TOLERANCE_MS,
  isAudible,
  loudnormFilter,
  parseLoudnormStats,
  pcmDurationMs,
  sniffAudioFormat,
} from "../lib/jingle-audio.js";

const RUN_TIMEOUT_MS = 20_000;
const MAX_PARALLEL = 2;
const FADE_SECONDS = 0.02;
// Decoding stops a little after the limit: enough to tell "too long" apart.
const DECODE_SECONDS = (JINGLE_MAX_MS + 500) / 1000;
// Enough for the decoded PCM and loudnorm's 192 kHz never reaches stdout.
const MAX_OUTPUT_BYTES = Math.ceil(DECODE_SECONDS * SAMPLE_RATE * CHANNELS * 2) + 65_536;
const RAW_PCM = ["-f", "s16le", "-ar", String(SAMPLE_RATE), "-ac", String(CHANNELS)];

let running = 0;

/**
 * Runs ffmpeg with `input` on stdin.
 * @param {string[]} args
 * @param {Buffer} input
 * @returns {Promise<{ code: number, stdout: Buffer, stderr: string }>}
 */
export function runFfmpeg(args, input, { timeoutMs = RUN_TIMEOUT_MS, maxOutputBytes = MAX_OUTPUT_BYTES } = {}) {
  return new Promise((resolve) => {
    /** @type {import("node:child_process").ChildProcessWithoutNullStreams} */
    let child;
    try {
      child = spawn("ffmpeg", args, { stdio: ["pipe", "pipe", "pipe"], env: { ...process.env, AV_LOG_FORCE_NOCOLOR: "1" } });
    } catch (error) {
      resolve({ code: -1, stdout: Buffer.alloc(0), stderr: String(error?.message || error) });
      return;
    }
    const parts = [];
    let outputBytes = 0;
    let stderr = "";
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout: Buffer.concat(parts), stderr });
    };
    const stop = (code) => {
      try {
        child.kill("SIGKILL");
      } catch {
        // already gone
      }
      finish(code);
    };
    const timer = setTimeout(() => stop(-1), timeoutMs);
    child.stdout.on("data", (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > maxOutputBytes) stop(-2);
      else parts.push(chunk);
    });
    // loudnorm writes its numbers last; the end of the output is what counts.
    child.stderr.on("data", (chunk) => {
      stderr = (stderr + chunk.toString()).slice(-64_000);
    });
    child.on("error", (error) => {
      stderr += String(error?.message || error);
      finish(-1);
    });
    child.on("close", (code) => finish(code ?? -1));
    // ffmpeg may stop reading before the end (-t); that is no error.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  });
}

/**
 * @typedef {{ ok: true, pcm: Buffer, durationMs: number }
 *   | { ok: false, error: "format" | "unreadable" | "too-long" | "too-short" | "silent" | "busy" }} PreparedJingle
 */

/**
 * @param {Buffer} file  the uploaded file
 * @param {{ run?: typeof runFfmpeg }} [options]  run: ffmpeg, replaceable in tests
 * @returns {Promise<PreparedJingle>}
 */
export async function prepareJingle(file, { run = runFfmpeg } = {}) {
  const format = sniffAudioFormat(file);
  if (!format) return { ok: false, error: "format" };
  if (running >= MAX_PARALLEL) return { ok: false, error: "busy" };
  running += 1;
  try {
    const decoded = await run([
      "-hide_banner", "-nostats", "-loglevel", "error",
      "-protocol_whitelist", "pipe", "-f", format, "-i", "pipe:0",
      "-map", "0:a:0", "-vn", "-sn", "-dn", "-t", String(DECODE_SECONDS),
      ...RAW_PCM, "pipe:1",
    ], file);
    if (decoded.code !== 0 || !decoded.stdout.length) return { ok: false, error: "unreadable" };
    const decodedMs = pcmDurationMs(decoded.stdout);
    if (decodedMs > JINGLE_MAX_MS + JINGLE_TOLERANCE_MS) return { ok: false, error: "too-long" };
    if (decodedMs < JINGLE_MIN_MS) return { ok: false, error: "too-short" };

    const rawInput = ["-hide_banner", "-nostats", ...RAW_PCM, "-i", "pipe:0"];
    const measured = await run([...rawInput, "-af", loudnormFilter(), "-f", "null", "-"], decoded.stdout);
    const stats = measured.code === 0 ? parseLoudnormStats(measured.stderr) : null;
    if (!stats) return { ok: false, error: "unreadable" };
    if (!isAudible(stats)) return { ok: false, error: "silent" };

    const fadeOutAt = Math.max(0, decodedMs / 1000 - FADE_SECONDS).toFixed(3);
    const filters = [
      loudnormFilter(stats),
      `aresample=${SAMPLE_RATE}`,
      `afade=t=in:st=0:d=${FADE_SECONDS}`,
      `afade=t=out:st=${fadeOutAt}:d=${FADE_SECONDS}`,
    ].join(",");
    const normalized = await run([...rawInput, "-af", filters, ...RAW_PCM, "pipe:1"], decoded.stdout);
    if (normalized.code !== 0 || !normalized.stdout.length) return { ok: false, error: "unreadable" };
    const pcm = normalized.stdout.subarray(0, normalized.stdout.length - (normalized.stdout.length % 4));
    return { ok: true, pcm, durationMs: pcmDurationMs(pcm) };
  } finally {
    running -= 1;
  }
}
