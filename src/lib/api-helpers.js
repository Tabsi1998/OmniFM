// ============================================================
// OmniFM: API / HTTP Helper Functions
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { log, webDir } from "./logging.js";
import {
  TIER_RANK,
  TRUST_PROXY_HEADERS,
  MIME_TYPES,
  normalizeSeats,
  clipText,
  parseEnvInt,
} from "./helpers.js";
import { buildCommandBuilders } from "../commands.js";
import { buildInviteUrl } from "../bot-config.js";

// ---- Security & HTTP ----
const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'none'"],
  "script-src": [
    "'self'",
    "'unsafe-inline'",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://js.stripe.com",
  ],
  "script-src-elem": [
    "'self'",
    "'unsafe-inline'",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://js.stripe.com",
  ],
  "style-src": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "style-src-elem": ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
  "font-src": ["'self'", "data:", "https://fonts.gstatic.com"],
  "img-src": ["'self'", "data:", "blob:", "https:"],
  "media-src": ["'self'", "data:", "blob:", "https:"],
  "connect-src": [
    "'self'",
    "https://www.googletagmanager.com",
    "https://www.google-analytics.com",
    "https://region1.google-analytics.com",
    "https://api.stripe.com",
  ],
  "frame-src": [
    "'self'",
    "https://checkout.stripe.com",
    "https://js.stripe.com",
    "https://hooks.stripe.com",
    "https://discord.com",
  ],
  "worker-src": ["'self'", "blob:"],
  "child-src": ["'self'", "blob:"],
  "manifest-src": ["'self'"],
  "form-action": ["'self'", "https://checkout.stripe.com", "https://discord.com"],
};

const PERMISSIONS_POLICY = [
  "accelerometer=()",
  "autoplay=(self)",
  "camera=()",
  "clipboard-read=()",
  "clipboard-write=(self)",
  "display-capture=()",
  "encrypted-media=()",
  "fullscreen=(self)",
  "geolocation=()",
  "gyroscope=()",
  "magnetometer=()",
  "microphone=()",
  "midi=()",
  "payment=()",
  "picture-in-picture=(self)",
  "publickey-credentials-get=()",
  "usb=()",
  "xr-spatial-tracking=()",
].join(", ");

function parseBooleanEnv(rawValue, fallback = false) {
  const value = String(rawValue ?? "").trim().toLowerCase();
  if (!value) return fallback;
  if (["1", "true", "yes", "on"].includes(value)) return true;
  if (["0", "false", "no", "off"].includes(value)) return false;
  return fallback;
}

function getSecurityPublicHostCandidate() {
  const publicUrl = String(process.env.PUBLIC_WEB_URL || "").trim();
  if (publicUrl) {
    try {
      const parsed = new URL(publicUrl);
      return { protocol: parsed.protocol, hostname: parsed.hostname };
    } catch {
      return null;
    }
  }

  const rawDomain = String(process.env.WEB_DOMAIN || "").trim();
  if (!rawDomain) return null;
  const host = rawDomain
    .replace(/^https?:\/\//i, "")
    .replace(/\/.*$/, "")
    .trim();
  if (!host || /[\s/\\]/.test(host)) return null;
  const hostWithoutPort = host.replace(/:\d+$/, "");
  return { protocol: "https:", hostname: hostWithoutPort };
}

function isLocalSecurityHostname(hostname) {
  const value = String(hostname || "").trim().toLowerCase();
  return value === "localhost"
    || value === "127.0.0.1"
    || value === "::1"
    || value.endsWith(".localhost");
}

function shouldSendStrictTransportSecurity() {
  const explicit = process.env.SECURITY_HSTS_ENABLED ?? process.env.HSTS_ENABLED;
  if (explicit !== undefined) {
    return parseBooleanEnv(explicit, false);
  }

  const publicHost = getSecurityPublicHostCandidate();
  if (!publicHost || publicHost.protocol !== "https:") return false;
  return !isLocalSecurityHostname(publicHost.hostname);
}

function buildContentSecurityPolicy() {
  return Object.entries(CSP_DIRECTIVES)
    .map(([directive, values]) => `${directive} ${values.join(" ")}`)
    .join("; ");
}

function buildPermissionsPolicy() {
  return PERMISSIONS_POLICY;
}

function buildStrictTransportSecurity() {
  const base = "max-age=31536000; includeSubDomains";
  return parseBooleanEnv(process.env.SECURITY_HSTS_PRELOAD || "", false)
    ? `${base}; preload`
    : base;
}

function getCommonSecurityHeaders() {
  const headers = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Content-Security-Policy": buildContentSecurityPolicy(),
    "Permissions-Policy": buildPermissionsPolicy(),
    "X-Permitted-Cross-Domain-Policies": "none",
  };

  if (shouldSendStrictTransportSecurity()) {
    headers["Strict-Transport-Security"] = buildStrictTransportSecurity();
  }

  return headers;
}

function sendJson(res, status, payload) {
  res.writeHead(status, {
    ...getCommonSecurityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  res.end(JSON.stringify(payload));
}

function methodNotAllowed(res, allowedMethods = ["GET"]) {
  const methods = Array.isArray(allowedMethods) && allowedMethods.length
    ? allowedMethods
    : ["GET"];
  res.setHeader("Allow", methods.join(", "));
  sendJson(res, 405, { error: `Method not allowed. Use: ${methods.join(", ")}` });
}

function streamStaticFile(res, resolved, { headOnly = false, statusCode = 200 } = {}) {
  let stat;
  try {
    stat = fs.statSync(resolved);
  } catch {
    res.writeHead(404, {
      ...getCommonSecurityHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end("Not found");
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404, {
      ...getCommonSecurityHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end("Not found");
    return;
  }

  const ext = path.extname(resolved).toLowerCase();
  const contentType = MIME_TYPES[ext] || "application/octet-stream";
  const cacheControl = ext === ".html" ? "no-cache" : "public, max-age=86400";

  res.writeHead(statusCode, {
    ...getCommonSecurityHeaders(),
    "Content-Type": contentType,
    "Cache-Control": cacheControl
  });
  if (headOnly) {
    res.end();
    return;
  }
  const stream = fs.createReadStream(resolved);
  stream.on("error", () => {
    if (!res.headersSent) {
      res.writeHead(500);
      res.end("Internal server error");
      return;
    }
    res.destroy();
  });
  stream.pipe(res);
}

function sendStaticFile(res, filePath, { headOnly = false, notFoundPath = "" } = {}) {
  const resolved = path.resolve(filePath);
  const resolvedWebDir = path.resolve(webDir);
  const relativePath = path.relative(resolvedWebDir, resolved);
  if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
    res.writeHead(403, {
      ...getCommonSecurityHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end("Forbidden");
    return;
  }

  if (!fs.existsSync(resolved)) {
    const resolvedNotFound = notFoundPath ? path.resolve(notFoundPath) : "";
    if (resolvedNotFound && fs.existsSync(resolvedNotFound)) {
      streamStaticFile(res, resolvedNotFound, { headOnly, statusCode: 404 });
      return;
    }
    res.writeHead(404, {
      ...getCommonSecurityHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end("Not found");
    return;
  }

  streamStaticFile(res, resolved, { headOnly });
}

// ---- CORS ----
function sanitizeHostHeader(rawHost) {
  const host = String(rawHost || "").trim();
  if (!host) return "";
  if (/[\s/\\]/.test(host)) return "";
  return host;
}

function getRequestOrigin(req) {
  const host = sanitizeHostHeader(req.headers.host);
  if (!host) return null;
  const forwardedProto = TRUST_PROXY_HEADERS
    ? String(req.headers["x-forwarded-proto"] || "").trim().toLowerCase().split(",")[0].trim()
    : "";
  const socketProto = req.socket?.encrypted ? "https" : "http";
  const proto = forwardedProto === "https" || forwardedProto === "http" ? forwardedProto : socketProto;
  return `${proto}://${host}`;
}

function toOrigin(rawUrl) {
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

function getConfiguredPublicOrigin(publicUrl) {
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

function buildAllowedReturnOrigins(publicUrl, req) {
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

function resolveCheckoutReturnBase(returnUrl, publicUrl, req) {
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

function buildAllowedApiOrigins(publicUrl, req) {
  const configured = parseCsvEnv(process.env.CORS_ALLOWED_ORIGINS || process.env.CORS_ORIGINS || "");

  const candidates = [
    ...configured,
    publicUrl,
    ...buildWebDomainOriginCandidates(),
    getRequestOrigin(req),
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

function isAllowedFrontendOrigin(rawOrigin, publicUrl) {
  const origin = toOrigin(rawOrigin);
  if (!origin) return false;
  return buildAllowedFrontendOrigins(publicUrl).has(origin);
}

function applyCors(req, res, publicUrl) {
  const originHeader = String(req.headers.origin || "").trim();
  const allowedOrigins = buildAllowedApiOrigins(publicUrl, req);
  const normalizedOrigin = toOrigin(originHeader);
  const hasOriginHeader = originHeader.length > 0;

  let originAllowed = !hasOriginHeader;
  if (hasOriginHeader && normalizedOrigin && allowedOrigins.has(normalizedOrigin)) {
    originAllowed = true;
    res.setHeader("Access-Control-Allow-Origin", normalizedOrigin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Credentials", "true");
  }

  res.setHeader("Access-Control-Allow-Methods", "GET, HEAD, POST, PUT, PATCH, DELETE, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Admin-Token, X-Admin-User, X-Session-Token, X-OmniFM-CSRF");
  return originAllowed;
}

// ---- Auth ----
function getAdminApiToken() {
  return String(process.env.API_ADMIN_TOKEN || process.env.ADMIN_API_TOKEN || "").trim();
}

function safeTokenEquals(rawLeft, rawRight) {
  const left = Buffer.from(String(rawLeft || ""), "utf8");
  const right = Buffer.from(String(rawRight || ""), "utf8");
  if (left.length === 0 || right.length === 0) return false;
  if (left.length !== right.length) return false;
  try {
    return timingSafeEqual(left, right);
  } catch {
    return false;
  }
}

function isAdminApiRequest(req) {
  const configuredToken = getAdminApiToken();
  if (!configuredToken) return false;

  const headerToken = String(req.headers["x-admin-token"] || "").trim();
  if (headerToken && safeTokenEquals(headerToken, configuredToken)) return true;

  const auth = String(req.headers.authorization || "").trim();
  if (/^Bearer\s+/i.test(auth)) {
    const bearer = auth.replace(/^Bearer\s+/i, "").trim();
    if (bearer && safeTokenEquals(bearer, configuredToken)) return true;
  }

  return false;
}

// ---- License sanitization ----
function sanitizeLicenseForApi(license, includeSensitive = false) {
  if (!license) return null;

  const safe = {
    tier: license.plan || "free",
    plan: license.plan || "free",
    seats: normalizeSeats(license.seats || 1),
    active: Boolean(license.active) && !Boolean(license.expired),
    expired: Boolean(license.expired),
    expiresAt: license.expiresAt || null,
    remainingDays: Number.isFinite(license.remainingDays) ? license.remainingDays : null,
  };

  if (includeSensitive) {
    safe.id = license.id || null;
    safe.linkedServerIds = Array.isArray(license.linkedServerIds) ? [...license.linkedServerIds] : [];
  }

  return safe;
}

// ---- Command API ----
const COMMAND_ARG_OPTION_TYPES = new Set([3, 4, 5, 6, 7, 8, 9, 10, 11]);
const COMMAND_MIN_TIER = {
  help: "free",
  play: "free",
  pause: "free",
  resume: "free",
  stop: "free",
  stations: "free",
  list: "free",
  setvolume: "free",
  status: "free",
  health: "free",
  diag: "free",
  premium: "free",
  language: "free",
  license: "free",
  invite: "free",
  workers: "free",
  now: "pro",
  history: "pro",
  event: "pro",
  perm: "pro",
  addstation: "ultimate",
  removestation: "ultimate",
  mystations: "ultimate",
};

function formatCommandArgToken(option) {
  const name = String(option?.name || "").trim();
  if (!name) return "";
  return option.required ? `<${name}>` : `[${name}]`;
}

function buildCommandArgsFromOptions(options) {
  if (!Array.isArray(options) || !options.length) return "";

  const subcommands = options.filter((opt) => opt?.type === 1 && opt?.name);
  if (subcommands.length) {
    const parts = subcommands.map((sub) => {
      const subArgs = buildCommandArgsFromOptions(sub.options);
      return subArgs ? `${sub.name} ${subArgs}` : sub.name;
    });
    return `<${parts.join(" | ")}>`;
  }

  const subcommandGroups = options.filter((opt) => opt?.type === 2 && opt?.name);
  if (subcommandGroups.length) {
    const parts = subcommandGroups.map((group) => {
      const nestedSubs = Array.isArray(group.options)
        ? group.options.filter((opt) => opt?.type === 1 && opt?.name)
        : [];
      if (!nestedSubs.length) return String(group.name);
      const nested = nestedSubs.map((sub) => {
        const subArgs = buildCommandArgsFromOptions(sub.options);
        return subArgs ? `${sub.name} ${subArgs}` : sub.name;
      });
      return `${group.name} ${nested.join(" | ")}`;
    });
    return `<${parts.join(" | ")}>`;
  }

  return options
    .filter((opt) => COMMAND_ARG_OPTION_TYPES.has(opt?.type))
    .map((opt) => formatCommandArgToken(opt))
    .filter(Boolean)
    .join(" ");
}

function buildApiCommands() {
  return buildCommandBuilders().map((builder) => {
    const json = builder.toJSON();
    const args = buildCommandArgsFromOptions(json.options);

    return {
      name: `/${json.name}`,
      args,
      description: json.description,
      tier: COMMAND_MIN_TIER[json.name] || "free",
    };
  });
}

const API_COMMANDS = buildApiCommands();

// ---- Bot access / Invite ----
function getBotAccessForTier(botConfig, tierConfig) {
  const serverTier = tierConfig?.tier || "free";
  const serverRank = TIER_RANK[serverTier] ?? 0;
  const maxBots = Number(tierConfig?.maxBots || 0);
  const botTier = botConfig.requiredTier || "free";
  const botRank = TIER_RANK[botTier] ?? 0;
  const botIndex = Number(botConfig.index || 0);
  const withinBotLimit = botIndex > 0 && botIndex <= maxBots;
  const hasTierAccess = serverRank >= botRank;

  return {
    hasTierAccess,
    withinBotLimit,
    hasAccess: hasTierAccess && withinBotLimit,
    reason: !hasTierAccess ? "tier" : !withinBotLimit ? "maxBots" : null,
  };
}

function resolveRuntimeClientId(runtimeOrConfig) {
  if (!runtimeOrConfig) return "";
  if (typeof runtimeOrConfig.getApplicationId === "function") {
    const runtimeId = String(runtimeOrConfig.getApplicationId() || "").trim();
    if (runtimeId) return runtimeId;
  }
  const config = runtimeOrConfig.config || runtimeOrConfig;
  return String(config?.clientId || "").trim();
}

function buildInviteUrlForRuntime(runtimeOrConfig) {
  const config = runtimeOrConfig?.config || runtimeOrConfig;
  if (!config) return null;
  const resolvedClientId = resolveRuntimeClientId(runtimeOrConfig);
  if (!resolvedClientId) return null;
  return buildInviteUrl({ ...config, clientId: resolvedClientId });
}

function resolvePublicWebsiteUrl() {
  const raw = String(process.env.PUBLIC_WEB_URL || "").trim();
  if (!raw) {
    const rawDomain = String(process.env.WEB_DOMAIN || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
    if (rawDomain && !/[\s/\\]/.test(rawDomain)) {
      const fromDomain = toOrigin(`https://${rawDomain}`);
      if (fromDomain) return fromDomain;
    }
    return "https://discord.gg/UeRkfGS43R";
  }
  try {
    return new URL(raw).toString();
  } catch {
    return "https://discord.gg/UeRkfGS43R";
  }
}

function buildInviteOverviewForTier(runtimes, tier) {
  const normalizedTier = String(tier || "free").toLowerCase();
  const hasPro = normalizedTier === "pro" || normalizedTier === "ultimate";
  const hasUltimate = normalizedTier === "ultimate";
  const overview = {
    freeWebsiteUrl: resolvePublicWebsiteUrl(),
    freeInfo: "Free-Bots sind bereits enthalten. Hier sind nur zusaetzlich freigeschaltete Premium-Bots gelistet.",
    proBots: [],
    ultimateBots: [],
  };

  const sorted = [...runtimes].sort((a, b) => Number(a.config.index || 0) - Number(b.config.index || 0));
  const seenPro = new Set();
  const seenUltimate = new Set();

  for (const runtime of sorted) {
    const index = Number(runtime.config.index || 0);
    const bucket = String(runtime.config.requiredTier || "free").toLowerCase();
    if (bucket !== "pro" && bucket !== "ultimate") continue;
    const target = bucket === "ultimate" ? overview.ultimateBots : overview.proBots;
    if ((bucket === "pro" && !hasPro) || (bucket === "ultimate" && !hasUltimate)) continue;
    const seen = bucket === "ultimate" ? seenUltimate : seenPro;
    if (seen.has(index)) continue;
    seen.add(index);
    const inviteUrl = buildInviteUrlForRuntime(runtime);
    if (!inviteUrl) continue;
    target.push({
      index: Number(runtime.config.index || 0),
      name: runtime.config.name,
      url: inviteUrl,
    });
  }

  overview.proBots.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  overview.ultimateBots.sort((a, b) => Number(a.index || 0) - Number(b.index || 0));
  return overview;
}

// ---- Stripe key ----
function getStripeSecretKey() {
  return String(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || "").trim();
}

// ---- Rate limiting ----
const apiRateLimitState = new Map();
const MAX_API_RATE_STATE_ENTRIES = Math.max(
  1_000,
  Number.parseInt(String(process.env.API_RATE_STATE_MAX_ENTRIES || "50000"), 10) || 50_000
);

function firstHeaderValue(rawHeader) {
  if (!rawHeader) return "";
  if (typeof rawHeader === "string") return rawHeader.split(",")[0].trim();
  if (Array.isArray(rawHeader)) return String(rawHeader[0] || "").trim();
  return "";
}

function getClientIp(req) {
  if (TRUST_PROXY_HEADERS) {
    const forwarded = firstHeaderValue(req.headers["x-forwarded-for"]);
    if (forwarded) return forwarded;
    const realIp = firstHeaderValue(req.headers["x-real-ip"]);
    if (realIp) return realIp;
  }
  return req.socket?.remoteAddress || "unknown";
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

function enforceApiRateLimit(req, res, pathname) {
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

export {
  getCommonSecurityHeaders,
  buildContentSecurityPolicy,
  buildPermissionsPolicy,
  shouldSendStrictTransportSecurity,
  sendJson,
  methodNotAllowed,
  sendStaticFile,
  applyCors,
  getAdminApiToken,
  safeTokenEquals,
  isAdminApiRequest,
  sanitizeLicenseForApi,
  API_COMMANDS,
  getBotAccessForTier,
  resolveRuntimeClientId,
  buildInviteUrlForRuntime,
  resolvePublicWebsiteUrl,
  buildInviteOverviewForTier,
  getStripeSecretKey,
  resolveCheckoutReturnBase,
  getConfiguredPublicOrigin,
  isAllowedFrontendOrigin,
  toOrigin,
  enforceApiRateLimit,
  getClientIp,
};
