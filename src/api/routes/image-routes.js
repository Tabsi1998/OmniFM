// ============================================================
// OmniFM: the website's pictures from this site (#469)
// ============================================================
//   /api/image/station/<key>         a catalogue station's logo
//   /api/image/cover?term=…&size=…   the cover the song search finds
//   /api/image/sponsor/<n>           a partner's logo from the owner console
// The server fetches the picture and keeps it for a day, so a visitor's
// browser never talks to Apple, a station or a partner. Only what these
// three name is fetched, never an address from the request: no open proxy.
// A cover is one the website's own search found before (/api/cover, the
// charts): a request for a picture never makes the server search iTunes.
// The kept pictures stay under 32 MB together.
// Pictures only, at most 2 MB; an SVG comes with a sandbox, so it cannot run
// scripts under this site's name.
import { getCommonSecurityHeaders, methodNotAllowed } from "../../lib/api-helpers.js";
import { loadOwnerConfigRaw } from "../../lib/owner-config.js";
import { cachedCover, marketingResponse } from "../../lib/owner-public.js";
import { getPublicStationEntries } from "../../lib/public-stations.js";
import { safeFetch } from "../../lib/safe-outbound-http.js";
import { loadStations } from "../../stations-store.js";

export const IMAGE_MAX_BYTES = 2 * 1024 * 1024;
const KEEP_MS = 24 * 60 * 60 * 1000;
const MISS_MS = 5 * 60 * 1000;
const CACHE_MAX = 300;
const CACHE_BYTES = 32 * 1024 * 1024;
export const IMAGE_TYPES = Object.freeze(["image/png", "image/jpeg", "image/webp", "image/gif", "image/avif", "image/svg+xml"]);

const STATION_PATH = /^\/api\/image\/station\/([a-z0-9_-]{1,80})$/i;
const SPONSOR_PATH = /^\/api\/image\/sponsor\/(\d{1,3})$/;

/** The address behind a picture path, or "" when the path names nothing we know. */
async function sourceFor(requestUrl, { stations, lookupCover, marketing }) {
  const path = requestUrl.pathname;
  const station = STATION_PATH.exec(path);
  if (station) {
    const entry = getPublicStationEntries(stations()?.stations || {}).find(([key]) => key === station[1]);
    const logo = String(entry?.[1]?.logo || "");
    return /^https:\/\//i.test(logo) ? logo : "";
  }
  if (path === "/api/image/cover") {
    const term = String(requestUrl.searchParams.get("term") || "").trim();
    if (!term) return "";
    const found = await lookupCover({ term });
    const url = requestUrl.searchParams.get("size") === "100" ? found?.artworkSmall : found?.artwork;
    return found?.ok && /^https:\/\//i.test(String(url || "")) ? String(url) : "";
  }
  const sponsor = SPONSOR_PATH.exec(path);
  if (sponsor) {
    const logo = String((await marketing())?.sponsors?.[Number(sponsor[1])]?.logoUrl || "");
    return /^https:\/\//i.test(logo) ? logo : "";
  }
  return "";
}

/** Fetches a picture: an allowed type, at most IMAGE_MAX_BYTES, or null. */
export async function fetchPicture(url, fetchImpl = safeFetch) {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "OmniFM/1.0 (+https://omnifm.xyz)", Accept: "image/*" },
    timeoutMs: 8000,
  });
  const body = response?.body;
  const type = String(response?.headers?.get?.("content-type") || "").split(";")[0].trim().toLowerCase();
  const declared = Number(response?.headers?.get?.("content-length") || 0);
  if (!body || response.status >= 400 || !IMAGE_TYPES.includes(type) || declared > IMAGE_MAX_BYTES) {
    await body?.cancel?.().catch(() => null);
    return null;
  }
  const reader = body.getReader();
  const chunks = [];
  let size = 0;
  for (;;) {
    // eslint-disable-next-line no-await-in-loop -- the parts of one download, in order
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > IMAGE_MAX_BYTES) {
      // eslint-disable-next-line no-await-in-loop
      await reader.cancel().catch(() => null);
      return null;
    }
    chunks.push(value);
  }
  return { type, body: Buffer.concat(chunks) };
}

export function createImageRoutesHandler({
  stations = loadStations,
  lookupCover = async (input) => cachedCover(input),
  marketing = async () => marketingResponse(await loadOwnerConfigRaw()),
  fetchImpl = safeFetch,
  now = Date.now,
  cacheBytes = CACHE_BYTES,
} = {}) {
  // Source address -> { at, picture }: a day for a picture, five minutes for a
  // miss; the longest unused goes first once there are too many or too much.
  const cache = new Map();
  let keptBytes = 0;

  function forget(url) {
    const old = cache.get(url);
    if (!old) return;
    keptBytes -= old.picture?.body.length || 0;
    cache.delete(url);
  }

  async function pictureFor(url) {
    const hit = cache.get(url);
    if (hit && now() - hit.at < (hit.picture ? KEEP_MS : MISS_MS)) {
      cache.delete(url);
      cache.set(url, hit);
      return hit.picture;
    }
    const picture = await fetchPicture(url, fetchImpl).catch(() => null);
    forget(url);
    cache.set(url, { at: now(), picture });
    keptBytes += picture?.body.length || 0;
    while (cache.size > CACHE_MAX || keptBytes > cacheBytes) forget(cache.keys().next().value);
    return picture;
  }

  return async function handleImageRoutes({ req, res, requestUrl }) {
    if (!requestUrl.pathname.startsWith("/api/image/")) return false;
    if (req.method !== "GET" && req.method !== "HEAD") {
      methodNotAllowed(res, ["GET", "HEAD"]);
      return true;
    }
    const source = await sourceFor(requestUrl, { stations, lookupCover, marketing }).catch(() => "");
    const picture = source ? await pictureFor(source) : null;
    if (!picture) {
      res.writeHead(404, { ...getCommonSecurityHeaders(), "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "public, max-age=300" });
      res.end(req.method === "HEAD" ? undefined : "Not found");
      return true;
    }
    res.writeHead(200, {
      ...getCommonSecurityHeaders(),
      "Content-Type": picture.type,
      "Content-Length": String(picture.body.length),
      "Cache-Control": "public, max-age=86400",
      // An SVG from elsewhere must not run scripts under this site's name.
      "Content-Security-Policy": "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox",
    });
    res.end(req.method === "HEAD" ? undefined : picture.body);
    return true;
  };
}
