// ============================================================
// OmniFM Radio (#592): is DJ Tabsi live?
// ============================================================
// One live state for every display and message (announcements #593, DMs
// #594, badges #595). Two ways in, both in the commander (or the monolith):
//   - the AzuraCast webhook "Live Streamer/DJ connected/disconnected"
//     (src/api/routes/omnifm-radio-routes.js), within seconds;
//   - the poll of the now-playing API every OMNIFM_RADIO_POLL_MS, in case a
//     webhook gets lost.
// A drop shorter than OMNIFM_RADIO_LIVE_GRACE_MS is no end and its reconnect
// no new show. Webhook and poll seeing the same show give one start.
// Other modules listen with onOmnifmRadioLiveEvent(({ type, show }) => …),
// type "start" or "end"; show.source "test" is the console's test show.
import { log } from "../lib/logging.js";
import { createOmnifmRadioLiveStore } from "../omnifm-radio-live-store.js";
import { fetchOmnifmRadioNowPlaying } from "./omnifm-radio-api.js";
import { getOmnifmRadioConfig, getOmnifmRadioLiveSettings } from "./omnifm-radio-config.js";
import { alertRadioLive } from "./operator-alerts.js";

const MAX_SHOWS = 50;
const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCES = new Set(["webhook", "poll", "test"]);

// ---------------------------------------------------------------- events

const listeners = new Set();

/** Subscribes to start/end events; returns the unsubscribe function. */
export function onOmnifmRadioLiveEvent(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function listenerFailed(error) {
  log("WARN", `[OmniFM Radio] Live-Ereignis nicht verarbeitet: ${error?.message || error}`);
}

/** Hands one event to every listener; a failing one never stops the others. */
export function emitOmnifmRadioLiveEvent(event) {
  for (const listener of [...listeners]) {
    try {
      const result = listener(event);
      if (result && typeof result.then === "function") result.then(null, listenerFailed);
    } catch (error) {
      listenerFailed(error);
    }
  }
}

// ---------------------------------------------------------------- state

function text(value, max) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isoOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const time = Date.parse(String(value));
  return Number.isFinite(time) ? new Date(time).toISOString() : null;
}

const iso = (ms) => new Date(ms).toISOString();

function normalizeCurrent(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  const startedAt = isoOrNull(data.startedAt);
  const isLive = data.isLive === true && Boolean(startedAt);
  return {
    isLive,
    streamerName: text(data.streamerName, 100),
    title: text(data.title, 300),
    startedAt,
    endedAt: isLive ? null : isoOrNull(data.endedAt),
    source: SOURCES.has(data.source) ? data.source : null,
    offlineSince: isLive ? isoOrNull(data.offlineSince) : null,
  };
}

function normalizeShows(raw) {
  return (Array.isArray(raw) ? raw : [])
    .map((entry) => {
      const show = entry && typeof entry === "object" ? entry : {};
      const startedAt = isoOrNull(show.startedAt);
      const endedAt = isoOrNull(show.endedAt);
      if (!startedAt || !endedAt) return null;
      return {
        streamerName: text(show.streamerName, 100),
        title: text(show.title, 300),
        startedAt,
        endedAt,
        durationMs: Math.max(0, Date.parse(endedAt) - Date.parse(startedAt)),
        source: SOURCES.has(show.source) ? show.source : null,
      };
    })
    .filter(Boolean)
    .slice(0, MAX_SHOWS);
}

/**
 * The live state machine. Every change is stored before its event goes out;
 * calls run one after the other, so webhook and poll never race.
 * @param {{ graceMs?: number, now?: () => number, store?: { load: Function, save: Function }, onEvent?: Function, maxShows?: number }} [options]
 */
export function createOmnifmRadioLiveTracker({
  graceMs = 60_000,
  now = Date.now,
  store = createOmnifmRadioLiveStore(),
  onEvent = emitOmnifmRadioLiveEvent,
  maxShows = MAX_SHOWS,
} = {}) {
  let current = normalizeCurrent(null);
  let shows = [];
  let observed = { at: null, source: null };
  let queue = Promise.resolve();

  const serial = (task) => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  async function commit(events) {
    try {
      await store.save({ current, shows });
    } catch (error) {
      // The state in memory stays right; the next change stores it again.
      log("WARN", `[OmniFM Radio] Live-Zustand nicht gespeichert: ${error?.message || error}`);
    }
    for (const event of events) {
      log("INFO", event.type === "start"
        ? `[OmniFM Radio] Live gestartet (${event.show.source}): ${event.show.streamerName || "?"}`
        : `[OmniFM Radio] Sendung beendet nach ${Math.round(event.show.durationMs / 60_000)} min`);
      try {
        onEvent(event);
      } catch (error) {
        listenerFailed(error);
      }
    }
    return events;
  }

  /** @param {{ streamerName?: string, title?: string, liveSince?: string | null }} observation */
  function begin({ streamerName, title, liveSince = null }, source, at) {
    const since = isoOrNull(liveSince);
    const sinceMs = since ? Date.parse(since) : Number.NaN;
    // AzuraCast's broadcast start, unless it lies in the future or a day back.
    const startedAt = sinceMs <= at && at - sinceMs < DAY_MS ? since : iso(at);
    current = {
      isLive: true,
      streamerName: text(streamerName, 100),
      title: text(title, 300),
      startedAt,
      endedAt: null,
      source,
      offlineSince: null,
    };
    return { type: "start", show: { streamerName: current.streamerName, title: current.title, startedAt, source } };
  }

  function finish(endMs) {
    const startMs = Date.parse(current.startedAt);
    const show = {
      streamerName: current.streamerName,
      title: current.title,
      startedAt: current.startedAt,
      endedAt: iso(Math.max(startMs, endMs)),
      durationMs: Math.max(0, endMs - startMs),
      source: current.source,
    };
    shows = [show, ...shows].slice(0, maxShows);
    current = { ...current, isLive: false, endedAt: show.endedAt, offlineSince: null };
    return { type: "end", show };
  }

  /** The end of a drop that lasted the grace time, or null. */
  function dropEnd(at) {
    if (!current.isLive || !current.offlineSince) return null;
    const droppedAt = Date.parse(current.offlineSince);
    return at - droppedAt >= graceMs ? finish(droppedAt) : null;
  }

  return {
    load: () => serial(async () => {
      let stored = null;
      try {
        stored = await store.load();
      } catch (error) {
        log("WARN", `[OmniFM Radio] Live-Zustand nicht lesbar: ${error?.message || error}`);
      }
      current = normalizeCurrent(stored?.current);
      shows = normalizeShows(stored?.shows);
    }),

    /**
     * What AzuraCast says right now. Only isLive, the DJ, the title and the
     * broadcast start are read; nothing else reaches the state.
     * @param {{ isLive?: boolean, streamerName?: string, title?: string, liveSince?: string | null }} observation
     * @param {"webhook" | "poll"} source
     */
    observe: (observation = {}, source = "poll") => serial(async () => {
      const at = now();
      observed = { at: iso(at), source };
      const events = [];
      let changed = false;
      if (observation.isLive === true) {
        // A real show beats the console's test show.
        if (current.isLive && current.source === "test") events.push(finish(at));
        if (!current.isLive) {
          events.push(begin(observation, source, at));
        } else {
          const name = text(observation.streamerName, 100);
          const title = text(observation.title, 300);
          const filled = {
            offlineSince: null,
            streamerName: current.streamerName || name,
            title: current.title || title,
          };
          changed = Object.entries(filled).some(([key, value]) => current[key] !== value);
          current = { ...current, ...filled };
        }
      } else if (current.isLive && current.source !== "test") {
        if (!current.offlineSince) {
          current = { ...current, offlineSince: iso(at) };
          changed = true;
        }
        const end = dropEnd(at);
        if (end) events.push(end);
      }
      if (events.length > 0 || changed) await commit(events);
      return events;
    }),

    /** Ends a drop that has lasted the grace time, also when no answer comes. */
    tick: () => serial(async () => {
      const end = dropEnd(now());
      return end ? commit([end]) : [];
    }),

    startTestShow: ({ streamerName = "Test-DJ", title = "Test-Sendung" } = {}) => serial(async () => {
      if (current.isLive) {
        return { ok: false, error: current.source === "test" ? "Die Test-Sendung läuft schon." : "Gerade läuft eine echte Sendung." };
      }
      await commit([begin({ streamerName, title }, "test", now())]);
      return { ok: true };
    }),

    endTestShow: () => serial(async () => {
      if (!current.isLive || current.source !== "test") return { ok: false, error: "Es läuft keine Test-Sendung." };
      await commit([finish(now())]);
      return { ok: true };
    }),

    snapshot: () => ({
      current: { ...current },
      shows: shows.map((show) => ({ ...show })),
      observedAt: observed.at,
      observedBy: observed.source,
    }),
  };
}

// ---------------------------------------------------------------- polling

/**
 * Asks the now-playing API every interval. A failed answer changes nothing,
 * it only lets a drop that has lasted the grace time end.
 */
export function createOmnifmRadioPoller({
  tracker,
  fetchNowPlaying = fetchOmnifmRadioNowPlaying,
  intervalMs,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let timer = null;
  let running = false;

  async function pollOnce() {
    if (running) return;
    running = true;
    try {
      let result = null;
      try {
        result = await fetchNowPlaying({ force: true });
      } catch {
        result = null;
      }
      if (result?.ok === true) {
        await tracker.observe({
          isLive: result.isLive === true,
          streamerName: result.streamerName,
          title: result.songText || result.title,
          liveSince: result.liveSince,
        }, "poll");
      } else {
        await tracker.tick();
      }
    } finally {
      running = false;
    }
  }

  const pollLogged = () => pollOnce().catch((error) => log("WARN", `[OmniFM Radio] Abfrage fehlgeschlagen: ${error?.message || error}`));

  return {
    pollOnce,
    start() {
      if (timer) return;
      timer = setIntervalFn(pollLogged, intervalMs);
      timer?.unref?.();
      void pollLogged();
    },
    stop() {
      if (timer) clearIntervalFn(timer);
      timer = null;
    },
  };
}

// ---------------------------------------------------------------- service

let service = null;

/** The running live detection of this process, or null (worker, public entry, off). */
export function getOmnifmRadioLiveService() {
  return service;
}

/**
 * Starts the live detection in the commander or the monolith: loads the
 * stored state, polls, and tells the operator about every start and end.
 * @param {{ env?: NodeJS.ProcessEnv, store?: { load: Function, save: Function }, fetchNowPlaying?: typeof fetchOmnifmRadioNowPlaying }} [options]
 */
export async function startOmnifmRadioLiveService({ env = process.env, store, fetchNowPlaying } = {}) {
  if (service) return service;
  const config = getOmnifmRadioConfig(env);
  if (!config.enabled) {
    log("INFO", "[OmniFM Radio] Ausgeschaltet (OMNIFM_RADIO_ENABLED=0), keine Live-Erkennung.");
    return null;
  }
  const settings = getOmnifmRadioLiveSettings(env);
  if (settings.webhookSecretTooShort) {
    log("WARN", "[OmniFM Radio] OMNIFM_RADIO_WEBHOOK_SECRET ist kürzer als 16 Zeichen, der Webhook bleibt aus. Live erkennt nur die Abfrage.");
  }
  const tracker = createOmnifmRadioLiveTracker({ graceMs: settings.graceMs, ...(store ? { store } : {}) });
  await tracker.load();
  const poller = createOmnifmRadioPoller({ tracker, fetchNowPlaying, intervalMs: settings.pollMs });
  const stopAlerts = onOmnifmRadioLiveEvent((event) => alertRadioLive(event, env));
  poller.start();
  const started = {
    tracker,
    config,
    settings,
    stop() {
      poller.stop();
      stopAlerts();
      if (service === started) service = null;
    },
  };
  service = started;
  log("INFO", `[OmniFM Radio] Live-Erkennung aktiv: Abfrage alle ${Math.round(settings.pollMs / 1000)} s, Webhook ${settings.webhookSecret ? "an" : "aus"}.`);
  return started;
}

export function stopOmnifmRadioLiveService() {
  service?.stop();
}
