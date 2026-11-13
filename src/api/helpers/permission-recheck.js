// OmniFM API: the dashboard asks Discord again whether someone may still manage a server (#523).
// A session keeps the server list and rights of its Discord login for its whole
// life (DASHBOARD_SESSION_TTL_SECONDS, 24 hours). Older than
// DASHBOARD_PERMISSION_RECHECK_SECONDS, the bot fetches the member from Discord
// (past its own cache) and checks the login's rule again: Manage Server or
// Administrator (the owner has every right). One question per user and server
// until the next deadline; a failure is kept for a short while, so Discord
// trouble does not turn into a storm of questions. Changes fail closed, reads
// stop only when Discord says no.
import { sendJson } from "../../lib/api-helpers.js";
import { languagePick } from "../../lib/language.js";
import { resolveRuntimeForGuild } from "./runtime-status.js";
import {
  getDashboardSession,
  hasManageGuildPermission,
  resolveDashboardGuildForSession,
  resolveDashboardRequestLanguage,
} from "./session.js";

const MUTATION_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const UNKNOWN_RETRY_SECONDS = 30;
// Unknown Member, Unknown User: no longer on the server.
const GONE_CODES = new Set([10007, 10013]);
const answers = new Map();

export function getDashboardPermissionRecheckSeconds() {
  const parsed = Number.parseInt(String(process.env.DASHBOARD_PERMISSION_RECHECK_SECONDS || ""), 10);
  return Number.isFinite(parsed) ? Math.max(30, parsed) : 600;
}

/** "allowed", "revoked" or "unknown" (the bot could not ask). */
async function askDiscord(runtimes, userId, guildId) {
  const { guild } = resolveRuntimeForGuild(runtimes, guildId);
  if (!guild?.members?.fetch) return "unknown";
  try {
    const member = await guild.members.fetch({ user: userId, force: true });
    return hasManageGuildPermission(member?.permissions?.bitfield) ? "allowed" : "revoked";
  } catch (err) {
    return GONE_CODES.has(Number(err?.code)) ? "revoked" : "unknown";
  }
}

export function checkFreshGuildPermission(runtimes, userId, guildId) {
  const now = Date.now();
  const key = `${userId}:${guildId}`;
  const cached = answers.get(key);
  if (cached && cached.until > now) return cached.promise;
  for (const [entryKey, entry] of answers) {
    if (entry.until <= now) answers.delete(entryKey);
  }
  const recheckMs = getDashboardPermissionRecheckSeconds() * 1000;
  const entry = { until: now + recheckMs, promise: null };
  entry.promise = askDiscord(runtimes, userId, guildId).then((result) => {
    if (result === "unknown") entry.until = now + Math.min(recheckMs, UNKNOWN_RETRY_SECONDS * 1000);
    return result;
  });
  answers.set(key, entry);
  return entry.promise;
}

/**
 * Before every /api/dashboard/* route: false when it already answered 403/503.
 * Requests without a session or with a server outside the session's list are
 * left to the route, which refuses them itself.
 */
export async function enforceFreshDashboardPermission({ req, res, requestUrl, runtimes, readJsonBody }) {
  const pathname = String(requestUrl?.pathname || "");
  if (!pathname.startsWith("/api/dashboard/") || pathname === "/api/dashboard/telemetry") return true;
  const { session } = getDashboardSession(req);
  if (!session) return true;

  const mutation = MUTATION_METHODS.has(String(req.method || "GET").toUpperCase());
  let serverId = requestUrl.searchParams.get("serverId");
  if (!serverId && mutation) {
    // playback names the server in the body; the route reads the same body again.
    try {
      serverId = (await readJsonBody())?.serverId;
    } catch {
      return true;
    }
  }
  const guild = resolveDashboardGuildForSession(session, serverId);
  if (!guild) return true;
  const loginAgeSeconds = Math.floor(Date.now() / 1000) - Number(session.createdAt || 0);
  if (loginAgeSeconds < getDashboardPermissionRecheckSeconds()) return true;

  const result = await checkFreshGuildPermission(runtimes, String(session.user?.id || ""), guild.id);
  if (result === "allowed" || (result === "unknown" && !mutation)) return true;

  const language = resolveDashboardRequestLanguage(req, requestUrl);
  if (result === "revoked") {
    sendJson(res, 403, {
      error: languagePick(
        language,
        "Du darfst diesen Server nicht mehr verwalten. Melde dich neu an, falls du die Rechte wieder hast.",
        "You can no longer manage this server. Sign in again if you have the permission back."
      ),
    });
  } else {
    sendJson(res, 503, {
      error: languagePick(
        language,
        "Deine Rechte auf diesem Server konnten gerade nicht geprüft werden. Versuche es gleich noch einmal oder melde dich neu an.",
        "Your permissions on this server could not be checked right now. Try again in a moment or sign in again."
      ),
    });
  }
  return false;
}
