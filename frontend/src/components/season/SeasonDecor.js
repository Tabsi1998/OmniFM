// OmniFM: the seasonal decoration of the start page (#427, reworked in
// #448), its own download that only loads in a season (App.js). Snow and
// fairy lights in Advent and at Christmas, the Advent wreath in the hero, the
// Easter egg hunt, Halloween, and New Year with its countdown and fireworks
// behind the content. Whoever asked the device for less motion sees it
// standing still; "Deko ausblenden" hides all of it.
import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { useI18n } from '../../i18n.js';
import EasterEggs, { EGG_COUNT, eggsKey } from './EasterEggs.js';
import FairyLights from './FairyLights.js';
import Fireworks from './Fireworks.js';
import Halloween from './Halloween.js';

const css = `
.season-bulb-anim { animation: season-twinkle 2.4s ease-in-out infinite; }
@keyframes season-twinkle { 0%, 100% { opacity: 1; } 50% { opacity: 0.35; } }
.season-flame { transform-origin: 50% 100%; }
.season-flame-anim { animation: season-flicker 1.1s ease-in-out infinite alternate; }
@keyframes season-flicker { from { transform: scale(1, 1); } to { transform: scale(0.86, 1.12); } }
.season-egg:focus-visible { outline: 2px solid #00e5ff; outline-offset: 3px; border-radius: 40%; }
.season-egg-anim { display: block; animation: season-wobble 3.2s ease-in-out infinite; transform-origin: 50% 90%; }
.season-egg-found { animation: season-hop 0.6s ease-out forwards; }
@keyframes season-wobble { 0%, 86%, 100% { rotate: 0deg; } 90% { rotate: -12deg; } 95% { rotate: 10deg; } }
@keyframes season-hop { 0% { transform: translateY(0) scale(1); opacity: 1; } 60% { transform: translateY(-26px) scale(1.2); opacity: 1; } 100% { transform: translateY(-40px) scale(0.4); opacity: 0; } }
.season-badge { position: absolute; top: 84px; right: 24px; z-index: 3; display: inline-flex; align-items: center; gap: 10px;
  padding: 8px 16px; border-radius: 999px; background: rgba(10,10,14,0.72); border: 1px solid rgba(255,255,255,0.14);
  color: #F4F4F5; font-size: 14px; font-weight: 700; backdrop-filter: blur(6px); }
.season-count { color: #A1A1AA; font-weight: 600; font-size: 13px; }
@media (max-width: 900px) { .season-badge { top: 74px; right: 50%; transform: translateX(50%); max-width: calc(100vw - 24px);
  flex-wrap: wrap; justify-content: center; row-gap: 4px; border-radius: 18px; text-align: center; } }
.season-hide { display: inline-flex; align-items: center; gap: 4px; margin-left: 4px; padding: 3px 8px; border-radius: 999px;
  border: 1px solid rgba(255,255,255,0.16); background: transparent; color: #A1A1AA; font-size: 11px; font-weight: 600; cursor: pointer; }
.season-hide:hover { color: #fff; border-color: rgba(255,255,255,0.32); }
`;

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
  return <canvas ref={ref} data-testid="season-snow" data-season-skip="" aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 40 }} />;
}

/** Confetti, once, for a few seconds, when every Easter egg is found. Under the menu and the player bar. */
function Confetti({ onDone }) {
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
    const pieces = Array.from({ length: 140 }, (_, index) => ({
      x: Math.random() * width, y: -20 - Math.random() * height * 0.4, vx: (Math.random() - 0.5) * 2, vy: 2 + Math.random() * 3,
      color: colors[index % colors.length], size: 4 + Math.random() * 4, spin: Math.random() * 6.28,
    }));
    let frame = 0;
    let tick = 0;
    const step = () => {
      tick += 1;
      context.clearRect(0, 0, width, height);
      for (const piece of pieces) {
        piece.x += piece.vx;
        piece.y += piece.vy;
        piece.spin += 0.1;
        context.fillStyle = piece.color;
        context.save();
        context.translate(piece.x, piece.y);
        context.rotate(piece.spin);
        context.fillRect(-piece.size / 2, -piece.size / 4, piece.size, piece.size / 2);
        context.restore();
      }
      if (tick < 200) frame = window.requestAnimationFrame(step);
      else onDone?.();
    };
    frame = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(frame);
  }, [onDone]);
  return <canvas ref={ref} data-testid="season-confetti" data-season-skip="" aria-hidden="true" style={{ position: 'fixed', inset: 0, pointerEvents: 'none', zIndex: 55 }} />;
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

/**
 * Whether rockets go up now and then: all of New Year's Day, on New Year's
 * Eve from six in the evening, and always in the preview.
 */
export function ambientFireworks(season) {
  if (season?.season !== 'newyear') return false;
  if (season.preview || season.phase === 'greeting') return true;
  return Number.isFinite(season.secondsToMidnight) && season.secondsToMidnight <= 6 * 3600;
}

export default function SeasonDecor({ season, reducedMotion = false, onHide }) {
  const { t } = useI18n();
  const animated = !reducedMotion;
  const [hero, setHero] = useState(null);
  const [confetti, setConfetti] = useState(false);
  const [show, setShow] = useState(false);
  const [eggsFound, setEggsFound] = useState(() => (season.season === 'easter' ? readJson(eggsKey(season.year), []) : []));
  const [midnightPassed, setMidnightPassed] = useState(false);
  const endConfetti = useCallback(() => setConfetti(false), []);
  const endShow = useCallback(() => setShow(false), []);
  const atMidnight = useCallback(() => {
    setMidnightPassed(true);
    if (animated) setShow(true);
  }, [animated]);
  const eggsDone = eggsFound.length >= EGG_COUNT;
  const findEgg = useCallback((id) => {
    if (eggsFound.includes(id)) return;
    const next = [...eggsFound, id];
    setEggsFound(next);
    writeJson(eggsKey(season.year), next);
    if (next.length >= EGG_COUNT && animated) setConfetti(true);
  }, [animated, eggsFound, season.year]);

  useEffect(() => {
    setHero(document.querySelector('[data-testid="hero-section"]'));
  }, []);

  // The big show on the first visit on New Year's Day (once per browser and
  // year) and on every visit of the preview.
  useEffect(() => {
    if (!animated || season.season !== 'newyear' || season.phase !== 'greeting') return;
    if (!season.preview) {
      if (readJson(fireworksKey(season.year), false)) return;
      writeJson(fireworksKey(season.year), true);
    }
    setShow(true);
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
      ? (
        <>
          <span>🐣 {eggsDone ? t('Alle Ostereier gefunden! Frohe Ostern!', 'You found every Easter egg! Happy Easter!') : t('Frohe Ostern', 'Happy Easter')}</span>
          {!eggsDone ? <span className="season-count" data-testid="season-egg-count">🥚 {t('{found} von {total} Eiern gefunden', '{found} of {total} eggs found', { found: eggsFound.length, total: EGG_COUNT })}</span> : null}
        </>
      )
      : <span>🌷 {t('Bald ist Ostern', 'Easter is coming')}</span>;
  } else if (season.season === 'newyear') {
    badge = season.phase === 'countdown' && !midnightPassed
      ? <Countdown season={season} onMidnight={atMidnight} />
      : <span>🥂 {t('Frohes neues Jahr {year}!', 'Happy New Year {year}!', { year: season.year })}</span>;
  }

  const rockets = animated && season.season === 'newyear' && (show || ambientFireworks(season) || midnightPassed);

  return (
    <>
      <style>{css}</style>
      {winter && animated ? <Snow /> : null}
      {winter ? <FairyLights animated={animated} /> : null}
      {season.season === 'halloween' ? <Halloween animated={animated} /> : null}
      {rockets ? <Fireworks key={show ? 'show' : 'ambient'} mode={show ? 'show' : 'ambient'} onDone={endShow} /> : null}
      {badge && hero ? createPortal(
        <div className="season-badge" data-testid="season-badge">
          {badge}
          <button type="button" className="season-hide" data-testid="season-hide" onClick={onHide}>
            <X size={11} aria-hidden="true" /> {t('Deko ausblenden', 'Hide decoration')}
          </button>
        </div>,
        hero,
      ) : null}
      {season.season === 'easter' && !eggsDone ? <EasterEggs found={eggsFound} onFind={findEgg} animated={animated} /> : null}
      {confetti ? <Confetti onDone={endConfetti} /> : null}
    </>
  );
}
