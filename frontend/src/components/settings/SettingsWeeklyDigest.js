// OmniFM: server dashboard settings: the weekly recap: channel, time, preview.
// Split out of components/DashboardSettings.js (#296); its state stays there.
import { Calendar } from 'lucide-react';
import DashboardOnboardingHint from '../DashboardOnboardingHint.js';
import { DAYS } from './settingsShared.js';

export default function SettingsWeeklyDigest({
  canManageWeeklyDigest,
  digestHint,
  digestPreview,
  digestPreviewGeneratedLabel,
  digestPreviewLoading,
  digestSummary,
  digestTestSending,
  refreshDigestPreview,
  sendDigestTest,
  setSettings,
  t,
  textChannels,
  wd,
}) {
  return (
    <div data-testid="settings-weekly-digest" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, opacity: canManageWeeklyDigest ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Calendar size={18} color="#5865F2" />
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Wöchentlicher Stats-Digest', 'Weekly stats digest')}</h3>
        {!canManageWeeklyDigest && <span style={{ fontSize: 11, color: '#10B981', border: '1px solid rgba(16,185,129,0.3)', padding: '2px 8px' }}>PRO</span>}
      </div>
      <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
        {t(
          'Automatisch ein Embed mit der Wochen-Zusammenfassung in einen Text-Channel posten.',
          'Automatically post an embed with the weekly summary to a text channel.'
        )}
      </p>
      {digestHint && (
        <div style={{ marginBottom: 14 }}>
          <DashboardOnboardingHint
            hint={digestHint}
            t={t}
            dataTestId="settings-digest-onboarding-hint"
          />
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div data-testid="digest-status-card" style={{ border: `1px solid ${digestSummary.statusAccent}33`, background: `${digestSummary.statusAccent}14`, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: digestSummary.statusAccent }}>
            {t('Status', 'Status')}
          </div>
          <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#fff' }}>{digestSummary.statusLabel}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{digestSummary.description}</div>
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
            {t('Naechster Lauf', 'Next run')}
          </div>
          <div data-testid="digest-next-run" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
            {digestSummary.nextRunLabel}
          </div>
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
            {t('Letzte Sendung', 'Last delivery')}
          </div>
          <div data-testid="digest-last-sent" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
            {digestSummary.lastSentLabel}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
            {t('Sprache', 'Language')}: {digestSummary.languageLabel}
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <label data-testid="digest-enabled-toggle" style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, padding: '10px 0' }}>
          <input
            type="checkbox"
            disabled={!canManageWeeklyDigest}
            checked={wd.enabled}
            onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, enabled: e.target.checked } }))}
            style={{ width: 16, height: 16, accentColor: '#5865F2' }}
          />
          {t('Aktiviert', 'Enabled')}
        </label>

        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Channel', 'Channel')}</label>
          <select
            data-testid="digest-channel-select"
            disabled={!canManageWeeklyDigest}
            value={wd.channelId}
            onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, channelId: e.target.value } }))}
            style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
          >
            <option value="">{t('Channel wählen...', 'Select channel...')}</option>
            {textChannels.map((channel) => <option key={channel.id} value={channel.id}>#{channel.name}</option>)}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Wochentag', 'Day')}</label>
          <select
            data-testid="digest-day-select"
            disabled={!canManageWeeklyDigest}
            value={wd.dayOfWeek}
            onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, dayOfWeek: Number(e.target.value) } }))}
            style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
          >
            {DAYS.map((day) => <option key={day.value} value={day.value}>{t(day.de, day.en)}</option>)}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Uhrzeit', 'Hour')}</label>
          <select
            data-testid="digest-hour-select"
            disabled={!canManageWeeklyDigest}
            value={wd.hour}
            onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, hour: Number(e.target.value) } }))}
            style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
          >
            {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}
          </select>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Sprache', 'Language')}</label>
          <select
            data-testid="digest-language-select"
            disabled={!canManageWeeklyDigest}
            value={wd.language || 'de'}
            onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, language: e.target.value } }))}
            style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
          >
            <option value="de">Deutsch</option>
            <option value="en">English</option>
          </select>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: 11, color: '#71717A', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Für wen', 'For whom')}</label>
          <select
            data-testid="digest-audience-select"
            disabled={!canManageWeeklyDigest}
            value={wd.audience === 'public' ? 'public' : 'team'}
            onChange={(e) => setSettings((current) => ({ ...(current || {}), weeklyDigest: { ...wd, audience: e.target.value } }))}
            style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
          >
            <option value="team">{t('Team (mit Technik-Zahlen)', 'Team (with technical numbers)')}</option>
            <option value="public">{t('Öffentlich (für die Community)', 'Public (for the community)')}</option>
          </select>
        </div>
      </div>

      <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
        <button
          type="button"
          data-testid="digest-preview-btn"
          disabled={!canManageWeeklyDigest || digestPreviewLoading}
          onClick={refreshDigestPreview}
          style={{
            height: 40,
            padding: '0 14px',
            border: '1px solid rgba(88,101,242,0.3)',
            background: 'rgba(37,99,235,0.16)',
            color: canManageWeeklyDigest ? '#DBEAFE' : '#3F3F46',
            cursor: canManageWeeklyDigest && !digestPreviewLoading ? 'pointer' : 'not-allowed',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {digestPreviewLoading ? t('Lade Vorschau...', 'Loading preview...') : t('Vorschau aktualisieren', 'Refresh preview')}
        </button>
        <button
          type="button"
          data-testid="digest-test-send-btn"
          disabled={!canManageWeeklyDigest || !wd.channelId || digestTestSending}
          onClick={sendDigestTest}
          style={{
            height: 40,
            padding: '0 14px',
            border: '1px solid rgba(16,185,129,0.3)',
            background: 'rgba(6,95,70,0.16)',
            color: canManageWeeklyDigest && wd.channelId ? '#BBF7D0' : '#3F3F46',
            cursor: canManageWeeklyDigest && wd.channelId && !digestTestSending ? 'pointer' : 'not-allowed',
            fontSize: 13,
            fontWeight: 600,
          }}
        >
          {digestTestSending ? t('Sende Test...', 'Sending test...') : t('Test-Digest senden', 'Send test digest')}
        </button>
      </div>

      <div data-testid="digest-preview-card" style={{ marginTop: 14, border: '1px solid #1A1A2E', background: '#050505', padding: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
              {t('Preview', 'Preview')}
            </div>
            <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#F4F4F5' }}>
              {digestPreview?.title || t('Noch keine Vorschau geladen', 'No preview loaded yet')}
            </div>
          </div>
          <div style={{ fontSize: 12, color: '#71717A' }}>
            {t('Erstellt', 'Generated')}: {digestPreviewGeneratedLabel}
          </div>
        </div>

        <div style={{ marginTop: 10, fontSize: 13, color: '#A1A1AA', lineHeight: 1.6 }}>
          {digestPreview?.description || t('Nutze die Vorschau, um den Weekly Digest vor dem Versand zu prüfen.', 'Use the preview to inspect the weekly digest before sending it.')}
        </div>

        <div style={{ marginTop: 12, fontSize: 12, color: '#71717A' }}>
          {t('Ziel-Channel', 'Target channel')}: {digestPreview?.channelName ? `#${digestPreview.channelName}` : t('Noch keiner ausgewählt', 'None selected yet')}
        </div>

        <div style={{ marginTop: 12, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
          {(digestPreview?.fields || []).map((field) => (
            <div key={`${field.name}-${field.value}`} style={{ border: '1px solid #1A1A2E', background: '#09090B', padding: '12px 14px' }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>{field.name}</div>
              <div style={{ marginTop: 6, fontSize: 14, color: '#F4F4F5', whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{field.value}</div>
            </div>
          ))}
        </div>
      </div>

      {digestSummary.missingChannel && (
        <div data-testid="digest-channel-warning" style={{ marginTop: 12, border: '1px solid rgba(239,68,68,0.25)', background: 'rgba(127,29,29,0.12)', padding: '10px 12px', color: '#FCA5A5', fontSize: 13 }}>
          {t(
            'Der Weekly Digest ist aktiviert, aber es wurde noch kein Text-Channel ausgewählt.',
            'The weekly digest is enabled, but no text channel has been selected yet.'
          )}
        </div>
      )}
    </div>
  );
}
