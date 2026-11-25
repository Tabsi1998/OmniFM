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
//     rate limit (src/services/omnifm-radio-dm-sender.js). Closed DMs
//     (50007/403) leave the person alone for 30 days.
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
import { createRadioDmSender, radioDmBody } from "./omnifm-radio-dm-sender.js";
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
const SNOWFLAKE = /^\d{17,22}$/;
const iso = (ms) => new Date(ms).toISOString();

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
 * @param {{ guilds: Iterable<any>, config: any, test: boolean, resolveLanguage: (guildId: string) => string, selfId?: string }} input
 */
export function collectRadioDmRecipients({ guilds, config, test, resolveLanguage, selfId = "" }) {
  const recipients = new Map();
  if (!config?.enabled) return [];
  for (const guild of guilds || []) {
    const guildId = String(guild?.id || "");
    const ownerId = String(guild?.ownerId || "");
    if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(ownerId) || ownerId === selfId || recipients.has(ownerId)) continue;
    const visible = test ? config.testGuildIds.includes(guildId) : isOmnifmRadioVisibleForGuild(guildId, config);
    if (!visible) continue;
    recipients.set(ownerId, { userId: ownerId, guildId, guildName: String(guild?.name || ""), language: resolveLanguage(guildId) || "de" });
  }
  return [...recipients.values()];
}

/** Discord does not deliver DMs to this person (50007, or a 403). */
export function isDmClosedError(error) {
  return error?.code === 50007 || error?.status === 403;
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
 * @param {{ getRuntime: () => any, store?: any, modeStore?: { read: () => Promise<string>, write: (mode: string) => Promise<void> }, env?: Record<string, string | undefined>, getConfig?: () => any, createSender?: (runtime: any) => { send: (userId: string, body: any) => Promise<void>, stop?: () => void }, now?: () => number, sleep?: (ms: number, signal?: AbortSignal) => Promise<void>, intervalMs?: number, clientWaitMs?: number }} options
 */
export function createOmnifmRadioDmService({
  getRuntime,
  store = sharedOmnifmRadioDmStore(),
  modeStore = createRadioDmModeStore(),
  env = process.env,
  getConfig = () => getOmnifmRadioConfig(env),
  // The commander's own token, its own REST client: one attempt per DM.
  createSender = (runtime) => createRadioDmSender({ token: runtime.config?.token || runtime.client?.token }),
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

  const currentMode = async () => resolveRadioDmMode(await modeStore.read(), env.OMNIFM_RADIO_DM_MODE).mode;

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

  async function sendOne(runtime, sender, recipient, show, run) {
    try {
      await sender.send(recipient.userId, radioDmBody(buildRadioDmMessage({
        show,
        language: recipient.language,
        config: getConfig(),
        guildName: recipient.guildName,
        applicationId: runtime.getApplicationId?.() || runtime.client.application?.id || null,
      })));
      run.sent += 1;
    } catch (error) {
      // No retry: a second try is exactly what looks like spam.
      run.failed += 1;
      if (isDmClosedError(error)) {
        await store.markDmsClosed(recipient.userId, { until: now() + CLOSED_FOR_MS })
          .catch((storeError) => log("WARN", `[OmniFM Radio] Geschlossene DMs nicht gespeichert: ${storeError?.message || storeError}`));
      } else {
        log("WARN", `[OmniFM Radio] DM an ${recipient.userId} fehlgeschlagen: ${error?.message || error}`);
      }
    }
  }

  /** @returns {Promise<string | null>} why it stopped early, null when everyone was handled */
  async function distribute(job, run) {
    const { signal } = job.controller;
    run.mode = await currentMode();
    if (run.mode === "off") return "off";
    const runtime = await waitForRuntime(signal);
    if (signal.aborted) return job.reason;
    if (!runtime) return "client";
    const recipients = collectRadioDmRecipients({
      guilds: runtime.client.guilds.cache.values(),
      config: getConfig(),
      test: run.test,
      resolveLanguage: (guildId) => runtime.resolveGuildLanguage?.(guildId),
      selfId: String(runtime.client.user?.id || ""),
    });
    run.total = recipients.length;
    run.remaining = recipients.length;
    const quota = run.test ? "test" : "real";
    const sender = createSender(runtime);
    try {
      return await distributeTo(job, run, { runtime, sender, recipients, quota });
    } finally {
      sender.stop?.();
    }
  }

  async function distributeTo(job, run, { runtime, sender, recipients, quota }) {
    const { signal } = job.controller;
    let pause = false;
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
      // eslint-disable-next-line no-await-in-loop
      const claimed = await store.claim(recipient.userId, { quota, windowMs: QUOTAS[quota], now: now(), subscribedOnly: run.mode === "optin" });
      run.remaining -= 1;
      if (!claimed) {
        run.skipped += 1;
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      await sendOne(runtime, sender, recipient, job.show, run);
      pause = true;
    }
    return null;
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
    };
    lastRun = run;
    active = job;
    try {
      run.stoppedBy = await distribute(job, run);
    } catch (error) {
      log("WARN", `[OmniFM Radio] DM-Verteilung abgebrochen: ${error?.message || error}`);
      run.stoppedBy = "error";
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

    /** Stores the console's mode; "off" also stops what runs, at once. */
    async setMode(mode) {
      const value = parseMode(mode);
      if (!RADIO_DM_MODES.includes(value)) throw new Error(`Unbekannter Modus: ${String(mode).slice(0, 20)}`);
      await modeStore.write(value);
      if (value === "off") abortAll("off");
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
