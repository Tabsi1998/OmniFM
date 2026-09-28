// OmniFM: the four live demos' timelines (#431). Each step: how long it
// shows (ms) and which caption it belongs to. The scenes draw a step; the
// clock moves on. The last step of each is its still (for "less motion").
import { useEffect, useRef, useState } from 'react';

const step = (ms, caption) => ({ ms, caption });

export const TIMELINES = {
  // Add the commander: choose the server, confirm the rights, authorise.
  commander: [step(900, 0), step(700, 0), step(900, 0), step(600, 0), step(800, 0), step(400, 0), step(1500, 1), step(700, 1), step(400, 1), step(3000, 2)],
  // /invite, choose a worker, invite it.
  worker: [step(800, 0), step(1000, 0), step(1000, 0), step(1500, 1), step(800, 1), step(400, 2), step(3000, 2)],
  // Into the voice channel, /play lofi, the radio plays.
  play: [step(700, 0), step(1000, 0), step(700, 1), step(600, 1), step(1100, 1), step(700, 2), step(3600, 2)],
  // Pause, play on, a favourite.
  panel: [step(1300, 0), step(700, 0), step(350, 0), step(1500, 0), step(700, 1), step(350, 1), step(1100, 1), step(700, 2), step(350, 2), step(3000, 2)],
};

export const SCENES = Object.keys(TIMELINES);

/** The step to show: moves on while playing and starts over after the last; `still` shows the last one. */
export function useSceneClock(timeline, { playing, still }) {
  const [current, setCurrent] = useState(still ? timeline.length - 1 : 0);
  useEffect(() => {
    if (still) {
      setCurrent(timeline.length - 1);
      return undefined;
    }
    if (!playing) return undefined;
    const timer = window.setTimeout(() => setCurrent((index) => (index + 1) % timeline.length), timeline[current].ms);
    return () => window.clearTimeout(timer);
  }, [current, playing, still, timeline]);
  return current;
}

/** What is typed so far: letter by letter while `active`, all of it once `done`. */
export function useTyped(text, { active, done, pace = 85 }) {
  const [length, setLength] = useState(done ? text.length : 0);
  useEffect(() => {
    if (done) {
      setLength(text.length);
      return undefined;
    }
    if (!active) {
      setLength(0);
      return undefined;
    }
    setLength(0);
    let count = 0;
    const timer = window.setInterval(() => {
      count += 1;
      setLength(count);
      if (count >= text.length) window.clearInterval(timer);
    }, pace);
    return () => window.clearInterval(timer);
  }, [active, done, pace, text]);
  return text.slice(0, length);
}

/** Where a marked element sits inside the scene, for the pointer: its centre, or null. */
export function useTargetPoint(containerRef, selector, deps) {
  const [point, setPoint] = useState(null);
  const last = useRef('');
  useEffect(() => {
    const container = containerRef.current;
    const target = selector ? container?.querySelector(selector) : null;
    if (!container || !target) {
      if (last.current) {
        last.current = '';
        setPoint(null);
      }
      return;
    }
    const outer = container.getBoundingClientRect();
    const inner = target.getBoundingClientRect();
    const next = { x: Math.round(inner.left - outer.left + inner.width / 2), y: Math.round(inner.top - outer.top + inner.height / 2) };
    const key = `${next.x},${next.y}`;
    if (key !== last.current) {
      last.current = key;
      setPoint(next);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- measured again whenever the scene's step changes
  }, deps);
  return point;
}
