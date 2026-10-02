import { afterEach, describe, expect, it, vi } from 'vitest';
import { LIVE_REFRESH_MS, dataForPage, startSiteData } from './siteData.js';

// What the website loads (#485): a page what it shows; the live numbers
// every minute while the tab is shown; a 429 keeps the page and waits.

afterEach(() => vi.useRealTimers());

function fakeApi(answers = {}) {
  const calls = [];
  const fetchJson = vi.fn(async (path) => {
    calls.push(path);
    const answer = answers[path];
    if (answer instanceof Error) throw answer;
    return answer ?? { path };
  });
  return { calls, fetchJson };
}

const flush = async () => {
  // eslint-disable-next-line no-await-in-loop -- one microtask turn after the other, so chained answers settle
  for (let i = 0; i < 5; i += 1) await Promise.resolve();
};

describe('what a page loads', () => {
  it('the start page and its sections: the catalogue once, the live numbers again; a legal page only its text', () => {
    for (const page of ['home', 'stations', 'premium', 'faq']) {
      expect(dataForPage(page)).toEqual({ once: ['legal', 'stations'], live: ['bots', 'stats'] });
    }
    expect(dataForPage('imprint')).toEqual({ once: ['legal'], live: [] });
    expect(dataForPage('privacy')).toEqual({ once: ['legal', 'privacy'], live: [] });
    expect(dataForPage('terms')).toEqual({ once: ['legal', 'terms'], live: [] });
    expect(dataForPage('start')).toEqual({ once: ['legal'], live: ['bots'] });
    expect(dataForPage('not-found')).toEqual({ once: ['legal'], live: [] });
    expect(dataForPage('dashboard')).toEqual({ once: [], live: [] });
  });
});

describe('loading', () => {
  it('asks four times on the start page, then twice a minute, and not while the tab is hidden', async () => {
    vi.useFakeTimers();
    const { calls, fetchJson } = fakeApi();
    let visible = true;
    const shown = [];
    const done = vi.fn();
    const stop = startSiteData('home', { fetchJson, apply: (name) => shown.push(name), done, isVisible: () => visible });
    await flush();
    expect(calls).toEqual(['/api/legal', '/api/stations', '/api/bots', '/api/stats']);
    expect(done).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS - 1000);
    expect(calls).toHaveLength(4, 'nothing in between');
    await vi.advanceTimersByTimeAsync(1000);
    expect(calls.slice(4)).toEqual(['/api/bots', '/api/stats']);

    visible = false;
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS);
    expect(calls).toHaveLength(6, 'a hidden tab asks nothing');
    visible = true;
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS);
    expect(calls).toHaveLength(8);

    stop();
    await vi.advanceTimersByTimeAsync(LIVE_REFRESH_MS * 3);
    expect(calls).toHaveLength(8, 'stopped means stopped');
  });

  it('a refused request keeps what is shown and is asked again when the server allows', async () => {
    vi.useFakeTimers();
    const refused = Object.assign(new Error('/api/stations: Too many requests.'), { retryAfterMs: 30_000 });
    const answers = { '/api/stations': refused };
    const { calls, fetchJson } = fakeApi(answers);
    const shown = [];
    startSiteData('premium', { fetchJson, apply: (name, data) => shown.push([name, data]) });
    await flush();
    expect(shown.map(([name]) => name)).toEqual(['legal', 'bots', 'stats']);

    delete answers['/api/stations'];
    await vi.advanceTimersByTimeAsync(29_000);
    expect(calls.filter((path) => path === '/api/stations')).toHaveLength(1, 'not before the server allows');
    await vi.advanceTimersByTimeAsync(1_000);
    expect(calls.filter((path) => path === '/api/stations')).toHaveLength(2);
    expect(shown.at(-1)).toEqual(['stations', { path: '/api/stations' }]);
  });
});
