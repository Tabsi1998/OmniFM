// ============================================================
// OmniFM: the logos of the servers' own stations (#340)
// ============================================================
//   /api/station-logos/<server>/<key>.png
// Public like the share cards: Discord loads the logo for the now-playing
// panel without a login. The link carries ?v=<saved at>, so a new logo gets
// a new link and the old one may be cached for long.
import { getCommonSecurityHeaders, methodNotAllowed } from "../../lib/api-helpers.js";
import { getStationLogo } from "../../station-logos-store.js";

const LOGO_PATH = /^\/api\/station-logos\/(\d{17,22})\/([a-z0-9_-]{1,40})\.png$/;

export function createStationLogoRoutesHandler({ getLogo = getStationLogo } = {}) {
  return async function handleStationLogoRoutes({ req, res, requestUrl }) {
    const path = requestUrl.pathname;
    if (!path.startsWith("/api/station-logos/")) return false;
    if (req.method !== "GET" && req.method !== "HEAD") {
      methodNotAllowed(res, ["GET", "HEAD"]);
      return true;
    }
    const match = LOGO_PATH.exec(path);
    const logo = match ? await getLogo(match[1], match[2]).catch(() => null) : null;
    if (!logo) {
      res.writeHead(404, { ...getCommonSecurityHeaders(), "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" });
      res.end(req.method === "HEAD" ? undefined : "Not found");
      return true;
    }
    res.writeHead(200, {
      ...getCommonSecurityHeaders(),
      "Content-Type": "image/png",
      "Content-Length": String(logo.png.length),
      "Cache-Control": requestUrl.searchParams.has("v") ? "public, max-age=31536000, immutable" : "public, max-age=3600",
      "Last-Modified": new Date(logo.updatedAt || Date.now()).toUTCString(),
    });
    res.end(req.method === "HEAD" ? undefined : logo.png);
    return true;
  };
}
