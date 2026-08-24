import React from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  LineChart, Line, AreaChart, Area,
} from 'recharts';
import {
  buildConnectionTimelineRows,
  buildConnectionEventEntryId,
  buildSessionQualitySummary,
  buildSessionHistoryEntryId,
  buildSessionTimelineRows,
  buildVoiceChannelUsageRows,
  formatDashboardDuration,
} from '../lib/dashboardStats.js';
import { buildDashboardNextSetupAction } from '../lib/dashboardOnboarding.js';
import DashboardOnboardingHint from './DashboardOnboardingHint.js';

const DAYS_DE = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const DAYS_EN = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

function formatRepeatModeLabel(repeat, t) {
  switch (String(repeat || '').trim().toLowerCase()) {
    case 'none': return t('Keine Wiederholung', 'No repeat');
    case 'daily': return t('Täglich', 'Daily');
    case 'weekdays': return t('Werktags', 'Weekdays');
    case 'weekly': return t('Wöchentlich', 'Weekly');
    case 'biweekly': return t('Alle 2 Wochen', 'Every 2 weeks');
    case 'yearly': return t('Jährlich', 'Yearly');
    case 'monthly_first_weekday': return t('Monatlich (1. Wochentag)', 'Monthly (1st weekday)');
    case 'monthly_second_weekday': return t('Monatlich (2. Wochentag)', 'Monthly (2nd weekday)');
    case 'monthly_third_weekday': return t('Monatlich (3. Wochentag)', 'Monthly (3rd weekday)');
    case 'monthly_fourth_weekday': return t('Monatlich (4. Wochentag)', 'Monthly (4th weekday)');
    case 'monthly_last_weekday': return t('Monatlich (letzter Wochentag)', 'Monthly (last weekday)');
    default: return String(repeat || '-');
  }
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

function Section({ title, testId, children }) {
  return (
    <div data-testid={testId} style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
      <h4 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 16, color: '#D4D4D8', marginBottom: 12 }}>{title}</h4>
      {children}
    </div>
  );
}

export default function DashboardStatsPanel({ stats, detailStats, inviteLinks = null, t, formatDate }) {
  const basic = stats?.basic || {};
  const detail = detailStats || {};
  const isDE = t('de', 'en') === 'de';
  const dayNames = isDE ? DAYS_DE : DAYS_EN;

  const ls = detail.listeningStats || {};
  const detailDays = Math.max(1, Number.parseInt(String(detail.days || detail.connectionWindowDays || 30), 10) || 30);
  const unstableStreams = Array.isArray(detail.unstableStreams) ? detail.unstableStreams : [];
  const eventInsights = detail.eventInsights && typeof detail.eventInsights === 'object' ? detail.eventInsights : null;

  // Station listening time ranking
  const stationTimeData = Object.entries(ls.stationListeningMs || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([key, ms]) => ({
      name: (ls.stationNames?.[key] || key).length > 22 ? (ls.stationNames?.[key] || key).slice(0, 20) + '..' : (ls.stationNames?.[key] || key),
      hours: Math.round(ms / 3600000 * 10) / 10,
    }));

  // Command usage ranking
  const commandData = Object.entries(ls.commands || {})
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([cmd, count]) => ({ name: `/${cmd}`, count }));

  // Daily stats trend
  const dailyData = (detail.dailyStats || []).slice().reverse().map(d => ({
    date: d.date?.slice(5) || '',
    starts: d.totalStarts || 0,
    sessions: d.totalSessions || 0,
    hours: Math.round((d.totalListeningMs || 0) / 3600000 * 10) / 10,
    peak: d.peakListeners || 0,
  }));

  // Listener timeline
  const timelineData = (detail.listenerTimeline || []).map(s => ({
    time: formatDate(s.timestamp, { hour: '2-digit', minute: '2-digit' }),
    listeners: s.listeners || 0,
  }));

  // Session history
  const sessionHistory = Array.isArray(detail.sessionHistory) ? detail.sessionHistory : [];
  const sessionTimelineData = buildSessionTimelineRows(sessionHistory, formatDate);
  const sessionQuality = buildSessionQualitySummary(sessionHistory, t);
  const setupStatus = basic.setupStatus || null;
  const nextSetupAction = buildDashboardNextSetupAction({ setupStatus, inviteLinks, t });

  // Connection health
  const connHealth = detail.connectionHealth || {};
  const connectionTimelineData = buildConnectionTimelineRows(connHealth, formatDate);
  const connectionEvents = Array.isArray(connHealth.events) ? connHealth.events : [];

  // Voice channel usage
  const channelData = buildVoiceChannelUsageRows(ls.voiceChannels, ls.voiceChannelNames);

  // Hourly heatmap data
  const hoursMap = ls.hours || {};
  const dowMap = ls.daysOfWeek || {};
  const hasAnalyticsData = (
    stationTimeData.length > 0
    || commandData.length > 0
    || dailyData.length > 0
    || timelineData.length > 0
    || sessionHistory.length > 0
    || unstableStreams.length > 0
    || Boolean(eventInsights)
    || connectionTimelineData.length > 0
    || connectionEvents.length > 0
    || channelData.length > 0
  );

  return (
    <section data-testid="dashboard-stats-detail-panel" style={{ display: 'grid', gap: 12 }}>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 10 }}>
        <div data-testid="stats-session-quality-card" style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>{t('Session-Qualitaet', 'Session quality')}</div>
          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700, color: '#F4F4F5' }}>{sessionQuality.avgListeningLabel}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#A1A1AA' }}>{t('Avg Hoerzeit pro Session', 'Avg listening per session')}</div>
          <div style={{ marginTop: 8, fontSize: 12, color: '#71717A' }}>{sessionQuality.subLabel}</div>
        </div>
        <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>{t('Laengste Session', 'Longest session')}</div>
          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700, color: '#10B981' }}>{sessionQuality.longestListeningLabel}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#A1A1AA' }}>{t('Menschliche Hoerzeit', 'Human listening time')}</div>
        </div>
        <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>{t('Hoechster Peak', 'Top peak')}</div>
          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700, color: '#8B5CF6' }}>{sessionQuality.topPeakLabel}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#A1A1AA' }}>{t('Maximale gleichzeitige Zuhoerer', 'Maximum concurrent listeners')}</div>
        </div>
        <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px 14px' }}>
          <div style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.08em', color: '#71717A' }}>{t('Avg Listener', 'Avg listeners')}</div>
          <div style={{ marginTop: 8, fontSize: 20, fontWeight: 700, color: '#06B6D4' }}>{sessionQuality.avgPeakLabel}</div>
          <div style={{ marginTop: 4, fontSize: 12, color: '#A1A1AA' }}>{t('Durchschnitt aus Session-Werten', 'Average across session values')}</div>
        </div>
      </div>

      {!hasAnalyticsData && nextSetupAction && (
        <DashboardOnboardingHint
          hint={{
            ...nextSetupAction,
            eyebrow: t('Analytics vorbereiten', 'Prepare analytics'),
            note: t(
              'Die Detail-Analytics fuellen sich, sobald der erste Stream laeuft und mindestens eine Session sauber abgeschlossen wurde.',
              'Detailed analytics start filling once the first stream runs and at least one session finishes cleanly.'
            ),
          }}
          t={t}
          dataTestId="dashboard-stats-onboarding-hint"
        />
      )}

      {!hasAnalyticsData && !nextSetupAction && (
        <div
          data-testid="dashboard-stats-empty-state"
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
            'Noch keine Detail-Analytics vorhanden. Lass ein paar Streams komplett durchlaufen, dann erscheinen hier Trends, Session-Verlaeufe und Kanalnutzung.',
            'No detailed analytics are available yet. Let a few streams finish completely and trends, session history, and channel usage will appear here.'
          )}
        </div>
      )}

      {connectionTimelineData.length > 0 && (
        <Section title={t(`Verbindungs-Trend (${detailDays} Tage)`, `Connection trend (${detailDays} days)`)} testId="stats-reliability-trend">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={connectionTimelineData}>
              <XAxis dataKey="label" tick={{ fill: '#52525B', fontSize: 10 }} />
              <YAxis tick={{ fill: '#52525B', fontSize: 10 }} width={34} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="connects" fill="#10B981" radius={[2, 2, 0, 0]} name={t('Connects', 'Connects')} />
              <Bar dataKey="reconnects" fill="#F59E0B" radius={[2, 2, 0, 0]} name="Reconnects" />
              <Bar dataKey="retries" fill="#06B6D4" radius={[2, 2, 0, 0]} name={t('Retries', 'Retries')} />
              <Bar dataKey="disconnects" fill="#A1A1AA" radius={[2, 2, 0, 0]} name={t('Disconnects', 'Disconnects')} />
              <Bar dataKey="errors" fill="#EF4444" radius={[2, 2, 0, 0]} name={t('Errors', 'Errors')} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {sessionTimelineData.length > 0 && (
        <Section title={t('Session-Timeline', 'Session timeline')} testId="stats-session-timeline">
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={sessionTimelineData}>
              <XAxis dataKey="label" tick={{ fill: '#52525B', fontSize: 10 }} />
              <YAxis tick={{ fill: '#52525B', fontSize: 10 }} width={34} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="runtimeHours" fill="#52525B" radius={[2, 2, 0, 0]} name={t('Runtime (h)', 'Runtime (h)')} />
              <Bar dataKey="listeningHours" fill="#00e5ff" radius={[2, 2, 0, 0]} name={t('Listening (h)', 'Listening (h)')} />
            </BarChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* Daily listening hours trend */}
      {dailyData.length > 0 && (
        <Section title={t(`Hörzeit-Verlauf (${detailDays} Tage)`, `Listening hours trend (${detailDays} days)`)} testId="stats-daily-hours">
          <ResponsiveContainer width="100%" height={220}>
            <AreaChart data={dailyData}>
              <defs>
                <linearGradient id="gradHours" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
                </linearGradient>
              </defs>
              <XAxis dataKey="date" tick={{ fill: '#52525B', fontSize: 10 }} />
              <YAxis tick={{ fill: '#52525B', fontSize: 10 }} width={35} />
              <Tooltip content={<CustomTooltip />} />
              <Area type="monotone" dataKey="hours" stroke="#10B981" fill="url(#gradHours)" name={t('Stunden', 'Hours')} />
              <Line type="monotone" dataKey="peak" stroke="#8B5CF6" strokeWidth={1.5} dot={false} name="Peak" />
            </AreaChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* Station listening time ranking */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(340px, 1fr))', gap: 10 }}>
        {stationTimeData.length > 0 && (
          <Section title={t('Hörzeit pro Station', 'Listening time per station')} testId="stats-station-time">
            <ResponsiveContainer width="100%" height={Math.max(180, stationTimeData.length * 30)}>
              <BarChart data={stationTimeData} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" tick={{ fill: '#52525B', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#A1A1AA', fontSize: 11 }} width={120} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="hours" fill="#F59E0B" radius={[0, 2, 2, 0]} name={t('Stunden', 'Hours')} />
              </BarChart>
            </ResponsiveContainer>
          </Section>
        )}

        {/* Command usage */}
        {commandData.length > 0 && (
          <Section title={t('Command-Nutzung', 'Command usage')} testId="stats-command-usage">
            <ResponsiveContainer width="100%" height={Math.max(180, commandData.length * 30)}>
              <BarChart data={commandData} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" tick={{ fill: '#52525B', fontSize: 10 }} />
                <YAxis type="category" dataKey="name" tick={{ fill: '#A1A1AA', fontSize: 11 }} width={80} />
                <Tooltip content={<CustomTooltip />} />
                <Bar dataKey="count" fill="#06B6D4" radius={[0, 2, 2, 0]} name={t('Aufrufe', 'Calls')} />
              </BarChart>
            </ResponsiveContainer>
          </Section>
        )}
      </div>

      {/* Listener timeline (24h) */}
      {timelineData.length > 0 && (
        <Section title={t('Zuhörer-Verlauf (24h)', 'Listener timeline (24h)')} testId="stats-listener-timeline">
          <ResponsiveContainer width="100%" height={180}>
            <LineChart data={timelineData}>
              <XAxis dataKey="time" tick={{ fill: '#52525B', fontSize: 10 }} interval={Math.max(1, Math.floor(timelineData.length / 12))} />
              <YAxis tick={{ fill: '#52525B', fontSize: 10 }} width={30} />
              <Tooltip content={<CustomTooltip />} />
              <Line type="monotone" dataKey="listeners" stroke="#00e5ff" strokeWidth={2} dot={false} name={t('Zuhörer', 'Listeners')} />
            </LineChart>
          </ResponsiveContainer>
        </Section>
      )}

      {/* Session history table */}
      {sessionHistory.length > 0 && (
        <Section title={t('Letzte Sessions', 'Recent sessions')} testId="stats-session-history">
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #1A1A2E' }}>
                  <th style={{ textAlign: 'left', padding: '8px 6px', color: '#71717A', fontWeight: 500 }}>{t('Station', 'Station')}</th>
                  <th style={{ textAlign: 'left', padding: '8px 6px', color: '#71717A', fontWeight: 500 }}>{t('Start', 'Start')}</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: '#71717A', fontWeight: 500 }}>{t('Hörzeit', 'Listening')}</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: '#71717A', fontWeight: 500 }}>{t('Dauer', 'Runtime')}</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: '#71717A', fontWeight: 500 }}>Peak</th>
                  <th style={{ textAlign: 'right', padding: '8px 6px', color: '#71717A', fontWeight: 500 }}>Avg</th>
                </tr>
              </thead>
              <tbody>
                {sessionHistory.map((s, i) => (
                  <tr key={s.id || buildSessionHistoryEntryId(s)} data-testid={`session-row-${i}`} style={{ borderBottom: '1px solid #0F0F1A' }}>
                    <td style={{ padding: '8px 6px', maxWidth: 180, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.stationName || s.stationKey || '-'}
                    </td>
                    <td style={{ padding: '8px 6px', color: '#A1A1AA' }}>
                      {s.startedAt ? formatDate(s.startedAt, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                      {formatDashboardDuration(s.humanListeningMs)}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', fontFamily: "'JetBrains Mono', monospace" }}>
                      {formatDashboardDuration(s.durationMs)}
                    </td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: '#8B5CF6' }}>{s.peakListeners ?? '-'}</td>
                    <td style={{ padding: '8px 6px', textAlign: 'right', color: '#71717A' }}>{s.avgListeners ?? '-'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* Unstable stream candidates */}
      {unstableStreams.length > 0 && (
        <Section title={t('Instabile Streams (live)', 'Unstable streams (live)')} testId="stats-unstable-streams">
          <div style={{ display: 'grid', gap: 6 }}>
            {unstableStreams.map((row, i) => (
              <div key={`${row.botId || 'bot'}-${row.stationKey || i}`} data-testid={`unstable-stream-row-${i}`} style={{
                border: '1px solid #1A1A2E',
                background: '#050505',
                padding: '8px 10px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                flexWrap: 'wrap',
              }}>
                <span style={{ fontWeight: 600 }}>
                  {row.stationName || row.stationKey || '-'}
                </span>
                <span style={{ color: '#A1A1AA', fontSize: 12 }}>
                  {row.botName || row.botId || 'Bot'} | {t('Reconnects', 'Reconnects')}: {row.reconnectAttempts ?? 0} | {t('Fehler-Streak', 'Error streak')}: {row.streamErrors ?? 0} | {t('Zuhörer', 'Listeners')}: {row.listeners ?? 0}
                </span>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* Event analytics */}
      {eventInsights && (
        <Section title={t('Event-Analytics', 'Event analytics')} testId="stats-event-analytics">
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 12 }}>
            <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px', textAlign: 'center' }}>
              <div style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('Events gesamt', 'Total events')}</div>
              <strong style={{ fontSize: 24, color: '#8B5CF6' }}>{eventInsights.configured || 0}</strong>
            </div>
            <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px', textAlign: 'center' }}>
              <div style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('Aktive Events', 'Active events')}</div>
              <strong style={{ fontSize: 24, color: '#10B981' }}>{eventInsights.active || 0}</strong>
            </div>
            <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px', textAlign: 'center' }}>
              <div style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('Nächster Run', 'Next run')}</div>
              <strong style={{ fontSize: 14, color: '#D4D4D8' }}>
                {eventInsights.nextRunAt ? formatDate(eventInsights.nextRunAt, { dateStyle: 'medium', timeStyle: 'short' }) : t('Keiner', 'None')}
              </strong>
            </div>
          </div>

          {Array.isArray(eventInsights.repeats) && eventInsights.repeats.length > 0 && (
            <div style={{ marginBottom: 12 }}>
              <div style={{ color: '#71717A', fontSize: 12, marginBottom: 6 }}>{t('Wiederholungen', 'Recurrence')}</div>
              <div style={{ display: 'grid', gap: 4 }}>
                {eventInsights.repeats.map((item, i) => (
                  <div key={`${item.repeat}-${i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span>{formatRepeatModeLabel(item.repeat, t)}</span>
                    <strong>{item.count || 0}</strong>
                  </div>
                ))}
              </div>
            </div>
          )}

          {Array.isArray(eventInsights.topStations) && eventInsights.topStations.length > 0 && (
            <div>
              <div style={{ color: '#71717A', fontSize: 12, marginBottom: 6 }}>{t('Event-Stationen (Top)', 'Top event stations')}</div>
              <div style={{ display: 'grid', gap: 4 }}>
                {eventInsights.topStations.map((row, i) => (
                  <div key={`${row.stationKey || row.stationName || i}`} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13 }}>
                    <span style={{ maxWidth: 250, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {row.stationName || row.stationKey || '-'}
                    </span>
                    <strong>
                      {row.eventCount || 0} {t('Events', 'events')} | {Math.round((Number(row.listeningMs || 0) / 60000) * 10) / 10}m
                    </strong>
                  </div>
                ))}
              </div>
            </div>
          )}
        </Section>
      )}

      {/* Connection health */}
      <Section title={t(`Verbindungsgesundheit (${detailDays} Tage)`, `Connection health (${detailDays} days)`)} testId="stats-connection-health">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: 10, marginBottom: 12 }}>
          <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px', textAlign: 'center' }}>
            <div style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('Verbindungen', 'Connects')}</div>
            <strong style={{ fontSize: 24, color: '#10B981' }}>{connHealth.connects || 0}</strong>
          </div>
          <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px', textAlign: 'center' }}>
            <div style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>Reconnects</div>
            <strong style={{ fontSize: 24, color: '#F59E0B' }}>{connHealth.reconnects || 0}</strong>
          </div>
          <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px', textAlign: 'center' }}>
            <div style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('Retries', 'Retries')}</div>
            <strong style={{ fontSize: 24, color: '#06B6D4' }}>{connHealth.retries || 0}</strong>
          </div>
          <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px', textAlign: 'center' }}>
            <div style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('Disconnects', 'Disconnects')}</div>
            <strong style={{ fontSize: 24, color: '#A1A1AA' }}>{connHealth.disconnects || 0}</strong>
          </div>
          <div style={{ background: '#050505', border: '1px solid #1A1A2E', padding: '12px', textAlign: 'center' }}>
            <div style={{ color: '#71717A', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{t('Fehler', 'Errors')}</div>
            <strong style={{ fontSize: 24, color: '#EF4444' }}>{connHealth.errors || 0}</strong>
          </div>
        </div>
        {(connHealth.events || []).length > 0 && (
          <div style={{ maxHeight: 200, overflowY: 'auto' }}>
            {connHealth.events.slice(0, 20).map((ev, i) => (
              <div key={ev.id || buildConnectionEventEntryId(ev)} data-testid={`conn-event-${i}`} style={{
                padding: '6px 8px', borderBottom: '1px solid #0F0F1A', fontSize: 12, display: 'flex', gap: 10,
              }}>
                <span style={{
                  color: ev.eventType === 'connect'
                    ? '#10B981'
                    : ev.eventType === 'reconnect'
                      ? '#F59E0B'
                      : ev.eventType === 'retry'
                        ? '#06B6D4'
                        : ev.eventType === 'disconnect'
                          ? '#A1A1AA'
                          : '#EF4444',
                  minWidth: 80, fontFamily: "'JetBrains Mono', monospace",
                }}>
                  {ev.eventType}
                </span>
                <span style={{ color: '#71717A' }}>
                  {ev.timestamp ? formatDate(ev.timestamp, { dateStyle: 'medium', timeStyle: 'short' }) : '-'}
                </span>
                {(ev.botId || ev.channelId) && (
                  <span style={{ color: '#A1A1AA' }}>
                    {[ev.botId ? `bot=${ev.botId}` : '', ev.channelId ? `channel=${ev.channelId}` : ''].filter(Boolean).join(' ')}
                  </span>
                )}
                {ev.details && <span style={{ color: '#52525B' }}>{ev.details}</span>}
              </div>
            ))}
          </div>
        )}
      </Section>

      {/* Voice channel usage */}
      {channelData.length > 0 && (
        <Section title={t('Voice-Channel-Nutzung', 'Voice channel usage')} testId="stats-channel-usage">
          <div style={{ display: 'grid', gap: 4 }}>
            {channelData.map((ch, i) => {
              const maxCount = channelData[0]?.count || 1;
              const pct = Math.round((ch.count / maxCount) * 100);
              return (
                <div key={ch.id} data-testid={`channel-row-${i}`} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ minWidth: 180, fontSize: 13, color: '#A1A1AA', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {ch.name}
                  </span>
                  <div style={{ flex: 1, height: 16, background: '#0F0F1A', position: 'relative' }}>
                    <div style={{ width: `${pct}%`, height: '100%', background: '#5865F2', transition: 'width 0.3s' }} />
                  </div>
                  <span style={{ minWidth: 40, textAlign: 'right', fontSize: 12, fontFamily: "'JetBrains Mono', monospace" }}>{ch.count}</span>
                </div>
              );
            })}
          </div>
        </Section>
      )}

      <style>{`
        @media (max-width: 768px) {
          [data-testid='dashboard-stats-detail-panel'] > div { grid-template-columns: 1fr !important; }
        }
      `}</style>
    </section>
  );
}
