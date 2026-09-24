// Failback to the preferred station, the idle guard, stations that left the
// plan and keeping a backup station (#187, #188, #190, #233). Moved out of
// runtime-streams.js (#210), which re-exports everything here.
import { log } from "../lib/logging.js";
import { clipText, applyJitter } from "../lib/helpers.js";
import { normalizeFailoverChain, buildFailoverCandidateChain, normalizeFailoverKey } from "../lib/failover-chain.js";
import { clearActiveFailover, clearFailoverFailureWindow } from "../lib/stream-failover-policy.js";
import { recordRuntimeIncident } from "../runtime-incidents-store.js";
import { isRuntimeVoiceConnected } from "./runtime-live-state.js";
import { AudioPlayerStatus } from "@discordjs/voice";
import { safeFetch } from "../lib/safe-outbound-http.js";
import { loadStations } from "../stations-store.js";
import { languagePick } from "../lib/language.js";
import {
  toPositiveInt,
  getTierConfig,
  emitRuntimeReliabilityAlert,
  getStreamRestartErrorMessage,
} from "./runtime-streams.js";

// Failback: while a failover is active the preferred station is probed and
// restored automatically once it delivers audio again (#187).
const STREAM_FAILBACK_ENABLED = String(process.env.STREAM_FAILBACK_ENABLED ?? "1") !== "0";

const STREAM_FAILBACK_CHECK_MS = Math.max(30_000, toPositiveInt(process.env.STREAM_FAILBACK_CHECK_MS, 120_000));

const STREAM_FAILBACK_MAX_MS = Math.max(STREAM_FAILBACK_CHECK_MS, toPositiveInt(process.env.STREAM_FAILBACK_MAX_MS, 15 * 60_000));

const STREAM_FAILBACK_CONFIRMATIONS = Math.max(1, Math.min(10, toPositiveInt(process.env.STREAM_FAILBACK_CONFIRMATIONS, 2)));

const STREAM_FAILBACK_PROBE_TIMEOUT_MS = Math.max(1_000, Math.min(20_000, toPositiveInt(process.env.STREAM_FAILBACK_PROBE_TIMEOUT_MS, 5_000)));

const STREAM_FAILBACK_PROBE_BYTES = 4_096;

/**
 * Decides whether an AudioPlayer Idle event belongs to the stream that is
 * currently expected to play. Idle events of a resource that was already
 * replaced by a newer generation are ignored, otherwise every station switch
 * would schedule a restart for a stream that nobody wants anymore.
 */
function shouldHandleRuntimeIdleEvent(state, oldState = null) {
  if (!state) return false;
  if (state.ignoreNextIdleEvent === true) {
    state.ignoreNextIdleEvent = false;
    return false;
  }
  const resourceGeneration = Number(oldState?.resource?.metadata?.generation);
  const currentGeneration = Number(state.streamGeneration || 0) || 0;
  if (
    Number.isFinite(resourceGeneration)
    && resourceGeneration > 0
    && currentGeneration > 0
    && resourceGeneration !== currentGeneration
  ) {
    return false;
  }
  return true;
}

function clearRuntimeFailbackTimer(state) {
  if (!state) return;
  if (state.failbackTimer) {
    clearTimeout(state.failbackTimer);
    state.failbackTimer = null;
  }
  state.failbackNextProbeAt = 0;
}

function getRuntimeFailbackDelayMs(attempts = 0, {
  checkMs = STREAM_FAILBACK_CHECK_MS,
  maxMs = STREAM_FAILBACK_MAX_MS,
} = {}) {
  const exponent = Math.min(6, Math.max(0, Number.parseInt(String(attempts || 0), 10) || 0));
  return Math.min(Math.max(checkMs, maxMs), checkMs * Math.pow(2, exponent));
}

function isRuntimeFailbackPending(state) {
  if (!state || state.failoverActive !== true) return false;
  const desired = normalizeFailoverKey(state.desiredStationKey);
  const current = normalizeFailoverKey(state.currentStationKey);
  return Boolean(desired && current && desired !== current);
}

/**
 * Schedules the next check of the preferred station while a failover is
 * active. The delay grows with every failed probe up to STREAM_FAILBACK_MAX_MS
 * so a station that stays dead is not hammered.
 */
function armRuntimeFailbackProbe(runtime, guildId, state, { delayMs = null } = {}) {
  clearRuntimeFailbackTimer(state);
  if (!STREAM_FAILBACK_ENABLED) return false;
  if (!isRuntimeFailbackPending(state)) return false;

  const baseDelay = Number.isFinite(Number(delayMs)) && Number(delayMs) > 0
    ? Number(delayMs)
    : getRuntimeFailbackDelayMs(state.failbackAttempts || 0);
  const delay = Math.max(1_000, applyJitter(baseDelay, 0.15));
  state.failbackNextProbeAt = Date.now() + delay;
  state.failbackTimer = setTimeout(() => {
    state.failbackTimer = null;
    state.failbackNextProbeAt = 0;
    runRuntimeFailbackProbe(runtime, guildId, state).catch((err) => {
      log("WARN", `[${runtime.config.name}] Failback-Pruefung fehlgeschlagen guild=${guildId}: ${err?.message || err}`);
      state.failbackAttempts = (Number(state.failbackAttempts || 0) || 0) + 1;
      armRuntimeFailbackProbe(runtime, guildId, state);
    });
  }, delay);
  state.failbackTimer?.unref?.();

  const attempts = Number(state.failbackAttempts || 0) || 0;
  if (attempts === 0 || attempts % 5 === 0) {
    log(
      "INFO",
      `[${runtime.config.name}] Failback-Pruefung geplant guild=${guildId} wunsch=${state.desiredStationKey} aktuell=${state.currentStationKey} in ${Math.round(delay / 1000)}s (versuch ${attempts + 1})`
    );
  }
  return true;
}

/**
 * Opens the preferred station briefly and checks that audio bytes arrive.
 * A plain HTTP 200 is not enough: many providers answer 200 and then stall.
 */
async function probeRuntimeStreamUrl(url, { timeoutMs = STREAM_FAILBACK_PROBE_TIMEOUT_MS } = {}) {
  const response = await safeFetch(url, {
    method: "GET",
    redirect: "follow",
    headers: { "User-Agent": "OmniFM/3.0 failback-probe" },
    timeoutMs,
  });
  if (!response?.ok || !response.body) {
    try {
      await response?.body?.cancel?.();
    } catch {
      // ignore
    }
    return { ok: false, reason: `http-${Number(response?.status || 0) || "unknown"}` };
  }

  const reader = response.body.getReader();
  const deadline = Date.now() + Math.max(1_000, Number(timeoutMs) || STREAM_FAILBACK_PROBE_TIMEOUT_MS);
  let bytes = 0;
  try {
    while (bytes < STREAM_FAILBACK_PROBE_BYTES && Date.now() < deadline) {
      let timer = null;
      const chunk = await Promise.race([
        reader.read(),
        new Promise((resolve) => {
          timer = setTimeout(() => resolve({ done: true, timedOut: true }), Math.max(100, deadline - Date.now()));
        }),
      ]);
      if (timer) clearTimeout(timer);
      if (!chunk || chunk.done) break;
      bytes += Number(chunk.value?.length || 0) || 0;
    }
  } finally {
    try {
      await reader.cancel();
    } catch {
      // ignore
    }
  }
  return bytes > 0 ? { ok: true, bytes } : { ok: false, reason: "no-audio-data" };
}

/**
 * One failback attempt: probe the preferred station; after
 * STREAM_FAILBACK_CONFIRMATIONS successful probes in a row switch back.
 */
async function runRuntimeFailbackProbe(runtime, guildId, state, {
  nowMs = Date.now(),
  // A listener pressing "back to the preferred station" wants it now: one
  // successful probe is enough. The timer keeps the stricter default.
  requiredConfirmations = STREAM_FAILBACK_CONFIRMATIONS,
} = {}) {
  if (!isRuntimeFailbackPending(state) || !state.shouldReconnect || !state.currentStationKey) {
    return { ok: false, skipped: "inactive" };
  }
  if (
    state.streamRestartInFlight
    || state.streamRestartTimer
    || state.reconnectTimer
    || state.reconnectInFlight
    || state.voiceConnectInFlight
  ) {
    armRuntimeFailbackProbe(runtime, guildId, state, { delayMs: STREAM_FAILBACK_CHECK_MS });
    return { ok: false, skipped: "recovery" };
  }
  if (!isRuntimeVoiceConnected(runtime, guildId, state, { includeObserved: true })) {
    armRuntimeFailbackProbe(runtime, guildId, state, { delayMs: STREAM_FAILBACK_CHECK_MS });
    return { ok: false, skipped: "voice" };
  }
  const playerStatus = String(state.player?.state?.status || "").trim().toLowerCase();
  if (playerStatus === String(AudioPlayerStatus.Paused) || playerStatus === String(AudioPlayerStatus.AutoPaused)) {
    // Switching stations would unpause the player; wait until playback resumed.
    armRuntimeFailbackProbe(runtime, guildId, state, { delayMs: STREAM_FAILBACK_CHECK_MS });
    return { ok: false, skipped: "paused" };
  }

  const desiredKey = state.desiredStationKey;
  const currentKey = state.currentStationKey;
  const resolved = runtime.resolveStationForGuild(
    guildId,
    desiredKey,
    typeof runtime.resolveGuildLanguage === "function" ? runtime.resolveGuildLanguage(guildId) : "de"
  );
  if (!resolved?.ok || !resolved?.station?.url || !resolved?.stations) {
    // The preferred station is gone from the catalog or the plan: there is
    // nothing to return to, so the current station becomes the wanted one.
    log(
      "WARN",
      `[${runtime.config.name}] Failback aufgegeben guild=${guildId}: Wunschsender ${desiredKey} ist nicht mehr verfuegbar (${resolved?.message || "unbekannt"}). ${currentKey} bleibt aktiv.`
    );
    clearActiveFailover(state);
    state.desiredStationKey = currentKey;
    state.desiredStationName = state.currentStationName || currentKey;
    state.failbackAttempts = 0;
    state.failbackSuccessCount = 0;
    state.failbackLastProbeAt = nowMs;
    state.failbackLastResult = "abandoned";
    try {
      await recordRuntimeIncident({
        guildId,
        guildName: runtime?.client?.guilds?.cache?.get?.(guildId)?.name || guildId,
        tier: getTierConfig(guildId).tier,
        eventKey: "stream_failback_abandoned",
        severity: "warning",
        runtime: {
          id: String(runtime?.config?.id || "").trim(),
          name: String(runtime?.config?.name || "").trim(),
          role: String(runtime?.role || "").trim(),
        },
        payload: {
          previousStationKey: desiredKey,
          previousStationName: state.failoverFromStationName || desiredKey,
          failoverStationKey: currentKey,
          failoverStationName: state.currentStationName || currentKey,
          triggerError: resolved?.message || "station unavailable",
        },
      });
    } catch {}
    runtime.persistState?.();
    return { ok: false, abandoned: true };
  }

  const probe = typeof runtime.probeStreamUrl === "function"
    ? runtime.probeStreamUrl.bind(runtime)
    : probeRuntimeStreamUrl;
  let result;
  try {
    result = await probe(resolved.station.url);
  } catch (err) {
    result = { ok: false, reason: getStreamRestartErrorMessage(err) };
  }
  state.failbackLastProbeAt = nowMs;
  state.failbackLastResult = result?.ok ? "ok" : String(result?.reason || "failed");

  if (!result?.ok) {
    state.failbackSuccessCount = 0;
    state.failbackAttempts = (Number(state.failbackAttempts || 0) || 0) + 1;
    const attempts = state.failbackAttempts;
    if (attempts <= 3 || attempts % 5 === 0) {
      log(
        "INFO",
        `[${runtime.config.name}] Wunschsender ${desiredKey} weiterhin nicht erreichbar guild=${guildId} (${state.failbackLastResult}, versuch ${attempts}); ${currentKey} bleibt aktiv.`
      );
    }
    armRuntimeFailbackProbe(runtime, guildId, state);
    return { ok: false, probe: result };
  }

  state.failbackSuccessCount = (Number(state.failbackSuccessCount || 0) || 0) + 1;
  if (state.failbackSuccessCount < Math.max(1, Number(requiredConfirmations) || STREAM_FAILBACK_CONFIRMATIONS)) {
    armRuntimeFailbackProbe(runtime, guildId, state, {
      delayMs: Math.max(15_000, Math.round(STREAM_FAILBACK_CHECK_MS / 4)),
    });
    return { ok: true, confirmed: false, successCount: state.failbackSuccessCount };
  }

  const previousStationKey = currentKey;
  const previousStationName = state.currentStationName || currentKey;
  const failoverStartedAt = Number(state.failoverStartedAt || 0) || 0;
  state.streamRestartInFlight = true;
  try {
    await runtime.playStation(state, resolved.stations, resolved.key, guildId, {
      countAsStart: false,
      resumeSession: false,
      preserveDesiredStation: false,
    });
  } catch (err) {
    const message = getStreamRestartErrorMessage(err);
    state.failbackSuccessCount = 0;
    state.failbackAttempts = (Number(state.failbackAttempts || 0) || 0) + 1;
    state.failbackLastResult = `switch-failed: ${message}`;
    log("WARN", `[${runtime.config.name}] Failback zu ${desiredKey} fehlgeschlagen guild=${guildId}: ${message}. ${currentKey} laeuft weiter.`);
    armRuntimeFailbackProbe(runtime, guildId, state);
    return { ok: false, switchError: message };
  } finally {
    state.streamRestartInFlight = false;
  }

  clearFailoverFailureWindow(state);
  clearRuntimeFailbackTimer(state);
  state.failbackAttempts = 0;
  state.failbackSuccessCount = 0;
  log(
    "INFO",
    `[${runtime.config.name}] Failback abgeschlossen guild=${guildId}: ${previousStationKey} -> ${resolved.key} nach ${failoverStartedAt > 0 ? Math.round((nowMs - failoverStartedAt) / 1000) : "?"}s`
  );
  void emitRuntimeReliabilityAlert(runtime, guildId, "stream_failback_completed", {
    previousStationKey,
    previousStationName,
    restoredStationKey: resolved.key,
    restoredStationName: resolved.station.name || resolved.key,
    failoverDurationMs: failoverStartedAt > 0 ? Math.max(0, nowMs - failoverStartedAt) : 0,
    listenerCount: typeof runtime.getCurrentListenerCount === "function"
      ? runtime.getCurrentListenerCount(guildId, state)
      : 0,
  }).catch(() => null);
  runtime.persistState?.();
  return { ok: true, confirmed: true, switched: true, stationKey: resolved.key };
}

// ---------------------------------------------------------------------------
// Station no longer available for this server (#191)
// ---------------------------------------------------------------------------

/**
 * Finds a station the server may play when its current one left the catalog
 * or the plan: first the configured failover chain, then the catalog default.
 */
async function resolveReplacementStationForGuild(runtime, guildId, unavailableKey) {
  const language = typeof runtime.resolveGuildLanguage === "function" ? runtime.resolveGuildLanguage(guildId) : "de";
  const candidates = [];
  try {
    const settings = typeof runtime.loadGuildSettingsCached === "function"
      ? await runtime.loadGuildSettingsCached(guildId)
      : null;
    const chain = buildFailoverCandidateChain({
      currentStationKey: unavailableKey,
      configuredChain: normalizeFailoverChain(settings?.failoverChain || []),
      fallbackStation: String(settings?.fallbackStation || "").trim().toLowerCase(),
    });
    for (const key of chain) candidates.push({ key, source: "failover-chain" });
  } catch {}

  let defaultKey = null;
  try {
    defaultKey = typeof runtime.getCatalogDefaultStationKey === "function"
      ? runtime.getCatalogDefaultStationKey()
      : loadStations()?.defaultStationKey;
  } catch {
    defaultKey = null;
  }
  if (defaultKey) candidates.push({ key: String(defaultKey), source: "catalog-default" });

  const seen = new Set([normalizeFailoverKey(unavailableKey)]);
  for (const candidate of candidates) {
    const key = normalizeFailoverKey(candidate.key);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const resolved = runtime.resolveStationForGuild(guildId, candidate.key, language);
    if (resolved?.ok && resolved?.station?.url && resolved?.stations) {
      return { ...resolved, source: candidate.source };
    }
  }
  return { ok: false };
}

/**
 * Tells the server what happened (incident, alert channel, now-playing text
 * channel) when its station became unavailable. Never throws.
 */
async function notifyRuntimeStationUnavailable(runtime, guildId, state, payload = {}) {
  const language = typeof runtime.resolveGuildLanguage === "function" ? runtime.resolveGuildLanguage(guildId) : "de";
  const t = (de, en) => languagePick(language, de, en);
  const previous = clipText(payload.previousStationName || payload.previousStationKey || "-", 80);
  const replacement = clipText(payload.replacementStationName || payload.replacementStationKey || "", 80);
  const reason = payload.reason ? ` (${clipText(payload.reason, 140)})` : "";
  const text = payload.stopped === true || !replacement
    ? t(
      `\u26a0\ufe0f Sender **${previous}** ist auf diesem Server nicht mehr verf\u00fcgbar${reason}. OmniFM hat die Wiedergabe beendet. Starte mit /play einen anderen Sender.`,
      `\u26a0\ufe0f Station **${previous}** is no longer available on this server${reason}. OmniFM stopped playback. Use /play to start another station.`
    )
    : t(
      `\u26a0\ufe0f Sender **${previous}** ist auf diesem Server nicht mehr verf\u00fcgbar${reason}. OmniFM spielt stattdessen **${replacement}**. Mit /play kannst du jederzeit einen anderen Sender w\u00e4hlen.`,
      `\u26a0\ufe0f Station **${previous}** is no longer available on this server${reason}. OmniFM is playing **${replacement}** instead. Use /play any time to pick another station.`
    );

  void emitRuntimeReliabilityAlert(runtime, guildId, "station_unavailable", {
    previousStationKey: payload.previousStationKey || null,
    previousStationName: payload.previousStationName || payload.previousStationKey || null,
    replacementStationKey: payload.replacementStationKey || null,
    replacementStationName: payload.replacementStationName || null,
    triggerError: payload.reason || null,
    stopped: payload.stopped === true,
    listenerCount: typeof runtime.getCurrentListenerCount === "function" && state
      ? runtime.getCurrentListenerCount(guildId, state)
      : 0,
  }).catch(() => null);

  if (typeof runtime.resolveNowPlayingChannel !== "function") return false;
  const channelState = state || { nowPlayingChannelId: null, lastChannelId: payload.channelId || null };
  const channel = await runtime.resolveNowPlayingChannel(guildId, channelState).catch(() => null);
  if (!channel || typeof channel.send !== "function") return false;
  await channel.send({ content: clipText(text, 1900), allowedMentions: { parse: [] } }).catch(() => null);
  return true;
}

/**
 * The current station can no longer be played for this server (plan changed
 * or the station was removed). Instead of sitting silently in the voice
 * channel, switch to a replacement or stop and say why.
 */
async function handleRuntimeStationUnavailable(runtime, guildId, state, { source = "restart" } = {}) {
  const previousStationKey = state.currentStationKey;
  const previousStationName = state.currentStationName || previousStationKey;
  const language = typeof runtime.resolveGuildLanguage === "function" ? runtime.resolveGuildLanguage(guildId) : "de";
  const unavailable = typeof runtime.resolveStationForGuild === "function"
    ? runtime.resolveStationForGuild(guildId, previousStationKey, language)
    : null;
  const reason = unavailable?.message || "station unavailable";

  const replacement = await resolveReplacementStationForGuild(runtime, guildId, previousStationKey);
  if (replacement.ok) {
    try {
      await runtime.playStation(state, replacement.stations, replacement.key, guildId, {
        countAsStart: false,
        resumeSession: false,
        preserveDesiredStation: false,
      });
      log(
        "WARN",
        `[${runtime.config.name}] Sender ${previousStationKey} nicht mehr verfuegbar guild=${guildId} (${reason}); wechsle auf ${replacement.key} (${replacement.source}, source=${source}).`
      );
      await notifyRuntimeStationUnavailable(runtime, guildId, state, {
        previousStationKey,
        previousStationName,
        replacementStationKey: replacement.key,
        replacementStationName: replacement.station?.name || replacement.key,
        reason,
      });
      runtime.persistState?.();
      return { ok: true, replaced: true, stationKey: replacement.key, source: replacement.source };
    } catch (err) {
      log(
        "WARN",
        `[${runtime.config.name}] Ersatzsender ${replacement.key} konnte nicht gestartet werden guild=${guildId}: ${getStreamRestartErrorMessage(err)}`
      );
    }
  }

  log(
    "WARN",
    `[${runtime.config.name}] Sender ${previousStationKey} nicht mehr verfuegbar guild=${guildId} (${reason}) und kein Ersatz spielbar; Wiedergabe wird beendet (source=${source}).`
  );
  await notifyRuntimeStationUnavailable(runtime, guildId, state, {
    previousStationKey,
    previousStationName,
    reason,
    stopped: true,
  });
  if (typeof runtime.stopInGuild === "function") {
    try {
      await runtime.stopInGuild(guildId);
      return { ok: true, stopped: true };
    } catch (stopErr) {
      log("WARN", `[${runtime.config.name}] Wiedergabe konnte nach Senderverlust nicht sauber beendet werden: ${getStreamRestartErrorMessage(stopErr)}`);
    }
  }
  runtime.clearNowPlayingTimer?.(state);
  state.shouldReconnect = false;
  state.currentStationKey = null;
  state.currentStationName = null;
  state.desiredStationKey = null;
  state.desiredStationName = null;
  state.currentMeta = null;
  state.nowPlayingSignature = null;
  runtime.clearScheduledEventPlayback?.(state);
  runtime.updatePresence?.();
  runtime.persistState?.();
  return { ok: true, stopped: true };
}

/**
 * The listeners decide to stay on the backup station: it becomes the preferred
 * station and the failback probes stop (#216).
 */
function keepRuntimeFailoverStation(runtime, guildId, state) {
  if (!isRuntimeFailbackPending(state)) return { ok: false, reason: "no-failover" };
  const previousDesiredStationKey = state.desiredStationKey;
  state.desiredStationKey = state.currentStationKey;
  state.desiredStationName = state.currentStationName || state.currentStationKey;
  clearActiveFailover(state);
  clearRuntimeFailbackTimer(state);
  log(
    "INFO",
    `[${runtime.config.name}] Ersatzsender uebernommen guild=${guildId}: ${state.currentStationKey} ersetzt ${previousDesiredStationKey} als Wunschsender.`
  );
  runtime.persistState?.();
  return { ok: true, previousDesiredStationKey, stationKey: state.currentStationKey };
}

export {
  STREAM_FAILBACK_ENABLED,
  STREAM_FAILBACK_CHECK_MS,
  STREAM_FAILBACK_MAX_MS,
  STREAM_FAILBACK_CONFIRMATIONS,
  STREAM_FAILBACK_PROBE_TIMEOUT_MS,
  STREAM_FAILBACK_PROBE_BYTES,
  shouldHandleRuntimeIdleEvent,
  clearRuntimeFailbackTimer,
  getRuntimeFailbackDelayMs,
  isRuntimeFailbackPending,
  armRuntimeFailbackProbe,
  probeRuntimeStreamUrl,
  runRuntimeFailbackProbe,
  resolveReplacementStationForGuild,
  notifyRuntimeStationUnavailable,
  handleRuntimeStationUnavailable,
  keepRuntimeFailoverStation,
};
