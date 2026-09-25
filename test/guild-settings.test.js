import test from "node:test";
import assert from "node:assert/strict";

import { normalizeGuildSettings } from "../src/lib/guild-settings.js";

test("normalizeGuildSettings repairs malformed nested guild settings", () => {
  const normalized = normalizeGuildSettings({
    guildId: "123456789012345678",
    weeklyDigest: {
      enabled: "yes",
      channelId: "  223456789012345678  ",
      dayOfWeek: "9",
      hour: "-1",
      language: "fr",
    },
    weeklyDigestLastSent: "not-a-date",
    failoverChain: ["Rock", "rock", "  ", "Jazz"],
    fallbackStation: "POP",
    incidentAlerts: {
      enabled: true,
      channelId: "invalid",
      events: ["stream_failover_exhausted", "stream_recovered", "stream_failover_exhausted"],
    },
    exportsWebhook: {
      enabled: true,
      url: " https://example.com/hook ",
      secret: "x".repeat(200),
      events: ["stats_exported", "stream_recovered", "stream_failover_activated"],
    },
    voiceGuard: {
      policy: "INVALID",
    },
  });

  assert.equal(normalized.guildId, "123456789012345678");
  assert.deepEqual(normalized.weeklyDigest, {
    enabled: false,
    channelId: "223456789012345678",
    dayOfWeek: 6,
    hour: 0,
    language: "de",
    audience: "team",
  });
  assert.equal(Object.prototype.hasOwnProperty.call(normalized, "weeklyDigestLastSent"), false);
  assert.deepEqual(normalized.failoverChain, ["rock", "jazz"]);
  assert.equal(normalized.fallbackStation, "rock");
  assert.deepEqual(normalized.incidentAlerts, {
    enabled: true,
    channelId: "",
    events: ["stream_failover_exhausted"],
  });
  assert.equal(normalized.exportsWebhook.secret.length, 120);
  assert.deepEqual(normalized.exportsWebhook.events, ["stats_exported", "stream_recovered", "stream_failover_activated"]);
  assert.deepEqual(normalized.voiceGuard, {
    policy: "default",
  });
});
