// OmniFM: the sign-in for the linked roles (#302).
//   GET /api/auth/linked-roles            Discord's "Linked Roles Verification URL": on to Discord's sign-in
//   GET /api/auth/linked-roles/callback   back from Discord: keep the tokens, send the values, say it worked
// A person sees both in the browser, so they answer with a small page in
// German or English (by the browser's language), never with JSON. The state
// lives in memory for ten minutes and is tied to a cookie of this browser.
import { randomBytes, timingSafeEqual } from "node:crypto";

import { getCommonSecurityHeaders, methodNotAllowed } from "../../lib/api-helpers.js";
import { log } from "../../lib/logging.js";
import { publicWebsiteOrigin } from "../../lib/discord-oauth-settings.js";
import {
  LINKED_ROLES_CALLBACK_PATH,
  LINKED_ROLES_PATH,
  linkedRolesAuthorizeUrl,
  linkedRolesRedirectUri,
} from "../../lib/linked-roles.js";
import { saveLinkedRoleTokens } from "../../linked-roles-store.js";
import {
  exchangeLinkedRolesCode,
  fetchLinkedUserId,
  linkedRolesCredentials,
  linkedRolesReady,
  premiumCustomersOf,
  syncLinkedRoleUser,
} from "../../services/linked-roles.js";

const STATE_TTL_MS = 10 * 60 * 1000;
const STATE_LIMIT = 500;
const STATE_COOKIE = "omnifm_linked_roles";

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);

function sendPage(res, status, language, { ok, title, text }) {
  const html = "<!doctype html>"
    + `<html lang="${language}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">`
    + "<title>OmniFM</title><style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#050505;color:#e4e4e7;"
    + "font:16px/1.6 system-ui,sans-serif}main{max-width:460px;padding:32px 20px;text-align:center}"
    + `h1{font-size:22px;margin:0 0 12px;color:${ok ? "#10b981" : "#f59e0b"}}</style></head>`
    + `<body><main><h1>${escapeHtml(title)}</h1>${text.map((line) => `<p>${escapeHtml(line)}</p>`).join("")}</main></body></html>`;
  res.writeHead(status, {
    ...getCommonSecurityHeaders(),
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  });
  res.end(html);
}

function cookieValue(req, name) {
  for (const part of String(req.headers.cookie || "").split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return "";
}

function sameSecret(a, b) {
  const left = Buffer.from(String(a || ""));
  const right = Buffer.from(String(b || ""));
  return left.length > 0 && left.length === right.length && timingSafeEqual(left, right);
}

/**
 * @param {{ fetchImpl?: typeof fetch, now?: () => number, ready?: () => boolean,
 *   credentials?: () => { clientId: string, clientSecret: string }, origin?: () => string,
 *   save?: typeof saveLinkedRoleTokens, sync?: typeof syncLinkedRoleUser }} [deps]
 */
export function createLinkedRolesRoutes({
  fetchImpl = fetch,
  now = () => Date.now(),
  ready = () => linkedRolesReady(),
  credentials = () => linkedRolesCredentials(),
  origin = () => publicWebsiteOrigin(),
  save = saveLinkedRoleTokens,
  sync = syncLinkedRoleUser,
} = {}) {
  /** @type {Map<string, number>} state -> expires at */
  const states = new Map();

  function rememberState() {
    const at = now();
    for (const [key, expiresAt] of states) if (expiresAt <= at) states.delete(key);
    while (states.size >= STATE_LIMIT) states.delete(states.keys().next().value);
    const state = randomBytes(24).toString("base64url");
    states.set(state, at + STATE_TTL_MS);
    return state;
  }

  function takeState(state, cookie) {
    const expiresAt = states.get(state);
    states.delete(state);
    return Boolean(expiresAt && expiresAt > now() && sameSecret(state, cookie));
  }

  return async function handleLinkedRolesRoutes({ req, res, requestUrl, runtimes = [] }) {
    const path = requestUrl.pathname;
    if (path !== LINKED_ROLES_PATH && path !== LINKED_ROLES_CALLBACK_PATH) return false;
    if (req.method !== "GET") {
      methodNotAllowed(res, ["GET"]);
      return true;
    }
    const language = /^de\b/i.test(String(req.headers["accept-language"] || "").trim()) ? "de" : "en";
    const t = (de, en) => (language === "de" ? de : en);
    if (!ready()) {
      sendPage(res, 503, language, {
        ok: false,
        title: t("Noch nicht eingerichtet", "Not set up yet"),
        text: [t("Verknüpfte Rollen sind bei OmniFM noch nicht eingerichtet. Bitte später noch einmal.", "Linked roles are not set up at OmniFM yet. Please try again later.")],
      });
      return true;
    }
    const { clientId, clientSecret } = credentials();
    const redirectUri = linkedRolesRedirectUri(origin());
    const secure = redirectUri.startsWith("https://");

    if (path === LINKED_ROLES_PATH) {
      const state = rememberState();
      res.writeHead(302, {
        ...getCommonSecurityHeaders(),
        Location: linkedRolesAuthorizeUrl({ clientId, redirectUri, state }),
        "Cache-Control": "no-store",
        "Set-Cookie": `${STATE_COOKIE}=${state}; Path=${LINKED_ROLES_PATH}; Max-Age=${STATE_TTL_MS / 1000}; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
      });
      res.end();
      return true;
    }

    const state = String(requestUrl.searchParams.get("state") || "");
    const code = String(requestUrl.searchParams.get("code") || "");
    if (!takeState(state, cookieValue(req, STATE_COOKIE)) || !code) {
      sendPage(res, 400, language, {
        ok: false,
        title: t("Das hat nicht geklappt", "That did not work"),
        text: [t("Der Link ist abgelaufen oder wurde schon benutzt. Starte das Verbinden bitte noch einmal in Discord.", "The link has expired or was used already. Please start connecting again in Discord.")],
      });
      return true;
    }
    try {
      const tokens = await exchangeLinkedRolesCode(code, redirectUri, { clientId, clientSecret, fetchImpl, now: now() });
      const userId = await fetchLinkedUserId(tokens.accessToken, { fetchImpl });
      if (!userId) throw new Error("discord_user_missing");
      const saved = await save(userId, tokens, { now: new Date(now()) });
      if (!saved.ok) throw new Error(`save_failed:${saved.error}`);
      const commander = (Array.isArray(runtimes) ? runtimes : []).find((runtime) => runtime?.role === "commander") || null;
      const result = await sync(userId, { premiumIds: premiumCustomersOf(commander), credentials: { clientId, clientSecret }, fetchImpl, now: new Date(now()), force: true });
      if (!result.ok) throw new Error(result.error || "push_failed");
      const hours = Number(result.metadata?.listening_hours) || 0;
      const premium = result.metadata?.premium_customer === "1";
      sendPage(res, 200, language, {
        ok: true,
        title: t("Verbunden", "Connected"),
        text: [
          t(`Discord kennt jetzt deine OmniFM-Werte: ${hours} Hörstunden, Premium-Kunde: ${premium ? "ja" : "nein"}.`, `Discord now knows your OmniFM values: ${hours} listening hours, premium customer: ${premium ? "yes" : "no"}.`),
          t("Hörstunden zählt OmniFM nur, wenn du das in Discord mit /meine-daten einschaltest. Die Werte gehen einmal am Tag neu an Discord.", "OmniFM counts listening hours only once you switch it on in Discord with /mydata. The values go to Discord again once a day."),
          t("Du kannst dieses Fenster jetzt schließen.", "You can close this window now."),
        ],
      });
    } catch (err) {
      log("WARN", `[linked-roles] Verbinden fehlgeschlagen: ${err?.message || err}`);
      sendPage(res, 502, language, {
        ok: false,
        title: t("Das hat nicht geklappt", "That did not work"),
        text: [t("Discord hat die Verbindung nicht bestätigt. Bitte versuche es in ein paar Minuten noch einmal.", "Discord did not confirm the connection. Please try again in a few minutes.")],
      });
    }
    return true;
  };
}
