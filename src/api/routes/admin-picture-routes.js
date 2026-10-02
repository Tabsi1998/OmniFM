// Owner API: a picture for the website, uploaded in the console (#486).
// POST /api/admin/pictures with { data: <base64 or data URL> } keeps it in
// MongoDB and answers its reference "upload:<id>", which the console puts
// into a sponsor's logo field. Owner only, like saving the partners.
import { getDb, isConnected } from "../../lib/db.js";
import { UPLOAD_MAX_BYTES, storeUploadedPicture } from "../../lib/uploaded-pictures.js";

export function createAdminPictureRoutes({ sendJson, methodNotAllowed, auditOwnerAction, readRequestBody }) {
  return async function handleAdminPictureRoutes(context) {
    const { req, res, requestUrl } = context;
    if (requestUrl?.pathname !== "/api/admin/pictures") return false;
    if (req.method !== "POST") {
      methodNotAllowed(res, ["POST"]);
      return true;
    }
    let body;
    try {
      // Base64 is a third larger than the picture.
      body = JSON.parse(await readRequestBody(req, Math.ceil(UPLOAD_MAX_BYTES * 4 / 3) + 4096) || "null");
    } catch (err) {
      sendJson(res, err?.statusCode === 413 ? 413 : 400, { error: err?.statusCode === 413 ? "Das Bild ist größer als 2 MB." : "Ungültiger Body." });
      return true;
    }
    const data = typeof body?.data === "string" ? body.data.replace(/^data:[^,]*,/, "") : "";
    if (!data) {
      sendJson(res, 400, { error: "Keine Datei." });
      return true;
    }
    try {
      const stored = await storeUploadedPicture(isConnected() ? getDb() : null, Buffer.from(data, "base64"));
      auditOwnerAction(req, { action: "picture.upload", status: "success", target: stored.ref, summary: `${stored.type}, ${stored.bytes} Bytes` });
      sendJson(res, 200, { ok: true, ...stored });
    } catch (err) {
      sendJson(res, err?.status || 500, { error: err?.status ? err.message : "Hochladen fehlgeschlagen." });
    }
    return true;
  };
}
