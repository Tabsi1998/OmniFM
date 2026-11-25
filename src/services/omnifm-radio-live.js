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
// type "start" or "end"; show.source "test" is the console's test show,
// which never reaches the real history.
import { log } from "../lib/logging.js";
import { createOmnifmRadioLiveStore } from "../omnifm-radio-live-store.js";
import { fetchOmnifmRadioNowPlaying } from "./omnifm-radio-api.js";
import { getOmnifmRadioConfig, getOmnifmRadioLiveSettings } from "./omnifm-radio-config.js";
import { alertRadioLive } from "./operator-alerts.js";

const MAX_SHOWS = 50;
const MAX_TEST_SHOWS = 5;
const TEST_SHOW_MAX_MS = 10 * 60 * 1000;
const STORE_TIMEOUT_MS = 5_000;
// The last live sighting is kept exact in memory and stored at most this often.
const LAST_LIVE_SAVE_MS = 5 * 60 * 1000;
const STOP_TIMEOUT_MS = 3_000;
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

function normalizeShows(raw, max) {
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
    .slice(0, max);
}

// What the state machine needs besides the state: when the show was last
// seen live and AzuraCast's start of the current connection (a gap the bot
// missed), and the song text from just before it went live (that one is the
// auto DJ's, not the show's title).
function normalizeTrack(raw) {
  const data = raw && typeof raw === "object" ? raw : {};
  return {
    lastLiveAt: isoOrNull(data.lastLiveAt),
    broadcastStart: isoOrNull(data.broadcastStart),
    titleRef: typeof data.titleRef === "string" ? text(data.titleRef, 300) : null,
  };
}

function withTimeout(task, ms, what) {
  let timer;
  return Promise.race([
    Promise.resolve().then(task),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`${what}: keine Antwort nach ${Math.round(ms / 1000)} s`)), ms);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * The live state machine. Every change is stored before its event goes out;
 * calls run one after the other, so webhook and poll never race. Until the
 * stored state has been read, nothing is stored or announced: a database
 * that does not answer must not wipe the history or repeat a running show.
 * @param {{ graceMs?: number, pollMs?: number, now?: () => number, store?: { load: Function, save: Function }, onEvent?: Function, storeTimeoutMs?: number }} [options]
 */
export function createOmnifmRadioLiveTracker({
  graceMs = 60_000,
  pollMs = 30_000,
  now = Date.now,
  store = createOmnifmRadioLiveStore(),
  onEvent = emitOmnifmRadioLiveEvent,
  storeTimeoutMs = STORE_TIMEOUT_MS,
} = {}) {
  // A gap the bot did not see is a new show only beyond what one missed
  // poll can hide (a drop shorter than the poll interval).
  const missedGapMs = Math.max(graceMs, 2 * pollMs);
  let current = normalizeCurrent(null);
  let shows = [];
  let testShows = [];
  let track = normalizeTrack(null);
  let preLiveText = null;
  let lastWebhookAt = Number.NEGATIVE_INFINITY;
  let observed = { at: null, source: null };
  let loaded = false;
  let savedLastLiveAtMs = Number.NEGATIVE_INFINITY;
  let queue = Promise.resolve();

  const serial = (task) => {
    const run = queue.then(task);
    queue = run.catch(() => {});
    return run;
  };

  async function ensureLoaded() {
    if (loaded) return true;
    try {
      const stored = await withTimeout(() => store.load(), storeTimeoutMs, "Live-Zustand laden");
      current = normalizeCurrent(stored?.current);
      shows = normalizeShows(stored?.shows, MAX_SHOWS);
      testShows = normalizeShows(stored?.testShows, MAX_TEST_SHOWS);
      track = normalizeTrack(stored?.track);
      savedLastLiveAtMs = track.lastLiveAt ? Date.parse(track.lastLiveAt) : Number.NEGATIVE_INFINITY;
      loaded = true;
    } catch (error) {
      log("WARN", `[OmniFM Radio] Live-Zustand nicht lesbar, neuer Versuch beim nächsten Takt: ${error?.message || error}`);
    }
    return loaded;
  }

  async function commit(events) {
    try {
      await withTimeout(() => store.save({ current, shows, testShows, track }), storeTimeoutMs, "Live-Zustand speichern");
      if (track.lastLiveAt) savedLastLiveAtMs = Date.parse(track.lastLiveAt);
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

  /** A song text that is not the auto DJ's from just before the show. */
  const titleFrom = (songText) => (songText && songText !== track.titleRef ? songText : "");

  /** @param {{ streamerName?: string, title?: string, liveSince?: string | null }} observation */
  function begin({ streamerName, title, liveSince = null }, source, at) {
    const since = isoOrNull(liveSince);
    const sinceMs = since ? Date.parse(since) : Number.NaN;
    // AzuraCast's broadcast start, unless it lies in the future or a day back.
    const startedAt = sinceMs <= at && at - sinceMs < DAY_MS ? since : iso(at);
    const songText = text(title, 300);
    // Without a text from before going live the first live text is suspect too.
    track = { lastLiveAt: iso(at), broadcastStart: since, titleRef: source === "test" ? null : preLiveText ?? songText };
    current = {
      isLive: true,
      streamerName: text(streamerName, 100),
      title: source === "test" ? songText : titleFrom(songText),
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
    if (show.source === "test") testShows = [show, ...testShows].slice(0, MAX_TEST_SHOWS);
    else shows = [show, ...shows].slice(0, MAX_SHOWS);
    current = { ...current, isLive: false, endedAt: show.endedAt, offlineSince: null };
    return { type: "end", show };
  }

  /** The end that is due at `at`: a drop past the grace time, a test past 10 minutes. */
  function dueEnd(at) {
    if (!current.isLive) return null;
    if (current.source === "test") {
      const endMs = Date.parse(current.startedAt) + TEST_SHOW_MAX_MS;
      return at >= endMs ? finish(endMs) : null;
    }
    if (!current.offlineSince) return null;
    const droppedAt = Date.parse(current.offlineSince);
    return at - droppedAt >= graceMs ? finish(droppedAt) : null;
  }

  /**
   * AzuraCast reports a broadcast that began after a gap the bot did not
   * see: the old show ends when it was last seen live, else null.
   */
  function missedGapEnd(liveSince, at) {
    if (!current.isLive || current.source === "test" || current.offlineSince) return null;
    const since = isoOrNull(liveSince);
    if (!since || since === track.broadcastStart) return null;
    // An AzuraCast clock ahead of ours must not open a gap: never later than now.
    const sinceMs = Math.min(Date.parse(since), at);
    const lastSeenMs = Date.parse(track.lastLiveAt || current.startedAt);
    return sinceMs - lastSeenMs > missedGapMs ? lastSeenMs : null;
  }

  return {
    /** Reads the stored state; false while the database does not answer. */
    load: () => serial(ensureLoaded),

    /**
     * What AzuraCast says. Only isLive, the DJ, the song text and the
     * broadcast start are read; nothing else reaches the state.
     * @param {{ isLive?: boolean, streamerName?: string, title?: string, liveSince?: string | null }} observation
     * @param {"webhook" | "poll"} source
     * @param {{ at?: number }} [options] at: when the answer was asked for (a poll's start)
     */
    observe: (observation = {}, source = "poll", { at: askedAt } = {}) => serial(async () => {
      if (!(await ensureLoaded())) return [];
      const at = Number.isFinite(askedAt) ? askedAt : now();
      // A poll that was asked before the last webhook knows less than it.
      if (source === "webhook") lastWebhookAt = Math.max(lastWebhookAt, at);
      else if (at < lastWebhookAt) return [];
      observed = { at: iso(at), source };
      const events = [];
      const due = dueEnd(at);
      if (due) events.push(due);
      const songText = text(observation.title, 300);
      let changed = false;
      if (observation.isLive === true) {
        // A real show beats the console's test show.
        if (current.isLive && current.source === "test") events.push(finish(at));
        const gapEnd = missedGapEnd(observation.liveSince, at);
        if (gapEnd !== null) events.push(finish(gapEnd));
        if (!current.isLive) {
          events.push(begin(observation, source, at));
        } else {
          const next = {
            ...current,
            offlineSince: null,
            streamerName: current.streamerName || text(observation.streamerName, 100),
            title: current.title || titleFrom(songText),
          };
          changed = Object.keys(next).some((key) => next[key] !== current[key]);
          current = next;
          const broadcastStart = isoOrNull(observation.liveSince) || track.broadcastStart;
          // A new connection (a reconnect within the grace time) is stored at
          // once, the last sighting every few minutes.
          if (broadcastStart !== track.broadcastStart || at - savedLastLiveAtMs >= LAST_LIVE_SAVE_MS) changed = true;
          track = { ...track, lastLiveAt: iso(at), broadcastStart };
        }
      } else {
        preLiveText = songText;
        if (current.isLive && current.source !== "test") {
          if (!current.offlineSince) {
            current = { ...current, offlineSince: iso(at) };
            changed = true;
          }
          const end = dueEnd(at);
          if (end) events.push(end);
        }
      }
      if (events.length > 0 || changed) await commit(events);
      return events;
    }),

    /** Ends what is due (a drop past the grace time, a forgotten test), also when no answer comes. */
    tick: () => serial(async () => {
      if (!(await ensureLoaded())) return [];
      const end = dueEnd(now());
      return end ? commit([end]) : [];
    }),

    startTestShow: ({ streamerName = "Test-DJ", title = "Test-Sendung" } = {}) => serial(async () => {
      if (!(await ensureLoaded())) return { ok: false, error: "Der Live-Zustand ist gerade nicht lesbar." };
      if (current.isLive) {
        return { ok: false, error: current.source === "test" ? "Die Test-Sendung läuft schon." : "Gerade läuft eine echte Sendung." };
      }
      await commit([begin({ streamerName, title }, "test", now())]);
      return { ok: true };
    }),

    endTestShow: () => serial(async () => {
      if (!(await ensureLoaded())) return { ok: false, error: "Der Live-Zustand ist gerade nicht lesbar." };
      if (!current.isLive || current.source !== "test") return { ok: false, error: "Es läuft keine Test-Sendung." };
      await commit([finish(now())]);
      return { ok: true };
    }),

    /** current.source "test" marks the console's test show. */
    snapshot: () => ({
      readable: loaded,
      current: { ...current },
      shows: shows.map((show) => ({ ...show })),
      testShows: testShows.map((show) => ({ ...show })),
      observedAt: observed.at,
      observedBy: observed.source,
    }),
  };
}

// ---------------------------------------------------------------- polling

/**
 * Asks the now-playing API every interval. A failed answer changes nothing;
 * it only lets an end that is due happen. Each answer carries the time it
 * was asked for, so a slow one cannot overwrite a newer webhook.
 */
export function createOmnifmRadioPoller({
  tracker,
  fetchNowPlaying = fetchOmnifmRadioNowPlaying,
  intervalMs,
  now = Date.now,
  setIntervalFn = setInterval,
  clearIntervalFn = clearInterval,
}) {
  let timer = null;
  let running = null;

  async function poll() {
    const askedAt = now();
    let result;
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
      }, "poll", { at: askedAt });
    } else {
      await tracker.tick();
    }
  }

  /** One poll; while one runs, the same one. */
  function pollOnce() {
    running ||= poll().finally(() => { running = null; });
    return running;
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
    /** Stops the timer and waits for a poll that is still running. */
    async stop() {
      if (timer) clearIntervalFn(timer);
      timer = null;
      if (running) await running.catch(() => {});
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
  const tracker = createOmnifmRadioLiveTracker({ graceMs: settings.graceMs, pollMs: settings.pollMs, ...(store ? { store } : {}) });
  await tracker.load();
  const poller = createOmnifmRadioPoller({ tracker, fetchNowPlaying, intervalMs: settings.pollMs });
  const stopAlerts = onOmnifmRadioLiveEvent((event) => alertRadioLive(event, env));
  poller.start();
  const started = {
    tracker,
    config,
    settings,
    async stop() {
      if (service === started) service = null;
      await poller.stop();
      stopAlerts();
    },
  };
  service = started;
  log("INFO", `[OmniFM Radio] Live-Erkennung aktiv: Abfrage alle ${Math.round(settings.pollMs / 1000)} s, Webhook ${settings.webhookSecret ? "an" : "aus"}.`);
  return started;
}

/** Stops the live detection, waiting at most `timeoutMs`: the bot's own state comes first. */
export async function stopOmnifmRadioLiveService({ timeoutMs = STOP_TIMEOUT_MS } = {}) {
  const running = service;
  if (!running) return;
  let timer;
  const waited = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  try {
    await Promise.race([running.stop(), waited]);
  } catch (error) {
    log("WARN", `[OmniFM Radio] Live-Erkennung nicht sauber gestoppt: ${error?.message || error}`);
  } finally {
    clearTimeout(timer);
  }
}
