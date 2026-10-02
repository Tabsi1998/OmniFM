import { getDefaultLanguage } from "../i18n.js";
import { isPublicOrigin, originOf, webDomainOrigin } from "../lib/public-origin.js";
import { normalizeBotLanguage } from "../lib/bot-i18n.js";

export function resolveWebsiteUrl() {
  const explicit = String(process.env.PUBLIC_WEB_URL || "").trim();
  const domain = webDomainOrigin(process.env.WEB_DOMAIN);
  // A LAN or localhost PUBLIC_WEB_URL loses against a public WEB_DOMAIN.
  if (explicit && (isPublicOrigin(originOf(explicit)) || !domain)) return explicit;
  if (domain) return domain;
  return "https://omnifm.xyz";
}

export const WEBSITE_URL = resolveWebsiteUrl();

export function resolveDashboardUrl() {
  const base = String(WEBSITE_URL || "").replace(/\/+$/, "");
  return `${base}/?page=dashboard`;
}

export const DASHBOARD_URL = resolveDashboardUrl();

/** The public status page (#299): is OmniFM itself down, or only my server? */
export const STATUS_PAGE_URL = `${String(WEBSITE_URL || "").replace(/\/+$/, "")}/status`;

/** The guide "Erste Schritte" (#434): every step, and what helps when something does not work. */
export const GUIDE_URL = `${String(WEBSITE_URL || "").replace(/\/+$/, "")}/start`;

export function withLanguageParam(url, language) {
  const safeUrl = String(url || "").trim();
  if (!safeUrl) return safeUrl;
  const lang = normalizeBotLanguage(language, getDefaultLanguage());
  try {
    const parsed = new URL(safeUrl);
    parsed.searchParams.set("lang", lang);
    return parsed.toString();
  } catch {
    const hashIndex = safeUrl.indexOf("#");
    const base = hashIndex >= 0 ? safeUrl.slice(0, hashIndex) : safeUrl;
    const hash = hashIndex >= 0 ? safeUrl.slice(hashIndex) : "";
    const sep = base.includes("?") ? "&" : "?";
    return `${base}${sep}lang=${encodeURIComponent(lang)}${hash}`;
  }
}

export const SUPPORT_URL = "https://discord.gg/UeRkfGS43R";
export const INVITE_COMPONENT_PREFIX = "omnifm:invite:";
export const INVITE_COMPONENT_ID_OPEN = `${INVITE_COMPONENT_PREFIX}open`;
export const INVITE_COMPONENT_ID_REFRESH = `${INVITE_COMPONENT_PREFIX}refresh`;
export const INVITE_COMPONENT_ID_SELECT = `${INVITE_COMPONENT_PREFIX}select`;
export const INVITE_COMPONENT_ID_CLOSE = `${INVITE_COMPONENT_PREFIX}close`;
export const WORKERS_COMPONENT_PREFIX = "omnifm:workers:";
export const WORKERS_COMPONENT_ID_OPEN = `${WORKERS_COMPONENT_PREFIX}open`;
export const WORKERS_COMPONENT_ID_REFRESH = `${WORKERS_COMPONENT_PREFIX}refresh`;
export const WORKERS_COMPONENT_ID_PAGE_PREFIX = `${WORKERS_COMPONENT_PREFIX}page:`;
export const PLAY_COMPONENT_PREFIX = "omnifm:play:";
export const PLAY_COMPONENT_ID_OPEN = `${PLAY_COMPONENT_PREFIX}open`;
export const STATIONS_COMPONENT_PREFIX = "omnifm:stations:";
export const STATIONS_COMPONENT_ID_OPEN = `${STATIONS_COMPONENT_PREFIX}open`;
