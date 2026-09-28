import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import { PLAN_CAPABILITIES, PLAN_NAMES } from '../../../src/config/plan-features.js';
import DashboardPreview from './DashboardPreview.js';
import { TOUR_STEPS } from './DashboardTour.js';
import Navbar from './Navbar.js';

// The start page's tour through the dashboard preview (#432).

let serverAsked;

beforeEach(() => {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-DE']);
  // jsdom has no layout: the section is 1100 px wide, like on a laptop.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1100);
  serverAsked = vi.fn(async () => { throw new Error('the tour must not ask the server'); });
  vi.stubGlobal('fetch', serverAsked);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

// The phone: the window is narrower than the dashboard's own switch to its phone layout.
function onPhone() {
  vi.spyOn(window, 'matchMedia').mockImplementation((query) => ({
    matches: query === '(max-width: 860px)', media: query, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {},
  }));
}

const renderPreview = () => render(<I18nProvider><DashboardPreview /></I18nProvider>);

describe('the dashboard preview on the start page', () => {
  it('labels every step with the plan the plan file names', () => {
    renderPreview();
    const label = { free: 'Jeder Plan', pro: `ab ${PLAN_NAMES.pro}`, ultimate: PLAN_NAMES.ultimate };
    for (const step of TOUR_STEPS) {
      expect(screen.getByTestId(`tour-plan-${step.key}`).textContent, step.key).toBe(label[PLAN_CAPABILITIES[step.capability].minPlan]);
    }
    // What the page says about the plans, spelled out: events on every plan (#413), own stations on Ultimate.
    expect(screen.getByTestId('tour-plan-events').textContent).toBe('Jeder Plan');
    expect(screen.getByTestId('tour-plan-stations').textContent).toBe('Ultimate');
    expect(screen.getByTestId('tour-plan-roles').textContent).toBe('ab Pro');
  });

  it('shows the real dashboard with example data in the page, out of reach, and the way to try it', { timeout: 15000 }, async () => {
    renderPreview();
    const tourScreen = screen.getByTestId('tour-screen');
    // The dashboard itself, answering from the example data: its banner, the Ultimate example server.
    // The dashboard's code comes as its own download, like on the page.
    expect(await within(tourScreen).findByTestId('guild-demo-banner', {}, { timeout: 8000 })).toBeTruthy();
    expect((await within(tourScreen).findByTestId('guild-active-tier', {}, { timeout: 8000 })).textContent).toContain('Ultimate');
    // No clicks, no keyboard, no screen reader inside; the figure says what it shows.
    expect(tourScreen.hasAttribute('inert')).toBe(true);
    expect(screen.getByTestId('dashboard-tour').getAttribute('aria-label')).toBe('Rundgang durch das Dashboard mit Beispieldaten');
    // 1280 × 800 drawn at 1100 px: 688 px high, no guessing.
    expect(screen.getByTestId('tour-frame').style.height).toBe('688px');
    expect(tourScreen.style.transform).toBe(`scale(${1100 / 1280})`);
    expect(screen.getByTestId('dashboard-preview-try').getAttribute('href')).toBe('/dashboard?demo=1&lang=de');
    expect(serverAsked).not.toHaveBeenCalled();
  });

  it('a click on a step shows it and stops the tour', async () => {
    renderPreview();
    await act(async () => { fireEvent.click(screen.getByTestId('tour-step-stats')); });
    expect(screen.getByTestId('dashboard-tour').getAttribute('data-step')).toBe('stats');
    expect(screen.getByTestId('tour-step-stats').getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('tour-pause').getAttribute('aria-label')).toBe('Demo abspielen');
  });

  it('on a phone: the phone layout of the dashboard, at the width it is made for', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(358);
    onPhone();
    renderPreview();
    const tourScreen = screen.getByTestId('tour-screen');
    // Drawn 375 px wide like a small phone, shown at 358 px.
    expect(tourScreen.style.width).toBe('375px');
    expect(tourScreen.style.transform).toBe(`scale(${358 / 375})`);
    expect(screen.getByTestId('tour-frame').style.height).toBe(`${Math.round(640 * (358 / 375))}px`);
    // The seven steps are one row to swipe, not seven rows.
    expect(screen.getByTestId('tour-steps').style.flexWrap).toBe('nowrap');
  });

  it('is in the menu again, where "Dashboard und Betrieb" was', () => {
    render(<I18nProvider><Navbar page="home" /></I18nProvider>);
    expect(screen.getByTestId('nav-link-demo').getAttribute('href')).toBe('#dashboard-demo');
  });
});
