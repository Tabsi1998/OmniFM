// ============================================================
// OmniFM: operator alerts beyond crashes and login failures (#260)
// ============================================================
// Sent through the operator webhook (src/services/operator-webhook.js):
//   - a worker that sends no heartbeat for a while, and when it is back
//   - a station whose failover chain is exhausted
//   - a server whose playback keeps making unexpected transitions (#210)
//   - a worker restarted by the autoheal
//   - little free disk space on the server
//   - catalog stations that stay out, and when they play again (#550)
// Each kind can be switched off with OPERATOR_ALERT_<KIND>=0 (the owner
// console writes these), and each has its own repeat cooldown.
import fs from "node:fs";

import { WEBSITE_URL } from "../bot/runtime-links.js";
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

// ---------------------------------------------------------------- stations (#550)

/** The owner console opened on its station catalog (the health of every station). */
export const STATION_COCKPIT_URL = `${String(WEBSITE_URL || "").replace(/\/+$/, "")}/admin?section=stations`;

// Discord allows 4096 characters in a description and 6000 in an embed.
const STATION_ALERT_TEXT_BUDGET = 3800;
const STATION_NAME_MAX = 80;
const STATION_REASON_MAX = 120;

export function stationAlertSettings(env = process.env) {
  return {
    confirmChecks: intEnv(env, "OPERATOR_STATION_ALERT_CHECKS", 3),
    confirmMs: intEnv(env, "OPERATOR_STATION_ALERT_MIN_MS", 15 * MINUTE),
    // At least the webhook's 60 s dedup window, or a due alert would be swallowed.
    cooldownMs: Math.max(MINUTE, intEnv(env, "OPERATOR_STATION_ALERT_COOLDOWN_MS", 15 * MINUTE)),
    // Playable this many checks in a row before "wieder spielbar": no flapping.
    recoveryChecks: intEnv(env, "OPERATOR_STATION_ALERT_RECOVERY_CHECKS", 2),
  };
}

/** Down for at least `confirmChecks` checks in a row over at least `confirmMs`: no wobble. */
export function isStationOutageConfirmed(entry, { confirmChecks, confirmMs }) {
  if (entry?.status !== "down") return false;
  const since = Number(entry.downSince || entry.lastCheckedAt || 0);
  return Number(entry.consecutiveFailures || 0) >= confirmChecks && Number(entry.lastCheckedAt || 0) - since >= confirmMs;
}

function plain(value, max) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  const clipped = text.length > max ? `${text.slice(0, max - 1)}…` : text;
  return clipped.replace(/([\\*_`~|>[\]])/g, "\\$1");
}

function stationLabel(entry) {
  return `**${plain(entry.name || entry.key, STATION_NAME_MAX)}** (\`${String(entry.key || "").replace(/`/g, "").slice(0, 60)}\`)`;
}

function outageLine(entry, at) {
  const state = entry.reachable ? "nicht spielbar" : "offline";
  const since = entry.downSince ? ` (seit ${minutes(at - Number(entry.downSince))} min)` : "";
  return `• ${stationLabel(entry)}: ${state} – ${plain(entry.error || "nicht erreichbar", STATION_REASON_MAX)}${since}`;
}

/** As many lines as fit into `budget`, the rest as "… und N weitere". */
function linesWithin(lines, budget) {
  const shown = [];
  let used = 0;
  for (const [index, line] of lines.entries()) {
    const rest = lines.length - index - 1;
    const reserve = rest > 0 ? 30 : 0;
    if (used + line.length + 1 + reserve > budget) {
      shown.push(`… und ${lines.length - index} weitere`);
      return shown;
    }
    shown.push(line);
    used += line.length + 1;
  }
  return shown;
}

/** One embed for every outage and return since the last alert. */
export function buildStationAlert({ down = [], back = [] }, { now = Date.now(), cockpitUrl = STATION_COCKPIT_URL } = {}) {
  const link = `[Sender-Cockpit öffnen](${cockpitUrl})`;
  const backHeader = `**Wieder spielbar (${back.length})**`;
  const sections = [];
  let budget = STATION_ALERT_TEXT_BUDGET - link.length;
  if (down.length > 0) {
    // The return list keeps room for its header and a few lines.
    const keep = back.length > 0 ? backHeader.length + 300 : 0;
    const lines = linesWithin(down.map((entry) => outageLine(entry, now)), budget - keep);
    const text = [`**Ausgefallen (${down.length})**`, ...lines].join("\n");
    sections.push(text);
    budget -= text.length + 2;
  }
  if (back.length > 0) {
    const lines = linesWithin(back.map((entry) => `• ${stationLabel(entry)}`), budget - backHeader.length - 2);
    sections.push([backHeader, ...lines].join("\n"));
  }
  sections.push(link);
  const title = down.length > 0 && back.length > 0
    ? "🟠 Sender ausgefallen und wieder spielbar"
    : down.length > 0 ? "🔴 Sender ausgefallen" : "🟢 Sender wieder spielbar";
  return {
    color: down.length > 0 && back.length > 0 ? OPERATOR_COLORS.warning : down.length > 0 ? OPERATOR_COLORS.error : OPERATOR_COLORS.success,
    title,
    description: sections.join("\n\n"),
  };
}

// After a failed send: try again after this pause, not every round. A webhook
// that stays broken (or is not set) then costs one attempt per five minutes.
const STATION_ALERT_RETRY_MS = 5 * MINUTE;

/**
 * Collects confirmed outages and returns out of the health entries and sends
 * them as one alert, at most once per cooldown. Whether an outage was
 * reported lives in the health entry (`outageAlerted`, stored in MongoDB), so
 * a restart neither repeats it nor loses the return line. `flush` returns the
 * marks to store: [{ key, outageAlerted }], and none when the message did not
 * reach Discord, so the next round tries again.
 */
export function createStationOutageAlerter({ env = process.env, send = notifyOperator, now = Date.now } = {}) {
  let nextAllowedAt = 0;
  return {
    async flush(entries = []) {
      const settings = stationAlertSettings(env);
      const down = [];
      const back = [];
      for (const entry of entries) {
        if (entry?.outageAlerted === true) {
          if (entry.status === "up" && Number(entry.consecutiveSuccesses || 0) >= settings.recoveryChecks) back.push(entry);
        } else if (isStationOutageConfirmed(entry, settings)) {
          down.push(entry);
        }
      }
      // Switched off: nothing is sent; an outage reported before is closed quietly.
      if (!alertEnabled("STATIONS", env)) {
        return entries.filter((entry) => entry?.outageAlerted === true && entry.status === "up")
          .map((entry) => ({ key: entry.key, outageAlerted: false }));
      }
      if (down.length === 0 && back.length === 0) return [];
      const at = now();
      if (at < nextAllowedAt) return [];
      const delivered = await send("station-outages", buildStationAlert({ down, back }, { now: at }));
      if (delivered !== true) {
        nextAllowedAt = at + Math.min(STATION_ALERT_RETRY_MS, settings.cooldownMs);
        return [];
      }
      nextAllowedAt = at + settings.cooldownMs;
      log("INFO", `[Operator-Alarm] Sender: ${down.length} ausgefallen, ${back.length} wieder spielbar gemeldet`);
      return [
        ...down.map((entry) => ({ key: entry.key, outageAlerted: true })),
        ...back.map((entry) => ({ key: entry.key, outageAlerted: false })),
      ];
    },
  };
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
