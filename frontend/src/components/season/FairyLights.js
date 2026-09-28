// OmniFM: the fairy lights under the menu in Advent and at Christmas (#427,
// reworked in #448): a wire that sags between hooks, with glowing bulbs
// along it, as many as the screen is wide. They twinkle, unless the device
// asked for less motion.
import { useEffect, useState } from 'react';

const COLORS = ['#FF2A5F', '#FBBF24', '#34D399', '#38BDF8', '#F472B6', '#FB923C'];

/** The wire's hooks and the bulbs along it for a screen this wide. Pure, for the test. */
export function lightString(width, random = Math.random) {
  const hooks = Math.max(2, Math.round(width / 180));
  const span = width / hooks;
  const sag = Math.min(18, span * 0.1);
  const perSpan = Math.max(3, Math.round(span / 42));
  const bulbs = [];
  let wire = 'M0 2';
  for (let hook = 0; hook < hooks; hook += 1) {
    const x0 = hook * span;
    const x1 = x0 + span;
    // A quadratic curve whose lowest point sits `sag` below the hooks.
    wire += ` Q${(x0 + span / 2).toFixed(1)} ${(2 + sag * 2).toFixed(1)} ${x1.toFixed(1)} 2`;
    for (let index = 0; index < perSpan; index += 1) {
      const t = (index + 0.5) / perSpan;
      const x = x0 + span * t;
      const y = 2 + 2 * sag * 2 * t * (1 - t);
      bulbs.push({ x, y, color: COLORS[Math.floor(random() * COLORS.length)], delay: random() * 2.4, lean: (random() - 0.5) * 16 });
    }
  }
  return { wire, bulbs };
}

export default function FairyLights({ animated }) {
  const [width, setWidth] = useState(() => window.innerWidth || 1200);
  const [string, setString] = useState(() => lightString(window.innerWidth || 1200));
  useEffect(() => {
    let timer = 0;
    const onResize = () => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        setWidth(window.innerWidth);
        setString(lightString(window.innerWidth));
      }, 200);
    };
    window.addEventListener('resize', onResize);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('resize', onResize);
    };
  }, []);

  return (
    <svg
      data-testid="season-lights"
      data-season-skip=""
      aria-hidden="true"
      width={width}
      height={46}
      viewBox={`0 0 ${width} 46`}
      style={{ position: 'fixed', top: 64, left: 0, zIndex: 49, pointerEvents: 'none', overflow: 'visible' }}
    >
      <path d={string.wire} stroke="#1F3B2A" strokeWidth="1.8" fill="none" />
      {string.bulbs.map((bulb, index) => (
        <g key={index} transform={`translate(${bulb.x.toFixed(1)} ${bulb.y.toFixed(1)}) rotate(${bulb.lean.toFixed(1)})`}>
          <rect x="-1.8" y="0" width="3.6" height="4" rx="0.8" fill="#27272A" />
          <g className={animated ? 'season-bulb season-bulb-anim' : 'season-bulb'} style={{ animationDelay: `${bulb.delay.toFixed(2)}s` }}>
            <circle cx="0" cy="9.5" r="9" fill={bulb.color} opacity="0.22" />
            <ellipse cx="0" cy="9.5" rx="3.4" ry="5.4" fill={bulb.color} />
            <ellipse cx="-1" cy="8" rx="1" ry="2" fill="#FFFFFF" opacity="0.55" />
          </g>
        </g>
      ))}
    </svg>
  );
}
