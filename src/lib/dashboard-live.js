// ============================================================
// OmniFM: the dashboard listens instead of asking (#502)
// ============================================================
// One open stream per browser tab (Server-Sent Events) instead of a request
// every five seconds. The commander reads its workers every two seconds
// anyway; in the same rhythm the hub looks, in memory only, at what each
// watched server shows and sends a message only when that changed. Values
// that grow by the second (uptime, minutes listened) do not count as a
// change; they come along at least once a minute. A watcher whose sign-in
// ended or who lost the server is let go at the next look.

export const LIVE_TICK_MS = 2_000;
export const LIVE_HEARTBEAT_MS = 25_000;
export const LIVE_REFRESH_MS = 60_000;
export const LIVE_RETRY_MS = 10_000;
export const LIVE_MAX_PER_SESSION = 4;
export const LIVE_MAX_PER_ADDRESS = 20;

const TICKING = new Set(["uptimeSec", "runtimeUptimeSec", "totalListeningMs"]);

/** What counts as a change: the snapshot without the values that grow by the second. */
export function liveSignature(snapshot) {
  return JSON.stringify(snapshot, (key, value) => (TICKING.has(key) ? undefined : value));
}

/** One Server-Sent Events message. */
export function sseMessage(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * @param {{ tickMs?: number, heartbeatMs?: number, refreshMs?: number, maxPerSession?: number,
 *   maxPerAddress?: number, now?: () => number, timers?: { setInterval: Function, clearInterval: Function } }} [options]
 */
export function createLiveHub({
  tickMs = LIVE_TICK_MS,
  heartbeatMs = LIVE_HEARTBEAT_MS,
  refreshMs = LIVE_REFRESH_MS,
  maxPerSession = LIVE_MAX_PER_SESSION,
  maxPerAddress = LIVE_MAX_PER_ADDRESS,
  now = () => Date.now(),
  timers = globalThis,
} = {}) {
  /** @type {Set<any>} */
  const watchers = new Set();
  let tickTimer = null;
  let heartbeatTimer = null;

  const countOf = (field, value) => [...watchers].filter((watcher) => watcher[field] === value).length;

  function write(watcher, text) {
    try {
      watcher.write(text);
    } catch {
      drop(watcher);
    }
  }

  function drop(watcher, { end = false } = {}) {
    if (!watchers.delete(watcher)) return;
    if (end) {
      try {
        watcher.end();
      } catch {
        // already gone
      }
    }
    if (!watchers.size) {
      timers.clearInterval(tickTimer);
      timers.clearInterval(heartbeatTimer);
      tickTimer = null;
      heartbeatTimer = null;
    }
  }

  // Each server is looked at once per round, however many tabs watch it.
  function look(watcher, round, force = false) {
    if (!watcher.stillAllowed()) {
      drop(watcher, { end: true });
      return;
    }
    let data = round.get(watcher.guildId);
    if (data === undefined) {
      try {
        data = watcher.snapshot() || null;
      } catch {
        data = null;
      }
      round.set(watcher.guildId, data);
    }
    if (!data) return;
    const signature = liveSignature(data);
    if (!force && signature === watcher.signature && now() - watcher.sentAt < refreshMs) return;
    watcher.signature = signature;
    watcher.sentAt = now();
    write(watcher, sseMessage("live", data));
  }

  function tick() {
    const round = new Map();
    for (const watcher of [...watchers]) look(watcher, round);
  }

  function heartbeat() {
    for (const watcher of [...watchers]) write(watcher, ": ping\n\n");
  }

  return {
    /** Whether one more stream fits for this sign-in and this address. */
    hasRoom(sessionKey, address) {
      return countOf("sessionKey", sessionKey) < maxPerSession && countOf("address", address) < maxPerAddress;
    },

    /**
     * Starts watching: the first snapshot goes out at once.
     * @param {{ guildId: string, sessionKey: string, address: string, snapshot: () => any,
     *   stillAllowed: () => boolean, write: (text: string) => void, end: () => void }} options
     * @returns {() => void} stops watching
     */
    watch({ guildId, sessionKey, address, snapshot, stillAllowed, write: send, end }) {
      const watcher = { guildId, sessionKey, address, snapshot, stillAllowed, write: send, end, signature: "", sentAt: 0 };
      watchers.add(watcher);
      if (!tickTimer) {
        tickTimer = timers.setInterval(tick, tickMs);
        tickTimer?.unref?.();
        heartbeatTimer = timers.setInterval(heartbeat, heartbeatMs);
        heartbeatTimer?.unref?.();
      }
      look(watcher, new Map(), true);
      return () => drop(watcher);
    },

    /** How many streams are open (the owner's monitoring, tests). */
    get size() {
      return watchers.size;
    },
  };
}
