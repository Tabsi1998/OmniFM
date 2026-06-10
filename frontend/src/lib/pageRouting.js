const DEFAULT_PAGE = "home";

const PAGE_ALIASES = new Map([
  ["home", "home"],
  ["index", "home"],
  ["dashboard", "dashboard"],
  ["stations", "stations"],
  ["sender", "stations"],
  ["premium", "premium"],
  ["pricing", "premium"],
  ["preise", "premium"],
  ["faq", "faq"],
  ["fragen", "faq"],
  ["imprint", "imprint"],
  ["impressum", "imprint"],
  ["privacy", "privacy"],
  ["datenschutz", "privacy"],
  ["privacy-policy", "privacy"],
  ["terms", "terms"],
  ["tos", "terms"],
  ["terms-of-service", "terms"],
  ["nutzungsbedingungen", "terms"],
  ["agb", "terms"],
]);

const PATH_ALIASES = new Map([
  ["/", "home"],
  ["/index.html", "home"],
  ["/home", "home"],
  ["/dashboard", "dashboard"],
  ["/stations", "stations"],
  ["/sender", "stations"],
  ["/premium", "premium"],
  ["/pricing", "premium"],
  ["/preise", "premium"],
  ["/faq", "faq"],
  ["/fragen", "faq"],
  ["/imprint", "imprint"],
  ["/impressum", "imprint"],
  ["/privacy", "privacy"],
  ["/datenschutz", "privacy"],
  ["/privacy-policy", "privacy"],
  ["/terms", "terms"],
  ["/tos", "terms"],
  ["/terms-of-service", "terms"],
  ["/nutzungsbedingungen", "terms"],
  ["/agb", "terms"],
]);

export function normalizePageId(rawPage, fallback = "") {
  const normalized = String(rawPage || "").trim().toLowerCase();
  if (!normalized) return fallback;
  return PAGE_ALIASES.get(normalized) || fallback;
}

export function normalizePathname(pathname = "/") {
  const normalized = `/${String(pathname || "").trim().replace(/^\/+/, "")}`
    .replace(/\/+/g, "/")
    .replace(/\/+$/, "");
  return normalized || "/";
}

export function resolvePageFromUrl(urlLike) {
  try {
    const url = urlLike instanceof URL ? urlLike : new URL(String(urlLike || "/"), "https://omnifm.local");
    const pageFromQuery = normalizePageId(url.searchParams.get("page"), "");
    if (pageFromQuery) return pageFromQuery;
    const pageFromPath = PATH_ALIASES.get(normalizePathname(url.pathname));
    if (pageFromPath) return pageFromPath;
    return DEFAULT_PAGE;
  } catch {
    return DEFAULT_PAGE;
  }
}

export function getCanonicalPagePath(page, locale = "de") {
  const normalizedPage = normalizePageId(page, DEFAULT_PAGE);
  const normalizedLocale = String(locale || "de").trim().toLowerCase();
  const useGerman = normalizedLocale.startsWith("de");

  if (normalizedPage === "dashboard") return "/dashboard";
  if (normalizedPage === "stations") return "/stations";
  if (normalizedPage === "premium") return "/premium";
  if (normalizedPage === "faq") return "/faq";
  if (normalizedPage === "imprint") return useGerman ? "/impressum" : "/imprint";
  if (normalizedPage === "privacy") return useGerman ? "/datenschutz" : "/privacy";
  if (normalizedPage === "terms") return useGerman ? "/nutzungsbedingungen" : "/terms";
  return "/";
}

export function buildPageHref(locale, page, searchParams = null) {
  const normalizedPage = normalizePageId(page, DEFAULT_PAGE);
  const params = searchParams instanceof URLSearchParams
    ? new URLSearchParams(searchParams)
    : new URLSearchParams(searchParams || undefined);

  params.delete("page");
  if (locale) {
    params.set("lang", locale);
  } else {
    params.delete("lang");
  }

  const path = getCanonicalPagePath(normalizedPage, locale);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}`;
}

export function buildHomeHref(locale, hash = "", searchParams = null) {
  return `${buildPageHref(locale, "home", searchParams)}${hash || ""}`;
}

export function getSectionAnchorForPage(page) {
  const normalizedPage = normalizePageId(page, DEFAULT_PAGE);
  if (normalizedPage === "stations") return "stations";
  if (normalizedPage === "premium") return "premium";
  if (normalizedPage === "faq") return "faq";
  return "";
}

export function getSpaRoutePaths() {
  return [...new Set(PATH_ALIASES.keys())];
}
