// Owner API: the station catalogue.
// Split out of admin-routes.js (#293); runs after its sign-in and role checks.
import fs from "node:fs";
import { getClientIp } from "../../lib/api-helpers.js";
import { getDb, isConnected } from "../../lib/db.js";
import { effectiveSystemConfig, loadOwnerConfigRaw } from "../../lib/owner-config.js";
import { archiveMongoRecords } from "../../lib/owner-archive.js";
import {
  OwnerStationError,
  buildStationDocument,
  upsertCatalogStation,
  runStationHealth,
  stationListResponse,
  testStationStream,
} from "../../lib/owner-stations.js";
import { reloadStationsFromMongo } from "../../stations-store.js";
import { stationSummary } from "../../lib/owner-monitoring.js";

// stations.json for the station summary when MongoDB has no catalog yet.
export function loadCatalogFileStations() {
  try {
    return JSON.parse(fs.readFileSync(new URL("../../../stations.json", import.meta.url), "utf8"))?.stations || {};
  } catch {
    return {};
  }
}

export function createAdminStationRoutes({ sendJson, methodNotAllowed, auditOwnerAction, readRequestBody }) {
  return async function handleAdminStationRoutes(context) {
    const { req, res, requestUrl } = context;
    const pathname = requestUrl?.pathname || "";
    const clientIp = () => {
      try { return getClientIp(req) || "-"; } catch { return "-"; }
    };

    // Station catalogue
    const stationDb = () => (isConnected() ? getDb() : null);
    const readStationBody = async () => {
      try { return JSON.parse(await readRequestBody(req, 64 * 1024) || "{}") || {}; } catch { return {}; }
    };

    // GET /api/admin/stations: summary · POST: create or update
    if (pathname === "/api/admin/stations") {
      if (req.method === "GET") {
        const summary = await stationSummary(stationDb(), loadCatalogFileStations);
        sendJson(res, 200, summary);
        return true;
      }
      if (req.method !== "POST") { methodNotAllowed(res, ["GET", "POST"]); return true; }
      const db = stationDb();
      if (!db) { sendJson(res, 503, { error: "MongoDB nicht verbunden – Stationsverwaltung nicht verfügbar." }); return true; }
      let doc;
      try {
        doc = await buildStationDocument(await readStationBody());
      } catch (err) {
        if (!(err instanceof OwnerStationError)) throw err;
        sendJson(res, err.status, { error: err.message });
        return true;
      }
      const { created, station } = await upsertCatalogStation(db, doc);
      await reloadStationsFromMongo();
      auditOwnerAction(req, { action: created ? "station.create" : "station.update", status: "success", target: doc.key, summary: `${doc.name} · ${doc.tier} · ${doc.url}` });
      sendJson(res, 200, { ok: true, created, station });
      return true;
    }

    // GET /api/admin/stations/list
    if (pathname === "/api/admin/stations/list") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const stationHealthConfig = effectiveSystemConfig(await loadOwnerConfigRaw()).stationHealth || {};
      sendJson(res, 200, await stationListResponse(stationDb(), stationHealthConfig));
      return true;
    }

    // POST /api/admin/stations/test
    if (pathname === "/api/admin/stations/test") {
      if (req.method !== "POST") { methodNotAllowed(res, ["POST"]); return true; }
      const url = String((await readStationBody()).url || "").trim();
      try {
        const result = await testStationStream(url);
        const detail = result.status ? `status=${result.status} type=${result.contentType} ${result.latencyMs}ms` : result.message;
        auditOwnerAction(req, { action: "station.test", status: result.ok ? "success" : (result.status ? "warn" : "failed"), target: url, summary: detail });
        sendJson(res, 200, result);
      } catch (err) {
        if (!(err instanceof OwnerStationError)) throw err;
        auditOwnerAction(req, { action: "station.test", status: "failed", target: url, summary: err.message });
        sendJson(res, err.status, { error: err.message });
      }
      return true;
    }

    // POST /api/admin/stations/health
    if (pathname === "/api/admin/stations/health") {
      if (req.method !== "POST") { methodNotAllowed(res, ["POST"]); return true; }
      const db = stationDb();
      if (!db) { sendJson(res, 503, { error: "MongoDB nicht verbunden." }); return true; }
      sendJson(res, 200, await runStationHealth(db, (await readStationBody()).keys));
      return true;
    }

    // DELETE /api/admin/stations/<key>: archived first, the default station stays
    const stationKeyMatch = pathname.match(/^\/api\/admin\/stations\/([^/]+)$/);
    if (stationKeyMatch) {
      if (req.method !== "DELETE") { methodNotAllowed(res, ["DELETE"]); return true; }
      const db = stationDb();
      if (!db) { sendJson(res, 503, { error: "MongoDB nicht verbunden." }); return true; }
      const key = decodeURIComponent(stationKeyMatch[1]).trim().toLowerCase();
      const existing = await db.collection("stations").findOne({ key });
      if (!existing) { sendJson(res, 404, { error: "Station nicht gefunden." }); return true; }
      if (existing.is_default) {
        sendJson(res, 400, { error: "Standard-Station kann nicht gelöscht werden. Setze zuerst eine andere Default-Station." });
        return true;
      }
      let archived;
      try {
        archived = await archiveMongoRecords(db, [["stations", { _id: existing._id }]], {
          operation: "owner.station.delete", target: key, actor: "owner", ip: clientIp(), remove: true,
        });
      } catch (err) {
        sendJson(res, 500, { error: `Station konnte nicht sicher archiviert werden: ${String(err?.message || err).slice(0, 300)}` });
        return true;
      }
      if (!Number(archived.deleted?.stations || 0)) {
        sendJson(res, 409, { error: "Station wurde archiviert, aber nicht aus dem aktiven Katalog entfernt." });
        return true;
      }
      await reloadStationsFromMongo();
      auditOwnerAction(req, { action: "station.delete", status: "success", target: key, summary: String(existing.name || "") });
      sendJson(res, 200, { ok: true, deleted: key, archiveId: archived.operationId });
      return true;
    }

    return false;
  };
}
