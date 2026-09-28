// OmniFM: Halloween on the start page (#443), part of the decoration's own
// download. Cobwebs in the corners and at the edges of sections, glowing
// jack-o'-lanterns, now and then a spider that lets itself down on its
// thread or crawls along the bottom, and bats that flutter past. Placed at
// random on every load, only at edges and corners, never in the way: nothing
// here takes a click. With "less motion" only webs and pumpkins stay, still.
import { useEffect, useMemo, useRef, useState } from 'react';

const css = `
.hw-layer { pointer-events: none; }
.hw-layer * { pointer-events: none; }
.hw-web line, .hw-web polygon { stroke: rgba(226, 232, 240, 0.34); stroke-width: 1; fill: none; }
.hw-pumpkin-glow { animation: hw-flicker 2.2s ease-in-out infinite alternate; }
@keyframes hw-flicker { 0% { opacity: 0.75; } 40% { opacity: 1; } 55% { opacity: 0.6; } 100% { opacity: 0.95; } }
.hw-leg-a { animation: hw-legs 0.32s ease-in-out infinite alternate; transform-origin: 50% 40%; }
.hw-leg-b { animation: hw-legs 0.32s ease-in-out infinite alternate-reverse; transform-origin: 50% 40%; }
@keyframes hw-legs { from { transform: rotate(-9deg); } to { transform: rotate(9deg); } }
.hw-drop { position: fixed; top: 64px; z-index: 45; width: 40px; overflow: visible; }
.hw-drop-body { animation: hw-drop var(--hw-time, 7s) ease-in-out forwards; }
@keyframes hw-drop { 0% { transform: translateY(-60px); } 30%, 62% { transform: translateY(var(--hw-depth, 160px)); }
  46% { transform: translateY(calc(var(--hw-depth, 160px) - 14px)); } 100% { transform: translateY(-60px); } }
.hw-walk { position: fixed; z-index: 45; animation: hw-walk var(--hw-time, 11s) linear forwards; }
@keyframes hw-walk { from { transform: translateX(-70px); } to { transform: translateX(calc(100vw + 70px)); } }
.hw-bats { position: fixed; left: 0; z-index: 45; animation: hw-fly var(--hw-time, 7s) linear forwards; }
@keyframes hw-fly { from { transform: translateX(-120px); } to { transform: translateX(calc(100vw + 120px)); } }
.hw-bat { animation: hw-bob 1.1s ease-in-out infinite alternate; }
@keyframes hw-bob { from { transform: translateY(-10px); } to { transform: translateY(12px); } }
.hw-wing { animation: hw-flap 0.22s ease-in-out infinite alternate; transform-origin: 50% 50%; }
@keyframes hw-flap { from { transform: scaleY(1); } to { transform: scaleY(0.35); } }
`;

// Where webs and pumpkins may sit: sections of the start page, at their edges.
export const WEB_SECTIONS = ['station-browser', 'why-omnifm-section', 'premium-section', 'community-section', 'faq-section'];
export const CORNERS = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];

function pick(list, count, random) {
  const pool = [...list];
  const chosen = [];
  while (pool.length && chosen.length < count) chosen.push(pool.splice(Math.floor(random() * pool.length), 1)[0]);
  return chosen;
}

/**
 * Where this visit's webs and pumpkins go: corners of the screen and of
 * sections, drawn at random. A phone has little room at its edges: one small
 * web in a top corner and no webs on the sections.
 */
export function halloweenLayout(random = Math.random, { narrow = false } = {}) {
  const screenWebs = pick(narrow ? CORNERS.slice(0, 2) : CORNERS, narrow ? 1 : 2, random)
    .map((corner) => ({ corner, size: narrow ? 64 : 90 + Math.round(random() * 60), tilt: Math.round((random() - 0.5) * 16) }));
  return {
    screenWebs,
    sectionWebs: narrow ? [] : pick(WEB_SECTIONS, 2, random).map((section) => ({ section, corner: random() < 0.5 ? 'top-left' : 'top-right', size: 70 + Math.round(random() * 40) })),
    pumpkins: pick(WEB_SECTIONS, 3, random).map((section) => ({ section, side: random() < 0.5 ? 'left' : 'right', size: 34 + Math.round(random() * 14) })),
  };
}

/** A cobweb for a corner: threads from the corner and rings between them. */
function Web({ size, corner, tilt = 0 }) {
  const rays = 7;
  const rings = [0.28, 0.5, 0.72, 0.95];
  const points = (radius) => Array.from({ length: rays }, (_, index) => {
    const angle = (Math.PI / 2) * (index / (rays - 1));
    return `${(Math.cos(angle) * radius * size).toFixed(1)},${(Math.sin(angle) * radius * size).toFixed(1)}`;
  }).join(' ');
  const flip = { 'top-left': 'scale(1,1)', 'top-right': 'scale(-1,1)', 'bottom-left': 'scale(1,-1)', 'bottom-right': 'scale(-1,-1)' }[corner];
  return (
    <svg className="hw-web" width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" style={{ transform: `${flip} rotate(${tilt}deg)`, display: 'block' }}>
      {Array.from({ length: rays }, (_, index) => {
        const angle = (Math.PI / 2) * (index / (rays - 1));
        return <line key={index} x1="0" y1="0" x2={Math.cos(angle) * size} y2={Math.sin(angle) * size} />;
      })}
      {rings.map((radius) => <polygon key={radius} points={points(radius)} />)}
    </svg>
  );
}

function SpiderShape({ animated, size = 34 }) {
  const legs = [-55, -25, 10, 40];
  return (
    <svg width={size} height={size} viewBox="-30 -30 60 60" aria-hidden="true">
      {[-1, 1].map((side) => legs.map((angle, index) => {
        const radians = (angle * Math.PI) / 180;
        const knee = [side * 17 * Math.cos(radians), 17 * Math.sin(radians) - 7];
        const foot = [knee[0] + side * 8, knee[1] + 15];
        const points = `0,2 ${knee[0].toFixed(1)},${knee[1].toFixed(1)} ${foot[0].toFixed(1)},${foot[1].toFixed(1)}`;
        return (
          <g key={`${side}-${angle}`} className={animated ? (index % 2 ? 'hw-leg-a' : 'hw-leg-b') : undefined}>
            <polyline points={points} stroke="#8B7BC8" strokeWidth="3.8" fill="none" strokeLinejoin="round" strokeLinecap="round" />
            <polyline points={points} stroke="#1C1827" strokeWidth="2" fill="none" strokeLinejoin="round" strokeLinecap="round" />
          </g>
        );
      }))}
      <ellipse cx="0" cy="8" rx="9" ry="11" fill="#1C1827" stroke="#A78BFA" strokeWidth="1.4" />
      <circle cx="0" cy="-5" r="6" fill="#1C1827" stroke="#A78BFA" strokeWidth="1.4" />
      <circle cx="-2.2" cy="-6" r="1.3" fill="#F87171" />
      <circle cx="2.2" cy="-6" r="1.3" fill="#F87171" />
    </svg>
  );
}

function Pumpkin({ size, animated }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <ellipse cx="20" cy="38" rx="15" ry="20" fill="#C2410C" />
      <ellipse cx="44" cy="38" rx="15" ry="20" fill="#C2410C" />
      <ellipse cx="32" cy="38" rx="16" ry="22" fill="#F97316" />
      <path d="M30 17 L32 6 L39 4 L37 9 L35 17 Z" fill="#4D7C0F" />
      <g className={animated ? 'hw-pumpkin-glow' : undefined} fill="#FDE047">
        <path d="M19 34 L24 26 L29 34 Z" />
        <path d="M35 34 L40 26 L45 34 Z" />
        <path d="M16 42 L22 46 L26 42 L32 47 L38 42 L42 46 L48 42 L44 52 L32 55 L20 52 Z" />
      </g>
    </svg>
  );
}

function Bat({ delay }) {
  return (
    <svg className="hw-bat" width="34" height="18" viewBox="0 0 34 18" aria-hidden="true" style={{ animationDelay: `${delay}s` }}>
      <g className="hw-wing" style={{ animationDelay: `${delay}s` }}>
        <path d="M17 9 C12 1 5 2 0 6 C4 7 6 9 7 12 C10 9 13 9 17 12 C21 9 24 9 27 12 C28 9 30 7 34 6 C29 2 22 1 17 9 Z" fill="#1C1827" stroke="#A78BFA" strokeWidth="0.5" />
      </g>
      <circle cx="17" cy="10" r="2.6" fill="#1C1827" />
    </svg>
  );
}

function place(testId, fx, fy) {
  const section = document.querySelector(`[data-testid="${testId}"]`);
  if (!section) return null;
  const rect = section.getBoundingClientRect();
  return { top: rect.top + window.scrollY + rect.height * fy, left: rect.left + window.scrollX + rect.width * fx, width: rect.width };
}

export default function Halloween({ animated = true, random = Math.random }) {
  const layout = useMemo(() => halloweenLayout(random, { narrow: window.innerWidth < 700 }), [random]);
  const [spots, setSpots] = useState({ webs: [], pumpkins: [] });
  const [visitor, setVisitor] = useState(null);
  const counter = useRef(0);

  // Section webs and pumpkins follow their sections, which grow once data arrives.
  useEffect(() => {
    const measure = () => setSpots({
      webs: layout.sectionWebs.map((web) => {
        const spot = place(web.section, web.corner === 'top-left' ? 0 : 1, 0);
        return spot ? { ...web, top: spot.top, left: web.corner === 'top-left' ? spot.left : spot.left - web.size } : null;
      }).filter(Boolean),
      pumpkins: layout.pumpkins.map((pumpkin) => {
        const spot = place(pumpkin.section, pumpkin.side === 'left' ? 0.03 : 0.97, 1);
        return spot ? { ...pumpkin, top: spot.top - pumpkin.size - 18, left: pumpkin.side === 'left' ? spot.left : spot.left - pumpkin.size } : null;
      }).filter(Boolean),
    });
    measure();
    const later = [900, 2600, 6000].map((ms) => window.setTimeout(measure, ms));
    window.addEventListener('resize', measure);
    return () => {
      later.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener('resize', measure);
    };
  }, [layout]);

  // Now and then a spider or a few bats, never while the tab is in the background.
  useEffect(() => {
    if (!animated) return undefined;
    let timer = 0;
    const schedule = (first = false) => {
      const wait = first ? 5000 + random() * 7000 : 18000 + random() * 30000;
      timer = window.setTimeout(() => {
        if (!document.hidden) {
          counter.current += 1;
          const roll = random();
          const kind = roll < 0.45 ? 'drop' : (roll < 0.8 ? 'walk' : 'bats');
          setVisitor({
            id: counter.current,
            kind,
            x: 8 + Math.round(random() * 84),
            depth: 90 + Math.round(random() * 170),
            y: 20 + Math.round(random() * 22),
            time: kind === 'walk' ? 10 + random() * 4 : 6 + random() * 2,
          });
        }
        schedule();
      }, wait);
    };
    schedule(true);
    return () => window.clearTimeout(timer);
  }, [animated, random]);

  const done = () => setVisitor(null);
  const edge = (corner) => ({
    top: corner.startsWith('top') ? 64 : undefined,
    bottom: corner.startsWith('bottom') ? 78 : undefined,
    left: corner.endsWith('left') ? 0 : undefined,
    right: corner.endsWith('right') ? 0 : undefined,
  });

  return (
    <div className="hw-layer" data-testid="season-halloween" aria-hidden="true">
      <style>{css}</style>
      {layout.screenWebs.map((web) => (
        <div key={web.corner} data-testid="hw-screen-web" data-corner={web.corner} style={{ position: 'fixed', zIndex: -1, ...edge(web.corner) }}>
          <Web size={web.size} corner={web.corner} tilt={web.tilt} />
        </div>
      ))}
      {spots.webs.map((web) => (
        <div key={`${web.section}-${web.corner}`} data-testid="hw-section-web" style={{ position: 'absolute', zIndex: -1, top: web.top, left: web.left }}>
          <Web size={web.size} corner={web.corner} />
        </div>
      ))}
      {spots.pumpkins.map((pumpkin) => (
        <div key={pumpkin.section} data-testid="hw-pumpkin" style={{ position: 'absolute', zIndex: 2, top: pumpkin.top, left: pumpkin.left }}>
          <Pumpkin size={pumpkin.size} animated={animated} />
        </div>
      ))}
      {visitor?.kind === 'drop' ? (
        <div key={visitor.id} className="hw-drop" data-testid="hw-spider-drop" style={{ left: `${visitor.x}vw`, '--hw-depth': `${visitor.depth}px`, '--hw-time': `${visitor.time}s` }}>
          <div className="hw-drop-body" onAnimationEnd={done}>
            <div style={{ position: 'absolute', left: 19, bottom: 30, width: 1, height: 600, background: 'rgba(226,232,240,0.55)' }} />
            <SpiderShape animated />
          </div>
        </div>
      ) : null}
      {visitor?.kind === 'walk' ? (
        <div key={visitor.id} className="hw-walk" data-testid="hw-spider-walk" style={{ bottom: 84, left: 0, '--hw-time': `${visitor.time}s` }} onAnimationEnd={done}>
          <div style={{ transform: 'rotate(90deg)' }}><SpiderShape animated size={40} /></div>
        </div>
      ) : null}
      {visitor?.kind === 'bats' ? (
        <div key={visitor.id} className="hw-bats" data-testid="hw-bats" style={{ top: `${visitor.y}vh`, '--hw-time': `${visitor.time}s`, display: 'flex', gap: 26 }} onAnimationEnd={done}>
          {[0, 0.35, 0.7].map((delay) => <Bat key={delay} delay={delay} />)}
        </div>
      ) : null}
    </div>
  );
}
