const MAX_FAILOVER_CHAIN_LENGTH = 5;

function normalizeFailoverKey(value) {
  return String(value || "").trim().toLowerCase();
}

function normalizeFailoverChain(input, maxLength = MAX_FAILOVER_CHAIN_LENGTH) {
  const values = Array.isArray(input)
    ? input
    : input === undefined || input === null || input === ""
      ? []
      : [input];
  const out = [];
  const seen = new Set();

  for (const rawValue of values) {
    const key = normalizeFailoverKey(rawValue);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(key);
    if (out.length >= maxLength) break;
  }

  return out;
}

/**
 * Related genres of the catalogue (#413): a failover stays in the station's
 * genre first, then in its family. The 20 Free stations have most genres only
 * once, so the family matters.
 */
const GENRE_FAMILIES = [
  ["ambient", "chillout", "lounge", "lo-fi"],
  ["electronic", "edm & festival", "house", "techno", "trance", "hardstyle & hardcore"],
  ["rock", "metal", "indie & alternative", "80s & synthpop"],
  ["pop & charts", "schlager & party", "latin", "r&b", "hip hop & rap", "reggae & dancehall"],
  ["classical", "jazz", "blues", "world"],
];

const normalizeGenre = (value) => String(value || "").trim().toLowerCase();

/**
 * The stations to fall back to when a stream fails, on every plan (#413):
 * the same genre first, then a related one, then any other station of the
 * plan; stations the health check found down are left out, catalogue order
 * decides within each step.
 * @param {{ currentKey?: string, genre?: string, stations?: Record<string, { genre?: string }>, downKeys?: Set<string>, limit?: number }} [input]
 * @returns {string[]}
 */
function automaticFallbackKeys({ currentKey = "", genre = "", stations = {}, downKeys = new Set(), limit = 3 } = {}) {
  const current = normalizeFailoverKey(currentKey);
  const wanted = normalizeGenre(genre);
  const family = GENRE_FAMILIES.find((members) => members.includes(wanted)) || null;
  const step = (stationGenre) => {
    if (wanted && stationGenre === wanted) return 0;
    if (family && family.includes(stationGenre)) return 1;
    return 2;
  };
  return Object.entries(stations || {})
    .map(([key, station], index) => ({ key: normalizeFailoverKey(key), step: step(normalizeGenre(station?.genre)), index }))
    .filter((entry) => entry.key && entry.key !== current && !entry.key.startsWith("custom:") && !downKeys.has(entry.key))
    .sort((a, b) => a.step - b.step || a.index - b.index)
    .slice(0, Math.max(0, limit))
    .map((entry) => entry.key);
}

/**
 * The candidates in order: the server's own chain (Ultimate), the old single
 * fallback station, then the automatic ones of the plan (#413).
 */
function buildFailoverCandidateChain({
  currentStationKey = "",
  configuredChain = [],
  fallbackStation = "",
  automaticFallbackKey = "",
  automaticKeys = [],
} = {}) {
  const combined = normalizeFailoverChain([
    ...normalizeFailoverChain(configuredChain),
    fallbackStation,
    automaticFallbackKey,
    ...(Array.isArray(automaticKeys) ? automaticKeys : []),
  ]);
  const currentKey = normalizeFailoverKey(currentStationKey);
  return combined.filter((key) => key !== currentKey);
}

function getPrimaryFailoverStation(configuredChain = [], fallbackStation = "") {
  const chain = buildFailoverCandidateChain({
    configuredChain,
    fallbackStation,
  });
  return chain[0] || "";
}

export {
  MAX_FAILOVER_CHAIN_LENGTH,
  automaticFallbackKeys,
  buildFailoverCandidateChain,
  getPrimaryFailoverStation,
  normalizeFailoverChain,
  normalizeFailoverKey,
};
