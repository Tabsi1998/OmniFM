// OmniFM: API helpers: the client IP and rate limits per path.
// Split out of src/lib/api-helpers.js (#295).
import { parseEnvInt } from "./helpers.js";
import {
  TRUSTED_PROXY_IPS,
  isTrustedProxyAddress,
  normalizeIpAddress,
  shouldTrustProxyHeaders,
} from "./api-cors.js";
import { sendJson } from "./api-helpers.js";

// ---- Rate limiting ----
const apiRateLimitState = new Map();
const MAX_API_RATE_STATE_ENTRIES = Math.max(
  1_000,
  Number.parseInt(String(process.env.API_RATE_STATE_MAX_ENTRIES || "50000"), 10) || 50_000
);

function getForwardedClientIp(rawHeader, trustedProxyIps) {
  const rawValues = Array.isArray(rawHeader) ? rawHeader : [rawHeader];
  const chain = rawValues
    .flatMap((value) => String(value || "").split(","))
    .map((value) => normalizeIpAddress(value))
    .filter(Boolean);

  // Standard reverse proxies append their immediate peer to X-Forwarded-For.
  // Working backwards prevents an attacker-controlled value at the beginning
  // of the chain from becoming the rate-limit identity.
  for (let index = chain.length - 1; index >= 0; index -= 1) {
    if (!isTrustedProxyAddress(chain[index], trustedProxyIps)) return chain[index];
  }
  return "";
}

export function getClientIp(req, proxyOptions = undefined) {
  const peerIp = normalizeIpAddress(req?.socket?.remoteAddress);
  if (!shouldTrustProxyHeaders(req, proxyOptions)) {
    return peerIp || req?.socket?.remoteAddress || "unknown";
  }

  const trustedProxyIps = proxyOptions?.trustedProxyIps ?? TRUSTED_PROXY_IPS;
  const forwarded = getForwardedClientIp(req?.headers?.["x-forwarded-for"], trustedProxyIps);
  return forwarded || peerIp || req?.socket?.remoteAddress || "unknown";
}

function getApiRateLimitSpec(pathname) {
  if (
    pathname === "/api/premium/webhook"
    || pathname === "/api/discordbotlist/vote"
    || pathname === "/api/topgg/webhook"
  ) {
    return {
      scope: "webhook",
      max: parseEnvInt("API_RATE_LIMIT_WEBHOOK_MAX", 60, 1, 10_000),
      windowMs: parseEnvInt("API_RATE_LIMIT_WEBHOOK_WINDOW_MS", 60_000, 1_000, 10 * 60_000),
    };
  }
  // The owner console loads many owner routes at once (#288); its own bucket
  // keeps it from running into the public limit.
  if (pathname.startsWith("/api/admin/") || pathname.startsWith("/api/owner/")) {
    return {
      scope: "owner",
      max: parseEnvInt("API_RATE_LIMIT_OWNER_MAX", 600, 1, 10_000),
      windowMs: parseEnvInt("API_RATE_LIMIT_OWNER_WINDOW_MS", 60_000, 1_000, 10 * 60_000),
    };
  }
  if (pathname.startsWith("/api/premium/")) {
    return {
      scope: "premium",
      max: parseEnvInt("API_RATE_LIMIT_PREMIUM_MAX", 12, 1, 1_000),
      windowMs: parseEnvInt("API_RATE_LIMIT_PREMIUM_WINDOW_MS", 60_000, 1_000, 10 * 60_000),
    };
  }
  return {
    scope: "general",
    max: parseEnvInt("API_RATE_LIMIT_MAX", 60, 1, 10_000),
    windowMs: parseEnvInt("API_RATE_LIMIT_WINDOW_MS", 60_000, 1_000, 10 * 60_000),
  };
}

function cleanupRateLimitState(now = Date.now()) {
  if (apiRateLimitState.size < MAX_API_RATE_STATE_ENTRIES) return;
  const keysToDelete = [];
  for (const [key, entry] of apiRateLimitState.entries()) {
    if (now - entry.windowStart > entry.windowMs * 2) {
      keysToDelete.push(key);
    }
  }
  for (const key of keysToDelete) {
    apiRateLimitState.delete(key);
  }
  if (apiRateLimitState.size >= MAX_API_RATE_STATE_ENTRIES) {
    const oldest = [...apiRateLimitState.entries()].sort((a, b) => a[1].windowStart - b[1].windowStart);
    const removeCount = Math.ceil(apiRateLimitState.size * 0.2);
    for (let i = 0; i < removeCount && i < oldest.length; i++) {
      apiRateLimitState.delete(oldest[i][0]);
    }
  }
}

export function enforceApiRateLimit(req, res, pathname) {
  const spec = getApiRateLimitSpec(pathname);
  const ip = getClientIp(req);
  const key = `${spec.scope}:${ip}`;
  const now = Date.now();

  cleanupRateLimitState(now);

  let entry = apiRateLimitState.get(key);
  if (!entry || now - entry.windowStart > spec.windowMs) {
    entry = { count: 0, windowStart: now, windowMs: spec.windowMs };
    apiRateLimitState.set(key, entry);
  }

  entry.count += 1;
  if (entry.count > spec.max) {
    sendJson(res, 429, { error: "Too many requests. Please try again later." });
    return false;
  }
  return true;
}
