// ============================================================
// OmniFM: the owner cockpit's status service (#355)
// ============================================================
// Runs every check every 5 minutes in the commander, keeps the latest result
// and the last 24 hours per check, and tells the operator channel once when
// something turns red (and once when it is fine again).
import fs from "node:fs";
import path from "node:path";
import nodemailer from "nodemailer";

import { log, rootDir } from "../../lib/logging.js";
import { getDb, isConnected } from "../../lib/db.js";
import { notifyOperator, OPERATOR_COLORS } from "../operator-webhook.js";
import { getStationHealthReport } from "../station-health.js";
import { getTopGGState } from "../../topgg-store.js";
import { getDiscordBotListState } from "../../discordbotlist-store.js";
import { getBotsGGState } from "../../botsgg-store.js";
import { isTopGGEnabled } from "../topgg.js";
import { isDiscordBotListEnabled } from "../discordbotlist.js";
import { isBotsGGEnabled } from "../botsgg.js";
import {
  OWNER_STATUS_CHECKS,
  checkBotLists,
  checkBots,
  checkDiscordLogin,
  checkMongo,
  checkOperatorWebhook,
  checkRecognition,
  checkSmtp,
  checkStations,
  checkStripe,
  checkVersion,
  checkWebsite,
} from "./checks.js";

const INTERVAL_MS = 5 * 60_000;
const HISTORY_SIZE = 288; // 24 hours at one run every 5 minutes
const CHECK_TIMEOUT_MS = 20_000;

function readRunningVersion() {
  try {
    return JSON.parse(fs.readFileSync(path.join(rootDir, "package.json"), "utf8")).version || "";
  } catch {
    return "";
  }
}

async function loadOwnerConfig() {
  if (!isConnected() || !getDb()) return {};
  return (await getDb().collection("owner_config").findOne({ _id: "global" }).catch(() => null)) || {};
}

function withTimeout(promise, key) {
  let timer;
  return Promise.race([
    promise,
    new Promise((resolve) => {
      timer = setTimeout(() => resolve({ key, state: "warn", summary: "Die Prüfung hat zu lange gedauert.", detail: null }), CHECK_TIMEOUT_MS);
    }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * @param {object} options
 * @param {any[]} [options.runtimes]
 * @param {Record<string, Function>} [options.checks] key -> (context) => result, for tests
 */
export function createOwnerStatusService({
  runtimes = [],
  env = process.env,
  fetchImpl = globalThis.fetch,
  checks = null,
  getOwnerConfig = loadOwnerConfig,
  notify = notifyOperator,
  now = Date.now,
} = {}) {
  const latest = new Map();
  const history = new Map();
  let checkedAt = null;
  let running = null;
  let timer = null;
  const runningVersion = readRunningVersion();

  const defaultChecks = {
    bots: () => checkBots({ runtimes }),
    discordLogin: (context) => checkDiscordLogin({ env, fetchImpl, storedRedirectUri: context.storedRedirectUri }),
    website: (context) => checkWebsite({ env, fetchImpl, storedRedirectUri: context.storedRedirectUri }),
    mongo: () => checkMongo({ db: isConnected() ? getDb() : null }),
    stripe: (context) => checkStripe({ ownerConfig: context.ownerConfig, env, fetchImpl }),
    smtp: (context) => checkSmtp({ ownerConfig: context.ownerConfig, env, createTransport: nodemailer.createTransport.bind(nodemailer) }),
    recognition: (context) => checkRecognition({ ownerConfig: context.ownerConfig, env, fetchImpl }),
    operatorWebhook: () => checkOperatorWebhook({ env, fetchImpl }),
    botLists: () => checkBotLists({
      now: now(),
      lists: [
        { name: "Top.gg", enabled: isTopGGEnabled(runtimes), lastStatsSync: getTopGGState()?.lastStatsSync },
        { name: "Discord Bot List", enabled: isDiscordBotListEnabled(runtimes), lastStatsSync: getDiscordBotListState()?.lastStatsSync },
        { name: "Bots.gg", enabled: isBotsGGEnabled(runtimes), lastStatsSync: getBotsGGState()?.lastStatsSync },
      ],
    }),
    stations: () => checkStations({ report: getStationHealthReport() }),
    version: () => checkVersion({ runningVersion, fetchImpl }),
  };
  const table = checks || defaultChecks;

  function remember(entry) {
    const previous = latest.get(entry.key);
    latest.set(entry.key, entry);
    const list = history.get(entry.key) || [];
    list.push({ at: entry.checkedAt, state: entry.state });
    if (list.length > HISTORY_SIZE) list.splice(0, list.length - HISTORY_SIZE);
    history.set(entry.key, list);
    const label = OWNER_STATUS_CHECKS.find((check) => check.key === entry.key)?.label || entry.key;
    if (entry.state === "fail" && previous?.state !== "fail") {
      notify(`owner-status:${entry.key}:fail`, {
        title: `🔴 ${label} funktioniert nicht`,
        description: entry.summary,
        color: OPERATOR_COLORS?.error || 0xef4444,
      })?.catch?.(() => null);
    } else if (previous?.state === "fail" && entry.state === "ok") {
      notify(`owner-status:${entry.key}:ok`, {
        title: `🟢 ${label} wieder in Ordnung`,
        description: entry.summary,
        color: OPERATOR_COLORS?.success || 0x10b981,
      })?.catch?.(() => null);
    }
  }

  async function run({ only = null } = {}) {
    if (running) return running;
    running = (async () => {
      const ownerConfig = await getOwnerConfig().catch(() => ({}));
      const context = {
        ownerConfig,
        storedRedirectUri: typeof ownerConfig?.system?.discordOAuth?.redirectUri === "string" ? ownerConfig.system.discordOAuth.redirectUri : "",
      };
      const keys = OWNER_STATUS_CHECKS.map((check) => check.key).filter((key) => table[key] && (!only || only.includes(key)));
      const results = await Promise.all(keys.map((key) => withTimeout(
        Promise.resolve().then(() => table[key](context)).catch((err) => ({ key, state: "warn", summary: "Die Prüfung ist abgebrochen.", detail: String(err?.message || err) })),
        key,
      )));
      const stamp = new Date(now()).toISOString();
      for (const entry of results) remember({ ...entry, key: entry.key || "", checkedAt: stamp });
      checkedAt = stamp;
      return snapshot();
    })().finally(() => { running = null; });
    return running;
  }

  function snapshot() {
    return {
      checkedAt,
      checks: OWNER_STATUS_CHECKS.map((check) => {
        const entry = latest.get(check.key);
        return {
          key: check.key,
          label: check.label,
          area: check.area,
          state: entry?.state || "pending",
          summary: entry?.summary || "Wird geprüft …",
          detail: entry?.detail || null,
          checkedAt: entry?.checkedAt || null,
          history: history.get(check.key) || [],
        };
      }),
    };
  }

  function start({ intervalMs = INTERVAL_MS, firstRunMs = 20_000 } = {}) {
    if (timer) return;
    const tick = () => run().catch((err) => log("WARN", `[owner-status] Prüfung fehlgeschlagen: ${err?.message || err}`));
    setTimeout(tick, firstRunMs).unref?.();
    timer = setInterval(tick, intervalMs);
    timer.unref?.();
  }

  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  return { run, snapshot, start, stop };
}

let sharedService = null;

export function startOwnerStatusService(runtimes) {
  if (sharedService) return sharedService;
  sharedService = createOwnerStatusService({ runtimes });
  sharedService.start();
  return sharedService;
}

export function getOwnerStatusService() {
  return sharedService;
}
