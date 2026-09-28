import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../i18n.js';
import { PlayerProvider } from '../../lib/player.js';
import { resetOwnerSeasonSwitches } from '../../lib/seasonSite.js';
import Halloween, { halloweenLayout, halloweenSizes, webShape } from './Halloween.js';
import { isFree, seeded } from './pageSpots.js';
import SeasonLayer from './SeasonLayer.js';
import StationBrowser from '../StationBrowser.js';

// Halloween on the website (#443, #448) and the season rubric of the station
// browser (#430): at random each visit, tied to the page, never in the way,
// still for "less motion".

// A start page as rectangles: a hero text, a card, a title and three cards with text.
function samplePage(width = 1400) {
  const obstacles = [
    { id: 0, kind: 'text', x: 100, y: 120, w: 500, h: 180 },
    { id: 1, kind: 'box', framed: true, x: 800, y: 140, w: 360, h: 220 },
    { id: 2, kind: 'text', x: 100, y: 700, w: 700, h: 60 },
    { id: 3, kind: 'box', framed: true, x: 100, y: 820, w: 320, h: 300 },
    { id: 4, kind: 'box', framed: true, x: 440, y: 820, w: 320, h: 300 },
    { id: 5, kind: 'box', framed: true, x: 780, y: 820, w: 320, h: 300 },
    { id: 6, kind: 'text', x: 120, y: 850, w: 960, h: 200 },
  ];
  return { width, height: 1600, top: 84, bottom: 96, obstacles, lines: [] };
}

function sequence(...values) {
  let index = 0;
  return () => values[index++ % values.length];
}

beforeEach(() => {
  window.localStorage.clear();
  resetOwnerSeasonSwitches();
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ enabled: {} }) })));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

describe('Halloween', () => {
  it('round webs in open space and pumpkins on cards, different on every visit', () => {
    const page = samplePage();
    const seen = new Set();
    for (let seed = 1; seed <= 20; seed += 1) {
      const layout = halloweenLayout(page, seeded(seed));
      seen.add(JSON.stringify([layout.webs.map((web) => Math.round(web.cx)), layout.pumpkins.map((spot) => Math.round(spot.x))]));
      expect(layout.webs.length).toBeLessThanOrEqual(halloweenSizes(1400).webs.max);
      for (const web of layout.webs) {
        expect(isFree({ x: web.cx - web.r, y: web.cy - web.r, w: 2 * web.r, h: 2 * web.r }, page, { pad: 14 })).toBe(true);
        expect(web.shape.spokes.length).toBeGreaterThanOrEqual(11);
      }
      for (const pumpkin of layout.pumpkins) {
        expect(page.obstacles.some((card) => card.framed && card.y === pumpkin.y)).toBe(true);
        expect(pumpkin.size).toBeLessThanOrEqual(halloweenSizes(1400).pumpkins.size);
      }
      expect(layout.resting).toBeLessThan(Math.max(1, layout.webs.length));
    }
    expect(seen.size).toBeGreaterThan(12);
  });

  it('a phone gets few, small webs; a wide screen more and bigger ones', () => {
    expect(halloweenSizes(390).webs.max).toBeLessThanOrEqual(2);
    expect(halloweenSizes(390).webs.maxRadius).toBeLessThanOrEqual(32);
    expect(halloweenSizes(2560).webs.max).toBeGreaterThan(halloweenSizes(1400).webs.max);
    const shape = webShape(seeded(3), 50);
    expect(shape.squash).toBeGreaterThan(0.85);
    expect(shape.squash).toBeLessThan(1.07);
    expect(shape.spokes.every((spoke) => spoke.length <= 50 && spoke.length >= 43)).toBe(true);
  });

  it('never takes a click: the whole layer lets clicks through, and the page measure skips it', () => {
    render(<Halloween animated={false} random={sequence(0.3, 0.6)} />);
    const layer = screen.getByTestId('season-halloween');
    expect(window.getComputedStyle(layer).pointerEvents).toBe('none');
    expect(layer.hasAttribute('data-season-skip')).toBe(true);
  });

  it('now and then a spider or bats come by; with "less motion" never', () => {
    vi.useFakeTimers();
    const { unmount } = render(<Halloween animated random={sequence(0.1, 0.2, 0.3)} />);
    expect(screen.queryByTestId('hw-spider-drop')).toBeNull();
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(screen.queryByTestId('hw-spider-drop') || screen.queryByTestId('hw-spider-walk') || screen.queryByTestId('hw-bats')).toBeTruthy();
    unmount();

    render(<Halloween animated={false} random={sequence(0.1, 0.2, 0.3)} />);
    act(() => { vi.advanceTimersByTime(120_000); });
    expect(screen.queryByTestId('hw-spider-drop')).toBeNull();
    expect(screen.queryByTestId('hw-spider-walk')).toBeNull();
    expect(screen.queryByTestId('hw-bats')).toBeNull();
  });

  it('?season=halloween-greeting shows the badge and the decoration on the start page', async () => {
    window.history.replaceState({}, '', '/?lang=de&season=halloween-greeting');
    render(
      <I18nProvider>
        <section data-testid="hero-section" />
        <SeasonLayer />
      </I18nProvider>,
    );
    expect((await screen.findByTestId('season-badge')).textContent).toContain('Happy Halloween!');
    expect(screen.getByTestId('season-halloween')).toBeTruthy();
  });
});

describe('station browser: the season rubric', () => {
  const STATIONS = [
    { key: 'groove', name: 'Groove Salad', tier: 'free' },
    { key: 'xmaslounge', name: 'Christmas Lounge', tier: 'free', seasons: ['christmas'] },
    { key: 'spooky', name: 'Spooky Radio', tier: 'pro', seasons: ['halloween'] },
  ];

  function browser() {
    return render(
      <I18nProvider>
        <PlayerProvider>
          <StationBrowser stations={STATIONS} loading={false} />
        </PlayerProvider>
      </I18nProvider>,
    );
  }

  it('in Advent the Christmas stations get their own rubric above the list', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-12-06T12:00:00Z'));
    window.history.replaceState({}, '', '/?lang=de');
    browser();
    const rubric = await screen.findByTestId('station-season-rubric');
    expect(rubric.textContent).toContain('🎄 Weihnachtsradio');
    expect(rubric.textContent).toContain('Christmas Lounge');
    expect(rubric.textContent).not.toContain('Spooky Radio');
  });

  it('out of season there is no rubric', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
    browser();
    expect(screen.queryByTestId('station-season-rubric')).toBeNull();
  });
});
