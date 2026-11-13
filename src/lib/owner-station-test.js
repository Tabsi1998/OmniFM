import { safeFetch } from "./safe-outbound-http.js";
import { probeStreamAudio } from "./stream-audio-probe.js";

const DEFAULT_TIMEOUT_MS = 8_000;

function normalizeStationTestUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    /** @type {import("./types.js").HttpError} */
    const error = new Error("Station hat keine Stream-URL.");
    error.statusCode = 400;
    throw error;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    /** @type {import("./types.js").HttpError} */
    const error = new Error("Station hat keine gültige Stream-URL.");
    error.statusCode = 400;
    throw error;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    /** @type {import("./types.js").HttpError} */
    const error = new Error("Station-Stream muss http:// oder https:// verwenden.");
    error.statusCode = 400;
    throw error;
  }
  if (parsed.username || parsed.password) {
    /** @type {import("./types.js").HttpError} */
    const error = new Error("Station-Stream darf keine Zugangsdaten in der URL enthalten.");
    error.statusCode = 400;
    throw error;
  }
  parsed.hash = "";
  return parsed.toString();
}

/**
 * Tests a station's stream with the shared GET audio probe (#538): ok only
 * when audio comes back. A page, a login wall (401) or a HEAD answer is not
 * a stream; reachable, authorized and playableAudio say which it was.
 */
async function testOwnerStationStream(station, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = safeFetch } = {}) {
  if (!station || typeof station !== "object") {
    /** @type {import("./types.js").HttpError} */
    const error = new Error("Station fehlt.");
    error.statusCode = 400;
    throw error;
  }
  if (typeof fetchImpl !== "function") {
    /** @type {import("./types.js").HttpError} */
    const error = new Error("Fetch ist in dieser Runtime nicht verfügbar.");
    error.statusCode = 500;
    throw error;
  }

  const key = String(station.key || "").trim();
  const name = String(station.name || key || "Station").trim();
  const url = normalizeStationTestUrl(station.url);
  const safeTimeoutMs = Math.max(1_000, Math.min(30_000, Number.parseInt(String(timeoutMs), 10) || DEFAULT_TIMEOUT_MS));
  const probe = await probeStreamAudio(url, {
    timeoutMs: safeTimeoutMs,
    userAgent: "OmniFM-OwnerStationTest/1.0",
    fetchImpl,
  });
  const ok = probe.playableAudio;
  return {
    ok,
    key,
    name,
    url,
    status: ok ? "up" : "down",
    method: "GET",
    httpStatus: probe.httpStatus,
    reachable: probe.reachable,
    authorized: probe.authorized,
    playableAudio: ok,
    format: probe.format,
    reasonCode: probe.reasonCode,
    responseTimeMs: probe.responseTimeMs,
    timeoutMs: safeTimeoutMs,
    error: probe.error,
    checkedAt: new Date().toISOString(),
  };
}

export {
  testOwnerStationStream,
};
