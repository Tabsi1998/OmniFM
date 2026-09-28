import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import { PLAN_CAPABILITIES, PLAN_NAMES } from '../../../src/config/plan-features.js';
import DashboardPreview from './DashboardPreview.js';
import { TOUR_STEPS } from './DashboardTour.js';
import Navbar from './Navbar.js';

// The start page's tour through the dashboard preview (#432).

beforeEach(() => {
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-DE']);
  // jsdom has no layout: the section is 1100 px wide, like on a laptop.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(1100);
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

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

  it('shows the real dashboard with example data in a frame, and the way to try it', () => {
    const { container } = renderPreview();
    const frame = container.querySelector('iframe');
    expect(frame.getAttribute('src')).toBe('/dashboard?demo=tour&lang=de');
    expect(frame.getAttribute('title')).toBe('Rundgang durch das Dashboard mit Beispieldaten');
    // 1280 × 800 drawn at 1100 px: 688 px high, no guessing.
    expect(frame.parentElement.style.height).toBe('688px');
    expect(screen.getByTestId('dashboard-preview-try').getAttribute('href')).toBe('/dashboard?demo=1&lang=de');
  });

  it('a click on a step shows it and stops the tour', async () => {
    renderPreview();
    await act(async () => { fireEvent.click(screen.getByTestId('tour-step-stats')); });
    expect(screen.getByTestId('dashboard-tour').getAttribute('data-step')).toBe('stats');
    expect(screen.getByTestId('tour-step-stats').getAttribute('aria-current')).toBe('step');
    expect(screen.getByTestId('tour-pause').getAttribute('aria-label')).toBe('Demo abspielen');
  });

  it('draws the phone layout of the dashboard on a phone', () => {
    vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(358);
    const { container } = renderPreview();
    const frame = container.querySelector('iframe');
    expect(frame.style.width).toBe('420px');
    expect(frame.parentElement.style.height).toBe(`${Math.round(760 * (358 / 420))}px`);
    // The seven steps are one row to swipe, not seven rows.
    expect(screen.getByTestId('tour-steps').style.flexWrap).toBe('nowrap');
  });

  it('is in the menu again, where "Dashboard und Betrieb" was', () => {
    render(<I18nProvider><Navbar page="home" /></I18nProvider>);
    expect(screen.getByTestId('nav-link-demo').getAttribute('href')).toBe('#dashboard-demo');
  });
});
