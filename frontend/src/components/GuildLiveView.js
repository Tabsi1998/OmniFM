import { useCallback, useEffect, useState, useRef } from 'react';
import { Activity, RefreshCw, RotateCcw, Unplug } from 'lucide-react';

// The live view of a server (#304): every bot's playback over the last 24
// hours as a timeline (plays, connects, recovers, parked), where it stands
// now, the last changes, and two buttons for when it hangs. Refreshes every
// 15 seconds while the overview is open.

// The day's timeline changes slowly; what plays now arrives with the overview's live messages (#502).
const REFRESH_MS = 60_000;

// Status colours; each phase also has its name in the legend and the tooltip.
export const PHASE_COLORS = {
  playing: '#22c55e',
  starting: '#60a5fa',
  connecting: '#60a5fa',
  recovering: '#f59e0b',
  parked: '#ef4444',
  paused: '#64748b',
  idle: 'transparent',
};

export function phaseLabel(phase, t) {
  return {
    playing: t('läuft', 'playing'),
    starting: t('startet', 'starting'),
    connecting: t('verbindet', 'connecting'),
    recovering: t('stellt wieder her', 'recovering'),
    parked: t('pausiert nach Fehlern', 'parked after errors'),
    paused: t('pausiert', 'paused'),
    idle: t('aus', 'off'),
  }[phase] || phase;
}

function clock(iso, locale) {
  return new Date(iso).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
}

function Timeline({ bot, windowStart, windowEnd, t, locale }) {
  const start = Date.parse(windowStart);
  const span = Math.max(1, Date.parse(windowEnd) - start);
  return (
    <div
      role="img"
      aria-label={t('Verlauf von {bot} in den letzten 24 Stunden', '{bot} over the last 24 hours', { bot: bot.botName })}
      data-testid={`live-timeline-${bot.botId}`}
      style={{ position: 'relative', height: 22, borderRadius: 6, background: 'rgba(255,255,255,0.04)', border: '1px solid #20283b', overflow: 'hidden' }}
    >
      {bot.segments.filter((segment) => segment.phase !== 'idle').map((segment) => {
        const left = ((Date.parse(segment.from) - start) / span) * 100;
        const width = Math.max(0.25, ((Date.parse(segment.to) - Date.parse(segment.from)) / span) * 100);
        const title = `${clock(segment.from, locale)}–${clock(segment.to, locale)} · ${phaseLabel(segment.phase, t)}${segment.station ? ` · ${segment.station}` : ''}${segment.failover ? ` · ${t('Ersatzsender', 'backup station')}` : ''}`;
        return (
          <span
            key={`${segment.from}-${segment.phase}`}
            title={title}
            data-phase={segment.phase}
            style={{
              position: 'absolute', top: 0, bottom: 0, left: `${left}%`, width: `${width}%`,
              background: segment.failover
                ? `repeating-linear-gradient(135deg, ${PHASE_COLORS[segment.phase]} 0 6px, rgba(0,0,0,0.35) 6px 9px)`
                : PHASE_COLORS[segment.phase],
            }}
          />
        );
      })}
    </div>
  );
}

export default function GuildLiveView({ apiRequest, guildId, t, locale = 'de-DE', liveTick = 0 }) {
  const [view, setView] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [notice, setNotice] = useState(null);

  const load = useCallback(async () => {
    try {
      setView(await apiRequest(`/api/dashboard/playback?serverId=${encodeURIComponent(guildId)}`));
      setError('');
    } catch (err) {
      setError(err?.message || t('Live-Ansicht nicht erreichbar.', 'Live view unreachable.'));
    }
  }, [apiRequest, guildId, t]);

  useEffect(() => {
    load();
    const timer = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState !== 'hidden') load();
    }, REFRESH_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Something changed on the server: the view follows a moment later, once
  // per burst; not for the messages it saw before it opened.
  const seenTick = useRef(liveTick);
  useEffect(() => {
    if (liveTick === seenTick.current) return undefined;
    seenTick.current = liveTick;
    const timer = setTimeout(load, 1000);
    return () => clearTimeout(timer);
  }, [liveTick, load]);

  const act = async (bot, action) => {
    setBusy(`${bot.botId}:${action}`);
    setNotice(null);
    try {
      await apiRequest(`/api/dashboard/playback/${action}`, { method: 'POST', body: JSON.stringify({ serverId: guildId, botId: bot.botId }) });
      setNotice({ ok: true, text: action === 'restart'
        ? t('{bot} startet den Sender neu.', '{bot} restarts the station.', { bot: bot.botName })
        : t('{bot} verbindet sich neu.', '{bot} reconnects.', { bot: bot.botName }) });
      setTimeout(load, 3000);
    } catch (err) {
      setNotice({ ok: false, text: err?.message || String(err) });
    } finally {
      setBusy('');
    }
  };

  const bots = view?.bots || [];
  return (
    <div className="oa-card oa-fade" style={{ marginTop: 18 }} data-testid="guild-live-view">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 12, flexWrap: 'wrap' }}>
        <div className="oa-stat-label" style={{ display: 'flex', alignItems: 'center', gap: 8 }}><Activity size={14} /> {t('Live-Ansicht · letzte 24 Stunden', 'Live view · last 24 hours')}</div>
        <button className="oa-btn ghost" style={{ height: 32, padding: '0 10px', fontSize: 12 }} onClick={load} aria-label={t('Aktualisieren', 'Refresh')}><RefreshCw size={13} /></button>
      </div>
      {notice && <div className={`oa-pill ${notice.ok ? 'green' : 'red'}`} style={{ marginBottom: 12 }} data-testid="live-view-notice">{notice.text}</div>}
      {error && !view ? <div className="oa-sub">{error}</div> : null}
      {view && !bots.length ? <div className="oa-sub" data-testid="live-view-empty">{t('In den letzten 24 Stunden lief hier nichts.', 'Nothing played here in the last 24 hours.')}</div> : null}
      <div style={{ display: 'grid', gap: 16 }}>
        {bots.map((bot) => {
          const current = bot.current || { phase: 'idle' };
          const active = current.phase !== 'idle';
          return (
            <div key={bot.botId} data-testid={`live-bot-${bot.botId}`}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700 }}>{bot.botName}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    <span style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 99, marginRight: 6, background: active ? PHASE_COLORS[current.phase] : '#475569' }} />
                    {phaseLabel(current.phase, t)}{current.station ? ` · ${current.station}` : ''} · {t('seit', 'since')} {clock(current.since, locale)}
                    {current.failover ? ` · ${t('Ersatzsender', 'backup station')}` : ''}
                  </div>
                </div>
                {active ? (
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="oa-btn ghost" style={{ height: 32, padding: '0 10px', fontSize: 12 }} disabled={Boolean(busy)} onClick={() => act(bot, 'restart')} data-testid={`live-restart-${bot.botId}`}><RotateCcw size={13} /> {t('Sender neu starten', 'Restart station')}</button>
                    <button className="oa-btn ghost" style={{ height: 32, padding: '0 10px', fontSize: 12 }} disabled={Boolean(busy)} onClick={() => act(bot, 'reconnect')} data-testid={`live-reconnect-${bot.botId}`}><Unplug size={13} /> {t('Neu verbinden', 'Reconnect')}</button>
                  </div>
                ) : null}
              </div>
              <Timeline bot={bot} windowStart={view.windowStart} windowEnd={view.windowEnd} t={t} locale={locale} />
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10.5, color: '#8190a8', marginTop: 4 }} className="oa-mono">
                <span>{t('vor 24 h', '24 h ago')}</span><span>{t('vor 12 h', '12 h ago')}</span><span>{t('jetzt', 'now')}</span>
              </div>
              {bot.events.length ? (
                <details style={{ marginTop: 6 }}>
                  <summary style={{ cursor: 'pointer', fontSize: 12, color: '#94a3b8' }}>{t('Letzte Änderungen ({count})', 'Last changes ({count})', { count: bot.events.length })}</summary>
                  <ul style={{ listStyle: 'none', margin: '8px 0 0', padding: 0, display: 'grid', gap: 4, fontSize: 12 }}>
                    {bot.events.map((event) => (
                      <li key={`${event.at}-${event.phase}`} style={{ color: event.unexpected ? '#fbbf24' : '#cbd5e1' }}>
                        <span className="oa-mono" style={{ color: '#8190a8' }}>{clock(event.at, locale)}</span>{' '}
                        {phaseLabel(event.from, t)} → {phaseLabel(event.phase, t)}{event.station ? ` · ${event.station}` : ''}
                        {event.reason ? <span className="oa-mono" style={{ color: '#8190a8' }}> ({event.reason})</span> : null}
                        {event.unexpected ? ` · ${t('unerwartet', 'unexpected')}` : ''}
                      </li>
                    ))}
                  </ul>
                </details>
              ) : null}
            </div>
          );
        })}
      </div>
      {bots.length ? (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', marginTop: 14, fontSize: 11.5, color: '#94a3b8' }}>
          {['playing', 'starting', 'recovering', 'parked', 'paused'].map((phase) => (
            <span key={phase} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={{ width: 10, height: 10, borderRadius: 3, background: PHASE_COLORS[phase] }} />{phaseLabel(phase, t)}
            </span>
          ))}
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <span style={{ width: 10, height: 10, borderRadius: 3, background: `repeating-linear-gradient(135deg, ${PHASE_COLORS.playing} 0 3px, rgba(0,0,0,0.35) 3px 5px)` }} />{t('Ersatzsender', 'backup station')}
          </span>
        </div>
      ) : null}
    </div>
  );
}
