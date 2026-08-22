import test from "node:test";
import assert from "node:assert/strict";

import { NetworkRecoveryCoordinator, networkRecoveryCoordinator } from "../src/core/network-recovery.js";
import { handleRuntimeNetworkRecovered, tryRuntimeReconnect } from "../src/bot/runtime-recovery.js";

test("network recovery coordinator isolates failures and recoveries by scope", () => {
  networkRecoveryCoordinator.reset();
  const events = [];
  const unsubscribe = networkRecoveryCoordinator.onRecovered((event) => {
    events.push(event);
  });

  try {
    networkRecoveryCoordinator.noteFailure("voice-a", "timeout", { scope: "guild-a" });
    networkRecoveryCoordinator.noteFailure("voice-b", "timeout", { scope: "guild-b" });

    assert.ok(networkRecoveryCoordinator.getRecoveryDelayMs({ scope: "guild-a" }) > 0);
    assert.ok(networkRecoveryCoordinator.getRecoveryDelayMs({ scope: "guild-b" }) > 0);

    networkRecoveryCoordinator.noteSuccess("voice-a-ok", { scope: "guild-a" });

    assert.equal(networkRecoveryCoordinator.getRecoveryDelayMs({ scope: "guild-a" }), 0);
    assert.ok(networkRecoveryCoordinator.getRecoveryDelayMs({ scope: "guild-b" }) > 0);
    assert.deepEqual(
      events.map((event) => event.scope),
      ["guild-a"]
    );
  } finally {
    unsubscribe();
    networkRecoveryCoordinator.reset();
  }
});

test("network recovery cooldown expires into a probe and a repeated failure escalates", () => {
  let now = 1_000;
  const coordinator = new NetworkRecoveryCoordinator({
    now: () => now,
    jitter: (delayMs) => delayMs,
  });
  const scope = "guild:probe";

  coordinator.noteFailure("voice", "timeout", { scope });
  const firstFailure = coordinator.getRecoveryState({ scope });
  const firstDelayMs = coordinator.getRecoveryDelayMs({ scope });

  assert.equal(firstFailure.failureCount, 1);
  assert.equal(firstFailure.cooldownUntil, now + firstDelayMs);
  assert.ok(firstDelayMs > 0);

  now = firstFailure.cooldownUntil - 1;
  assert.equal(coordinator.getRecoveryDelayMs({ scope }), 1);

  now += 1;
  assert.equal(coordinator.getRecoveryDelayMs({ scope }), 0);
  assert.equal(coordinator.isNetworkHealthy({ scope }), true);

  coordinator.noteFailure("voice", "timeout again", { scope });
  const secondFailure = coordinator.getRecoveryState({ scope });
  const secondDelayMs = coordinator.getRecoveryDelayMs({ scope });

  assert.equal(secondFailure.failureCount, 2);
  assert.ok(secondDelayMs > firstDelayMs);
  assert.equal(secondFailure.cooldownUntil, now + secondDelayMs);
});

test("network recovery success resets only its own scoped cooldown", () => {
  let now = 5_000;
  const coordinator = new NetworkRecoveryCoordinator({
    now: () => now,
    jitter: (delayMs) => delayMs,
  });
  const events = [];
  const unsubscribe = coordinator.onRecovered((event) => events.push(event));

  try {
    coordinator.noteFailure("voice-a", "timeout", { scope: "guild-a" });
    coordinator.noteFailure("voice-b", "timeout", { scope: "guild-b" });

    const beforeSuccess = coordinator.getRecoveryState({ scope: "guild-a" });
    assert.ok(beforeSuccess.cooldownUntil > now);
    assert.ok(coordinator.getRecoveryDelayMs({ scope: "guild-b" }) > 0);

    now += 25;
    coordinator.noteSuccess("voice-a-ready", { scope: "guild-a" });

    assert.deepEqual(coordinator.getRecoveryState({ scope: "guild-a" }), {
      scope: "guild-a",
      failureCount: 0,
      lastFailureAt: beforeSuccess.lastFailureAt,
      lastSuccessAt: now,
      cooldownUntil: 0,
      cooldownRemainingMs: 0,
    });
    assert.ok(coordinator.getRecoveryDelayMs({ scope: "guild-b" }) > 0);
    assert.deepEqual(events.map((event) => event.scope), ["guild-a"]);

    coordinator.noteFailure("voice-a", "new timeout", { scope: "guild-a" });
    assert.equal(coordinator.getRecoveryState({ scope: "guild-a" }).failureCount, 1);
  } finally {
    unsubscribe();
  }
});

test("voice reconnect probes after an expired network cooldown instead of deferring forever", async () => {
  let now = 10_000;
  const coordinator = new NetworkRecoveryCoordinator({
    now: () => now,
    jitter: (delayMs) => delayMs,
  });
  const scope = "runtime:guild:1";
  coordinator.noteFailure("voice", "timeout", { scope });

  const state = {
    shouldReconnect: true,
    lastChannelId: "channel-1",
    currentStationKey: "station-1",
    reconnectInFlight: false,
    voiceConnectInFlight: false,
    reconnectTimer: null,
    connection: null,
  };
  let guildFetches = 0;
  const runtime = {
    config: { name: "OmniFM Test" },
    getState() {
      return state;
    },
    getNetworkRecoveryDelayMs() {
      return coordinator.getRecoveryDelayMs({ scope });
    },
    isScheduledEventStopDue() {
      return false;
    },
    client: {
      guilds: {
        cache: { get: () => null },
        async fetch() {
          guildFetches += 1;
          throw new Error("temporary network failure");
        },
      },
    },
  };

  const deferred = await tryRuntimeReconnect(runtime, "guild-1");
  assert.equal(deferred.reason, "network-cooldown");
  assert.ok(deferred.minDelayMs > 0);
  assert.equal(guildFetches, 0);

  now = coordinator.getRecoveryState({ scope }).cooldownUntil;
  const probe = await tryRuntimeReconnect(runtime, "guild-1");

  assert.equal(guildFetches, 1);
  assert.equal(probe.attempted, false);
  assert.equal(probe.retryRecommended, true);
  assert.equal(probe.reason, "guild-missing-transient");
});

test("runtime network recovery only schedules reconnects for the matching guild scope", () => {
  const scheduledReconnects = [];
  const runtime = {
    config: { name: "OmniFM Test" },
    guildState: new Map([
      ["guild-1", {
        shouldReconnect: true,
        currentStationKey: "rock",
        lastChannelId: "voice-1",
        connection: null,
        reconnectTimer: null,
        reconnectInFlight: false,
        voiceConnectInFlight: false,
        player: { state: { status: "idle" } },
        streamRestartTimer: null,
      }],
      ["guild-2", {
        shouldReconnect: true,
        currentStationKey: "jazz",
        lastChannelId: "voice-2",
        connection: null,
        reconnectTimer: null,
        reconnectInFlight: false,
        voiceConnectInFlight: false,
        player: { state: { status: "idle" } },
        streamRestartTimer: null,
      }],
    ]),
    getNetworkRecoveryScope(guildId) {
      return `scope:${guildId}`;
    },
    scheduleReconnect(guildId, options = {}) {
      scheduledReconnects.push({ guildId, options });
    },
    scheduleStreamRestart() {
      throw new Error("stream restart should not be scheduled for disconnected guilds");
    },
  };

  handleRuntimeNetworkRecovered(runtime, { scope: "scope:guild-1" });

  assert.deepEqual(scheduledReconnects, [
    {
      guildId: "guild-1",
      options: { resetAttempts: true, reason: "network-recovered" },
    },
  ]);
});
