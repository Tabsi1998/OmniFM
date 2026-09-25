// ============================================================
// OmniFM: the Discord login settings of the dashboard
// ============================================================
// The redirect URI is made from the website's public address, not typed in:
// it is always <website>/api/auth/discord/callback and has to be entered
// exactly so in Discord's developer portal. Candidates, the first public one
// wins (public-origin.js): DISCORD_REDIRECT_URI, PUBLIC_WEB_URL, WEB_DOMAIN,
// the redirect URI once stored in the owner console. Leftovers of the
// installation such as http://localhost:8081 or http://192.168.x.x:8001
// therefore no longer end up at Discord; they only count when nothing public
// is configured (development).
//
// Client ID, secret and scopes are edited in the owner console. The Node API
// (which answers the login since #195) reads them from there every 30
// seconds, so a new secret works without a restart.
import { getDb, isConnected } from "./db.js";
import { isPublicOrigin, originOf, pickPublicOrigin, webDomainOrigin } from "./public-origin.js";

export const DISCORD_OAUTH_CALLBACK_PATH = "/api/auth/discord/callback";
const DEFAULT_PUBLIC_ORIGIN = "https://omnifm.xyz";
const SYNC_INTERVAL_MS = 30_000;
const OWNER_FIELDS = [
  ["clientId", "DISCORD_CLIENT_ID"],
  ["clientSecret", "DISCORD_CLIENT_SECRET"],
  ["scopes", "DISCORD_OAUTH_SCOPES"],
];

let syncTimer = null;
// The redirect URI stored in the owner console before it became automatic.
let storedRedirectUri = "";

/** The website's public origin: PUBLIC_WEB_URL, WEB_DOMAIN, the stored redirect URI, else omnifm.xyz. */
export function publicWebsiteOrigin(env = process.env, { stored = storedRedirectUri } = {}) {
  const picked = pickPublicOrigin([env.PUBLIC_WEB_URL, webDomainOrigin(env.WEB_DOMAIN), stored]);
  return picked || DEFAULT_PUBLIC_ORIGIN;
}

/** The redirect URI Discord sends people back to after the login. */
export function resolveDiscordRedirectUri(env = process.env, { stored = storedRedirectUri } = {}) {
  const explicit = String(env.DISCORD_REDIRECT_URI || "").trim();
  if (explicit && isPublicOrigin(originOf(explicit))) return explicit;
  const origin = publicWebsiteOrigin(env, { stored });
  // Development without any public address: an explicit local URI still counts.
  if (explicit && !isPublicOrigin(origin)) return explicit;
  return `${origin}${DISCORD_OAUTH_CALLBACK_PATH}`;
}

/**
 * Copies client ID, secret and scopes from the owner console (MongoDB
 * owner_config) into the environment. Empty values there change nothing.
 */
export async function syncDiscordOauthFromOwnerConfig(env = process.env, { db = null } = {}) {
  const database = db || (isConnected() ? getDb() : null);
  if (!database) return false;
  const doc = await database.collection("owner_config").findOne({ _id: "global" }, { projection: { "system.discordOAuth": 1 } });
  const oauth = doc?.system?.discordOAuth || {};
  for (const [field, envKey] of OWNER_FIELDS) {
    const value = typeof oauth[field] === "string" ? oauth[field].trim() : "";
    if (value) env[envKey] = value;
  }
  storedRedirectUri = typeof oauth.redirectUri === "string" ? oauth.redirectUri.trim() : "";
  return true;
}

export function startDiscordOauthSync({ intervalMs = SYNC_INTERVAL_MS } = {}) {
  if (syncTimer) return;
  const run = () => syncDiscordOauthFromOwnerConfig().catch(() => false);
  void run();
  syncTimer = setInterval(run, intervalMs);
  syncTimer.unref?.();
}

export function stopDiscordOauthSync() {
  if (syncTimer) clearInterval(syncTimer);
  syncTimer = null;
}
