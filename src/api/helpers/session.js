// OmniFM API: dashboard sessions, cookies, Discord OAuth and request language.
// Split out of src/api/server.js (#293).
import { resolveDiscordRedirectUri } from "../../lib/discord-oauth-settings.js";
import { clipText } from "../../lib/helpers.js";
import { normalizeLanguage, getDefaultLanguage } from "../../i18n.js";
import { languagePick } from "../../lib/language.js";
import { resolveRequestLanguage } from "../../lib/request-language.js";
import {
  sendJson,
  getConfiguredPublicOrigin,
  toOrigin,
  getTrustedForwardedProto,
} from "../../lib/api-helpers.js";
import { getDashboardAuthSession, cleanupDashboardAuthState } from "../../dashboard-store.js";
import { buildServerCapabilityPayload } from "./license.js";

function parseEnvInt(value, fallback, minimum = 1) {
  const parsed = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(minimum, parsed);
}

function getDashboardSessionCookieName() {
  return String(process.env.DASHBOARD_SESSION_COOKIE || "omnifm_session").trim() || "omnifm_session";
}

export function getDashboardSessionTtlSeconds() {
  return parseEnvInt(process.env.DASHBOARD_SESSION_TTL_SECONDS, 86_400, 300);
}

export function getDiscordOauthStateTtlSeconds() {
  return parseEnvInt(process.env.DISCORD_OAUTH_STATE_TTL_SECONDS, 600, 60);
}

function getDiscordOauthScopes() {
  return String(process.env.DISCORD_OAUTH_SCOPES || "identify guilds").trim() || "identify guilds";
}

function getDiscordClientId() {
  return String(process.env.DISCORD_CLIENT_ID || "").trim();
}

function getDiscordClientSecret() {
  return String(process.env.DISCORD_CLIENT_SECRET || "").trim();
}

// Made from the website's address (DISCORD_REDIRECT_URI only for special setups).
export function getDiscordRedirectUri() {
  return resolveDiscordRedirectUri(process.env);
}

export function isDiscordOauthConfigured() {
  return Boolean(getDiscordClientId() && getDiscordClientSecret() && getDiscordRedirectUri());
}

function hasManageGuildPermission(rawPermissions) {
  try {
    const bitfield = BigInt(String(rawPermissions || "0").trim() || "0");
    return (bitfield & 0x20n) === 0x20n || (bitfield & 0x8n) === 0x8n;
  } catch {
    return false;
  }
}

export function sanitizeDashboardPage(rawPage) {
  const page = String(rawPage || "dashboard").trim().toLowerCase();
  // "admin": back to the owner console after its Discord sign-in (#283).
  return ["home", "admin"].includes(page) ? page : "dashboard";
}

function parseCookieHeader(rawCookieHeader) {
  const cookies = {};
  for (const part of String(rawCookieHeader || "").split(";")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!key) continue;
    try {
      cookies[key] = decodeURIComponent(value);
    } catch {
      cookies[key] = value;
    }
  }
  return cookies;
}

export function resolveDashboardSessionToken(req) {
  const auth = String(req.headers.authorization || "").trim();
  if (/^Bearer\s+/i.test(auth)) {
    const bearer = auth.replace(/^Bearer\s+/i, "").trim();
    if (bearer) return bearer;
  }
  const cookies = parseCookieHeader(req.headers.cookie);
  const cookieToken = String(cookies[getDashboardSessionCookieName()] || "").trim();
  if (cookieToken) return cookieToken;
  const headerToken = String(req.headers["x-session-token"] || "").trim();
  if (headerToken) return headerToken;
  return "";
}

export function getDashboardSession(req) {
  cleanupDashboardAuthState();
  const token = resolveDashboardSessionToken(req);
  if (!token) return { session: null, token: "" };
  return {
    session: getDashboardAuthSession(token),
    token,
  };
}

export function getFrontendBaseOrigin(req, publicUrl, preferredOrigin = "") {
  const preferred = toOrigin(preferredOrigin);
  if (preferred) return preferred;
  const requestOrigin = toOrigin(String(req.headers.origin || "").trim());
  if (requestOrigin) return requestOrigin;
  const refererOrigin = toOrigin(String(req.headers.referer || req.headers.referrer || "").trim());
  if (refererOrigin) return refererOrigin;
  const publicOrigin = toOrigin(publicUrl);
  if (publicOrigin) return publicOrigin;
  const redirectOrigin = toOrigin(getDiscordRedirectUri());
  if (redirectOrigin) return redirectOrigin;
  return getConfiguredPublicOrigin(publicUrl);
}

export function isSecureCookieRequest(req, targetOrigin = "") {
  if (String(targetOrigin || "").startsWith("https://")) return true;
  if (String(req.socket?.encrypted || false) === "true") return true;
  return getTrustedForwardedProto(req) === "https";
}

export function buildDashboardSessionCookie(token, req, targetOrigin) {
  const secure = isSecureCookieRequest(req, targetOrigin);
  const sameSite = secure ? "None" : "Lax";
  return [
    `${getDashboardSessionCookieName()}=${encodeURIComponent(token)}`,
    `Max-Age=${getDashboardSessionTtlSeconds()}`,
    "HttpOnly",
    `SameSite=${sameSite}`,
    "Path=/",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function buildDashboardSessionCookieDeletion(req, targetOrigin) {
  const secure = isSecureCookieRequest(req, targetOrigin);
  const sameSite = secure ? "None" : "Lax";
  return [
    `${getDashboardSessionCookieName()}=`,
    "Max-Age=0",
    "HttpOnly",
    `SameSite=${sameSite}`,
    "Path=/",
    ...(secure ? ["Secure"] : []),
  ].join("; ");
}

export function buildDiscordAuthorizeUrl(stateToken, redirectUri = getDiscordRedirectUri()) {
  const params = new URLSearchParams({
    client_id: getDiscordClientId(),
    response_type: "code",
    redirect_uri: redirectUri,
    scope: getDiscordOauthScopes(),
    state: stateToken,
    prompt: "consent",
  });
  return `https://discord.com/api/oauth2/authorize?${params.toString()}`;
}

// The token exchange has to name the same redirect URI as the login did.
export async function exchangeDiscordCodeForToken(code, redirectUri = getDiscordRedirectUri()) {
  const body = new URLSearchParams({
    client_id: getDiscordClientId(),
    client_secret: getDiscordClientSecret(),
    grant_type: "authorization_code",
    code: String(code || "").trim(),
    redirect_uri: redirectUri,
  });
  const response = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!response.ok) {
    throw new Error(`discord_token_exchange_failed:${response.status}`);
  }
  const payload = await response.json();
  const accessToken = String(payload?.access_token || "").trim();
  if (!accessToken) {
    throw new Error("discord_access_token_missing");
  }
  return accessToken;
}

export async function fetchDiscordUserProfile(accessToken) {
  const response = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`discord_user_fetch_failed:${response.status}`);
  }
  const payload = await response.json();
  return {
    id: String(payload?.id || "").trim(),
    username: clipText(payload?.username || "Discord User", 80),
    globalName: clipText(payload?.global_name || "", 80),
    avatar: clipText(payload?.avatar || "", 120),
  };
}

export async function fetchDiscordUserGuilds(accessToken) {
  const response = await fetch("https://discord.com/api/users/@me/guilds", {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!response.ok) {
    throw new Error(`discord_guilds_fetch_failed:${response.status}`);
  }
  const payload = await response.json();
  if (!Array.isArray(payload)) return [];
  return payload
    .map((guild) => ({
      id: String(guild?.id || "").trim(),
      name: clipText(guild?.name || "Guild", 120),
      icon: clipText(guild?.icon || "", 120),
      owner: Boolean(guild?.owner),
      permissions: String(guild?.permissions || "0"),
    }))
    .filter((guild) => /^\d{17,22}$/.test(guild.id));
}

export function resolveDashboardGuildsForSession(sessionPayload) {
  const guilds = Array.isArray(sessionPayload?.guilds) ? sessionPayload.guilds : [];
  return guilds
    .filter((guild) => guild && /^\d{17,22}$/.test(String(guild.id || "")) && hasManageGuildPermission(guild.permissions))
    .map((guild) => {
      const entitlement = buildServerCapabilityPayload(guild.id);
      return {
        id: guild.id,
        name: clipText(guild.name || guild.id, 120),
        icon: clipText(guild.icon || "", 120),
        owner: Boolean(guild.owner),
        permissions: String(guild.permissions || "0"),
        tier: entitlement.tier,
        capabilities: entitlement.capabilities,
        limits: entitlement.limits,
        upgradeHints: entitlement.upgradeHints,
        dashboardEnabled: entitlement.capabilities.dashboardAccess === true,
        ultimateEnabled: entitlement.capabilities.advancedAnalytics === true
          || entitlement.capabilities.customStationUrls === true
          || entitlement.capabilities.failoverRules === true,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function resolveDashboardGuildForSession(sessionPayload, serverId) {
  const guildId = String(serverId || "").trim();
  if (!/^\d{17,22}$/.test(guildId)) return null;
  return resolveDashboardGuildsForSession(sessionPayload).find((guild) => guild.id === guildId) || null;
}

export function buildDashboardErrorRedirect(origin, errorCode, language = "") {
  const safeOrigin = toOrigin(origin) || "http://localhost";
  const lang = normalizeLanguage(language || "", "");
  const langParam = lang ? `&lang=${encodeURIComponent(lang)}` : "";
  return `${safeOrigin}/?page=dashboard&authError=${encodeURIComponent(String(errorCode || "oauth_error"))}${langParam}`;
}

export function resolveDashboardRequestLanguage(req, requestUrl, fallback = getDefaultLanguage()) {
  return resolveRequestLanguage(
    req?.headers || {},
    requestUrl?.searchParams?.get("lang") || "",
    fallback
  );
}

export function getDashboardRequestTranslator(req, requestUrl, fallback = getDefaultLanguage()) {
  const language = resolveDashboardRequestLanguage(req, requestUrl, fallback);
  return {
    language,
    t: (de, en) => languagePick(language, de, en),
  };
}

export function sendLocalizedError(res, status, language, de, en) {
  sendJson(res, status, { error: languagePick(language, de, en) });
}

export function getLocalizedJsonBodyError(language, status) {
  return languagePick(
    language,
    status === 413 ? "Request-Body ist zu groß." : "Ungültiges JSON im Request-Body.",
    status === 413 ? "Request body is too large." : "Invalid JSON in request body."
  );
}
