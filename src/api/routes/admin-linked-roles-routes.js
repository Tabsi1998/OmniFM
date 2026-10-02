// Owner API: where the linked roles stand (#302). GET says what is set up
// (the OAuth app, the key for the tokens, whether the app is the
// commander's), the two addresses for Discord's developer portal, and how
// many people connected and count their hours. No person is listed.
import { getDb, isConnected } from "../../lib/db.js";
import { publicWebsiteOrigin } from "../../lib/discord-oauth-settings.js";
import { LINKED_ROLES_CALLBACK_PATH, LINKED_ROLES_PATH, normalizeLinkedRolesSettings } from "../../lib/linked-roles.js";
import { loadOwnerConfigRaw } from "../../lib/owner-config.js";
import { tokenCryptoAvailable } from "../../lib/token-crypto.js";
import { LISTENING_HOURS_COLLECTION } from "../../listening-hours-store.js";
import { LINKED_ROLES_COLLECTION } from "../../linked-roles-store.js";

/** The commander's application: the owner console first, then the environment. */
function commanderApplicationId(raw, env) {
  const fromConsole = String(raw?.discord?.commander?.clientId || "").trim();
  if (/^\d{17,22}$/.test(fromConsole)) return fromConsole;
  const index = Number.parseInt(String(env.COMMANDER_BOT_INDEX || "1"), 10) || 1;
  return String(env[`BOT_${index}_CLIENT_ID`] || "").trim();
}

/** The status the owner console shows, from the settings and the two collections. */
export async function linkedRolesStatus({ env = process.env, raw = null, counts = null } = {}) {
  const config = raw || (await loadOwnerConfigRaw().catch(() => ({}))) || {};
  const origin = publicWebsiteOrigin(env);
  const clientId = String(env.DISCORD_CLIENT_ID || "").trim();
  const commanderId = commanderApplicationId(config, env);
  const database = isConnected() ? getDb() : null;
  const numbers = counts || {
    linked: database ? await database.collection(LINKED_ROLES_COLLECTION).countDocuments({}) : 0,
    counting: database ? await database.collection(LISTENING_HOURS_COLLECTION).countDocuments({}) : 0,
  };
  const support = normalizeLinkedRolesSettings(config.linkedRoles);
  const checks = {
    oauthApp: Boolean(clientId && String(env.DISCORD_CLIENT_SECRET || "").trim()),
    tokenKey: tokenCryptoAvailable(env),
    commanderApp: Boolean(clientId) && clientId === commanderId,
  };
  return {
    ready: checks.oauthApp && checks.tokenKey && checks.commanderApp,
    checks,
    clientId,
    commanderId,
    verificationUrl: `${origin}${LINKED_ROLES_PATH}`,
    redirectUri: `${origin}${LINKED_ROLES_CALLBACK_PATH}`,
    linked: numbers.linked,
    counting: numbers.counting,
    supportRole: { configured: Boolean(support.supportGuildId && support.premiumRoleId), ...support },
  };
}

export function createAdminLinkedRolesRoutes({ sendJson, methodNotAllowed }) {
  return async function handleAdminLinkedRolesRoutes(context) {
    const { req, res, requestUrl } = context;
    if (requestUrl?.pathname !== "/api/admin/linked-roles") return false;
    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return true;
    }
    sendJson(res, 200, await linkedRolesStatus());
    return true;
  };
}
