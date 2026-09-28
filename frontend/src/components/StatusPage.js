import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, HelpCircle, Wrench, XCircle } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { buildApiUrl } from '../lib/api.js';

// The public status page (#299): is OmniFM itself running? Every bot with its
// availability over 90 days, current problems, planned maintenance and the
// incidents of the last 14 days, from GET /api/status (measured every
// minute). Nothing about a single server; that is /status in the bot.

const REFRESH_MS = 60_000;
const SUPPORT_URL = 'https://discord.gg/UeRkfGS43R';
const NARROW_DAYS = 30;

// Status colours; each one comes with an icon or a text, never alone.
export const TONES = {
  good: '#22c55e',
  warning: '#eab308',
  serious: '#f97316',
  critical: '#ef4444',
  maintenance: '#60a5fa',
  none: '#52525b',
};

const OVERALL = {
  operational: { tone: 'good', Icon: CheckCircle2 },
  minor: { tone: 'warning', Icon: AlertTriangle },
  major: { tone: 'critical', Icon: XCircle },
  maintenance: { tone: 'maintenance', Icon: Wrench },
  unknown: { tone: 'none', Icon: HelpCircle },
};

/** The colour step of a day: from 99.9 % good, then 99 and 95, below that critical; null is not measured. */
export function dayTone(uptime) {
  if (uptime === null || uptime === undefined) return 'none';
  if (uptime >= 99.9) return 'good';
  if (uptime >= 99) return 'warning';
  if (uptime >= 95) return 'serious';
  return 'critical';
}

function useFormatters(intlLocale, s) {
  return useMemo(() => {
    const pct = new Intl.NumberFormat(intlLocale, { style: 'percent', minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const dateTime = new Intl.DateTimeFormat(intlLocale, { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    const time = new Intl.DateTimeFormat(intlLocale, { hour: '2-digit', minute: '2-digit' });
    // A day key is a calendar day already; formatted in UTC it stays that day.
    const day = new Intl.DateTimeFormat(intlLocale, { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
    const duration = (minutes) => {
      const whole = Math.max(1, Math.round(minutes));
      const hours = Math.floor(whole / 60);
      const rest = whole % 60;
      if (!hours) return s.minutes({ count: whole });
      return rest ? `${s.hours({ count: hours })} ${s.minutes({ count: rest })}` : s.hours({ count: hours });
    };
    return {
      percent: (value) => pct.format(Number(value) / 100),
      dateTime: (iso) => dateTime.format(new Date(iso)),
      time: (iso) => time.format(new Date(iso)),
      day: (key) => day.format(new Date(`${key}T12:00:00Z`)),
      duration,
      span: (from, to) => duration((Date.parse(to) - Date.parse(from)) / 60_000),
      // "28.09.2026, 08:00 bis 08:30" when both ends are on the same day.
      window: (from, to) => {
        const sameDay = new Date(from).toDateString() === new Date(to).toDateString();
        return s.window({ from: dateTime.format(new Date(from)), to: sameDay ? time.format(new Date(to)) : dateTime.format(new Date(to)) });
      },
    };
  }, [intlLocale, s]);
}

const card = {
  padding: '22px 22px',
  borderRadius: 20,
  background: 'rgba(255,255,255,0.03)',
  border: '1px solid rgba(255,255,255,0.08)',
};

const sectionTitle = {
  margin: '0 0 12px',
  fontSize: 12,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: '#A1A1AA',
  fontFamily: "'JetBrains Mono', monospace",
};

function Chip({ tone, children }) {
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6, padding: '3px 10px', borderRadius: 999,
      fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase',
      color: TONES[tone] || '#A1A1AA', background: 'rgba(255,255,255,0.04)', border: `1px solid ${TONES[tone] || 'rgba(255,255,255,0.12)'}55`,
    }}
    >
      {children}
    </span>
  );
}

function NoticeCard({ tone, Icon, kind, title, message, meta, testId }) {
  return (
    <div data-testid={testId} style={{ ...card, borderLeft: `3px solid ${TONES[tone]}`, display: 'flex', gap: 14 }}>
      <Icon size={20} color={TONES[tone]} style={{ flexShrink: 0, marginTop: 2 }} aria-hidden="true" />
      <div style={{ minWidth: 0 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8, marginBottom: 6 }}>
          <Chip tone={tone}>{kind}</Chip>
          <span style={{ color: '#71717A', fontSize: 13 }}>{meta}</span>
        </div>
        <div style={{ fontWeight: 700, color: '#F4F4F5', fontSize: 16 }}>{title}</div>
        {message ? <p style={{ margin: '6px 0 0', color: '#A1A1AA', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{message}</p> : null}
      </div>
    </div>
  );
}

function UptimeBars({ bot, s, fmt }) {
  const [active, setActive] = useState(null);
  const days = bot.days || [];
  const bad = days.filter((day) => day.uptime !== null && day.uptime < 99.9);
  const summary = s.barsLabel({
    bot: bot.name,
    value: bot.uptime === null ? s.noUptime : fmt.percent(bot.uptime),
    bad: bad.slice(-10).map((day) => `${fmt.day(day.day)} (${fmt.percent(day.uptime)})`).join(', '),
  });
  const shown = active === null ? null : days[active];
  const move = (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const from = active === null ? days.length - 1 : active;
    setActive(Math.min(days.length - 1, Math.max(0, from + (event.key === 'ArrowLeft' ? -1 : 1))));
  };

  return (
    <div>
      <div
        role="img"
        aria-label={summary}
        tabIndex={0}
        onKeyDown={move}
        onFocus={() => setActive(days.length - 1)}
        onBlur={() => setActive(null)}
        onMouseLeave={() => setActive(null)}
        data-testid={`status-bars-${bot.key}`}
        style={{ display: 'flex', gap: 2, height: 34, outlineOffset: 4 }}
      >
        {days.map((day, index) => {
          const tone = dayTone(day.uptime);
          return (
            <span
              key={day.day}
              data-tone={tone}
              className={index < days.length - NARROW_DAYS ? 'status-bar-old' : undefined}
              onMouseEnter={() => setActive(index)}
              onClick={() => setActive(index === active ? null : index)}
              style={{
                flex: 1,
                minWidth: 2,
                borderRadius: 4,
                boxSizing: 'border-box',
                background: tone === 'none' ? 'transparent' : TONES[tone],
                border: tone === 'none' ? `1px dashed ${TONES.none}` : 'none',
                opacity: active === null || active === index ? 1 : 0.45,
              }}
            />
          );
        })}
      </div>
      <div aria-live="polite" style={{ display: 'flex', justifyContent: 'space-between', gap: 12, marginTop: 8, fontSize: 12, color: '#71717A', minHeight: 18 }}>
        {shown ? (
          <span data-testid={`status-day-${bot.key}`} style={{ color: '#D4D4D8' }}>
            {s.dayTooltip({
              day: fmt.day(shown.day),
              value: shown.uptime === null ? '' : fmt.percent(shown.uptime),
              down: shown.down ? fmt.duration(shown.down) : '',
            })}
          </span>
        ) : (
          <>
            <span className="status-axis-wide">{s.daysAgo({ count: days.length })}</span>
            <span className="status-axis-narrow">{s.daysAgo({ count: Math.min(NARROW_DAYS, days.length) })}</span>
            <span>{s.today}</span>
          </>
        )}
      </div>
    </div>
  );
}

function BotRow({ bot, s, fmt }) {
  const state = bot.online ? s.online : (bot.offlineSince ? s.offlineSince({ time: fmt.time(bot.offlineSince) }) : s.offline);
  const tier = String(bot.tier || 'free');
  return (
    <div data-testid={`status-bot-${bot.key}`} style={{ padding: '16px 0', borderTop: '1px solid rgba(255,255,255,0.06)' }}>
      <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginBottom: 10 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, minWidth: 0 }}>
          <span style={{ fontWeight: 700, color: '#F4F4F5' }}>{bot.name}</span>
          <span style={{ color: '#71717A', fontSize: 12 }}>
            {s.roles[bot.role] || bot.role} · {tier.charAt(0).toUpperCase() + tier.slice(1)}
          </span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, fontSize: 13 }}>
          <span data-testid={`status-bot-state-${bot.key}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: bot.online ? TONES.good : TONES.critical }}>
            {bot.online ? <CheckCircle2 size={14} aria-hidden="true" /> : <XCircle size={14} aria-hidden="true" />}
            {state}
          </span>
          <span style={{ color: '#A1A1AA' }}>{bot.uptime === null ? s.noUptime : s.uptime90({ value: fmt.percent(bot.uptime) })}</span>
        </div>
      </div>
      <UptimeBars bot={bot} s={s} fmt={fmt} />
    </div>
  );
}

function Legend({ s }) {
  return (
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px 16px', marginTop: 14, fontSize: 12, color: '#A1A1AA' }}>
      {['good', 'warning', 'serious', 'critical', 'none'].map((tone) => (
        <span key={tone} style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 10, height: 10, borderRadius: 3, boxSizing: 'border-box',
            background: tone === 'none' ? 'transparent' : TONES[tone],
            border: tone === 'none' ? `1px dashed ${TONES.none}` : 'none',
          }}
          />
          {s.legend[tone]}
        </span>
      ))}
    </div>
  );
}

export default function StatusPage() {
  const { copy, localeMeta } = useI18n();
  const s = copy.statusPage;
  const fmt = useFormatters(localeMeta?.intl || 'de-DE', s);
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const res = await fetch(buildApiUrl('/api/status'), { cache: 'no-store' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const body = await res.json();
        if (!cancelled) { setData(body); setFailed(false); }
      } catch {
        if (!cancelled) setFailed(true);
      }
    };
    load();
    const timer = setInterval(load, REFRESH_MS);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);

  const overall = OVERALL[data?.overall] || OVERALL.unknown;
  const overallKey = OVERALL[data?.overall] ? data.overall : 'unknown';
  const OverallIcon = overall.Icon;

  return (
    <section data-testid="status-page" style={{ position: 'relative', padding: '110px 24px 40px' }}>
      <style>{`
        .status-axis-narrow { display: none; }
        @media (max-width: 640px) {
          .status-bar-old, .status-axis-wide { display: none; }
          .status-axis-narrow { display: inline; }
        }
      `}</style>
      <div className="section-container" style={{ position: 'relative', zIndex: 2, maxWidth: 920 }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ ...sectionTitle, color: '#00e5ff', marginBottom: 14 }}>{s.eyebrow}</div>
          <h1 style={{ margin: '0 0 12px', fontFamily: "'Syne', sans-serif", fontSize: 'clamp(30px, 4vw, 44px)', lineHeight: 1.08 }}>{s.title}</h1>
          <p style={{ margin: 0, color: '#A1A1AA', fontSize: 16, lineHeight: 1.7, maxWidth: 680 }}>{s.subtitle}</p>
        </div>

        {failed && !data ? (
          <div data-testid="status-unreachable" style={{ ...card, borderLeft: `3px solid ${TONES.warning}`, color: '#D4D4D8', lineHeight: 1.6 }}>
            {s.unreachable}{' '}
            <a href={SUPPORT_URL} target="_blank" rel="noopener noreferrer" style={{ color: '#00e5ff' }}>{s.support}</a>
          </div>
        ) : (
          <div data-testid="status-content" aria-busy={!data} style={{ display: 'grid', gap: 18 }}>
            <div data-testid="status-overall" data-overall={overallKey} style={{ ...card, display: 'flex', alignItems: 'center', gap: 14, borderLeft: `3px solid ${TONES[overall.tone]}` }}>
              <OverallIcon size={28} color={TONES[overall.tone]} aria-hidden="true" />
              <div>
                <div style={{ fontWeight: 800, fontSize: 20, color: '#F4F4F5' }}>{data ? s.overall[overallKey] : '…'}</div>
                {data ? <div style={{ color: '#A1A1AA', fontSize: 14, marginTop: 2 }}>{s.overallHint[overallKey]}</div> : null}
              </div>
            </div>

            {data?.current?.length ? (
              <div>
                <h2 style={sectionTitle}>{s.currentTitle}</h2>
                <div style={{ display: 'grid', gap: 10 }}>
                  {data.current.map((entry) => (entry.type === 'outage' ? (
                    <NoticeCard key={`outage-${entry.bot}`} testId="status-current-outage" tone="critical" Icon={XCircle}
                      kind={s.kinds.outage} title={s.outageTitle({ bot: entry.bot })} meta={s.since({ time: fmt.dateTime(entry.since) })} />
                  ) : (
                    <NoticeCard key={entry.id} testId="status-current-incident" tone={entry.impact === 'major' ? 'critical' : 'warning'} Icon={AlertTriangle}
                      kind={`${s.kinds.incident} · ${s.impact[entry.impact] || s.impact.minor}`} title={entry.title} message={entry.message}
                      meta={s.since({ time: fmt.dateTime(entry.since) })} />
                  )))}
                </div>
              </div>
            ) : null}

            {data?.maintenance?.length ? (
              <div>
                <h2 style={sectionTitle}>{s.maintenanceTitle}</h2>
                <div style={{ display: 'grid', gap: 10 }}>
                  {data.maintenance.map((entry) => (
                    <NoticeCard key={entry.id} testId="status-maintenance" tone="maintenance" Icon={Wrench}
                      kind={`${s.kinds.maintenance} · ${entry.active ? s.running : s.planned}`} title={entry.title} message={entry.message}
                      meta={fmt.window(entry.startsAt, entry.endsAt)} />
                  ))}
                </div>
              </div>
            ) : null}

            {data?.bots?.length ? (
              <div style={card}>
                <h2 style={{ ...sectionTitle, marginBottom: 4 }}>{s.botsTitle}</h2>
                {data.bots.map((bot) => <BotRow key={bot.key} bot={bot} s={s} fmt={fmt} />)}
                <Legend s={s} />
              </div>
            ) : null}

            {data ? (
              <div>
                <h2 style={sectionTitle}>{s.historyTitle}</h2>
                {data.history?.length ? (
                  <ul data-testid="status-history" style={{ ...card, listStyle: 'none', margin: 0, display: 'grid', gap: 12 }}>
                    {data.history.map((entry) => (
                      <li key={`${entry.type}-${entry.startedAt}-${entry.id || entry.bot}`} style={{ display: 'grid', gap: 4 }}>
                        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 8 }}>
                          <Chip tone={entry.type === 'maintenance' ? 'maintenance' : (entry.type === 'outage' || entry.impact === 'major' ? 'critical' : 'warning')}>{s.kinds[entry.type]}</Chip>
                          <span style={{ fontWeight: 700, color: '#F4F4F5' }}>{entry.type === 'outage' ? s.outageTitle({ bot: entry.bot }) : entry.title}</span>
                        </div>
                        <span style={{ color: '#71717A', fontSize: 13 }}>
                          {fmt.window(entry.startedAt, entry.endedAt)} · {s.duration({ text: fmt.span(entry.startedAt, entry.endedAt) })}
                        </span>
                        {entry.message ? <span style={{ color: '#A1A1AA', fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{entry.message}</span> : null}
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p style={{ margin: 0, color: '#A1A1AA', fontSize: 14 }}>{s.noHistory}</p>
                )}
              </div>
            ) : null}

            {data ? (
              <p style={{ margin: 0, color: '#71717A', fontSize: 12, lineHeight: 1.6 }}>
                {s.note} {data.generatedAt ? s.updated({ time: fmt.time(data.generatedAt) }) : null}
              </p>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}
