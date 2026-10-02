import { useEffect, useState } from 'react';
import { Play, Pause, Headphones, X } from 'lucide-react';
import { resolvePrimaryInviteUrl } from '../lib/invite.js';
import { useI18n } from '../i18n.js';
import { useShowcaseStations } from '../lib/showcase.js';
import { audioErrorText, usePlayer } from '../lib/player.js';
import { coverFor } from '../lib/coverCache.js';

const barCss = `
@keyframes npbar-eq { 0%,100%{transform:scaleY(0.3);} 50%{transform:scaleY(1);} }
@keyframes npbar-in { from{transform:translateY(120%);} to{transform:none;} }
.npbar-hidemobile { }
.npbar-name { white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
@media (max-width: 720px){
  .npbar-hidemobile{ display:none !important; }
  .npbar-row{ gap:10px !important; padding:8px 12px !important; }
  .npbar-name{ white-space: normal; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; line-height: 1.25; }
}
`;

// The bar's height, for the buttons that sit in the bottom corner (cookie settings).
const BAR_HEIGHT = 74;

const TIER_BITRATE = { free: '64 kbps', pro: '128 kbps', ultimate: '320 kbps' };

function Bars({ active, className }) {
  return (
    <span className={className} style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2.5, height: 20 }} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} style={{ width: 3, height: `${40 + i * 12}%`, borderRadius: 2, background: 'linear-gradient(180deg,#ff6b00,#00e5ff)', transformOrigin: 'bottom', animationName: 'npbar-eq', animationDuration: `${0.7 + i * 0.12}s`, animationTimingFunction: 'ease-in-out', animationDelay: `${i * 0.09}s`, animationIterationCount: 'infinite', animationPlayState: active ? 'running' : 'paused', opacity: active ? 1 : 0.4 }} />
      ))}
    </span>
  );
}

// The listeners count stands once on the start page, in the bar under the hero (#435).
export default function NowPlayingBar({ bots = [] }) {
  const { t, locale } = useI18n();
  const player = usePlayer();
  const showcase = useShowcaseStations(8);
  const [idx, setIdx] = useState(0);
  const [cover, setCover] = useState(null);
  const [closed, setClosed] = useState(() => (typeof window !== 'undefined' && window.sessionStorage.getItem('omnifm_npbar_closed') === '1'));
  const invite = resolvePrimaryInviteUrl(bots, locale);

  // Rotiert nur die Vorschau, solange NICHTS läuft.
  const playing = player.current;
  useEffect(() => {
    if (playing || showcase.length < 2) return undefined;
    const timer = setInterval(() => setIdx((v) => (v + 1) % showcase.length), 4500);
    return () => clearInterval(timer);
  }, [playing, showcase.length]);

  const station = player.current || (showcase.length ? showcase[idx % showcase.length] : { name: 'OmniFM Radio Network', bitrate: 'Live' });
  const isPlaying = !!player.playing;
  const err = (player.current && player.error) ? player.error : null;
  const bitrate = station.bitrate || TIER_BITRATE[String(station.tier || '').toLowerCase()] || null;
  const streamLabel = t('Live-Radio-Stream', 'Live radio stream');

  const stationName = station?.name || '';
  useEffect(() => {
    let stop = false;
    setCover(null);
    if (!stationName) return undefined;
    // Each name once per visit, shared with the player above (#485).
    coverFor(stationName).then((artwork) => { if (!stop && artwork) setCover(artwork); });
    return () => { stop = true; };
  }, [stationName]);

  // While the bar is there, the corner buttons move above it (#435).
  useEffect(() => {
    if (closed || typeof document === 'undefined') return undefined;
    const root = document.documentElement;
    root.style.setProperty('--omnifm-bottom-bar', `${BAR_HEIGHT}px`);
    return () => root.style.removeProperty('--omnifm-bottom-bar');
  }, [closed]);

  if (closed) return null;

  const onPlayClick = () => {
    if (player.current) { player.toggle(); return; }
    const target = showcase.find((s) => s.url) || null;
    if (target) player.play(target);
  };

  return (
    <>
      <style>{barCss}</style>
      <div style={{ height: BAR_HEIGHT }} aria-hidden="true" />
      <div
        data-testid="now-playing-bar"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 60,
          background: 'rgba(10,12,18,0.86)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
          borderTop: '1px solid #2a3450', boxShadow: '0 -12px 40px rgba(0,0,0,0.45)',
          animation: 'npbar-in 0.5s ease-out',
        }}
      >
        <div className="npbar-row" style={{ maxWidth: 1200, margin: '0 auto', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span data-testid="now-playing-bar-status" className="npbar-hidemobile" style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 9px', borderRadius: 999, border: `1px solid ${err ? 'rgba(255,168,0,0.45)' : (isPlaying ? 'rgba(255,42,95,0.4)' : '#2a3450')}`, background: err ? 'rgba(255,168,0,0.12)' : (isPlaying ? 'rgba(255,42,95,0.12)' : 'rgba(255,255,255,0.03)'), color: err ? '#ffcf80' : (isPlaying ? '#ffd9e2' : '#94a3b8'), fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: err ? '#ffa800' : (isPlaying ? '#ff2a5f' : '#64748b'), animation: isPlaying && !err ? 'onair-pulse 1.8s infinite' : 'none' }} /> {err ? t('FEHLER', 'ERROR') : (isPlaying ? 'LIVE' : (player.loading ? '…' : t('VORSCHAU', 'PREVIEW')))}
          </span>
          <button
            onClick={onPlayClick}
            data-testid="now-playing-bar-play"
            aria-label={isPlaying ? 'Pause' : 'Play'}
            style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0, border: 'none', cursor: 'pointer', background: 'linear-gradient(135deg,#ff6b00,#ff2a5f)', display: 'grid', placeItems: 'center', boxShadow: '0 6px 18px rgba(255,107,0,0.35)', overflow: 'hidden', position: 'relative' }}
          >
            {cover && <img src={cover} alt={station.name} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', opacity: 0.55 }} />}
            <span style={{ position: 'relative', display: 'grid', placeItems: 'center' }}>
              {isPlaying ? <Pause size={19} color="#fff" fill="#fff" /> : <Play size={19} color="#fff" fill="#fff" />}
            </span>
          </button>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div key={station.name} data-testid="now-playing-bar-name" className="npbar-name" style={{ fontWeight: 700, fontSize: 14, fontFamily: "'Syne','Outfit',sans-serif" }}>{station.name}</div>
            <div className={err ? undefined : 'npbar-hidemobile'} data-testid="now-playing-bar-sub" style={{ color: err ? '#ffcf80' : '#94a3b8', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{err ? audioErrorText(err, t) : (isPlaying ? streamLabel : t('Play drücken zum Live-Hören', 'Tap play to listen live'))}</div>
          </div>
          {bitrate && <span className="npbar-hidemobile" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, fontWeight: 700, color: '#ffb27a', background: 'rgba(255,107,0,0.14)', border: '1px solid rgba(255,107,0,0.3)', borderRadius: 999, padding: '3px 9px', flexShrink: 0 }}>{bitrate}</span>}
          <Bars active={isPlaying} className="npbar-hidemobile" />
          <a
            href={invite}
            target={invite.startsWith('http') ? '_blank' : undefined}
            rel={invite.startsWith('http') ? 'noopener noreferrer' : undefined}
            data-testid="now-playing-bar-cta"
            aria-label={t('In Discord starten', 'Start in Discord')}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 11, background: 'linear-gradient(135deg,#ff6b00,#ff2a5f)', color: '#08090d', fontWeight: 800, fontSize: 13, flexShrink: 0 }}
          >
            <Headphones size={15} /> <span className="npbar-hidemobile">{t('In Discord starten', 'Start in Discord')}</span>
          </a>
          <button
            onClick={() => { setClosed(true); try { window.sessionStorage.setItem('omnifm_npbar_closed', '1'); } catch { /* noop */ } }}
            data-testid="now-playing-bar-close"
            aria-label="Leiste schließen"
            style={{ background: 'none', border: 'none', color: '#64748b', cursor: 'pointer', padding: 4, flexShrink: 0 }}
          ><X size={18} /></button>
        </div>
      </div>
    </>
  );
}
