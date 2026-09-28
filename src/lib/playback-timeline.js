// ============================================================
// OmniFM: the dashboard's live view of a server (#304), what it shows
// ============================================================
// From the stored phase changes (src/playback-timeline-store.js), one row per
// bot over the last 24 hours: segments of the same phase with the station,
// the changes as a list, and where the bot stands now. Pure, for the
// dashboard route and its tests.

export const LIVE_VIEW_HOURS = 24;
export const LIVE_VIEW_PHASES = Object.freeze(["idle", "connecting", "starting", "playing", "paused", "recovering", "parked"]);
const HOUR_MS = 3_600_000;
const EVENTS_PER_BOT = 30;

function msOf(value) {
  const ms = value instanceof Date ? value.getTime() : Date.parse(String(value ?? ""));
  return Number.isFinite(ms) ? ms : null;
}

const iso = (ms) => new Date(ms).toISOString();
const phaseOf = (value) => (LIVE_VIEW_PHASES.includes(value) ? value : "idle");

/**
 * @param {Array<Record<string, any>>} entries the stored changes, any order
 * @param {{ now?: number, hours?: number }} [options]
 */
export function buildLiveView(entries = [], { now = Date.now(), hours = LIVE_VIEW_HOURS } = {}) {
  const windowStart = now - hours * HOUR_MS;
  const byBot = new Map();
  for (const entry of entries) {
    const atMs = msOf(entry?.at);
    if (atMs === null || atMs > now) continue;
    const key = String(entry.botId || entry.botName || "bot");
    if (!byBot.has(key)) byBot.set(key, []);
    byBot.get(key).push({ ...entry, atMs });
  }

  const bots = [];
  for (const [botId, list] of byBot) {
    list.sort((a, b) => a.atMs - b.atMs);
    const segments = [];
    list.forEach((entry, index) => {
      const from = Math.max(entry.atMs, windowStart);
      const to = index + 1 < list.length ? list[index + 1].atMs : now;
      if (to <= from) return;
      const phase = phaseOf(entry.phase);
      const station = entry.stationName || null;
      const previous = segments.at(-1);
      if (previous && previous.phase === phase && previous.station === station && previous.to === from) {
        previous.to = to;
        return;
      }
      segments.push({ phase, from, to, station, failover: entry.failover === true });
    });
    const events = list
      .filter((entry) => entry.atMs >= windowStart)
      .slice(-EVENTS_PER_BOT)
      .reverse()
      .map((entry) => ({
        at: iso(entry.atMs),
        phase: phaseOf(entry.phase),
        from: phaseOf(entry.from),
        reason: String(entry.reason || ""),
        station: entry.stationName || null,
        unexpected: entry.unexpected === true,
      }));
    // A bot that stood still the whole day without a change has nothing to show.
    if (!events.length && segments.every((segment) => segment.phase === "idle")) continue;
    const last = list.at(-1);
    bots.push({
      botId,
      botName: String(last.botName || botId),
      current: { phase: phaseOf(last.phase), since: iso(last.atMs), station: last.stationName || null, failover: last.failover === true },
      segments: segments.map((segment) => ({ ...segment, from: iso(segment.from), to: iso(segment.to) })),
      events,
    });
  }
  bots.sort((a, b) => a.botName.localeCompare(b.botName, undefined, { numeric: true }));
  return { windowStart: iso(windowStart), windowEnd: iso(now), hours, bots };
}
