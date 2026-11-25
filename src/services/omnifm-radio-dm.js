// ============================================================
// OmniFM Radio (#594): a DM to the server owners when a show starts
// ============================================================
// Unsolicited mass DMs are what Discord restricts bots for, and that would
// hit all of OmniFM. So the defaults are the careful ones:
//   - only on "start", to the owner (guild.ownerId) of every server where
//     OmniFM Radio is visible; a test show only to the owners of the test
//     servers. One person with several servers gets one DM.
//   - one DM per person in 12 hours, stored (src/omnifm-radio-dm-store.js);
//     test DMs have their own 10 minutes and use none of the 12 hours.
//   - one global queue, one DM every few seconds, one attempt each: the DMs
//     go through their own REST client without retries that rejects a
//     rate limit (src/services/omnifm-radio-dm-sender.js); the kill switch
//     cancels a DM in flight. A lock the client sets before asking Discord is
//     waited out (at most a minute), nothing was sent then. Closed DMs
//     (50007, 10013, 403) leave the person alone for 30 days, but only once
//     the run has sent at least one DM and did not brake.
//   - emergency brake: Discord's spam signals (40003, 40004, a real 429),
//     five other failures in a row, or from 20 attempts more than 90 %
//     failed (closed DMs included) stop the run, switch the mode to "off"
//     and tell the operator, always (no alert switch).
//   - "Abbestellen" in every DM, for good (src/bot/omnifm-radio-dm-message.js).
//   - the mode in the owner console (owner_config.radioDm.mode), else
//     OMNIFM_RADIO_DM_MODE, else "owners": owners | optin | off. It is read
//     before every single DM; "off", an unknown value or a database that
//     does not answer stop a running distribution. So does the end of the show.
// The commander (OmniFM 1, or the monolith) sends; workers never do.
import { log } from "../lib/logging.js";
import { getDb, isConnected, isMongoRequested } from "../lib/db.js";
import { OWNER_CONFIG_ID } from "../lib/owner-config.js";
import { sharedOmnifmRadioDmStore } from "../omnifm-radio-dm-store.js";
import { buildRadioDmMessage } from "../bot/omnifm-radio-dm-message.js";
import { createRadioDmSender, isRadioDmRateLimit, radioDmBody, radioDmWaitMs } from "./omnifm-radio-dm-sender.js";
import { alertRadioDmBrake } from "./operator-alerts.js";
import { getOmnifmRadioConfig, isOmnifmRadioVisibleForGuild } from "./omnifm-radio-config.js";
import { onOmnifmRadioLiveEvent } from "./omnifm-radio-live.js";

export const RADIO_DM_MODES = Object.freeze(["owners", "optin", "off"]);
const MINUTE = 60_000;
const QUOTAS = Object.freeze({
  real: 12 * 60 * MINUTE,
  test: 10 * MINUTE,
});
const CLOSED_FOR_MS = 30 * 24 * 60 * MINUTE;
const DM_INTERVAL_MS = 5_000;
const CLIENT_WAIT_MS = 2 * MINUTE;
const CLIENT_POLL_MS = 1_000;
const STOP_TIMEOUT_MS = 3_000;
// Five failed DMs in a row (other than closed DMs) look like a bot Discord no longer trusts.
const FAILURE_STREAK_LIMIT = 5;
// Closed DMs are common (20-30 % of owners): they brake only when nearly everything fails.
const FAILURE_RATE_MIN_ATTEMPTS = 20;
const FAILURE_RATE_LIMIT = 0.9;
// The REST client's own lock: waited out up to a minute, a few times per DM.
const MAX_LOCK_WAIT_MS = MINUTE;
const MAX_LOCK_WAITS = 3;
// "Opening DMs too fast", "sending temporarily disabled".
const SPAM_SIGNAL_CODES = new Set([40003, 40004]);
const SNOWFLAKE = /^\d{17,22}$/;
const iso = (ms) => new Date(ms).toISOString();
const errorText = (error) => String(error?.message || error).slice(0, 200);

// ---------------------------------------------------------------- mode

const parseMode = (value) => String(value ?? "").trim().toLowerCase();

/**
 * The mode that applies: the console's, else the environment's, else
 * "owners". A value that is set but unknown is "off": a typo never sends.
 * @returns {{ mode: string, source: string }} mode owners | optin | off, source console | env | default
 */
export function resolveRadioDmMode(consoleMode, envMode) {
  for (const [value, source] of [[consoleMode, "console"], [envMode, "env"]]) {
    const mode = parseMode(value);
    if (mode) return { mode: RADIO_DM_MODES.includes(mode) ? mode : "off", source };
  }
  return { mode: "owners", source: "default" };
}

/** owner_config.radioDm.mode; in memory without MongoDB, an error while MongoDB is away. */
export function createRadioDmModeStore({
  getDatabase = () => (isConnected() ? getDb() : null),
  mongoRequested = isMongoRequested,
} = {}) {
  let memory = "";
  const database = () => {
    const db = getDatabase();
    if (!db && mongoRequested()) throw new Error("MongoDB ist nicht verbunden.");
    return db;
  };
  return {
    async read() {
      const db = database();
      if (!db) return memory;
      const doc = await db.collection("owner_config").findOne({ _id: OWNER_CONFIG_ID }, { projection: { radioDm: 1 } });
      return String(doc?.radioDm?.mode ?? "");
    },
    async write(mode) {
      const db = database();
      if (!db) {
        memory = mode;
        return;
      }
      await db.collection("owner_config").updateOne(
        { _id: OWNER_CONFIG_ID },
        { $set: { "radioDm.mode": mode, "radioDm.updatedAt": new Date().toISOString() } },
        { upsert: true },
      );
    },
  };
}

// ---------------------------------------------------------------- recipients

/**
 * The owners to ask, in server order, each person once with the first
 * server's language. A test show: only the owners of the test servers.
 * @param {{ guilds: Iterable<any>, config: any, test: boolean, resolveLanguage: (guildId: string) => string, selfId?: string, isBot?: (userId: string) => boolean }} input
 */
export function collectRadioDmRecipients({ guilds, config, test, resolveLanguage, selfId = "", isBot = () => false }) {
  const recipients = new Map();
  if (!config?.enabled) return [];
  for (const guild of guilds || []) {
    const guildId = String(guild?.id || "");
    const ownerId = String(guild?.ownerId || "");
    if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(ownerId) || ownerId === selfId || recipients.has(ownerId) || isBot(ownerId)) continue;
    const visible = test ? config.testGuildIds.includes(guildId) : isOmnifmRadioVisibleForGuild(guildId, config);
    if (!visible) continue;
    recipients.set(ownerId, { userId: ownerId, guildId, guildName: String(guild?.name || ""), language: resolveLanguage(guildId) || "de" });
  }
  return [...recipients.values()];
}

/** Discord tells the bot to slow down: stop everything (40003, 40004, a rate limit). */
export function isDiscordSpamSignal(error) {
  return SPAM_SIGNAL_CODES.has(error?.code) || isRadioDmRateLimit(error);
}

/** Discord does not deliver DMs to this person (50007, an unknown user 10013, another 403). */
export function isDmClosedError(error) {
  if (isDiscordSpamSignal(error)) return false;
  return error?.code === 50007 || error?.code === 10013 || error?.status === 403;
}

// ---------------------------------------------------------------- distribution

function abortableSleep(ms, signal) {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve(undefined);
      return;
    }
    const done = () => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve(undefined);
    };
    const timer = setTimeout(done, ms);
    timer.unref?.();
    signal?.addEventListener("abort", done, { once: true });
  });
}

/**
 * @param {{ getRuntime: () => any, store?: any, modeStore?: { read: () => Promise<string>, write: (mode: string) => Promise<void> }, env?: Record<string, string | undefined>, getConfig?: () => any, createSender?: (runtime: any) => { send: (userId: string, body: any) => Promise<void>, stop?: () => void }, alert?: (info: any) => Promise<any>, now?: () => number, sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, intervalMs?: number, clientWaitMs?: number }} options
 */
export function createOmnifmRadioDmService({
  getRuntime,
  store = sharedOmnifmRadioDmStore(),
  modeStore = createRadioDmModeStore(),
  env = process.env,
  getConfig = () => getOmnifmRadioConfig(env),
  // The commander's own token, its own REST client: one attempt per DM.
  createSender = (runtime) => createRadioDmSender({ token: runtime.config?.token || runtime.client?.token }),
  alert = (info) => alertRadioDmBrake(info, env),
  now = Date.now,
  sleep = abortableSleep,
  intervalMs = DM_INTERVAL_MS,
  clientWaitMs = CLIENT_WAIT_MS,
}) {
  const jobs = new Set();
  let chain = Promise.resolve();
  let active = null;
  let lastRun = null;
  let stopped = false;
  // "Off" from the console that the database did not take yet: off until a write works.
  let offInMemory = false;

  const currentMode = async () => (offInMemory ? "off" : resolveRadioDmMode(await modeStore.read(), env.OMNIFM_RADIO_DM_MODE).mode);

  function abortAll(reason) {
    for (const job of jobs) {
      job.reason ||= reason;
      job.controller.abort();
    }
  }

  /** The commander's runtime once its client is ready. The entry creates it after this service. */
  function readyRuntime() {
    let runtime = null;
    try {
      runtime = getRuntime();
    } catch {
      // Not created yet (temporal dead zone in the entry point).
    }
    return runtime?.client?.isReady?.() ? runtime : null;
  }

  async function waitForRuntime(signal) {
    const deadline = now() + clientWaitMs;
    for (;;) {
      const runtime = readyRuntime();
      if (runtime || signal.aborted || now() >= deadline) return runtime;
      // eslint-disable-next-line no-await-in-loop -- waiting for the login, one look a second
      await sleep(CLIENT_POLL_MS, signal);
    }
  }

  /** The JSON body of one DM; throws when the settings make no valid message (a base URL without https://). */
  function buildBody(runtime, recipient, show, config) {
    return radioDmBody(buildRadioDmMessage({
      show,
      language: recipient.language,
      config,
      guildName: recipient.guildName,
      applicationId: runtime.getApplicationId?.() || runtime.client.application?.id || null,
    }));
  }

  /**
   * One attempt; no retry, a second try is exactly what looks like spam.
   * A cancelled send and a lock of the REST client (nothing reached Discord)
   * count as neither sent nor failed.
   */
  async function sendOne(sender, recipient, body, run, signal) {
    try {
      await sender.send(recipient.userId, body, { signal });
      run.sent += 1;
      return { ok: true };
    } catch (error) {
      if (signal.aborted) return { ok: false, aborted: true };
      const waitMs = radioDmWaitMs(error);
      if (waitMs !== null) return { ok: false, waitMs, error };
      run.failed += 1;
      log("WARN", `[OmniFM Radio] DM an ${recipient.userId} fehlgeschlagen: ${error?.code || error?.status || ""} ${error?.message || error}`);
      return { ok: false, error, brake: isDiscordSpamSignal(error), closed: isDmClosedError(error) };
    }
  }

  /** Off at once and stored, and the operator hears why. */
  async function pullTheBrake(run) {
    offInMemory = true;
    abortAll(run.stoppedBy);
    try {
      await modeStore.write("off");
      offInMemory = false;
    } catch (error) {
      log("WARN", `[OmniFM Radio] DM-Not-Aus nur im Speicher, nicht gespeichert: ${error?.message || error}`);
    }
    log("WARN", `[OmniFM Radio] DMs automatisch ausgeschaltet (${run.stoppedBy}): ${run.error || "-"}`);
    await Promise.resolve()
      .then(() => alert({ reason: run.stoppedBy, run: { ...run, show: { ...run.show } } }))
      .catch((error) => log("WARN", `[OmniFM Radio] Betreiber-Meldung zum DM-Not-Aus fehlgeschlagen: ${error?.message || error}`));
  }

  /** @returns {Promise<string | null>} why it stopped early, null when everyone was handled */
  async function distribute(job, run) {
    const { signal } = job.controller;
    run.mode = await currentMode();
    if (run.mode === "off") return "off";
    const runtime = await waitForRuntime(signal);
    if (signal.aborted) return job.reason;
    if (!runtime) return "client";
    const config = getConfig();
    const recipients = collectRadioDmRecipients({
      guilds: runtime.client.guilds.cache.values(),
      config,
      test: run.test,
      resolveLanguage: (guildId) => runtime.resolveGuildLanguage?.(guildId),
      selfId: String(runtime.client.user?.id || ""),
      isBot: (userId) => runtime.client.users?.cache?.get?.(userId)?.bot === true,
    });
    run.total = recipients.length;
    run.remaining = recipients.length;
    // Every language once before anybody is claimed: broken settings use up nobody's 12 hours.
    try {
      for (const language of new Set(recipients.map((recipient) => recipient.language))) buildBody(runtime, { language, guildName: "" }, job.show, config);
    } catch (error) {
      run.error = errorText(error);
      return "config";
    }
    const quota = run.test ? "test" : "real";
    const sender = createSender(runtime);
    try {
      return await distributeTo(job, run, { runtime, sender, recipients, quota, config });
    } finally {
      sender.stop?.();
    }
  }

  /** sendOne, waiting out a lock of the REST client; `stop` when the lock is too long or the run ends meanwhile. */
  async function sendThroughLocks(sender, recipient, body, run, job) {
    const { signal } = job.controller;
    let outcome = await sendOne(sender, recipient, body, run, signal);
    for (let waits = 0; outcome.waitMs !== undefined; waits += 1) {
      if (outcome.waitMs > MAX_LOCK_WAIT_MS || waits >= MAX_LOCK_WAITS) {
        run.error = `Rate-Limit: ${Math.ceil(outcome.waitMs / 1000)} s Wartezeit`;
        return { stop: "ratelimit" };
      }
      // eslint-disable-next-line no-await-in-loop -- the wait is the point
      await sleep(outcome.waitMs, signal);
      if (signal.aborted) return { stop: job.reason };
      // eslint-disable-next-line no-await-in-loop
      run.mode = await currentMode();
      if (run.mode === "off") return { stop: "off" };
      // eslint-disable-next-line no-await-in-loop
      outcome = await sendOne(sender, recipient, body, run, signal);
    }
    return outcome.aborted ? { stop: job.reason } : outcome;
  }

  async function distributeTo(job, run, { runtime, sender, recipients, quota, config }) {
    const { signal } = job.controller;
    let pause = false;
    let streak = 0;
    let healthy = true;
    // Closed DMs are marked once the run has sent a DM; a run without one proves nothing.
    const closed = [];
    const markClosed = async () => {
      for (const entry of closed.splice(0)) {
        // eslint-disable-next-line no-await-in-loop -- a few, one after the other
        await store.markDmsClosed(entry.userId, { until: entry.until, now: now() })
          .catch((error) => log("WARN", `[OmniFM Radio] Geschlossene DMs nicht gespeichert: ${error?.message || error}`));
      }
    };
    try {
      for (const recipient of recipients) {
        // One after the other on purpose: one DM, a pause, the next.
        // eslint-disable-next-line no-await-in-loop
        if (pause) await sleep(intervalMs, signal);
        pause = false;
        if (signal.aborted) return job.reason;
        // The kill switch counts before every DM.
        // eslint-disable-next-line no-await-in-loop
        run.mode = await currentMode();
        if (run.mode === "off") return "off";
        let body;
        try {
          body = buildBody(runtime, recipient, job.show, config);
        } catch (error) {
          run.error = errorText(error);
          return "config";
        }
        // eslint-disable-next-line no-await-in-loop
        const claimed = await store.claim(recipient.userId, { quota, windowMs: QUOTAS[quota], now: now(), subscribedOnly: run.mode === "optin" });
        // A stop during the claim: the slot stays used, but nothing is sent.
        if (claimed && signal.aborted) return job.reason;
        run.remaining -= 1;
        if (!claimed) {
          run.skipped += 1;
          continue;
        }
        // eslint-disable-next-line no-await-in-loop
        const outcome = await sendThroughLocks(sender, recipient, body, run, job);
        if (outcome.stop !== undefined) return outcome.stop;
        pause = true;
        if (outcome.ok) {
          streak = 0;
          // eslint-disable-next-line no-await-in-loop
          await markClosed();
          continue;
        }
        // A closed DM is no sign of a sick bot by itself; other errors in a row are.
        if (outcome.closed) closed.push({ userId: recipient.userId, until: now() + CLOSED_FOR_MS });
        else streak += 1;
        const attempts = run.sent + run.failed;
        const mostlyFailing = attempts >= FAILURE_RATE_MIN_ATTEMPTS && run.failed / attempts > FAILURE_RATE_LIMIT;
        if (outcome.brake || streak >= FAILURE_STREAK_LIMIT || mostlyFailing) {
          healthy = false;
          run.error = errorText(outcome.error);
          return outcome.brake ? "discord" : "failures";
        }
      }
      return null;
    } finally {
      if (healthy && run.sent > 0) await markClosed();
    }
  }

  async function runJob(job) {
    if (job.controller.signal.aborted) {
      jobs.delete(job);
      return;
    }
    const { show } = job;
    const run = {
      show: { streamerName: String(show.streamerName || ""), title: String(show.title || ""), startedAt: show.startedAt || null, source: show.source || null },
      test: show.source === "test",
      mode: null,
      startedAt: iso(now()),
      finishedAt: null,
      total: 0,
      sent: 0,
      skipped: 0,
      failed: 0,
      remaining: 0,
      stoppedBy: null,
      error: null,
    };
    lastRun = run;
    active = job;
    try {
      run.stoppedBy = await distribute(job, run);
      if (run.stoppedBy === "discord" || run.stoppedBy === "failures") await pullTheBrake(run);
    } catch (error) {
      log("WARN", `[OmniFM Radio] DM-Verteilung abgebrochen: ${error?.message || error}`);
      run.stoppedBy = "error";
      run.error = errorText(error);
    } finally {
      run.finishedAt = iso(now());
      active = null;
      jobs.delete(job);
      log("INFO", `[OmniFM Radio] DMs${run.test ? " (Test)" : ""}: ${run.sent} gesendet, ${run.skipped} übersprungen, ${run.failed} fehlgeschlagen, ${run.remaining} offen${run.stoppedBy ? ` (gestoppt: ${run.stoppedBy})` : ""}.`);
      await store.saveLastRun(run)
        .catch((error) => log("WARN", `[OmniFM Radio] Letzte DM-Verteilung nicht gespeichert: ${error?.message || error}`));
    }
  }

  return {
    /** The live listener: a start queues a distribution, an end stops what runs. */
    handleEvent(event) {
      if (stopped) return;
      if (event?.type === "end") {
        abortAll("end");
        return;
      }
      if (event?.type !== "start" || !event.show) return;
      const job = { show: event.show, controller: new AbortController(), reason: null };
      jobs.add(job);
      chain = chain.then(() => runJob(job));
    },

    /**
     * Stores the console's mode. "Off" stops what runs first, then is
     * stored; a write that fails keeps it off in memory until one works.
     */
    async setMode(mode) {
      const value = parseMode(mode);
      if (!RADIO_DM_MODES.includes(value)) throw new Error(`Unbekannter Modus: ${String(mode).slice(0, 20)}`);
      if (value === "off") {
        offInMemory = true;
        abortAll("off");
      }
      await modeStore.write(value);
      offInMemory = false;
      return value;
    },

    /** Mode, where it comes from, and the last distribution, for the console. */
    async status() {
      let resolved = { mode: null, source: null };
      let modeError = null;
      try {
        resolved = resolveRadioDmMode(await modeStore.read(), env.OMNIFM_RADIO_DM_MODE);
      } catch (error) {
        modeError = String(error?.message || error);
      }
      if (offInMemory) resolved = { mode: "off", source: "memory" };
      const run = lastRun || await store.loadLastRun().catch(() => null);
      return {
        mode: resolved.mode,
        modeSource: resolved.source,
        modeError,
        running: Boolean(active),
        lastRun: run ? { ...run, show: { ...run.show } } : null,
      };
    },

    /** Resolves when every queued distribution is done. */
    idle: () => chain,

    /** Stops what runs and waits at most `timeoutMs` for the DM being sent. */
    async stop({ timeoutMs = STOP_TIMEOUT_MS } = {}) {
      stopped = true;
      abortAll("shutdown");
      let timer;
      await Promise.race([chain, new Promise((resolve) => { timer = setTimeout(resolve, timeoutMs); timer.unref?.(); })]);
      clearTimeout(timer);
    },
  };
}

// ---------------------------------------------------------------- service

let service = null;
let unsubscribe = null;

export function getOmnifmRadioDmService() {
  return service;
}

/**
 * Starts the DMs in the commander or the monolith, next to the live
 * detection. `getRuntime` returns the commander runtime (OmniFM 1); it may
 * not exist yet, the first distribution waits for it.
 * @param {{ getRuntime: () => any, env?: Record<string, string | undefined> }} options
 */
export function startOmnifmRadioDmService({ getRuntime, env = process.env }) {
  if (service) return service;
  if (!getOmnifmRadioConfig(env).enabled) return null;
  const mode = parseMode(env.OMNIFM_RADIO_DM_MODE);
  if (mode && !RADIO_DM_MODES.includes(mode)) {
    log("WARN", `[OmniFM Radio] OMNIFM_RADIO_DM_MODE "${mode.slice(0, 20)}" ist unbekannt (owners, optin, off): ohne Wert in der Owner-Konsole gehen keine DMs raus.`);
  }
  service = createOmnifmRadioDmService({ getRuntime, env });
  unsubscribe = onOmnifmRadioLiveEvent((event) => service?.handleEvent(event));
  return service;
}

/** Stops the DMs on shutdown, at most 3 s: the bot's own state comes first. */
export async function stopOmnifmRadioDmService() {
  const running = service;
  service = null;
  unsubscribe?.();
  unsubscribe = null;
  await running?.stop().catch((error) => log("WARN", `[OmniFM Radio] DMs nicht sauber gestoppt: ${error?.message || error}`));
}
