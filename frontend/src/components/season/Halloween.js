// OmniFM: Halloween on the start page (#443, reworked in #448), part of the
// decoration's own download. Round cobwebs spun into open space and tied to
// the page's cards, jack-o'-lanterns sitting on the top edge of a card, now
// and then a spider that lets itself down from a web or crawls along above
// the player bar, and bats that flutter past. Placed anew for every visit and
// every width, never over text or buttons: nothing here takes a click. With
// "less motion" only the webs and pumpkins stay, still.
import { useEffect, useRef, useState } from 'react';
import { findShelves, findWebSpots, seeded, watchPage } from './pageSpots.js';

const css = `
.hw-layer { pointer-events: none; }
.hw-layer * { pointer-events: none; }
.hw-web { position: absolute; overflow: visible; filter: drop-shadow(0 0 1.5px rgba(210, 225, 255, 0.28)); }
.hw-web .hw-thread { stroke: rgba(228, 234, 245, 0.46); stroke-width: 1.1; fill: none; stroke-linecap: round; }
.hw-web .hw-spiral { stroke: rgba(228, 234, 245, 0.34); stroke-width: 0.9; fill: none; }
.hw-web .hw-anchor { stroke: rgba(228, 234, 245, 0.34); stroke-width: 1; fill: none; }
.hw-web .hw-dew { fill: rgba(255, 255, 255, 0.9); }
.hw-sway { animation: hw-sway var(--hw-sway, 7s) ease-in-out infinite alternate; }
@keyframes hw-sway { from { transform: rotate(-1.1deg); } to { transform: rotate(1.1deg); } }
.hw-dew-anim { animation: hw-glisten 2.8s ease-in-out infinite; }
@keyframes hw-glisten { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
.hw-pumpkin-glow { animation: hw-flicker 2.2s ease-in-out infinite alternate; }
@keyframes hw-flicker { 0% { opacity: 0.75; } 40% { opacity: 1; } 55% { opacity: 0.6; } 100% { opacity: 0.95; } }
.hw-leg-a { animation: hw-legs 0.32s ease-in-out infinite alternate; transform-origin: 50% 40%; }
.hw-leg-b { animation: hw-legs 0.32s ease-in-out infinite alternate-reverse; transform-origin: 50% 40%; }
@keyframes hw-legs { from { transform: rotate(-9deg); } to { transform: rotate(9deg); } }
.hw-drop { width: 40px; overflow: visible; }
.hw-drop-body { animation: hw-drop var(--hw-time, 7s) ease-in-out forwards; }
@keyframes hw-drop { 0% { transform: translateY(-50px); } 30%, 62% { transform: translateY(var(--hw-depth, 160px)); }
  46% { transform: translateY(calc(var(--hw-depth, 160px) - 14px)); } 100% { transform: translateY(-50px); } }
.hw-walk { position: fixed; z-index: 45; animation: hw-walk var(--hw-time, 11s) linear forwards; }
@keyframes hw-walk { from { transform: translateX(-70px); } to { transform: translateX(calc(100vw + 70px)); } }
.hw-bats { position: fixed; left: 0; z-index: 45; animation: hw-fly var(--hw-time, 7s) linear forwards; }
@keyframes hw-fly { from { transform: translateX(-120px); } to { transform: translateX(calc(100vw + 120px)); } }
.hw-bat { animation: hw-bob 1.1s ease-in-out infinite alternate; }
@keyframes hw-bob { from { transform: translateY(-10px); } to { transform: translateY(12px); } }
.hw-wing { animation: hw-flap 0.22s ease-in-out infinite alternate; transform-origin: 50% 50%; }
@keyframes hw-flap { from { transform: scaleY(1); } to { transform: scaleY(0.35); } }
`;

/** How many webs and pumpkins (a range, chance picks) and how big, for a page this wide. */
export function halloweenSizes(width) {
  if (width < 700) return { webs: { min: 1, max: 2, minRadius: 20, maxRadius: 32, maxAnchor: 120, spacing: 420 }, pumpkins: { min: 1, max: 2, size: 32 } };
  if (width < 1100) return { webs: { min: 2, max: 3, minRadius: 28, maxRadius: 50, maxAnchor: 180, spacing: 380 }, pumpkins: { min: 1, max: 3, size: 38 } };
  if (width < 1800) return { webs: { min: 2, max: 4, minRadius: 32, maxRadius: 68, maxAnchor: 230, spacing: 380 }, pumpkins: { min: 2, max: 4, size: 44 } };
  return { webs: { min: 3, max: 5, minRadius: 36, maxRadius: 86, maxAnchor: 300, spacing: 420 }, pumpkins: { min: 2, max: 5, size: 48 } };
}

const between = (random, low, high) => low + Math.floor(random() * (high - low + 1));

/** The look of one round web: its spokes, the spiral's turns and a few dew drops. */
export function webShape(random, radius) {
  const count = 11 + Math.floor(random() * 7);
  const turn = random() * Math.PI * 2;
  const spokes = Array.from({ length: count }, (_, index) => ({
    angle: turn + (index / count) * Math.PI * 2 + (random() - 0.5) * 0.24,
    length: radius * (0.86 + random() * 0.14),
  }));
  return {
    spokes,
    // Real webs are rarely perfect circles.
    squash: 0.86 + random() * 0.2,
    turns: 7 + Math.floor(random() * 5),
    dew: Array.from({ length: 4 + Math.floor(random() * 3) }, () => ({ spoke: Math.floor(random() * count), at: 0.3 + random() * 0.6, delay: random() * 2.8 })),
    sway: 5 + random() * 4,
  };
}

/** The whole Halloween layout for one measured page. */
export function halloweenLayout(page, random) {
  const sizes = halloweenSizes(page.width);
  const { min, max, ...webOptions } = sizes.webs;
  const webs = findWebSpots(page, random, { ...webOptions, count: between(random, min, max) }).map((web) => ({ ...web, shape: webShape(random, web.r) }));
  const avoid = webs.map((web) => ({ x: web.cx, y: web.cy }));
  const pumpkins = findShelves(page, random, { count: between(random, sizes.pumpkins.min, sizes.pumpkins.max), size: sizes.pumpkins.size, avoid })
    // Each its own size: the seat was measured for the biggest.
    .map((spot) => ({ ...spot, size: Math.round(spot.size * (0.72 + random() * 0.28)) }));
  // Sometimes a spider rests in one of the webs.
  const resting = page.width >= 700 && webs.length && random() < 0.7 ? Math.floor(random() * webs.length) : -1;
  return { webs, pumpkins, resting };
}

function spiralPath(shape, radius, cx, cy) {
  const count = shape.spokes.length;
  const steps = shape.turns * count;
  const point = (step) => {
    const spoke = shape.spokes[step % count];
    const rho = Math.min(spoke.length * 0.96, radius * (0.14 + (0.8 * step) / steps));
    return [cx + Math.cos(spoke.angle) * rho, cy + Math.sin(spoke.angle) * rho * (shape.squash || 1)];
  };
  let [px, py] = point(0);
  let path = `M${px.toFixed(1)} ${py.toFixed(1)}`;
  for (let step = 1; step <= steps; step += 1) {
    const [x, y] = point(step);
    // The thread between two spokes sags a little towards the hub.
    const mx = cx + ((px + x) / 2 - cx) * 0.9;
    const my = cy + ((py + y) / 2 - cy) * 0.9;
    path += ` Q${mx.toFixed(1)} ${my.toFixed(1)} ${x.toFixed(1)} ${y.toFixed(1)}`;
    [px, py] = [x, y];
  }
  return path;
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

/** A round web with its threads to the page; drawn whole, never cut. */
function OrbWeb({ web, animated, resting }) {
  const { cx, cy, r, anchors, shape } = web;
  const xs = [cx - r, cx + r, ...anchors.map((anchor) => anchor.x)];
  const ys = [cy - r, cy + r, ...anchors.map((anchor) => anchor.y)];
  // A little room for the line ends, but never past the page's edge (no sideways scrolling).
  const left = Math.max(0, Math.min(...xs) - 3);
  const top = Math.min(...ys) - 3;
  const width = Math.min(web.limit || Infinity, Math.max(...xs) + 3) - left;
  const height = Math.max(...ys) - top + 3;
  const x0 = cx - left;
  const y0 = cy - top;
  const squash = shape.squash || 1;
  const ends = shape.spokes.map((spoke) => [x0 + Math.cos(spoke.angle) * spoke.length, y0 + Math.sin(spoke.angle) * spoke.length * squash]);
  return (
    <svg className="hw-web" data-testid="hw-web" width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true" style={{ left, top, zIndex: 1 }}>
      {anchors.map((anchor, index) => (
        <line
          key={`anchor-${index}`}
          className="hw-anchor"
          x1={(x0 + Math.cos(anchor.angle) * r * 0.9).toFixed(1)}
          y1={(y0 + Math.sin(anchor.angle) * r * 0.9 * squash).toFixed(1)}
          x2={(anchor.x - left).toFixed(1)}
          y2={(anchor.y - top).toFixed(1)}
        />
      ))}
      <g className={animated ? 'hw-sway' : undefined} style={{ transformOrigin: `${x0}px ${y0}px`, '--hw-sway': `${shape.sway.toFixed(1)}s` }}>
        {ends.map(([x, y], index) => <line key={`spoke-${index}`} className="hw-thread" x1={x0} y1={y0} x2={x.toFixed(1)} y2={y.toFixed(1)} />)}
        <polygon className="hw-thread" points={ends.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' ')} />
        <path className="hw-spiral" d={spiralPath(shape, r, x0, y0)} />
        <circle className="hw-thread" cx={x0} cy={y0} r={(r * 0.07).toFixed(1)} />
        {shape.dew.map((drop, index) => {
          const spoke = shape.spokes[drop.spoke];
          return (
            <circle
              key={`dew-${index}`}
              className={animated ? 'hw-dew hw-dew-anim' : 'hw-dew'}
              cx={(x0 + Math.cos(spoke.angle) * spoke.length * drop.at).toFixed(1)}
              cy={(y0 + Math.sin(spoke.angle) * spoke.length * drop.at * squash).toFixed(1)}
              r={1.4}
              style={{ animationDelay: `${drop.delay.toFixed(2)}s` }}
            />
          );
        })}
        {resting ? (
          <g transform={`translate(${(x0 - 11).toFixed(1)} ${(y0 - 11).toFixed(1)})`} data-testid="hw-resting-spider">
            <SpiderShape animated={false} size={22} />
          </g>
        ) : null}
      </g>
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

// A web in sight to let a spider down from, else null.
function webInSight(webs) {
  const top = window.scrollY + 110;
  const bottom = window.scrollY + window.innerHeight - 220;
  return webs.find((web) => web.cy > top && web.cy < bottom) || null;
}

export default function Halloween({ animated = true, random = Math.random }) {
  const [decor, setDecor] = useState({ webs: [], pumpkins: [], resting: -1 });
  const [visitor, setVisitor] = useState(null);
  const counter = useRef(0);
  const websRef = useRef([]);

  // Measured once the page has settled and again when it changes; the same
  // visit keeps its seed, so the webs do not jump around.
  useEffect(() => {
    const seed = Math.floor(random() * 2 ** 31);
    return watchPage((page) => {
      const layout = halloweenLayout(page, seeded(seed));
      websRef.current = layout.webs;
      setDecor(layout);
    });
  }, [random]);

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
          const web = kind === 'drop' ? webInSight(websRef.current) : null;
          const wide = window.innerWidth >= 1300;
          const edge = random() < 0.5 ? 2 + random() * 8 : 90 + random() * 8;
          setVisitor({
            id: counter.current,
            kind,
            web,
            // Without a web in sight, from under the menu: at the edges of a wide screen, anywhere on a small one.
            x: wide ? edge : 8 + Math.round(random() * 84),
            depth: web ? 80 + Math.round(random() * 110) : 90 + Math.round(random() * 170),
            y: 12 + Math.round(random() * 36),
            time: kind === 'walk' ? 9 + random() * 6 : 5 + random() * 3.5,
            size: 28 + Math.round(random() * 14),
            reverse: random() < 0.5,
            bats: 2 + Math.floor(random() * 4),
          });
        }
        schedule();
      }, wait);
    };
    schedule(true);
    return () => window.clearTimeout(timer);
  }, [animated, random]);

  const done = () => setVisitor(null);

  return (
    <div className="hw-layer" data-testid="season-halloween" data-season-skip="" aria-hidden="true">
      <style>{css}</style>
      {decor.webs.map((web, index) => (
        <OrbWeb key={`${Math.round(web.cx)}-${Math.round(web.cy)}`} web={web} animated={animated} resting={index === decor.resting} />
      ))}
      {decor.pumpkins.map((pumpkin) => (
        <div key={`${Math.round(pumpkin.x)}-${Math.round(pumpkin.y)}`} data-testid="hw-pumpkin" style={{ position: 'absolute', zIndex: 2, left: pumpkin.x, top: pumpkin.y - pumpkin.size * (58 / 64), width: pumpkin.size, height: pumpkin.size, transform: `rotate(${(pumpkin.tilt || 0).toFixed(1)}deg)`, transformOrigin: '50% 90%' }}>
          <div style={{ position: 'absolute', left: -pumpkin.size * 0.3, right: -pumpkin.size * 0.3, bottom: pumpkin.size * 0.02, height: pumpkin.size * 0.4, background: 'radial-gradient(ellipse at 50% 100%, rgba(249,115,22,0.38), transparent 70%)' }} />
          <Pumpkin size={pumpkin.size} animated={animated} />
        </div>
      ))}
      {visitor?.kind === 'drop' ? (
        <div
          key={visitor.id}
          className="hw-drop"
          data-testid="hw-spider-drop"
          // From a web the spider comes out of the hub (its thread ends there); else from under the menu.
          style={visitor.web
            ? { position: 'absolute', zIndex: 3, left: visitor.web.cx - 20, top: visitor.web.cy, height: visitor.depth + 48, overflow: 'hidden', '--hw-depth': `${visitor.depth}px`, '--hw-time': `${visitor.time}s` }
            : { position: 'fixed', zIndex: 45, top: 64, left: `${visitor.x}vw`, '--hw-depth': `${visitor.depth}px`, '--hw-time': `${visitor.time}s` }}
        >
          <div className="hw-drop-body" onAnimationEnd={done}>
            <div style={{ position: 'absolute', left: 19, bottom: 30, width: 1, height: 600, background: 'rgba(226,232,240,0.55)' }} />
            <SpiderShape animated size={visitor.size} />
          </div>
        </div>
      ) : null}
      {visitor?.kind === 'walk' ? (
        // Along the bottom, above the player bar while it is there.
        <div key={visitor.id} className="hw-walk" data-testid="hw-spider-walk" style={{ bottom: 'calc(var(--omnifm-bottom-bar, 74px) + 6px)', left: 0, '--hw-time': `${visitor.time}s`, animationDirection: visitor.reverse ? 'reverse' : 'normal' }} onAnimationEnd={done}>
          <div style={{ transform: `rotate(${visitor.reverse ? -90 : 90}deg)` }}><SpiderShape animated size={visitor.size + 6} /></div>
        </div>
      ) : null}
      {visitor?.kind === 'bats' ? (
        <div key={visitor.id} className="hw-bats" data-testid="hw-bats" style={{ top: `${visitor.y}vh`, '--hw-time': `${visitor.time}s`, display: 'flex', gap: 26, animationDirection: visitor.reverse ? 'reverse' : 'normal' }} onAnimationEnd={done}>
          {Array.from({ length: visitor.bats }, (_, index) => (
            <div key={index} style={{ transform: `translateY(${((index * 37) % 23) - 11}px) scaleX(${visitor.reverse ? -1 : 1})` }}>
              <Bat delay={(index * 0.29) % 1} />
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
