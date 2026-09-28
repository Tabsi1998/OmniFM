import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import { PlayerProvider } from '../lib/player.js';
import ChartsPage, { splitTitle } from './ChartsPage.js';

// The OmniFM charts page (#300) from what GET /api/charts answers: the
// stations first, then the songs.

const CHART = {
  week: { year: 2026, week: 39, id: '2026-W39', start: '2026-09-21T00:00:00.000Z', end: '2026-09-28T00:00:00.000Z' },
  minServers: 3,
  measuring: true,
  stations: [
    { rank: 1, key: 'groovesalad', name: 'Groove Salad', genre: 'Ambient', color: '#14B8A6', logo: 'https://example.com/logo.png', tier: 'free', url: 'https://example.com/gs.mp3', hours: 312.5, servers: 41, movement: 'up', previousRank: 3 },
    { rank: 2, key: 'einslive', name: '1LIVE', genre: 'Pop', color: null, logo: null, tier: 'pro', url: null, hours: 280, servers: 35, movement: 'same', previousRank: 2 },
  ],
  songs: [
    { rank: 1, displayTitle: 'Daft Punk - One More Time', plays: 1234, servers: 42, movement: 'up', previousRank: 3, cover: 'https://example.com/cover.jpg' },
    { rank: 2, displayTitle: 'Untitled Jingle', plays: 900, servers: 3, movement: 'new', previousRank: null, cover: null },
  ],
};

function answer(body, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body })));
}

function renderPage() {
  return render(<I18nProvider><PlayerProvider><ChartsPage /></PlayerProvider></I18nProvider>);
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('charts page', () => {
  it('lists the stations first, each with its hours and a play button when it can be heard', async () => {
    answer(CHART);
    renderPage();
    const first = await screen.findByTestId('charts-station-1');
    expect(screen.getByTestId('charts-content').getAttribute('aria-busy')).toBe('false');
    expect(first.textContent).toContain('Groove Salad');
    expect(first.textContent).toContain('Ambient');
    expect(first.textContent).toMatch(/312[.,]5/);
    expect(first.querySelector('img').getAttribute('src')).toBe('https://example.com/logo.png');
    expect(screen.getByTestId('charts-listen-groovesalad')).toBeTruthy();
    expect(screen.getByTestId('charts-station-2').querySelector('button')).toBeNull();
    const stationsList = screen.getByTestId('charts-stations');
    const songsList = screen.getByTestId('charts-list');
    expect(stationsList.compareDocumentPosition(songsList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('lists the songs with rank, movement, cover and numbers', async () => {
    answer(CHART);
    renderPage();
    const first = await screen.findByTestId('charts-entry-1');
    expect(first.textContent).toContain('One More Time');
    expect(first.textContent).toContain('Daft Punk');
    expect(first.querySelector('[data-movement="up"]').textContent).toBe('▲ 2');
    expect(first.querySelector('img').getAttribute('src')).toBe('https://example.com/cover.jpg');
    expect(screen.getByTestId('charts-entry-2').querySelector('img')).toBeNull();
    expect(screen.getByTestId('charts-week').textContent).toMatch(/39/);
  });

  it('says so when last week had nothing on enough servers', async () => {
    answer({ ...CHART, stations: [], songs: [] });
    renderPage();
    expect(await screen.findByTestId('charts-stations-empty')).toBeTruthy();
    expect(screen.getByTestId('charts-empty')).toBeTruthy();
  });

  it('says so when the charts cannot be loaded', async () => {
    answer({}, false);
    renderPage();
    expect(await screen.findByTestId('charts-unreachable')).toBeTruthy();
  });

  it('splits artist and title', () => {
    expect(splitTitle('A - B - C')).toEqual({ artist: 'A', title: 'B - C' });
    expect(splitTitle('Only')).toEqual({ artist: '', title: 'Only' });
  });
});
