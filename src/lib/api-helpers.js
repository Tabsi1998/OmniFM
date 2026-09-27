// ============================================================
// OmniFM: API / HTTP Helper Functions
// ============================================================
import fs from "node:fs";
import path from "node:path";
import { timingSafeEqual } from "node:crypto";
import { webDir } from "./logging.js";
import { ownerStripeSettings } from "./owner-settings-cache.js";
import { TIER_RANK, MIME_TYPES, normalizeSeats } from "./helpers.js";
import { buildCommandBuilders } from "../commands.js";
import { buildInviteUrl } from "../bot-config.js";
import {
  HSTS_BASE,
  buildContentSecurityPolicy,
  buildPermissionsPolicy,
} from "../config/security-headers.js";
import {
  buildAllowedApiOrigins,
  getConfiguredPublicOrigin,
  getTrustedForwardedProto,
  isAllowedFrontendOrigin,
  isTrustedProxyAddress,
  normalizeIpAddress,
  parseTrustedProxyIps,
  resolveCheckoutReturnBase,
  shouldTrustProxyHeaders,
  toOrigin,
} from "./api-cors.js";
import { enforceApiRateLimit, getClientIp } from "./api-rate-limit.js";

// ---- Security & HTTP ----

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

function buildStrictTransportSecurity() {
  const base = HSTS_BASE;
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
    res.end("404 — Not found");
    return;
  }
  if (!stat.isFile()) {
    res.writeHead(404, {
      ...getCommonSecurityHeaders(),
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
    });
    res.end("404 — Not found");
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
    res.end("404 — Not found");
    return;
  }

  streamStaticFile(res, resolved, { headOnly });
}

function applyCors(req, res, publicUrl) {
  const originHeader = String(req.headers.origin || "").trim();
  const allowedOrigins = buildAllowedApiOrigins(publicUrl);
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

// ---- Stripe (owner console first, then the environment, like FastAPI #289) ----
function getStripeSecretKey() {
  const stored = String(ownerStripeSettings().secretKey || "").trim();
  return stored || String(process.env.STRIPE_SECRET_KEY || process.env.STRIPE_API_KEY || "").trim();
}

function getStripeWebhookSecret() {
  const stored = String(ownerStripeSettings().webhookSecret || "").trim();
  return stored || String(process.env.STRIPE_WEBHOOK_SECRET || "").trim();
}

/** The console's switch wins; without it Stripe is on when a key exists (is_stripe_enabled). */
function isStripeCheckoutEnabled() {
  const stored = ownerStripeSettings();
  if (Object.hasOwn(stored, "enabled")) return Boolean(stored.enabled);
  return Boolean(getStripeSecretKey());
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
  getStripeWebhookSecret,
  isStripeCheckoutEnabled,
  resolveCheckoutReturnBase,
  getConfiguredPublicOrigin,
  isAllowedFrontendOrigin,
  toOrigin,
  enforceApiRateLimit,
  getClientIp,
  normalizeIpAddress,
  parseTrustedProxyIps,
  isTrustedProxyAddress,
  shouldTrustProxyHeaders,
  getTrustedForwardedProto,
};
