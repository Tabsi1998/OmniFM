// ============================================================
// OmniFM: "Stream testen" for a server's own station (#537)
// ============================================================
// A server admin checks a stream URL before saving it. The test takes the
// player's own way: safeFetch (SSRF check and DNS pinning on every hop, every
// redirect checked again) and the shared audio probe (#538: a few KB, a time
// limit, real audio detection). The answer is a result code and a few
// harmless facts; the dashboard words it in the reader's language. No
// address, resolved IP, query string or raw error text goes back.
//
// On top of the player's policy the test refuses ports of services that are
// no stream and the machine's own addresses, on every hop: an admin could
// otherwise use it to see whether something answers there (a blind GET with
// the status code as the answer).
import os from "node:os";
import ipaddr from "ipaddr.js";
import { parseEnvInt } from "./helpers.js";
import { log } from "./logging.js";
import { SafeOutboundError, normalizeOutboundIpAddress, requestPinnedTarget, safeFetch, validateOutboundUrl } from "./safe-outbound-http.js";
import { probeStreamAudio } from "./stream-audio-probe.js";

const STREAM_TEST_MAX_REDIRECTS = 3;
const STREAM_TEST_TIMEOUT_MS = 8_000;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
// A blocked port or host answers like a private address: no answer of its own.
const PRIVATE_TARGET_CODES = new Set(["OUTBOUND_ADDRESS_NOT_ALLOWED", "OUTBOUND_HOST_NOT_ALLOWED", "STREAM_TEST_PORT_BLOCKED", "STREAM_TEST_HOST_BLOCKED"]);
// SSH, Telnet, mail, SMB, Docker, databases, search and caches.
const SERVICE_PORTS = [22, 23, 25, 110, 143, 445, 2375, 2376, 3306, 5432, 6379, 9200, 9300, 11211, 27017, 27018];
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

const warned = new Set();
/** A mistake in the settings goes to the log once, not with every test. */
function warnOnce(message) {
  if (warned.has(message)) return;
  warned.add(message);
  log("WARN", message);
}

// Entries are separated by commas, spaces or both.
const splitList = (raw) => String(raw || "").split(/[\s,]+/).filter(Boolean);
const HOST_NAME = /^[a-z0-9_-]+(\.[a-z0-9_-]+)*$/;
const validPort = (entry) => /^\d{1,5}$/.test(entry) && Number(entry) >= 1 && Number(entry) <= 65_535;

function validHost(entry) {
  if (entry.includes("/")) {
    try {
      ipaddr.parseCIDR(entry);
      return true;
    } catch {
      return false;
    }
  }
  if (normalizeOutboundIpAddress(entry)) return true;
  // Digits and dots that are no address are a mistyped IP, not a name.
  return !/^[\d.]+$/.test(entry) && HOST_NAME.test(entry);
}

/**
 * What a stream test never connects to. CUSTOM_STATION_TEST_BLOCKED_PORTS
 * replaces the port list (default: SERVICE_PORTS; OmniFM's own API ports
 * stay open, 8000 and 8080 are common Icecast ports, and the own host is
 * covered below); CUSTOM_STATION_TEST_BLOCKED_HOSTS adds host names (their
 * subdomains too), IP addresses and CIDR ranges. The machine's own interface
 * addresses are always blocked. A broken entry is left out with a warning;
 * a port list without one valid port falls back to the default, so a typo
 * never opens everything.
 * @returns {{ ports: Set<number>, hosts: string[], ownAddresses: string[] }}
 */
function streamTestBlocklist(env = process.env, interfaces = os.networkInterfaces(), warn = warnOnce) {
  const portEntries = splitList(env.CUSTOM_STATION_TEST_BLOCKED_PORTS);
  const ports = portEntries.filter(validPort).map(Number);
  const badPorts = portEntries.filter((entry) => !validPort(entry));
  if (badPorts.length) warn(`[custom-station-test] CUSTOM_STATION_TEST_BLOCKED_PORTS: ungültige Einträge ignoriert: ${badPorts.join(", ")}`);
  if (portEntries.length && !ports.length) warn("[custom-station-test] CUSTOM_STATION_TEST_BLOCKED_PORTS enthält keinen gültigen Port, es gilt die Standardliste.");
  const hostEntries = splitList(env.CUSTOM_STATION_TEST_BLOCKED_HOSTS).map((entry) => entry.toLowerCase().replace(/\.$/, ""));
  const badHosts = hostEntries.filter((entry) => !validHost(entry));
  if (badHosts.length) warn(`[custom-station-test] CUSTOM_STATION_TEST_BLOCKED_HOSTS: ungültige Einträge ignoriert: ${badHosts.join(", ")}`);
  return {
    ports: new Set(ports.length ? ports : SERVICE_PORTS),
    hosts: hostEntries.filter(validHost),
    ownAddresses: Object.values(interfaces || {}).flat().map((entry) => normalizeOutboundIpAddress(entry?.address)).filter(Boolean),
  };
}

function inRange(address, cidr) {
  try {
    const [range, bits] = ipaddr.parseCIDR(cidr);
    const parsed = ipaddr.parse(address);
    return parsed.kind() === range.kind() && parsed.match(range, bits);
  } catch {
    return false;
  }
}

/** The error code when this hop (its pinned address included) is off limits, else null. */
function blockedHop(target, blocklist) {
  const port = Number(target.url.port) || (target.url.protocol === "https:" ? 443 : 80);
  if (blocklist.ports.has(port)) return "STREAM_TEST_PORT_BLOCKED";
  const address = normalizeOutboundIpAddress(target.address);
  const hostname = String(target.hostname || "").toLowerCase();
  if (address && blocklist.ownAddresses.includes(address)) return "STREAM_TEST_HOST_BLOCKED";
  const hit = blocklist.hosts.some((entry) => {
    if (entry.includes("/")) return Boolean(address) && inRange(address, entry);
    const ip = normalizeOutboundIpAddress(entry);
    return ip ? ip === address : hostname === entry || hostname.endsWith(`.${entry}`);
  });
  return hit ? "STREAM_TEST_HOST_BLOCKED" : null;
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
 * @param {{ timeoutMs?: number, requestImpl?: Function, lookupFn?: Function,
 *   blocklist?: ReturnType<typeof streamTestBlocklist> }} [options]
 *   requestImpl and lookupFn reach safeFetch unchanged (tests: no network).
 * @returns {Promise<{ ok: boolean, result: StreamTestResult, httpStatus: number | null,
 *   format: string | null, bitrateKbps: number | null, redirects: number, responseTimeMs: number,
 *   host: string | null, detail: string | null }>}
 *   host and detail are for the server's log only (the host without path or
 *   query, the error code); the route does not send them.
 */
async function testCustomStationStream(rawUrl, {
  timeoutMs = STREAM_TEST_TIMEOUT_MS, requestImpl = requestPinnedTarget, lookupFn, blocklist = streamTestBlocklist(),
} = {}) {
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
  // Every hop, the first one and each redirect, after safeFetch pinned its address.
  const guardedRequest = async (target, options) => {
    const blocked = blockedHop(target, blocklist);
    if (blocked) throw new SafeOutboundError(blocked, "Ziel ist für den Stream-Test gesperrt.");
    const incoming = await requestImpl(target, options);
    if (REDIRECT_STATUS_CODES.has(Number(incoming?.statusCode))) redirects += 1;
    return incoming;
  };
  const fetchImpl = async (url, options) => {
    try {
      return await safeFetch(url, { ...options, maxRedirects: STREAM_TEST_MAX_REDIRECTS, requestImpl: guardedRequest, ...(lookupFn ? { lookupFn } : {}) });
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
function createStreamTestLimiter({
  max = parseEnvInt("CUSTOM_STATION_TEST_RATE_MAX", 6, 1, 1_000),
  windowMs = parseEnvInt("CUSTOM_STATION_TEST_RATE_WINDOW_MS", 60_000, 1_000, 60 * 60_000),
  now = Date.now,
} = {}) {
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
  streamTestBlocklist,
  testCustomStationStream,
};
