// ============================================================
// OmniFM: "Stream testen" for a server's own station (#537)
// ============================================================
// A server admin checks a stream URL before saving it. The test takes the
// player's own way: safeFetch (SSRF check and DNS pinning on every hop, every
// redirect checked again) and the shared audio probe (#538: a few KB, a time
// limit, real audio detection). The answer is a result code and a few
// harmless facts; the dashboard words it in the reader's language. No
// address, resolved IP, query string or raw error text goes back.
import { requestPinnedTarget, safeFetch, validateOutboundUrl } from "./safe-outbound-http.js";
import { probeStreamAudio } from "./stream-audio-probe.js";

const STREAM_TEST_MAX_REDIRECTS = 3;
const STREAM_TEST_TIMEOUT_MS = 8_000;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const PRIVATE_TARGET_CODES = new Set(["OUTBOUND_ADDRESS_NOT_ALLOWED", "OUTBOUND_HOST_NOT_ALLOWED"]);
const DNS_CODES = new Set(["OUTBOUND_DNS_LOOKUP_FAILED", "OUTBOUND_DNS_EMPTY"]);
const REDIRECT_TARGET_CODES = new Set([
  "OUTBOUND_URL_INVALID", "OUTBOUND_URL_TOO_LONG", "OUTBOUND_PROTOCOL_NOT_ALLOWED",
  "OUTBOUND_CREDENTIALS_NOT_ALLOWED", "OUTBOUND_HOST_INVALID",
]);
const AUDIO_FORMATS = new Set(["mp3", "aac", "opus", "vorbis", "flac", "ogg"]);
const NOT_AUDIO_FORMATS = new Set(["html", "json", "text"]);
const PLAYLIST_FORMATS = new Set(["hls", "playlist"]);

/**
 * @typedef {"playable" | "invalid_url" | "private_target" | "dns_failed" | "too_many_redirects"
 *   | "bad_redirect" | "unauthorized" | "forbidden" | "rate_limited" | "http_error" | "not_audio"
 *   | "playlist" | "timeout" | "unreachable"} StreamTestResult
 */

/** Why it does not play, from the probe and the error safeFetch threw (if any). */
function classify(probe, failure, redirects) {
  if (probe.playableAudio) return "playable";
  const code = String(failure?.code || "");
  if (PRIVATE_TARGET_CODES.has(code)) return "private_target";
  if (DNS_CODES.has(code)) return "dns_failed";
  if (code === "OUTBOUND_REDIRECT_NOT_ALLOWED" && redirects > STREAM_TEST_MAX_REDIRECTS) return "too_many_redirects";
  // A redirect without a target, or to one no station may have (ftp://, a
  // password): the first address passed these checks already.
  if (code.startsWith("OUTBOUND_REDIRECT") || REDIRECT_TARGET_CODES.has(code)) return "bad_redirect";
  switch (probe.reasonCode) {
    case "timeout": return "timeout";
    case "unauthorized": return probe.httpStatus === 401 ? "unauthorized" : "forbidden";
    case "http_error": return probe.httpStatus === 429 ? "rate_limited" : "http_error";
    case "playlist": return "playlist";
    case "not_audio":
    case "unknown_format": return "not_audio";
    // The server answered and then sent nothing until the time was up.
    case "no_data": return probe.timedOut ? "timeout" : "not_audio";
    default: return "unreachable";
  }
}

/** "128" or "128,128" from icy-br; anything else is not shown. */
function bitrateKbps(raw) {
  const value = Number.parseInt(String(raw || "").split(",")[0], 10);
  return Number.isFinite(value) && value >= 8 && value <= 2_000 ? value : null;
}

function formatFor(result, format) {
  if (result === "playable") return AUDIO_FORMATS.has(format) ? format : null;
  if (result === "not_audio") return NOT_AUDIO_FORMATS.has(format) ? format : null;
  if (result === "playlist") return PLAYLIST_FORMATS.has(format) ? format : "playlist";
  return null;
}

/**
 * @param {string} rawUrl
 * @param {{ timeoutMs?: number, requestImpl?: Function, lookupFn?: Function }} [options]
 *   requestImpl and lookupFn reach safeFetch unchanged (tests: no network).
 * @returns {Promise<{ ok: boolean, result: StreamTestResult, httpStatus: number | null,
 *   format: string | null, bitrateKbps: number | null, redirects: number, responseTimeMs: number,
 *   host: string | null, detail: string | null }>}
 *   host and detail are for the server's log only (the host without path or
 *   query, the error code); the route does not send them.
 */
async function testCustomStationStream(rawUrl, { timeoutMs = STREAM_TEST_TIMEOUT_MS, requestImpl = requestPinnedTarget, lookupFn } = {}) {
  const answer = (result, extra = {}) => ({
    ok: result === "playable", result, httpStatus: null, format: null, bitrateKbps: null, redirects: 0, responseTimeMs: 0, host: null, detail: null, ...extra,
  });
  const validation = validateOutboundUrl(String(rawUrl || "").trim(), { allowedProtocols: ["http:", "https:"] });
  if (!validation.ok) {
    return answer(PRIVATE_TARGET_CODES.has(validation.code) ? "private_target" : "invalid_url", { detail: validation.code });
  }

  let redirects = 0;
  /** @type {any} */
  let failure = null;
  const countRedirects = async (target, options) => {
    const incoming = await requestImpl(target, options);
    if (REDIRECT_STATUS_CODES.has(Number(incoming?.statusCode))) redirects += 1;
    return incoming;
  };
  const fetchImpl = async (url, options) => {
    try {
      return await safeFetch(url, { ...options, maxRedirects: STREAM_TEST_MAX_REDIRECTS, requestImpl: countRedirects, ...(lookupFn ? { lookupFn } : {}) });
    } catch (error) {
      failure = error;
      throw error;
    }
  };
  const probe = await probeStreamAudio(validation.url, { timeoutMs, userAgent: "OmniFM-StreamTest/1.0", fetchImpl });
  const result = classify(probe, failure, redirects);
  return answer(result, {
    httpStatus: probe.httpStatus,
    format: formatFor(result, probe.format),
    bitrateKbps: result === "playable" ? bitrateKbps(probe.bitrate) : null,
    redirects,
    responseTimeMs: probe.responseTimeMs,
    host: validation.parsedUrl.hostname,
    detail: failure ? String(failure.cause?.code || failure.code || failure.name || "") || null : probe.reasonCode,
  });
}

/**
 * At most `max` tests per `windowMs` for every key given (the user and the
 * server alike). Returns 0 when the test may run, else the seconds to wait.
 */
function createStreamTestLimiter({ max = 6, windowMs = 60_000, now = Date.now } = {}) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();
  return function takeStreamTest(keys) {
    const at = now();
    for (const [key, times] of hits) {
      if (!times.some((time) => at - time < windowMs)) hits.delete(key);
    }
    const recent = keys.map((key) => (hits.get(key) || []).filter((time) => at - time < windowMs));
    const full = recent.filter((times) => times.length >= max);
    if (full.length) {
      return Math.max(1, Math.ceil(Math.max(...full.map((times) => times[0] + windowMs - at)) / 1000));
    }
    keys.forEach((key, index) => hits.set(key, [...recent[index], at]));
    return 0;
  };
}

export {
  STREAM_TEST_MAX_REDIRECTS,
  createStreamTestLimiter,
  testCustomStationStream,
};
