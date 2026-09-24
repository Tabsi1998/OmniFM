// Voice state reconcile: compares what the bot believes about its voice
// connection with what Discord reports, and repairs the difference on a timer.
// Moved out of runtime-recovery.js (#210), which re-exports everything here.
import { AudioPlayerStatus } from "@discordjs/voice";
import { log, logError } from "../lib/logging.js";
import { waitMs } from "../lib/helpers.js";
import {
  toPositiveInt,
  VOICE_TRANSIENT_RECHECK_MS,
  getRuntimeVoiceGuardConfig,
  isRuntimeVoiceGuardCooldownActive,
  recordRuntimeVoiceGuardAction,
  noteRuntimeVoiceGuardMove,
  clearRuntimeVoiceGuardWindow,
  shouldProtectRuntimeVoiceChannel,
  buildRuntimeLogContext,
  getRuntimePlayerStatus,
  logRuntimeRecoveryState,
  shouldLogRecurringTransientIssue,
  clearTransientVoiceIssue,
  confirmTransientVoiceIssue,
} from "./runtime-recovery.js";

const VOICE_STATE_RECONCILE_ENABLED = String(process.env.VOICE_STATE_RECONCILE_ENABLED ?? "1") !== "0";

const VOICE_STATE_RECONCILE_MS = Math.max(15_000, toPositiveInt(process.env.VOICE_STATE_RECONCILE_MS, 30_000));

const VOICE_STATE_MISSING_CONFIRMATIONS = Math.max(2, toPositiveInt(process.env.VOICE_STATE_MISSING_CONFIRMATIONS, 2));

function syncObservedRuntimeChannel(runtime, state, actualChannelId) {
  const normalizedActualChannelId = String(actualChannelId || "").trim();
  if (!normalizedActualChannelId) return false;
  if (String(state?.lastChannelId || "").trim() === normalizedActualChannelId) {
    return false;
  }
  runtime.markNowPlayingTargetDirty(state, normalizedActualChannelId);
  state.lastChannelId = normalizedActualChannelId;
  runtime.persistState();
  return true;
}

function clearQueuedRuntimeVoiceReconcile(runtime, guildId) {
  const key = String(guildId || "").trim();
  const timer = runtime.pendingVoiceReconcileTimers.get(key);
  if (timer) {
    clearTimeout(timer);
    runtime.pendingVoiceReconcileTimers.delete(key);
  }
}

function queueRuntimeVoiceStateReconcile(runtime, guildId, reason = "queued", delayMs = 1200) {
  const key = String(guildId || "").trim();
  if (!key) return;
  runtime.clearQueuedVoiceReconcile(key);
  const timer = setTimeout(() => {
    runtime.pendingVoiceReconcileTimers.delete(key);
    runtime.reconcileGuildVoiceState(key, { reason }).catch((err) => {
      const state = runtime.guildState?.get?.(key);
      logError(`[${runtime.config.name}] Voice-State-Reconcile (${reason}) fehlgeschlagen`, err, {
        level: "WARN",
        context: buildRuntimeLogContext(runtime, key, state, {
          source: "voice-state-reconcile",
        }),
      });
    });
  }, Math.max(0, delayMs));
  if (typeof timer?.unref === "function") {
    timer.unref();
  }
  runtime.pendingVoiceReconcileTimers.set(key, timer);
}

async function confirmRuntimeBotVoiceChannel(
  runtime,
  guildId,
  expectedChannelId,
  { timeoutMs = 10_000, intervalMs = 800 } = {}
) {
  const normalizedGuildId = String(guildId || "").trim();
  const normalizedChannelId = String(expectedChannelId || "").trim();
  if (!normalizedGuildId || !normalizedChannelId) return false;

  const startedAt = Date.now();
  while ((Date.now() - startedAt) <= Math.max(intervalMs, timeoutMs)) {
    const { channelId } = await runtime.fetchBotVoiceState(normalizedGuildId);
    if (String(channelId || "").trim() === normalizedChannelId) {
      return true;
    }
    await waitMs(intervalMs);
  }
  return false;
}

async function fetchRuntimeBotVoiceState(runtime, guildId) {
  const guild = runtime.client.guilds.cache.get(guildId) || await runtime.client.guilds.fetch(guildId).catch(() => null);
  if (!guild) return { guild: null, voiceState: null, channelId: null };

  try {
    const voiceState = await guild.voiceStates.fetch("@me", { force: true, cache: true });
    return { guild, voiceState, channelId: voiceState?.channelId || null };
  } catch {
    const cachedMember = guild.members?.me || null;
    const cachedChannelId = String(cachedMember?.voice?.channelId || "").trim();
    if (cachedChannelId) {
      return { guild, voiceState: cachedMember.voice || null, channelId: cachedChannelId };
    }

    const fetchedMember = await guild.members?.fetchMe?.().catch(() => null);
    const memberChannelId = String(fetchedMember?.voice?.channelId || "").trim();
    return {
      guild,
      voiceState: fetchedMember?.voice || null,
      channelId: memberChannelId || null,
    };
  }
}

async function reconcileRuntimeGuildVoiceState(runtime, guildId, { reason = "periodic" } = {}) {
  if (!runtime.client.isReady()) return;
  const state = runtime.guildState.get(guildId);
  if (!state) return;
  if (!state.connection && !state.currentStationKey && !state.lastChannelId) return;
  const voiceGuardConfig = getRuntimeVoiceGuardConfig(state);

  const { channelId: actualChannelId } = await runtime.fetchBotVoiceState(guildId);
  const connectionChannelId = String(state.connection?.joinConfig?.channelId || "").trim() || null;
  let expectedChannelId = connectionChannelId || state.lastChannelId || null;

  if (actualChannelId && !expectedChannelId) {
    syncObservedRuntimeChannel(runtime, state, actualChannelId);
    expectedChannelId = String(actualChannelId || "").trim() || null;
  } else if (actualChannelId && connectionChannelId && actualChannelId === connectionChannelId) {
    if (syncObservedRuntimeChannel(runtime, state, actualChannelId)) {
      expectedChannelId = String(actualChannelId || "").trim() || null;
    }
  }

  const voiceOperationInFlight = Boolean(
    state.voiceConnectInFlight
    || state.reconnectInFlight
    || state.reconnectTimer
  );
  const shouldDeferVoiceMismatch = Boolean(
    state.voiceConnectInFlight
    || state.reconnectInFlight
    || (!actualChannelId && state.reconnectTimer)
  );
  if (shouldDeferVoiceMismatch && (!actualChannelId || (expectedChannelId && actualChannelId !== expectedChannelId))) {
    runtime.queueVoiceStateReconcile(guildId, `voice-op-inflight-${reason}`, 1500);
    return;
  }

  if (!actualChannelId) {
    const shouldReconnect = Boolean(state.shouldReconnect && state.currentStationKey && state.lastChannelId);
    if (!state.connection && !state.currentProcess && !shouldReconnect) return;
    if (!state.connection && shouldReconnect && voiceOperationInFlight) {
      return;
    }
    const issue = confirmTransientVoiceIssue(
      runtime,
      guildId,
      state,
      "voice-state-missing",
      `${expectedChannelId || "-"}:${reason}`,
      {
        threshold: VOICE_STATE_MISSING_CONFIRMATIONS,
        recheckReason: `voice-state-confirm-${reason}`,
        logMessage: `Voice-State abweichend erkannt (expected=${expectedChannelId || "-"}, reason=${reason})`,
      }
    );
    if (!issue.confirmed) {
      return;
    }
    clearTransientVoiceIssue(state, "voice-state-missing");
    log(
      "WARN",
      `[${runtime.config.name}] Voice-State abweichung bestaetigt (guild=${guildId}, expected=${expectedChannelId || "-"}, reason=${reason}).`
    );
    state.voiceDisconnectObservedAt = state.voiceDisconnectObservedAt || Date.now();
    runtime.resetVoiceSession(guildId, state, {
      preservePlaybackTarget: shouldReconnect,
      clearLastChannel: !shouldReconnect,
    });
    if (shouldReconnect) {
      runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: `voice-state-${reason}` });
    }
    return;
  }
  clearTransientVoiceIssue(state, "voice-state-missing");
  clearTransientVoiceIssue(state, "voice-state-update-missing");
  state.voiceDisconnectObservedAt = 0;

  if (expectedChannelId && actualChannelId !== expectedChannelId) {
    const protectedMove = shouldProtectRuntimeVoiceChannel(state, expectedChannelId, voiceGuardConfig);
    const issue = confirmTransientVoiceIssue(
      runtime,
      guildId,
      state,
      "voice-channel-mismatch",
      `${expectedChannelId}:${actualChannelId}:${reason}`,
      {
        threshold: protectedMove ? voiceGuardConfig.moveConfirmations : VOICE_STATE_MISSING_CONFIRMATIONS,
        recheckReason: `voice-channel-mismatch-confirm-${reason}`,
        logMessage: `Voice-Channel-Mismatch erkannt (expected=${expectedChannelId}, actual=${actualChannelId}, reason=${reason})`,
      }
    );
    if (!issue.confirmed) {
      return;
    }
    clearTransientVoiceIssue(state, "voice-channel-mismatch");
    if (protectedMove) {
      const movePolicy = voiceGuardConfig.policy;
      const nowMs = Date.now();
      const remainingGuardCooldownMs = Math.max(0, (Number(state.voiceGuardCooldownUntil || 0) || 0) - nowMs);
      const moveSummary = noteRuntimeVoiceGuardMove(state, voiceGuardConfig, {
        expectedChannelId,
        actualChannelId,
        nowMs,
      });
      log(
        "WARN",
        `[${runtime.config.name}] Fremdverschiebung bestaetigt guild=${guildId} expected=${expectedChannelId} actual=${actualChannelId} - Policy=${movePolicy}.`
      );
      if (moveSummary.exceededWindow) {
        state.voiceGuardEscalationCount = (Number(state.voiceGuardEscalationCount || 0) || 0) + 1;
        if (voiceGuardConfig.escalation === "cooldown") {
          state.voiceGuardCooldownUntil = nowMs + voiceGuardConfig.escalationCooldownMs;
          recordRuntimeVoiceGuardAction(state, "cooldown", {
            reason: "foreign-move-escalated",
            expectedChannelId,
            actualChannelId,
            atMs: nowMs,
          });
          runtime.persistState?.();
          runtime.queueVoiceStateReconcile(guildId, "voice-guard-cooldown", voiceGuardConfig.escalationCooldownMs);
          return;
        }

        state.voiceGuardDisconnectCount = (Number(state.voiceGuardDisconnectCount || 0) || 0) + 1;
        state.shouldReconnect = false;
        recordRuntimeVoiceGuardAction(state, "disconnect", {
          reason: "foreign-move-escalated",
          expectedChannelId,
          actualChannelId,
          atMs: nowMs,
        });
        runtime.resetVoiceSession(guildId, state, {
          preservePlaybackTarget: false,
          clearLastChannel: true,
        });
        return;
      }
      if (movePolicy === "disconnect") {
        state.voiceGuardDisconnectCount = (Number(state.voiceGuardDisconnectCount || 0) || 0) + 1;
        state.shouldReconnect = false;
        recordRuntimeVoiceGuardAction(state, "disconnect", {
          reason: "foreign-move-policy",
          expectedChannelId,
          actualChannelId,
          atMs: nowMs,
        });
        runtime.resetVoiceSession(guildId, state, {
          preservePlaybackTarget: false,
          clearLastChannel: true,
        });
        return;
      }

      state.voiceGuardReturnCount = (Number(state.voiceGuardReturnCount || 0) || 0) + 1;
      state.voiceGuardCooldownUntil = nowMs + voiceGuardConfig.returnCooldownMs;
      recordRuntimeVoiceGuardAction(state, "return", {
        reason: "foreign-move-policy",
        expectedChannelId,
        actualChannelId,
        atMs: nowMs,
      });
      if (state.connection) {
        try { state.connection.destroy(); } catch {}
      }
      const reconnectOptions = {
        resetAttempts: true,
        reason: "voice-channel-mismatch-guard",
      };
      if (remainingGuardCooldownMs > 0) {
        reconnectOptions.minDelayMs = remainingGuardCooldownMs;
      }
      runtime.scheduleReconnect(guildId, reconnectOptions);
      return;
    }

    syncObservedRuntimeChannel(runtime, state, actualChannelId);
    if (!state.currentProcess && state.player.state.status === AudioPlayerStatus.Idle && !state.reconnectTimer) {
      runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: "voice-channel-mismatch" });
      return;
    }
  } else {
    clearTransientVoiceIssue(state, "voice-channel-mismatch");
    if (expectedChannelId && actualChannelId === expectedChannelId) {
      clearRuntimeVoiceGuardWindow(state);
      if (isRuntimeVoiceGuardCooldownActive(state)) {
        state.voiceGuardCooldownUntil = 0;
      }
    }
  }

  if (
    actualChannelId
    && !state.connection
    && state.currentStationKey
    && state.lastChannelId
    && actualChannelId === state.lastChannelId
  ) {
    const issue = confirmTransientVoiceIssue(
      runtime,
      guildId,
      state,
      "voice-local-connection-missing",
      `${actualChannelId}:${reason}:${getRuntimePlayerStatus(state)}:${state.currentProcess ? 1 : 0}`,
      {
        threshold: VOICE_STATE_MISSING_CONFIRMATIONS,
        recheckReason: `voice-local-connection-confirm-${reason}`,
        logMessage: `Lokaler Voice-Handle fehlt trotz Discord-Voice-State (channel=${actualChannelId}, reason=${reason})`,
      }
    );
    if (!issue.confirmed) {
      return;
    }

    if (state.currentProcess || state.player.state.status !== AudioPlayerStatus.Idle) {
      if (issue.count === issue.threshold || shouldLogRecurringTransientIssue(issue)) {
        logRuntimeRecoveryState(
          runtime,
          "WARN",
          "Stale local voice state bestaetigt - Discord sieht den Bot noch im Channel, lokaler Handle fehlt",
          guildId,
          state,
          {
            expectedChannelId,
            actualChannelId,
            reason,
            issue: "voice-local-connection-missing",
          }
        );
      }
      runtime.queueVoiceStateReconcile(guildId, `voice-local-stale-${reason}`, Math.max(8_000, VOICE_TRANSIENT_RECHECK_MS));
      return;
    }

    clearTransientVoiceIssue(state, "voice-local-connection-missing");
    logRuntimeRecoveryState(
      runtime,
      "WARN",
      "Lokaler Voice-Handle fehlt und Wiedergabe ist nicht aktiv - Reconnect wird erzwungen",
      guildId,
      state,
      {
        expectedChannelId,
        actualChannelId,
        reason,
        issue: "voice-local-connection-missing",
      }
    );
    runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: `voice-local-stale-${reason}` });
    return;
  }
  clearTransientVoiceIssue(state, "voice-local-connection-missing");

  if (!state.connection && state.currentStationKey && state.lastChannelId) {
    if (voiceOperationInFlight) return;
    logRuntimeRecoveryState(
      runtime,
      "WARN",
      "Lokale Voice-Verbindung fehlt - Reconnect wird geplant",
      guildId,
      state,
      {
        expectedChannelId,
        actualChannelId,
        reason: `voice-no-local-connection-${reason}`,
      }
    );
    runtime.scheduleReconnect(guildId, { resetAttempts: true, reason: `voice-no-local-connection-${reason}` });
    return;
  }

  if (
    state.currentStationKey
    && state.player.state.status === AudioPlayerStatus.Idle
    && !state.streamRestartTimer
    && !state.streamRestartInFlight
    && !state.reconnectTimer
  ) {
    runtime.scheduleStreamRestart(guildId, state, 750, `voice-health-${reason}`);
  }
  if (state.currentStationKey) {
    runtime.syncVoiceChannelStatus(guildId, state.currentStationName || state.currentStationKey).catch(() => null);
  }
}

async function tickRuntimeVoiceStateHealth(runtime) {
  if (!VOICE_STATE_RECONCILE_ENABLED) return;
  if (!runtime.client.isReady()) return;

  for (const guildId of runtime.guildState.keys()) {
    // eslint-disable-next-line no-await-in-loop
    await runtime.reconcileGuildVoiceState(guildId, { reason: "timer" });
  }
}

function startRuntimeVoiceStateReconciler(runtime) {
  if (!VOICE_STATE_RECONCILE_ENABLED) return;
  if (runtime.voiceHealthTimer) return;

  const run = () => {
    runtime.tickVoiceStateHealth().catch((err) => {
      logError(`[${runtime.config.name}] Voice-State-Reconcile Fehler`, err, {
        context: {
          bot: runtime?.config?.name || null,
          botId: runtime?.config?.id || null,
          source: "voice-health-timer",
        },
      });
    });
  };

  run();
  runtime.voiceHealthTimer = setInterval(run, VOICE_STATE_RECONCILE_MS);
}

function stopRuntimeVoiceStateReconciler(runtime) {
  if (runtime.voiceHealthTimer) {
    clearInterval(runtime.voiceHealthTimer);
    runtime.voiceHealthTimer = null;
  }
  for (const guildId of runtime.pendingVoiceReconcileTimers.keys()) {
    runtime.clearQueuedVoiceReconcile(guildId);
  }
}

export {
  VOICE_STATE_RECONCILE_ENABLED,
  VOICE_STATE_RECONCILE_MS,
  VOICE_STATE_MISSING_CONFIRMATIONS,
  syncObservedRuntimeChannel,
  clearQueuedRuntimeVoiceReconcile,
  queueRuntimeVoiceStateReconcile,
  confirmRuntimeBotVoiceChannel,
  fetchRuntimeBotVoiceState,
  reconcileRuntimeGuildVoiceState,
  tickRuntimeVoiceStateHealth,
  startRuntimeVoiceStateReconciler,
  stopRuntimeVoiceStateReconciler,
};
