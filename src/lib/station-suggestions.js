// ============================================================
// OmniFM: station suggestions from the community (#303), the rules
// ============================================================
// Pure: when two stream addresses are the same station, what a suggestion
// needs, and how its stream did over the last 24 hours.

export const SUGGESTION_STATUSES = Object.freeze(["pending", "accepted", "rejected"]);
export const MAX_PENDING_PER_PERSON = 3;
const DAY_MS = 86_400_000;

/**
 * One key per stream: scheme, "www.", a default port, a trailing slash and
 * the case of the host do not make another station.
 * "HTTPS://www.Radio.example:443/live/" and "http://radio.example/live" match.
 */
export function streamUrlKey(url) {
  let parsed;
  try {
    parsed = new URL(String(url || "").trim());
  } catch {
    return "";
  }
  if (!["http:", "https:"].includes(parsed.protocol) || !parsed.hostname) return "";
  const host = parsed.hostname.toLowerCase().replace(/^www\./, "");
  const port = parsed.port && !["80", "443"].includes(parsed.port) ? `:${parsed.port}` : "";
  const path = parsed.pathname.replace(/\/+$/, "") || "";
  return `${host}${port}${path}${parsed.search}`;
}

const clip = (value, max) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** What a person sent; { error } in the form's words when something is missing. */
export function readSuggestionInput(input = {}) {
  const name = clip(input.name, 60);
  if (name.length < 2) return { error: "name" };
  const url = String(input.url ?? "").trim();
  if (!streamUrlKey(url)) return { error: "url" };
  const homepage = String(input.homepage ?? "").trim();
  if (homepage && !/^https:\/\/\S+$/i.test(homepage)) return { error: "homepage" };
  return {
    suggestion: {
      name,
      url,
      urlKey: streamUrlKey(url),
      genre: clip(input.genre, 40),
      homepage: homepage.slice(0, 300),
      note: clip(input.note, 300),
    },
  };
}

/**
 * The stream checks of the last 24 hours: how many answered with audio.
 * @param {Array<{ at?: string | Date, ok?: boolean }>} checks
 */
export function suggestionHealth(checks = [], now = Date.now()) {
  const recent = checks.filter((check) => {
    const at = Date.parse(String(check?.at instanceof Date ? check.at.toISOString() : check?.at || ""));
    return Number.isFinite(at) && now - at <= DAY_MS;
  });
  const ok = recent.filter((check) => check.ok === true).length;
  return { checks: recent.length, ok, share: recent.length ? Math.round((ok / recent.length) * 100) : null };
}
