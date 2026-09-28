function isOfficialPublicStation(key, station) {
  const stationKey = String(key || "").trim().toLowerCase();
  if (!stationKey || stationKey.startsWith("custom:")) return false;

  const tier = String(station?.tier || "free").trim().toLowerCase();
  return tier === "free" || tier === "pro";
}

function getPublicStationEntries(stationsMap) {
  return Object.entries(stationsMap || {}).filter(([key, station]) => isOfficialPublicStation(key, station));
}

function sortPublicStationEntries(entries) {
  const tierOrder = { free: 0, pro: 1 };
  return [...entries].sort((a, b) => {
    const aTier = String(a?.tier || "free").toLowerCase();
    const bTier = String(b?.tier || "free").toLowerCase();
    const aRank = tierOrder[aTier] ?? 99;
    const bRank = tierOrder[bTier] ?? 99;
    return aRank - bRank || String(a?.name || "").localeCompare(String(b?.name || ""));
  });
}

function buildPublicStationCatalog(stationsData) {
  const sourceMap = stationsData?.stations || {};
  const entries = getPublicStationEntries(sourceMap).map(([key, station]) => ({
    key,
    name: station?.name || key,
    url: station?.url || "",
    tier: String(station?.tier || "free").toLowerCase(),
    // #430: the website's season rubric.
    ...(Array.isArray(station?.seasons) && station.seasons.length ? { seasons: station.seasons } : {}),
  }));
  const sorted = sortPublicStationEntries(entries);
  const publicKeys = new Set(sorted.map((station) => station.key));
  const defaultStationKey = publicKeys.has(stationsData?.defaultStationKey)
    ? stationsData.defaultStationKey
    : (sorted[0]?.key || null);
  return {
    defaultStationKey,
    qualityPreset: stationsData?.qualityPreset || "custom",
    total: sorted.length,
    freeStations: sorted.filter((station) => station.tier === "free").length,
    proStations: sorted.filter((station) => station.tier === "pro").length,
    ultimateStations: 0,
    stations: sorted,
  };
}

export {
  isOfficialPublicStation,
  getPublicStationEntries,
  buildPublicStationCatalog,
};
