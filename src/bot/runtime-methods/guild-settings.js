// OmniFM: cached server settings, voice guard and network recovery per server.
// BotRuntime methods, split out of src/bot/runtime.js (#295); mixed into
// BotRuntime.prototype there, so `this` is the runtime as before.
import { networkRecoveryCoordinator } from "../../core/network-recovery.js";
import { serverHasCapability } from "../../core/entitlements.js";
import { loadGuildSettings } from "../../lib/guild-settings.js";
import {
  buildResolvedVoiceGuardConfig,
  formatVoiceGuardDurationMs,
} from "../../lib/voice-guard.js";

const guildSettingsMethods = {
  getNetworkRecoveryScope(guildId = null) {
    const runtimeKey = String(this.config.id || this.config.clientId || this.config.name || "runtime").trim() || "runtime";
    const normalizedGuildId = String(guildId || "").trim();
    return normalizedGuildId
      ? `${runtimeKey}:guild:${normalizedGuildId}`
      : `${runtimeKey}:global`;
  },

  getCachedGuildSettings(guildId) {
    const key = String(guildId || "").trim();
    if (!key) return {};
    const cached = this.guildSettingsCache.get(key);
    return cached?.value && typeof cached.value === "object" ? cached.value : {};
  },

  async loadGuildSettingsCached(guildId, { force = false, maxAgeMs = 30_000 } = {}) {
    const key = String(guildId || "").trim();
    if (!key) return {};
    const cached = this.guildSettingsCache.get(key);
    if (!force && cached && (Date.now() - cached.loadedAt) <= Math.max(0, Number(maxAgeMs || 0) || 0)) {
      return cached.value;
    }
    const value = await loadGuildSettings(key);
    this.guildSettingsCache.set(key, {
      loadedAt: Date.now(),
      value: value && typeof value === "object" ? value : {},
    });
    return this.guildSettingsCache.get(key)?.value || {};
  },

  invalidateGuildSettingsCache(guildId) {
    const key = String(guildId || "").trim();
    if (!key) return;
    this.guildSettingsCache.delete(key);
  },

  async refreshVoiceGuardSettings(guildId, { force = false } = {}) {
    const state = this.getState(guildId);
    const settings = await this.loadGuildSettingsCached(guildId, { force });
    const featureEnabled = serverHasCapability(guildId, "voice_guard");
    const resolved = buildResolvedVoiceGuardConfig(settings?.voiceGuard || {}, { featureEnabled });
    state.voiceGuardAvailable = resolved.available === true;
    state.voiceGuardPolicy = resolved.policy;
    state.voiceGuardEffectivePolicy = resolved.effectivePolicy;
    state.voiceGuardMoveConfirmations = resolved.defaults.moveConfirmations;
    state.voiceGuardReturnCooldownMs = resolved.defaults.returnCooldownMs;
    state.voiceGuardMoveWindowMs = resolved.defaults.moveWindowMs;
    state.voiceGuardMaxMovesPerWindow = resolved.defaults.maxMovesPerWindow;
    state.voiceGuardEscalation = resolved.defaults.escalation;
    state.voiceGuardEscalationCooldownMs = resolved.defaults.escalationCooldownMs;
    if (resolved.available !== true) {
      state.voiceGuardUnlockUntil = 0;
      state.voiceGuardCooldownUntil = 0;
    }
    return resolved;
  },

  async refreshVoiceGuardSettingsForGuild(guildId, { force = false } = {}) {
    const runtimes = new Set([this]);
    if (this.workerManager?.workers?.length) {
      for (const worker of this.workerManager.workers) {
        runtimes.add(worker);
      }
    }
    const results = [];
    for (const runtime of runtimes) {
      if (typeof runtime?.invalidateGuildSettingsCache === "function") {
        runtime.invalidateGuildSettingsCache(guildId);
      }
      if (typeof runtime?.refreshVoiceGuardSettings !== "function") {
        results.push(null);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      results.push(await runtime.refreshVoiceGuardSettings(guildId, { force }).catch(() => null));
    }
    return results;
  },

  getVoiceGuardRuntimeSummary(guildId) {
    const state = this.getState(guildId);
    const now = Date.now();
    const defaultVoiceGuardConfig = buildResolvedVoiceGuardConfig({});
    return {
      available: state.voiceGuardAvailable === true,
      policy: state.voiceGuardPolicy || "default",
      effectivePolicy: state.voiceGuardEffectivePolicy || defaultVoiceGuardConfig.effectivePolicy,
      unlocked: Number(state.voiceGuardUnlockUntil || 0) > now,
      unlockUntil: Number(state.voiceGuardUnlockUntil || 0) > 0 ? Number(state.voiceGuardUnlockUntil || 0) : 0,
      cooldownUntil: Number(state.voiceGuardCooldownUntil || 0) > 0 ? Number(state.voiceGuardCooldownUntil || 0) : 0,
      moveWindowCount: Math.max(0, Number(state.voiceGuardWindowMoveCount || 0) || 0),
      moveCount: Math.max(0, Number(state.voiceGuardMoveCount || 0) || 0),
      returnCount: Math.max(0, Number(state.voiceGuardReturnCount || 0) || 0),
      disconnectCount: Math.max(0, Number(state.voiceGuardDisconnectCount || 0) || 0),
      escalationCount: Math.max(0, Number(state.voiceGuardEscalationCount || 0) || 0),
      lastAction: state.voiceGuardLastAction || null,
      lastActionAt: Number(state.voiceGuardLastActionAt || 0) || 0,
      lastActionReason: state.voiceGuardLastActionReason || null,
      lastExpectedChannelId: state.voiceGuardLastExpectedChannelId || null,
      lastActualChannelId: state.voiceGuardLastActualChannelId || null,
      moveConfirmations: Math.max(1, Number(state.voiceGuardMoveConfirmations || 0) || 1),
      returnCooldownMs: Math.max(0, Number(state.voiceGuardReturnCooldownMs || 0) || 0),
      moveWindowMs: Math.max(0, Number(state.voiceGuardMoveWindowMs || 0) || 0),
      maxMovesPerWindow: Math.max(0, Number(state.voiceGuardMaxMovesPerWindow || 0) || 0),
      escalation: state.voiceGuardEscalation || null,
      escalationCooldownMs: Math.max(0, Number(state.voiceGuardEscalationCooldownMs || 0) || 0),
    };
  },

  setVoiceGuardTemporaryUnlock(guildId, durationMs, reason = "manual-unlock") {
    const state = this.getState(guildId);
    const safeDurationMs = Math.max(60_000, Math.min(24 * 60 * 60_000, Number(durationMs || 0) || 0));
    state.voiceGuardUnlockUntil = Date.now() + safeDurationMs;
    state.voiceGuardLastAction = "manual-unlock";
    state.voiceGuardLastActionAt = Date.now();
    state.voiceGuardLastActionReason = String(reason || "manual-unlock").trim() || "manual-unlock";
    this.persistState({ forceLog: false });
    return {
      unlockUntil: state.voiceGuardUnlockUntil,
      durationMs: safeDurationMs,
      label: formatVoiceGuardDurationMs(safeDurationMs),
    };
  },

  clearVoiceGuardTemporaryUnlock(guildId, reason = "manual-lock") {
    const state = this.getState(guildId);
    state.voiceGuardUnlockUntil = 0;
    state.voiceGuardLastAction = "manual-lock";
    state.voiceGuardLastActionAt = Date.now();
    state.voiceGuardLastActionReason = String(reason || "manual-lock").trim() || "manual-lock";
    this.persistState({ forceLog: false });
    return {
      unlockUntil: 0,
    };
  },

  async clearVoiceGuardTemporaryUnlockForGuild(guildId, reason = "manual-lock") {
    const runtimes = new Set([this]);
    if (this.workerManager?.workers?.length) {
      for (const worker of this.workerManager.workers) {
        runtimes.add(worker);
      }
    }
    const results = [];
    for (const runtime of runtimes) {
      if (typeof runtime?.clearVoiceGuardTemporaryUnlock !== "function") {
        results.push(null);
        continue;
      }
      // eslint-disable-next-line no-await-in-loop
      results.push(await runtime.clearVoiceGuardTemporaryUnlock(guildId, reason).catch(() => null));
    }
    return results;
  },

  noteNetworkRecoveryFailure(guildId, source, detail = "") {
    networkRecoveryCoordinator.noteFailure(source, detail, {
      scope: this.getNetworkRecoveryScope(guildId),
    });
  },

  noteNetworkRecoverySuccess(guildId, source) {
    networkRecoveryCoordinator.noteSuccess(source, {
      scope: this.getNetworkRecoveryScope(guildId),
    });
  },

  getNetworkRecoveryDelayMs(guildId) {
    return networkRecoveryCoordinator.getRecoveryDelayMs({
      scope: this.getNetworkRecoveryScope(guildId),
    });
  },
};

export { guildSettingsMethods };
