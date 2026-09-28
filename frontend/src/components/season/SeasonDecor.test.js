import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../i18n.js';
import { DECOR_HIDDEN_KEY, resetOwnerSeasonSwitches, visitorSeason } from '../../lib/seasonSite.js';
import SeasonLayer from './SeasonLayer.js';
import { EGG_SPOTS } from './SeasonDecor.js';

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
      {EGG_SPOTS.slice(1).map(([testId]) => <section key={testId} data-testid={testId} />)}
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

  it('Easter: five hidden eggs; whoever finds all of them gets the greeting', async () => {
    at('2027-03-28T12:00:00Z');
    render(page());
    expect((await screen.findByTestId('season-badge')).textContent).toContain('Frohe Ostern');
    for (let index = 1; index <= EGG_SPOTS.length; index += 1) {
      // eslint-disable-next-line no-await-in-loop -- one egg after the other, like a person clicks
      const egg = await screen.findByTestId(`season-egg-${index}`);
      expect(egg.getAttribute('aria-label')).toBe('Osterei');
      fireEvent.click(egg);
    }
    expect(screen.getByTestId('season-badge').textContent).toContain('Alle Ostereier gefunden!');
    expect(JSON.parse(window.localStorage.getItem('omnifm.easterEggs.2027'))).toHaveLength(5);
  });

  it('?season= shows a look out of season, without asking the server', async () => {
    at('2026-09-28T12:00:00Z', '?lang=en&season=newyear-countdown');
    render(page());
    expect((await screen.findByTestId('season-countdown')).textContent).toMatch(/^🎆 \d\d:\d\d:\d\d until 2027$/);
    expect(requests).toEqual([]);
    expect(visitorSeason({ now: new Date('2026-09-28T12:00:00Z'), search: '?season=summer' })).toBeNull();
  });
});
