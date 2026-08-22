import test from "node:test";
import assert from "node:assert/strict";

import {
  DASHBOARD_EXPORT_WEBHOOK_EVENTS,
  normalizeDashboardExportsWebhookConfig,
  buildDashboardExportsWebhookSummary,
  getDashboardExportWebhookEventLabel,
  buildDashboardExportDownloadName,
} from "../frontend/src/lib/dashboardExports.js";

test("dashboard exports helpers normalize config and labels", () => {
  const config = normalizeDashboardExportsWebhookConfig({
    enabled: true,
    url: "https://example.com/webhook",
    secret: "demo",
    events: ["stats_exported", "custom_stations_exported", "stats_exported", "invalid"],
  });

  assert.deepEqual(config, {
    enabled: true,
    url: "https://example.com/webhook",
    secret: "demo",
    secretConfigured: true,
    events: ["stats_exported", "custom_stations_exported"],
  });
  assert.equal(
    getDashboardExportWebhookEventLabel(DASHBOARD_EXPORT_WEBHOOK_EVENTS[0].key, (_de, en) => en),
    "Stats exports"
  );
});

test("dashboard exports config keeps a stored-secret indicator without rehydrating the secret", () => {
  const config = normalizeDashboardExportsWebhookConfig({
    enabled: true,
    url: "https://example.com/webhook",
    secretConfigured: true,
    events: ["stats_exported"],
  });

  assert.equal(config.secretConfigured, true);
  assert.equal(Object.prototype.hasOwnProperty.call(config, "secret"), false);
});

test("dashboard exports helpers expose useful summary states and filenames", () => {
  const inactiveSummary = buildDashboardExportsWebhookSummary({}, (_de, en) => en);
  assert.equal(inactiveSummary.statusLabel, "Not configured");

  const activeSummary = buildDashboardExportsWebhookSummary({
    enabled: true,
    url: "https://example.com/webhook",
    events: ["stats_exported"],
  }, (_de, en) => en);
  assert.equal(activeSummary.statusLabel, "Active");

  const fileName = buildDashboardExportDownloadName("custom-stations", "1234567890", "2026-03-09T08:00:00.000Z");
  assert.equal(fileName, "omnifm-custom-stations-1234567890-202603090800.json");
});
