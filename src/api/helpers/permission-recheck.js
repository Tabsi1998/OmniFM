// OmniFM API: the dashboard asks Discord again whether someone may still manage a server (#523).
// A session keeps the server list and rights of its Discord login for its whole
// life (DASHBOARD_SESSION_TTL_SECONDS, 24 hours). Older than
// DASHBOARD_PERMISSION_RECHECK_SECONDS, a bot on the server asks Discord again
// and applies the login's rule: Manage Server or Administrator (the owner has
// every right). A bot of this process asks through discord.js past its member
// cache; in split mode a server with only a worker on it is asked over the
// worker's REST (its token never leaves this module, never a log line). One
// question per user and server until the next deadline; a failure is kept for
// a short while, so Discord trouble does not turn into a storm of questions.
// Changes fail closed, reads stop only when Discord says no.
import { REST } from "@discordjs/rest";
import { Routes } from "discord.js";
import { sendJson } from "../../lib/api-helpers.js";
import { languagePick } from "../../lib/language.js";
import {
  getDashboardSession,
  hasManageGuildPermission,
  resolveDashboardGuildForSession,
  resolveDashboardRequestLanguage,
} from "./session.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const SHORT_RETRY_SECONDS = 30;
const REST_TIMEOUT_MS = 10_000;
// Unknown Member, Unknown User: no longer on the server.
const GONE_CODES = new Set([10007, 10013]);
// Unknown Guild, Missing Access: the bot itself is not on the server.
const NO_BOT_CODES = new Set([10004, 50001]);
// The biggest body a dashboard route takes (a jingle: about 8.1 MB as base64).
export const DASHBOARD_BODY_MAX_BYTES = 9 * 1024 * 1024;

const answers = new Map();
const restClients = new Map();
// A rate limit answers at once instead of queueing the request.
const realRest = (token) => new REST({ version: "10", timeout: REST_TIMEOUT_MS, retries: 1, rejectOnRateLimit: () => true }).setToken(token);
let createRest = realRest;

/** Tests hand in a fake Discord REST; null restores the real one. */
export function setDashboardPermissionRestForTests(factory) {
  createRest = factory || realRest;
  restClients.clear();
  answers.clear();
}

export function getDashboardPermissionRecheckSeconds() {
  const parsed = Number.parseInt(String(process.env.DASHBOARD_PERMISSION_RECHECK_SECONDS || ""), 10);
  return Number.isFinite(parsed) ? Math.max(30, parsed) : 600;
}

function errorResult(err) {
  if (GONE_CODES.has(Number(err?.code))) return "revoked";
  if (NO_BOT_CODES.has(Number(err?.code))) return "no_bot";
  return Number(err?.status) === 404 ? "revoked" : "unknown";
}

async function askGateway(guild, userId) {
  try {
    const member = await guild.members.fetch({ user: userId, force: true });
    return hasManageGuildPermission(member?.permissions?.bitfield) ? "allowed" : "revoked";
  } catch (err) {
    return errorResult(err);
  }
}

// The member's rights from the raw data: @everyone (role id = server id) and its roles.
async function askRest(token, guildId, userId) {
  let rest = restClients.get(token);
  if (!rest) {
    rest = createRest(token);
    restClients.set(token, rest);
  }
  try {
    const member = /** @type {{ roles?: string[] }} */ (await rest.get(Routes.guildMember(guildId, userId)));
    const guild = /** @type {{ owner_id?: string, roles?: { id: string, permissions?: string }[] }} */ (await rest.get(Routes.guild(guildId)));
    if (String(guild?.owner_id || "") === userId) return "allowed";
    const roleBits = new Map((guild?.roles || []).map((role) => [String(role.id), BigInt(String(role.permissions || "0"))]));
    let bits = roleBits.get(guildId) || 0n;
    for (const roleId of member?.roles || []) bits |= roleBits.get(String(roleId)) || 0n;
    return hasManageGuildPermission(bits) ? "allowed" : "revoked";
  } catch (err) {
    return errorResult(err);
  }
}

/** "allowed", "revoked", "no_bot" (no OmniFM bot on the server) or "unknown" (Discord did not answer). */
function askDiscord(runtimes, userId, guildId) {
  const holders = (Array.isArray(runtimes) ? runtimes : []).filter((runtime) => runtime?.client?.guilds?.cache?.has?.(guildId));
  const live = holders.find((runtime) => !runtime.remote && typeof runtime.client.guilds.cache.get(guildId)?.members?.fetch === "function");
  if (live) return askGateway(live.client.guilds.cache.get(guildId), userId);
  const worker = holders.find((runtime) => String(runtime?.config?.token || "").trim());
  if (worker) return askRest(String(worker.config.token).trim(), guildId, userId);
  return Promise.resolve("no_bot");
}

function freshEntry(runtimes, userId, guildId) {
  const now = Date.now();
  const key = `${userId}:${guildId}`;
  const cached = answers.get(key);
  if (cached && cached.until > now) return cached;
  for (const [entryKey, entry] of answers) {
    if (entry.until <= now) answers.delete(entryKey);
  }
  const recheckMs = getDashboardPermissionRecheckSeconds() * 1000;
  const entry = { until: now + recheckMs, result: "", promise: null };
  entry.promise = askDiscord(runtimes, userId, guildId)
    .catch(() => "unknown")
    .then((result) => {
      if (result !== "allowed" && result !== "revoked") entry.until = now + Math.min(recheckMs, SHORT_RETRY_SECONDS * 1000);
      entry.result = result;
      return result;
    });
  answers.set(key, entry);
  return entry;
}

export function checkFreshGuildPermission(runtimes, userId, guildId) {
  return freshEntry(runtimes, userId, guildId).promise;
}

function loginIsFresh(session) {
  const loginAgeSeconds = Math.floor(Date.now() / 1000) - Number(session?.createdAt || 0);
  return loginAgeSeconds < getDashboardPermissionRecheckSeconds();
}

/**
 * For the live stream (#502), which asks without waiting: true once Discord
 * said no. Starts the question when it is due; the answer counts next time.
 */
export function freshPermissionRevoked(runtimes, session, guildId) {
  if (!session || loginIsFresh(session)) return false;
  return freshEntry(runtimes, String(session.user?.id || ""), String(guildId)).result === "revoked";
}

function refuse(res, status, language, de, en) {
  sendJson(res, status, { error: languagePick(language, de, en) });
  return false;
}

/**
 * Before every /api/dashboard/* route: false when it already answered.
 * A change is checked for every server it names, in the address and in the
 * JSON body. Requests without a session, or with one server outside the
 * session's list, are left to the route, which refuses them itself.
 */
export async function enforceFreshDashboardPermission({ req, res, requestUrl, runtimes, readJsonBody }) {
  const pathname = String(requestUrl?.pathname || "");
  if (!pathname.startsWith("/api/dashboard/") || pathname === "/api/dashboard/telemetry") return true;
  const { session } = getDashboardSession(req);
  if (!session) return true;

  const mutation = MUTATION_METHODS.has(String(req.method || "GET").toUpperCase());
  const named = [requestUrl.searchParams.get("serverId")];
  if (mutation) {
    try {
      const body = await readJsonBody({ maxBytes: DASHBOARD_BODY_MAX_BYTES });
      if (body && typeof body === "object" && body.serverId !== undefined && body.serverId !== null) named.push(body.serverId);
    } catch {
      // A body that is too big or no JSON: the route answers 400/413 itself.
    }
  }
  const serverIds = [...new Set(named.map((value) => String(value ?? "").trim()).filter(Boolean))];
  const language = resolveDashboardRequestLanguage(req, requestUrl);
  const guilds = serverIds.map((serverId) => resolveDashboardGuildForSession(session, serverId));
  if (guilds.length > 1 && guilds.some((guild) => !guild)) {
    return refuse(res, 403, language, "Kein Zugriff auf diesen Server.", "No access to this server.");
  }
  if (!guilds.length || !guilds[0] || loginIsFresh(session)) return true;

  const userId = String(session.user?.id || "");
  const results = await Promise.all(guilds.map((guild) => checkFreshGuildPermission(runtimes, userId, guild.id)));
  if (results.includes("revoked")) {
    return refuse(
      res, 403, language,
      "Du darfst diesen Server nicht mehr verwalten. Melde dich neu an, falls du die Rechte wieder hast.",
      "You can no longer manage this server. Sign in again if you have the permission back."
    );
  }
  if (!mutation) return true;
  if (results.includes("no_bot")) {
    return refuse(
      res, 403, language,
      "Deine Rechte für diesen Server lassen sich gerade nicht prüfen, weil kein OmniFM-Bot dort ist. Bitte melde dich neu an.",
      "Your permissions for this server cannot be checked right now because no OmniFM bot is on it. Please sign in again."
    );
  }
  if (results.includes("unknown")) {
    return refuse(
      res, 503, language,
      "Deine Rechte auf diesem Server konnten gerade nicht geprüft werden. Versuche es gleich noch einmal oder melde dich neu an.",
      "Your permissions on this server could not be checked right now. Try again in a moment or sign in again."
    );
  }
  return true;
}
