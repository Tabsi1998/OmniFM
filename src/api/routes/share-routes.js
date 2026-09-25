// ============================================================
// OmniFM: link previews for Discord (#279)
// ============================================================
// The website is a single-page app, so every omnifm.xyz link looked the same
// in Discord. A share link carries its own Open Graph tags (title, text,
// theme-color = the station's colour, a 1200 × 630 card) and then sends the
// person on to the website. Discord reads the tags; people only see the
// website.
//   /api/share/station/<key>        page with the tags, then /stations?station=<key>
//   /api/share/station/<key>.png    the card
//   /api/share/page/<premium|stations|invite>[.png]
import { getCommonSecurityHeaders, methodNotAllowed } from "../../lib/api-helpers.js";
import { resolveRequestLanguage } from "../../lib/request-language.js";
import { fetchCardImage, renderPageCard, renderStationCard } from "../../lib/share-card.js";
import { loadStations } from "../../stations-store.js";

const STATION_PATH = /^\/api\/share\/station\/([a-z0-9][a-z0-9_-]{0,79})(\.png)?$/i;
const PAGE_PATH = /^\/api\/share\/page\/(premium|stations|invite)(\.png)?$/;

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** The page Discord reads: Open Graph tags, then on to `target`. */
export function buildSharePageHtml({ language = "de", title, description, imageUrl, url, target, color = "#FF6B00" }) {
  const e = escapeHtml;
  return `<!doctype html>
<html lang="${language === "en" ? "en" : "de"}">
<head>
<meta charset="utf-8">
<title>${e(title)}</title>
<meta name="description" content="${e(description)}">
<meta property="og:type" content="website">
<meta property="og:site_name" content="OmniFM">
<meta property="og:title" content="${e(title)}">
<meta property="og:description" content="${e(description)}">
<meta property="og:url" content="${e(url)}">
<meta property="og:image" content="${e(imageUrl)}">
<meta property="og:image:type" content="image/png">
<meta property="og:image:width" content="1200">
<meta property="og:image:height" content="630">
<meta name="twitter:card" content="summary_large_image">
<meta name="theme-color" content="${e(color)}">
<meta http-equiv="refresh" content="0; url=${e(target)}">
<link rel="canonical" href="${e(target)}">
</head>
<body><a href="${e(target)}">${e(title)}</a></body>
</html>
`;
}

export function createShareRoutesHandler({ websiteUrl, getInviteUrl = () => null, fetchImage = fetchCardImage }) {
  const base = String(websiteUrl || "https://omnifm.xyz").replace(/\/+$/, "");

  function send(res, status, contentType, body, { maxAge = 600, headOnly = false } = {}) {
    res.writeHead(status, {
      ...getCommonSecurityHeaders(),
      "Content-Type": contentType,
      "Cache-Control": status === 200 ? `public, max-age=${maxAge}` : "no-store",
    });
    res.end(headOnly ? undefined : body);
  }

  return async function handleShareRoutes({ req, res, requestUrl, runtimes }) {
    const path = requestUrl.pathname;
    if (!path.startsWith("/api/share/")) return false;
    if (req.method !== "GET" && req.method !== "HEAD") {
      methodNotAllowed(res, ["GET", "HEAD"]);
      return true;
    }
    const headOnly = req.method === "HEAD";
    const language = resolveRequestLanguage(req.headers, requestUrl.searchParams.get("lang") || "", "de");
    const t = (de, en) => (language === "de" ? de : en);
    const langQuery = `?lang=${language}`;

    const stationMatch = STATION_PATH.exec(path);
    if (stationMatch) {
      const key = stationMatch[1].toLowerCase();
      const station = loadStations()?.stations?.[key];
      if (!station) {
        send(res, 404, "text/plain; charset=utf-8", t("Diesen Sender gibt es nicht.", "This station does not exist."), { headOnly });
        return true;
      }
      const color = /^#[0-9a-f]{6}$/i.test(String(station.color || "")) ? station.color : "#FF6B00";
      if (stationMatch[2]) {
        const png = await renderStationCard({ key, name: station.name, genre: station.genre, color, logoUrl: station.logo, t, fetchImage });
        send(res, 200, "image/png", png, { maxAge: 86400, headOnly });
        return true;
      }
      send(res, 200, "text/html; charset=utf-8", buildSharePageHtml({
        language,
        title: t(`${station.name} – 24/7 in Discord`, `${station.name} – 24/7 in Discord`),
        description: t(
          `${station.genre ? `${station.genre} · ` : ""}Hör ${station.name} rund um die Uhr in deinem Discord-Server – mit OmniFM.`,
          `${station.genre ? `${station.genre} · ` : ""}Listen to ${station.name} around the clock in your Discord server – with OmniFM.`
        ),
        imageUrl: `${base}/api/share/station/${key}.png${langQuery}`,
        url: `${base}/api/share/station/${key}${langQuery}`,
        target: `${base}/stations?station=${encodeURIComponent(key)}`,
        color,
      }), { headOnly });
      return true;
    }

    const pageMatch = PAGE_PATH.exec(path);
    if (pageMatch) {
      const page = pageMatch[1];
      const pages = {
        premium: {
          title: t("OmniFM Premium", "OmniFM Premium"),
          subtitle: t("Mehr Worker, bessere Qualität und eigene Sender für deinen Server", "More workers, better quality and your own stations for your server"),
          target: `${base}/premium`,
        },
        stations: {
          title: t("Über 100 Sender für Discord", "Over 100 stations for Discord"),
          subtitle: t("Von Ambient bis Techno – rund um die Uhr in deinem Server", "From ambient to techno – around the clock in your server"),
          target: `${base}/stations`,
        },
        invite: {
          title: t("OmniFM einladen", "Invite OmniFM"),
          subtitle: t("24/7 Radio in deinem Discord-Server, in einer Minute eingerichtet", "24/7 radio in your Discord server, set up in a minute"),
          target: getInviteUrl(runtimes) || `${base}/`,
        },
      };
      const entry = pages[page];
      if (pageMatch[2]) {
        const png = await renderPageCard({ page, title: entry.title, subtitle: entry.subtitle, t });
        send(res, 200, "image/png", png, { maxAge: 86400, headOnly });
        return true;
      }
      send(res, 200, "text/html; charset=utf-8", buildSharePageHtml({
        language,
        title: entry.title,
        description: entry.subtitle,
        imageUrl: `${base}/api/share/page/${page}.png${langQuery}`,
        url: `${base}/api/share/page/${page}${langQuery}`,
        target: entry.target,
      }), { headOnly });
      return true;
    }

    send(res, 404, "text/plain; charset=utf-8", "Not found", { headOnly });
    return true;
  };
}
