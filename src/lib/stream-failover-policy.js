const DEFAULT_FAILOVER_MIN_FAILURES = 3;
const DEFAULT_FAILOVER_MIN_UNSTABLE_MS = 60_000;

function toBoundedInt(value, fallback, min, max) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

const STREAM_FAILOVER_MIN_FAILURES = toBoundedInt(
  process.env.STREAM_FAILOVER_MIN_FAILURES,
  DEFAULT_FAILOVER_MIN_FAILURES,
  2,
  100
);
const STREAM_FAILOVER_MIN_UNSTABLE_MS = toBoundedInt(
  process.env.STREAM_FAILOVER_MIN_UNSTABLE_MS,
  DEFAULT_FAILOVER_MIN_UNSTABLE_MS,
  10_000,
  30 * 60_000
);

function normalizeStationKey(value) {
  return String(value || "").trim().toLowerCase();
}

function clearFailoverFailureWindow(state) {
  if (!state || typeof state !== "object") return;
  state.failoverFailureStationKey = null;
  state.failoverFailureCount = 0;
  state.failoverFailureStartedAt = 0;
  state.failoverLastFailureAt = 0;
}

function recordFailoverFailure(state, stationKey, { nowMs = Date.now() } = {}) {
  if (!state || typeof state !== "object") {
    return { stationKey: normalizeStationKey(stationKey), failureCount: 0, unstableForMs: 0 };
  }

  const key = normalizeStationKey(stationKey);
  const currentKey = normalizeStationKey(state.failoverFailureStationKey);
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  if (!key || currentKey !== key || !(Number(state.failoverFailureStartedAt) > 0)) {
    state.failoverFailureStationKey = key || null;
    state.failoverFailureCount = 1;
    state.failoverFailureStartedAt = now;
  } else {
    state.failoverFailureCount = Math.min(10_000, Math.max(0, Number(state.failoverFailureCount) || 0) + 1);
  }
  state.failoverLastFailureAt = now;

  return {
    stationKey: key,
    failureCount: state.failoverFailureCount,
    unstableForMs: Math.max(0, now - (Number(state.failoverFailureStartedAt) || now)),
  };
}

function evaluateFailoverEligibility(state, {
  stationKey = "",
  candidateCount = 0,
  nowMs = Date.now(),
  minFailures = STREAM_FAILOVER_MIN_FAILURES,
  minUnstableMs = STREAM_FAILOVER_MIN_UNSTABLE_MS,
} = {}) {
  const expectedKey = normalizeStationKey(stationKey);
  const failureKey = normalizeStationKey(state?.failoverFailureStationKey);
  const count = Math.max(0, Number(state?.failoverFailureCount) || 0);
  const startedAt = Math.max(0, Number(state?.failoverFailureStartedAt) || 0);
  const now = Number.isFinite(Number(nowMs)) ? Number(nowMs) : Date.now();
  const unstableForMs = startedAt > 0 ? Math.max(0, now - startedAt) : 0;
  const requiredFailures = toBoundedInt(minFailures, STREAM_FAILOVER_MIN_FAILURES, 2, 100);
  const requiredUnstableMs = toBoundedInt(minUnstableMs, STREAM_FAILOVER_MIN_UNSTABLE_MS, 0, 30 * 60_000);

  let reason = "eligible";
  if (!(Number(candidateCount) > 0)) reason = "no-explicit-candidates";
  else if (!expectedKey || failureKey !== expectedKey) reason = "station-mismatch";
  else if (count < requiredFailures) reason = "failure-threshold";
  else if (unstableForMs < requiredUnstableMs) reason = "stability-window";

  return {
    eligible: reason === "eligible",
    reason,
    failureCount: count,
    requiredFailures,
    unstableForMs,
    requiredUnstableMs,
  };
}

function clearActiveFailover(state) {
  if (!state || typeof state !== "object") return;
  state.failoverActive = false;
  state.failoverStartedAt = 0;
  state.failoverReason = null;
  state.failoverFromStationKey = null;
  state.failoverFromStationName = null;
}

export {
  DEFAULT_FAILOVER_MIN_FAILURES,
  DEFAULT_FAILOVER_MIN_UNSTABLE_MS,
  STREAM_FAILOVER_MIN_FAILURES,
  STREAM_FAILOVER_MIN_UNSTABLE_MS,
  clearActiveFailover,
  clearFailoverFailureWindow,
  evaluateFailoverEligibility,
  recordFailoverFailure,
};
