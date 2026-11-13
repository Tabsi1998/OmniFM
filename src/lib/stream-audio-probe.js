// ============================================================
// OmniFM: does this URL send audio the bot can play? (#538)
// ============================================================
// One small GET, like the player's own (src/services/stream.js): it reads a
// few KB, looks at the bytes and stops. The answer keeps three things apart:
// the server answers (reachable), it lets us in (authorized), and what comes
// is audio (playableAudio). A HEAD answer or a Content-Type proves none of it.
// The station health check, the owner's stream test and the catalogue probe
// all ask here.
import { safeFetch } from "./safe-outbound-http.js";

const PROBE_MAX_BYTES = 32 * 1024;
const PROBE_TIMEOUT_MS = 8_000;
const TEXT_SAMPLE_BYTES = 512;
const UNDECIDED = Object.freeze({ format: null, kind: "unknown" });

// kbit/s by bitrate index; MPEG-2 and 2.5 share their tables.
const MPEG_BITRATES = {
  v1l1: [0, 32, 64, 96, 128, 160, 192, 224, 256, 288, 320, 352, 384, 416, 448],
  v1l2: [0, 32, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320, 384],
  v1l3: [0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320],
  v2l1: [0, 32, 48, 56, 64, 80, 96, 112, 128, 144, 160, 176, 192, 224, 256],
  v2l23: [0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160],
};
// By the header's version bits: 3 = MPEG-1, 2 = MPEG-2, 0 = MPEG-2.5.
const MPEG_SAMPLE_RATES = { 3: [44100, 48000, 32000], 2: [22050, 24000, 16000], 0: [11025, 12000, 8000] };

/** An MPEG audio frame header (MP3 and its layer I/II siblings) at this offset, or null. */
function mpegFrame(bytes, at) {
  if (at + 4 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xe0) !== 0xe0) return null;
  const version = (bytes[at + 1] >> 3) & 3;
  const layer = 4 - ((bytes[at + 1] >> 1) & 3); // 4 = reserved (that is where ADTS lives)
  const bitrateIndex = bytes[at + 2] >> 4;
  const sampleRate = MPEG_SAMPLE_RATES[version]?.[(bytes[at + 2] >> 2) & 3];
  if (layer === 4 || !sampleRate || bitrateIndex === 0 || bitrateIndex === 15) return null;
  const table = version === 3 ? `v1l${layer}` : (layer === 1 ? "v2l1" : "v2l23");
  const bitrate = MPEG_BITRATES[table][bitrateIndex] * 1000;
  const padding = (bytes[at + 2] >> 1) & 1;
  const length = layer === 1
    ? (Math.floor((12 * bitrate) / sampleRate) + padding) * 4
    : Math.floor(((layer === 3 && version !== 3 ? 72 : 144) * bitrate) / sampleRate) + padding;
  return { length, id: `${version}-${layer}-${sampleRate}` };
}

/** An AAC frame header (ADTS, 0xFFF1/0xFFF9) at this offset, or null. */
function adtsFrame(bytes, at) {
  if (at + 7 > bytes.length || bytes[at] !== 0xff || (bytes[at + 1] & 0xf6) !== 0xf0) return null;
  const sampleRateIndex = (bytes[at + 2] >> 2) & 0x0f;
  const length = ((bytes[at + 3] & 0x03) << 11) | (bytes[at + 4] << 3) | (bytes[at + 5] >> 5);
  if (sampleRateIndex > 12 || length < 7) return null;
  return { length, id: `adts-${sampleRateIndex}` };
}

/**
 * Two frames in a row, the second exactly where the first one says it is: a
 * live stream starts anywhere, and a lone 0xFF in other data is no audio.
 */
function findFrames(bytes, from) {
  for (let at = from; at + 4 <= bytes.length; at += 1) {
    if (bytes[at] !== 0xff) continue;
    for (const [format, read] of /** @type {Array<[string, Function]>} */ ([["mp3", mpegFrame], ["aac", adtsFrame]])) {
      const first = read(bytes, at);
      const second = first && read(bytes, at + first.length);
      if (second && second.id === first.id) return format;
    }
  }
  return null;
}

/** A page, JSON, a playlist or other plain text; null for anything binary. */
function textVerdict(bytes) {
  const sample = bytes.subarray(0, TEXT_SAMPLE_BYTES);
  if (!sample.length || sample.some((byte) => byte < 0x09 || (byte > 0x0d && byte < 0x20) || byte === 0x7f || byte >= 0xf8)) return null;
  const text = sample.toString("utf8").trimStart(); // trims a BOM too
  if (/^#EXTM3U/i.test(text)) return { format: bytes.includes("#EXT-X-") ? "hls" : "playlist", kind: "playlist" };
  if (/^\[playlist\]/i.test(text)) return { format: "playlist", kind: "playlist" };
  if (text.startsWith("<")) return { format: "html", kind: "text" };
  if (/^[{[]/.test(text)) return { format: "json", kind: "text" };
  return { format: "text", kind: "text" };
}

/**
 * What the first bytes of a body are. `final` says nothing more is coming:
 * until then a short body that could still become anything stays undecided.
 * @param {Uint8Array} input
 * @param {{ final?: boolean }} [options]
 * @returns {{ format: string | null, kind: "audio" | "text" | "playlist" | "unknown" }}
 */
function detectAudioFormat(input, { final = false } = {}) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  const magic = bytes.subarray(0, 4).toString("latin1");
  if (magic === "OggS") {
    const head = bytes.subarray(0, TEXT_SAMPLE_BYTES);
    const codec = head.includes("OpusHead") ? "opus" : head.includes("\x01vorbis") ? "vorbis" : head.includes("\x7fFLAC") ? "flac" : "ogg";
    return { format: codec, kind: "audio" };
  }
  if (magic === "fLaC") return { format: "flac", kind: "audio" };
  let from = 0;
  if (magic.startsWith("ID3") && bytes.length >= 10) {
    // ID3v2: ten bytes, then as many as the four 7-bit size bytes say.
    from = 10 + ((bytes[6] & 0x7f) << 21 | (bytes[7] & 0x7f) << 14 | (bytes[8] & 0x7f) << 7 | (bytes[9] & 0x7f));
    if (from >= bytes.length) return { format: "mp3", kind: "audio" }; // a tag with a cover picture fills the whole probe
  }
  const frames = findFrames(bytes, from);
  if (frames) return { format: frames, kind: "audio" };
  if (final || bytes.length >= TEXT_SAMPLE_BYTES) return textVerdict(bytes) || { ...UNDECIDED };
  return { ...UNDECIDED };
}

const NOT_AUDIO_LABELS = { html: "HTML-Seite", json: "JSON", text: "Text", hls: "HLS-Playlist", playlist: "Playlist" };

/** One short German line for the owner: why this is not playable. */
function describeProbeFailure(probe, rawError = "") {
  switch (probe.reasonCode) {
    case "timeout": return `Timeout nach ${probe.timeoutMs}ms`;
    case "network_error": return String(rawError || "nicht erreichbar");
    case "unauthorized": return `HTTP ${probe.httpStatus} (Zugriff verweigert)`;
    case "http_error": return `HTTP ${probe.httpStatus}`;
    case "not_audio":
    case "playlist": return `Kein Audio (${NOT_AUDIO_LABELS[probe.format] || probe.format})`;
    case "no_data": return "Keine Audiodaten erhalten";
    default: return "Kein erkennbares Audioformat";
  }
}

/**
 * @typedef {Object} StreamAudioProbe
 * @property {number | null} httpStatus   null: no answer at all
 * @property {boolean} reachable          the server answered (401/403 included)
 * @property {boolean | null} authorized  false on 401/403, null without an answer
 * @property {boolean} playableAudio      the body is audio the bot can play
 * @property {string | null} format       mp3, aac, opus, vorbis, flac, ogg, unknown; html, json, text, hls, playlist
 * @property {"ok" | "timeout" | "network_error" | "unauthorized" | "http_error" | "not_audio" | "playlist" | "no_data" | "unknown_format"} reasonCode
 * @property {string | null} error        the reason in words, null when playable
 * @property {boolean} timedOut
 * @property {string} contentType
 * @property {string | null} icyName
 * @property {string | null} bitrate
 * @property {number} bytesRead
 * @property {number} responseTimeMs      until the answer's headers (or until giving up)
 * @property {number} timeoutMs
 */

/**
 * @param {string} url
 * @param {{ timeoutMs?: number, maxBytes?: number, userAgent?: string, fetchImpl?: Function }} [options]
 * @returns {Promise<StreamAudioProbe>}
 */
async function probeStreamAudio(url, {
  timeoutMs = PROBE_TIMEOUT_MS,
  maxBytes = PROBE_MAX_BYTES,
  userAgent = "OmniFM-StreamProbe/1.0",
  fetchImpl = safeFetch,
} = {}) {
  const startedAt = Date.now();
  /** @type {StreamAudioProbe} */
  const probe = {
    httpStatus: null, reachable: false, authorized: null, playableAudio: false, format: null,
    reasonCode: "network_error", error: null, timedOut: false,
    contentType: "", icyName: null, bitrate: null, bytesRead: 0, responseTimeMs: 0, timeoutMs,
  };
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const aborted = new Promise((resolve) => { controller.signal.addEventListener("abort", () => resolve(null), { once: true }); });
  let response = null;
  let reader = null;
  let rawError = "";
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: { "User-Agent": userAgent, "Icy-MetaData": "1" },
      redirect: "follow",
      lenientHttpParser: true, // radio servers, #536
      timeoutMs,
      signal: controller.signal,
    });
    probe.responseTimeMs = Date.now() - startedAt;
    const status = Number(response.status) || 0;
    probe.httpStatus = status;
    probe.contentType = String(response.headers?.get?.("content-type") || "");
    probe.icyName = response.headers?.get?.("icy-name") || null;
    probe.bitrate = response.headers?.get?.("icy-br") || null;
    probe.authorized = status !== 401 && status !== 403;
    probe.reachable = status < 400 || !probe.authorized;
    if (status < 200 || status >= 300) {
      probe.reasonCode = probe.authorized ? "http_error" : "unauthorized";
    } else {
      reader = response.body?.getReader?.() || null;
      let bytes = Buffer.alloc(0);
      let verdict = { ...UNDECIDED };
      while (reader && !verdict.format && bytes.length < maxBytes) {
        // eslint-disable-next-line no-await-in-loop -- the body arrives chunk by chunk
        const next = await Promise.race([reader.read().catch(() => null), aborted]);
        if (!next || next.done) break;
        bytes = Buffer.concat([bytes, next.value]).subarray(0, maxBytes);
        verdict = detectAudioFormat(bytes);
      }
      if (!verdict.format) verdict = detectAudioFormat(bytes, { final: true });
      probe.bytesRead = bytes.length;
      probe.format = verdict.format;
      if (verdict.kind === "audio") {
        probe.reasonCode = "ok";
      } else if (verdict.kind === "text") {
        probe.reasonCode = "not_audio";
      } else if (verdict.kind === "playlist") {
        // The player pipes the body into FFmpeg (pipe:0); a playlist's
        // segments are never fetched, so this does not play.
        probe.reasonCode = "playlist";
      } else if (bytes.length && /^(audio|video)\/|^application\/ogg/i.test(probe.contentType)) {
        // Binary data no signature here knows (MP4, WAV, MPEG-TS …), sent as
        // audio: FFmpeg plays far more than this probe recognises.
        probe.format = "unknown";
        probe.reasonCode = "ok";
      } else {
        probe.reasonCode = bytes.length ? "unknown_format" : "no_data";
      }
      probe.playableAudio = probe.reasonCode === "ok";
      probe.timedOut = timedOut && !probe.playableAudio;
    }
  } catch (err) {
    probe.timedOut = timedOut || err?.code === "OUTBOUND_TIMEOUT" || err?.name === "TimeoutError";
    probe.reasonCode = probe.timedOut ? "timeout" : "network_error";
    probe.responseTimeMs = Date.now() - startedAt;
    rawError = String(err?.message || err || "");
  } finally {
    clearTimeout(timer);
    // Closes the connection: a radio stream never ends by itself.
    try {
      await (reader ? reader.cancel() : response?.body?.cancel?.());
    } catch {
      // closed either way
    }
  }
  probe.error = probe.playableAudio ? null : describeProbeFailure(probe, rawError);
  return probe;
}

export {
  PROBE_MAX_BYTES,
  describeProbeFailure,
  detectAudioFormat,
  probeStreamAudio,
};
