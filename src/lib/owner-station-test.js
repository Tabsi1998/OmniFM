const DEFAULT_TIMEOUT_MS = 8_000;
const HEAD_FALLBACK_STATUS_CODES = new Set([403, 405, 501]);

function normalizeStationTestUrl(rawUrl) {
  const value = String(rawUrl || "").trim();
  if (!value) {
    const error = new Error("Station hat keine Stream-URL.");
    error.statusCode = 400;
    throw error;
  }
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    const error = new Error("Station hat keine gueltige Stream-URL.");
    error.statusCode = 400;
    throw error;
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    const error = new Error("Station-Stream muss http:// oder https:// verwenden.");
    error.statusCode = 400;
    throw error;
  }
  if (parsed.username || parsed.password) {
    const error = new Error("Station-Stream darf keine Zugangsdaten in der URL enthalten.");
    error.statusCode = 400;
    throw error;
  }
  parsed.hash = "";
  return parsed.toString();
}

function buildFailureResult(station, { url, startedAtMs, method, error, timeoutMs }) {
  const isTimeout = error?.name === "AbortError" || String(error?.message || "").toLowerCase().includes("abort");
  return {
    ok: false,
    key: station.key,
    name: station.name,
    url,
    status: "down",
    method,
    httpStatus: null,
    responseTimeMs: Date.now() - startedAtMs,
    timeoutMs,
    error: isTimeout ? `Timeout nach ${timeoutMs}ms` : (error?.message || String(error)),
    checkedAt: new Date().toISOString(),
  };
}

async function testOwnerStationStream(station, { timeoutMs = DEFAULT_TIMEOUT_MS, fetchImpl = globalThis.fetch } = {}) {
  if (!station || typeof station !== "object") {
    const error = new Error("Station fehlt.");
    error.statusCode = 400;
    throw error;
  }
  if (typeof fetchImpl !== "function") {
    const error = new Error("Fetch ist in dieser Runtime nicht verfuegbar.");
    error.statusCode = 500;
    throw error;
  }

  const key = String(station.key || "").trim();
  const name = String(station.name || key || "Station").trim();
  const url = normalizeStationTestUrl(station.url);
  const safeTimeoutMs = Math.max(1_000, Math.min(30_000, Number.parseInt(String(timeoutMs), 10) || DEFAULT_TIMEOUT_MS));
  const startedAtMs = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), safeTimeoutMs);
  let method = "HEAD";

  try {
    let response;
    try {
      response = await fetchImpl(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers: { "User-Agent": "OmniFM-OwnerStationTest/1.0" },
      });
      if (HEAD_FALLBACK_STATUS_CODES.has(Number(response?.status || 0))) {
        method = "GET";
        response = await fetchImpl(url, {
          method,
          redirect: "follow",
          signal: controller.signal,
          headers: {
            "User-Agent": "OmniFM-OwnerStationTest/1.0",
            "Range": "bytes=0-0",
          },
        });
      }
    } catch (headError) {
      if (controller.signal.aborted) throw headError;
      method = "GET";
      response = await fetchImpl(url, {
        method,
        redirect: "follow",
        signal: controller.signal,
        headers: {
          "User-Agent": "OmniFM-OwnerStationTest/1.0",
          "Range": "bytes=0-0",
        },
      });
    }

    const httpStatus = Number(response?.status || 0) || null;
    const ok = httpStatus != null && (httpStatus < 400 || httpStatus === 401);
    return {
      ok,
      key,
      name,
      url,
      status: ok ? "up" : "down",
      method,
      httpStatus,
      responseTimeMs: Date.now() - startedAtMs,
      timeoutMs: safeTimeoutMs,
      error: ok ? null : `HTTP ${httpStatus || "unbekannt"}`,
      checkedAt: new Date().toISOString(),
    };
  } catch (error) {
    return buildFailureResult({ key, name }, { url, startedAtMs, method, error, timeoutMs: safeTimeoutMs });
  } finally {
    clearTimeout(timer);
  }
}

export {
  testOwnerStationStream,
};
