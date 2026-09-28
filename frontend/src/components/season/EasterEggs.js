// OmniFM: the Easter egg hunt on the start page (#427, reworked in #448).
// Five eggs hide in the page itself, anew on every visit: peeking out from
// behind a card (the rest of the egg is behind it), at the end of a line of
// text or on the top edge of a card. Found eggs are kept in the browser for
// the year; the badge counts them.
import { useEffect, useState } from 'react';
import { useI18n } from '../../i18n.js';
import { findPeeks, findShelves, findTextEnds, seeded, watchPage } from './pageSpots.js';

export const EGG_COUNT = 5;
const EGG_COLORS = [['#FDBA74', '#EC4899'], ['#86EFAC', '#3B82F6'], ['#F9A8D4', '#F59E0B'], ['#93C5FD', '#EF4444'], ['#FDE68A', '#8B5CF6']];
// Only when the page has no room left (a tiny window): spots near the start page's sections.
const FALLBACK = [['hero-section', 0.08, 0.9], ['station-browser', 0.9, 0.05], ['why-omnifm-section', 0.1, 0.5], ['premium-section', 0.9, 0.95], ['faq-section', 0.1, 0.12]];
export const EGG_FALLBACK_SECTIONS = FALLBACK.map(([testId]) => testId);

export const eggsKey = (year) => `omnifm.easterEggs.${year}`;

function shuffled(list, random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

/** Where this visit's eggs hide on a measured page; fewer than five when the page has no more room. */
export function easterSpots(page, random) {
  const small = page.width < 700;
  const size = small ? 24 : 28;
  const spacing = small ? 180 : 260;
  // Chance decides the mix: more behind cards, or more in the texts.
  const behind = 2 + Math.floor(random() * 2);
  const peeks = findPeeks(page, random, { count: behind, size, spacing }).map((spot) => ({ type: 'peek', ...spot }));
  const texts = findTextEnds(page, random, { count: EGG_COUNT - peeks.length, size: small ? 16 : 18, spacing, avoid: peeks })
    .map((spot) => ({ type: 'text', ...spot }));
  let spots = [...peeks, ...texts];
  if (spots.length < EGG_COUNT) {
    spots = spots.concat(findShelves(page, random, { count: EGG_COUNT - spots.length, size: 22, spacing, avoid: spots }).map((spot) => ({ type: 'shelf', ...spot })));
  }
  if (spots.length < EGG_COUNT) {
    spots = spots.concat(findPeeks(page, random, { count: EGG_COUNT - spots.length, size: 22, spacing: spacing / 2, avoid: spots }).map((spot) => ({ type: 'peek', ...spot })));
  }
  return shuffled(spots.slice(0, EGG_COUNT), random).map((spot) => ({ ...spot, tilt: (random() - 0.5) * 34 }));
}

function fallbackSpot(index) {
  const [testId, fx, fy] = FALLBACK[index];
  const section = document.querySelector(`[data-testid="${testId}"]`);
  const rect = section?.getBoundingClientRect?.() || { left: 0, top: 0, width: 0, height: 0 };
  return {
    type: 'fallback',
    x: Math.min((window.innerWidth || 40) - 40, Math.max(8, rect.left + window.scrollX + rect.width * fx)),
    y: rect.top + window.scrollY + rect.height * fy,
    tilt: 0,
  };
}

function EggShape({ colors, width, height }) {
  return (
    <svg width={width} height={height} viewBox="0 0 30 36" aria-hidden="true" style={{ display: 'block' }}>
      <ellipse cx="15" cy="19" rx="12" ry="16" fill={colors[0]} />
      <path d="M4 16 L9 12 L14 16 L19 12 L24 16 L26 14" stroke={colors[1]} strokeWidth="2.4" fill="none" />
      <rect x="3" y="22" width="24" height="3.5" fill={colors[1]} opacity="0.7" />
      <ellipse cx="10.5" cy="11" rx="2.6" ry="4" fill="#FFFFFF" opacity="0.35" />
    </svg>
  );
}

// Where the button goes and where the egg sits in it, so the part behind the card is cut off.
function frame(spot) {
  if (spot.type === 'peek') {
    const { visible, side, size } = spot;
    const tall = size * 1.25;
    const inner = {
      top: { left: 0, top: 0 },
      bottom: { left: 0, top: visible.h - tall },
      left: { left: 0, top: 0 },
      right: { left: visible.w - size, top: 0 },
    }[side];
    return { box: { left: visible.x, top: visible.y, width: visible.w, height: visible.h, overflow: 'hidden' }, egg: { ...inner, width: size, height: tall } };
  }
  if (spot.type === 'text') return { box: { left: spot.x, top: spot.y, width: spot.w, height: spot.h }, egg: { left: 0, top: 0, width: spot.w, height: spot.h } };
  if (spot.type === 'shelf') {
    const width = spot.size * 0.85;
    const height = spot.size * 1.05;
    return { box: { left: spot.x, top: spot.y - height * 0.97, width, height }, egg: { left: 0, top: 0, width, height } };
  }
  return { box: { left: spot.x, top: spot.y, width: 30, height: 36 }, egg: { left: 0, top: 0, width: 30, height: 36 } };
}

export default function EasterEggs({ found, onFind, animated, random = Math.random }) {
  const { t } = useI18n();
  const [spots, setSpots] = useState([]);
  const [hopping, setHopping] = useState('');

  useEffect(() => {
    const seed = Math.floor(random() * 2 ** 31);
    return watchPage((page) => {
      const measured = easterSpots(page, seeded(seed));
      const all = Array.from({ length: EGG_COUNT }, (_, index) => measured[index] || fallbackSpot(index));
      setSpots(all.map((spot, index) => ({ ...spot, id: `egg-${index + 1}`, colors: EGG_COLORS[index] })));
    }, { delays: [0, 900, 2600, 6000] });
  }, [random]);

  const collect = (id) => {
    if (found.includes(id)) return;
    setHopping(id);
    window.setTimeout(() => setHopping(''), 700);
    onFind(id);
  };

  return (
    <div data-season-skip="" data-testid="season-eggs">
      {spots.filter((spot) => !found.includes(spot.id) || hopping === spot.id).map((spot) => {
        const place = frame(spot);
        return (
          <button
            key={spot.id}
            type="button"
            data-testid={`season-${spot.id}`}
            data-hide={spot.type === 'peek' ? `behind-${spot.side}` : spot.type}
            className={`season-egg ${hopping === spot.id ? 'season-egg-found' : ''}`}
            style={{ position: 'absolute', zIndex: 30, padding: 0, border: 'none', background: 'none', cursor: 'pointer', ...place.box }}
            aria-label={t('Osterei', 'Easter egg')}
            onClick={() => collect(spot.id)}
          >
            <span
              className={animated && hopping !== spot.id ? 'season-egg-anim' : undefined}
              style={{ position: 'absolute', ...place.egg, transform: `rotate(${spot.tilt.toFixed(1)}deg)`, animationDelay: `${(Number(spot.id.slice(4)) * 0.7) % 3.2}s` }}
            >
              <EggShape colors={spot.colors} width={place.egg.width} height={place.egg.height} />
            </span>
          </button>
        );
      })}
    </div>
  );
}
