export const DASHBOARD_EXPORT_WEBHOOK_EVENTS = Object.freeze([
  { key: 'stats_exported', de: 'Stats-Exporte', en: 'Stats exports' },
  { key: 'custom_stations_exported', de: 'Custom-Station-Exporte', en: 'Custom station exports' },
  { key: 'stream_healthcheck_stalled', de: 'Stream-Healthcheck ausgelöst', en: 'Stream health check triggered' },
  { key: 'stream_recovered', de: 'Stream-Erholung', en: 'Stream recovered' },
  { key: 'stream_failover_activated', de: 'Failover aktiviert', en: 'Failover activated' },
  { key: 'stream_failover_exhausted', de: 'Failover ausgeschöpft', en: 'Failover exhausted' },
]);

export const DASHBOARD_EXPORTS_WEBHOOK_DEFAULTS = Object.freeze({
  enabled: false,
  url: '',
  secretConfigured: false,
  events: [],
});

export function normalizeDashboardExportsWebhookConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const hasSecret = Object.prototype.hasOwnProperty.call(config, 'secret');
  const secret = hasSecret ? String(config.secret || '').trim() : '';
  const events = [];
  const seen = new Set();

  for (const event of Array.isArray(config.events) ? config.events : []) {
    const key = String(event || '').trim().toLowerCase();
    if (!DASHBOARD_EXPORT_WEBHOOK_EVENTS.some((entry) => entry.key === key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(key);
  }

  const normalized = {
    enabled: config.enabled === true,
    url: String(config.url || '').trim(),
    secretConfigured: hasSecret ? Boolean(secret) : config.secretConfigured === true,
    events,
  };

  if (hasSecret) {
    normalized.secret = secret;
  }

  return normalized;
}

export function getDashboardExportWebhookEventLabel(eventKey, t) {
  const match = DASHBOARD_EXPORT_WEBHOOK_EVENTS.find((event) => event.key === String(eventKey || '').trim().toLowerCase());
  return match ? t(match.de, match.en) : String(eventKey || '');
}

export function buildDashboardExportsWebhookSummary(rawConfig, t) {
  const config = normalizeDashboardExportsWebhookConfig(rawConfig);
  if (!config.url) {
    return {
      statusLabel: t('Nicht konfiguriert', 'Not configured'),
      statusAccent: '#71717A',
      description: t(
        'Lege eine URL fest, um Exporte sowie Stall-, Recovery- und Failover-Alerts an deine Automationen weiterzugeben.',
        'Add a URL to forward exports as well as stall, recovery, and failover alerts to your automations.'
      ),
    };
  }

  if (config.enabled) {
    return {
      statusLabel: t('Aktiv', 'Active'),
      statusAccent: '#10B981',
      description: t(
        'Webhook-Events werden bei passenden Exporten sowie Stall-, Recovery- und Failover-Situationen automatisch ausgelöst.',
        'Webhook events are triggered automatically for matching exports as well as stall, recovery, and failover situations.'
      ),
    };
  }

  return {
    statusLabel: t('Bereit', 'Ready'),
    statusAccent: '#8B5CF6',
    description: t(
      'Das Webhook-Ziel ist gespeichert, aber automatische Export- und Reliability-Ereignisse sind aktuell deaktiviert.',
      'The webhook target is saved, but automatic export and reliability events are currently disabled.'
    ),
  };
}

export function buildDashboardExportDownloadName(kind, serverId, exportedAt = new Date()) {
  const safeKind = String(kind || 'export').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-') || 'export';
  const safeServerId = String(serverId || 'server').trim().replace(/[^a-z0-9_-]/gi, '') || 'server';
  const date = new Date(exportedAt);
  const stamp = [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, '0'),
    String(date.getUTCDate()).padStart(2, '0'),
    String(date.getUTCHours()).padStart(2, '0'),
    String(date.getUTCMinutes()).padStart(2, '0'),
  ].join('');
  return `omnifm-${safeKind}-${safeServerId}-${stamp}.json`;
}
