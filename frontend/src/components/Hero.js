import React, { useEffect, useState } from 'react';
import { Headphones, Radio, Volume2, Play, SkipForward, Users } from 'lucide-react';
import { useI18n } from '../i18n.js';
import { resolvePrimaryInviteUrl } from '../lib/invite.js';

const heroCss = `
@keyframes eq-bounce { 0%,100% { transform: scaleY(0.28);} 50% { transform: scaleY(1);} }
@keyframes hero-fade-in { from { opacity: 0; transform: translateY(20px);} to { opacity: 1; transform: none;} }
@keyframes glow-pulse { 0%,100% { opacity: 0.35;} 50% { opacity: 0.65;} }
@keyframes onair-pulse { 0% { box-shadow: 0 0 0 0 rgba(255,42,95,0.6);} 70% { box-shadow: 0 0 0 9px rgba(255,42,95,0);} 100% { box-shadow: 0 0 0 0 rgba(255,42,95,0);} }
@keyframes np-progress { from { width: 8%;} to { width: 92%;} }
@media (max-width: 900px) { .hero-grid { grid-template-columns: 1fr !important; } .hero-np { margin-top: 8px; } }
`;

const LIVE_TRACKS = [
  { station: 'Synthwave Nights', genre: 'Retrowave · 320 kbps', artist: 'The Midnight — Vampires' },
  { station: 'Lofi Lounge', genre: 'Lofi Hip-Hop · 256 kbps', artist: 'Idealism — Controlla' },
  { station: 'BassDrop Network', genre: 'Drum & Bass · 320 kbps', artist: 'Netsky — Rio' },
  { station: 'Neon City FM', genre: 'Cyber House · 320 kbps', artist: 'Gunship — Tech Noir' },
];

function Equalizer({ bars = 14, height = 44, colorful = true }) {
  const list = Array.from({ length: bars });
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 3, height }} aria-hidden="true">
      {list.map((_, i) => (
        <div key={i} style={{
          width: 4,
          borderRadius: '2px 2px 0 0',
          background: colorful ? 'linear-gradient(to top, #ff6b00, #00e5ff)' : 'linear-gradient(to top, #ff6b00, #ff2a5f)',
          animation: `eq-bounce ${0.6 + (i % 5) * 0.14}s ease-in-out ${i * 0.07}s infinite`,
          height: `${30 + ((i * 37) % 70)}%`,
          transformOrigin: 'bottom',
        }} />
      ))}
    </div>
  );
}

function NowPlayingConsole({ listeners }) {
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setIdx((v) => (v + 1) % LIVE_TRACKS.length), 4200);
    return () => clearInterval(t);
  }, []);
  const track = LIVE_TRACKS[idx];

  return (
    <div
      data-testid="hero-now-playing"
      style={{
        position: 'relative',
        background: 'rgba(14,17,26,0.72)',
        border: '1px solid #2a3450',
        borderRadius: 22,
        padding: 22,
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        boxShadow: '0 30px 80px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,107,0,0.06)',
        animation: 'hero-fade-in 0.7s ease-out 0.25s both',
        maxWidth: 440,
        marginLeft: 'auto',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 18 }}>
        <span style={{
          display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 12px', borderRadius: 999,
          background: 'linear-gradient(90deg, rgba(255,42,95,0.18), rgba(255,107,0,0.14))',
          border: '1px solid rgba(255,42,95,0.4)', fontSize: 10.5, fontWeight: 800, letterSpacing: '0.16em',
          color: '#ffd9e2', fontFamily: "'JetBrains Mono', monospace",
        }}>
          <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff2a5f', animation: 'onair-pulse 1.8s infinite' }} />
          ON AIR
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#94a3b8', fontSize: 12.5, fontFamily: "'JetBrains Mono', monospace" }}>
          <Users size={13} color="#ff6b00" /> {Number(listeners || 0).toLocaleString('de-DE')} hören zu
        </span>
      </div>

      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        <div style={{
          width: 92, height: 92, borderRadius: 16, flexShrink: 0, position: 'relative', overflow: 'hidden',
          background: 'linear-gradient(135deg, #ff6b00 0%, #ff2a5f 60%, #7a1030 100%)',
          display: 'grid', placeItems: 'center', boxShadow: '0 12px 30px rgba(255,107,0,0.35)',
        }}>
          <Radio size={30} color="rgba(255,255,255,0.92)" />
          <div style={{ position: 'absolute', bottom: 8, left: 0, right: 0, display: 'flex', justifyContent: 'center' }}>
            <Equalizer bars={7} height={20} colorful={false} />
          </div>
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div key={track.station} style={{ fontWeight: 800, fontSize: 19, fontFamily: "'Syne','Outfit',sans-serif", animation: 'hero-fade-in 0.5s ease-out both' }}>
            {track.station}
          </div>
          <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {track.artist}
          </div>
          <div style={{ marginTop: 8, display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span style={{
              fontFamily: "'JetBrains Mono', monospace", fontSize: 10.5, fontWeight: 700, color: '#ffb27a',
              background: 'rgba(255,107,0,0.14)', border: '1px solid rgba(255,107,0,0.3)', borderRadius: 999, padding: '3px 9px',
            }}>{track.genre}</span>
          </div>
        </div>
      </div>

      <div style={{ marginTop: 18 }}>
        <div style={{ height: 6, borderRadius: 999, background: '#1c2235', overflow: 'hidden' }}>
          <div style={{ height: '100%', borderRadius: 999, background: 'linear-gradient(90deg, #ff6b00, #00e5ff)', animation: 'np-progress 30s linear infinite' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, color: '#64748b', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" }}>
          <span>LIVE STREAM</span><span>24 / 7</span>
        </div>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 42, height: 42, borderRadius: '50%', background: 'linear-gradient(135deg,#ff6b00,#ff2a5f)', display: 'grid', placeItems: 'center', color: '#08090d', boxShadow: '0 8px 22px rgba(255,107,0,0.4)' }}>
            <Play size={18} fill="currentColor" />
          </div>
          <SkipForward size={18} color="#64748b" />
        </div>
        <Equalizer bars={16} height={30} />
      </div>
    </div>
  );
}

function Hero({ stats, bots }) {
  const { copy, formatNumber } = useI18n();
  const inviteUrl = resolvePrimaryInviteUrl(bots);
  const subtitleTail = String(copy.hero.subtitleTail || '').trim();
  const subtitleSpacer = subtitleTail && !/^[.,!?;:]/.test(subtitleTail) ? ' ' : '';
  const heroStats = [
    { label: copy.hero.stats.servers, value: stats.servers || 1280, color: '#ff6b00' },
    { label: copy.hero.stats.stations, value: stats.stations || 120, color: '#00e5ff' },
    { label: copy.hero.stats.bots, value: stats.bots || 2, color: '#10b981' },
  ];
  const listeners = stats.listeners || stats.users || 1240;

  return (
    <section
      id="top"
      data-testid="hero-section"
      style={{ position: 'relative', minHeight: '92vh', display: 'flex', alignItems: 'center', padding: '130px 24px 90px', overflow: 'hidden' }}
    >
      <style>{heroCss}</style>

      <div style={{ position: 'absolute', top: '-15%', right: '-8%', width: '55%', height: '65%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(255,107,0,0.10) 0%, transparent 68%)', filter: 'blur(90px)', pointerEvents: 'none', animation: 'glow-pulse 7s ease-in-out infinite' }} />
      <div style={{ position: 'absolute', bottom: '-12%', left: '-8%', width: '45%', height: '55%', borderRadius: '50%', background: 'radial-gradient(circle, rgba(0,229,255,0.07) 0%, transparent 70%)', filter: 'blur(90px)', pointerEvents: 'none', animation: 'glow-pulse 9s ease-in-out infinite 2s' }} />

      <div className="section-container" style={{ position: 'relative', zIndex: 2, width: '100%' }}>
        <div className="hero-grid" style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 56, alignItems: 'center' }}>
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 9, padding: '7px 15px', borderRadius: 999,
              background: 'rgba(255,107,0,0.08)', border: '1px solid rgba(255,107,0,0.28)', marginBottom: 26,
              animation: 'hero-fade-in 0.6s ease-out both',
            }}>
              <Radio size={14} color="#ff6b00" />
              <span style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 11, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: '#ffb27a' }}>
                {copy.hero.badge}
              </span>
            </div>

            <h1 data-testid="hero-title" style={{
              fontFamily: "'Syne','Outfit',sans-serif", fontWeight: 800, fontSize: 'clamp(38px, 6vw, 74px)',
              lineHeight: 1.02, letterSpacing: '-0.025em', marginBottom: 22, animation: 'hero-fade-in 0.6s ease-out 0.1s both',
            }}>
              {copy.hero.titleLead}{' '}
              <span style={{ background: 'linear-gradient(120deg, #ff6b00 0%, #00e5ff 100%)', WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', color: '#ff6b00' }}>
                {copy.hero.titleAccent}
              </span>
              <br />
              {copy.hero.titleTail}
            </h1>

            <p data-testid="hero-subtitle" style={{ fontSize: 'clamp(16px, 2vw, 19px)', color: '#94a3b8', maxWidth: 540, lineHeight: 1.65, marginBottom: 36, animation: 'hero-fade-in 0.6s ease-out 0.2s both' }}>
              {copy.hero.subtitleLead}{' '}
              <span style={{ color: '#fff', fontWeight: 700, fontFamily: "'JetBrains Mono', monospace" }}>/play</span>
              {subtitleTail ? `${subtitleSpacer}${subtitleTail}` : ''}
            </p>

            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 14, marginBottom: 46, animation: 'hero-fade-in 0.6s ease-out 0.3s both' }}>
              <a
                href={inviteUrl}
                data-testid="hero-cta-invite"
                target={inviteUrl.startsWith('http') ? '_blank' : undefined}
                rel={inviteUrl.startsWith('http') ? 'noopener noreferrer' : undefined}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '15px 30px', borderRadius: 14, background: 'linear-gradient(135deg, #ff6b00, #ff2a5f)', color: '#08090d', fontWeight: 800, fontSize: 15, boxShadow: '0 14px 34px rgba(255,107,0,0.35)', transition: 'transform 0.2s, box-shadow 0.2s' }}
                onMouseEnter={(e) => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 18px 44px rgba(255,107,0,0.5)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 14px 34px rgba(255,107,0,0.35)'; }}
              >
                <Headphones size={18} /> {copy.hero.ctaInvite}
              </a>
              <a
                href="#features"
                data-testid="hero-cta-features"
                style={{ display: 'inline-flex', alignItems: 'center', gap: 9, padding: '15px 30px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', color: '#fff', fontWeight: 600, fontSize: 15, border: '1px solid #2a3450', transition: 'background 0.2s, border-color 0.2s' }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#ff6b00'; e.currentTarget.style.background = 'rgba(255,107,0,0.06)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = '#2a3450'; e.currentTarget.style.background = 'rgba(255,255,255,0.03)'; }}
              >
                <Volume2 size={18} /> {copy.hero.ctaFlow}
              </a>
            </div>

            <div data-testid="hero-quick-stats" style={{ display: 'flex', gap: 44, flexWrap: 'wrap', animation: 'hero-fade-in 0.6s ease-out 0.4s both' }}>
              {heroStats.map((item) => (
                <div key={item.label}>
                  <div style={{ fontFamily: "'JetBrains Mono', monospace", fontSize: 30, fontWeight: 700, color: item.color, textShadow: `0 0 22px ${item.color}33` }}>
                    {formatNumber(item.value)}
                  </div>
                  <div style={{ fontSize: 11, color: '#64748b', fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', marginTop: 5 }}>
                    {item.label}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="hero-np">
            <NowPlayingConsole listeners={listeners} />
          </div>
        </div>
      </div>
    </section>
  );
}

export default Hero;
