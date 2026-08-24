import React, { useEffect, useState } from 'react';
import { Radio, Play, Users, Headphones, X } from 'lucide-react';
import { resolvePrimaryInviteUrl } from '../lib/invite.js';
import { useI18n } from '../i18n.js';
import { useShowcaseStations } from '../lib/showcase.js';

const barCss = `
@keyframes npbar-eq { 0%,100%{transform:scaleY(0.3);} 50%{transform:scaleY(1);} }
@keyframes npbar-in { from{transform:translateY(120%);} to{transform:none;} }
.npbar-hidemobile { }
@media (max-width: 720px){ .npbar-hidemobile{ display:none !important; } }
`;

function Bars() {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'flex-end', gap: 2.5, height: 20 }} aria-hidden="true">
      {[0, 1, 2, 3, 4].map((i) => (
        <span key={i} style={{ width: 3, height: `${40 + i * 12}%`, borderRadius: 2, background: 'linear-gradient(180deg,#ff6b00,#00e5ff)', transformOrigin: 'bottom', animation: `npbar-eq ${0.7 + i * 0.12}s ease-in-out ${i * 0.09}s infinite` }} />
      ))}
    </span>
  );
}

export default function NowPlayingBar({ stats = {}, bots = [] }) {
  const { locale, formatNumber } = useI18n();
  const ctaLabel = locale === 'en' ? 'Start in Discord' : 'In Discord starten';
  const [idx, setIdx] = useState(0);
  const [closed, setClosed] = useState(() => (typeof window !== 'undefined' && window.sessionStorage.getItem('omnifm_npbar_closed') === '1'));
  const invite = resolvePrimaryInviteUrl(bots);
  const stations = useShowcaseStations(8);
  useEffect(() => { if (stations.length < 2) return undefined; const t = setInterval(() => setIdx((v) => (v + 1) % stations.length), 4500); return () => clearInterval(t); }, [stations.length]);
  if (closed) return null;
  const track = stations.length ? stations[idx % stations.length] : { name: 'OmniFM Radio Network', bitrate: 'Live' };
  const streamLabel = locale === 'en' ? 'Live radio stream' : 'Live-Radio-Stream';
  const listeners = stats.listeners || 0;

  return (
    <>
      <style>{barCss}</style>
      <div style={{ height: 74 }} aria-hidden="true" />
      <div
        data-testid="now-playing-bar"
        style={{
          position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 60,
          background: 'rgba(10,12,18,0.86)', backdropFilter: 'blur(18px)', WebkitBackdropFilter: 'blur(18px)',
          borderTop: '1px solid #2a3450', boxShadow: '0 -12px 40px rgba(0,0,0,0.45)',
          animation: 'npbar-in 0.5s ease-out',
        }}
      >
        <div style={{ maxWidth: 1200, margin: '0 auto', padding: '10px 20px', display: 'flex', alignItems: 'center', gap: 16 }}>
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, padding: '4px 9px', borderRadius: 999, border: '1px solid rgba(255,42,95,0.4)', background: 'rgba(255,42,95,0.12)', color: '#ffd9e2', fontSize: 10, fontWeight: 800, letterSpacing: '0.14em', fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff2a5f', animation: 'onair-pulse 1.8s infinite' }} /> LIVE
          </span>
          <div style={{ width: 42, height: 42, borderRadius: 10, flexShrink: 0, background: 'linear-gradient(135deg,#ff6b00,#ff2a5f)', display: 'grid', placeItems: 'center', boxShadow: '0 6px 18px rgba(255,107,0,0.35)' }}>
            <Radio size={19} color="#fff" />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div key={track.name} style={{ fontWeight: 700, fontSize: 14, fontFamily: "'Syne','Outfit',sans-serif", overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{track.name}</div>
            <div className="npbar-hidemobile" style={{ color: '#94a3b8', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{streamLabel}</div>
          </div>
          {listeners > 0 && (
            <span className="npbar-hidemobile" style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: '#94a3b8', fontSize: 12, fontFamily: "'JetBrains Mono',monospace", flexShrink: 0 }}>
              <Users size={13} color="#ff6b00" /> {formatNumber(Number(listeners))}
            </span>
          )}
          <span className="npbar-hidemobile" style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, fontWeight: 700, color: '#ffb27a', background: 'rgba(255,107,0,0.14)', border: '1px solid rgba(255,107,0,0.3)', borderRadius: 999, padding: '3px 9px', flexShrink: 0 }}>{track.bitrate}</span>
          <Bars />
          <a
            href={invite}
            target={invite.startsWith('http') ? '_blank' : undefined}
            rel={invite.startsWith('http') ? 'noopener noreferrer' : undefined}
            data-testid="now-playing-bar-cta"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '9px 18px', borderRadius: 11, background: 'linear-gradient(135deg,#ff6b00,#ff2a5f)', color: '#08090d', fontWeight: 800, fontSize: 13, flexShrink: 0 }}
          >
            <Headphones size={15} /> <span className="npbar-hidemobile">{ctaLabel}</span><Play size={14} style={{ display: 'none' }} />
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
