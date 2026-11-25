// ============================================================
// OmniFM Radio (#591): the own station as a fixed catalog entry.
// It is never stored (stations.json, MongoDB): the lists a server sees get it
// here, first, while the server may see it (isOmnifmRadioVisibleForGuild).
// The automatic fallback reads the catalog only and so never picks it.
// ============================================================
import { getOmnifmRadioConfig, isOmnifmRadioVisibleForGuild } from "./omnifm-radio-config.js";
import { resolveWebsiteUrl } from "../bot/runtime-links.js";
import { normalizeHttpsUrl } from "../lib/station-fields.js";

// The catalog drops everything but a-z and 0-9 from its keys, so
// "omnifm-radio", "omnifm_radio" and "omnifmradio" all name this station.
function compactKey(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Whether a key names OmniFM Radio; it is reserved, nobody else may use it. */
export function isOmnifmRadioKey(key, config = getOmnifmRadioConfig()) {
  const compact = compactKey(key);
  return Boolean(compact) && compact === compactKey(config.stationKey);
}

function hostAndPath(url) {
  try {
    const parsed = new URL(String(url || "").trim());
    return {
      host: parsed.hostname.toLowerCase().replace(/\.+$/, ""),
      path: parsed.pathname.replace(/\/+$/, "").toLowerCase(),
    };
  } catch {
    return { host: "", path: "" };
  }
}

/**
 * Whether a stream address is OmniFM Radio: only the fixed station may play
 * it, never a custom station or another catalog row. The AzuraCast server
 * (OMNIFM_RADIO_BASE_URL) is ours alone, so any path, port or query on it
 * counts. A stream on another host (OMNIFM_RADIO_STREAM_URL, e.g. a CDN that
 * also serves other stations) counts only with its own path.
 */
export function isOmnifmRadioUrl(url, config = getOmnifmRadioConfig()) {
  const target = hostAndPath(url);
  if (!target.host) return false;
  if (target.host === hostAndPath(config.baseUrl).host) return true;
  // #599: the internal address of AzuraCast is never a station of its own either.
  if (config.internalUrl && target.host === hostAndPath(config.internalUrl).host) return true;
  const stream = hostAndPath(config.streamUrl);
  return target.host === stream.host && Boolean(stream.path) && target.path === stream.path;
}

export function buildOmnifmRadioStation(config = getOmnifmRadioConfig()) {
  const website = String(resolveWebsiteUrl() || "").replace(/\/+$/, "");
  const logo = normalizeHttpsUrl(`${website}/brand/omnifm-discord-avatar-192.png`);
  const homepage = normalizeHttpsUrl(config.baseUrl).replace(/\/+$/, "");
  return {
    name: "OmniFM Radio",
    url: config.streamUrl,
    tier: "free",
    genre: "OmniFM",
    ...(homepage ? { homepage } : {}),
    ...(logo ? { logo } : {}),
  };
}

/**
 * The station map with OmniFM Radio first, when the server may see it.
 * guildId null means the public view (website): only while it is public.
 */
export function withOmnifmRadioStation(stations, guildId, config = getOmnifmRadioConfig()) {
  const source = stations && typeof stations === "object" ? stations : {};
  if (!isOmnifmRadioVisibleForGuild(guildId, config)) return source;
  return { [config.stationKey]: buildOmnifmRadioStation(config), ...source };
}

/** A sorted list with OmniFM Radio moved to the top; the rest keeps its order. */
export function omnifmRadioFirst(entries, keyOf = (entry) => entry?.key) {
  const config = getOmnifmRadioConfig();
  const isRadio = (entry) => isOmnifmRadioKey(keyOf(entry), config);
  return [...entries.filter(isRadio), ...entries.filter((entry) => !isRadio(entry))];
}
