import http from "node:http";
import https from "node:https";
import net from "node:net";
import { lookup as dnsLookup } from "node:dns/promises";
import { Readable } from "node:stream";
import ipaddr from "ipaddr.js";

const DEFAULT_ALLOWED_PROTOCOLS = Object.freeze(["http:", "https:"]);
const DEFAULT_MAX_URL_LENGTH = 2_048;
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_REDIRECTS = 3;
const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);
const BODYLESS_RESPONSE_STATUS_CODES = new Set([204, 205, 304]);
const PRIVATE_HOST_SUFFIXES = Object.freeze([".local", ".internal", ".lan", ".home", ".nip.io", ".sslip.io"]);
const SENSITIVE_REDIRECT_HEADER_NAMES = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "cookie2",
  "host",
  "x-api-key",
  "x-auth-token",
  "x-access-token",
]);

class SafeOutboundError extends Error {
  constructor(code, message, cause = null) {
    super(message, cause ? { cause } : undefined);
    this.name = "SafeOutboundError";
    this.code = code;
  }
}

function normalizeOutboundIpAddress(rawValue) {
  let value = String(rawValue || "").trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1);
  }
  if (!value || !ipaddr.isValid(value)) return "";

  let parsed = ipaddr.parse(value);
  if (typeof parsed.isIPv4MappedAddress === "function" && parsed.isIPv4MappedAddress()) {
    parsed = parsed.toIPv4Address();
  }
  return parsed.toString();
}

function isPublicOutboundAddress(rawValue) {
  const normalized = normalizeOutboundIpAddress(rawValue);
  if (!normalized) return false;
  return ipaddr.parse(normalized).range() === "unicast";
}

function normalizeHostname(rawValue) {
  let hostname = String(rawValue || "").trim().toLowerCase();
  if (hostname.startsWith("[") && hostname.endsWith("]")) {
    hostname = hostname.slice(1, -1);
  }
  return hostname.replace(/\.$/, "");
}

function normalizeAllowedProtocols(rawProtocols) {
  const source = Array.isArray(rawProtocols) ? rawProtocols : DEFAULT_ALLOWED_PROTOCOLS;
  return new Set(source.map((value) => String(value || "").trim().toLowerCase()).filter(Boolean));
}

function createSafeOutboundError(code, message, cause = null) {
  return new SafeOutboundError(code, message, cause);
}

function validateOutboundUrl(rawUrl, {
  allowedProtocols = DEFAULT_ALLOWED_PROTOCOLS,
  requireHttps = false,
  maxUrlLength = DEFAULT_MAX_URL_LENGTH,
} = {}) {
  const raw = String(rawUrl || "").trim();
  const maxLength = Math.max(1, Number.parseInt(String(maxUrlLength), 10) || DEFAULT_MAX_URL_LENGTH);
  if (!raw) {
    return { ok: false, error: "URL-Format ungültig.", code: "OUTBOUND_URL_INVALID" };
  }
  if (raw.length > maxLength) {
    return { ok: false, error: "URL ist zu lang.", code: "OUTBOUND_URL_TOO_LONG" };
  }

  let parsed;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: "URL-Format ungültig.", code: "OUTBOUND_URL_INVALID" };
  }

  const protocols = normalizeAllowedProtocols(allowedProtocols);
  if (requireHttps && parsed.protocol.toLowerCase() !== "https:") {
    return { ok: false, error: "URL muss HTTPS verwenden.", code: "OUTBOUND_HTTPS_REQUIRED" };
  }
  if (!protocols.has(parsed.protocol.toLowerCase())) {
    return { ok: false, error: "URL muss http:// oder https:// verwenden.", code: "OUTBOUND_PROTOCOL_NOT_ALLOWED" };
  }
  if (parsed.username || parsed.password) {
    return { ok: false, error: "URLs mit Benutzername/Passwort sind nicht erlaubt.", code: "OUTBOUND_CREDENTIALS_NOT_ALLOWED" };
  }

  const hostname = normalizeHostname(parsed.hostname);
  if (!hostname) {
    return { ok: false, error: "URL-Host fehlt.", code: "OUTBOUND_HOST_INVALID" };
  }
  const address = normalizeOutboundIpAddress(hostname);
  if (address) {
    if (!isPublicOutboundAddress(address)) {
      return { ok: false, error: "Lokale/private Hosts sind nicht erlaubt.", code: "OUTBOUND_ADDRESS_NOT_ALLOWED" };
    }
  } else {
    if (!hostname.includes(".")) {
      return { ok: false, error: "Lokale/private Hosts sind nicht erlaubt.", code: "OUTBOUND_HOST_NOT_ALLOWED" };
    }
    if (hostname === "localhost" || PRIVATE_HOST_SUFFIXES.some((suffix) => hostname.endsWith(suffix))) {
      return { ok: false, error: "Lokale/private Hosts sind nicht erlaubt.", code: "OUTBOUND_HOST_NOT_ALLOWED" };
    }
  }

  parsed.hash = "";
  return { ok: true, url: parsed.toString(), parsedUrl: parsed };
}

function isRetryableDnsLookupError(error) {
  const code = String(error?.code || "").trim().toUpperCase();
  if (["EAI_AGAIN", "ETIMEDOUT", "ETIME", "ESERVFAIL", "EREFUSED"].includes(code)) return true;
  const message = String(error?.message || error || "").toLowerCase();
  return message.includes("temporary failure")
    || message.includes("try again")
    || message.includes("timed out")
    || message.includes("timeout")
    || message.includes("servfail")
    || message.includes("refused");
}

function waitForDnsRetry(delayMs) {
  const delay = Math.max(0, Number(delayMs) || 0);
  if (delay <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, delay));
}

async function resolveHostnameForOutboundRequest(hostname, {
  resolver = dnsLookup,
  lookupFn,
  retryCount = 2,
  retryDelayMs = 250,
} = {}) {
  const activeResolver = typeof lookupFn === "function"
    ? lookupFn
    : (typeof resolver === "function" ? resolver : dnsLookup);
  const attempts = Math.max(1, Math.min(6, Number.parseInt(String(retryCount), 10) || 1));
  let lastError = null;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const records = await activeResolver(hostname, { all: true, verbatim: true });
      const addresses = (Array.isArray(records) ? records : [])
        .map((entry) => {
          const address = normalizeOutboundIpAddress(entry?.address);
          return address ? { address, family: net.isIP(address) } : null;
        })
        .filter(Boolean);
      if (addresses.length > 0) return addresses;
      lastError = createSafeOutboundError("OUTBOUND_DNS_EMPTY", "Host konnte nicht aufgelöst werden.");
    } catch (error) {
      lastError = error;
    }

    if (attempt < attempts && isRetryableDnsLookupError(lastError)) {
      await waitForDnsRetry(retryDelayMs);
    } else {
      break;
    }
  }

  throw createSafeOutboundError("OUTBOUND_DNS_LOOKUP_FAILED", "Host konnte nicht aufgelöst werden.", lastError);
}

async function resolveSafeOutboundTarget(rawUrl, options = {}) {
  const validation = validateOutboundUrl(rawUrl, options);
  if (!validation.ok) {
    throw createSafeOutboundError(validation.code, validation.error);
  }

  const hostname = normalizeHostname(validation.parsedUrl.hostname);
  const literalAddress = normalizeOutboundIpAddress(hostname);
  const addresses = literalAddress
    ? [{ address: literalAddress, family: net.isIP(literalAddress) }]
    : await resolveHostnameForOutboundRequest(hostname, options);

  if (!addresses.length || addresses.some((entry) => !isPublicOutboundAddress(entry.address))) {
    throw createSafeOutboundError("OUTBOUND_ADDRESS_NOT_ALLOWED", "Lokale/private Hosts sind nicht erlaubt.");
  }

  // Pin one verified address for this individual connection. Do not cache it
  // across requests: every real egress gets a fresh policy check and can never
  // fall back to stale DNS data after a failed lookup.
  return {
    url: validation.parsedUrl,
    hostname,
    address: addresses[0].address,
    family: addresses[0].family,
  };
}

async function validateOutboundUrlWithDns(rawUrl, options = {}) {
  try {
    const target = await resolveSafeOutboundTarget(rawUrl, options);
    return { ok: true, url: target.url.toString() };
  } catch (error) {
    return {
      ok: false,
      error: error instanceof SafeOutboundError ? error.message : "Host konnte nicht aufgelöst werden.",
    };
  }
}

function createAbortError() {
  const error = new Error("Outbound request aborted");
  error.name = "AbortError";
  return error;
}

function serializeRequestBody(rawBody) {
  if (rawBody == null) return null;
  if (rawBody instanceof URLSearchParams) return rawBody.toString();
  if (typeof rawBody === "string" || Buffer.isBuffer(rawBody) || rawBody instanceof Uint8Array) return rawBody;
  throw createSafeOutboundError("OUTBOUND_BODY_UNSUPPORTED", "Nicht unterstützter ausgehender Request-Body.");
}

function toSafeOutboundTransportError(error) {
  if (error instanceof SafeOutboundError || error?.name === "AbortError") return error;
  return createSafeOutboundError(
    "OUTBOUND_REQUEST_FAILED",
    "Ziel-URL konnte nicht erreicht werden.",
    error
  );
}

function requestPinnedTarget(target, {
  method = "GET",
  headers = {},
  body = null,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
} = {}) {
  const requestBody = serializeRequestBody(body);
  const isHttps = target.url.protocol === "https:";
  const transport = isHttps ? https : http;
  const hostnameIsIp = net.isIP(target.hostname) !== 0;

  return new Promise((resolve, reject) => {
    let settled = false;
    let response = null;
    let removeAbortListener = () => {};

    const fail = (rawError) => {
      const error = toSafeOutboundTransportError(rawError);
      if (settled) {
        response?.destroy?.(error);
        return;
      }
      settled = true;
      removeAbortListener();
      reject(error);
    };

    const request = transport.request({
      protocol: target.url.protocol,
      hostname: target.hostname,
      port: target.url.port || undefined,
      path: `${target.url.pathname}${target.url.search}`,
      method: String(method || "GET").toUpperCase(),
      headers,
      agent: false,
      family: target.family,
      servername: isHttps && !hostnameIsIp ? target.hostname : undefined,
      lookup: (_hostname, _options, callback) => callback(null, target.address, target.family),
    }, (incoming) => {
      response = incoming;
      if (settled) {
        incoming.resume?.();
        return;
      }
      settled = true;
      incoming.once("close", () => removeAbortListener());
      resolve(incoming);
    });

    const normalizedTimeoutMs = Math.max(1_000, Number.parseInt(String(timeoutMs), 10) || DEFAULT_TIMEOUT_MS);
    request.setTimeout(normalizedTimeoutMs, () => {
      request.destroy(createSafeOutboundError("OUTBOUND_TIMEOUT", "Ausgehende Anfrage hat das Zeitlimit überschritten."));
    });
    request.once("error", fail);

    if (signal) {
      const abortRequest = () => request.destroy(createAbortError());
      if (signal.aborted) {
        abortRequest();
      } else {
        signal.addEventListener("abort", abortRequest, { once: true });
        removeAbortListener = () => signal.removeEventListener("abort", abortRequest);
      }
    }

    try {
      request.end(requestBody);
    } catch (error) {
      request.destroy(error);
    }
  });
}

function createResponseFromIncoming(incoming) {
  const status = Number(incoming?.statusCode || 502) || 502;
  const body = BODYLESS_RESPONSE_STATUS_CODES.has(status)
    ? (incoming.resume?.(), null)
    : Readable.toWeb(incoming);
  return new Response(body, {
    status,
    statusText: String(incoming?.statusMessage || ""),
    headers: incoming?.headers || {},
  });
}

function drainIncomingResponse(incoming) {
  try {
    incoming?.resume?.();
  } catch {
    incoming?.destroy?.();
  }
}

function stripSensitiveRedirectHeaders(headers) {
  const next = {};
  for (const [name, value] of Object.entries(headers || {})) {
    if (!SENSITIVE_REDIRECT_HEADER_NAMES.has(String(name).toLowerCase())) {
      next[name] = value;
    }
  }
  return next;
}

async function safeFetch(rawUrl, {
  method = "GET",
  headers = {},
  body = null,
  signal,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  redirect = "follow",
  maxRedirects = DEFAULT_MAX_REDIRECTS,
  requestImpl = requestPinnedTarget,
  ...policyOptions
} = {}) {
  const normalizedMethod = String(method || "GET").toUpperCase();
  const parsedRedirectLimit = Number.parseInt(String(maxRedirects), 10);
  const redirectLimit = Number.isFinite(parsedRedirectLimit)
    ? Math.max(0, Math.min(5, parsedRedirectLimit))
    : DEFAULT_MAX_REDIRECTS;
  let currentUrl = String(rawUrl || "").trim();
  let requestHeaders = headers;

  for (let redirectCount = 0; ; redirectCount += 1) {
    const target = await resolveSafeOutboundTarget(currentUrl, policyOptions);
    let incoming;
    try {
      incoming = await requestImpl(target, {
        method: normalizedMethod,
        headers: requestHeaders,
        body,
        signal,
        timeoutMs,
      });
    } catch (error) {
      throw toSafeOutboundTransportError(error);
    }
    const status = Number(incoming?.statusCode || 0);
    const location = String(incoming?.headers?.location || "").trim();

    if (!REDIRECT_STATUS_CODES.has(status)) {
      return createResponseFromIncoming(incoming);
    }

    if (redirect === "manual") {
      return createResponseFromIncoming(incoming);
    }

    drainIncomingResponse(incoming);
    if (redirect !== "follow") {
      throw createSafeOutboundError("OUTBOUND_REDIRECT_NOT_ALLOWED", "Weiterleitung zu einem nicht erlaubten Ziel.");
    }
    if (!location || redirectCount >= redirectLimit) {
      throw createSafeOutboundError("OUTBOUND_REDIRECT_NOT_ALLOWED", "Weiterleitung zu einem nicht erlaubten Ziel.");
    }
    if (normalizedMethod !== "GET" && normalizedMethod !== "HEAD") {
      throw createSafeOutboundError("OUTBOUND_REDIRECT_NOT_ALLOWED", "Weiterleitung zu einem nicht erlaubten Ziel.");
    }

    try {
      const nextUrl = new URL(location, target.url);
      if (nextUrl.origin !== target.url.origin) {
        requestHeaders = stripSensitiveRedirectHeaders(requestHeaders);
      }
      currentUrl = nextUrl.toString();
    } catch (error) {
      throw createSafeOutboundError("OUTBOUND_REDIRECT_INVALID", "Weiterleitung zu einem nicht erlaubten Ziel.", error);
    }
  }
}

export {
  SafeOutboundError,
  isPublicOutboundAddress,
  normalizeOutboundIpAddress,
  validateOutboundUrl,
  validateOutboundUrlWithDns,
  resolveSafeOutboundTarget,
  requestPinnedTarget,
  safeFetch,
};
