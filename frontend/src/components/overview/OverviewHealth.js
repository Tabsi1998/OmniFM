// OmniFM: server dashboard overview: the health of the bots and the incidents.
// Split out of components/DashboardOverview.js (#296); its state stays there.
import { buildDashboardHealthBotSummary } from '../../lib/dashboardStats.js';
import { StatCard } from './overviewShared.js';

export default function OverviewHealth({
  acknowledgingIncidentId,
  basicHealth,
  handleAcknowledgeIncident,
  healthAlerts,
  healthBots,
  healthIncidentCounts,
  healthIncidentRows,
  healthNextEventLabel,
  healthStatus,
  normalizedIncidentFilter,
  onAcknowledgeIncident,
  setIncidentFilter,
  t,
}) {
  return (
    <div data-testid="dashboard-health-panel" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, display: 'grid', gap: 14 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
        <div>
          <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, color: '#D4D4D8' }}>
            {t('Server-Health', 'Server health')}
          </h4>
          <p style={{ color: '#71717A', fontSize: 12, marginTop: 6, lineHeight: 1.6 }}>
            {t(
              'Schneller Betriebsstatus für Bots, Streams und geplante Events.',
              'Quick operational status for bots, streams, and scheduled events.'
            )}
          </p>
        </div>
        <div style={{
          border: `1px solid ${healthStatus.accent}44`,
          background: `${healthStatus.accent}14`,
          color: healthStatus.accent,
          padding: '10px 12px',
          minWidth: 180,
        }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.9 }}>
            {t('Status', 'Status')}
          </div>
          <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700 }}>{healthStatus.label}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#A1A1AA' }}>{healthStatus.sub}</div>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <StatCard testId="health-managed-bots" label={t('Verwaltete Bots', 'Managed bots')} value={basicHealth?.managedBots ?? 0} accent="#A5B4FC" />
        <StatCard testId="health-recovering-streams" label={t('Recovering Streams', 'Recovering streams')} value={basicHealth?.recoveringStreams ?? 0} accent="#F59E0B" />
        <StatCard testId="health-reconnect-attempts" label={t('Reconnects live', 'Live reconnects')} value={basicHealth?.reconnectAttempts ?? 0} accent="#06B6D4" />
        <StatCard testId="health-stream-errors" label={t('Stream-Fehler live', 'Live stream errors')} value={basicHealth?.streamErrors ?? 0} accent="#EF4444" />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 10 }}>
        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 12 }}>
          <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {t('Streams & Channel', 'Streams & channel')}
          </div>
          <div style={{ marginTop: 8, display: 'grid', gap: 6, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#71717A' }}>{t('Aktive Streams', 'Active streams')}</span>
              <strong>{basicHealth?.liveStreams ?? 0}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#71717A' }}>{t('Voice-Channels', 'Voice channels')}</span>
              <strong>{basicHealth?.activeVoiceChannels ?? 0}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#71717A' }}>{t('Live-Zuhoerer', 'Live listeners')}</span>
              <strong>{basicHealth?.listenersNow ?? 0}</strong>
            </div>
          </div>
        </div>

        <div style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 12 }}>
          <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
            {t('Events', 'Events')}
          </div>
          <div style={{ marginTop: 8, display: 'grid', gap: 6, fontSize: 13 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#71717A' }}>{t('Konfiguriert', 'Configured')}</span>
              <strong>{basicHealth?.eventsConfigured ?? 0}</strong>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12 }}>
              <span style={{ color: '#71717A' }}>{t('Aktiv', 'Active')}</span>
              <strong>{basicHealth?.eventsActive ?? 0}</strong>
            </div>
            <div style={{ display: 'grid', gap: 4 }}>
              <span style={{ color: '#71717A' }}>{t('Naechstes Event', 'Next event')}</span>
              <strong style={{ color: '#D4D4D8' }}>
                {basicHealth?.nextEventTitle || t('Keines geplant', 'No event scheduled')}
              </strong>
              {healthNextEventLabel && (
                <span style={{ color: '#71717A', fontSize: 12 }}>{healthNextEventLabel}</span>
              )}
            </div>
          </div>
        </div>
      </div>

      <div style={{ display: 'grid', gap: 8 }}>
        {healthAlerts.map((alert, index) => (
          <div
            key={`${alert.severity}-${index}`}
            data-testid={`dashboard-health-alert-${index}`}
            style={{
              border: `1px solid ${alert.severity === 'critical' ? 'rgba(239,68,68,0.25)' : alert.severity === 'warning' ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.25)'}`,
              background: alert.severity === 'critical'
                ? 'rgba(127,29,29,0.12)'
                : alert.severity === 'warning'
                  ? 'rgba(120,53,15,0.12)'
                  : 'rgba(6,78,59,0.12)',
              color: alert.severity === 'critical' ? '#FCA5A5' : alert.severity === 'warning' ? '#FCD34D' : '#6EE7B7',
              padding: '10px 12px',
              fontSize: 13,
            }}
          >
            {alert.message}
          </div>
        ))}
      </div>

      {healthIncidentCounts.all > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <div style={{ color: '#D4D4D8', fontSize: 14, fontWeight: 600 }}>
              {t('Letzte Vorfaelle', 'Recent incidents')}
            </div>
            <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
              {[
                { key: 'all', label: t('Alle', 'All'), count: healthIncidentCounts.all },
                { key: 'open', label: t('Offen', 'Open'), count: healthIncidentCounts.open },
                { key: 'acknowledged', label: t('Quittiert', 'Acknowledged'), count: healthIncidentCounts.acknowledged },
              ].map((filterOption) => (
                <button
                  key={filterOption.key}
                  type="button"
                  data-testid={`dashboard-health-incident-filter-${filterOption.key}`}
                  onClick={() => setIncidentFilter(filterOption.key)}
                  style={{
                    border: normalizedIncidentFilter === filterOption.key ? '1px solid #10B981' : '1px solid #27272A',
                    background: normalizedIncidentFilter === filterOption.key ? 'rgba(6,95,70,0.16)' : '#050505',
                    color: normalizedIncidentFilter === filterOption.key ? '#BBF7D0' : '#A1A1AA',
                    padding: '6px 10px',
                    cursor: 'pointer',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                  }}
                >
                  {filterOption.label} {filterOption.count}
                </button>
              ))}
            </div>
          </div>
          {healthIncidentRows.length > 0 ? (
            <div style={{ display: 'grid', gap: 8 }}>
              {healthIncidentRows.map((incident, index) => (
                <div
                  key={incident.id || index}
                  data-testid={`dashboard-health-incident-${index}`}
                  style={{
                    border: `1px solid ${incident.severity === 'critical' ? 'rgba(239,68,68,0.25)' : incident.severity === 'warning' ? 'rgba(245,158,11,0.25)' : 'rgba(16,185,129,0.25)'}`,
                    background: incident.severity === 'critical'
                      ? 'rgba(127,29,29,0.10)'
                      : incident.severity === 'warning'
                        ? 'rgba(120,53,15,0.10)'
                        : 'rgba(6,78,59,0.10)',
                    padding: '12px 14px',
                    display: 'grid',
                    gap: 8,
                  }}
                >
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                    <div style={{ display: 'grid', gap: 4 }}>
                      <strong style={{ color: '#D4D4D8', fontSize: 13 }}>{incident.title}</strong>
                      <span style={{ color: '#A1A1AA', fontSize: 12 }}>{incident.detail}</span>
                    </div>
                    <div style={{ display: 'grid', gap: 6, justifyItems: 'end' }}>
                      {incident.timestampLabel && (
                        <span style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                          {incident.timestampLabel}
                        </span>
                      )}
                      {incident.isAcknowledged ? (
                        <span
                          data-testid={`dashboard-health-incident-acknowledged-${index}`}
                          style={{
                            border: '1px solid rgba(16,185,129,0.25)',
                            background: 'rgba(6,95,70,0.16)',
                            color: '#6EE7B7',
                            padding: '4px 8px',
                            fontSize: 11,
                            letterSpacing: '0.04em',
                          }}
                        >
                          {incident.acknowledgedByLabel
                            ? t(`Quittiert von ${incident.acknowledgedByLabel}`, `Acknowledged by ${incident.acknowledgedByLabel}`)
                            : t('Quittiert', 'Acknowledged')}
                        </span>
                      ) : typeof onAcknowledgeIncident === 'function' ? (
                        <button
                          type="button"
                          data-testid={`dashboard-health-incident-ack-btn-${index}`}
                          disabled={acknowledgingIncidentId === incident.id}
                          onClick={() => handleAcknowledgeIncident(incident.id)}
                          style={{
                            border: '1px solid rgba(16,185,129,0.3)',
                            background: 'rgba(6,95,70,0.16)',
                            color: acknowledgingIncidentId === incident.id ? '#86EFAC' : '#BBF7D0',
                            padding: '6px 10px',
                            cursor: acknowledgingIncidentId === incident.id ? 'wait' : 'pointer',
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {acknowledgingIncidentId === incident.id
                            ? t('Quittiere...', 'Acknowledging...')
                            : t('Quittieren', 'Acknowledge')}
                        </button>
                      ) : null}
                    </div>
                  </div>
                  {incident.acknowledgedLabel && (
                    <div style={{ color: '#71717A', fontSize: 12, lineHeight: 1.5 }}>
                      {t(`Quittiert am ${incident.acknowledgedLabel}`, `Acknowledged at ${incident.acknowledgedLabel}`)}
                    </div>
                  )}
                  {incident.chips.length > 0 && (
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                      {incident.chips.map((chip) => (
                        <span key={chip} style={{
                          border: '1px solid #27272A',
                          background: '#050505',
                          color: '#A1A1AA',
                          padding: '4px 8px',
                          fontSize: 11,
                          letterSpacing: '0.04em',
                        }}>
                          {chip}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          ) : (
            <div
              data-testid="dashboard-health-incidents-empty"
              style={{
                border: '1px dashed #27272A',
                background: '#050505',
                padding: '12px 14px',
                color: '#A1A1AA',
                fontSize: 13,
                lineHeight: 1.7,
              }}
            >
              {normalizedIncidentFilter === 'open'
                ? t('Aktuell gibt es keine offenen Vorfaelle.', 'There are currently no open incidents.')
                : normalizedIncidentFilter === 'acknowledged'
                  ? t('Noch keine quittierten Vorfaelle vorhanden.', 'There are no acknowledged incidents yet.')
                  : t('Noch keine Vorfaelle vorhanden.', 'There are no incidents yet.')}
            </div>
          )}
        </div>
      )}

      {healthBots.length > 0 && (
        <div style={{ display: 'grid', gap: 8 }}>
          <div style={{ color: '#D4D4D8', fontSize: 14, fontWeight: 600 }}>
            {t('Bot-Status pro Instanz', 'Bot status by instance')}
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 8 }}>
            {healthBots.map((bot) => {
              const botStatus = buildDashboardHealthBotSummary(bot, { t });
              return (
                <div key={bot.botId || bot.botName} data-testid={`dashboard-health-bot-${bot.botId || bot.botName}`} style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px', display: 'grid', gap: 6 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                    <strong>{bot.botName || t('Bot', 'Bot')}</strong>
                    <span style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: botStatus.color }}>
                      {botStatus.label}
                    </span>
                  </div>
                  <div style={{ color: '#71717A', fontSize: 12 }}>
                    {String(bot.role || '').toUpperCase()}
                  </div>
                  <div style={{ color: '#D4D4D8', fontSize: 12, lineHeight: 1.6 }}>
                    {botStatus.summary}
                  </div>
                  <div style={{ color: '#A1A1AA', fontSize: 12, lineHeight: 1.6 }}>
                    {botStatus.playback}
                  </div>
                  <div style={{ color: '#71717A', fontSize: 11, lineHeight: 1.6 }}>
                    {botStatus.hint}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
