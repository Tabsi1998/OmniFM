// ============================================================
// OmniFM Radio (#593): OmniFM 1 announces a live show on every server
// ============================================================
// Listens to the live detection (#592) in the commander or the monolith.
// When DJ Tabsi goes live, OmniFM 1 (the first worker) posts on every
// server it is on and that sees OmniFM Radio; a test show only on the test
// servers. Each server chooses its channel and role or switches it off
// (src/lib/omnifm-radio-announce-settings.js). At most one announcement
// per server in two hours; the messages go out one by one, spaced, so
// Discord does not throttle. When the show ends, the same messages are
// edited to "show over"; where they are is kept in MongoDB
// (src/omnifm-radio-announce-store.js), so that works after a restart too.
// Nobody is switched: the "Listen now" button only acts for whoever presses
// it (src/bot/runtime-methods/radio-announce.js).
import { loadGuildSettings } from "../lib/guild-settings.js";
import { log } from "../lib/logging.js";
import { normalizeRadioAnnounceSettings, RADIO_ANNOUNCE_SETTINGS_KEY } from "../lib/omnifm-radio-announce-settings.js";
import { createOmnifmRadioAnnounceStore } from "../omnifm-radio-announce-store.js";
import { getOmnifmRadioConfig, isOmnifmRadioVisibleForGuild } from "./omnifm-radio-config.js";
import { onOmnifmRadioLiveEvent } from "./omnifm-radio-live.js";

export const ANNOUNCE_LIMIT_MS = 2 * 60 * 60 * 1000;
const SEND_INTERVAL_MS = 1_500;
// After a restart the bots come up a little after the live detection.
const READY_TIMEOUT_MS = 2 * 60 * 1000;
const READY_POLL_MS = 2_000;
const STOP_TIMEOUT_MS = 3_000;
const TAG = "[OmniFM Radio] Ankündigung";

/** One id per show: its start, and whether it is the console's test. */
export function radioShowId(show) {
  return `${show?.source === "test" ? "test" : "live"}:${show?.startedAt || ""}`;
}

/** What OmniFM 1 needs of the show to write the message. */
function messageShow(show) {
  return {
    streamerName: String(show?.streamerName || ""),
    title: String(show?.title || ""),
    startedAt: show?.startedAt || null,
    endedAt: show?.endedAt || null,
    durationMs: Number(show?.durationMs) || 0,
    source: show?.source || null,
  };
}

const defaultSleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms).unref?.(); });

/**
 * The announcements of one process. `handle` takes the live events; one
 * queue runs everything, so the end of a show always comes after the posts
 * that were already on their way.
 * @param {{ getAnnouncer: () => any, store?: ReturnType<typeof createOmnifmRadioAnnounceStore>, loadSettings?: (guildId: string) => Promise<any>, getConfig?: typeof getOmnifmRadioConfig, now?: () => number, intervalMs?: number, sleep?: (ms: number) => Promise<void>, readyTimeoutMs?: number }} options
 */
export function createOmnifmRadioAnnouncer({
  getAnnouncer,
  store = createOmnifmRadioAnnounceStore(),
  loadSettings = loadGuildSettings,
  getConfig = getOmnifmRadioConfig,
  now = Date.now,
  intervalMs = SEND_INTERVAL_MS,
  sleep = defaultSleep,
  readyTimeoutMs = READY_TIMEOUT_MS,
}) {
  const jobs = [];
  let running = null;
  let stopped = false;
  let activeShowId = null;
  let lastCallAt = Number.NEGATIVE_INFINITY;

  async function run() {
    while (jobs.length && !stopped) {
      const job = jobs.shift();
      try {
        // eslint-disable-next-line no-await-in-loop -- one job after the other, that is the point
        await job();
      } catch (error) {
        log("WARN", `${TAG}: ${error?.message || error}`);
      }
    }
  }

  function enqueue(job) {
    if (stopped) return;
    jobs.push(job);
    running ||= run().finally(() => { running = null; });
  }

  /** Waits until the last call to Discord is `intervalMs` ago. */
  async function pace() {
    const waitMs = lastCallAt + intervalMs - now();
    if (waitMs > 0) await sleep(waitMs);
    lastCallAt = now();
  }

  /** OmniFM 1 once it is ready; the entry points create it after subscribing. */
  async function readyAnnouncer() {
    const deadline = now() + readyTimeoutMs;
    for (;;) {
      let bot = null;
      try {
        bot = getAnnouncer() || null;
      } catch {
        bot = null;
      }
      if (bot?.client?.isReady?.()) return bot;
      if (stopped || now() >= deadline) return null;
      // eslint-disable-next-line no-await-in-loop -- waits for the bot, step by step
      await sleep(READY_POLL_MS);
    }
  }

  function targetGuilds(bot, show) {
    const config = getConfig();
    const ids = [...bot.client.guilds.cache.keys()].map(String);
    // A test show stays on the test servers, even when the station is public.
    if (show.source === "test") return config.enabled ? ids.filter((id) => config.testGuildIds.includes(id)) : [];
    return ids.filter((id) => isOmnifmRadioVisibleForGuild(id, config));
  }

  async function postTo(bot, guildId, show, showId, tally) {
    if (activeShowId !== showId) return tally("ended");
    const settings = normalizeRadioAnnounceSettings((await loadSettings(guildId))?.[RADIO_ANNOUNCE_SETTINGS_KEY]);
    if (!settings.enabled) return tally("off");
    const test = show.source === "test";
    if (!test) {
      const last = await store.lastPostedAt(guildId);
      if (last !== null && now() - last < ANNOUNCE_LIMIT_MS) return tally("limit");
    }
    await pace();
    // The show may have ended while this one waited for its turn.
    if (activeShowId !== showId || stopped) return tally("ended");
    if (!bot.client.guilds.cache.has(guildId)) return tally("gone");
    const result = await bot.postRadioAnnouncement(guildId, { channelId: settings.channelId, roleId: settings.roleId, show: messageShow(show) });
    if (!result?.ok) {
      log("DEBUG", `${TAG} ${guildId} übersprungen: ${result?.reason || result?.error || "unbekannt"}`);
      return tally("skipped");
    }
    await store.record({
      showId,
      guildId,
      botId: bot.config?.id || null,
      channelId: String(result.channelId),
      messageId: String(result.messageId),
      test,
      postedAt: new Date(now()),
    });
    return tally("posted");
  }

  async function planPosts(show, showId) {
    const bot = await readyAnnouncer();
    if (!bot) {
      log("WARN", `${TAG}: OmniFM 1 ist nicht bereit, die Sendung wird nicht angekündigt.`);
      return;
    }
    if (activeShowId !== showId) return;
    const guildIds = targetGuilds(bot, show);
    const counts = {};
    let open = guildIds.length;
    const tally = (outcome) => {
      counts[outcome] = (counts[outcome] || 0) + 1;
      open -= 1;
      if (open === 0) log("INFO", `${TAG} (${show.source}): ${Object.entries(counts).map(([key, value]) => `${key} ${value}`).join(", ")}`);
    };
    // Straight into the queue: this job runs inside it.
    for (const guildId of guildIds) jobs.push(() => postTo(bot, guildId, show, showId, tally));
  }

  async function editOne(bot, entry, show) {
    // A message of another bot cannot be edited by this one.
    if (entry.botId && bot.config?.id && entry.botId !== bot.config.id) return;
    await pace();
    const result = await bot.endRadioAnnouncement(entry.guildId, { channelId: entry.channelId, messageId: entry.messageId, show: messageShow(show) });
    if (!result?.ok) log("DEBUG", `${TAG} ${entry.guildId}: Ende nicht eingetragen (${result?.reason || result?.error || "unbekannt"})`);
    // Done either way: a deleted message is not tried again and again.
    await store.markEnded(entry, new Date(now()));
  }

  async function planEdits(show, showId) {
    const entries = await store.listForShow(showId);
    if (!entries.length) return;
    const bot = await readyAnnouncer();
    if (!bot) {
      log("WARN", `${TAG}: OmniFM 1 ist nicht bereit, ${entries.length} Ankündigung(en) bleiben auf „live“.`);
      return;
    }
    for (const entry of entries) jobs.push(() => editOne(bot, entry, show));
  }

  return {
    /** A live event: `start` announces, `end` edits the announcements of that show. */
    handle({ type, show } = {}) {
      if (stopped || !show?.startedAt) return;
      const showId = radioShowId(show);
      if (type === "start") {
        if (activeShowId === showId) return;
        activeShowId = showId;
        enqueue(() => planPosts(show, showId));
      } else if (type === "end") {
        // What still waits for this show is dropped when its turn comes.
        if (activeShowId === showId) activeShowId = null;
        enqueue(() => planEdits(show, showId));
      }
    },
    /** Resolves once the queue is empty (for tests and the shutdown). */
    async idle() {
      while (running) {
        // eslint-disable-next-line no-await-in-loop -- a job may queue more jobs
        await running;
      }
    },
    /** Drops what waits; a message already on its way still finishes. */
    async stop() {
      stopped = true;
      jobs.length = 0;
      await running;
    },
  };
}

// ---------------------------------------------------------------- service

let service = null;

/**
 * Subscribes to the live events in the commander or the monolith.
 * `getWorkerManager` returns the process's worker manager; the entry points
 * create it after this call, so it may throw or return nothing at first.
 * @param {{ getWorkerManager: () => any }} options
 */
export function startOmnifmRadioAnnouncements({ getWorkerManager }) {
  if (service) return service;
  const announcer = createOmnifmRadioAnnouncer({
    // OmniFM 1 is the first worker (slot 1), the bot every server has.
    getAnnouncer: () => getWorkerManager()?.getWorkerBySlot?.(1) || null,
  });
  const unsubscribe = onOmnifmRadioLiveEvent((event) => announcer.handle(event));
  service = {
    announcer,
    async stop() {
      unsubscribe();
      await announcer.stop();
    },
  };
  return service;
}

/** Stops the announcements, waiting at most `timeoutMs`: the bot's own state comes first. */
export async function stopOmnifmRadioAnnouncements({ timeoutMs = STOP_TIMEOUT_MS } = {}) {
  const running = service;
  if (!running) return;
  service = null;
  let timer;
  const waited = new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); });
  try {
    await Promise.race([running.stop(), waited]);
  } catch (error) {
    log("WARN", `${TAG}: nicht sauber gestoppt: ${error?.message || error}`);
  } finally {
    clearTimeout(timer);
  }
}
