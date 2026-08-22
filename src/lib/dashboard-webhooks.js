import { SafeOutboundError, safeFetch, validateOutboundUrlWithDns } from "./safe-outbound-http.js";

const DASHBOARD_EXPORT_WEBHOOK_EVENT_KEYS = Object.freeze([
  "stats_exported",
  "custom_stations_exported",
  "stream_healthcheck_stalled",
  "stream_recovered",
  "stream_failover_activated",
  "stream_failover_exhausted",
]);

const DEFAULT_DASHBOARD_EXPORTS_WEBHOOK_CONFIG = Object.freeze({
  enabled: false,
  url: "",
  secret: "",
  events: [],
});

let dashboardWebhookFetchForTests = null;

function isNodeTestRun() {
  return String(process.env.NODE_TEST_CONTEXT || "").toLowerCase() === "child"
    || process.argv.some((arg) => /\.test\.[cm]?js$/i.test(String(arg || "")));
}

function normalizeWebhookEventList(rawEvents) {
  const values = Array.isArray(rawEvents)
    ? rawEvents
    : typeof rawEvents === "string"
      ? rawEvents.split(/[,\n]/g)
      : [];

  const events = [];
  const seen = new Set();
  for (const rawValue of values) {
    const value = String(rawValue || "").trim().toLowerCase();
    if (!DASHBOARD_EXPORT_WEBHOOK_EVENT_KEYS.includes(value)) continue;
    if (seen.has(value)) continue;
    seen.add(value);
    events.push(value);
  }
  return events;
}

function normalizeDashboardExportsWebhookConfig(rawConfig) {
  const input = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  return {
    enabled: input.enabled === true,
    url: String(input.url || "").trim(),
    secret: String(input.secret || "").trim().slice(0, 120),
    events: normalizeWebhookEventList(input.events),
  };
}

function toPublicDashboardExportsWebhookConfig(rawConfig) {
  const config = normalizeDashboardExportsWebhookConfig(rawConfig);
  return {
    enabled: config.enabled,
    url: config.url,
    events: config.events,
    secretConfigured: Boolean(config.secret),
  };
}

function mergeDashboardExportsWebhookConfigWithStoredSecret(rawConfig, storedConfig) {
  const input = rawConfig && typeof rawConfig === "object" ? rawConfig : {};
  if (Object.prototype.hasOwnProperty.call(input, "secret")) {
    return input;
  }

  return {
    ...input,
    secret: normalizeDashboardExportsWebhookConfig(storedConfig).secret,
  };
}

async function validateDashboardExportsWebhookConfig(rawConfig, options = {}) {
  const config = normalizeDashboardExportsWebhookConfig(rawConfig);
  if (!config.url) {
    return { ok: true, config };
  }

  const validation = await validateOutboundUrlWithDns(config.url, {
    ...options,
    allowedProtocols: ["https:"],
    requireHttps: true,
  });
  if (!validation.ok) {
    return { ok: false, error: validation.error };
  }

  return { ok: true, config: { ...config, url: validation.url } };
}

function shouldDeliverDashboardWebhook(config, eventKey) {
  const normalizedConfig = normalizeDashboardExportsWebhookConfig(config);
  const normalizedEventKey = String(eventKey || "").trim().toLowerCase();
  return Boolean(
    normalizedConfig.enabled
    && normalizedConfig.url
    && normalizedConfig.events.includes(normalizedEventKey)
  );
}

function sanitizeDashboardWebhookPayload(eventKey, payload) {
  const normalizedEventKey = String(eventKey || "").trim().toLowerCase();
  const input = payload && typeof payload === "object" ? payload : {};

  if (![
    "stream_healthcheck_stalled",
    "stream_recovered",
    "stream_failover_activated",
    "stream_failover_exhausted",
  ].includes(normalizedEventKey)) {
    return input;
  }

  const sanitized = {
    previousStationKey: String(input.previousStationKey || "").trim(),
    previousStationName: String(input.previousStationName || "").trim(),
    recoveredStationKey: String(input.recoveredStationKey || "").trim(),
    recoveredStationName: String(input.recoveredStationName || "").trim(),
    failoverStationKey: String(input.failoverStationKey || "").trim(),
    failoverStationName: String(input.failoverStationName || "").trim(),
    silenceMs: Math.max(0, Number(input.silenceMs || 0) || 0),
    listenerCount: Math.max(0, Number(input.listenerCount || 0) || 0),
  };

  if (input.runtime && typeof input.runtime === "object") {
    sanitized.runtime = {
      id: String(input.runtime.id || "").trim(),
      name: String(input.runtime.name || "").trim(),
      role: String(input.runtime.role || "").trim(),
    };
  }

  return sanitized;
}

function buildDashboardWebhookPayload(eventKey, meta = {}) {
  return {
    event: String(eventKey || "").trim().toLowerCase(),
    source: String(meta.source || "dashboard").trim().toLowerCase() || "dashboard",
    sentAt: new Date().toISOString(),
    server: meta.server ? {
      id: String(meta.server.id || "").trim(),
      name: String(meta.server.name || "").trim(),
      tier: String(meta.server.tier || "").trim(),
    } : null,
    actor: meta.actor ? {
      id: String(meta.actor.id || "").trim(),
      username: String(meta.actor.username || meta.actor.globalName || "").trim(),
    } : null,
    payload: sanitizeDashboardWebhookPayload(eventKey, meta.payload),
  };
}

async function deliverDashboardWebhook(rawConfig, eventKey, payload) {
  const validated = await validateDashboardExportsWebhookConfig(rawConfig);
  if (!validated.ok) {
    return {
      attempted: false,
      delivered: false,
      error: validated.error,
    };
  }

  const config = validated.config;
  if (!config.url) {
    return {
      attempted: false,
      delivered: false,
      error: "Webhook-URL fehlt.",
    };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const fetchImpl = dashboardWebhookFetchForTests || safeFetch;
    const response = await fetchImpl(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-omnifm-event": String(eventKey || "").trim().toLowerCase(),
        ...(config.secret ? { "x-omnifm-webhook-secret": config.secret } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
      timeoutMs: 5000,
      redirect: "error",
    });

    try {
      await response.body?.cancel?.();
    } catch {
      // ignore
    }

    if (!response.ok) {
      return {
        attempted: true,
        delivered: false,
        status: response.status,
        error: `Webhook antwortete mit Status ${response.status}.`,
      };
    }

    return {
      attempted: true,
      delivered: true,
      status: response.status,
    };
  } catch (err) {
    return {
      attempted: true,
      delivered: false,
      error: err?.name === "AbortError"
        ? "Webhook-Zeitlimit ueberschritten."
        : (err instanceof SafeOutboundError
          ? err.message
          : "Webhook konnte nicht zugestellt werden."),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function setDashboardWebhookFetchForTests(fetchImpl = null) {
  if (!isNodeTestRun()) {
    throw new Error("Dashboard webhook test transport is only available during node:test runs.");
  }
  if (fetchImpl !== null && typeof fetchImpl !== "function") {
    throw new TypeError("Webhook test transport must be a function or null.");
  }
  dashboardWebhookFetchForTests = fetchImpl;
}

export {
  DASHBOARD_EXPORT_WEBHOOK_EVENT_KEYS,
  DEFAULT_DASHBOARD_EXPORTS_WEBHOOK_CONFIG,
  normalizeDashboardExportsWebhookConfig,
  toPublicDashboardExportsWebhookConfig,
  mergeDashboardExportsWebhookConfigWithStoredSecret,
  validateDashboardExportsWebhookConfig,
  shouldDeliverDashboardWebhook,
  buildDashboardWebhookPayload,
  deliverDashboardWebhook,
  setDashboardWebhookFetchForTests,
};
