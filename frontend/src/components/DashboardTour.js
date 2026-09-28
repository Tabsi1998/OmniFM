// OmniFM: a tour through the dashboard preview (#432). The real dashboard
// with example data (/dashboard?demo=tour) runs in a frame, scaled down, and
// a pointer opens one area after the other. Below, the steps with the plan
// each one needs, from the plan file; a click on a step shows it. The frame
// loads when it comes near the screen; the tour runs only while it is in
// view, and with "less motion" not by itself.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { PLAN_CAPABILITIES, PLAN_NAMES } from '../../../src/config/plan-features.js';

export const TOUR_STEPS = [
  { key: 'overview', area: 'overview', capability: 'dashboard_basic' },
  { key: 'live', area: 'overview', capability: 'basic_health', scrollTo: 'guild-live-view' },
  { key: 'stations', area: 'stations', capability: 'custom_station_urls', scrollTo: 'guild-custom-form' },
  { key: 'events', area: 'events', capability: 'event_scheduler' },
  { key: 'stats', area: 'stats', capability: 'dashboard_access' },
  { key: 'roles', area: 'roles', capability: 'role_permissions' },
  { key: 'settings', area: 'settings', capability: 'dashboard_basic', scrollTo: 'settings-panel-designer' },
];

const STEP_MS = 4200;
/** One round through every step, for recording it (scripts/record-demo-clips.mjs). */
export const TOUR_ROUND_MS = TOUR_STEPS.length * STEP_MS;
const MOBILE_BELOW = 860; // the dashboard's own switch to its phone layout (index.css)

/** The first plan with the step's part, from the plan file (#413). */
export function stepPlan(step) {
  return PLAN_CAPABILITIES[step.capability].minPlan;
}

// The size the dashboard is drawn at before scaling: desktop, tablet or its phone layout.
function viewportFor(width, stage) {
  if (stage) return { width: 1280, height: 720 };
  if (width >= 1000) return { width: 1280, height: 800 };
  if (width >= 640) return { width: 1024, height: 720 };
  return { width: 420, height: 760 };
}

function reducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

export default function DashboardTour({ locale, labels, stage = false }) {
  const holder = useRef(null);
  const frame = useRef(null);
  const list = useRef(null);
  const [width, setWidth] = useState(0);
  const [near, setNear] = useState(stage);
  const [visible, setVisible] = useState(stage);
  const [ready, setReady] = useState(false);
  const [paused, setPaused] = useState(false);
  const [step, setStep] = useState(0);
  const [pointer, setPointer] = useState(null);
  const [still] = useState(() => !stage && reducedMotion());

  useEffect(() => {
    const element = holder.current;
    if (!element) return undefined;
    const measure = () => setWidth(element.clientWidth);
    measure();
    if (typeof ResizeObserver !== 'function') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (stage) return undefined;
    if (typeof IntersectionObserver !== 'function') {
      setNear(true);
      setVisible(true);
      return undefined;
    }
    const element = holder.current;
    const nearing = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting) {
        setNear(true);
        nearing.disconnect();
      }
    }, { rootMargin: '400px 0px' });
    const viewing = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.25 });
    nearing.observe(element);
    viewing.observe(element);
    return () => {
      nearing.disconnect();
      viewing.disconnect();
    };
  }, [stage]);

  const viewport = viewportFor(width, stage);
  const scale = stage ? 1 : width / viewport.width;
  const mobile = viewport.width < MOBILE_BELOW;

  // The frame is ready when the dashboard in it shows its first area.
  const onLoad = useCallback(() => {
    let tries = 0;
    const check = () => {
      if (frame.current?.contentDocument?.querySelector('[data-testid="guild-dashboard"]')) {
        setReady(true);
        return;
      }
      tries += 1;
      if (tries < 80) setTimeout(check, 250);
    };
    check();
  }, []);

  // One step: the pointer goes to the area's button, presses it, and the frame shows the part.
  useEffect(() => {
    const win = frame.current?.contentWindow;
    const doc = frame.current?.contentDocument;
    if (!ready || !win || !doc) return undefined;
    const current = TOUR_STEPS[step];
    const button = doc.querySelector(`[data-testid="${mobile ? 'guild-mobile-nav' : 'guild-nav'}-${current.area}"]`);
    if (!button) return undefined;
    win.scrollTo({ top: 0 });
    if (mobile && button.parentElement) {
      const row = button.parentElement;
      row.scrollLeft = Math.max(0, button.offsetLeft - (row.clientWidth - button.offsetWidth) / 2);
    }
    const rect = button.getBoundingClientRect();
    setPointer({ x: (rect.left + rect.width / 2) * scale, y: (rect.top + rect.height / 2) * scale, clicking: false });
    const timers = [
      setTimeout(() => {
        button.click();
        setPointer((at) => (at ? { ...at, clicking: true } : at));
      }, still ? 0 : 700),
      setTimeout(() => {
        setPointer((at) => (at ? { ...at, clicking: false } : at));
        const target = current.scrollTo ? doc.querySelector(`[data-testid="${current.scrollTo}"]`) : null;
        if (target) win.scrollTo({ top: Math.max(0, target.getBoundingClientRect().top + win.scrollY - 16), behavior: still ? 'auto' : 'smooth' });
      }, still ? 50 : 1300),
    ];
    return () => timers.forEach(clearTimeout);
  }, [ready, step, mobile, scale, still]);

  // On a phone the steps are one row to swipe; the current one stays in sight.
  const narrow = !stage && width > 0 && width < 640;
  useEffect(() => {
    const row = list.current;
    const chip = row?.children[step];
    if (!narrow || !chip) return;
    row.scrollLeft = Math.max(0, chip.offsetLeft - (row.clientWidth - chip.offsetWidth) / 2);
  }, [narrow, step]);

  const running = ready && visible && !paused && !still;
  useEffect(() => {
    if (!running) return undefined;
    const timer = setTimeout(() => setStep((current) => (current + 1) % TOUR_STEPS.length), STEP_MS);
    return () => clearTimeout(timer);
  }, [running, step]);

  const planLabel = (plan) => (plan === 'free' ? labels.everyPlan : plan === 'pro' ? labels.fromPlan({ plan: PLAN_NAMES.pro }) : PLAN_NAMES[plan]);
  const height = width || stage ? Math.round(viewport.height * scale) : 480;

  return (
    <figure data-testid="dashboard-tour" data-step={TOUR_STEPS[step].key} data-ready={ready ? 'true' : undefined} data-still={still ? 'true' : undefined} style={{ margin: 0 }}>
      <style>{'@keyframes tour-click { from { transform: scale(0.4); opacity: 1; } to { transform: scale(1.7); opacity: 0; } }'}</style>
      <div ref={holder} style={{ position: 'relative', height, borderRadius: stage ? 0 : 16, overflow: 'hidden', border: stage ? 'none' : '1px solid #23252e', background: '#08090d', boxShadow: stage ? 'none' : '0 30px 80px rgba(0,0,0,0.45)' }}>
        {near && (width || stage) ? (
          <iframe
            ref={frame}
            title={labels.frameTitle}
            src={`/dashboard?demo=tour&lang=${encodeURIComponent(locale)}`}
            onLoad={onLoad}
            tabIndex={-1}
            aria-hidden="true"
            style={{ width: viewport.width, height: viewport.height, border: 0, display: 'block', transform: `scale(${scale})`, transformOrigin: '0 0', pointerEvents: 'none' }}
          />
        ) : null}
        {pointer && !still ? (
          <div aria-hidden="true" data-testid="tour-pointer" style={{ position: 'absolute', left: 0, top: 0, zIndex: 2, pointerEvents: 'none', transform: `translate(${pointer.x}px, ${pointer.y}px)`, transition: 'transform 0.65s cubic-bezier(.4,.1,.2,1)' }}>
            {pointer.clicking ? <span style={{ position: 'absolute', left: -13, top: -13, width: 26, height: 26, borderRadius: '50%', border: '2px solid rgba(255,255,255,0.85)', animation: 'tour-click 0.4s ease-out forwards' }} /> : null}
            <svg width="20" height="24" viewBox="0 0 20 24" style={{ position: 'absolute', left: -3, top: -2, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,0.6))' }}>
              <path d="M2 1 L2 19 L6.5 14.8 L9.6 22 L12.8 20.6 L9.8 13.6 L16 13.4 Z" fill="#fff" stroke="#111" strokeWidth="1.2" strokeLinejoin="round" />
            </svg>
          </div>
        ) : null}
      </div>
      <figcaption style={{ display: 'flex', alignItems: 'flex-start', gap: 10, marginTop: 14 }}>
        {still ? null : (
          <button
            type="button"
            onClick={() => setPaused((current) => !current)}
            aria-label={paused ? labels.play : labels.pause}
            data-testid="tour-pause"
            style={{ flexShrink: 0, width: 34, height: 34, borderRadius: '50%', border: '1px solid #2a3450', background: 'rgba(255,255,255,0.03)', color: '#fff', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
        )}
        <ol ref={list} data-testid="tour-steps" style={{ position: 'relative', flex: 1, minWidth: 0, display: 'flex', flexWrap: narrow ? 'nowrap' : 'wrap', overflowX: narrow ? 'auto' : 'visible', gap: 6, margin: 0, padding: narrow ? '0 0 6px' : 0, listStyle: 'none', scrollbarWidth: 'thin' }}>
          {TOUR_STEPS.map((entry, index) => {
            const active = index === step;
            return (
              <li key={entry.key} style={{ flexShrink: 0 }}>
                <button
                  type="button"
                  onClick={() => { setStep(index); setPaused(true); }}
                  aria-current={active ? 'step' : undefined}
                  data-testid={`tour-step-${entry.key}`}
                  style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '6px 10px', borderRadius: 10, border: `1px solid ${active ? 'rgba(255,107,0,0.55)' : '#23252e'}`, background: active ? 'rgba(255,107,0,0.1)' : 'rgba(255,255,255,0.02)', color: active ? '#fff' : '#A1A1AA', fontSize: 13, fontWeight: active ? 700 : 500, whiteSpace: 'nowrap', cursor: 'pointer' }}
                >
                  <span>{labels.steps[entry.key]}</span>
                  <span data-testid={`tour-plan-${entry.key}`} style={{ fontFamily: "'JetBrains Mono',monospace", fontSize: 10.5, fontWeight: 700, letterSpacing: '0.04em', padding: '2px 6px', borderRadius: 6, color: stepPlan(entry) === 'free' ? '#94a3b8' : stepPlan(entry) === 'pro' ? '#00e5ff' : '#ffb27a', border: `1px solid ${stepPlan(entry) === 'free' ? '#2a3450' : stepPlan(entry) === 'pro' ? 'rgba(0,229,255,0.35)' : 'rgba(255,107,0,0.4)'}` }}>
                    {planLabel(stepPlan(entry))}
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      </figcaption>
    </figure>
  );
}
