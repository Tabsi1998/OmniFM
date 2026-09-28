// OmniFM: server dashboard settings: exports and the events webhook.
// Split out of components/DashboardSettings.js (#296); its state stays there.
import { Shield } from 'lucide-react';
import {
  DASHBOARD_EXPORT_WEBHOOK_EVENTS,
  getDashboardExportWebhookEventLabel,
} from '../../lib/dashboardExports.js';
import DashboardOnboardingHint from '../DashboardOnboardingHint.js';

export default function SettingsExports({
  canManageExports,
  downloadDashboardExport,
  exportLoadingKey,
  exportsHint,
  exportsSummary,
  exportsWebhook,
  selectedGuildId,
  sendWebhookTest,
  t,
  toggleExportsWebhookEvent,
  updateExportsWebhook,
  webhookSecretInput,
  webhookTestSending,
}) {
  return (
    <div data-testid="settings-exports-webhooks" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, opacity: canManageExports ? 1 : 0.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Shield size={18} color="#F59E0B" />
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Exporte & Webhooks', 'Exports & webhooks')}</h3>
        {!canManageExports && <span style={{ fontSize: 11, color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', padding: '2px 8px' }}>ULTIMATE</span>}
      </div>
      <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
        {t(
          'Ultimate-Server können Stats und Custom-Stationen als JSON exportieren und zusätzlich Stall-, Recovery- sowie Failover-Ereignisse per Webhook oder Discord-Channel an Automationen und Operatoren melden.',
          'Ultimate servers can export stats and custom stations as JSON and additionally send stall, recovery, and failover events to automations and operators via webhook or Discord channel.'
        )}
      </p>
      {exportsHint && (
        <div style={{ marginBottom: 14 }}>
          <DashboardOnboardingHint
            hint={exportsHint}
            t={t}
            dataTestId="settings-exports-onboarding-hint"
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div data-testid="exports-status-card" style={{ border: `1px solid ${exportsSummary.statusAccent}33`, background: `${exportsSummary.statusAccent}14`, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: exportsSummary.statusAccent }}>
            {t('Status', 'Status')}
          </div>
          <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#fff' }}>{exportsSummary.statusLabel}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{exportsSummary.description}</div>
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
            {t('Webhook-Ziel', 'Webhook target')}
          </div>
          <div data-testid="exports-webhook-url-label" style={{ marginTop: 6, fontSize: 14, fontWeight: 600, color: '#D4D4D8', wordBreak: 'break-all' }}>
            {exportsWebhook.url || t('Noch keine URL hinterlegt', 'No URL configured yet')}
          </div>
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
            {t('Auslöser', 'Triggers')}
          </div>
          <div data-testid="exports-webhook-events-count" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
            {exportsWebhook.events.length} / {DASHBOARD_EXPORT_WEBHOOK_EVENTS.length}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
            {exportsWebhook.secretConfigured ? t('Secret gesetzt', 'Secret configured') : t('Ohne Secret', 'No secret')}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
        <label data-testid="exports-webhook-enabled-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, padding: '10px 0' }}>
          <input
            type="checkbox"
            disabled={!canManageExports}
            checked={exportsWebhook.enabled}
            onChange={(e) => updateExportsWebhook({ enabled: e.target.checked })}
            style={{ width: 16, height: 16, accentColor: '#F59E0B' }}
          />
          {t('Automatisch bei Exporten und Alerts senden', 'Send automatically on exports and alerts')}
        </label>

        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Webhook-URL', 'Webhook URL')}</label>
          <input
            data-testid="exports-webhook-url-input"
            disabled={!canManageExports}
            value={exportsWebhook.url}
            onChange={(e) => updateExportsWebhook({ url: e.target.value })}
            placeholder="https://example.com/omnifm"
            style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
          />
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Secret', 'Secret')}</label>
          <input
            data-testid="exports-webhook-secret-input"
            disabled={!canManageExports}
            value={webhookSecretInput}
            onChange={(e) => updateExportsWebhook({ secret: e.target.value })}
            placeholder={exportsWebhook.secretConfigured
              ? t('Gespeichert – zum Ersetzen eingeben', 'Configured – enter to replace')
              : t('Optional', 'Optional')}
            style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
          />
          {exportsWebhook.secretConfigured && (
            <button
              type="button"
              data-testid="exports-webhook-secret-clear"
              disabled={!canManageExports}
              onClick={() => updateExportsWebhook({ secret: '' })}
              style={{ marginTop: 7, border: 0, padding: 0, background: 'transparent', color: canManageExports ? '#FCA5A5' : '#52525B', cursor: canManageExports ? 'pointer' : 'not-allowed', fontSize: 12 }}
            >
              {t('Secret beim Speichern entfernen', 'Remove secret when saving')}
            </button>
          )}
        </div>
      </div>

      <div data-testid="exports-webhook-event-list" style={{ display: 'grid', gap: 8, marginBottom: 14 }}>
        {DASHBOARD_EXPORT_WEBHOOK_EVENTS.map((event) => (
          <label key={event.key} style={{ display: 'flex', alignItems: 'center', gap: 10, color: canManageExports ? '#D4D4D8' : '#52525B', fontSize: 13 }}>
            <input
              type="checkbox"
              disabled={!canManageExports}
              checked={exportsWebhook.events.includes(event.key)}
              onChange={() => toggleExportsWebhookEvent(event.key)}
              style={{ width: 15, height: 15, accentColor: '#F59E0B' }}
            />
            {getDashboardExportWebhookEventLabel(event.key, t)}
          </label>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="export-stats-btn"
          disabled={!canManageExports || exportLoadingKey === 'stats'}
          onClick={() => downloadDashboardExport('stats', `/api/dashboard/exports/stats?serverId=${encodeURIComponent(selectedGuildId)}&days=30`)}
          style={{ height: 40, padding: '0 14px', border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(120,53,15,0.16)', color: canManageExports ? '#FDE68A' : '#3F3F46', cursor: canManageExports ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}
        >
          {exportLoadingKey === 'stats' ? t('Exportiere Stats...', 'Exporting stats...') : t('Stats-Export laden', 'Download stats export')}
        </button>
        <button
          type="button"
          data-testid="export-custom-stations-btn"
          disabled={!canManageExports || exportLoadingKey === 'custom-stations'}
          onClick={() => downloadDashboardExport('custom-stations', `/api/dashboard/exports/custom-stations?serverId=${encodeURIComponent(selectedGuildId)}`)}
          style={{ height: 40, padding: '0 14px', border: '1px solid rgba(245,158,11,0.3)', background: 'rgba(120,53,15,0.16)', color: canManageExports ? '#FDE68A' : '#3F3F46', cursor: canManageExports ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}
        >
          {exportLoadingKey === 'custom-stations' ? t('Exportiere Stationen...', 'Exporting stations...') : t('Stations-Export laden', 'Download stations export')}
        </button>
        <button
          type="button"
          data-testid="export-webhook-test-btn"
          disabled={!canManageExports || !exportsWebhook.url || webhookTestSending}
          onClick={sendWebhookTest}
          style={{ height: 40, padding: '0 14px', border: '1px solid rgba(16,185,129,0.3)', background: 'rgba(6,95,70,0.16)', color: canManageExports && exportsWebhook.url ? '#BBF7D0' : '#3F3F46', cursor: canManageExports && exportsWebhook.url && !webhookTestSending ? 'pointer' : 'not-allowed', fontSize: 13, fontWeight: 600 }}
        >
          {webhookTestSending ? t('Sende Test...', 'Sending test...') : t('Webhook testen', 'Test webhook')}
        </button>
      </div>
    </div>
  );
}
