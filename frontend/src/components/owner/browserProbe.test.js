import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { probeBrowserBatch, probeBrowserPlayable } from './browserProbe.js';

// #538: the cockpit's browser probe said "Nur Discord" for stations that only
// needed a moment longer, because too many were loaded at once with too
// little time.

let audios = [];

class FakeAudio {
  constructor() {
    this.listeners = {};
    this.released = false;
    audios.push(this);
  }

  addEventListener(name, handler) { this.listeners[name] = handler; }

  removeEventListener(name) { delete this.listeners[name]; }

  pause() {}

  removeAttribute() { this.released = true; }

  load() {}

  fire(name) { this.listeners[name]?.(); }
}

beforeEach(() => {
  audios = [];
  vi.useFakeTimers();
  vi.stubGlobal('Audio', FakeAudio);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('browser probe of the station cockpit', () => {
  it('counts a stream that needs eight seconds to start as playable', async () => {
    const result = probeBrowserPlayable('https://stream.example.com/live.mp3');
    await vi.advanceTimersByTimeAsync(8000);
    audios[0].fire('canplay');
    expect(await result).toBe(true);
    expect(audios[0].released).toBe(true);
  });

  it('gives up after twelve seconds and on an error', async () => {
    const slow = probeBrowserPlayable('https://stream.example.com/slow.mp3');
    await vi.advanceTimersByTimeAsync(12000);
    expect(await slow).toBe(false);

    const broken = probeBrowserPlayable('https://stream.example.com/broken.mp3');
    audios[1].fire('error');
    expect(await broken).toBe(false);
    expect(await probeBrowserPlayable('')).toBe(false);
  });

  it('loads at most three stations at the same time', async () => {
    const items = Array.from({ length: 7 }, (_, index) => ({ key: `s${index}`, url: `https://stream.example.com/${index}.mp3` }));
    const batch = probeBrowserBatch(items);
    await vi.advanceTimersByTimeAsync(0);
    expect(audios).toHaveLength(3);
    audios.forEach((audio) => audio.fire('canplay'));
    await vi.advanceTimersByTimeAsync(0);
    expect(audios).toHaveLength(6);
    audios.slice(3).forEach((audio) => audio.fire('error'));
    await vi.advanceTimersByTimeAsync(0);
    expect(audios).toHaveLength(7);
    audios[6].fire('loadeddata');
    expect(await batch).toEqual({ s0: true, s1: true, s2: true, s3: false, s4: false, s5: false, s6: true });
  });
});
