// ============================================================
// OmniFM: operator alerts beyond crashes and login failures (#260)
// ============================================================
// Sent through the operator webhook (src/services/operator-webhook.js):
//   - a worker that sends no heartbeat for a while, and when it is back
//   - a station whose failover chain is exhausted
//   - a server whose playback keeps making unexpected transitions (#210)
//   - a worker restarted by the autoheal
//   - little free disk space on the server
// Each kind can be switched off with OPERATOR_ALERT_<KIND>=0 (the owner
// console writes these), and each has its own repeat cooldown.
import fs from "node:fs";

import { log } from "../lib/logging.js";
import { notifyOperator, OPERATOR_COLORS } from "./operator-webhook.js";

const MINUTE = 60_000;

function intEnv(env, name, fallback) {
  const value = Number.parseInt(String(env?.[name] ?? ""), 10);
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

export function alertEnabled(kind, env = process.env) {
  return String(env?.[`OPERATOR_ALERT_${kind}`] ?? "1").trim() !== "0";
}

/** Remembers when a key last alerted; `ready` says whether it may alert again. */
export function createCooldown(now = Date.now) {
  const last = new Map();
  return {
    ready(key, cooldownMs) {
      const at = now();
      const previous = last.get(key) || 0;
      if (previous && at - previous < cooldownMs) return false;
      last.set(key, at);
      return true;
    },
  };
}

function minutes(ms) {
  return Math.max(1, Math.round(ms / MINUTE));
}

// ---------------------------------------------------------------- workers

/**
 * Watches `worker.isReady()`. A worker that is not ready for `offlineAfterMs`
 * raises one "offline" alert; when it is ready again, one "back" alert.
 */
export function createWorkerAvailabilityWatch({ offlineAfterMs, notify, now = Date.now }) {
  const state = new Map();
  return {
    observe(workers = []) {
      const at = now();
      for (const worker of workers) {
        const name = String(worker?.config?.name || worker?.config?.id || "Worker");
        const entry = state.get(name) || { offlineSince: 0, alerted: false };
        if (worker?.isReady?.() === true) {
          if (entry.alerted) notify({ kind: "back", name, offlineMs: at - entry.offlineSince });
          state.set(name, { offlineSince: 0, alerted: false });
          continue;
        }
        if (!entry.offlineSince) entry.offlineSince = at;
        if (!entry.alerted && at - entry.offlineSince >= offlineAfterMs) {
          entry.alerted = true;
          notify({ kind: "offline", name, offlineMs: at - entry.offlineSince });
        }
        state.set(name, entry);
      }
    },
  };
}

function sendWorkerAvailability({ kind, name, offlineMs }) {
  if (kind === "offline") {
    return notifyOperator(`worker-offline:${name}`, {
      color: OPERATOR_COLORS.error,
      title: "🔴 Worker meldet sich nicht",
      description: `**${name}** sendet seit ${minutes(offlineMs)} min kein Lebenszeichen. ` +
        "Server auf diesem Worker sind womöglich stumm. Prüfen: `./update.sh --status quick`.",
    });
  }
  return notifyOperator(`worker-back:${name}`, {
    color: OPERATOR_COLORS.success,
    title: "🟢 Worker wieder da",
    description: `**${name}** meldet sich nach ${minutes(offlineMs)} min wieder.`,
  });
}

// ---------------------------------------------------------------- failover

const failoverCooldown = createCooldown();

export async function alertFailoverExhausted({ stationKey, stationName, guildName, runtimeName }, env = process.env) {
  if (!alertEnabled("FAILOVER_EXHAUSTED", env)) return false;
  // One alert per station: a dead station on twenty servers is one problem.
  const key = String(stationKey || stationName || "unknown");
  if (!failoverCooldown.ready(key, intEnv(env, "OPERATOR_FAILOVER_ALERT_COOLDOWN_MS", 30 * MINUTE))) return false;
  await notifyOperator(`failover-exhausted:${key}`, {
    color: OPERATOR_COLORS.error,
    title: "🔴 Failover erschöpft",
    description: `Für **${stationName || key}** funktioniert kein Ersatzsender der Failover-Kette mehr.`,
    fields: [
      { name: "Server", value: String(guildName || "-").slice(0, 100), inline: true },
      { name: "Worker", value: String(runtimeName || "-").slice(0, 100), inline: true },
    ],
  });
  return true;
}

// ---------------------------------------------------------------- playback loops

/**
 * Counts unexpected playback transitions (#210) per server. `threshold` of
 * them within `windowMs` means the playback is going round in circles.
 */
export function createPlaybackLoopTracker({ threshold, windowMs, cooldownMs, notify, now = Date.now }) {
  const seen = new Map();
  const cooldown = createCooldown(now);
  return {
    record(guildId, transition = {}, context = {}) {
      const at = now();
      const recent = (seen.get(guildId) || []).filter((time) => at - time < windowMs);
      recent.push(at);
      seen.set(guildId, recent);
      if (recent.length >= threshold && cooldown.ready(guildId, cooldownMs)) {
        notify({ guildId, count: recent.length, windowMs, transition, ...context });
        return true;
      }
      return false;
    },
  };
}

let playbackLoops = null;

export function recordUnexpectedPlaybackTransition(guildId, transition, context = {}, env = process.env) {
  if (!alertEnabled("PLAYBACK_LOOPS", env)) return false;
  playbackLoops ||= createPlaybackLoopTracker({
    threshold: intEnv(env, "OPERATOR_PLAYBACK_LOOP_THRESHOLD", 3),
    windowMs: intEnv(env, "OPERATOR_PLAYBACK_LOOP_WINDOW_MS", 15 * MINUTE),
    cooldownMs: intEnv(env, "OPERATOR_PLAYBACK_LOOP_COOLDOWN_MS", 60 * MINUTE),
    notify: ({ count, windowMs, transition: last, runtimeName }) => notifyOperator(`playback-loop:${guildId}`, {
      color: OPERATOR_COLORS.warning,
      title: "🟠 Wiedergabe dreht sich im Kreis",
      description: `Server \`${guildId}\` hatte ${count} unerwartete Wiedergabe-Übergänge in ${minutes(windowMs)} min. ` +
        "Das deutet auf einen Fehler im Ablauf hin; `/diag` auf dem Server zeigt den Verlauf.",
      fields: [
        { name: "Zuletzt", value: `${last?.from || "?"} → ${last?.to || "?"} (${last?.reason || "-"})`.slice(0, 200), inline: false },
        { name: "Worker", value: String(runtimeName || "-").slice(0, 100), inline: true },
      ],
    }),
  });
  return playbackLoops.record(String(guildId || "-"), transition, context);
}

// ---------------------------------------------------------------- autoheal

export async function alertWorkerAutoheal({ workerName, stuckGuilds }, env = process.env) {
  if (!alertEnabled("WORKER_AUTOHEAL", env)) return false;
  await notifyOperator(`worker-autoheal:${workerName}`, {
    color: OPERATOR_COLORS.warning,
    title: "🟠 Worker wird neu gestartet (Autoheal)",
    description: `**${workerName}** hatte ${stuckGuilds} Server ohne Voice-Verbindung, die sich nicht erholt haben. ` +
      "Der Worker startet neu und verbindet sie wieder.",
  });
  return true;
}

// ---------------------------------------------------------------- updates

/** The alert update.sh sends at its end or when it stops (#316). */
export function buildUpdateAlert({ ok, from, to, detail, host }) {
  const fields = [
    ...(detail ? [{ name: ok ? "Hinweis" : "Letzter Schritt", value: String(detail).slice(0, 1000), inline: false }] : []),
    ...(host ? [{ name: "Server", value: String(host).slice(0, 100), inline: true }] : []),
  ];
  if (ok) {
    return {
      key: `update-ok:${to || "-"}`,
      embed: {
        color: OPERATOR_COLORS.success,
        title: "🟢 Update erfolgreich",
        description: `OmniFM läuft jetzt mit **${to || "?"}** (vorher ${from || "?"}).`,
        fields,
      },
    };
  }
  return {
    key: "update-failed",
    embed: {
      color: OPERATOR_COLORS.error,
      title: "🔴 Update fehlgeschlagen",
      description: `Das Update von ${from || "?"} ist abgebrochen. ` +
        "Stand prüfen mit `./update.sh --status quick`, die Ausgabe von update.sh zeigt den Grund.",
      fields,
    },
  };
}

export async function alertUpdateResult(input, send = notifyOperator) {
  const { key, embed } = buildUpdateAlert(input);
  await send(key, embed);
}

// ---------------------------------------------------------------- disk space

export function describeDiskSpace(stats) {
  const total = Number(stats.blocks) * Number(stats.bsize);
  const free = Number(stats.bavail) * Number(stats.bsize);
  return { totalBytes: total, freeBytes: free, freePercent: total > 0 ? (free / total) * 100 : 100 };
}

export function isDiskSpaceLow({ freeBytes, freePercent }, { minPercent, minBytes }) {
  return freePercent < minPercent || freeBytes < minBytes;
}

function formatGiB(bytes) {
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

// ---------------------------------------------------------------- commander

/** Worker and disk watchers of the commander process. Returns a stop function. */
export function startOperatorAlertWatchers({ workers = [], dataDir = process.cwd(), env = process.env } = {}) {
  const timers = [];
  if (alertEnabled("WORKER_OFFLINE", env) && workers.length > 0) {
    const watch = createWorkerAvailabilityWatch({
      offlineAfterMs: intEnv(env, "OPERATOR_WORKER_OFFLINE_ALERT_MS", 3 * MINUTE),
      notify: (event) => {
        log(event.kind === "offline" ? "WARN" : "INFO", `[Operator-Alarm] Worker ${event.name}: ${event.kind}`);
        void sendWorkerAvailability(event);
      },
    });
    timers.push(setInterval(() => watch.observe(workers), 30_000));
  }
  if (alertEnabled("DISK_SPACE", env) && typeof fs.statfsSync === "function") {
    const limits = {
      minPercent: intEnv(env, "OPERATOR_DISK_FREE_MIN_PERCENT", 10),
      minBytes: intEnv(env, "OPERATOR_DISK_FREE_MIN_GB", 2) * 1024 ** 3,
    };
    const cooldown = createCooldown();
    const check = () => {
      try {
        const space = describeDiskSpace(fs.statfsSync(dataDir));
        if (!isDiskSpaceLow(space, limits) || !cooldown.ready("disk", 6 * 60 * MINUTE)) return;
        void notifyOperator("disk-space-low", {
          color: OPERATOR_COLORS.warning,
          title: "🟠 Wenig Speicherplatz",
          description: `Auf dem Server sind nur noch ${formatGiB(space.freeBytes)} frei ` +
            `(${space.freePercent.toFixed(0)} %). Backups und Logs brauchen Platz: \`./update.sh --status storage\`.`,
        });
      } catch (error) {
        log("WARN", `[Operator-Alarm] Speicherplatz nicht lesbar: ${error?.message || error}`);
      }
    };
    check();
    timers.push(setInterval(check, 10 * MINUTE));
  }
  for (const timer of timers) timer.unref?.();
  return () => {
    for (const timer of timers) clearInterval(timer);
  };
}
