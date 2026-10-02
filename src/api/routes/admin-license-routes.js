// Owner API: licenses, activity and the archive.
// Split out of admin-routes.js (#293); runs after its sign-in and role checks.
import fs from "node:fs";
import { getClientIp } from "../../lib/api-helpers.js";
import { getDb, isConnected } from "../../lib/db.js";
import {
  OwnerLicenseError,
  addOwnerLicense,
  adminLicenseRows,
  isValidEmail,
  licenseRows,
  maskEmail,
  parseIntLike,
  patchOwnerLicense,
  setLicenseServerLinks,
} from "../../lib/owner-licenses.js";
import {
  ArchiveError,
  archiveMongoRecords,
  listArchiveOperations,
  restoreArchivedOperation,
} from "../../lib/owner-archive.js";
import { readRuntimeHealthFresh, runtimeGuildDirectory } from "../../lib/owner-monitoring.js";
import {
  flushPremiumStoreWrites,
  reloadPremiumStore,
  savePremiumStore,
} from "../../premium-store.js";
import { resolveRuntimeDataPath } from "../../lib/runtime-data-path.js";

export function createAdminLicenseRoutes({ sendJson, methodNotAllowed, auditOwnerAction, readRequestBody }) {
  return async function handleAdminLicenseRoutes(context) {
    const { req, res, requestUrl } = context;
    const pathname = requestUrl?.pathname || "";

    // The servers the running bots are in (_runtime_guild_directory), from MongoDB.
    const guildDirectory = async () => {
      const db = isConnected() ? getDb() : null;
      return runtimeGuildDirectory(db, await readRuntimeHealthFresh(db));
    };
    const licenseError = (err) => {
      const status = err instanceof OwnerLicenseError || err instanceof ArchiveError ? err.status : 500;
      sendJson(res, status, { error: err?.message || "Fehler" });
    };
    const clientIp = () => {
      try { return getClientIp(req) || "-"; } catch { return "-"; }
    };

    // GET/POST /api/admin/licenses: the license manager (#288)
    if (pathname === "/api/admin/licenses") {
      if (req.method === "GET") {
        const data = await reloadPremiumStore();
        const rows = requestUrl.searchParams.get("full") === "1" ? adminLicenseRows(data, await guildDirectory()) : licenseRows(data);
        sendJson(res, 200, { licenses: rows, count: rows.length });
        return true;
      }
      if (req.method !== "POST") { methodNotAllowed(res, ["GET", "POST"]); return true; }
      if (!isConnected() || !getDb()) { sendJson(res, 503, { error: "Keine Datenbank verbunden." }); return true; }
      let body;
      try { body = JSON.parse(await readRequestBody(req, 64 * 1024) || "{}") || {}; } catch { body = {}; }
      const email = String(body.email || "").trim();
      const tier = String(body.tier || "pro").trim().toLowerCase();
      const months = parseIntLike(body.months ?? 1, 1);
      const seats = Math.max(1, Math.min(5, parseIntLike(body.seats ?? 1, 1)));
      const note = String(body.note || "").trim();
      if (!["pro", "ultimate"].includes(tier)) { sendJson(res, 400, { error: "Tier muss 'pro' oder 'ultimate' sein." }); return true; }
      if (email && !isValidEmail(email)) { sendJson(res, 400, { error: "Bitte eine gültige E-Mail-Adresse angeben." }); return true; }
      try {
        const data = await reloadPremiumStore();
        const created = addOwnerLicense(data, { email, tier, months, seats, note, activatedBy: "owner" });
        const serverId = String(body.serverId || body.guildId || "").trim();
        if (serverId) setLicenseServerLinks(data, created.licenseKey, [serverId]);
        savePremiumStore(data);
        await flushPremiumStoreWrites();
        auditOwnerAction(req, { action: "license.create", status: "success", target: created.licenseKey, summary: `${tier} · ${months}M · ${seats} seats` });
        sendJson(res, 200, { ok: true, licenseKey: created.licenseKey, license: { ...data.licenses[created.licenseKey], licenseKey: created.licenseKey } });
      } catch (err) {
        licenseError(err);
      }
      return true;
    }

    // PATCH/DELETE /api/admin/licenses/<key>
    const licenseMatch = pathname.match(/^\/api\/admin\/licenses\/([^/]+)$/);
    if (licenseMatch) {
      const licenseKey = decodeURIComponent(licenseMatch[1]);
      if (req.method !== "PATCH" && req.method !== "DELETE") { methodNotAllowed(res, ["PATCH", "DELETE"]); return true; }
      if (!isConnected() || !getDb()) { sendJson(res, 503, { error: "Keine Datenbank verbunden." }); return true; }
      try {
        const data = await reloadPremiumStore();
        if (req.method === "PATCH") {
          let body;
          try { body = JSON.parse(await readRequestBody(req, 64 * 1024) || "{}") || {}; } catch { body = {}; }
          const changes = patchOwnerLicense(data, licenseKey, body);
          savePremiumStore(data);
          await flushPremiumStoreWrites();
          auditOwnerAction(req, { action: "license.update", status: "success", target: licenseKey, summary: changes.join(", ") || "no-op" });
          const row = adminLicenseRows(data, await guildDirectory()).find((entry) => entry.licenseKey === licenseKey) || null;
          sendJson(res, 200, { ok: true, license: row, changes });
          return true;
        }
        if (!data.licenses?.[licenseKey]) { sendJson(res, 404, { error: "Lizenz nicht gefunden." }); return true; }
        let archived;
        try {
          archived = await archiveMongoRecords(getDb(), [
            ["licenses", { _licenseId: String(licenseKey) }],
            ["server_entitlements", { licenseId: String(licenseKey) }],
          ], { operation: "owner.license.delete", target: licenseKey, actor: "owner", ip: clientIp(), remove: false });
        } catch (err) {
          sendJson(res, 500, { error: `Lizenz konnte nicht sicher archiviert werden: ${String(err?.message || err).slice(0, 300)}` });
          return true;
        }
        if (!archived.archived) { sendJson(res, 409, { error: "Lizenz konnte vor dem Löschen nicht archiviert werden." }); return true; }
        const removed = data.licenses[licenseKey];
        delete data.licenses[licenseKey];
        for (const [serverId, entitlement] of Object.entries(data.serverEntitlements || {})) {
          if (String(entitlement?.licenseId || "") === String(licenseKey)) delete data.serverEntitlements[serverId];
        }
        savePremiumStore(data);
        await flushPremiumStoreWrites();
        auditOwnerAction(req, { action: "license.delete", status: "success", target: licenseKey, summary: String(removed?.tier || removed?.plan || "") });
        sendJson(res, 200, { ok: true, deleted: licenseKey, archiveId: archived.operationId });
      } catch (err) {
        licenseError(err);
      }
      return true;
    }

    // GET /api/admin/activity: redemptions, else issued licenses
    if (pathname === "/api/admin/activity") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      const data = await reloadPremiumStore();
      let redemptions;
      try {
        const coupons = JSON.parse(fs.readFileSync(resolveRuntimeDataPath("coupons.json"), "utf8"));
        redemptions = Object.entries(coupons?.redemptions || {})
          .filter(([, row]) => row && typeof row === "object")
          .map(([sessionId, row]) => ({ sessionId: String(row.sessionId || sessionId).trim(), ...row }))
          .sort((a, b) => String(b.processedAt || "").localeCompare(String(a.processedAt || "")));
      } catch {
        redemptions = Array.isArray(data.recentRedemptions) ? data.recentRedemptions : [];
      }
      const events = redemptions.slice(0, 50).map((row) => ({
        type: "redemption",
        at: row.processedAt || row.createdAt || null,
        label: `${String(row.tier || "premium").replace(/^./, (c) => c.toUpperCase())} Lizenz eingelöst`,
        detail: maskEmail(String(row.email || "")),
        meta: { seats: row.seats ?? null, sessionId: row.sessionId ?? null },
      }));
      if (!events.length) {
        for (const row of licenseRows(data)) {
          events.push({
            type: "license",
            at: row.createdAt,
            label: `${row.planName} Lizenz ausgestellt`,
            detail: row.contactEmail,
            meta: { seats: row.seats, source: row.source, status: row.expired ? "expired" : "active" },
          });
        }
      }
      events.sort((a, b) => String(b.at || "").localeCompare(String(a.at || "")));
      sendJson(res, 200, { activity: events.slice(0, 50), count: events.length });
      return true;
    }

    // GET /api/admin/archive, POST /api/admin/archive/<operation>/restore
    if (pathname === "/api/admin/archive") {
      if (req.method !== "GET") { methodNotAllowed(res, ["GET"]); return true; }
      if (!isConnected() || !getDb()) { sendJson(res, 503, { error: "MongoDB nicht verbunden." }); return true; }
      const rows = await listArchiveOperations(getDb(), requestUrl.searchParams.get("limit") || 100);
      sendJson(res, 200, { archive: rows, count: rows.length });
      return true;
    }
    const restoreMatch = pathname.match(/^\/api\/admin\/archive\/([^/]+)\/restore$/);
    if (restoreMatch) {
      if (req.method !== "POST") { methodNotAllowed(res, ["POST"]); return true; }
      const operationId = decodeURIComponent(restoreMatch[1]);
      try {
        const result = await restoreArchivedOperation(isConnected() ? getDb() : null, operationId, { ip: clientIp() });
        auditOwnerAction(req, { action: "archive.restore", status: "success", target: operationId, summary: `${result.restored} Datensätze` });
        sendJson(res, 200, { ok: true, ...result });
      } catch (err) {
        if (!(err instanceof ArchiveError) || err.status >= 500) {
          auditOwnerAction(req, { action: "archive.restore", status: "failed", target: operationId, summary: String(err?.message || err) });
        }
        const status = err instanceof ArchiveError ? err.status : 500;
        const message = status >= 500 && !(err instanceof ArchiveError) ? `Wiederherstellung fehlgeschlagen: ${String(err?.message || err).slice(0, 300)}` : err.message;
        sendJson(res, status, { error: message });
      }
      return true;
    }

    return false;
  };
}
