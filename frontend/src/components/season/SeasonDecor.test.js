import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../i18n.js';
import { DECOR_HIDDEN_KEY, resetOwnerSeasonSwitches, visitorSeason } from '../../lib/seasonSite.js';
import SeasonLayer from './SeasonLayer.js';
import { EGG_COUNT, EGG_FALLBACK_SECTIONS, easterSpots } from './EasterEggs.js';
import { ambientFireworks } from './SeasonDecor.js';
import { isFree, seeded } from './pageSpots.js';

// The seasonal decoration of the website (#427): only in a season, only
// with the owner's switch on, still with "less motion", and hidden on request.

let requests;

function answerSeason(enabled = {}) {
  requests = [];
  vi.stubGlobal('fetch', vi.fn(async (url) => {
    requests.push(String(url));
    return { ok: true, json: async () => ({ enabled: { easter: true, advent: true, christmas: true, newyear: true, ...enabled } }) };
  }));
}

function at(iso, search = '?lang=de') {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(iso));
  window.history.replaceState({}, '', `/${search}`);
}

function page() {
  // The start page's sections, where the badge and the eggs go.
  return (
    <I18nProvider>
      <section data-testid="hero-section" />
      {EGG_FALLBACK_SECTIONS.slice(1).map((testId) => <section key={testId} data-testid={testId} />)}
      <SeasonLayer />
    </I18nProvider>
  );
}

beforeEach(() => {
  window.localStorage.clear();
  resetOwnerSeasonSwitches();
  answerSeason();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete window.matchMedia;
  window.history.replaceState({}, '', '/');
});

describe('website: seasonal decoration', () => {
  it('outside a season: nothing shows and nothing is asked or loaded', () => {
    at('2026-09-28T12:00:00Z');
    const { container } = render(page());
    expect(screen.queryByTestId('season-badge')).toBeNull();
    expect(screen.queryByTestId('season-show')).toBeNull();
    expect(requests).toEqual([]);
    expect(container.querySelectorAll('canvas')).toHaveLength(0);
  });

  it('in Advent: snow, fairy lights and the wreath with the week’s candles', async () => {
    at('2026-12-06T12:00:00Z');
    render(page());
    expect(await screen.findByTestId('season-lights')).toBeTruthy();
    expect(screen.getByTestId('season-snow')).toBeTruthy();
    expect((await screen.findByTestId('season-wreath')).getAttribute('data-lit')).toBe('2');
    expect(screen.getByTestId('season-badge').textContent).toContain('2. Advent');
    expect(requests.some((url) => url.endsWith('/api/season'))).toBe(true);
  });

  it('less motion: the decoration stands still, no snow and no twinkling', async () => {
    at('2026-12-06T12:00:00Z');
    window.matchMedia = vi.fn(() => ({ matches: true }));
    render(page());
    const lights = await screen.findByTestId('season-lights');
    expect(screen.queryByTestId('season-snow')).toBeNull();
    expect(lights.querySelector('.season-bulb-anim')).toBeNull();
    expect((await screen.findByTestId('season-wreath')).querySelector('.season-flame-anim')).toBeNull();
  });

  it('the owner’s main switch turns a season off for the website too', async () => {
    at('2026-12-06T12:00:00Z');
    answerSeason({ advent: false });
    render(page());
    await act(async () => { await Promise.resolve(); });
    expect(screen.queryByTestId('season-badge')).toBeNull();
    expect(screen.queryByTestId('season-lights')).toBeNull();
  });

  it('"Deko ausblenden" hides everything and is remembered; one click brings it back', async () => {
    at('2026-12-24T12:00:00Z');
    render(page());
    expect((await screen.findByTestId('season-badge')).textContent).toContain('Frohe Weihnachten');
    fireEvent.click(screen.getByTestId('season-hide'));
    expect(screen.queryByTestId('season-lights')).toBeNull();
    expect(window.localStorage.getItem(DECOR_HIDDEN_KEY)).toBe('1');
    cleanup();

    render(page());
    const show = await screen.findByTestId('season-show');
    expect(screen.queryByTestId('season-lights')).toBeNull();
    fireEvent.click(show);
    expect(await screen.findByTestId('season-lights')).toBeTruthy();
    expect(window.localStorage.getItem(DECOR_HIDDEN_KEY)).toBeNull();
  });

  it('Easter: five hidden eggs, the badge counts them; whoever finds all of them gets the greeting', async () => {
    at('2027-03-28T12:00:00Z');
    render(page());
    expect((await screen.findByTestId('season-badge')).textContent).toContain('Frohe Ostern');
    expect(screen.getByTestId('season-egg-count').textContent).toContain('0 von 5 Eiern gefunden');
    for (let index = 1; index <= EGG_COUNT; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- one egg after the other, like a person clicks
      const egg = await screen.findByTestId(`season-egg-${index}`);
      expect(egg.getAttribute('aria-label')).toBe('Osterei');
      fireEvent.click(egg);
    }
    expect(screen.getByTestId('season-badge').textContent).toContain('Alle Ostereier gefunden!');
    expect(screen.queryByTestId('season-egg-count')).toBeNull();
    expect(JSON.parse(window.localStorage.getItem('omnifm.easterEggs.2027'))).toHaveLength(5);
  });

  it('the eggs hide in the page itself: behind cards, at the end of a line, on a card’s edge; never over text', () => {
    const measured = {
      width: 1400, height: 1600, top: 84, bottom: 96,
      obstacles: [
        { id: 0, kind: 'text', x: 100, y: 120, w: 500, h: 180 },
        { id: 1, kind: 'box', framed: true, x: 800, y: 140, w: 360, h: 220 },
        { id: 2, kind: 'box', framed: true, x: 100, y: 820, w: 320, h: 300 },
        { id: 3, kind: 'box', framed: true, x: 440, y: 820, w: 320, h: 300 },
        { id: 4, kind: 'box', framed: true, x: 780, y: 820, w: 320, h: 300 },
        { id: 5, kind: 'text', x: 120, y: 850, w: 280, h: 200 },
        { id: 6, kind: 'text', x: 100, y: 700, w: 700, h: 60 },
      ],
      lines: [{ x: 100, y: 730, w: 380, h: 30, owner: 6 }, { x: 120, y: 1020, w: 150, h: 24, owner: 5 }],
    };
    const types = new Set();
    const layouts = new Set();
    for (let seed = 1; seed <= 20; seed += 1) {
      const spots = easterSpots(measured, seeded(seed));
      expect(spots.length).toBeLessThanOrEqual(EGG_COUNT);
      layouts.add(JSON.stringify(spots.map((spot) => [spot.type, Math.round(spot.x), Math.round(spot.y)])));
      for (const spot of spots) {
        types.add(spot.type);
        const shows = spot.type === 'peek' ? spot.visible : { x: spot.x, y: spot.type === 'shelf' ? spot.y - spot.size : spot.y, w: spot.w || spot.size, h: spot.h || spot.size - 2 };
        expect(isFree(shows, measured, { ignore: [5, 6] })).toBe(true);
      }
    }
    expect(types).toEqual(new Set(['peek', 'text', 'shelf']).intersection(types));
    expect(types.has('peek') && types.has('text')).toBe(true);
    expect(layouts.size).toBeGreaterThan(15);
  });

  it('New Year: the fireworks go behind the page’s content, and not at all with less motion', async () => {
    at('2026-09-28T12:00:00Z', '?lang=de&season=newyear-greeting');
    const { unmount } = render(page());
    const canvas = await screen.findByTestId(/^season-fireworks-/);
    expect(canvas.style.zIndex).toBe('-1');
    expect(canvas.style.pointerEvents).toBe('none');
    unmount();

    window.matchMedia = vi.fn(() => ({ matches: true }));
    render(page());
    await screen.findByTestId('season-badge');
    expect(screen.queryByTestId(/^season-fireworks-/)).toBeNull();
  });

  it('rockets now and then: all New Year’s Day, on New Year’s Eve from six in the evening, always in the preview', () => {
    expect(ambientFireworks({ season: 'newyear', phase: 'greeting' })).toBe(true);
    expect(ambientFireworks({ season: 'newyear', phase: 'countdown', secondsToMidnight: 5 * 3600 })).toBe(true);
    expect(ambientFireworks({ season: 'newyear', phase: 'countdown', secondsToMidnight: 7 * 3600 })).toBe(false);
    expect(ambientFireworks({ season: 'newyear', phase: 'countdown', secondsToMidnight: 7 * 3600, preview: true })).toBe(true);
    expect(ambientFireworks({ season: 'christmas', phase: 'greeting' })).toBe(false);
  });

  it('?season= shows a look out of season, without asking the server', async () => {
    at('2026-09-28T12:00:00Z', '?lang=en&season=newyear-countdown');
    render(page());
    expect((await screen.findByTestId('season-countdown')).textContent).toMatch(/^🎆 \d\d:\d\d:\d\d until 2027$/);
    expect(requests).toEqual([]);
    expect(visitorSeason({ now: new Date('2026-09-28T12:00:00Z'), search: '?season=summer' })).toBeNull();
  });
});
