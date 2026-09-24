import { log, logError } from "../lib/logging.js";
import { alertWorkerAutoheal } from "../services/operator-alerts.js";

function toPositiveInt(rawValue, fallbackValue) {
  const parsed = Number.parseInt(String(rawValue ?? fallbackValue), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallbackValue;
  return parsed;
}

function parseTimestampMs(value) {
  if (!value) return 0;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function hasRecoverablePlaybackTarget(state) {
  return Boolean(
    state?.currentStationKey
    && state?.shouldReconnect === true
    && state?.lastChannelId
  );
}

function hasActiveVoicePlayback(state) {
  return Boolean(state?.currentStationKey && state?.connection);
}

function describeRecoveringGuildState(guildId, state, sinceMs, nowMs) {
  if (!hasRecoverablePlaybackTarget(state) || hasActiveVoicePlayback(state)) {
    return null;
  }

  return {
    guildId,
    stationKey: state?.currentStationKey || null,
    stationName: state?.currentStationName || null,
    channelId: state?.lastChannelId || null,
    reconnectAttempts: Number(state?.reconnectAttempts || 0) || 0,
    reconnectCount: Number(state?.reconnectCount || 0) || 0,
    reconnectPending: Boolean(state?.reconnectTimer),
    reconnectInFlight: state?.reconnectInFlight === true,
    voiceConnectInFlight: state?.voiceConnectInFlight === true,
    streamRestartPending: Boolean(state?.streamRestartTimer),
    reconnectCircuitOpenUntil: Number(state?.reconnectCircuitOpenUntil || 0) || 0,
    voiceDisconnectObservedAt: Number(state?.voiceDisconnectObservedAt || 0) || 0,
    lastReconnectAtMs: parseTimestampMs(state?.lastReconnectAt),
    lastStreamErrorAtMs: parseTimestampMs(state?.lastStreamErrorAt),
    lastProcessExitAtMs: Number(state?.lastProcessExitAt || 0) || 0,
    lastProcessExitCode: Number.isFinite(Number(state?.lastProcessExitCode))
      ? Number(state?.lastProcessExitCode)
      : null,
    lastProcessExitDetail: state?.lastProcessExitDetail || null,
    lastStreamEndReason: state?.lastStreamEndReason || null,
    lastNetworkFailureAtMs: Number(state?.lastNetworkFailureAt || 0) || 0,
    restoreBlockedUntil: Number(state?.restoreBlockedUntil || 0) || 0,
    restoreBlockCount: Number(state?.restoreBlockCount || 0) || 0,
    restoreBlockReason: state?.restoreBlockReason || null,
    sinceMs,
    recoveringMs: Math.max(0, nowMs - sinceMs),
  };
}

function formatAgeSeconds(targetMs, nowMs) {
  const timestampMs = Number(targetMs || 0) || 0;
  if (timestampMs <= 0 || timestampMs > nowMs) return null;
  return Math.round((nowMs - timestampMs) / 1000);
}

function formatRecoveringGuildLog(row, nowMs) {
  const circuitRemainingMs = Math.max(0, Number(row?.reconnectCircuitOpenUntil || 0) - nowMs);
  const detail = [
    `guild=${row.guildId}`,
    `station=${row.stationKey || "-"}`,
    `channel=${row.channelId || "-"}`,
    `recovering=${Math.round((Number(row.recoveringMs || 0) || 0) / 1000)}s`,
    `attempts=${Number(row.reconnectAttempts || 0) || 0}`,
  ];
  if (row?.stationName && row.stationName !== row.stationKey) {
    detail.push(`stationName=${row.stationName}`);
  }
  if (row?.reconnectPending) detail.push("timer=1");
  if (row?.reconnectInFlight) detail.push("reconnect=1");
  if (row?.voiceConnectInFlight) detail.push("voice=1");
  if (row?.streamRestartPending) detail.push("stream=1");
  if (circuitRemainingMs > 0) {
    detail.push(`circuitRemaining=${Math.round(circuitRemainingMs / 1000)}s`);
  }
  if (row?.reconnectCount > 0) detail.push(`reconnects=${row.reconnectCount}`);
  const lastReconnectAgo = formatAgeSeconds(row?.lastReconnectAtMs, nowMs);
  if (lastReconnectAgo !== null) detail.push(`lastReconnectAgo=${lastReconnectAgo}s`);
  const lastStreamErrorAgo = formatAgeSeconds(row?.lastStreamErrorAtMs, nowMs);
  if (lastStreamErrorAgo !== null) detail.push(`lastStreamErrorAgo=${lastStreamErrorAgo}s`);
  const lastProcessExitAgo = formatAgeSeconds(row?.lastProcessExitAtMs, nowMs);
  if (lastProcessExitAgo !== null) detail.push(`lastExitAgo=${lastProcessExitAgo}s`);
  if (row?.lastProcessExitCode !== null) detail.push(`lastExitCode=${row.lastProcessExitCode}`);
  if (row?.lastProcessExitDetail) detail.push(`lastExitDetail=${row.lastProcessExitDetail}`);
  if (row?.lastStreamEndReason) detail.push(`lastStreamEnd=${row.lastStreamEndReason}`);
  const lastNetworkFailureAgo = formatAgeSeconds(row?.lastNetworkFailureAtMs, nowMs);
  if (lastNetworkFailureAgo !== null) detail.push(`lastNetworkFailureAgo=${lastNetworkFailureAgo}s`);
  const voiceDisconnectAgo = formatAgeSeconds(row?.voiceDisconnectObservedAt, nowMs);
  if (voiceDisconnectAgo !== null) detail.push(`voiceDisconnectAgo=${voiceDisconnectAgo}s`);
  if (row?.restoreBlockCount > 0) detail.push(`restoreBlocks=${row.restoreBlockCount}`);
  if (row?.restoreBlockReason) detail.push(`restoreBlockReason=${row.restoreBlockReason}`);
  const restoreBlockedRemainingMs = Math.max(0, Number(row?.restoreBlockedUntil || 0) - nowMs);
  if (restoreBlockedRemainingMs > 0) {
    detail.push(`restoreBlockedFor=${Math.round(restoreBlockedRemainingMs / 1000)}s`);
  }
  return detail.join(" ");
}

function resolveWorkerAutohealBlockOptions(env = process.env) {
  // A blocked target is retried after one fixed pause. The pause used to start
  // at 30 minutes and double up to six hours, which kept 24/7 servers silent
  // far longer than the worker restart itself needed (#190).
  const baseMs = Math.max(5 * 60_000, toPositiveInt(env.WORKER_AUTOHEAL_BLOCK_MS, 15 * 60_000));
  const maxMs = Math.max(baseMs, toPositiveInt(env.WORKER_AUTOHEAL_BLOCK_MAX_MS, baseMs));
  return { baseMs, maxMs };
}

function applyWorkerAutohealRecoveryBlock(runtime, stuckGuilds = [], env = process.env, nowMs = Date.now()) {
  const options = resolveWorkerAutohealBlockOptions(env);
  const applied = [];

  for (const row of stuckGuilds) {
    const guildId = String(row?.guildId || "").trim();
    if (!guildId) continue;
    const state = runtime?.guildState?.get?.(guildId);
    if (!hasRecoverablePlaybackTarget(state)) continue;

    const nextCount = Math.max(1, (Number(state?.restoreBlockCount || 0) || 0) + 1);
    const delayMs = Math.min(options.maxMs, options.baseMs);
    state.restoreBlockedAt = nowMs;
    state.restoreBlockedUntil = nowMs + delayMs;
    state.restoreBlockCount = nextCount;
    state.restoreBlockReason = "worker-autoheal";
    state.shouldReconnect = false;
    state.reconnectInFlight = false;
    state.voiceConnectInFlight = false;
    if (state.reconnectTimer) {
      clearTimeout(state.reconnectTimer);
      state.reconnectTimer = null;
    }
    if (state.streamRestartTimer) {
      clearTimeout(state.streamRestartTimer);
      state.streamRestartTimer = null;
    }

    applied.push({
      guildId,
      delayMs,
      blockedUntil: state.restoreBlockedUntil,
      blockCount: nextCount,
    });
  }

  return applied;
}

function resolveWorkerAutohealOptions(env = process.env, runtime = null) {
  const workerIndex = Number.parseInt(
    String(runtime?.config?.index || env.BOT_PROCESS_INDEX || "0"),
    10
  ) || 0;
  const workerStaggerMs = Math.max(0, ((Math.max(1, workerIndex) - 1) % 5) * 30_000);

  const checkMs = Math.max(5_000, toPositiveInt(env.WORKER_AUTOHEAL_CHECK_MS, 30_000));
  const graceMs = Math.max(60_000, toPositiveInt(env.WORKER_AUTOHEAL_GRACE_MS, 10 * 60_000)) + workerStaggerMs;
  const unhealthyMs = Math.max(2 * 60_000, toPositiveInt(env.WORKER_AUTOHEAL_RECOVERING_MS, 20 * 60_000)) + workerStaggerMs;

  return {
    enabled: String(env.WORKER_AUTOHEAL_ENABLED ?? "1") !== "0",
    checkMs,
    graceMs,
    unhealthyMs,
    workerIndex,
    workerStaggerMs,
  };
}

function evaluateWorkerAutohealState(runtime, unhealthySinceByGuild = new Map(), options = {}, nowMs = Date.now()) {
  const normalizedOptions = {
    enabled: options.enabled !== false,
    graceMs: Math.max(60_000, Number(options.graceMs || 10 * 60_000) || (10 * 60_000)),
    unhealthyMs: Math.max(2 * 60_000, Number(options.unhealthyMs || 20 * 60_000) || (20 * 60_000)),
  };
  const nextTracker = new Map(unhealthySinceByGuild);
  const guildEntries = [...(runtime?.guildState?.entries?.() || [])];

  let recoverableTargetCount = 0;
  let activeVoiceCount = 0;
  const recoveringGuilds = [];

  for (const [guildId, state] of guildEntries) {
    if (hasRecoverablePlaybackTarget(state)) {
      recoverableTargetCount += 1;
    }
    if (hasActiveVoicePlayback(state)) {
      activeVoiceCount += 1;
    }

    if (!hasRecoverablePlaybackTarget(state) || hasActiveVoicePlayback(state)) {
      nextTracker.delete(guildId);
      continue;
    }

    const sinceMs = Number(nextTracker.get(guildId) || nowMs) || nowMs;
    nextTracker.set(guildId, sinceMs);
    const row = describeRecoveringGuildState(guildId, state, sinceMs, nowMs);
    if (row) recoveringGuilds.push(row);
  }

  for (const guildId of [...nextTracker.keys()]) {
    if (!guildEntries.some(([entryGuildId, state]) => entryGuildId === guildId && hasRecoverablePlaybackTarget(state) && !hasActiveVoicePlayback(state))) {
      nextTracker.delete(guildId);
    }
  }

  const ready = runtime?.client?.isReady?.() === true;
  const startedAtMs = Number(runtime?.startedAt || 0) || 0;
  const uptimeMs = startedAtMs > 0 ? Math.max(0, nowMs - startedAtMs) : 0;
  const stuckGuilds = recoveringGuilds.filter((row) => row.recoveringMs >= normalizedOptions.unhealthyMs);

  const shouldExit = Boolean(
    normalizedOptions.enabled
    && ready
    && uptimeMs >= normalizedOptions.graceMs
    && recoverableTargetCount > 0
    && activeVoiceCount === 0
    && recoveringGuilds.length > 0
    && stuckGuilds.length === recoveringGuilds.length
    && recoveringGuilds.length === recoverableTargetCount
  );

  return {
    ready,
    uptimeMs,
    recoverableTargetCount,
    activeVoiceCount,
    recoveringGuilds,
    stuckGuilds,
    shouldExit,
    unhealthySinceByGuild: nextTracker,
    options: normalizedOptions,
  };
}

async function observeRecoveringGuildVoicePresence(runtime, guildRows = []) {
  if (!Array.isArray(guildRows) || guildRows.length === 0) return [];
  if (typeof runtime?.fetchBotVoiceState !== "function") return [];

  const observed = [];
  for (const row of guildRows) {
    const guildId = String(row?.guildId || "").trim();
    if (!guildId) continue;
    try {
      // Confirm against Discord before treating a missing local connection as a dead worker.
      const voiceState = await runtime.fetchBotVoiceState(guildId);
      const actualChannelId = String(voiceState?.channelId || "").trim();
      if (!actualChannelId) continue;

      const state = runtime?.guildState?.get?.(guildId);
      if (state && state.lastChannelId !== actualChannelId) {
        runtime?.markNowPlayingTargetDirty?.(state, actualChannelId);
        state.lastChannelId = actualChannelId;
      }
      runtime?.queueVoiceStateReconcile?.(guildId, "worker-autoheal-observed-voice", 1200);
      observed.push({
        guildId,
        channelId: actualChannelId,
      });
    } catch {
      // ignore voice-state fetch errors; autoheal may still be needed
    }
  }
  return observed;
}

function startWorkerAutohealMonitor({
  runtime,
  shutdown = null,
  exit = (code) => process.exit(code),
  env = process.env,
} = {}) {
  const options = resolveWorkerAutohealOptions(env, runtime);
  if (!options.enabled) {
    return {
      options,
      async tick() {
        return null;
      },
      stop() {},
    };
  }

  let timer = null;
  let unhealthySinceByGuild = new Map();
  let stopping = false;

  const tick = async () => {
    const nowMs = Date.now();
    const evaluation = evaluateWorkerAutohealState(runtime, unhealthySinceByGuild, options, nowMs);
    unhealthySinceByGuild = evaluation.unhealthySinceByGuild;

    if (!evaluation.shouldExit || stopping) {
      return evaluation;
    }

    const observedVoiceGuilds = await observeRecoveringGuildVoicePresence(runtime, evaluation.stuckGuilds);
    if (observedVoiceGuilds.length > 0) {
      try {
        runtime?.persistState?.();
      } catch {
        // ignore persistence issues during voice-state confirmation
      }
      const lines = [
        `[${runtime?.config?.name || "Worker"}] Worker-Autoheal verworfen: ` +
        `${observedVoiceGuilds.length} Recovery-Ziel(e) zeigen weiterhin einen Discord-Voice-State. ` +
        `Reconcile wird erneut angestossen.`,
        `summary workerIndex=${options.workerIndex} uptime=${Math.round((Number(evaluation.uptimeMs || 0) || 0) / 1000)}s ` +
        `recoverableTargets=${evaluation.recoverableTargetCount} activeVoice=${evaluation.activeVoiceCount} ` +
        `grace=${Math.round(options.graceMs / 1000)}s check=${Math.round(options.checkMs / 1000)}s`,
      ];
      observedVoiceGuilds.forEach((row, index) => {
        lines.push(`observed[${index + 1}] guild=${row.guildId} channel=${row.channelId}`);
      });
      log("WARN", lines.join("\n"));
      return {
        ...evaluation,
        shouldExit: false,
        observedVoiceGuilds,
      };
    }

    stopping = true;
    const blockedTargets = applyWorkerAutohealRecoveryBlock(runtime, evaluation.stuckGuilds, env, nowMs);
    const lines = [
      `[${runtime?.config?.name || "Worker"}] Worker-Autoheal ausgeloest: ` +
      `${evaluation.stuckGuilds.length} Recovery-Ziel(e) seit >=${Math.round(options.unhealthyMs / 1000)}s ohne aktive Voice-Verbindung. ` +
      `Neustart des Workers wird angefordert.`,
      `summary workerIndex=${options.workerIndex} uptime=${Math.round((Number(evaluation.uptimeMs || 0) || 0) / 1000)}s ` +
      `recoverableTargets=${evaluation.recoverableTargetCount} activeVoice=${evaluation.activeVoiceCount} ` +
      `grace=${Math.round(options.graceMs / 1000)}s check=${Math.round(options.checkMs / 1000)}s`,
    ];
    evaluation.stuckGuilds.forEach((row, index) => {
      lines.push(`target[${index + 1}] ${formatRecoveringGuildLog(row, nowMs)}`);
    });
    blockedTargets.forEach((row, index) => {
      lines.push(
        `cooldown[${index + 1}] guild=${row.guildId} block=${row.blockCount} ` +
        `cooldown=${Math.round((Number(row.delayMs || 0) || 0) / 1000)}s ` +
        `blockedUntil=${new Date(Number(row.blockedUntil || nowMs) || nowMs).toISOString()}`
      );
    });
    log("ERROR", lines.join("\n"));
    // The operator hears about it, but the restart never waits long for Discord (#260).
    await Promise.race([
      alertWorkerAutoheal({
        workerName: runtime?.config?.name || `Worker ${options.workerIndex}`,
        stuckGuilds: evaluation.stuckGuilds.length,
      }).catch(() => false),
      new Promise((resolve) => {
        setTimeout(resolve, 3_000).unref?.();
      }),
    ]);

    try {
      runtime?.persistState?.({ forceLog: true });
    } catch {
      // ignore persist issues during forced restart
    }

    try {
      if (typeof shutdown === "function") {
        await shutdown("worker-autoheal");
      }
    } catch (err) {
      logError(`[${runtime?.config?.name || "Worker"}] Worker-Autoheal Shutdown fehlgeschlagen`, err, {
        context: {
          bot: runtime?.config?.name || null,
          botId: runtime?.config?.id || null,
          workerIndex: options.workerIndex,
          source: "worker-autoheal-shutdown",
        },
      });
    } finally {
      exit(1);
    }

    return evaluation;
  };

  timer = setInterval(() => {
    tick().catch((err) => {
      logError(`[${runtime?.config?.name || "Worker"}] Worker-Autoheal Tick fehlgeschlagen`, err, {
        context: {
          bot: runtime?.config?.name || null,
          botId: runtime?.config?.id || null,
          workerIndex: options.workerIndex,
          source: "worker-autoheal-tick",
        },
      });
    });
  }, options.checkMs);
  timer?.unref?.();

  return {
    options,
    tick,
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      unhealthySinceByGuild.clear();
      stopping = true;
    },
  };
}

export {
  applyWorkerAutohealRecoveryBlock,
  evaluateWorkerAutohealState,
  resolveWorkerAutohealOptions,
  startWorkerAutohealMonitor,
};
