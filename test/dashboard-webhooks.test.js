import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeDashboardExportsWebhookConfig,
  validateDashboardExportsWebhookConfig,
  shouldDeliverDashboardWebhook,
  buildDashboardWebhookPayload,
  deliverDashboardWebhook,
  setDashboardWebhookFetchForTests,
} from "../src/lib/dashboard-webhooks.js";

test("dashboard webhook helpers normalize config and gate delivery", () => {
  const config = normalizeDashboardExportsWebhookConfig({
    enabled: true,
    url: "https://example.com/hook",
    secret: "demo",
    events: ["stats_exported", "stream_failover_exhausted", "stream_recovered", "custom_stations_exported", "stats_exported", "invalid"],
  });

  assert.deepEqual(config, {
    enabled: true,
    url: "https://example.com/hook",
    secret: "demo",
    events: ["stats_exported", "stream_failover_exhausted", "stream_recovered", "custom_stations_exported"],
  });
  assert.equal(shouldDeliverDashboardWebhook(config, "stats_exported"), true);
  assert.equal(shouldDeliverDashboardWebhook(config, "stream_failover_exhausted"), true);
  assert.equal(shouldDeliverDashboardWebhook(config, "stream_healthcheck_stalled"), false);
  assert.equal(shouldDeliverDashboardWebhook(config, "stream_recovered"), true);
  assert.equal(shouldDeliverDashboardWebhook(config, "missing"), false);
});

test("dashboard webhook validation rejects local URLs and accepts a DNS-verified HTTPS target", async () => {
  const loopback = await validateDashboardExportsWebhookConfig({
    enabled: false,
    url: "http://127.0.0.1:9999/hook",
    events: [],
  });
  assert.deepEqual(loopback, {
    ok: false,
    error: "URL muss HTTPS verwenden.",
  });

  const validated = await validateDashboardExportsWebhookConfig(
    {
      enabled: true,
      url: "https://webhook.example/hook",
      events: ["stats_exported"],
    },
    {
      lookupFn: async () => [{ address: "1.1.1.1", family: 4 }],
      retryCount: 1,
    }
  );
  assert.equal(validated.ok, true);
  assert.equal(validated.config.url, "https://webhook.example/hook");
});

test("dashboard webhook delivery never exposes a receiver response body", async (t) => {
  setDashboardWebhookFetchForTests(async () => new Response("internal receiver secret", { status: 500 }));
  t.after(() => setDashboardWebhookFetchForTests(null));

  const result = await deliverDashboardWebhook(
    {
      enabled: true,
      url: "https://1.1.1.1/hook",
      events: ["stats_exported"],
    },
    "stats_exported",
    { example: true }
  );

  assert.equal(result.attempted, true);
  assert.equal(result.delivered, false);
  assert.equal(result.status, 500);
  assert.equal(result.error, "Webhook antwortete mit Status 500.");
  assert.equal(JSON.stringify(result).includes("internal receiver secret"), false);

  setDashboardWebhookFetchForTests(async () => {
    throw new Error("connect ECONNREFUSED 127.0.0.1:2375");
  });
  const failedTransport = await deliverDashboardWebhook(
    {
      enabled: true,
      url: "https://1.1.1.1/hook",
      events: ["stats_exported"],
    },
    "stats_exported",
    { example: true }
  );
  assert.equal(failedTransport.error, "Webhook konnte nicht zugestellt werden.");
  assert.equal(JSON.stringify(failedTransport).includes("127.0.0.1"), false);
});

test("dashboard webhook payloads include source, server, and actor metadata", () => {
  const payload = buildDashboardWebhookPayload("stats_exported", {
    source: "runtime",
    server: { id: "1", name: "Guild", tier: "ultimate" },
    actor: { id: "2", username: "Tester" },
    payload: { exportType: "stats" },
  });

  assert.equal(payload.event, "stats_exported");
  assert.equal(payload.source, "runtime");
  assert.equal(payload.server.id, "1");
  assert.equal(payload.actor.username, "Tester");
  assert.equal(payload.payload.exportType, "stats");
});

test("dashboard webhook payloads sanitize technical runtime fields for customer-facing reliability events", () => {
  const payload = buildDashboardWebhookPayload("stream_failover_exhausted", {
    source: "runtime",
    server: { id: "1", name: "Guild", tier: "ultimate" },
    payload: {
      runtime: { id: "bot-1", name: "OmniFM 1", role: "worker" },
      previousStationName: "Nightwave FM",
      failoverStationName: "Rock FM",
      listenerCount: 4,
      triggerError: "timeout",
      reconnectAttempts: 3,
      streamErrorCount: 7,
      attemptedCandidates: ["rock", "pop"],
    },
  });

  assert.equal(payload.payload.previousStationName, "Nightwave FM");
  assert.equal(payload.payload.failoverStationName, "Rock FM");
  assert.equal(payload.payload.listenerCount, 4);
  assert.equal(payload.payload.runtime.name, "OmniFM 1");
  assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, "triggerError"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, "reconnectAttempts"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, "streamErrorCount"), false);
  assert.equal(Object.prototype.hasOwnProperty.call(payload.payload, "attemptedCandidates"), false);
});
