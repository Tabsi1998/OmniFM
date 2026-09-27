// OmniFM API: station choices, fallback station and failover chain previews of the dashboard.
// Split out of src/api/server.js (#293).
import { normalizeFailoverChain } from "../../lib/failover-chain.js";
import { loadStations, filterStationsByTier } from "../../stations-store.js";
import { getGuildStations as getCustomStations } from "../../custom-stations.js";
import { getTier } from "../../core/entitlements.js";

function buildDashboardSelectableStations(guildId) {
  const tier = getTier(guildId);
  const scopedStations = filterStationsByTier(loadStations().stations || {}, tier);
  const customStations = getCustomStations(guildId) || {};
  const entries = [];

  for (const [key, station] of Object.entries(customStations)) {
    const normalizedKey = `custom:${String(key || "").trim().toLowerCase()}`;
    entries.push({
      value: normalizedKey,
      name: station?.name || key,
      label: `${station?.name || key} (Custom)`,
      tier: "ultimate",
      isCustom: true,
      folder: station?.folder || "",
      tags: Array.isArray(station?.tags) ? station.tags : [],
    });
  }

  for (const [key, station] of Object.entries(scopedStations)) {
    const tierLabel = String(station?.tier || "free").trim().toLowerCase();
    const suffix = tierLabel === "free" ? "" : ` (${tierLabel.charAt(0).toUpperCase()}${tierLabel.slice(1)})`;
    entries.push({
      value: key,
      name: station?.name || key,
      label: `${station?.name || key}${suffix}`,
      tier: tierLabel,
      isCustom: false,
    });
  }

  return entries;
}

export function buildDashboardFallbackStationPreview(guildId, rawFallbackStation) {
  const selectedValue = String(rawFallbackStation || "").trim().toLowerCase();
  if (!selectedValue) {
    return {
      configured: false,
      valid: true,
      key: "",
      name: "",
      label: "",
      tier: null,
      isCustom: false,
    };
  }

  const match = buildDashboardSelectableStations(guildId).find((entry) => entry.value === selectedValue) || null;
  if (!match) {
    return {
      configured: true,
      valid: false,
      key: selectedValue,
      name: "",
      label: selectedValue,
      tier: null,
      isCustom: selectedValue.startsWith("custom:"),
    };
  }

  return {
    configured: true,
    valid: true,
    key: match.value,
    name: match.name,
    label: match.label,
    tier: match.tier,
    isCustom: match.isCustom,
  };
}

export function resolveDashboardFailoverChain(settings = {}) {
  const configuredChain = normalizeFailoverChain(settings?.failoverChain || []);
  if (configuredChain.length > 0) return configuredChain;
  return normalizeFailoverChain(settings?.fallbackStation || "");
}

export function buildDashboardFailoverChainPreview(guildId, rawFailoverChain = [], rawFallbackStation = "") {
  const chain = normalizeFailoverChain(
    Array.isArray(rawFailoverChain) && rawFailoverChain.length > 0
      ? rawFailoverChain
      : rawFallbackStation
  );
  return chain.map((stationKey, index) => ({
    order: index + 1,
    ...buildDashboardFallbackStationPreview(guildId, stationKey),
  }));
}
