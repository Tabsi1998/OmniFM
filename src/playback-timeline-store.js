// ============================================================
// OmniFM: the playback timeline of a server (#304)
// ============================================================
// Every change of a bot's playback phase (#210) on a server, for the
// dashboard's live view: when it played, connected, recovered, was parked or
// stopped, and which station ran. One document per change, no person; MongoDB
// removes them after 48 hours (TTL). Without MongoDB nothing is kept, and a
// failing write never reaches the playback.
import { getDb, isConnected } from "./lib/db.js";

export const PLAYBACK_TIMELINE_COLLECTION = "playback_timeline";
export const PLAYBACK_TIMELINE_KEEP_MS = 48 * 3_600_000;

let indexesReady = null;

function collection() {
  if (!isConnected() || !getDb()) return null;
  return getDb().collection(PLAYBACK_TIMELINE_COLLECTION);
}

async function ensureIndexes(timeline) {
  if (!indexesReady) {
    indexesReady = Promise.all([
      timeline.createIndex({ guildId: 1, at: -1 }, { name: "guild_time" }),
      timeline.createIndex({ expiresAt: 1 }, { name: "ttl", expireAfterSeconds: 0 }),
    ]).catch((error) => {
      indexesReady = null;
      throw error;
    });
  }
  return indexesReady;
}

const clip = (value, max) => String(value ?? "").trim().slice(0, max);

/**
 * Stores one phase change of a bot on a server. `transition` is what
 * notePlaybackPhase returns; `state` gives the station at that moment.
 * @param {{
 *   guildId?: string,
 *   bot?: { id?: string, name?: string },
 *   transition?: { from?: string, to?: string, at?: number, reason?: string, unexpected?: boolean },
 *   state?: Record<string, any>,
 * }} [input]
 */
export async function recordPlaybackTimelineEntry({ guildId, bot = {}, transition, state = {} } = {}) {
  const timeline = collection();
  const gid = clip(guildId, 32);
  if (!timeline || !/^\d{17,22}$/.test(gid) || !transition?.to) return false;
  const at = new Date(Number(transition.at) || Date.now());
  try {
    await ensureIndexes(timeline);
    await timeline.insertOne({
      guildId: gid,
      botId: clip(bot.id, 80),
      botName: clip(bot.name, 80),
      phase: clip(transition.to, 20),
      from: clip(transition.from, 20),
      reason: clip(transition.reason, 80),
      unexpected: transition.unexpected === true,
      stationKey: clip(state?.currentStationKey, 120) || null,
      stationName: clip(state?.currentStationName || state?.currentStationKey, 120) || null,
      failover: state?.failoverActive === true,
      at,
      expiresAt: new Date(at.getTime() + PLAYBACK_TIMELINE_KEEP_MS),
    });
    return true;
  } catch {
    return false;
  }
}

/** The kept changes of a server, oldest first (up to 48 hours back). */
export async function readPlaybackTimeline(guildId, { now = Date.now(), limit = 2000 } = {}) {
  const timeline = collection();
  const gid = clip(guildId, 32);
  if (!timeline || !/^\d{17,22}$/.test(gid)) return [];
  const rows = await timeline
    .find({ guildId: gid, at: { $gte: new Date(now - PLAYBACK_TIMELINE_KEEP_MS) } }, { projection: { _id: 0, guildId: 0, expiresAt: 0 } })
    // Two changes in the same millisecond keep their order: _id grows with each insert.
    .sort({ at: -1, _id: -1 })
    .limit(Math.max(1, Math.min(5000, Number(limit) || 2000)))
    .toArray();
  return rows.reverse();
}
