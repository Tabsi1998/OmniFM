import test from "node:test";
import assert from "node:assert/strict";

import {
  clearActiveFailover,
  clearFailoverFailureWindow,
  evaluateFailoverEligibility,
  recordFailoverFailure,
} from "../src/lib/stream-failover-policy.js";

test("one transient failure never activates failover", () => {
  const state = {};
  recordFailoverFailure(state, "rock", { nowMs: 1_000 });

  const decision = evaluateFailoverEligibility(state, {
    stationKey: "rock",
    candidateCount: 1,
    nowMs: 90_000,
    minFailures: 3,
    minUnstableMs: 60_000,
  });

  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "failure-threshold");
});

test("failure threshold still waits for the minimum unstable duration", () => {
  const state = {};
  recordFailoverFailure(state, "rock", { nowMs: 1_000 });
  recordFailoverFailure(state, "rock", { nowMs: 2_000 });
  recordFailoverFailure(state, "rock", { nowMs: 3_000 });

  const decision = evaluateFailoverEligibility(state, {
    stationKey: "rock",
    candidateCount: 1,
    nowMs: 30_000,
    minFailures: 3,
    minUnstableMs: 60_000,
  });

  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "stability-window");
});

test("explicit failover becomes eligible only after count and time quorum", () => {
  const state = {};
  recordFailoverFailure(state, "rock", { nowMs: 1_000 });
  recordFailoverFailure(state, "rock", { nowMs: 20_000 });
  recordFailoverFailure(state, "rock", { nowMs: 50_000 });

  const decision = evaluateFailoverEligibility(state, {
    stationKey: "rock",
    candidateCount: 1,
    nowMs: 61_000,
    minFailures: 3,
    minUnstableMs: 60_000,
  });

  assert.equal(decision.eligible, true);
  assert.equal(decision.reason, "eligible");
});

test("a station change starts a fresh failure window", () => {
  const state = {};
  recordFailoverFailure(state, "rock", { nowMs: 1_000 });
  recordFailoverFailure(state, "rock", { nowMs: 2_000 });
  recordFailoverFailure(state, "jazz", { nowMs: 3_000 });

  assert.equal(state.failoverFailureStationKey, "jazz");
  assert.equal(state.failoverFailureCount, 1);
  assert.equal(state.failoverFailureStartedAt, 3_000);
});

test("configured timing never invents a fallback candidate", () => {
  const state = {};
  recordFailoverFailure(state, "rock", { nowMs: 1_000 });
  recordFailoverFailure(state, "rock", { nowMs: 2_000 });
  recordFailoverFailure(state, "rock", { nowMs: 3_000 });

  const decision = evaluateFailoverEligibility(state, {
    stationKey: "rock",
    candidateCount: 0,
    nowMs: 90_000,
    minFailures: 3,
    minUnstableMs: 60_000,
  });

  assert.equal(decision.eligible, false);
  assert.equal(decision.reason, "no-explicit-candidates");
});

test("stability clears only failure evidence while active failover is explicit", () => {
  const state = {
    failoverActive: true,
    failoverStartedAt: 12_000,
    failoverReason: "timeout",
    failoverFromStationKey: "rock",
    failoverFailureStationKey: "backup",
    failoverFailureCount: 4,
    failoverFailureStartedAt: 10_000,
    failoverLastFailureAt: 11_000,
  };

  clearFailoverFailureWindow(state);
  assert.equal(state.failoverActive, true);
  assert.equal(state.failoverFailureCount, 0);

  clearActiveFailover(state);
  assert.equal(state.failoverActive, false);
  assert.equal(state.failoverReason, null);
});
