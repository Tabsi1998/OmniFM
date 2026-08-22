// ============================================================
// OmniFM: Network Recovery Coordinator
// ============================================================
import { log } from "../lib/logging.js";
import {
  NETWORK_COOLDOWN_BASE_MS,
  NETWORK_COOLDOWN_MAX_MS,
  NETWORK_FAILURE_RESET_MS,
  applyJitter,
} from "../lib/helpers.js";

function normalizeOptions(options = {}) {
  if (typeof options === "string") {
    return { scope: options };
  }
  if (!options || typeof options !== "object") {
    return {};
  }
  return options;
}

function normalizeScope(rawScope) {
  return String(rawScope || "global").trim() || "global";
}

class NetworkRecoveryCoordinator {
  constructor({ now = () => Date.now(), jitter = applyJitter } = {}) {
    this.scopes = new Map();
    this.listeners = new Set();
    this.now = typeof now === "function" ? now : () => Date.now();
    this.jitter = typeof jitter === "function" ? jitter : applyJitter;
  }

  getNowMs() {
    const now = Number(this.now());
    return Number.isFinite(now) ? now : Date.now();
  }

  getCooldownMs(failureCount) {
    const backoff = NETWORK_COOLDOWN_BASE_MS * Math.pow(1.6, Math.min(Math.max(0, failureCount - 1), 10));
    const jittered = Number(this.jitter(backoff, 0.25));
    return Math.min(
      NETWORK_COOLDOWN_MAX_MS,
      Math.max(0, Number.isFinite(jittered) ? jittered : backoff)
    );
  }

  getScopeState(scope = "global", { createIfMissing = true } = {}) {
    const key = normalizeScope(scope);
    if (!this.scopes.has(key)) {
      if (!createIfMissing) return null;
      this.scopes.set(key, {
        failureCount: 0,
        lastFailureAt: 0,
        lastSuccessAt: this.getNowMs(),
        cooldownUntil: 0,
      });
    }
    return this.scopes.get(key);
  }

  noteFailure(source, detail = "", options = {}) {
    const { scope } = normalizeOptions(options);
    const scopeKey = normalizeScope(scope);
    const scopeState = this.getScopeState(scopeKey);
    const now = this.getNowMs();
    const lastRecoveryActivityAt = Math.max(
      Number(scopeState.lastFailureAt || 0) || 0,
      Number(scopeState.cooldownUntil || 0) || 0
    );
    if (lastRecoveryActivityAt > 0 && (now - lastRecoveryActivityAt) > NETWORK_FAILURE_RESET_MS) {
      scopeState.failureCount = 0;
    }
    scopeState.failureCount += 1;
    scopeState.lastFailureAt = now;
    scopeState.cooldownUntil = now + this.getCooldownMs(scopeState.failureCount);
    if (scopeState.failureCount <= 3) {
      log(
        "INFO",
        `[NetworkRecovery] failure noted from ${source} (scope=${scopeKey}, count=${scopeState.failureCount})${detail ? `: ${detail}` : ""}`
      );
    }
  }

  noteSuccess(source, options = {}) {
    const { scope } = normalizeOptions(options);
    const scopeKey = normalizeScope(scope);
    const scopeState = this.getScopeState(scopeKey, { createIfMissing: false });
    if (!scopeState) return;
    const now = this.getNowMs();
    const hadFailures = scopeState.failureCount > 0;
    scopeState.failureCount = 0;
    scopeState.lastSuccessAt = now;
    scopeState.cooldownUntil = 0;
    if (hadFailures) {
      const event = {
        scope: scopeKey,
        source,
        recoveredAt: now,
      };
      log("INFO", `[NetworkRecovery] success noted from ${source} (scope=${scopeKey}) - triggering recovery.`);
      for (const listener of this.listeners) {
        try {
          listener(event);
        } catch {
          // ignore
        }
      }
    }
  }

  onRecovered(fn) {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  }

  getRecoveryDelayMs(options = {}) {
    const { scope } = normalizeOptions(options);
    const scopeKey = normalizeScope(scope);
    const scopeState = this.getScopeState(scopeKey, { createIfMissing: false });
    if (!scopeState) return 0;
    if (scopeState.failureCount <= 0) return 0;
    return Math.max(0, (Number(scopeState.cooldownUntil || 0) || 0) - this.getNowMs());
  }

  getRecoveryState(options = {}) {
    const { scope } = normalizeOptions(options);
    const scopeKey = normalizeScope(scope);
    const scopeState = this.getScopeState(scopeKey, { createIfMissing: false });
    if (!scopeState) return null;

    const cooldownUntil = Number(scopeState.cooldownUntil || 0) || 0;
    return {
      scope: scopeKey,
      failureCount: Number(scopeState.failureCount || 0) || 0,
      lastFailureAt: Number(scopeState.lastFailureAt || 0) || 0,
      lastSuccessAt: Number(scopeState.lastSuccessAt || 0) || 0,
      cooldownUntil,
      cooldownRemainingMs: Math.max(0, cooldownUntil - this.getNowMs()),
    };
  }

  isNetworkHealthy(options = {}) {
    return this.getRecoveryDelayMs(options) <= 0;
  }

  reset(options = {}) {
    const normalized = normalizeOptions(options);
    const hasScope = Object.prototype.hasOwnProperty.call(normalized, "scope");
    if (!hasScope) {
      this.scopes.clear();
      return;
    }

    const scopeKey = normalizeScope(normalized.scope);
    this.scopes.delete(scopeKey);
  }
}

const networkRecoveryCoordinator = new NetworkRecoveryCoordinator();

export { NetworkRecoveryCoordinator, networkRecoveryCoordinator };
