// OmniFM: server dashboard settings: the fallback station and the failover chain.
// Split out of components/DashboardSettings.js (#296); its state stays there.
import { Shield, Plus, ArrowUp, ArrowDown, X } from 'lucide-react';
import { FAILOVER_CHAIN_LIMIT } from '../../lib/dashboardSettings.js';
import DashboardOnboardingHint from '../DashboardOnboardingHint.js';

export default function SettingsFailover({
  addFailoverStation,
  availableFailoverStations,
  buildLocalFailoverPreview,
  canManageFallbackStation,
  configuredFailoverChain,
  failoverHint,
  fallbackSummary,
  moveFailoverStation,
  pendingFailoverStation,
  removeFailoverStation,
  setPendingFailoverStation,
  settings,
  t,
}) {
  return (
    <div data-testid="settings-fallback-station" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, opacity: canManageFallbackStation ? 1 : 0.5 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Shield size={18} color="#8B5CF6" />
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Failover-Kette', 'Failover chain')}</h3>
        {!canManageFallbackStation && <span style={{ fontSize: 11, color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', padding: '2px 8px' }}>ULTIMATE</span>}
      </div>
      <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
        {t(
          'Wird automatisch verwendet, wenn eine Station nicht erreichbar ist. Anstatt dass gar nichts läuft, springt der Bot auf diese Station.',
          'Automatically used when a station is unreachable. Instead of silence, the bot switches to this station.'
        )}
      </p>
      {failoverHint && (
        <div style={{ marginBottom: 14 }}>
          <DashboardOnboardingHint
            hint={failoverHint}
            t={t}
            dataTestId="settings-failover-onboarding-hint"
          />
        </div>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div data-testid="fallback-status-card" style={{ border: `1px solid ${fallbackSummary.statusAccent}33`, background: `${fallbackSummary.statusAccent}14`, padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: fallbackSummary.statusAccent }}>
            {t('Status', 'Status')}
          </div>
          <div style={{ marginTop: 6, fontSize: 18, fontWeight: 700, color: '#fff' }}>{fallbackSummary.statusLabel}</div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#A1A1AA', lineHeight: 1.6 }}>{fallbackSummary.description}</div>
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
            {t('Aktuelle Station', 'Current station')}
          </div>
          <div data-testid="fallback-current-station" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
            {fallbackSummary.stationLabel}
          </div>
          {fallbackSummary.badgeLabel && (
            <div style={{ marginTop: 8, display: 'inline-flex', border: '1px solid rgba(139,92,246,0.3)', color: '#C4B5FD', padding: '2px 8px', fontSize: 11, letterSpacing: '0.08em' }}>
              {fallbackSummary.badgeLabel}
            </div>
          )}
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
            {t('Kettenstatus', 'Chain status')}
          </div>
          <div data-testid="failover-chain-status" style={{ marginTop: 6, fontSize: 16, fontWeight: 600, color: '#D4D4D8' }}>
            {fallbackSummary.chainLabel}
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: '#71717A' }}>
            {t('Maximal 5 Stationen', 'Up to 5 stations')}
          </div>
        </div>
      </div>
      <div data-testid="failover-chain-list" style={{ display: 'grid', gap: 8, marginBottom: 12 }}>
        {configuredFailoverChain.length === 0 && (
          <div style={{ border: '1px dashed #27272A', background: '#050505', padding: '12px 14px', color: '#71717A', fontSize: 13 }}>
            {t(
              'Noch keine Failover-Kette hinterlegt. Ohne Eintraege bleibt nur die normale Auto-Reconnect-Logik aktiv.',
              'No failover chain has been configured yet. Without entries only the regular auto-reconnect logic remains active.'
            )}
          </div>
        )}

        {configuredFailoverChain.map((stationKey, index) => {
          const preview = settings?.failoverChainPreview?.[index] || buildLocalFailoverPreview(stationKey);
          const badgeLabel = preview?.isCustom
            ? t('Custom', 'Custom')
            : String(preview?.tier || 'ultimate').toUpperCase();
          return (
            <div
              key={`${stationKey}-${index}`}
              data-testid={`failover-chain-item-${index}`}
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px', flexWrap: 'wrap' }}
            >
              <div style={{ minWidth: 0, flex: '1 1 220px' }}>
                <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>
                  {t('Schritt', 'Step')} {index + 1}
                </div>
                <div style={{ marginTop: 4, fontSize: 15, fontWeight: 600, color: '#F4F4F5' }}>
                  {preview?.label || stationKey}
                </div>
                <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                  <span style={{ display: 'inline-flex', border: '1px solid rgba(139,92,246,0.3)', color: '#C4B5FD', padding: '2px 8px', fontSize: 11, letterSpacing: '0.08em' }}>
                    {badgeLabel}
                  </span>
                  {preview?.valid === false && (
                    <span style={{ color: '#FCA5A5', fontSize: 12 }}>
                      {t('Aktuell nicht verfügbar', 'Currently unavailable')}
                    </span>
                  )}
                </div>
              </div>

              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <button
                  type="button"
                  disabled={!canManageFallbackStation || index === 0}
                  onClick={() => moveFailoverStation(index, -1)}
                  style={{ width: 34, height: 34, border: '1px solid #1A1A2E', background: '#09090B', color: canManageFallbackStation && index > 0 ? '#F4F4F5' : '#3F3F46', cursor: canManageFallbackStation && index > 0 ? 'pointer' : 'not-allowed' }}
                >
                  <ArrowUp size={14} />
                </button>
                <button
                  type="button"
                  disabled={!canManageFallbackStation || index === configuredFailoverChain.length - 1}
                  onClick={() => moveFailoverStation(index, 1)}
                  style={{ width: 34, height: 34, border: '1px solid #1A1A2E', background: '#09090B', color: canManageFallbackStation && index < configuredFailoverChain.length - 1 ? '#F4F4F5' : '#3F3F46', cursor: canManageFallbackStation && index < configuredFailoverChain.length - 1 ? 'pointer' : 'not-allowed' }}
                >
                  <ArrowDown size={14} />
                </button>
                <button
                  type="button"
                  disabled={!canManageFallbackStation}
                  onClick={() => removeFailoverStation(index)}
                  style={{ width: 34, height: 34, border: '1px solid rgba(239,68,68,0.2)', background: 'rgba(127,29,29,0.12)', color: canManageFallbackStation ? '#FCA5A5' : '#3F3F46', cursor: canManageFallbackStation ? 'pointer' : 'not-allowed' }}
                >
                  <X size={14} />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 10, alignItems: 'stretch', flexWrap: 'wrap' }}>
        <select
          data-testid="failover-chain-add-select"
          disabled={!canManageFallbackStation || configuredFailoverChain.length >= FAILOVER_CHAIN_LIMIT}
          value={pendingFailoverStation}
          onChange={(e) => setPendingFailoverStation(e.target.value)}
          style={{
            flex: '1 1 280px',
            minWidth: 220,
            height: 40,
            padding: '0 10px',
            border: '1px solid #1A1A2E',
            background: '#050505',
            color: canManageFallbackStation ? '#fff' : '#3F3F46',
            boxSizing: 'border-box',
            fontSize: 13,
          }}
        >
          <option value="">{t('Station zur Kette hinzufuegen...', 'Add station to chain...')}</option>
          {availableFailoverStations.map((station) => <option key={station.value} value={station.value}>{station.label}</option>)}
        </select>

        <button
          type="button"
          data-testid="failover-chain-add-btn"
          disabled={!canManageFallbackStation || !pendingFailoverStation || configuredFailoverChain.length >= FAILOVER_CHAIN_LIMIT}
          onClick={addFailoverStation}
          style={{ height: 40, padding: '0 14px', border: '1px solid rgba(139,92,246,0.3)', background: 'rgba(91,33,182,0.18)', color: canManageFallbackStation && pendingFailoverStation ? '#DDD6FE' : '#3F3F46', cursor: canManageFallbackStation && pendingFailoverStation ? 'pointer' : 'not-allowed', display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600 }}
        >
          <Plus size={14} /> {t('Hinzufuegen', 'Add')}
        </button>
      </div>
    </div>
  );
}
