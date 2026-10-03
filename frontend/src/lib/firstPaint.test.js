import { afterEach, describe, expect, it, vi } from 'vitest';

// The start page's requests wait for the first picture (#501).

async function freshModule() {
  vi.resetModules();
  return import('./firstPaint.js');
}

function fakePaintObserver({ supported = true, alreadyPainted = false } = {}) {
  const observers = [];
  class FakeObserver {
    static supportedEntryTypes = supported ? ['paint', 'largest-contentful-paint'] : ['largest-contentful-paint'];

    constructor(callback) {
      this.callback = callback;
      this.disconnected = false;
      observers.push(this);
    }

    observe() {}

    disconnect() {
      this.disconnected = true;
    }
  }
  vi.stubGlobal('PerformanceObserver', FakeObserver);
  vi.spyOn(performance, 'getEntriesByType').mockImplementation((type) => (
    type === 'paint' && alreadyPainted ? [{ name: 'first-contentful-paint' }] : []
  ));
  return {
    observers,
    paint: () => observers.forEach((observer) => observer.callback({ getEntries: () => [{ name: 'first-contentful-paint' }] })),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('afterFirstPaint', () => {
  it('waits for the first content on the screen, then lets every request go at once', async () => {
    const { observers, paint } = fakePaintObserver();
    const { afterFirstPaint } = await freshModule();
    let done = false;
    afterFirstPaint().then(() => { done = true; });
    await Promise.resolve();
    expect(done).toBe(false);
    paint();
    await afterFirstPaint();
    expect(done).toBe(true);
    expect(observers[0].disconnected).toBe(true);
    // A later request waits for nothing.
    await expect(afterFirstPaint()).resolves.toBeUndefined();
  });

  it('goes at once when the first content is already there or the browser cannot tell', async () => {
    fakePaintObserver({ alreadyPainted: true });
    await expect((await freshModule()).afterFirstPaint()).resolves.toBeUndefined();
    fakePaintObserver({ supported: false });
    await expect((await freshModule()).afterFirstPaint()).resolves.toBeUndefined();
  });

  it('a tab that paints nothing (in the background) gets its data after two seconds anyway', async () => {
    vi.useFakeTimers();
    fakePaintObserver();
    const { afterFirstPaint } = await freshModule();
    let done = false;
    afterFirstPaint().then(() => { done = true; });
    await vi.advanceTimersByTimeAsync(1999);
    expect(done).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(done).toBe(true);
  });
});
