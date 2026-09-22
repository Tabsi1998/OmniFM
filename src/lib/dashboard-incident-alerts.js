const DASHBOARD_INCIDENT_ALERT_EVENT_KEYS = Object.freeze([
  "stream_healthcheck_stalled",
  "stream_failover_activated",
  "stream_failover_exhausted",
  "stream_failback_completed",
  "station_unavailable",
]);

const DEFAULT_DASHBOARD_INCIDENT_ALERTS_CONFIG = Object.freeze({
  enabled: false,
  channelId: "",
  events: [],
});

function sanitizeSnowflake(value) {
  const text = String(value || "").trim();
  return /^\d{17,22}$/.test(text) ? text : "";
}

function normalizeIncidentAlertEventList(rawEvents) {
  const values = Array.isArray(rawEvents)
    ? rawEvents
    : typeof rawEvents === "string"
      ? rawEvents.split(/[,\n]/g)
      : [];

  const events = [];
  const seen = new Set();
  for (const rawValue of values) {
    const value = String(rawValue || "").trim().toLowerCase();
    if (!DASHBOARD_INCIDENT_ALERT_EVENT_KEYS.includes(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    events.push(value);
  }
  return events;
}

function normalizeDashboardIncidentAlertsConfig(rawConfig) {
  const input = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return {
    enabled: input.enabled === true,
    channelId: sanitizeSnowflake(input.channelId),
    events: normalizeIncidentAlertEventList(input.events),
  };
}

function validateDashboardIncidentAlertsConfig(rawConfig) {
  const config = normalizeDashboardIncidentAlertsConfig(rawConfig);
  const rawChannelId = String(rawConfig?.channelId || "").trim();
  if (rawChannelId && !config.channelId) {
    return { ok: false, error: "Text-Channel ist ungueltig." };
  }
  return { ok: true, config };
}

function shouldDeliverDashboardIncidentAlert(config, eventKey) {
  const normalizedConfig = normalizeDashboardIncidentAlertsConfig(config);
  const normalizedEventKey = String(eventKey || "").trim().toLowerCase();
  return Boolean(
    normalizedConfig.enabled
    && normalizedConfig.channelId
    && normalizedConfig.events.includes(normalizedEventKey)
  );
}

export {
  DASHBOARD_INCIDENT_ALERT_EVENT_KEYS,
  DEFAULT_DASHBOARD_INCIDENT_ALERTS_CONFIG,
  normalizeDashboardIncidentAlertsConfig,
  validateDashboardIncidentAlertsConfig,
  shouldDeliverDashboardIncidentAlert,
};
