// OmniFM Radio (#592) on the Node API of the commander; the public entry
// and FastAPI forward /api/radio and /api/owner there.
//   POST /api/radio/webhook            AzuraCast "Generic Web Hook" (now-playing JSON)
//   GET  /api/owner/radio              live state, last shows, webhook on/off
//   POST /api/owner/radio/test-show    { action: "start" | "end" } the console's test show
//   GET  /api/owner/radio/dm           DMs to server owners (#594): mode and last run
//   POST /api/owner/radio/dm           { mode: "owners" | "optin" | "off" } (owner role; off is the kill switch)
// The webhook exists only with OMNIFM_RADIO_WEBHOOK_SECRET: AzuraCast sends
// it as the Basic-auth password (user name free). Checked before the body
// is read, in constant time; the body may change nothing but the live state.
import { createHash, timingSafeEqual } from "node:crypto";

import { getClientIp } from "../../lib/api-rate-limit.js";
import { getAdminApiToken, methodNotAllowed, sendJson } from "../../lib/api-helpers.js";
import { csrfSatisfied, resolveOwnerIdentity, roleAllows } from "../../lib/owner-access.js";
import { recordOwnerAudit } from "../../lib/owner-audit-store.js";
import { log as defaultLog } from "../../lib/logging.js";
import { normalizeAzuracastNowPlaying } from "../../services/omnifm-radio-api.js";
import { getOmnifmRadioConfig, getOmnifmRadioLiveSettings } from "../../services/omnifm-radio-config.js";

export const OMNIFM_RADIO_WEBHOOK_PATH = "/api/radio/webhook";
// AzuraCast's now-playing JSON is a few KB; song lyrics can make it longer.
export const OMNIFM_RADIO_WEBHOOK_MAX_BYTES = 256 * 1024;

const defaultSettings = () => {
  const config = getOmnifmRadioConfig();
  return { enabled: config.enabled, station: config.station, webhookSecret: getOmnifmRadioLiveSettings().webhookSecret };
};

/** The password of a Basic Authorization header, or null. */
function basicAuthPassword(header) {
  const match = /^Basic\s+([A-Za-z0-9+/]+={0,2})$/i.exec(String(header || "").trim());
  if (!match) return null;
  const decoded = Buffer.from(match[1], "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon >= 0 ? decoded.slice(colon + 1) : null;
}

/** Constant time: both sides hashed first, so the length leaks nothing either. */
function secretMatches(given, expected) {
  if (!given || !expected) return false;
  const digest = (value) => createHash("sha256").update(String(value), "utf8").digest();
  return timingSafeEqual(digest(given), digest(expected));
}

function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * @param {{ getService: () => any, getSettings?: () => { enabled: boolean, station: string, webhookSecret: string }, log: (level: string, message: string) => void }} options
 */
export function createOmnifmRadioWebhookHandler({ getService, getSettings = defaultSettings, log }) {
  return async function handleOmnifmRadioWebhook({ req, res, requestUrl, readRawBody }) {
    if (requestUrl.pathname !== OMNIFM_RADIO_WEBHOOK_PATH) return false;
    const settings = getSettings();
    if (!settings.enabled || !settings.webhookSecret) {
      sendJson(res, 404, { error: "Nicht gefunden." });
      return true;
    }
    // The secret first: an unknown caller learns nothing, not even the method.
    const password = basicAuthPassword(req.headers?.authorization);
    if (!secretMatches(password, settings.webhookSecret)) {
      log("WARN", `[OmniFM Radio] Webhook abgelehnt (${password === null ? "ohne Basic-Auth" : "falsches Geheimnis"}) von ${getClientIp(req)}`);
      sendJson(res, 401, { error: "Nicht autorisiert." });
      return true;
    }
    if (req.method !== "POST") {
      methodNotAllowed(res, ["POST"]);
      return true;
    }
    const service = getService();
    if (!service) {
      sendJson(res, 503, { error: "Die Live-Erkennung startet gerade." });
      return true;
    }
    let payload;
    try {
      payload = JSON.parse(await readRawBody(OMNIFM_RADIO_WEBHOOK_MAX_BYTES));
    } catch (error) {
      const status = Number(error?.status) === 413 ? 413 : 400;
      sendJson(res, status, { error: status === 413 ? "Zu groß." : "Kein gültiges JSON." });
      return true;
    }
    // Only a now-playing answer: a body without live.is_live is no "offline".
    if (!isPlainObject(payload) || !isPlainObject(payload.live) || typeof payload.live.is_live !== "boolean") {
      sendJson(res, 400, { error: "Kein Now-Playing von AzuraCast." });
      return true;
    }
    const shortcode = payload.station?.shortcode;
    if (typeof shortcode === "string" && shortcode && shortcode !== settings.station) {
      sendJson(res, 422, { error: "Der Webhook gehört zu einer anderen Station." });
      return true;
    }
    const state = normalizeAzuracastNowPlaying(payload);
    await service.tracker.observe({
      isLive: state.isLive,
      streamerName: state.streamerName,
      title: state.songText || state.title,
      liveSince: state.liveSince,
    }, "webhook");
    // The stored state was not readable, so nothing was taken: AzuraCast logs a failure.
    if (service.tracker.snapshot().readable === false) {
      sendJson(res, 503, { error: "Der Live-Zustand ist gerade nicht lesbar (Datenbank)." });
      return true;
    }
    sendJson(res, 200, { ok: true, isLive: state.isLive });
    return true;
  };
}

const resolveByOwnerAccess = (req) => resolveOwnerIdentity(req, { adminToken: getAdminApiToken() });

const TEST_SHOW_PATH = "/api/owner/radio/test-show";
const DM_PATH = "/api/owner/radio/dm";
const RADIO_PATHS = new Set(["/api/owner/radio", TEST_SHOW_PATH, DM_PATH]);

function auditSafely(event) {
  try {
    recordOwnerAudit(event);
  } catch (error) {
    defaultLog("WARN", `[Owner] Audit konnte nicht geschrieben werden: ${error?.message || error}`);
  }
}

/** canChange: whether this role may switch the DMs (the owner only). */
async function dmView(dmService, role) {
  const canChange = roleAllows(role, "POST", DM_PATH);
  if (!dmService) return { enabled: false, canChange, mode: null, modeSource: null, modeError: null, running: false, lastRun: null };
  return { enabled: true, canChange, ...(await dmService.status()) };
}

async function handleDmRoute({ req, res, identity, dmService, readJsonBody, audit }) {
  if (req.method === "GET") {
    sendJson(res, 200, await dmView(dmService, identity.role));
    return;
  }
  if (req.method !== "POST") {
    methodNotAllowed(res, ["GET", "POST"]);
    return;
  }
  if (!dmService) {
    sendJson(res, 503, { error: "Die DMs laufen nicht (OmniFM Radio aus oder startet gerade)." });
    return;
  }
  let body;
  try {
    body = (await readJsonBody({ maxBytes: 1024 })) || {};
  } catch {
    body = {};
  }
  const mode = typeof body?.mode === "string" ? body.mode.trim().toLowerCase() : "";
  if (!["owners", "optin", "off"].includes(mode)) {
    sendJson(res, 400, { error: "Unbekannter Modus (owners, optin oder off)." });
    return;
  }
  const actor = identity.actor || "owner";
  try {
    await dmService.setMode(mode);
  } catch (error) {
    audit({ actor, action: "radio.dm.mode", status: "failed", target: mode, summary: String(error?.message || error).slice(0, 200) });
    sendJson(res, 503, { error: "Nicht gespeichert, die Datenbank antwortet nicht." });
    return;
  }
  audit({ actor, action: "radio.dm.mode", status: "success", target: mode, summary: `DMs an Server-Besitzer: ${mode}` });
  sendJson(res, 200, await dmView(dmService, identity.role));
}

/** canTest: whether this role may run the test show (the owner only). */
function consoleView(service, role) {
  const canTest = roleAllows(role, "POST", TEST_SHOW_PATH);
  if (!service) return { enabled: false, webhook: false, canTest, current: null, shows: [], testShows: [] };
  return {
    enabled: true,
    canTest,
    station: service.config?.station || "",
    webhook: Boolean(service.settings?.webhookSecret),
    webhookSecretTooShort: service.settings?.webhookSecretTooShort === true,
    pollMs: service.settings?.pollMs ?? null,
    graceMs: service.settings?.graceMs ?? null,
    ...service.tracker.snapshot(),
  };
}

/**
 * @param {{ getService: () => any, getDmService?: () => any, resolveIdentity?: (req: any) => Promise<any>, audit?: (event: any) => void }} options
 */
export function createOwnerRadioRoutesHandler({ getService, getDmService = () => null, resolveIdentity = resolveByOwnerAccess, audit = auditSafely }) {
  return async function handleOwnerRadioRoutes({ req, res, requestUrl, readJsonBody }) {
    const path = requestUrl.pathname;
    if (!RADIO_PATHS.has(path)) return false;
    const identity = await resolveIdentity(req);
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
    if (path === DM_PATH) {
      await handleDmRoute({ req, res, identity, dmService: getDmService(), readJsonBody, audit });
      return true;
    }
    const service = getService();
    if (path === "/api/owner/radio") {
      if (req.method !== "GET") {
        methodNotAllowed(res, ["GET"]);
        return true;
      }
      sendJson(res, 200, consoleView(service, identity.role));
      return true;
    }
    if (req.method !== "POST") {
      methodNotAllowed(res, ["POST"]);
      return true;
    }
    if (!service) {
      sendJson(res, 503, { error: "Die Live-Erkennung läuft nicht (OmniFM Radio aus oder startet gerade)." });
      return true;
    }
    let body;
    try {
      body = (await readJsonBody({ maxBytes: 1024 })) || {};
    } catch {
      body = {};
    }
    const action = body?.action;
    if (action !== "start" && action !== "end") {
      sendJson(res, 400, { error: "Unbekannte Aktion." });
      return true;
    }
    const result = action === "start" ? await service.tracker.startTestShow() : await service.tracker.endTestShow();
    sendJson(res, result.ok ? 200 : 409, result.ok ? consoleView(service, identity.role) : { error: result.error });
    return true;
  };
}
