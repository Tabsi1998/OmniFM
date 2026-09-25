// ============================================================
// OmniFM: the Discord login settings of the dashboard
// ============================================================
// The redirect URI is made from the website's address, not typed in: it is
// always <website>/api/auth/discord/callback and has to be entered exactly
// so in Discord's developer portal. DISCORD_REDIRECT_URI in the environment
// still wins, for special setups such as local development.
//
// Client ID, secret and scopes are edited in the owner console. The Node API
// (which answers the login since #195) reads them from there every 30
// seconds, so a new secret works without a restart.
import { getDb, isConnected } from "./db.js";

export const DISCORD_OAUTH_CALLBACK_PATH = "/api/auth/discord/callback";
const SYNC_INTERVAL_MS = 30_000;
const OWNER_FIELDS = [
  ["clientId", "DISCORD_CLIENT_ID"],
  ["clientSecret", "DISCORD_CLIENT_SECRET"],
  ["scopes", "DISCORD_OAUTH_SCOPES"],
];

let syncTimer = null;

function originOf(value) {
  try {
    const url = new URL(String(value || "").trim());
    return ["http:", "https:"].includes(url.protocol) ? url.origin : "";
  } catch {
    return "";
  }
}

/** The website's origin: PUBLIC_WEB_URL, else WEB_DOMAIN, else omnifm.xyz. */
export function publicWebsiteOrigin(env = process.env) {
  const fromUrl = originOf(env.PUBLIC_WEB_URL);
  if (fromUrl) return fromUrl;
  const domain = String(env.WEB_DOMAIN || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "");
  if (domain && !/[\s\\]/.test(domain)) return `https://${domain}`;
  return "https://omnifm.xyz";
}

/** The redirect URI Discord sends people back to after the login. */
export function resolveDiscordRedirectUri(env = process.env) {
  const explicit = String(env.DISCORD_REDIRECT_URI || "").trim();
  if (explicit) return explicit;
  return `${publicWebsiteOrigin(env)}${DISCORD_OAUTH_CALLBACK_PATH}`;
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
