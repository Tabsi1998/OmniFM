import React, { useEffect, useState } from 'react';

const liveCss = `
@keyframes lpb-live-shimmer { 0%{background-position:-200% 0;} 100%{background-position:200% 0;} }
@keyframes lpb-live-pulse { 0%,100%{opacity:1;transform:scale(1);} 50%{opacity:0.45;transform:scale(0.82);} }
`;

function fmtTime(totalSec) {
  const sec = Math.max(0, Math.floor(totalSec));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const pad = (n) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

/**
 * YouTube-style playback timeline.
 * - live=true (radio 24/7): elapsed counts up, bar sits at the "live edge"
 *   with an animated shimmer and a red ● LIVE badge (like a YouTube livestream).
 * - live=false: shows elapsed / total with a proportional progress fill.
 */
export default function LivePlaybackBar({
  live = true,
  duration = 0,
  startElapsed = 0,
  accent = '#ff6b00',
  accent2 = '#00e5ff',
  resetKey,
}) {
  const [elapsed, setElapsed] = useState(startElapsed);

  useEffect(() => { setElapsed(startElapsed); }, [resetKey, startElapsed]);
  useEffect(() => {
    const t = setInterval(() => {
      setElapsed((e) => {
        if (!live && duration > 0 && e >= duration) return duration;
        return e + 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [live, duration]);

  const pct = live ? 100 : (duration > 0 ? Math.min(100, (elapsed / duration) * 100) : 0);

  return (
    <div data-testid="live-playback-bar" data-live={live ? '1' : '0'}>
      <style>{liveCss}</style>
      <div style={{ position: 'relative', height: 6, borderRadius: 999, background: '#1e1f22', overflow: 'hidden' }}>
        <div style={{
          position: 'absolute', inset: 0, width: `${pct}%`, borderRadius: 999,
          background: live
            ? `linear-gradient(90deg, ${accent} 0%, ${accent2} 45%, ${accent} 90%)`
            : `linear-gradient(90deg, ${accent}, ${accent2})`,
          backgroundSize: live ? '200% 100%' : '100% 100%',
          animation: live ? 'lpb-live-shimmer 2.2s linear infinite' : 'none',
        }} />
        {/* scrubber knob sits at the live edge */}
        <div style={{
          position: 'absolute', top: '50%', left: `calc(${pct}% - 5px)`, transform: 'translateY(-50%)',
          width: 10, height: 10, borderRadius: '50%', background: live ? '#ff2a5f' : '#fff',
          boxShadow: '0 0 0 3px rgba(0,0,0,0.35)',
        }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 7, fontFamily: "'JetBrains Mono',monospace", fontSize: 11, color: '#949ba4' }}>
        <span data-testid="lpb-elapsed">{fmtTime(elapsed)}</span>
        {live ? (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, color: '#ff5470', fontWeight: 800, letterSpacing: '0.08em' }}>
            <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ff2a5f', animation: 'lpb-live-pulse 1.6s ease-in-out infinite' }} />
            LIVE
          </span>
        ) : (
          <span data-testid="lpb-total">{fmtTime(duration)}</span>
        )}
      </div>
    </div>
  );
}
