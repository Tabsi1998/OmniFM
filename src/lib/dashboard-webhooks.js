import { validateCustomStationUrlWithDns } from "../custom-stations.js";
import { fetchWithValidatedRedirects } from "./safe-fetch.js";

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

function isLoopbackWebhookUrl(parsedUrl) {
  const hostname = String(parsedUrl?.hostname || "").trim().toLowerCase();
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

async function validateDashboardExportsWebhookConfig(rawConfig) {
  const config = normalizeDashboardExportsWebhookConfig(rawConfig);
  if (!config.url) {
    return { ok: true, config };
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(config.url);
  } catch {
    return { ok: false, error: "Webhook-URL ist ungueltig." };
  }

  if (parsedUrl.username || parsedUrl.password) {
    return { ok: false, error: "Webhook-URLs mit Benutzername oder Passwort sind nicht erlaubt." };
  }

  const allowLocalHttp = process.env.OMNIFM_ALLOW_LOCAL_WEBHOOKS === "1" && isLoopbackWebhookUrl(parsedUrl);
  if (allowLocalHttp) {
    if (!/^https?:$/i.test(parsedUrl.protocol)) {
      return { ok: false, error: "Lokale Test-Webhooks muessen mit http:// oder https:// beginnen." };
    }
    return { ok: true, config: { ...config, url: parsedUrl.toString() } };
  }

  if (String(parsedUrl.protocol || "").toLowerCase() !== "https:") {
    return { ok: false, error: "Webhook-URLs muessen HTTPS verwenden." };
  }

  const validation = await validateCustomStationUrlWithDns(parsedUrl.toString());
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
    const { response } = await fetchWithValidatedRedirects(config.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-omnifm-event": String(eventKey || "").trim().toLowerCase(),
        ...(config.secret ? { "x-omnifm-webhook-secret": config.secret } : {}),
      },
      body: JSON.stringify(payload),
      signal: controller.signal,
    }, {
      validateUrl: async (url) => validateDashboardExportsWebhookConfig({ ...config, url }),
    });

    let responseText = "";
    try {
      responseText = String(await response.text()).slice(0, 300);
    } catch {
      responseText = "";
    }

    if (!response.ok) {
      return {
        attempted: true,
        delivered: false,
        status: response.status,
        error: responseText || `Webhook antwortete mit Status ${response.status}.`,
      };
    }

    return {
      attempted: true,
      delivered: true,
      status: response.status,
      responseText,
    };
  } catch (err) {
    return {
      attempted: true,
      delivered: false,
      error: err?.name === "AbortError"
        ? "Webhook-Zeitlimit ueberschritten."
        : (err?.message || String(err)),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export {
  DASHBOARD_EXPORT_WEBHOOK_EVENT_KEYS,
  DEFAULT_DASHBOARD_EXPORTS_WEBHOOK_CONFIG,
  normalizeDashboardExportsWebhookConfig,
  validateDashboardExportsWebhookConfig,
  shouldDeliverDashboardWebhook,
  buildDashboardWebhookPayload,
  deliverDashboardWebhook,
};
