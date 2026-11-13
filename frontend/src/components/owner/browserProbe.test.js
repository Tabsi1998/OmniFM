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

  it('keeps three stations loading: a finished one makes room at once', async () => {
    const items = Array.from({ length: 6 }, (_, index) => ({ key: `s${index}`, url: `https://stream.example.com/${index}.mp3` }));
    const batch = probeBrowserBatch(items);
    await vi.advanceTimersByTimeAsync(0);
    expect(audios).toHaveLength(3);
    // One answers; the next starts although the other two are still loading.
    audios[1].fire('canplay');
    await vi.advanceTimersByTimeAsync(0);
    expect(audios).toHaveLength(4);
    expect(audios.filter((audio) => !audio.released)).toHaveLength(3);
    audios[3].fire('error');
    await vi.advanceTimersByTimeAsync(0);
    expect(audios).toHaveLength(5);
    audios[0].fire('canplay');
    await vi.advanceTimersByTimeAsync(0);
    expect(audios).toHaveLength(6);
    audios[2].fire('error');
    audios[4].fire('loadeddata');
    await vi.advanceTimersByTimeAsync(12000);
    expect(await batch).toEqual({ s0: true, s1: true, s2: false, s3: false, s4: true, s5: false });
  });

  it('answers an empty list with an empty result', async () => {
    expect(await probeBrowserBatch([])).toEqual({});
  });
});
