import test from "node:test";
import assert from "node:assert/strict";

import { buildUserFacingRuntimeStatus } from "../src/lib/user-facing-status.js";

test("user-facing runtime status prefers friendly reconnect wording", () => {
  const status = buildUserFacingRuntimeStatus({
    ready: true,
    connected: false,
    shouldReconnect: true,
    reconnectPending: true,
    stationName: "Nightwave FM",
    channelLabel: "#radio-live",
  }, {
    t: (_de, en) => en,
  });

  assert.equal(status.label, "Connecting");
  assert.match(status.summary, /restoring playback/i);
  assert.match(status.playback, /Nightwave FM/i);
  assert.match(status.playback, /radio-live/i);
});

test("user-facing runtime status hides technical recovery counters during live playback", () => {
  const status = buildUserFacingRuntimeStatus({
    ready: true,
    connected: true,
    reconnectAttempts: 3,
    streamErrorCount: 2,
    stationName: "Nightwave FM",
    channelLabel: "#radio-live",
    listeners: 6,
  }, {
    t: (_de, en) => en,
  });

  assert.equal(status.label, "Stabilizing");
  assert.match(status.summary, /still being stabilized/i);
  assert.match(status.playback, /6 listeners/i);
  assert.doesNotMatch(status.summary, /error|reconnect|counter/i);
});

test("user-facing runtime status explains a parked target in plain words", () => {
  const t = (de) => de;
  const permissions = buildUserFacingRuntimeStatus({
    ready: true,
    connected: false,
    shouldReconnect: true,
    reconnectPending: true,
    parkedReason: "permissions",
    stationName: "Groove Salad",
    channelLabel: "#radio",
  }, { t });
  assert.equal(permissions.code, "parked");
  assert.match(permissions.summary, /Verbinden oder Sprechen/);
  assert.match(permissions.nextStep, /kehrt der Bot von selbst zurueck/);
  assert.match(permissions.playback, /Groove Salad/);

  const circuit = buildUserFacingRuntimeStatus({
    ready: true,
    connected: false,
    shouldReconnect: true,
    parkedReason: "circuit",
  }, { t });
  assert.equal(circuit.code, "parked");
  assert.match(circuit.summary, /alle paar Minuten/);

  const backOnline = buildUserFacingRuntimeStatus({
    ready: true,
    connected: true,
    parkedReason: "circuit",
  }, { t });
  assert.equal(backOnline.code, "live", "a connected bot is live even if a stale parked flag is still set");
});
