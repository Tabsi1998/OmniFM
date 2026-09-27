// The owner cockpit (#355), on the Node API; FastAPI forwards /api/owner.
//   GET  /api/owner/status          the latest result of every check, 24 h history
//   POST /api/owner/status/check    { key? } check now (one or all)
// Access like the rest of the owner console (#283): the script token or a
// Discord owner session; every role reads, owner and support may check.
import { getAdminApiToken, methodNotAllowed, sendJson } from "../../lib/api-helpers.js";
import { csrfSatisfied, resolveOwnerIdentity, roleAllows } from "../../lib/owner-access.js";
import { OWNER_STATUS_CHECKS } from "../../services/owner-status/checks.js";

const KNOWN_KEYS = new Set(OWNER_STATUS_CHECKS.map((check) => check.key));

const resolveByOwnerAccess = (req) => resolveOwnerIdentity(req, { adminToken: getAdminApiToken() });

/**
 * @param {{ getService: Function, isOwner?: (req: any) => boolean, resolveIdentity?: (req: any) => Promise<any> }} options
 *   isOwner: a plain yes/no check (tests); otherwise the owner identity with its role.
 */
export function createOwnerStatusRoutesHandler({ getService, isOwner = null, resolveIdentity = resolveByOwnerAccess }) {
  return async function handleOwnerStatusRoutes({ req, res, requestUrl, readJsonBody }) {
    const path = requestUrl.pathname;
    if (path !== "/api/owner/status" && path !== "/api/owner/status/check") return false;
    const identity = isOwner ? (isOwner(req) ? { via: "token", role: "owner" } : null) : await resolveIdentity(req);
    if (!identity) {
      sendJson(res, 401, { error: "Owner-Anmeldung nötig." });
      return true;
    }
    if (!csrfSatisfied(req, identity)) {
      sendJson(res, 403, { error: "CSRF-Schutz: Änderungen nur aus der Owner-Konsole." });
      return true;
    }
    if (!roleAllows(identity.role, req.method, path)) {
      sendJson(res, 403, { error: "Deine Rolle darf das nicht." });
      return true;
    }
    const service = getService();
    if (!service) {
      sendJson(res, 503, { error: "Das Cockpit startet gerade." });
      return true;
    }
    if (path === "/api/owner/status") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, service.snapshot());
      return true;
    }
    if (req.method !== "POST") {
      methodNotAllowed(res, ["POST"]);
      return true;
    }
    let body;
    try {
      body = (await readJsonBody({ maxBytes: 1024 })) || {};
    } catch {
      body = {};
    }
    const key = typeof body.key === "string" && KNOWN_KEYS.has(body.key) ? body.key : null;
    sendJson(res, 200, await service.run({ only: key ? [key] : null }));
    return true;
  };
}
