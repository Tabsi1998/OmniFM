// The owner cockpit (#355), on the Node API; FastAPI forwards /api/owner.
//   GET  /api/owner/status          the latest result of every check, 24 h history
//   POST /api/owner/status/check    { key? } check now (one or all)
// Owner token like the rest of the owner console (X-Admin-Token).
import { isAdminApiRequest, methodNotAllowed, sendJson } from "../../lib/api-helpers.js";
import { OWNER_STATUS_CHECKS } from "../../services/owner-status/checks.js";

const KNOWN_KEYS = new Set(OWNER_STATUS_CHECKS.map((check) => check.key));

export function createOwnerStatusRoutesHandler({ getService, isOwner = isAdminApiRequest }) {
  return async function handleOwnerStatusRoutes({ req, res, requestUrl, readJsonBody }) {
    const path = requestUrl.pathname;
    if (path !== "/api/owner/status" && path !== "/api/owner/status/check") return false;
    if (!isOwner(req)) {
      sendJson(res, 401, { error: "Owner-Anmeldung nötig." });
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
