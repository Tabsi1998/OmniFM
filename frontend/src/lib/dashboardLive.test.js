import { describe, expect, it, vi } from 'vitest';
import { LIVE_FALLBACK_MS, LIVE_FIRST_MESSAGE_MS, watchDashboardLive } from './dashboardLive.js';

// The overview listens instead of asking (#502).

function fakeEventSource() {
  const opened = [];
  class FakeSource {
    static CLOSED = 2;

    constructor(url, options) {
      this.url = url;
      this.options = options;
      this.readyState = 0;
      this.listeners = {};
      this.closed = false;
      opened.push(this);
    }

    addEventListener(name, fn) {
      this.listeners[name] = fn;
    }

    close() {
      this.closed = true;
      this.readyState = FakeSource.CLOSED;
    }

    send(data) {
      this.readyState = 1;
      this.listeners.live?.({ data: JSON.stringify(data) });
    }

    refuse() {
      this.readyState = FakeSource.CLOSED;
      this.onerror?.();
    }
  }
  return { FakeSource, opened };
}

function fakeDocument() {
  const listeners = {};
  return {
    visibilityState: 'visible',
    addEventListener: (name, fn) => { listeners[name] = fn; },
    removeEventListener: (name) => { delete listeners[name]; },
    show(state) {
      this.visibilityState = state;
      listeners.visibilitychange?.();
    },
  };
}

describe('watchDashboardLive', () => {
  it('opens one stream for the server and hands every message on', () => {
    vi.useFakeTimers();
    const { FakeSource, opened } = fakeEventSource();
    const onData = vi.fn();
    const poll = vi.fn();
    const stop = watchDashboardLive('123', { onData, poll, EventSourceImpl: FakeSource, doc: fakeDocument() });
    expect(opened).toHaveLength(1);
    expect(opened[0].url).toContain('/api/dashboard/live?serverId=123');
    opened[0].send({ listenersNow: 4 });
    expect(onData).toHaveBeenCalledWith({ listenersNow: 4 });
    // The first message came: no fallback later.
    vi.advanceTimersByTime(LIVE_FIRST_MESSAGE_MS + LIVE_FALLBACK_MS);
    expect(poll).not.toHaveBeenCalled();
    stop();
    expect(opened[0].closed).toBe(true);
    vi.useRealTimers();
  });

  it('asks every 30 seconds where the server refuses the stream', () => {
    vi.useFakeTimers();
    const { FakeSource, opened } = fakeEventSource();
    const poll = vi.fn();
    const stop = watchDashboardLive('123', { onData: vi.fn(), poll, EventSourceImpl: FakeSource, doc: fakeDocument() });
    opened[0].refuse();
    expect(poll).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(LIVE_FALLBACK_MS);
    expect(poll).toHaveBeenCalledTimes(2);
    stop();
    vi.advanceTimersByTime(LIVE_FALLBACK_MS);
    expect(poll).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it('asks instead when no message comes through (a proxy that collects them)', () => {
    vi.useFakeTimers();
    const { FakeSource, opened } = fakeEventSource();
    const poll = vi.fn();
    watchDashboardLive('123', { onData: vi.fn(), poll, EventSourceImpl: FakeSource, doc: fakeDocument() });
    vi.advanceTimersByTime(LIVE_FIRST_MESSAGE_MS);
    expect(opened[0].closed).toBe(true);
    expect(poll).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it('a hidden tab closes the stream and opens a new one when shown', () => {
    vi.useFakeTimers();
    const { FakeSource, opened } = fakeEventSource();
    const doc = fakeDocument();
    watchDashboardLive('123', { onData: vi.fn(), poll: vi.fn(), EventSourceImpl: FakeSource, doc });
    opened[0].send({});
    doc.show('hidden');
    expect(opened[0].closed).toBe(true);
    vi.advanceTimersByTime(LIVE_FIRST_MESSAGE_MS * 3);
    expect(opened).toHaveLength(1);
    doc.show('visible');
    expect(opened).toHaveLength(2);
    vi.useRealTimers();
  });

  it('a hidden tab also stops asking, and asks again when shown', () => {
    vi.useFakeTimers();
    const poll = vi.fn();
    const doc = fakeDocument();
    watchDashboardLive('123', { onData: vi.fn(), poll, EventSourceImpl: undefined, doc });
    expect(poll).toHaveBeenCalledTimes(1);
    doc.show('hidden');
    vi.advanceTimersByTime(LIVE_FALLBACK_MS * 3);
    expect(poll).toHaveBeenCalledTimes(1);
    doc.show('visible');
    expect(poll).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
