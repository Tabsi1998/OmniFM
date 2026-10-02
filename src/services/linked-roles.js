// ============================================================
// OmniFM: linked roles (#302), talking to Discord
// ============================================================
// The commander registers the two values at start, takes a person's
// connection from the sign-in (api/routes/linked-roles-routes.js) and sends
// every connected person's values again when they changed, at the latest
// once a day: the hours (only with the switch in /mydata) and whether the
// person owns a server with Pro or Ultimate. In the support server it gives
// premium customers their role and takes it back when that ends.
//
// The OAuth app is the dashboard's (DISCORD_CLIENT_ID/SECRET, which is the
// commander's application); the tokens are kept encrypted (token-crypto.js).
import { log } from "../lib/logging.js";
import { getTier } from "../core/entitlements.js";
import { ownerSettings } from "../lib/owner-settings-cache.js";
import { tokenKeyFrom } from "../lib/token-crypto.js";
import { ROLE_CONNECTION_METADATA, PLATFORM_NAME, premiumCustomerIds, roleConnectionFor, tokenNeedsRefresh } from "../lib/linked-roles.js";
import { getListeningHours } from "../listening-hours-store.js";
import {
  deleteSupportRoleRecord,
  getLinkedRoleInfo,
  getLinkedRoleTokens,
  listLinkedUserIds,
  listSupportRoleRecords,
  markRoleConnectionPushed,
  noteLinkedRoleFailure,
  recordSupportRole,
  saveLinkedRoleTokens,
  supportRolesAvailable,
} from "../linked-roles-store.js";

const API = "https://discord.com/api/v10";
const DAY_MS = 24 * 60 * 60 * 1000;
const RUN_EVERY_MS = 6 * 60 * 60 * 1000;
const FIRST_RUN_MS = 10 * 60 * 1000;

const SNOWFLAKE = /^\d{17,22}$/;
const clean = (value) => (SNOWFLAKE.test(String(value || "").trim()) ? String(value).trim() : "");

export function linkedRolesCredentials(env = process.env) {
  return { clientId: String(env.DISCORD_CLIENT_ID || "").trim(), clientSecret: String(env.DISCORD_CLIENT_SECRET || "").trim() };
}

/** Whether everything is there: the OAuth app and the key for the tokens. */
export function linkedRolesReady(env = process.env) {
  const { clientId, clientSecret } = linkedRolesCredentials(env);
  return Boolean(clientId && clientSecret && tokenKeyFrom(env));
}

/** The two values servers can use in their role conditions. */
export async function registerRoleConnectionMetadata({ applicationId, botToken, fetchImpl = fetch }) {
  const response = await fetchImpl(`${API}/applications/${applicationId}/role-connections/metadata`, {
    method: "PUT",
    headers: { Authorization: `Bot ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(ROLE_CONNECTION_METADATA),
  });
  if (!response.ok) throw new Error(`role_connection_metadata_failed:${response.status}`);
  return true;
}

/** A code or a refresh token becomes tokens; Discord's tokens last a week. */
async function tokenRequest(params, { clientId, clientSecret, fetchImpl = fetch, now = Date.now() }) {
  const response = await fetchImpl(`${API}/oauth2/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, ...params }),
  });
  if (!response.ok) throw new Error(`discord_token_failed:${response.status}`);
  const payload = await response.json();
  const accessToken = String(payload?.access_token || "");
  const refreshToken = String(payload?.refresh_token || "");
  if (!accessToken || !refreshToken) throw new Error("discord_token_missing");
  return {
    accessToken,
    refreshToken,
    scope: String(payload?.scope || ""),
    expiresAt: new Date(now + (Number(payload?.expires_in) || 7 * 24 * 3600) * 1000),
  };
}

/** @param {{ clientId: string, clientSecret: string, fetchImpl?: typeof fetch, now?: number }} options */
export function exchangeLinkedRolesCode(code, redirectUri, options) {
  return tokenRequest({ grant_type: "authorization_code", code: String(code || ""), redirect_uri: String(redirectUri || "") }, options);
}

/** @param {{ clientId: string, clientSecret: string, fetchImpl?: typeof fetch, now?: number }} options */
export function refreshLinkedRolesTokens(refreshToken, options) {
  return tokenRequest({ grant_type: "refresh_token", refresh_token: String(refreshToken || "") }, options);
}

export async function fetchLinkedUserId(accessToken, { fetchImpl = fetch } = {}) {
  const response = await fetchImpl(`${API}/users/@me`, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!response.ok) throw new Error(`discord_user_failed:${response.status}`);
  const payload = await response.json();
  return clean(payload?.id);
}

export async function pushRoleConnection({ applicationId, accessToken, connection, fetchImpl = fetch }) {
  const response = await fetchImpl(`${API}/users/@me/applications/${applicationId}/role-connection`, {
    method: "PUT",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify(connection),
  });
  if (!response.ok) throw new Error(`role_connection_failed:${response.status}`);
  return true;
}

/** Who owns a server with Pro or Ultimate, among the servers the commander is on. */
export function premiumCustomersOf(runtime, tierOf = getTier) {
  return premiumCustomerIds(runtime?.client?.guilds?.cache?.values?.() || [], tierOf);
}

/**
 * Sends one person's values to Discord, refreshing their tokens first when
 * they run out within a day. Unchanged values go again only after a day.
 * @param {string} userId
 * @param {{ premiumIds: Set<string>, credentials?: { clientId: string, clientSecret: string }, fetchImpl?: typeof fetch, now?: Date, force?: boolean }} options
 * @returns {Promise<{ ok: boolean, sent?: boolean, error?: string, metadata?: Record<string, string> }>}
 */
export async function syncLinkedRoleUser(userId, { premiumIds, credentials = linkedRolesCredentials(), fetchImpl = fetch, now = new Date(), force = false }) {
  let tokens = await getLinkedRoleTokens(userId);
  if (!tokens) return { ok: false, error: "not-linked" };
  const hours = await getListeningHours(userId);
  const connection = roleConnectionFor({ listenedMs: hours.listenedMs, counting: hours.counting, premium: premiumIds.has(String(userId)) });
  const info = await getLinkedRoleInfo(userId);
  const unchanged = JSON.stringify(info?.metadata || null) === JSON.stringify(connection.metadata);
  const fresh = info?.pushedAt instanceof Date && now.getTime() - info.pushedAt.getTime() < DAY_MS;
  if (!force && unchanged && fresh) return { ok: true, sent: false, metadata: connection.metadata };
  try {
    if (tokenNeedsRefresh(tokens.expiresAt, now.getTime())) {
      tokens = await refreshLinkedRolesTokens(tokens.refreshToken, { ...credentials, fetchImpl, now: now.getTime() });
      await saveLinkedRoleTokens(userId, tokens, { now });
    }
    await pushRoleConnection({ applicationId: credentials.clientId, accessToken: tokens.accessToken, connection, fetchImpl });
    await markRoleConnectionPushed(userId, connection.metadata, { now });
    return { ok: true, sent: true, metadata: connection.metadata };
  } catch (err) {
    // Three failures in a row (the person removed the connection in Discord, say) end it here too.
    const ended = await noteLinkedRoleFailure(userId);
    return { ok: false, error: ended ? "ended" : String(err?.message || err) };
  }
}

/**
 * /mydata "delete everything": Discord gets empty values and the tokens are
 * revoked, before OmniFM forgets them. Best effort; the deletion goes on.
 */
export async function clearLinkedRoleConnection(userId, { credentials = linkedRolesCredentials(), fetchImpl = fetch } = {}) {
  const tokens = await getLinkedRoleTokens(userId);
  if (!tokens) return false;
  await pushRoleConnection({ applicationId: credentials.clientId, accessToken: tokens.accessToken, connection: { platform_name: PLATFORM_NAME, metadata: {} }, fetchImpl })
    .catch(() => null);
  await fetchImpl(`${API}/oauth2/token/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: credentials.clientId, client_secret: credentials.clientSecret, token: tokens.refreshToken, token_type_hint: "refresh_token" }),
  }).catch(() => null);
  return true;
}

/**
 * The support server: premium customers get the premium role, people who
 * no longer own a Pro or Ultimate server lose it. OmniFM only takes back
 * the role from people it gave it to (support_premium_roles).
 * @param {any} runtime  the commander
 * @param {{ premiumIds: Set<string>, settings?: { supportGuildId?: string, premiumRoleId?: string } }} options
 */
export async function syncSupportPremiumRoles(runtime, { premiumIds, settings = ownerSettings()?.linkedRoles || {} }) {
  const guildId = clean(settings?.supportGuildId);
  const roleId = clean(settings?.premiumRoleId);
  if (!guildId || !roleId) return { added: 0, removed: 0, skipped: "not-configured" };
  const guild = runtime?.client?.guilds?.cache?.get(guildId);
  if (!guild) return { added: 0, removed: 0, skipped: "no-guild" };
  if (!guild.roles?.cache?.get(roleId)) return { added: 0, removed: 0, skipped: "no-role" };
  if (!supportRolesAvailable()) return { added: 0, removed: 0, skipped: "no-database" };
  let added = 0;
  let removed = 0;
  for (const userId of premiumIds) {
    // eslint-disable-next-line no-await-in-loop -- one member after the other, Discord's limits
    const member = await guild.members.fetch(userId).catch(() => null);
    if (!member) continue;
    if (!member.roles.cache.has(roleId)) {
      // eslint-disable-next-line no-await-in-loop -- see above
      const ok = await member.roles.add(roleId, "OmniFM: Premium-Kunde (#302)").then(() => true).catch((err) => {
        log("WARN", `[linked-roles] Support-Rolle für ${userId} nicht vergeben: ${err?.message || err}`);
        return false;
      });
      if (!ok) continue;
      added += 1;
    }
    // eslint-disable-next-line no-await-in-loop -- see above
    await recordSupportRole(guildId, userId, roleId);
  }
  const records = await listSupportRoleRecords(guildId);
  for (const record of records) {
    if (premiumIds.has(String(record.userId))) continue;
    // eslint-disable-next-line no-await-in-loop -- one member after the other
    const member = await guild.members.fetch(String(record.userId)).catch(() => null);
    if (member?.roles?.cache?.has(String(record.roleId || roleId))) {
      // eslint-disable-next-line no-await-in-loop -- see above
      await member.roles.remove(String(record.roleId || roleId), "OmniFM: kein Pro- oder Ultimate-Server mehr (#302)").catch(() => null);
      removed += 1;
    }
    // eslint-disable-next-line no-await-in-loop -- see above
    await deleteSupportRoleRecord(record._id);
  }
  return { added, removed, skipped: null };
}

/** One round: every connected person, then the support server. */
export async function runLinkedRolesSync(runtime, { now = new Date(), fetchImpl = fetch } = {}) {
  const premiumIds = premiumCustomersOf(runtime);
  let sent = 0;
  let failed = 0;
  if (linkedRolesReady()) {
    const credentials = linkedRolesCredentials();
    for (const userId of await listLinkedUserIds()) {
      // eslint-disable-next-line no-await-in-loop -- one person after the other
      const result = await syncLinkedRoleUser(userId, { premiumIds, credentials, fetchImpl, now });
      if (result.sent) sent += 1;
      if (!result.ok) failed += 1;
    }
  }
  const support = await syncSupportPremiumRoles(runtime, { premiumIds });
  return { sent, failed, support };
}

let serviceTimer = null;

/** On the commander: register the values, then a round every six hours. */
export function startLinkedRolesService(runtime, { fetchImpl = fetch } = {}) {
  if (serviceTimer) return;
  const credentials = linkedRolesCredentials();
  const applicationId = String(runtime?.getApplicationId?.() || runtime?.config?.clientId || "");
  if (linkedRolesReady() && credentials.clientId === applicationId && runtime?.config?.token) {
    registerRoleConnectionMetadata({ applicationId, botToken: runtime.config.token, fetchImpl })
      .catch((err) => log("WARN", `[linked-roles] Werte bei Discord nicht registriert: ${err?.message || err}`));
  } else if (linkedRolesReady()) {
    log("WARN", `[linked-roles] DISCORD_CLIENT_ID (${credentials.clientId}) ist nicht die App des Commanders (${applicationId}); verknüpfte Rollen bleiben aus.`);
  }
  const round = () => {
    runLinkedRolesSync(runtime, { fetchImpl })
      .then((result) => {
        if (result.sent || result.failed || result.support.added || result.support.removed) {
          log("INFO", `[linked-roles] gesendet ${result.sent}, fehlgeschlagen ${result.failed}, Support-Rolle +${result.support.added}/-${result.support.removed}`);
        }
      })
      .catch((err) => log("WARN", `[linked-roles] Runde fehlgeschlagen: ${err?.message || err}`));
  };
  const first = setTimeout(round, FIRST_RUN_MS);
  first.unref?.();
  serviceTimer = setInterval(round, RUN_EVERY_MS);
  serviceTimer.unref?.();
}

export function stopLinkedRolesServiceForTests() {
  if (serviceTimer) clearInterval(serviceTimer);
  serviceTimer = null;
}
