import { useEffect, useMemo, useState } from 'react';
import { Music } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { buildApiUrl } from '../lib/api.js';

// The OmniFM charts (#300): the most played songs of last week across every
// server, from GET /api/charts. A song is only there when it ran on at least
// `minServers` servers; the page shows no server and no person.

const MOVEMENT_COLORS = { new: '#00e5ff', up: '#22c55e', down: '#ef4444', same: '#71717A' };

/** "Artist - Title" as title and artist; without a dash all of it is the title. */
export function splitTitle(displayTitle = '') {
  const text = String(displayTitle || '').trim();
  const at = text.indexOf(' - ');
  return at > 0 ? { artist: text.slice(0, at).trim(), title: text.slice(at + 3).trim() } : { artist: '', title: text };
}

function Movement({ entry, s }) {
  const steps = entry.previousRank ? Math.abs(entry.previousRank - entry.rank) : 0;
  const label = entry.movement === 'new' ? s.movement.new
    : entry.movement === 'same' ? s.movement.same
      : s.movement[entry.movement]({ steps });
  const symbol = entry.movement === 'new' ? s.movement.new
    : entry.movement === 'up' ? `▲ ${steps}` : entry.movement === 'down' ? `▼ ${steps}` : '–';
  return (
    <span
      title={label}
      aria-label={label}
      data-movement={entry.movement}
      style={{
        minWidth: 44, textAlign: 'center', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em',
        color: MOVEMENT_COLORS[entry.movement] || '#71717A', fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {symbol}
    </span>
  );
}

function ChartRow({ entry, s, formatNumber }) {
  const { artist, title } = splitTitle(entry.displayTitle);
  const top = entry.rank <= 3;
  return (
    <li
      data-testid={`charts-entry-${entry.rank}`}
      style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '12px 16px', borderRadius: 16, minWidth: 0,
        background: top ? 'rgba(0,229,255,0.05)' : 'rgba(255,255,255,0.03)',
        border: `1px solid ${top ? 'rgba(0,229,255,0.18)' : 'rgba(255,255,255,0.07)'}`,
      }}
    >
      <span style={{ width: 34, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: top ? 24 : 18, fontWeight: 800, color: top ? '#00e5ff' : '#A1A1AA' }}>
        {entry.rank}
      </span>
      <Movement entry={entry} s={s} />
      {entry.cover ? (
        <img src={entry.cover} alt={s.coverAlt({ title: entry.displayTitle })} width={52} height={52} loading="lazy"
          style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />
      ) : (
        <span aria-hidden="true" style={{ width: 52, height: 52, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', background: 'rgba(255,255,255,0.05)' }}>
          <Music size={20} color="#52525B" />
        </span>
      )}
      <div style={{ minWidth: 0, flex: 1 }}>
        {/* Titles wrap on a phone instead of losing their end; the numbers keep their own line. */}
        <div style={{ fontWeight: 700, color: '#F4F4F5', overflowWrap: 'anywhere', lineHeight: 1.3 }}>{title}</div>
        {artist ? <div style={{ color: '#D4D4D8', fontSize: 13, overflowWrap: 'anywhere' }}>{artist}</div> : null}
        <div style={{ color: '#71717A', fontSize: 12, marginTop: 2 }}>
          {s.plays({ count: formatNumber(entry.plays) })} · {s.servers({ count: formatNumber(entry.servers) })}
        </div>
      </div>
    </li>
  );
}

export default function ChartsPage() {
  const { copy, formatNumber, localeMeta } = useI18n();
  const s = copy.chartsPage;
  const [data, setData] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(buildApiUrl('/api/charts'), { cache: 'no-store' })
      .then((res) => { if (!res.ok) throw new Error(`HTTP ${res.status}`); return res.json(); })
      .then((body) => { if (!cancelled) setData(body); })
      .catch(() => { if (!cancelled) setFailed(true); });
    return () => { cancelled = true; };
  }, []);

  const weekLabel = useMemo(() => {
    if (!data?.week?.start) return '';
    const day = new Intl.DateTimeFormat(localeMeta?.intl || 'de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'UTC' });
    const last = new Date(Date.parse(data.week.end) - 86_400_000);
    return s.week({ week: data.week.week, from: day.format(new Date(data.week.start)), to: day.format(last) });
  }, [data, localeMeta, s]);

  const entries = Array.isArray(data?.entries) ? data.entries : [];

  return (
    <section data-testid="charts-page" style={{ position: 'relative', padding: '110px 24px 40px' }}>
      <div className="section-container" style={{ position: 'relative', zIndex: 2, maxWidth: 820 }}>
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: '#00e5ff', fontFamily: "'JetBrains Mono', monospace", marginBottom: 14 }}>
            {s.eyebrow}
          </div>
          <h1 style={{ margin: '0 0 12px', fontFamily: "'Syne', sans-serif", fontSize: 'clamp(30px, 4vw, 44px)', lineHeight: 1.08 }}>{s.title}</h1>
          <p style={{ margin: 0, color: '#A1A1AA', fontSize: 16, lineHeight: 1.7 }}>{s.subtitle}</p>
          {weekLabel ? <p data-testid="charts-week" style={{ margin: '10px 0 0', color: '#D4D4D8', fontWeight: 700 }}>{weekLabel}</p> : null}
        </div>

        {failed && !data ? (
          <p data-testid="charts-unreachable" style={{ color: '#D4D4D8' }}>{s.unreachable}</p>
        ) : (
          <div data-testid="charts-content" aria-busy={!data}>
            {data && !data.measuring ? <p style={{ color: '#A1A1AA' }}>{s.notMeasuring}</p> : null}
            {data?.measuring && !entries.length ? <p data-testid="charts-empty" style={{ color: '#A1A1AA' }}>{s.empty}</p> : null}
            {entries.length ? (
              <ol data-testid="charts-list" style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 }}>
                {entries.map((entry) => <ChartRow key={entry.rank} entry={entry} s={s} formatNumber={formatNumber} />)}
              </ol>
            ) : null}
            {data ? <p style={{ margin: '20px 0 0', color: '#71717A', fontSize: 12, lineHeight: 1.6 }}>{s.note({ min: data.minServers || 3 })}</p> : null}
          </div>
        )}
      </div>
    </section>
  );
}
