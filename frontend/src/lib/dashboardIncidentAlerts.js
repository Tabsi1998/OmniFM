export const DASHBOARD_INCIDENT_ALERT_EVENTS = Object.freeze([
  { key: 'stream_healthcheck_stalled', de: 'Stream-Healthcheck ausgelöst', en: 'Stream health check triggered' },
  { key: 'stream_recovered', de: 'Stream-Erholung', en: 'Stream recovered' },
  { key: 'stream_failover_activated', de: 'Failover aktiviert', en: 'Failover activated' },
  { key: 'stream_failover_exhausted', de: 'Failover ausgeschöpft', en: 'Failover exhausted' },
  { key: 'stream_failback_completed', de: 'Wunschsender wieder aktiv', en: 'Preferred station restored' },
  { key: 'station_unavailable', de: 'Sender nicht mehr verfügbar', en: 'Station no longer available' },
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
        'Wähle einen Text-Channel aus, damit OmniFM neue Reliability-Vorfälle direkt in Discord posten kann.',
        'Select a text channel so OmniFM can post new reliability incidents directly into Discord.'
      ),
    };
  }

  if (!hasChannel) {
    return {
      statusLabel: t('Nicht konfiguriert', 'Not configured'),
      statusAccent: '#8e8e97',
      description: t(
        'Lege einen Text-Channel fest, um Stream-Stalls, Recoverys und Failover-Vorfälle direkt in Discord zu sehen.',
        'Choose a text channel to see stream stalls, recoveries, and failover incidents directly in Discord.'
      ),
    };
  }

  if (config.enabled && hasEvents) {
    return {
      statusLabel: t('Aktiv', 'Active'),
      statusAccent: '#10B981',
      description: t(
        'Neue Vorfälle werden automatisch in {channel} gemeldet.',
        'New incidents are posted automatically in {channel}.',
        { channel: channelName || 'Discord' }
      ),
    };
  }

  if (config.enabled) {
    return {
      statusLabel: t('Ohne Auslöser', 'No triggers selected'),
      statusAccent: '#F59E0B',
      description: t(
        'Der Channel ist gesetzt, aber ohne ausgewählte Ereignisse bleibt der Alert-Kanal still.',
        'The channel is configured, but without selected events the alert channel stays silent.'
      ),
    };
  }

  return {
    statusLabel: t('Bereit', 'Ready'),
    statusAccent: '#A78BFA',
    description: t(
      'Der Channel {channel} ist gespeichert und kann bei Bedarf für Incident-Alerts aktiviert werden.',
      'The channel {channel} is saved and can be enabled for incident alerts when needed.',
      { channel: channelName || 'Discord' }
    ),
  };
}
