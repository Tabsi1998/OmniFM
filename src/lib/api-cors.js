// OmniFM: API helpers: allowed origins, CORS and trusted proxies.
// Split out of src/lib/api-helpers.js (#295).
import net from "node:net";
import { log } from "./logging.js";
import { TRUST_PROXY_HEADERS } from "./helpers.js";

// ---- CORS ----
export function toOrigin(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || "").trim());
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function parseCsvEnv(rawValue) {
  return String(rawValue || "")
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export function normalizeIpAddress(rawValue) {
  let value = String(rawValue || "").trim().toLowerCase();
  if (value.startsWith("[") && value.endsWith("]")) {
    value = value.slice(1, -1);
  }
  if (value.startsWith("::ffff:")) {
    const mappedIpv4 = value.slice("::ffff:".length);
    if (net.isIP(mappedIpv4) === 4) return mappedIpv4;
  }
  return net.isIP(value) ? value : "";
}

export function parseTrustedProxyIps(rawValue = process.env.TRUSTED_PROXY_IPS || "") {
  return new Set(
    parseCsvEnv(rawValue)
      .map((value) => normalizeIpAddress(value))
      .filter(Boolean)
  );
}

export const TRUSTED_PROXY_IPS = parseTrustedProxyIps();

function toTrustedProxyIpSet(rawValue) {
  if (rawValue instanceof Set) {
    return new Set([...rawValue].map((value) => normalizeIpAddress(value)).filter(Boolean));
  }
  return parseTrustedProxyIps(Array.isArray(rawValue) ? rawValue.join(",") : rawValue);
}

export function isTrustedProxyAddress(rawAddress, trustedProxyIps = TRUSTED_PROXY_IPS) {
  const address = normalizeIpAddress(rawAddress);
  if (!address) return false;

  const trusted = toTrustedProxyIpSet(trustedProxyIps);
  return trusted.has(address);
}

export function shouldTrustProxyHeaders(req, {
  enabled = TRUST_PROXY_HEADERS,
  trustedProxyIps = TRUSTED_PROXY_IPS,
} = {}) {
  if (!enabled) return false;
  return isTrustedProxyAddress(req?.socket?.remoteAddress, trustedProxyIps);
}

export function getTrustedForwardedProto(req, proxyOptions = undefined) {
  if (!shouldTrustProxyHeaders(req, proxyOptions)) return "";

  const rawHeader = req?.headers?.["x-forwarded-proto"];
  const values = (Array.isArray(rawHeader) ? rawHeader : [rawHeader])
    .flatMap((value) => String(value || "").split(","))
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  const nearestProtocol = values.at(-1);
  return nearestProtocol === "https" || nearestProtocol === "http" ? nearestProtocol : "";
}

function buildWebDomainOriginCandidates() {
  const rawDomain = String(process.env.WEB_DOMAIN || "").trim();
  if (!rawDomain) return [];

  let host = rawDomain.replace(/^https?:\/\//i, "").trim();
  host = host.replace(/\/.*$/, "").trim();
  if (!host || /[\s/\\]/.test(host)) return [];

  let hostOnly = host;
  let portPart = "";
  const lastColon = host.lastIndexOf(":");
  if (lastColon > 0 && /^\d+$/.test(host.slice(lastColon + 1))) {
    hostOnly = host.slice(0, lastColon);
    portPart = `:${host.slice(lastColon + 1)}`;
  }

  const candidates = [`https://${host}`];
  if (/^www\./i.test(hostOnly)) {
    candidates.push(`https://${hostOnly.replace(/^www\./i, "")}${portPart}`);
  } else if (hostOnly.includes(".")) {
    candidates.push(`https://www.${hostOnly}${portPart}`);
  }

  const unique = [];
  const seen = new Set();
  for (const candidate of candidates) {
    const origin = toOrigin(candidate);
    if (!origin || seen.has(origin)) continue;
    seen.add(origin);
    unique.push(origin);
  }
  return unique;
}

export function getConfiguredPublicOrigin(publicUrl) {
  const explicit = toOrigin(publicUrl);
  if (explicit) return explicit;
  const domainOrigins = buildWebDomainOriginCandidates();
  return domainOrigins[0] || "http://localhost";
}

function isLocalDevelopmentOrigin(rawOrigin) {
  const origin = toOrigin(rawOrigin);
  if (!origin) return false;
  try {
    const parsed = new URL(origin);
    const hostname = String(parsed.hostname || "").trim().toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1";
  } catch {
    return false;
  }
}

function shouldIncludeDefaultLocalOrigins(publicUrl, configuredOrigins = []) {
  const candidates = [
    ...configuredOrigins,
    publicUrl,
    ...buildWebDomainOriginCandidates(),
  ];
  const hasExplicitNonLocalOrigin = candidates
    .map((candidate) => toOrigin(candidate))
    .filter(Boolean)
    .some((origin) => !isLocalDevelopmentOrigin(origin));
  return !hasExplicitNonLocalOrigin;
}

function buildAllowedFrontendOrigins(publicUrl) {
  const configured = parseCsvEnv(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || "");
  const candidates = [
    ...configured,
    publicUrl,
    ...buildWebDomainOriginCandidates(),
  ];

  if (shouldIncludeDefaultLocalOrigins(publicUrl, configured)) {
    candidates.push(
      "http://localhost",
      "http://127.0.0.1",
      "http://localhost:3000",
      "http://127.0.0.1:3000"
    );
  }

  const allowed = new Set();
  for (const candidate of candidates) {
    const origin = toOrigin(candidate);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

function buildAllowedReturnOrigins(publicUrl, _req) {
  const configured = [
    ...parseCsvEnv(process.env.CHECKOUT_RETURN_ORIGINS || ""),
    ...parseCsvEnv(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || ""),
  ];

  const candidates = [
    ...configured,
    publicUrl,
    ...buildWebDomainOriginCandidates(),
  ];

  if (shouldIncludeDefaultLocalOrigins(publicUrl, configured)) {
    candidates.push(
      "http://localhost",
      "http://127.0.0.1"
    );
  }

  const allowed = new Set();
  for (const candidate of candidates) {
    const origin = toOrigin(candidate);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

export function resolveCheckoutReturnBase(returnUrl, publicUrl, req) {
  const fallback = getConfiguredPublicOrigin(publicUrl);
  if (!returnUrl) return fallback;

  let parsed;
  try {
    parsed = new URL(String(returnUrl).trim());
  } catch {
    return fallback;
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return fallback;

  const allowed = buildAllowedReturnOrigins(publicUrl, req);
  if (!allowed.has(parsed.origin)) {
    log("INFO", `Checkout returnUrl verworfen (nicht erlaubt): ${parsed.origin}`);
    return fallback;
  }

  const safePath = parsed.pathname && parsed.pathname !== "/" ? parsed.pathname : "";
  return `${parsed.origin}${safePath}`;
}

export function buildAllowedApiOrigins(publicUrl) {
  const configured = parseCsvEnv(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || "");
  // Credentialed API CORS must be entirely operator-configured. Do not infer
  // aliases or development origins from WEB_DOMAIN, Host, or the runtime.
  const candidates = [...configured, publicUrl];

  const allowed = new Set();
  for (const candidate of candidates) {
    const origin = toOrigin(candidate);
    if (origin) allowed.add(origin);
  }
  return allowed;
}

export function isAllowedFrontendOrigin(rawOrigin, publicUrl) {
  const origin = toOrigin(rawOrigin);
  if (!origin) return false;
  return buildAllowedFrontendOrigins(publicUrl).has(origin);
}
