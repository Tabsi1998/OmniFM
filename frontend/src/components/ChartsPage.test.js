import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import ChartsPage, { splitTitle } from './ChartsPage.js';

// The OmniFM charts page (#300) from what GET /api/charts answers.

const CHART = {
  week: { year: 2026, week: 39, id: '2026-W39', start: '2026-09-21T00:00:00.000Z', end: '2026-09-28T00:00:00.000Z' },
  minServers: 3,
  size: 20,
  measuring: true,
  entries: [
    { rank: 1, displayTitle: 'Daft Punk - One More Time', plays: 1234, servers: 42, movement: 'up', previousRank: 3, cover: 'https://example.com/cover.jpg' },
    { rank: 2, displayTitle: 'Untitled Jingle', plays: 900, servers: 3, movement: 'new', previousRank: null, cover: null },
  ],
};

function answer(body, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body })));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('charts page', () => {
  it('lists the songs with rank, movement, cover and numbers', async () => {
    answer(CHART);
    render(<I18nProvider><ChartsPage /></I18nProvider>);
    const first = await screen.findByTestId('charts-entry-1');
    expect(screen.getByTestId('charts-content').getAttribute('aria-busy')).toBe('false');
    expect(first.textContent).toContain('One More Time');
    expect(first.textContent).toContain('Daft Punk');
    expect(first.querySelector('[data-movement="up"]').textContent).toBe('▲ 2');
    expect(first.querySelector('img').getAttribute('src')).toBe('https://example.com/cover.jpg');
    expect(screen.getByTestId('charts-entry-2').querySelector('img')).toBeNull();
    expect(screen.getByTestId('charts-week').textContent).toMatch(/39/);
  });

  it('says so when last week had no song on enough servers', async () => {
    answer({ ...CHART, entries: [] });
    render(<I18nProvider><ChartsPage /></I18nProvider>);
    expect(await screen.findByTestId('charts-empty')).toBeTruthy();
  });

  it('says so when the charts cannot be loaded', async () => {
    answer({}, false);
    render(<I18nProvider><ChartsPage /></I18nProvider>);
    expect(await screen.findByTestId('charts-unreachable')).toBeTruthy();
  });

  it('splits artist and title', () => {
    expect(splitTitle('A - B - C')).toEqual({ artist: 'A', title: 'B - C' });
    expect(splitTitle('Only')).toEqual({ artist: '', title: 'Only' });
  });
});
