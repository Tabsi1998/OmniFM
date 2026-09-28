// OmniFM: fireworks for New Year (#448). Rockets rise with a sparkling tail
// and burst into spheres, tilted rings, golden willows or crackling stars
// that fall with gravity, slow down in the air and fade. Drawn on a canvas
// behind the page's content, like a night sky: no text is ever covered and
// clicks go through. "show" is the big one (midnight, the first visit on New
// Year's Day, the preview); "ambient" sends a rocket now and then.
import { useEffect, useRef } from 'react';

// Main colour and its bright core.
export const PALETTES = [
  ['#FFD166', '#FFF3C9'],
  ['#FF4D6D', '#FFD0D8'],
  ['#4CC9F0', '#D4F5FF'],
  ['#B388FF', '#EFE4FF'],
  ['#72EFB0', '#DDFFEC'],
  ['#FF9F1C', '#FFE3BD'],
  ['#E8ECFF', '#FFFFFF'],
];
export const KINDS = ['peony', 'peony', 'ring', 'willow', 'willow', 'crackle', 'crackle', 'double', 'palm'];

/** When each rocket of a show starts (seconds), where (share of the width) and how high it bursts (share of the height). */
export function planShow(random, { duration = 16, finale = 4 } = {}) {
  const launches = [];
  let time = 0.4;
  while (time < duration) {
    const inFinale = time > duration - finale;
    const roll = random();
    const salvo = inFinale ? 3 + Math.floor(random() * 2) : (roll < 0.1 ? 3 : roll < 0.45 ? 2 : 1);
    for (let index = 0; index < salvo; index += 1) {
      launches.push({
        at: time + index * 0.14,
        x: 0.1 + random() * 0.8,
        height: 0.52 + random() * 0.3,
        kind: KINDS[Math.floor(random() * KINDS.length)],
        palette: Math.floor(random() * PALETTES.length),
      });
    }
    time += inFinale ? 0.3 + random() * 0.25 : 0.4 + random() * 0.75;
  }
  return launches;
}

/** The sparks of one burst, as start velocities (pixels per frame at 60 fps). Pure, for the test. */
export function burstSparks(kind, random, { speed = 4.6, count = 120, drift = 0 } = {}) {
  const sparks = [];
  const amount = kind === 'ring' ? Math.round(count * 0.55) : kind === 'palm' ? 9 : count;
  const tilt = random() * Math.PI;
  const flat = 0.3 + random() * 0.55;
  for (let index = 0; index < amount; index += 1) {
    let vx;
    let vy;
    if (kind === 'ring') {
      const angle = (index / amount) * Math.PI * 2;
      const rx = Math.cos(angle) * speed;
      const ry = Math.sin(angle) * speed * flat;
      vx = rx * Math.cos(tilt) - ry * Math.sin(tilt);
      vy = rx * Math.sin(tilt) + ry * Math.cos(tilt);
    } else if (kind === 'palm') {
      // A few heavy comets, spread like the leaves of a palm.
      const angle = -Math.PI / 2 + ((index / (amount - 1)) - 0.5) * Math.PI * 1.5;
      vx = Math.cos(angle) * speed * 0.9;
      vy = Math.sin(angle) * speed * 0.9;
    } else {
      // A point on a sphere seen from the front: denser in the middle, like a real shell.
      const z = random() * 2 - 1;
      const angle = random() * Math.PI * 2;
      const across = Math.sqrt(1 - z * z);
      const pace = speed * (kind === 'willow' ? 0.72 : 1) * (0.86 + random() * 0.14);
      vx = Math.cos(angle) * across * pace;
      vy = Math.sin(angle) * across * pace;
    }
    sparks.push({ vx: vx + drift, vy });
  }
  return sparks;
}

export default function Fireworks({ mode = 'show', onDone, random = Math.random }) {
  const ref = useRef(null);
  useEffect(() => {
    const canvas = ref.current;
    const context = canvas?.getContext?.('2d');
    if (!context) {
      onDone?.();
      return undefined;
    }
    const ratio = Math.min(2, window.devicePixelRatio || 1);
    let width = 0;
    let height = 0;
    let scale = 1;
    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.round(width * ratio);
      canvas.height = Math.round(height * ratio);
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      // Bursts as big as the screen allows: a phone gets small ones.
      scale = Math.max(0.6, Math.min(1.5, Math.min(width, height * 1.5) / 900));
    };
    resize();

    const plan = mode === 'show' ? planShow(random) : [];
    let planIndex = 0;
    let nextAmbient = mode === 'ambient' ? 1.5 + random() * 5 : Infinity;
    let clock = 0;
    const rockets = [];
    const sparks = [];
    const flashes = [];

    const launch = (spec, small = false) => {
      const gravity = 0.055;
      const startY = height + 8;
      const targetY = height * (1 - spec.height);
      rockets.push({
        x: spec.x * width, y: startY, px: spec.x * width, py: startY,
        vx: (random() - 0.5) * 0.9, vy: -Math.sqrt(2 * gravity * (startY - targetY)), gravity, spec, small,
      });
    };

    const explode = (rocket) => {
      const { kind, palette } = rocket.spec;
      const [main, core] = PALETTES[palette];
      const second = PALETTES[(palette + 3) % PALETTES.length][0];
      const size = (rocket.small ? 0.68 : 1) * scale;
      const willow = kind === 'willow';
      for (const start of burstSparks(kind, random, { speed: (willow ? 4.4 : 5.2) * size, count: Math.round(160 * (rocket.small ? 0.65 : 1)), drift: rocket.vx * 0.3 })) {
        const heavy = kind === 'palm';
        sparks.push({
          x: rocket.x, y: rocket.y, px: rocket.x, py: rocket.y, vx: start.vx, vy: start.vy, age: 0,
          life: willow ? 150 + random() * 60 : heavy ? 95 + random() * 20 : 62 + random() * 34,
          drag: willow ? 0.962 : heavy ? 0.985 : 0.972,
          gravity: willow ? 0.026 : 0.042,
          width: willow ? 1.6 : heavy ? 3 : 2.2,
          color: willow ? (random() < 0.7 ? '#FFC46B' : '#FFE7B0') : (kind === 'double' && random() < 0.5 ? second : (random() < 0.82 ? main : core)),
          twinkle: kind === 'crackle' || (!willow && random() < 0.3),
          crackle: kind === 'crackle',
          trail: willow || heavy,
        });
      }
      flashes.push({ x: rocket.x, y: rocket.y, age: 0, color: core, radius: 95 * size });
    };

    let frame = 0;
    let last = 0;
    let running = false;
    const step = (now) => {
      const dt = last ? Math.min(3, (now - last) / 16.667) : 1;
      last = now;
      clock += dt / 60;

      // Old light fades towards transparent: that leaves the glowing tails.
      context.globalCompositeOperation = 'destination-out';
      context.fillStyle = `rgba(0,0,0,${Math.min(1, 0.15 * dt)})`;
      context.fillRect(0, 0, width, height);
      context.globalCompositeOperation = 'lighter';

      while (planIndex < plan.length && plan[planIndex].at <= clock) launch(plan[planIndex++]);
      if (clock >= nextAmbient) {
        launch({ x: 0.1 + random() * 0.8, height: 0.55 + random() * 0.25, kind: KINDS[Math.floor(random() * KINDS.length)], palette: Math.floor(random() * PALETTES.length) }, true);
        nextAmbient = clock + 14 + random() * 22;
      }

      for (let index = rockets.length - 1; index >= 0; index -= 1) {
        const rocket = rockets[index];
        rocket.px = rocket.x;
        rocket.py = rocket.y;
        rocket.vy += rocket.gravity * dt;
        rocket.x += rocket.vx * dt;
        rocket.y += rocket.vy * dt;
        context.globalAlpha = 0.95;
        context.strokeStyle = '#FFE2A8';
        context.lineWidth = 2;
        context.beginPath();
        context.moveTo(rocket.px, rocket.py);
        context.lineTo(rocket.x, rocket.y);
        context.stroke();
        // A few sparks fall off the tail.
        if (random() < 0.55 * dt) {
          sparks.push({ x: rocket.x, y: rocket.y, px: rocket.x, py: rocket.y, vx: (random() - 0.5) * 0.6, vy: 0.6 + random() * 0.8, age: 0, life: 16 + random() * 14, drag: 0.96, gravity: 0.03, width: 1.1, color: '#FFD9A0', twinkle: true, crackle: false, trail: false });
        }
        if (rocket.vy >= -0.7) {
          explode(rocket);
          rockets.splice(index, 1);
        }
      }

      for (let index = flashes.length - 1; index >= 0; index -= 1) {
        const flash = flashes[index];
        flash.age += dt;
        const strength = Math.max(0, 1 - flash.age / 9);
        if (strength <= 0) {
          flashes.splice(index, 1);
          continue;
        }
        const glow = context.createRadialGradient(flash.x, flash.y, 0, flash.x, flash.y, flash.radius);
        glow.addColorStop(0, flash.color);
        glow.addColorStop(1, 'rgba(0,0,0,0)');
        context.globalAlpha = 0.5 * strength;
        context.fillStyle = glow;
        context.beginPath();
        context.arc(flash.x, flash.y, flash.radius, 0, Math.PI * 2);
        context.fill();
      }

      for (let index = sparks.length - 1; index >= 0; index -= 1) {
        const spark = sparks[index];
        spark.age += dt;
        const progress = spark.age / spark.life;
        if (progress >= 1) {
          sparks.splice(index, 1);
          continue;
        }
        spark.px = spark.x;
        spark.py = spark.y;
        const drag = spark.drag ** dt;
        spark.vx *= drag;
        spark.vy = spark.vy * drag + spark.gravity * dt;
        spark.x += spark.vx * dt;
        spark.y += spark.vy * dt;
        let alpha = (1 - progress) ** 1.4;
        if (spark.twinkle && progress > 0.5 && random() < 0.45) alpha *= 0.2;
        context.globalAlpha = alpha;
        context.strokeStyle = spark.color;
        context.lineWidth = spark.width;
        context.beginPath();
        context.moveTo(spark.trail ? spark.px - spark.vx * 2 : spark.px, spark.trail ? spark.py - spark.vy * 2 : spark.py);
        context.lineTo(spark.x, spark.y);
        context.stroke();
        // A soft glow around the bright head of each spark.
        context.globalAlpha = alpha * 0.16;
        context.fillStyle = spark.color;
        context.beginPath();
        context.arc(spark.x, spark.y, spark.width * 3.2, 0, Math.PI * 2);
        context.fill();
        // Crackling stars break into tiny white flashes near their end.
        if (spark.crackle && progress > 0.62 && random() < 0.05 * dt) {
          for (let piece = 0; piece < 3; piece += 1) {
            sparks.push({ x: spark.x, y: spark.y, px: spark.x, py: spark.y, vx: (random() - 0.5) * 2.2, vy: (random() - 0.5) * 2.2, age: 0, life: 8 + random() * 8, drag: 0.9, gravity: 0.02, width: 1.3, color: '#FFFFFF', twinkle: false, crackle: false, trail: false });
          }
          sparks.splice(index, 1);
        }
      }
      context.globalAlpha = 1;

      const finished = mode === 'show' && planIndex >= plan.length && !rockets.length && !sparks.length && !flashes.length;
      if (finished) {
        context.clearRect(0, 0, width, height);
        running = false;
        onDone?.();
        return;
      }
      frame = window.requestAnimationFrame(step);
    };

    const start = () => {
      if (running || document.hidden) return;
      running = true;
      last = 0;
      frame = window.requestAnimationFrame(step);
    };
    const stop = () => {
      running = false;
      window.cancelAnimationFrame(frame);
    };
    const onVisibility = () => (document.hidden ? stop() : start());
    start();
    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      stop();
      window.removeEventListener('resize', resize);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [mode, onDone, random]);

  // Behind the content (z-index -1): the page's dark background is the sky.
  return <canvas ref={ref} data-testid={`season-fireworks-${mode}`} data-season-skip="" aria-hidden="true" style={{ position: 'fixed', inset: 0, width: '100%', height: '100%', pointerEvents: 'none', zIndex: -1 }} />;
}
