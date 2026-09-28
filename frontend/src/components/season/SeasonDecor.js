// OmniFM: the seasonal decoration of the start page (#427), its own
// download that only loads in a season (App.js). Snow and fairy lights in
// Advent and at Christmas, the Advent wreath in the hero, five hidden Easter
// eggs, the New Year countdown with fireworks. Whoever asked the device for
// less motion sees it standing still; "Deko ausblenden" hides all of it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n.js';
import Halloween from './Halloween.js';

const css = `
.season-bulb { width: 7px; height: 10px; border-radius: 50% 50% 45% 45%; margin-top: 4px; }
.season-bulb-anim { animation: season-twinkle 2.4s ease-in-out infinite; }
@keyframes season-twinkle { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.season-flame { transform-origin: 50% 100%; }
.season-flame-anim { animation: season-flicker 1.1s ease-in-out infinite alternate; }
@keyframes season-flicker { from { transform: scale(1, 1); } to { transform: scale(0.86, 1.12); } }
.season-egg { position: absolute; z-index: 30; width: 30px; height: 36px; padding: 0; border: none; background: none; cursor: pointer; }
.season-egg:focus-visible { outline: 2px solid #00e5ff; outline-offset: 3px; border-radius: 50%; }
.season-egg-anim { animation: season-wobble 3.2s ease-in-out infinite; transform-origin: 50% 90%; }
.season-egg-found { animation: season-hop 0.6s ease-out forwards; }
@keyframes season-wobble { 0%, 86%, 100% { transform: rotate(0deg); } 90% { transform: rotate(-12deg); } 95% { transform: rotate(10deg); } }
@keyframes season-hop { 0% { transform: translateY(0) scale(1); opacity: 1; } 60% { transform: translateY(-26px) scale(1.2); opacity: 1; } 100% { transform: translateY(-40px) scale(0.4); opacity: 0; } }
.season-badge { position: absolute; top: 84px; right: 24px; z-index: 3; display: inline-flex; align-items: center; gap: 10px;
  padding: 8px 16px; border-radius: 999px; background: rgba(10,10,14,0.72); border: 1px solid rgba(255,255,255,0.14);
  color: #F4F4F5; font-size: 14px; font-weight: 700; backdrop-filter: blur(6px); }
@media (max-width: 900px) { .season-badge { top: 74px; right: 50%; transform: translateX(50%); white-space: nowrap; } }
.season-hide { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; padding: 3px 8px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.16); background: transparent; color: #A1A1AA; font-size: 11px; font-weight: 600; cursor: pointer; }
.season-hide:hover { color: #fff; border-color: rgba(255,255,255,0.32); }
`;

const LIGHT_COLORS = ['#FF2A5F', '#FBBF24', '#34D399', '#38BDF8'];
const EGG_COLORS = [['#FDBA74', '#EC4899'], ['#86EFAC', '#3B82F6'], ['#F9A8D4', '#F59E0B'], ['#93C5FD', '#EF4444'], ['#FDE68A', '#8B5CF6']];
// Where the eggs hide: a section of the start page and a spot in it, as a share of its width and height.
export const EGG_SPOTS = [
  ['hero-section', 0.05, 0.84],
  ['station-browser', 0.94, 0.07],
  ['why-omnifm-section', 0.03, 0.55],
  ['premium-section', 0.95, 0.92],
  ['faq-section', 0.07, 0.1],
];
const eggsKey = (year) => `omnifm.easterEggs.${year}`;
const fireworksKey = (year) => `omnifm.newYearFireworks.${year}`;

function readJson(key, fallback) {
  try {
    return JSON.parse(window.localStorage.getItem(key) || 'null') ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key, value) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // The page still works; the eggs start over next time.
  }
}

/** Falling snow on a canvas; stops while the tab is in the background. */
function Snow() {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext?.('2d');
    if (!context) return undefined;
    let width = 0;
    let height = 0;
    let frame = 0;
    let running = false;
    const flakes = [];
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = width;
      canvas.height = height;
    };
    resize();
    for (let index = 0; index < Math.min(70, Math.round(width / 22)); index += 1) {
      flakes.push({ x: Math.random() * width, y: Math.random() * height, r: 1 + Math.random() * 2.2, speed: 0.3 + Math.random() * 0.8, drift: Math.random() * 6.28 });
    }
    const tick = () => {
      if (!running) return;
      context.clearRect(0, 0, width, height);
      context.fillStyle = 'rgba(255,255,255,0.75)';
      for (const flake of flakes) {
        flake.y += flake.speed;
        flake.drift += 0.012;
        flake.x += Math.sin(flake.drift) * 0.35;
        if (flake.y > height + 4) {
          flake.y = -4;
          flake.x = Math.random() * width;
        }
        context.beginPath();
        context.arc(flake.x, flake.y, flake.r, 0, Math.PI * 2);
        context.fill();
      }
      frame = window.requestAnimationFrame(tick);
    };
    const start = () => {
      if (running || document.hidden) return;
      running = true;
      frame = window.requestAnimationFrame(tick);
    };
    const stop = () => {
      running = false;
      window.cancelAnimationFrame(frame);
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    // After the page has settled, so the first paint is not slower.
    const delay = window.setTimeout(start, 1500);
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.clearTimeout(delay);
      stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, []);
  return <canvas ref={ref} data-testid="season-snow" aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 40 }} />;
}

/** Sparks (fireworks) or confetti, once, for a few seconds. */
function Burst({ kind, onDone }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext?.('2d');
    if (!context) {
      onDone?.();
      return undefined;
    }
    const width = window.innerWidth;
    const height = window.innerHeight;
    canvas.width = width;
    canvas.height = height;
    const colors = ['#FBBF24', '#FF2A5F', '#00E5FF', '#34D399', '#F472B6', '#FF6B00'];
    const particles = [];
    const addRocket = (x, y) => {
      const color = colors[Math.floor(Math.random() * colors.length)];
      for (let index = 0; index < 46; index += 1) {
        const angle = (Math.PI * 2 * index) / 46;
        const speed = 2 + Math.random() * 3;
        particles.push({ x, y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, life: 70 + Math.random() * 30, color, size: 2.4 });
      }
    };
    if (kind === 'confetti') {
      for (let index = 0; index < 140; index += 1) {
        particles.push({ x: Math.random() * width, y: -20 - Math.random() * height * 0.4, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3, life: 180, color: colors[index % colors.length], size: 4 + Math.random() * 4, spin: Math.random() * 6.28 });
      }
    }
    let frame = 0;
    let tick = 0;
    const step = () => {
      tick += 1;
      if (kind === 'fireworks' && tick % 28 === 1 && tick < 250) addRocket(width * (0.2 + Math.random() * 0.6), height * (0.18 + Math.random() * 0.3));
      context.clearRect(0, 0, width, height);
      for (const particle of particles) {
        if (particle.life <= 0) continue;
        particle.life -= 1;
        particle.x += particle.vx;
        particle.y += particle.vy;
        if (kind === 'fireworks') {
          particle.vy += 0.04;
          particle.vx *= 0.985;
          context.globalAlpha = Math.max(0, particle.life / 100);
          context.fillStyle = particle.color;
          context.fillRect(particle.x, particle.y, particle.size, particle.size);
        } else {
          particle.spin += 0.1;
          context.globalAlpha = 1;
          context.fillStyle = particle.color;
          context.save();
          context.translate(particle.x, particle.y);
          context.rotate(particle.spin);
          context.fillRect(-particle.size / 2, -particle.size / 4, particle.size, particle.size / 2);
          context.restore();
        }
      }
      context.globalAlpha = 1;
      if (tick < (kind === 'fireworks' ? 330 : 200)) frame = window.requestAnimationFrame(step);
      else onDone?.();
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [kind, onDone]);
  return <canvas ref={ref} data-testid={`season-${kind}`} aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 61 }} />;
}

function FairyLights({ animated }) {
  return (
    <div data-testid="season-lights" aria-hidden="true" style={{ position: 'fixed', top: 64, left: 0, right: 0, height: 16, zIndex: 49, pointerEvents: 'none', display: 'flex', justifyContent: 'space-around', borderTop: '1px solid rgba(255,255,255,0.12)' }}>
      {Array.from({ length: 26 }, (_, index) => (
        <span
          key={index}
          className={animated ? 'season-bulb season-bulb-anim' : 'season-bulb'}
          style={{ background: LIGHT_COLORS[index % LIGHT_COLORS.length], boxShadow: `0 0 8px ${LIGHT_COLORS[index % LIGHT_COLORS.length]}`, animationDelay: `${(index % 6) * 0.4}s` }}
        />
      ))}
    </div>
  );
}

function Wreath({ lit, animated, label }) {
  const candles = [0, 1, 2, 3];
  return (
    <svg width="74" height="44" viewBox="0 0 74 44" role="img" aria-label={label} data-testid="season-wreath" data-lit={lit}>
      <ellipse cx="37" cy="36" rx="34" ry="7" fill="#166534" />
      <ellipse cx="37" cy="35" rx="30" ry="5" fill="#15803D" />
      {[8, 20, 32, 46, 58, 66].map((x) => <circle key={x} cx={x} cy={x % 2 ? 37 : 34} r="2.2" fill="#DC2626" />)}
      {candles.map((index) => {
        const x = 13 + index * 16;
        return (
          <g key={index}>
            <rect x={x - 3.5} y="14" width="7" height="20" rx="1.5" fill={index < lit ? '#B91C1C' : '#7F1D1D'} />
            {index < lit ? (
              <path className={animated ? 'season-flame season-flame-anim' : 'season-flame'} d={`M${x} 3 C${x + 4} 8 ${x + 3} 12 ${x} 13 C${x - 3} 12 ${x - 4} 8 ${x} 3 Z`} fill="#FBBF24" style={{ animationDelay: `${index * 0.23}s` }} />
            ) : (
              <rect x={x - 0.6} y="10" width="1.2" height="4" fill="#3F3F46" />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function clock(seconds) {
  const safe = Math.max(0, Math.floor(seconds));
  const pad = (value) => String(value).padStart(2, '0');
  return `${pad(Math.floor(safe / 3600))}:${pad(Math.floor((safe % 3600) / 60))}:${pad(safe % 60)}`;
}

/** The New Year countdown in the hero; at zero it hands over to the fireworks. */
function Countdown({ season, onMidnight }) {
  const { t } = useI18n();
  const [end] = useState(() => Date.now() + (season.secondsToMidnight || 0) * 1000);
  const [left, setLeft] = useState(() => (end - Date.now()) / 1000);
  useEffect(() => {
    const timer = window.setInterval(() => {
      const next = (end - Date.now()) / 1000;
      setLeft(next);
      if (next <= 0) {
        window.clearInterval(timer);
        onMidnight?.();
      }
    }, 1000);
    return () => window.clearInterval(timer);
  }, [end, onMidnight]);
  if (left <= 0) return <span>🥂 {t('Frohes neues Jahr {year}!', 'Happy New Year {year}!', { year: season.year })}</span>;
  return <span data-testid="season-countdown">🎆 {t('Noch {time} bis {year}', '{time} until {year}', { time: clock(left), year: season.year })}</span>;
}

function EasterEggs({ season, animated, onAllFound }) {
  const { t } = useI18n();
  const [found, setFound] = useState(() => readJson(eggsKey(season.year), []));
  const [spots, setSpots] = useState([]);
  const [hopping, setHopping] = useState('');

  useEffect(() => {
    const place = () => setSpots(EGG_SPOTS.map(([testId, fx, fy], index) => {
      const section = document.querySelector(`[data-testid="${testId}"]`);
      if (!section) return null;
      const rect = section.getBoundingClientRect();
      const left = Math.min(window.innerWidth - 40, Math.max(8, rect.left + window.scrollX + rect.width * fx));
      return { id: `egg-${index + 1}`, top: rect.top + window.scrollY + rect.height * fy, left, colors: EGG_COLORS[index] };
    }).filter(Boolean));
    place();
    // The sections grow once stations and plans arrive.
    const later = [800, 2500, 6000].map((ms) => window.setTimeout(place, ms));
    window.addEventListener('resize', place);
    return () => {
      later.forEach((timer) => window.clearTimeout(timer));
      window.removeEventListener('resize', place);
    };
  }, []);

  const collect = (id) => {
    if (found.includes(id)) return;
    const next = [...found, id];
    setHopping(id);
    window.setTimeout(() => setHopping(''), 700);
    setFound(next);
    writeJson(eggsKey(season.year), next);
    if (next.length === EGG_SPOTS.length) onAllFound?.();
  };

  return spots.filter((spot) => !found.includes(spot.id) || hopping === spot.id).map((spot) => (
    <button
      key={spot.id}
      type="button"
      data-testid={`season-${spot.id}`}
      className={`season-egg ${hopping === spot.id ? 'season-egg-found' : (animated ? 'season-egg-anim' : '')}`}
      style={{ top: spot.top, left: spot.left }}
      aria-label={t('Osterei', 'Easter egg')}
      onClick={() => collect(spot.id)}
    >
      <svg width="30" height="36" viewBox="0 0 30 36" aria-hidden="true">
        <ellipse cx="15" cy="19" rx="12" ry="16" fill={spot.colors[0]} />
        <path d="M4 16 L9 12 L14 16 L19 12 L24 16 L26 14" stroke={spot.colors[1]} strokeWidth="2.4" fill="none" />
        <rect x="3" y="22" width="24" height="3.5" fill={spot.colors[1]} opacity="0.7" />
      </svg>
    </button>
  ));
}

export default function SeasonDecor({ season, reducedMotion = false, onHide }) {
  const { t } = useI18n();
  const animated = !reducedMotion;
  const [hero, setHero] = useState(null);
  const [burst, setBurst] = useState('');
  const [eggsDone, setEggsDone] = useState(() => season.season === 'easter' && readJson(eggsKey(season.year), []).length >= EGG_SPOTS.length);
  const [midnightPassed, setMidnightPassed] = useState(false);
  const endBurst = useCallback(() => setBurst(''), []);
  const atMidnight = useCallback(() => {
    setMidnightPassed(true);
    if (animated) setBurst('fireworks');
  }, [animated]);
  const allEggsFound = useCallback(() => {
    setEggsDone(true);
    if (animated) setBurst('confetti');
  }, [animated]);

  useEffect(() => {
    setHero(document.querySelector('[data-testid="hero-section"]'));
  }, []);

  // The first visit on New Year's Day gets a short firework, once per browser and year.
  useEffect(() => {
    if (!animated || season.season !== 'newyear' || season.phase !== 'greeting' || season.preview) return;
    if (readJson(fireworksKey(season.year), false)) return;
    writeJson(fireworksKey(season.year), true);
    setBurst('fireworks');
  }, [animated, season.season, season.phase, season.preview, season.year]);

  const winter = season.season === 'advent' || season.season === 'christmas';
  let badge = null;
  if (season.season === 'advent') {
    badge = (
      <>
        <Wreath lit={season.candles} animated={animated} label={t('Adventskranz mit {count} brennenden Kerzen', 'Advent wreath with {count} lit candles', { count: season.candles })} />
        <span>{t('{count}. Advent', 'Advent, week {count}', { count: season.candles })}</span>
      </>
    );
  } else if (season.season === 'halloween') {
    badge = season.phase === 'greeting'
      ? <span>🎃 {t('Happy Halloween!', 'Happy Halloween!')}</span>
      : <span>🕸️ {t('Bald ist Halloween', 'Halloween is coming')}</span>;
  } else if (season.season === 'christmas') {
    badge = season.phase === 'greeting' ? <span>🎄 {t('Frohe Weihnachten', 'Merry Christmas')}</span> : <span aria-hidden="true">❄️ ❄️ ❄️</span>;
  } else if (season.season === 'easter') {
    badge = season.phase === 'greeting'
      ? <span>🐣 {eggsDone ? t('Alle Ostereier gefunden! Frohe Ostern!', 'You found every Easter egg! Happy Easter!') : t('Frohe Ostern', 'Happy Easter')}</span>
      : <span>🌷 {t('Bald ist Ostern', 'Easter is coming')}</span>;
  } else if (season.season === 'newyear') {
    badge = season.phase === 'countdown' && !midnightPassed
      ? <Countdown season={season} onMidnight={atMidnight} />
      : <span>🥂 {t('Frohes neues Jahr {year}!', 'Happy New Year {year}!', { year: season.year })}</span>;
  }

  return (
    <>
      <style>{css}</style>
      {winter && animated ? <Snow /> : null}
      {winter ? <FairyLights animated={animated} /> : null}
      {season.season === 'halloween' ? <Halloween animated={animated} /> : null}
      {badge && hero ? createPortal(
        <div className="season-badge" data-testid="season-badge">
          {badge}
          <button type="button" className="season-hide" data-testid="season-hide" onClick={onHide}>
            <X size={11} aria-hidden="true" /> {t('Deko ausblenden', 'Hide decoration')}
          </button>
        </div>,
        hero,
      ) : null}
      {season.season === 'easter' && !eggsDone ? <EasterEggs season={season} animated={animated} onAllFound={allEggsFound} /> : null}
      {burst ? <Burst kind={burst} onDone={endBurst} /> : null}
    </>
  );
}
