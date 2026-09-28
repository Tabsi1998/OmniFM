// Owner API: the incidents and maintenance windows of the public status page (#299).
// Runs after the sign-in and role checks of admin-routes.js; only the owner
// changes them (roleAllows lets support and billing read).
import { getDb, isConnected } from "../../lib/db.js";
import {
  createStatusNotice,
  deleteStatusNotice,
  listStatusNotices,
  updateStatusNotice,
} from "../../services/status-page.js";

const NOTICE_PATH = /^\/api\/admin\/status-notices\/([a-f0-9]{16})$/;
const KIND_LABELS = { incident: "Störung", maintenance: "Wartung" };

export function createAdminStatusRoutes({ sendJson, methodNotAllowed, auditOwnerAction, readRequestBody }) {
  return async function handleAdminStatusRoutes(context) {
    const { req, res, requestUrl } = context;
    const pathname = requestUrl?.pathname || "";
    const match = NOTICE_PATH.exec(pathname);
    if (pathname !== "/api/admin/status-notices" && !match) return false;

    const db = isConnected() ? getDb() : null;
    const actor = req.ownerIdentity?.actor || "owner";
    const readBody = async () => {
      try { return JSON.parse(await readRequestBody(req, 16 * 1024) || "{}") || {}; } catch { return {}; }
    };
    const noDatabase = () => sendJson(res, 503, { error: "Keine Datenbank verbunden." });

    if (!match) {
      if (req.method === "GET") {
        sendJson(res, 200, { notices: db ? await listStatusNotices(db) : [] });
        return true;
      }
      if (req.method !== "POST") { methodNotAllowed(res, ["GET", "POST"]); return true; }
      if (!db) { noDatabase(); return true; }
      const result = await createStatusNotice(db, await readBody(), { actor });
      if (result.error) { sendJson(res, 400, { error: result.error }); return true; }
      auditOwnerAction(req, { action: "status.notice.create", status: "success", target: result.notice.id, summary: `${KIND_LABELS[result.notice.kind]}: ${result.notice.title}` });
      sendJson(res, 201, { notice: result.notice });
      return true;
    }

    const id = match[1];
    if (req.method === "PATCH") {
      if (!db) { noDatabase(); return true; }
      const result = await updateStatusNotice(db, id, await readBody(), { actor });
      if (result.error) { sendJson(res, result.status || 400, { error: result.error }); return true; }
      const state = result.notice.resolvedAt ? "beendet" : "offen";
      auditOwnerAction(req, { action: "status.notice.update", status: "success", target: id, summary: `${KIND_LABELS[result.notice.kind]} ${state}: ${result.notice.title}` });
      sendJson(res, 200, { notice: result.notice });
      return true;
    }
    if (req.method === "DELETE") {
      if (!db) { noDatabase(); return true; }
      if (!(await deleteStatusNotice(db, id))) { sendJson(res, 404, { error: "Diese Meldung gibt es nicht mehr." }); return true; }
      auditOwnerAction(req, { action: "status.notice.delete", status: "success", target: id, summary: "Meldung der Statusseite gelöscht" });
      sendJson(res, 200, { ok: true });
      return true;
    }
    methodNotAllowed(res, ["PATCH", "DELETE"]);
    return true;
  };
}
