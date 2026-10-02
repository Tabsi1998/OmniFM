// ============================================================
// OmniFM: the website's pictures come from this site (#469)
// ============================================================
// Covers, station logos and partner logos went from Apple, the stations and
// the partners straight into the visitor's browser. The website's answers
// now name a picture by what it shows; /api/image fetches it on the server
// (api/routes/image-routes.js). The charts post in Discord keeps the
// original links: there Discord fetches the pictures, not a visitor.
import { createHash } from "node:crypto";
import { splitDisplayTitle } from "./charts.js";

export const IMAGE_PATH = "/api/image";
export const COVER_SIZES = Object.freeze([100, 600]);

/** A catalogue station's logo. */
export function stationImagePath(key) {
  return `${IMAGE_PATH}/station/${encodeURIComponent(String(key || ""))}`;
}

/** The cover the song search finds for a term, small (100) or large (600). */
export function coverImagePath(term, size = 600) {
  const params = new URLSearchParams({ term: String(term || "").trim().slice(0, 120), size: String(size === 100 ? 100 : 600) });
  return `${IMAGE_PATH}/cover?${params}`;
}

/**
 * The logo of the owner console's partner number `index` (from 0). With the
 * logo's source the address changes when the logo does, so no browser keeps
 * showing the old one for the day it may cache it.
 */
export function sponsorImagePath(index, source = "") {
  const version = source ? `?v=${createHash("sha256").update(String(source)).digest("hex").slice(0, 10)}` : "";
  return `${IMAGE_PATH}/sponsor/${Number(index)}${version}`;
}

/** The search term the charts use for a song's cover ("Artist Title", or the title alone). */
export function chartCoverTerm(displayTitle) {
  const { artist, title } = splitDisplayTitle(displayTitle);
  return artist ? `${artist} ${title}` : title;
}

/**
 * /api/cover for the website: the same answer, the pictures from this site.
 * @param {any} result what coverLookup() found
 */
export function websiteCover(result) {
  if (!result?.ok) return result;
  return {
    ...result,
    artwork: result.artwork ? coverImagePath(result.query, 600) : null,
    artworkSmall: result.artworkSmall ? coverImagePath(result.query, 100) : null,
  };
}

/**
 * /api/charts for the website: logos and covers from this site.
 * @param {any} chart what weeklyChart() gives
 */
export function websiteChart(chart) {
  return {
    ...chart,
    stations: (chart?.stations || []).map((entry) => ({ ...entry, logo: entry.logo ? stationImagePath(entry.key) : null })),
    songs: (chart?.songs || []).map((entry) => ({ ...entry, cover: entry.cover ? coverImagePath(chartCoverTerm(entry.displayTitle), 600) : null })),
  };
}

/**
 * /api/marketing for the website: each partner's logo from this site.
 * @param {{ sponsors?: { name: string, logoUrl: string, url: string }[], botListings?: any[] }} marketing
 */
export function websiteMarketing(marketing) {
  return {
    ...marketing,
    sponsors: (marketing?.sponsors || []).map((sponsor, index) => ({ ...sponsor, logoUrl: sponsor.logoUrl ? sponsorImagePath(index, sponsor.logoUrl) : "" })),
  };
}
