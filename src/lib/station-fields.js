// ============================================================
// OmniFM: the optional catalog fields of a station (#267)
// ============================================================
// Genre, country, language, colour, logo and homepage. The now-playing panel
// uses colour and logo, the station browser genre and logo. Only https
// links and #RRGGBB colours pass; anything else is dropped, never stored.

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function trimmed(value, max) {
  return String(value ?? "").trim().slice(0, max);
}

export function normalizeStationColor(value) {
  const text = String(value ?? "").trim();
  if (HEX_COLOR.test(text)) return text.toUpperCase();
  if (/^[0-9a-f]{6}$/i.test(text)) return `#${text.toUpperCase()}`;
  return "";
}

export function normalizeHttpsUrl(value, max = 500) {
  const text = String(value ?? "").trim();
  if (!text || text.length > max) return "";
  try {
    const url = new URL(text);
    return url.protocol === "https:" && url.hostname ? url.toString() : "";
  } catch {
    return "";
  }
}

/** The optional fields of one station, cleaned; empty ones are left out. */
export function normalizeStationCatalogFields(raw = {}) {
  const fields = {
    genre: trimmed(raw.genre || raw.category, 80) || "Radio",
    country: trimmed(raw.country, 60),
    language: trimmed(raw.language, 40),
    color: normalizeStationColor(raw.color),
    logo: normalizeHttpsUrl(raw.logo),
    homepage: normalizeHttpsUrl(raw.homepage),
  };
  for (const key of ["country", "language", "color", "logo", "homepage"]) {
    if (!fields[key]) delete fields[key];
  }
  return fields;
}
