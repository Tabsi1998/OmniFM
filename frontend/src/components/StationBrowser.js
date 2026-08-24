import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Music, Pause, Play, Radio, Search, Volume2, VolumeX } from 'lucide-react';
import { usePlayer } from '../lib/player.js';
import { useI18n } from '../i18n.js';

const STATION_COLORS = ['#00e5ff', '#ff6b00', '#EC4899', '#ff6b00', '#ff2a5f', '#ff2a5f'];

function StationCard({ station, index, isPlaying, onPlay, onStop, copy }) {
  const [hovered, setHovered] = useState(false);
  const color = STATION_COLORS[index % STATION_COLORS.length];
  const tier = String(station.tier || 'free').toLowerCase();
  const tierText = copy.stations.tiers[tier] || copy.stations.tiers.free;
  const tierBadge = {
    free: { text: tierText, bg: 'rgba(0,229,255,0.08)', border: 'rgba(0,229,255,0.22)', color: '#00e5ff' },
    pro: { text: tierText, bg: 'rgba(255,107,0,0.12)', border: 'rgba(255,107,0,0.3)', color: '#ff6b00' },
    ultimate: { text: tierText, bg: 'rgba(255,42,95,0.12)', border: 'rgba(255,42,95,0.3)', color: '#ff2a5f' },
  }[tier] || { text: copy.stations.tiers.free, bg: 'rgba(0,229,255,0.08)', border: 'rgba(0,229,255,0.22)', color: '#00e5ff' };

  return (
    <div
      data-testid={`station-card-${station.key}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '14px 18px',
        borderRadius: 14,
        background: isPlaying ? `${color}10` : (hovered ? 'rgba(255,255,255,0.05)' : 'rgba(255,255,255,0.02)'),
        border: `1px solid ${isPlaying ? `${color}30` : (hovered ? 'rgba(255,255,255,0.1)' : 'transparent')}`,
        cursor: 'pointer',
        transition: 'background 0.2s, border-color 0.2s',
        WebkitTapHighlightColor: 'transparent',
      }}
      onClick={() => (isPlaying ? onStop() : onPlay(station))}
    >
      <div style={{
        width: 42,
        height: 42,
        borderRadius: 10,
        background: isPlaying ? color : `${color}12`,
        border: `1px solid ${isPlaying ? color : `${color}22`}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        transition: 'background 0.2s',
      }}>
        {isPlaying ? (
          <Pause size={18} color="#050505" fill="#050505" />
        ) : (
          hovered ? <Play size={18} color={color} fill={color} /> : <Radio size={18} color={color} />
        )}
      </div>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {station.name}
          </div>
          <div style={{ fontSize: 12, color: '#52525B', fontFamily: "'JetBrains Mono', monospace", marginTop: 2 }}>
            {station.key}
          </div>
        </div>
        <span style={{
          fontSize: 9,
          fontWeight: 800,
          letterSpacing: '0.08em',
          padding: '3px 8px',
          borderRadius: 6,
          fontFamily: "'Syne', sans-serif",
          whiteSpace: 'nowrap',
          flexShrink: 0,
          background: tierBadge.bg,
          border: `1px solid ${tierBadge.border}`,
          color: tierBadge.color,
        }}>
          {tierBadge.text.toUpperCase()}
        </span>
      </div>
      {isPlaying && (
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 16 }}>
          {[0.6, 1, 0.7, 0.9].map((height, barIndex) => (
            <div key={barIndex} className="eq-bar" style={{
              width: 3,
              borderRadius: 1,
              height: `${height * 100}%`,
              background: color,
              animationDuration: `${0.4 + Math.random() * 0.6}s`,
              animationDelay: `${barIndex * 0.1}s`,
            }} />
          ))}
        </div>
      )}
    </div>
  );
}

function StationBrowser({ stations, loading }) {
  const { copy, formatNumber, locale } = useI18n();
  const player = usePlayer();
  const [search, setSearch] = useState('');
  const [activeTier, setActiveTier] = useState(null);
  const [visibleCount, setVisibleCount] = useState(8);
  // activeKey = ausgewählter Sender (auch bei Fehler), playingKey = wirklich spielend.
  const activeKey = player.current ? player.current.key : null;
  const playingKey = player.playing && player.current ? player.current.key : null;
  const playerError = player.error || null;
  const volume = typeof player.volume === 'number' ? player.volume : 80;
  const muted = !!player.muted;

  const tierFilters = [
    { id: null, label: copy.stations.filters.all, color: '#fff' },
    { id: 'free', label: copy.stations.filters.free, color: '#00e5ff' },
    { id: 'pro', label: copy.stations.filters.pro, color: '#ff6b00' },
  ];

  const counts = useMemo(() => ({
    free: stations.filter((station) => String(station.tier || 'free').toLowerCase() === 'free').length,
    pro: stations.filter((station) => String(station.tier || 'free').toLowerCase() === 'pro').length,
    ultimate: stations.filter((station) => String(station.tier || 'free').toLowerCase() === 'ultimate').length,
  }), [stations]);

  const filtered = useMemo(() => stations.filter((station) => {
    const query = search.toLowerCase();
    const matchSearch = !query || station.name.toLowerCase().includes(query) || station.key.toLowerCase().includes(query);
    const matchTier = !activeTier || String(station.tier || 'free').toLowerCase() === activeTier;
    return matchSearch && matchTier;
  }), [activeTier, search, stations]);

  useEffect(() => {
    setVisibleCount(8);
  }, [search, activeTier]);

  const visibleStations = useMemo(() => filtered.slice(0, visibleCount), [filtered, visibleCount]);
  const hasMore = filtered.length > visibleCount;
  const remaining = filtered.length - visibleCount;

  const handlePlay = useCallback((station) => { player.play(station); }, [player]);
  const handleStop = useCallback(() => { player.stop(); }, [player]);
  const handleVolume = useCallback((event) => { player.setVolume(Number(event.target.value)); }, [player]);
  const toggleMute = useCallback(() => { player.toggleMute(); }, [player]);

  const playingStation = stations.find((station) => station.key === activeKey);
  const summaryText = copy.stations.summary({
    count: formatNumber(stations.length),
    free: formatNumber(counts.free),
    pro: formatNumber(counts.pro),
    ultimate: formatNumber(counts.ultimate),
  });
  const filterSummaryText = copy.stations.filterSummary({
    count: formatNumber(stations.length),
    free: formatNumber(counts.free),
    pro: formatNumber(counts.pro),
    ultimate: formatNumber(counts.ultimate),
  });

  const removeUltimateCount = useCallback((value) => String(value || '')
    .replace(/,\s*\d+[.,]?\d*\s*ultimate/gi, '')
    .replace(/\(\s*/g, '(')
    .replace(/\s+\)/g, ')')
    .replace(/\(\)/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim(), []);

  const finalSummaryText = counts.ultimate > 0
    ? summaryText
    : removeUltimateCount(summaryText);
  const finalFilterSummaryText = counts.ultimate > 0
    ? filterSummaryText
    : removeUltimateCount(filterSummaryText);

  const searchPlaceholder = counts.ultimate > 0
    ? copy.stations.searchPlaceholder
    : (String(locale || 'de').startsWith('de') ? 'Station suchen…' : 'Search station…');

  return (
    <section id="stations" data-testid="station-browser" style={{ padding: '80px 0', position: 'relative', zIndex: 1 }}>
      <div className="section-container">
        <div style={{ marginBottom: 36 }}>
          <span style={{ fontFamily: "'Syne', sans-serif", fontSize: 11, fontWeight: 600, letterSpacing: '0.15em', textTransform: 'uppercase', color: '#00e5ff' }}>
            {copy.stations.eyebrow}
          </span>
          <h2 data-testid="stations-title" style={{ fontFamily: "'Syne', sans-serif", fontWeight: 800, fontSize: 'clamp(24px, 4vw, 40px)', marginTop: 8, marginBottom: 12 }}>
            {copy.stations.title}
          </h2>
          <p style={{ color: '#A1A1AA', fontSize: 16, maxWidth: 620 }}>
            {finalSummaryText}
          </p>
        </div>

        {playingStation && (
          <div
            data-testid="station-browser-now-playing"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 14,
              flexWrap: 'wrap',
              padding: '14px 20px',
              borderRadius: 14,
              marginBottom: 20,
              background: playerError ? 'rgba(255,42,95,0.07)' : 'rgba(0,229,255, 0.06)',
              border: `1px solid ${playerError ? 'rgba(255,42,95,0.28)' : 'rgba(0,229,255, 0.15)'}`,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: 2, height: 20, flexShrink: 0 }}>
              {[0.5, 0.8, 0.6, 1, 0.7].map((height, index) => (
                <div key={index} className="eq-bar" style={{
                  width: 3,
                  borderRadius: 1,
                  height: `${height * 100}%`,
                  background: playerError ? '#ff2a5f' : '#00e5ff',
                  animationPlayState: playingKey ? 'running' : 'paused',
                  animationDuration: `${0.4 + Math.random() * 0.6}s`,
                  animationDelay: `${index * 0.08}s`,
                }} />
              ))}
            </div>

            <div style={{ minWidth: 0, flex: '1 1 200px' }}>
              <div style={{ fontSize: 11, color: playerError ? '#ff8fab' : '#00e5ff', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
                {playerError ? (locale && String(locale).startsWith('de') ? 'Nicht abspielbar' : 'Cannot play') : copy.stations.nowPlaying}
              </div>
              <span style={{ fontSize: 14, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' }}>
                {playingStation.name}
              </span>
              {playerError && (
                <span data-testid="player-error-message" style={{ display: 'block', fontSize: 12, color: '#ff8fab', marginTop: 4, lineHeight: 1.4 }}>
                  {playerError.message}
                </span>
              )}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
              <button
                data-testid="mute-btn"
                onClick={toggleMute}
                title={copy.stations.previewVolume}
                style={{
                  background: 'none',
                  border: 'none',
                  color: muted ? '#ff2a5f' : '#A1A1AA',
                  cursor: 'pointer',
                  padding: 4,
                  lineHeight: 0,
                }}
              >
                {muted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                data-testid="volume-slider"
                min="0"
                max="100"
                value={muted ? 0 : volume}
                onChange={handleVolume}
                style={{
                  width: 100,
                  height: 4,
                  appearance: 'none',
                  WebkitAppearance: 'none',
                  background: `linear-gradient(to right, #00e5ff ${muted ? 0 : volume}%, rgba(255,255,255,0.1) ${muted ? 0 : volume}%)`,
                  borderRadius: 2,
                  outline: 'none',
                  cursor: 'pointer',
                }}
              />
              <span style={{ fontSize: 11, fontFamily: "'JetBrains Mono', monospace", color: '#52525B', width: 28, textAlign: 'right' }}>
                {muted ? 0 : volume}
              </span>
            </div>

            <button
              data-testid="stop-playing-btn"
              onClick={handleStop}
              title={copy.stations.stopPreview}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 8,
                flexShrink: 0,
                background: 'rgba(255,255,255,0.1)',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
              }}
            >
              <Pause size={14} />
            </button>
          </div>
        )}

        <div style={{ marginBottom: 24 }}>
          <div style={{ position: 'relative', maxWidth: 400, marginBottom: 12 }}>
            <Search size={18} color="#52525B" style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', pointerEvents: 'none' }} />
            <input
              type="text"
              data-testid="station-search"
              className="station-search"
              placeholder={searchPlaceholder}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {tierFilters.map((filter) => {
              const isActive = activeTier === filter.id;
              return (
                <button
                  key={filter.id || 'all'}
                  data-testid={`tier-filter-${filter.id || 'all'}`}
                  onClick={() => setActiveTier(filter.id)}
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '6px 16px',
                    borderRadius: 20,
                    cursor: 'pointer',
                    letterSpacing: '0.05em',
                    transition: 'all 0.2s',
                    border: `1px solid ${isActive ? `${filter.color}50` : `${filter.color}20`}`,
                    background: isActive ? `${filter.color}12` : 'transparent',
                    color: filter.color,
                  }}
                >
                  {filter.label}
                </button>
              );
            })}
          </div>
          <p style={{ fontSize: 12, color: '#52525B', marginTop: 8 }}>
            {finalFilterSummaryText}
          </p>
        </div>

        {loading ? (
          <div style={{ color: '#52525B', padding: 40 }}>{copy.stations.loading}</div>
        ) : filtered.length === 0 ? (
          <div data-testid="no-stations" style={{ color: '#52525B', padding: 40, textAlign: 'center', borderRadius: 16, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)' }}>
            <Music size={32} style={{ marginBottom: 12, opacity: 0.3 }} />
            <p>{copy.stations.empty}</p>
          </div>
        ) : (
          <>
            <div data-testid="station-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(340px, 100%), 1fr))', gap: 8, padding: '4px 0' }}>
              {visibleStations.map((station, index) => (
                <StationCard
                  key={station.key}
                  station={station}
                  index={index}
                  isPlaying={playingKey === station.key}
                  onPlay={handlePlay}
                  onStop={handleStop}
                  copy={copy}
                />
              ))}
            </div>
            {hasMore && (
              <div style={{ textAlign: 'center', marginTop: 24 }}>
                <button
                  data-testid="load-more-stations"
                  onClick={() => setVisibleCount((current) => current + 8)}
                  style={{
                    padding: '12px 32px',
                    borderRadius: 12,
                    cursor: 'pointer',
                    background: 'rgba(255,255,255,0.05)',
                    border: '1px solid rgba(255,255,255,0.12)',
                    color: '#A1A1AA',
                    fontSize: 13,
                    fontWeight: 600,
                    letterSpacing: '0.03em',
                    transition: 'all 0.2s',
                  }}
                  onMouseEnter={(event) => {
                    event.currentTarget.style.background = 'rgba(255,255,255,0.1)';
                    event.currentTarget.style.color = '#fff';
                  }}
                  onMouseLeave={(event) => {
                    event.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                    event.currentTarget.style.color = '#A1A1AA';
                  }}
                >
                  {copy.stations.loadMore({
                    shown: formatNumber(Math.min(remaining, 8)),
                    remaining: formatNumber(remaining),
                  })}
                </button>
                <p style={{ fontSize: 11, color: '#52525B', marginTop: 8 }}>
                  {copy.stations.visible({
                    visible: formatNumber(Math.min(visibleCount, filtered.length)),
                    total: formatNumber(filtered.length),
                  })}
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

export default StationBrowser;
