// Owner API: the queue of station suggestions (#303). GET lists them with
// their stream checks; accepting takes one into the catalogue with the same
// checks and store as the station form, rejecting turns it down. The person
// who sent it hears about it from the commander. Only the owner decides
// (roleAllows lets support and billing read).
import { getDb, isConnected } from "../../lib/db.js";
import { OwnerStationError, buildStationDocument, upsertCatalogStation } from "../../lib/owner-stations.js";
import { suggestionHealth } from "../../lib/station-suggestions.js";
import { decideStationSuggestion, findStationSuggestion, listStationSuggestions } from "../../station-suggestions-store.js";
import { reloadStationsFromMongo } from "../../stations-store.js";

const ACTION_PATH = /^\/api\/admin\/station-suggestions\/([a-f0-9]{16})\/(accept|reject)$/;
const iso = (value) => (value instanceof Date ? value.toISOString() : value || null);

/** What the owner console shows: the person by name only, never the Discord ID. */
function ownerView(doc, now) {
  const last = Array.isArray(doc.checks) && doc.checks.length ? doc.checks[doc.checks.length - 1] : null;
  return {
    id: doc._id,
    name: doc.name,
    url: doc.url,
    genre: doc.genre || "",
    homepage: doc.homepage || "",
    note: doc.note || "",
    status: doc.status,
    createdAt: iso(doc.createdAt),
    decidedAt: iso(doc.decidedAt),
    decidedBy: doc.decidedBy || null,
    decisionNote: doc.decisionNote || "",
    stationKey: doc.stationKey || null,
    from: doc.submitter?.userName || null,
    health: suggestionHealth(doc.checks || [], now),
    lastCheck: last ? { at: iso(last.at), ok: last.ok === true, bitrate: last.bitrate ?? null, latencyMs: last.latencyMs ?? null, error: last.error || null } : null,
    answered: doc.notify ? { pending: doc.notify.pending === true, delivered: doc.notify.delivered === true } : null,
  };
}

export function createAdminSuggestionRoutes({ sendJson, methodNotAllowed, auditOwnerAction, readRequestBody }) {
  return async function handleAdminSuggestionRoutes(context) {
    const { req, res, requestUrl } = context;
    const pathname = requestUrl?.pathname || "";
    const match = ACTION_PATH.exec(pathname);
    if (pathname !== "/api/admin/station-suggestions" && !match) return false;
    const db = isConnected() ? getDb() : null;

    if (!match) {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const now = Date.now();
      const rows = db ? await listStationSuggestions() : [];
      sendJson(res, 200, { suggestions: rows.map((row) => ownerView(row, now)), pending: rows.filter((row) => row.status === "pending").length });
      return true;
    }

    if (req.method !== "POST") { methodNotAllowed(res, ["POST"]); return true; }
    if (!db) { sendJson(res, 503, { error: "Keine Datenbank verbunden." }); return true; }
    const [, id, action] = match;
    let body;
    try { body = JSON.parse(await readRequestBody(req, 16 * 1024) || "{}") || {}; } catch { body = {}; }
    const suggestion = await findStationSuggestion(id);
    if (!suggestion) { sendJson(res, 404, { error: "Diesen Vorschlag gibt es nicht mehr." }); return true; }
    if (suggestion.status !== "pending") { sendJson(res, 409, { error: "Über diesen Vorschlag ist schon entschieden." }); return true; }
    const actor = req.ownerIdentity?.actor || "owner";

    if (action === "reject") {
      const result = await decideStationSuggestion(id, { status: "rejected", note: body.note, actor });
      if (result.error) { sendJson(res, 409, { error: "Über diesen Vorschlag ist schon entschieden." }); return true; }
      auditOwnerAction(req, { action: "suggestion.reject", status: "success", target: id, summary: `${suggestion.name}${body.note ? ` · ${String(body.note).slice(0, 80)}` : ""}` });
      sendJson(res, 200, { ok: true });
      return true;
    }

    // Accepting takes the station through the station form's checks.
    let doc;
    try {
      doc = await buildStationDocument({
        ...body,
        name: body.name || suggestion.name,
        url: body.url || suggestion.url,
        genre: body.genre || suggestion.genre,
        homepage: body.homepage ?? suggestion.homepage,
      });
    } catch (err) {
      if (!(err instanceof OwnerStationError)) throw err;
      sendJson(res, err.status, { error: err.message });
      return true;
    }
    if (await db.collection("stations").findOne({ key: doc.key })) {
      sendJson(res, 409, { error: `Den Key „${doc.key}“ gibt es im Katalog schon. Nimm einen anderen.` });
      return true;
    }
    const { station } = await upsertCatalogStation(db, doc);
    await reloadStationsFromMongo();
    await decideStationSuggestion(id, { status: "accepted", stationKey: doc.key, note: body.note, actor });
    auditOwnerAction(req, { action: "suggestion.accept", status: "success", target: doc.key, summary: `${doc.name} · ${doc.tier} · aus Vorschlag ${id}` });
    sendJson(res, 200, { ok: true, station });
    return true;
  };
}
