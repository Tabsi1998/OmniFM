import { useEffect, useMemo, useState } from 'react';
import { Music, Pause, Play, Radio } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { buildApiUrl } from '../lib/api.js';
import { usePlayer } from '../lib/player.js';

// The OmniFM charts (#300): the most listened stations and the most played
// songs of last week across every server, from GET /api/charts. Only what ran
// on at least `minServers` servers is there; the page shows no server and no
// person. A station can be heard right here, like in the station browser.

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
        minWidth: 40, textAlign: 'center', fontSize: 11, fontWeight: 800, letterSpacing: '0.04em', flexShrink: 0,
        color: MOVEMENT_COLORS[entry.movement] || '#71717A', fontFamily: "'JetBrains Mono', monospace",
      }}
    >
      {symbol}
    </span>
  );
}

function rowStyle(top) {
  return {
    display: 'flex', alignItems: 'center', gap: 12, padding: '12px 14px', borderRadius: 16, minWidth: 0,
    background: top ? 'rgba(0,229,255,0.05)' : 'rgba(255,255,255,0.03)',
    border: `1px solid ${top ? 'rgba(0,229,255,0.18)' : 'rgba(255,255,255,0.07)'}`,
  };
}

function Rank({ rank }) {
  const top = rank <= 3;
  return (
    <span style={{ width: 30, flexShrink: 0, textAlign: 'right', fontFamily: "'JetBrains Mono', monospace", fontSize: top ? 24 : 18, fontWeight: 800, color: top ? '#00e5ff' : '#A1A1AA' }}>
      {rank}
    </span>
  );
}

function Artwork({ src, alt, color, Icon }) {
  if (src) {
    return <img src={src} alt={alt} width={52} height={52} loading="lazy" style={{ width: 52, height: 52, borderRadius: 10, objectFit: 'cover', flexShrink: 0 }} />;
  }
  return (
    <span aria-hidden="true" style={{ width: 52, height: 52, borderRadius: 10, flexShrink: 0, display: 'grid', placeItems: 'center', background: color ? `${color}22` : 'rgba(255,255,255,0.05)', border: color ? `1px solid ${color}44` : 'none' }}>
      <Icon size={20} color={color || '#52525B'} />
    </span>
  );
}

function StationRow({ entry, s, formatNumber, player }) {
  const playing = Boolean(player.playing && player.current?.key === entry.key);
  const hours = formatNumber(entry.hours);
  return (
    <li data-testid={`charts-station-${entry.rank}`} style={rowStyle(entry.rank <= 3)}>
      <Rank rank={entry.rank} />
      <Movement entry={entry} s={s} />
      <Artwork src={entry.logo} alt={s.logoAlt({ name: entry.name })} color={entry.color} Icon={Radio} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontWeight: 700, color: '#F4F4F5', overflowWrap: 'anywhere', lineHeight: 1.3 }}>{entry.name}</div>
        {entry.genre ? <div style={{ color: '#D4D4D8', fontSize: 13 }}>{entry.genre}</div> : null}
        <div style={{ color: '#71717A', fontSize: 12, marginTop: 2 }}>
          {s.hours({ count: hours })} · {s.servers({ count: formatNumber(entry.servers) })}
        </div>
      </div>
      {entry.url ? (
        <button
          type="button"
          onClick={() => player.play(entry)}
          aria-label={playing ? s.pause({ name: entry.name }) : s.listen({ name: entry.name })}
          aria-pressed={playing}
          data-testid={`charts-listen-${entry.key}`}
          style={{
            flexShrink: 0, width: 40, height: 40, borderRadius: 999, display: 'grid', placeItems: 'center', cursor: 'pointer',
            background: playing ? (entry.color || '#00e5ff') : 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
          }}
        >
          {playing ? <Pause size={16} color="#050505" fill="#050505" /> : <Play size={16} color={entry.color || '#00e5ff'} fill={entry.color || '#00e5ff'} />}
        </button>
      ) : null}
    </li>
  );
}

function SongRow({ entry, s, formatNumber }) {
  const { artist, title } = splitTitle(entry.displayTitle);
  return (
    <li data-testid={`charts-entry-${entry.rank}`} style={rowStyle(entry.rank <= 3)}>
      <Rank rank={entry.rank} />
      <Movement entry={entry} s={s} />
      <Artwork src={entry.cover} alt={s.coverAlt({ title: entry.displayTitle })} Icon={Music} />
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

const listStyle = { listStyle: 'none', margin: 0, padding: 0, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr)', gap: 8 };
const sectionTitle = { margin: '0 0 12px', fontFamily: "'Syne', sans-serif", fontSize: 22, color: '#F4F4F5' };

export default function ChartsPage() {
  const { copy, formatNumber, localeMeta } = useI18n();
  const player = usePlayer();
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

  const stations = Array.isArray(data?.stations) ? data.stations : [];
  const songs = Array.isArray(data?.songs) ? data.songs : [];

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
          <div data-testid="charts-content" aria-busy={!data} style={{ display: 'grid', gap: 32 }}>
            {data && !data.measuring ? <p style={{ margin: 0, color: '#A1A1AA' }}>{s.notMeasuring}</p> : null}
            {data?.measuring ? (
              <div>
                <h2 style={sectionTitle}>{s.stationsTitle}</h2>
                {stations.length ? (
                  <ol data-testid="charts-stations" style={listStyle}>
                    {stations.map((entry) => <StationRow key={entry.key} entry={entry} s={s} formatNumber={formatNumber} player={player} />)}
                  </ol>
                ) : <p data-testid="charts-stations-empty" style={{ margin: 0, color: '#A1A1AA' }}>{s.emptyStations}</p>}
              </div>
            ) : null}
            {data?.measuring ? (
              <div>
                <h2 style={sectionTitle}>{s.songsTitle}</h2>
                {songs.length ? (
                  <ol data-testid="charts-list" style={listStyle}>
                    {songs.map((entry) => <SongRow key={entry.rank} entry={entry} s={s} formatNumber={formatNumber} />)}
                  </ol>
                ) : <p data-testid="charts-empty" style={{ margin: 0, color: '#A1A1AA' }}>{s.empty}</p>}
              </div>
            ) : null}
            {data ? <p style={{ margin: 0, color: '#71717A', fontSize: 12, lineHeight: 1.6 }}>{s.note({ min: data.minServers || 3 })}</p> : null}
          </div>
        )}
      </div>
    </section>
  );
}
