// OmniFM: server dashboard settings: voice guard, who may move the bot.
// Split out of components/DashboardSettings.js (#296); its state stays there.
import { Shield } from 'lucide-react';
import { normalizeDashboardVoiceGuardConfig } from '../../lib/dashboardVoiceGuard.js';

export default function SettingsVoiceGuard({
  canManageVoiceGuard,
  setSettings,
  t,
  voiceGuard,
  voiceGuardSummary,
}) {
  return (
    <div data-testid={canManageVoiceGuard ? 'settings-voice-guard' : 'settings-voice-guard-locked'} style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, opacity: canManageVoiceGuard ? 1 : 0.6 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Shield size={18} color="#10B981" />
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Voice Guard', 'Voice guard')}</h3>
        {!canManageVoiceGuard && <span style={{ fontSize: 11, color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', padding: '2px 8px' }}>LOCKED</span>}
      </div>
      <p style={{ color: '#8e8e97', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
        {canManageVoiceGuard
          ? t(
            'Steuert, wie OmniFM auf Fremdverschiebungen in andere Voice-Channels reagiert. Für bewusstes Umziehen gibt es zusätzlich `/voiceguard unlock`.',
            'Controls how OmniFM reacts to foreign moves into other voice channels. For intentional moves you can additionally use `/voiceguard unlock`.'
          )
          : t(
            'Voice Guard konnte für diesen Server gerade nicht freigeschaltet werden. Bitte prüfe den Capability-Status oder lade das Dashboard neu.',
            'Voice guard could not be enabled for this server right now. Please verify the capability status or reload the dashboard.'
          )}
      </p>

      {canManageVoiceGuard && (
      <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div data-testid="voice-guard-status-card" style={{ border: `1px solid ${voiceGuardSummary.statusAccent}33`, background: `${voiceGuardSummary.statusAccent}14`, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: voiceGuardSummary.statusAccent }}>
            {t('Status', 'Status')}
          </div>
          <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#fff' }}>{voiceGuardSummary.statusLabel}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{voiceGuardSummary.description}</div>
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8e8e97' }}>
            {t('Policy', 'Policy')}
          </div>
          <div data-testid="voice-guard-policy-summary" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
            {voiceGuardSummary.policyLabel}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#8e8e97' }}>
            {t('Aktiv', 'Active')}: {voiceGuardSummary.effectiveLabel}
          </div>
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#8e8e97' }}>
            {t('Guard-Regeln', 'Guard rules')}
          </div>
          <div data-testid="voice-guard-thresholds" style={{ marginTop: 6, fontSize: 13, color: '#D4D4D8', lineHeight: 1.7 }}>
            {voiceGuardSummary.thresholdsLabel}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#8e8e97' }}>
            {voiceGuardSummary.escalationLabel}
          </div>
        </div>
      </div>

      <div style={{ maxWidth: 280 }}>
        <label style={{ display: 'block', fontSize: 11, color: '#8e8e97', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Server-Policy', 'Server policy')}</label>
        <select
          data-testid="voice-guard-policy-select"
          aria-label={t('Server-Policy', 'Server policy')}
          value={voiceGuard.policy}
          onChange={(e) => setSettings((current) => ({ ...(current || {}), voiceGuard: normalizeDashboardVoiceGuardConfig({ ...(current?.voiceGuard || {}), policy: e.target.value }) }))}
          style={{ width: '100%', height: 40, padding: '0 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', boxSizing: 'border-box', fontSize: 13 }}
        >
          <option value="default">{t('Standard (globale Env)', 'Default (global env)')}</option>
          <option value="allow">{t('Erlauben', 'Allow')}</option>
          <option value="return">{t('Zurückspringen', 'Return')}</option>
          <option value="disconnect">Disconnect</option>
        </select>
      </div>
      </>
      )}
    </div>
  );
}
