export const DASHBOARD_INCIDENT_ALERT_EVENTS = Object.freeze([
  { key: 'stream_healthcheck_stalled', de: 'Stream-Healthcheck ausgeloest', en: 'Stream health check triggered' },
  { key: 'stream_recovered', de: 'Stream-Erholung', en: 'Stream recovered' },
  { key: 'stream_failover_activated', de: 'Failover aktiviert', en: 'Failover activated' },
  { key: 'stream_failover_exhausted', de: 'Failover ausgeschoepft', en: 'Failover exhausted' },
  { key: 'stream_failback_completed', de: 'Wunschsender wieder aktiv', en: 'Preferred station restored' },
]);

export const DASHBOARD_INCIDENT_ALERTS_DEFAULTS = Object.freeze({
  enabled: false,
  channelId: '',
  events: [],
});

export function normalizeDashboardIncidentAlertsConfig(rawConfig) {
  const config = rawConfig && typeof rawConfig === 'object' ? rawConfig : {};
  const channelId = /^\d{17,22}$/.test(String(config.channelId || '').trim())
    ? String(config.channelId || '').trim()
    : '';
  const events = [];
  const seen = new Set();

  for (const event of Array.isArray(config.events) ? config.events : []) {
    const key = String(event || '').trim().toLowerCase();
    if (!DASHBOARD_INCIDENT_ALERT_EVENTS.some((entry) => entry.key === key)) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    events.push(key);
  }

  return {
    enabled: config.enabled === true,
    channelId,
    events,
  };
}

export function getDashboardIncidentAlertEventLabel(eventKey, t) {
  const match = DASHBOARD_INCIDENT_ALERT_EVENTS.find((event) => event.key === String(eventKey || '').trim().toLowerCase());
  return match ? t(match.de, match.en) : String(eventKey || '');
}

export function buildDashboardIncidentAlertsSummary(rawConfig, channelName, t) {
  const config = normalizeDashboardIncidentAlertsConfig(rawConfig);
  const hasChannel = Boolean(config.channelId);
  const hasEvents = config.events.length > 0;

  if (config.enabled && !hasChannel) {
    return {
      statusLabel: t('Channel fehlt', 'Channel required'),
      statusAccent: '#EF4444',
      description: t(
        'Waehle einen Text-Channel aus, damit OmniFM neue Reliability-Vorfaelle direkt in Discord posten kann.',
        'Select a text channel so OmniFM can post new reliability incidents directly into Discord.'
      ),
    };
  }

  if (!hasChannel) {
    return {
      statusLabel: t('Nicht konfiguriert', 'Not configured'),
      statusAccent: '#71717A',
      description: t(
        'Lege einen Text-Channel fest, um Stream-Stalls, Recoverys und Failover-Vorfaelle direkt in Discord zu sehen.',
        'Choose a text channel to see stream stalls, recoveries, and failover incidents directly in Discord.'
      ),
    };
  }

  if (config.enabled && hasEvents) {
    return {
      statusLabel: t('Aktiv', 'Active'),
      statusAccent: '#10B981',
      description: t(
        `Neue Vorfaelle werden automatisch in ${channelName || 'Discord'} gemeldet.`,
        `New incidents are posted automatically in ${channelName || 'Discord'}.`
      ),
    };
  }

  if (config.enabled) {
    return {
      statusLabel: t('Ohne Ausloeser', 'No triggers selected'),
      statusAccent: '#F59E0B',
      description: t(
        'Der Channel ist gesetzt, aber ohne ausgewaehlte Ereignisse bleibt der Alert-Kanal still.',
        'The channel is configured, but without selected events the alert channel stays silent.'
      ),
    };
  }

  return {
    statusLabel: t('Bereit', 'Ready'),
    statusAccent: '#8B5CF6',
    description: t(
      `Der Channel ${channelName || 'Discord'} ist gespeichert und kann bei Bedarf fuer Incident-Alerts aktiviert werden.`,
      `The channel ${channelName || 'Discord'} is saved and can be enabled for incident alerts when needed.`
    ),
  };
}
