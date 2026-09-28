import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../../i18n.js';
import { PlayerProvider } from '../../lib/player.js';
import { resetOwnerSeasonSwitches } from '../../lib/seasonSite.js';
import Halloween, { CORNERS, halloweenLayout } from './Halloween.js';
import SeasonLayer from './SeasonLayer.js';
import StationBrowser from '../StationBrowser.js';

// Halloween on the website (#443) and the season rubric of the station
// browser (#430): at random each visit, never in the way, still for "less motion".

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
  it('places webs and pumpkins at random on every visit, only in corners and at edges', () => {
    const one = halloweenLayout(sequence(0.01, 0.4, 0.7));
    const two = halloweenLayout(sequence(0.99, 0.2, 0.5));
    expect(one).not.toEqual(two);
    for (const layout of [one, two]) {
      expect(layout.screenWebs).toHaveLength(2);
      expect(layout.screenWebs.every((web) => CORNERS.includes(web.corner))).toBe(true);
      expect(new Set(layout.screenWebs.map((web) => web.corner)).size).toBe(2);
      expect(layout.pumpkins).toHaveLength(3);
    }
    const phone = halloweenLayout(sequence(0.5, 0.2), { narrow: true });
    expect(phone.screenWebs).toHaveLength(1);
    expect(phone.screenWebs[0].corner.startsWith('top')).toBe(true);
    expect(phone.sectionWebs).toEqual([]);
  });

  it('never takes a click: the whole layer lets clicks through', () => {
    render(<Halloween animated={false} random={sequence(0.3, 0.6)} />);
    const layer = screen.getByTestId('season-halloween');
    expect(window.getComputedStyle(layer).pointerEvents).toBe('none');
    expect(screen.getAllByTestId('hw-screen-web')).toHaveLength(2);
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
