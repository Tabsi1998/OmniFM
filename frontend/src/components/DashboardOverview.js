import React, { useState } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  AreaChart, Area, PieChart, Pie, Cell,
} from 'recharts';
import { RotateCcw } from 'lucide-react';
import {
  buildDashboardAnalyticsUpgradeHint,
  buildDashboardHealthAlerts,
  buildDashboardHealthBotSummary,
  buildDashboardHealthIncidentCounts,
  buildDashboardHealthIncidentRows,
  buildDashboardHealthStatus,
  buildReliabilitySummary,
  formatDashboardDuration,
  normalizeDashboardHealthIncidentStatusFilter,
} from '../lib/dashboardStats.js';
import { buildDashboardNextSetupAction } from '../lib/dashboardOnboarding.js';
import DashboardOnboardingHint from './DashboardOnboardingHint.js';

const COLORS = ['#5865F2', '#10B981', '#8B5CF6', '#F59E0B', '#EF4444', '#06B6D4', '#EC4899', '#F97316'];
const DAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function StatCard({ label, value, sub, accent = '#00e5ff', testId }) {
  return (
    <div data-testid={testId} style={{
      background: '#0A0A0A', border: '1px solid #1A1A2E', padding: '18px 16px',
      display: 'flex', flexDirection: 'column', gap: 6, minHeight: 110,
    }}>
      <span style={{ fontSize: 11, color: '#71717A', letterSpacing: '0.12em', textTransform: 'uppercase', fontWeight: 600 }}>{label}</span>
      <strong style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 28, lineHeight: 1.1, color: accent }}>{value}</strong>
      {sub && <span style={{ fontSize: 12, color: '#52525B' }}>{sub}</span>}
    </div>
  );
}

function ChartCard({ title, children, testId }) {
  return (
    <div data-testid={testId} style={{
      background: '#0A0A0A', border: '1px solid #1A1A2E', padding: '16px',
    }}>
      <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, marginBottom: 14, color: '#D4D4D8' }}>{title}</h4>
      {children}
    </div>
  );
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: '#18181B', border: '1px solid #27272A', padding: '8px 12px', fontSize: 12 }}>
      <div style={{ color: '#A1A1AA', marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color || '#fff' }}>{p.name}: <strong>{p.value}</strong></div>
      ))}
    </div>
  );
}

export default function DashboardOverview({
  stats,
  detailStats,
  inviteLinks = null,
  t,
  isUltimate,
  onResetStats,
  onAcknowledgeIncident = null,
  onOpenSubscription = null,
  showBasicHealth = false,
  formatDate = null,
}) {
  const [showResetConfirm, setShowResetConfirm] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [incidentFilter, setIncidentFilter] = useState('all');
  const [acknowledgingIncidentId, setAcknowledgingIncidentId] = useState('');
  const basic = stats?.basic || {};
  const isDE = t('de', 'en') === 'de';
  const dayNames = isDE ? DAYS_DE : DAYS_EN;

  const totalListeningMs = basic.totalListeningMs || 0;
  const totalSessions = basic.totalSessions || 0;
  const avgSession = basic.avgSessionMs || 0;
  const longestSession = basic.longestSessionMs || 0;
  const setupStatus = basic.setupStatus || null;
  const topStationByStarts = basic.topStationByStarts || null;
  const topStationByListening = basic.topStationByListening || null;
  const connectionHealth = detailStats?.connectionHealth || null;
  const connectionWindowDays = Number(detailStats?.connectionWindowDays || detailStats?.days || 0) || 0;
  const reliabilitySummary = buildReliabilitySummary({
    connects: connectionHealth?.connects ?? basic.totalConnections ?? 0,
    reconnects: connectionHealth?.reconnects ?? basic.totalReconnects ?? 0,
    disconnects: connectionHealth?.disconnects ?? basic.totalConnectionDisconnects ?? 0,
    errors: connectionHealth?.errors ?? basic.totalConnectionErrors ?? 0,
    t,
  });
  const totalListeningShort = formatDashboardDuration(totalListeningMs, { short: true });
  const totalListeningLong = formatDashboardDuration(totalListeningMs);
  const reliabilityLabel = connectionHealth
    ? t(`Zuverlaessigkeit (${connectionWindowDays || 7} Tage)`, `Reliability (${connectionWindowDays || 7} days)`)
    : t('Zuverlaessigkeit', 'Reliability');
  const setupProgressLabel = setupStatus
    ? t(`${setupStatus.completedSteps || 0}/3 Schritte fertig`, `${setupStatus.completedSteps || 0}/3 steps completed`)
    : '';
  const nextSetupAction = buildDashboardNextSetupAction({ setupStatus, inviteLinks, t });
  const basicHealth = basic.health || null;
  const healthStatus = buildDashboardHealthStatus(basicHealth, t);
  const healthAlerts = buildDashboardHealthAlerts(basicHealth, t);
  const normalizedIncidentFilter = normalizeDashboardHealthIncidentStatusFilter(incidentFilter);
  const healthIncidentCounts = buildDashboardHealthIncidentCounts(basicHealth);
  const healthIncidentRows = buildDashboardHealthIncidentRows(basicHealth, {
    t,
    formatDate,
    statusFilter: normalizedIncidentFilter,
    maxItems: 20,
  });
  const healthBots = Array.isArray(basicHealth?.bots) ? basicHealth.bots : [];
  const analyticsUpgradeHint = buildDashboardAnalyticsUpgradeHint({ isUltimate, t });
  const showAdvancedAnalytics = analyticsUpgradeHint == null;
  const healthNextEventLabel = basicHealth?.nextEventAt && typeof formatDate === 'function'
    ? formatDate(basicHealth.nextEventAt, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
    : '';

  const hoursData = [];
  const hoursMap = detailStats?.listeningStats?.hours || stats?.advanced?.hours || {};
  for (let h = 0; h < 24; h += 1) {
    hoursData.push({ hour: `${String(h).padStart(2, '0')}:00`, starts: Number(hoursMap[String(h)] || 0) });
  }

  const dowData = [];
  const dowMap = detailStats?.listeningStats?.daysOfWeek || stats?.advanced?.daysOfWeek || {};
  for (let d = 0; d < 7; d += 1) {
    dowData.push({ day: dayNames[d], starts: Number(dowMap[String(d)] || 0) });
  }

  const stationData = Object.entries(
    detailStats?.listeningStats?.stationStarts
      || stats?.advanced?.stationBreakdown?.reduce((acc, s) => {
        acc[s.name || s.key] = s.starts || 0;
        return acc;
      }, {})
      || {}
  ).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value]) => ({
    name: name.length > 20 ? `${name.slice(0, 18)}..` : name,
    value,
  }));

  const dailyData = (detailStats?.dailyStats || []).slice().reverse().map((d) => ({
    date: d.date?.slice(5) || '',
    starts: d.totalStarts || 0,
    hours: Math.round((d.totalListeningMs || 0) / 3600000 * 10) / 10,
    peak: d.peakListeners || 0,
  }));

  const activeSessions = detailStats?.activeSessions || [];

  const handleReset = async () => {
    if (!onResetStats) return;
    setResetting(true);
    try {
      await onResetStats();
    } finally {
      setResetting(false);
      setShowResetConfirm(false);
    }
  };

  const handleAcknowledgeIncident = async (incidentId) => {
    if (typeof onAcknowledgeIncident !== 'function' || !incidentId) return;
    setAcknowledgingIncidentId(incidentId);
    try {
      await onAcknowledgeIncident(incidentId);
    } catch {
      // Portal handles the visible error state.
    } finally {
      setAcknowledgingIncidentId('');
    }
  };

  return (
    <section data-testid="dashboard-overview-panel" style={{ display: 'grid', gap: 14 }}>
      <div data-testid="lifetime-stats-info" style={{
        background: '#0A0A0A', border: '1px solid rgba(16,185,129,0.2)', padding: '12px 16px',
        display: 'grid', gap: 12, fontSize: 13, color: '#A1A1AA',
      }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12, minWidth: 0 }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#10B981" strokeWidth="2" style={{ flexShrink: 0, marginTop: 1 }}>
              <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
            </svg>
            <div style={{ display: 'grid', gap: 6 }}>
              <strong style={{ color: '#D4D4D8', fontSize: 14 }}>
                {t('Lifetime-Statistiken', 'Lifetime statistics')}
              </strong>
              <span>
                {t(
                  'Die Werte werden über alle Sessions und Tage akkumuliert. Du kannst sie direkt hier zurücksetzen, ohne den Bot vom Server entfernen zu müssen.',
                  'Values are accumulated across all sessions and days. You can reset them directly here without removing the bot from the server.'
                )}
              </span>
            </div>
          </div>
          {!showResetConfirm ? (
            <button
              data-testid="overview-stats-reset-btn"
              onClick={() => setShowResetConfirm(true)}
              style={{
                border: '1px solid #27272A',
                background: 'transparent',
                color: '#A1A1AA',
                padding: '8px 12px',
                cursor: 'pointer',
                fontSize: 12,
                fontWeight: 600,
                display: 'inline-flex',
                alignItems: 'center',
                gap: 6,
                flexShrink: 0,
              }}
            >
              <RotateCcw size={13} />
              {t('Statistiken zurücksetzen', 'Reset statistics')}
            </button>
          ) : (
            <div
              data-testid="overview-stats-reset-confirm"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                justifyContent: 'flex-end',
              }}
            >
              <span style={{ color: '#FCA5A5', fontSize: 12 }}>
                {t('Wirklich alles für diesen Server löschen?', 'Really delete everything for this server?')}
              </span>
              <button
                data-testid="overview-stats-reset-confirm-yes"
                onClick={handleReset}
                disabled={resetting}
                style={{
                  border: '1px solid #EF4444',
                  background: '#EF4444',
                  color: '#fff',
                  padding: '8px 12px',
                  cursor: resetting ? 'wait' : 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  opacity: resetting ? 0.6 : 1,
                }}
              >
                {resetting ? t('Lösche...', 'Deleting...') : t('Ja, löschen', 'Yes, delete')}
              </button>
              <button
                data-testid="overview-stats-reset-confirm-no"
                onClick={() => setShowResetConfirm(false)}
                disabled={resetting}
                style={{
                  border: '1px solid #27272A',
                  background: 'transparent',
                  color: '#A1A1AA',
                  padding: '8px 12px',
                  cursor: resetting ? 'wait' : 'pointer',
                  fontSize: 12,
                }}
              >
                {t('Abbrechen', 'Cancel')}
              </button>
            </div>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 10 }}>
        <StatCard testId="metric-listeners" label={t('Live-Zuhoerer', 'Live listeners')} value={basic.listenersNow ?? 0} accent="#00e5ff" />
        <StatCard testId="metric-streams" label={t('Aktive Streams', 'Active streams')} value={basic.activeStreams ?? 0} accent="#10B981" />
        <StatCard testId="metric-peak" label={t('Peak-Zuhoerer', 'Peak listeners')} value={basic.peakListeners ?? 0} accent="#8B5CF6" />
        <StatCard
          testId="metric-total-time"
          label={t('Gesamte Hoerzeit', 'Total listening')}
          value={totalListeningShort}
          accent="#F59E0B"
          sub={totalListeningLong !== totalListeningShort ? totalListeningLong : undefined}
        />
        <StatCard testId="metric-sessions" label={t('Abgeschlossene Sessions', 'Completed sessions')} value={totalSessions} accent="#06B6D4" />
        <StatCard testId="metric-reliability" label={reliabilityLabel} value={reliabilitySummary.value} accent={reliabilitySummary.accent} sub={reliabilitySummary.sub} />
      </div>

      {setupStatus && (
        <div data-testid="dashboard-setup-status-panel" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16, display: 'grid', gap: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
            <div style={{ display: 'grid', gap: 6 }}>
              <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, color: '#D4D4D8' }}>
                {t('Setup-Status', 'Setup status')}
              </h4>
              <p style={{ color: '#71717A', fontSize: 12, lineHeight: 1.6 }}>
                {t(
                  'Zeigt, ob der Commander verbunden ist, mindestens ein Worker eingeladen wurde und bereits ein erster Stream laeuft.',
                  'Shows whether the commander is connected, at least one worker is invited, and a first stream is already live.'
                )}
              </p>
            </div>
            <div style={{
              border: '1px solid rgba(0,229,255,0.2)',
              background: 'rgba(0,229,255,0.08)',
              color: '#00e5ff',
              padding: '10px 12px',
              minWidth: 180,
            }}>
              <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', opacity: 0.9 }}>
                {t('Fortschritt', 'Progress')}
              </div>
              <div style={{ marginTop: 4, fontSize: 18, fontWeight: 700 }}>{setupProgressLabel}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: 10 }}>
            {[
              {
                key: 'commander',
                done: setupStatus.commanderReady === true,
                label: t('Commander verbunden', 'Commander connected'),
                sub: setupStatus.commanderReady === true
                  ? t('Der Hauptbot ist auf diesem Server bereit.', 'The main bot is ready on this server.')
                  : t('Der Hauptbot muss noch auf diesem Server verfügbar sein.', 'The main bot still needs to be available on this server.'),
              },
              {
                key: 'worker',
                done: setupStatus.workerInvited === true,
                label: t('Worker eingeladen', 'Worker invited'),
                sub: t(
                  `${setupStatus.invitedWorkerCount || 0} von ${setupStatus.maxWorkerSlots || 0} Worker-Slots verbunden`,
                  `${setupStatus.invitedWorkerCount || 0} of ${setupStatus.maxWorkerSlots || 0} worker slots connected`
                ),
              },
              {
                key: 'stream',
                done: setupStatus.firstStreamLive === true,
                label: t('Erster Stream live', 'First stream live'),
                sub: t(
                  `${setupStatus.activeStreamCount || 0} aktive Streams auf diesem Server`,
                  `${setupStatus.activeStreamCount || 0} active streams on this server`
                ),
              },
            ].map((step) => (
              <div key={step.key} data-testid={`dashboard-setup-step-${step.key}`} style={{ border: '1px solid #1A1A2E', background: '#050505', padding: '12px 14px', display: 'grid', gap: 8 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                  <strong style={{ color: '#D4D4D8' }}>{step.label}</strong>
                  <span style={{
                    fontSize: 11,
                    textTransform: 'uppercase',
                    letterSpacing: '0.08em',
                    color: step.done ? '#6EE7B7' : '#FCD34D',
                  }}>
                    {step.done ? t('Erledigt', 'Done') : t('Offen', 'Pending')}
                  </span>
                </div>
                <div style={{ color: '#A1A1AA', fontSize: 12, lineHeight: 1.6 }}>{step.sub}</div>
              </div>
            ))}
          </div>

          {nextSetupAction && (
            <DashboardOnboardingHint
              hint={{
                ...nextSetupAction,
                note: !nextSetupAction.inviteUrl && (nextSetupAction.command === '/setup' || nextSetupAction.command === '/workers')
                  ? t(
                    'Falls kein direkter Invite-Link erscheint, prüfe die Bot-Konfiguration oder nutze /invite direkt in Discord.',
                    'If no direct invite link appears, check the bot configuration or use /invite directly in Discord.'
                  )
                  : nextSetupAction.note,
              }}
              t={t}
              dataTestId="dashboard-setup-next-action"
              actions={
                setupStatus.firstStreamLive === true && typeof onOpenSubscription === 'function'
                  ? [{
                    label: t('Mehr Worker / Features ansehen', 'View more workers / features'),
                    onClick: onOpenSubscription,
                    testId: 'dashboard-setup-open-subscription',
                    variant: 'premium',
                  }]
                  : []
              }
            />
          )}
        </div>
      )}

      {showBasicHealth && (
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
      )}

      {activeSessions.length > 0 && (
        <div data-testid="active-sessions-panel" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
          <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, color: '#D4D4D8', marginBottom: 10 }}>
            {t('Aktive Sessions', 'Active sessions')} ({activeSessions.length})
          </h4>
          <div style={{ display: 'grid', gap: 6 }}>
            {activeSessions.map((s, i) => (
              <div key={i} data-testid={`active-session-${i}`} style={{
                border: '1px solid #1A1A2E', background: '#050505', padding: '10px 12px',
                display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, flexWrap: 'wrap',
              }}>
                <span style={{ fontWeight: 600 }}>{s.stationName || s.stationKey || '-'}</span>
                <span style={{ color: '#71717A', fontSize: 13 }}>
                  {s.currentListeners} {t('Zuhoerer', 'listeners')} | {t('Durchschn.', 'Avg')} {s.currentAvgListeners ?? 0} | {t('Hoerzeit', 'Listening')}: {formatDashboardDuration(s.currentHumanListeningMs)} | {t('Dauer', 'Runtime')}: {formatDashboardDuration(s.currentDurationMs)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {showAdvancedAnalytics && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10 }}>
          <ChartCard title={t('Starts nach Stunde', 'Starts by hour')} testId="chart-hourly">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hoursData}>
                <XAxis dataKey="hour" tick={{ fill: '#52525B', fontSize: 10 }} interval={2} />
                <YAxis tick={{ fill: '#52525B', fontSize: 10 }} width={30} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="starts" fill="#5865F2" radius={[2, 2, 0, 0]} name={t('Starts', 'Starts')} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>

          <ChartCard title={t('Starts nach Wochentag', 'Starts by weekday')} testId="chart-dow">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={dowData}>
                <XAxis dataKey="day" tick={{ fill: '#52525B', fontSize: 11 }} />
                <YAxis tick={{ fill: '#52525B', fontSize: 10 }} width={30} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="starts" fill="#8B5CF6" radius={[2, 2, 0, 0]} name={t('Starts', 'Starts')} />
              </BarChart>
            </ResponsiveContainer>
          </ChartCard>
        </div>
      )}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10 }}>
        {!showAdvancedAnalytics && analyticsUpgradeHint && (
          <div
            data-testid="overview-ultimate-analytics-hint"
            style={{
              background: 'linear-gradient(135deg, rgba(76,29,149,0.22), rgba(8,8,8,0.92))',
              border: '1px solid rgba(139,92,246,0.28)',
              padding: 16,
              display: 'grid',
              gap: 12,
            }}
          >
            <div style={{ display: 'grid', gap: 8 }}>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 'fit-content',
                padding: '4px 8px',
                fontSize: 11,
                fontWeight: 700,
                letterSpacing: '0.12em',
                color: '#DDD6FE',
                border: '1px solid rgba(196,181,253,0.3)',
                background: 'rgba(91,33,182,0.2)',
              }}>
                {analyticsUpgradeHint.badge}
              </span>
              <div style={{ display: 'grid', gap: 6 }}>
                <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 18, color: '#F5F3FF' }}>
                  {analyticsUpgradeHint.title}
                </h4>
                <p style={{ color: '#D4D4D8', fontSize: 13, lineHeight: 1.65 }}>
                  {analyticsUpgradeHint.description}
                </p>
              </div>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {analyticsUpgradeHint.bullets.map((bullet, index) => (
                <div key={index} style={{ display: 'flex', gap: 10, alignItems: 'flex-start', color: '#DDD6FE', fontSize: 13 }}>
                  <span style={{ color: '#8B5CF6', fontWeight: 700 }}>+</span>
                  <span>{bullet}</span>
                </div>
              ))}
            </div>
            <div style={{ color: '#A78BFA', fontSize: 12 }}>
              {t(
                'Upgrade im Subscription-Bereich, um die erweiterten Analytics für diesen Server freizuschalten.',
                'Upgrade in the subscription area to unlock advanced analytics for this server.'
              )}
            </div>
            {typeof onOpenSubscription === 'function' && (
              <button
                data-testid="overview-ultimate-analytics-upgrade-btn"
                onClick={onOpenSubscription}
                style={{
                  border: '1px solid rgba(196,181,253,0.4)',
                  background: 'rgba(91,33,182,0.24)',
                  color: '#F5F3FF',
                  padding: '10px 12px',
                  cursor: 'pointer',
                  fontSize: 12,
                  fontWeight: 600,
                  width: 'fit-content',
                }}
              >
                {t('Zu Ultimate wechseln', 'Switch to Ultimate')}
              </button>
            )}
          </div>
        )}

        {showAdvancedAnalytics && stationData.length > 0 && (
          <ChartCard title={t('Meist gestartete Stationen (Starts)', 'Most started stations (starts)')} testId="chart-stations">
            <ResponsiveContainer width="100%" height={220}>
              <PieChart>
                <Pie data={stationData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label={({ name }) => name}>
                  {stationData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                </Pie>
                <Tooltip content={<CustomTooltip />} />
              </PieChart>
            </ResponsiveContainer>
          </ChartCard>
        )}

        <div style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
          <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, color: '#D4D4D8', marginBottom: 14 }}>
            {t('Session-Details', 'Session details')}
          </h4>
          <p style={{ color: '#71717A', fontSize: 12, marginTop: -6, marginBottom: 12 }}>
            {t(
              'Eine Session ist ein abgeschlossener Stream-Lauf pro Bot (Start bis Stop/Neustart).',
              'A session is one completed stream run per bot (start until stop/restart).'
            )}
          </p>
          {totalSessions > 0 ? (
            <div style={{ display: 'grid', gap: 10 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
                <span style={{ color: '#71717A' }}>{t('Durchschn. Hoerzeit / Session', 'Avg listening time / session')}</span>
                <strong>{formatDashboardDuration(avgSession)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
                <span style={{ color: '#71717A' }}>{t('Laengste Hoerzeit / Session', 'Longest listening time / session')}</span>
                <strong>{formatDashboardDuration(longestSession)}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
                <span style={{ color: '#71717A' }}>{t('Starts gesamt', 'Lifetime starts')}</span>
                <strong>{basic.totalStarts || 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
                <span style={{ color: '#71717A' }}>{t('Reconnects gesamt', 'Lifetime reconnects')}</span>
                <strong>{basic.totalReconnects || 0}</strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', borderBottom: '1px solid #1A1A2E', paddingBottom: 8 }}>
                <span style={{ color: '#71717A' }}>{t('Top Station (Hoerzeit)', 'Top station (listening time)')}</span>
                <strong style={{ maxWidth: 180, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {topStationByListening?.name || basic.topStation?.name || '-'}
                </strong>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                <span style={{ color: '#71717A' }}>{t('Meist gestartet', 'Most started')}</span>
                <strong style={{ maxWidth: 180, textOverflow: 'ellipsis', overflow: 'hidden', whiteSpace: 'nowrap' }}>
                  {topStationByStarts?.name || '-'}
                </strong>
              </div>
            </div>
          ) : (
            <div
              data-testid="overview-session-details-empty"
              style={{
                border: '1px dashed #27272A',
                background: '#050505',
                padding: '12px 14px',
                color: '#A1A1AA',
                fontSize: 13,
                lineHeight: 1.7,
              }}
            >
              {t(
                'Noch keine abgeschlossene Session auf diesem Server. Nach dem ersten echten Stream erscheinen hier Laufzeiten, Starts und Top-Stationen.',
                'There is no completed session on this server yet. After the first real stream, runtimes, starts, and top stations appear here.'
              )}
            </div>
          )}
        </div>
      </div>

      {showAdvancedAnalytics && dailyData.length > 0 && (
        <ChartCard title={t('Taegl. Trend (letzte 30 Tage)', 'Daily trend (last 30 days)')} testId="chart-daily-trend">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="gradStarts" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#5865F2" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#5865F2" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: '#52525B', fontSize: 10 }} />
              <YAxis tick={{ fill: '#52525B', fontSize: 10 }} width={30} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="starts" stroke="#5865F2" fill="url(#gradStarts)" name={t('Starts', 'Starts')} />
              <Area type="monotone" dataKey="peak" stroke="#8B5CF6" fill="none" name={t('Peak', 'Peak')} strokeDasharray="3 3" />
            </AreaChart>
          </ResponsiveContainer>
        </ChartCard>
      )}

      <style>{`
        @media (max-width: 768px) {
          [data-testid='dashboard-overview-panel'] > div { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
