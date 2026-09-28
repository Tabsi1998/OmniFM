// OmniFM: server dashboard settings: outage alerts in a Discord channel.
// Their own card since #413: they come with Pro, webhooks and exports stay
// Ultimate (SettingsExports.js). The state stays in DashboardSettings.js.
import { Shield } from 'lucide-react';
import {
  DASHBOARD_INCIDENT_ALERT_EVENTS,
  getDashboardIncidentAlertEventLabel,
} from '../../lib/dashboardIncidentAlerts.js';

export default function SettingsIncidentAlerts({
  canManageIncidentAlerts,
  incidentAlertChannelLabel,
  incidentAlerts,
  incidentAlertsSummary,
  t,
  textChannels,
  toggleIncidentAlertEvent,
  updateIncidentAlerts,
}) {
  return (
    <div data-testid="settings-incident-alerts" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, opacity: canManageIncidentAlerts ? 1 : 0.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
        <Shield size={15} color="#10B981" />
        <strong style={{ color: '#F4F4F5', fontSize: 14 }}>{t('Ausfall-Meldungen in Discord', 'Outage alerts in Discord')}</strong>
        {!canManageIncidentAlerts && <span style={{ fontSize: 11, color: '#00e5ff', border: '1px solid rgba(0,229,255,0.3)', padding: '2px 8px' }}>PRO</span>}
      </div>
      <p style={{ color: '#71717A', fontSize: 12, marginBottom: 14, lineHeight: 1.6 }}>
        {t(
          'Meldet Aussetzer, Wiederherstellungen und Senderwechsel direkt in einen Discord-Kanal deiner Wahl.',
          'Posts stalls, recoveries and station switches straight into a Discord channel of your choice.'
        )}
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div data-testid="incident-alerts-status-card" style={{ border: `1px solid ${incidentAlertsSummary.statusAccent}33`, background: `${incidentAlertsSummary.statusAccent}14`, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: incidentAlertsSummary.statusAccent }}>
            {t('Status', 'Status')}
          </div>
          <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#fff' }}>{incidentAlertsSummary.statusLabel}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{incidentAlertsSummary.description}</div>
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
            {t('Alert-Channel', 'Alert channel')}
          </div>
          <div data-testid="incident-alert-channel-label" style={{ marginTop: 6, fontSize: 14, fontWeight: 600, color: '#D4D4D8', wordBreak: 'break-word' }}>
            {incidentAlertChannelLabel || t('Noch kein Channel gesetzt', 'No channel configured yet')}
          </div>
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
            {t('Auslöser', 'Triggers')}
          </div>
          <div data-testid="incident-alert-events-count" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
            {incidentAlerts.events.length} / {DASHBOARD_INCIDENT_ALERT_EVENTS.length}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
            {incidentAlerts.enabled ? t('Automatisch aktiv', 'Automatic delivery enabled') : t('Noch nicht aktiviert', 'Not enabled yet')}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
        <label data-testid="incident-alerts-enabled-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, padding: '10px 0' }}>
          <input
            type="checkbox"
            disabled={!canManageIncidentAlerts}
            checked={incidentAlerts.enabled}
            onChange={(e) => updateIncidentAlerts({ enabled: e.target.checked })}
            style={{ width: 16, height: 16, accentColor: '#10B981' }}
          />
          {t('Neue Incidents automatisch nach Discord senden', 'Send new incidents to Discord automatically')}
        </label>

        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Text-Channel', 'Text channel')}</label>
          <select
            data-testid="incident-alert-channel-select"
            disabled={!canManageIncidentAlerts}
            value={incidentAlerts.channelId}
            onChange={(e) => updateIncidentAlerts({ channelId: e.target.value })}
            style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: canManageIncidentAlerts ? '#fff' : '#3F3F46', boxSizing: 'border-box', fontSize: 13 }}
          >
            <option value="">{t('Kein Incident-Channel', 'No incident channel')}</option>
            {textChannels.map((channel) => (
              <option key={channel.id} value={channel.id}>
                #{channel.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div data-testid="incident-alert-event-list" style={{ display: 'grid', gap: 8, marginBottom: 6 }}>
        {DASHBOARD_INCIDENT_ALERT_EVENTS.map((event) => (
          <label key={event.key} style={{ display: 'flex', alignItems: 'center', gap: 10, color: canManageIncidentAlerts ? '#D4D4D8' : '#52525B', fontSize: 13 }}>
            <input
              type="checkbox"
              disabled={!canManageIncidentAlerts}
              checked={incidentAlerts.events.includes(event.key)}
              onChange={() => toggleIncidentAlertEvent(event.key)}
              style={{ width: 15, height: 15, accentColor: '#10B981' }}
            />
            {getDashboardIncidentAlertEventLabel(event.key, t)}
          </label>
        ))}
      </div>
    </div>
  );
}
