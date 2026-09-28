// ============================================================
// OmniFM: the automatic fallback station of every plan (#413)
// ============================================================
// When a stream fails, the worker tries the server's own chain first
// (Ultimate), then these: stations of the server's plan, the same genre
// first, then a related one, then any other; none the health check found
// down. The failback (#187) brings the server back once its station plays.
import { loadStations, filterStationsByTier } from "../stations-store.js";
import { getTier } from "../core/entitlements.js";
import { getDb, isConnected } from "../lib/db.js";
import { automaticFallbackKeys } from "../lib/failover-chain.js";

const DOWN_CACHE_MS = 60_000;
let downCache = { at: 0, keys: new Set() };

/**
 * Stations the commander's health check found down twice in a row, read from
 * MongoDB at most once a minute (the workers run in their own processes).
 */
export async function downStationKeys({ now = Date.now(), db = isConnected() ? getDb() : null } = {}) {
  if (downCache.at && now - downCache.at < DOWN_CACHE_MS) return downCache.keys;
  let keys = downCache.keys;
  if (db) {
    try {
      const rows = await db.collection("station_health")
        .find({ status: "down", consecutiveFailures: { $gte: 2 } }, { projection: { _id: 0, key: 1 } })
        .toArray();
      keys = new Set(rows.map((row) => String(row.key || "").toLowerCase()).filter(Boolean));
    } catch {
      // The last known list stays; a failed read never blocks a failover.
    }
  }
  downCache = { at: now, keys };
  return keys;
}

export function resetDownStationKeysForTests() {
  downCache = { at: 0, keys: new Set() };
}

/**
 * The automatic fallback stations for a server whose station failed.
 * @param {string} guildId
 * @param {{ key?: string, station?: { genre?: string } | null }} resolvedStation
 */
export async function automaticFallbackKeysForGuild(guildId, resolvedStation) {
  const catalog = loadStations()?.stations || {};
  const key = String(resolvedStation?.key || "");
  const genre = resolvedStation?.station?.genre || catalog[key]?.genre || "";
  return automaticFallbackKeys({
    currentKey: key,
    genre,
    stations: filterStationsByTier(catalog, getTier(guildId)),
    downKeys: await downStationKeys(),
  });
}
