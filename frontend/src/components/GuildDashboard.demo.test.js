import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import GuildDashboard from './GuildDashboard.js';

// The dashboard preview (#432): /dashboard?demo shows three example servers,
// one per plan. Nothing goes to the server and nothing is stored; a change
// says so. test/dashboard-demo.test.js holds the example data against the
// server's code.

let consoleErrors;
let serverAsked;

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/dashboard?demo=1&lang=de');
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-DE']);
  consoleErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => { consoleErrors.push(args.map(String).join(' ')); });
  serverAsked = vi.fn(async () => { throw new Error('the preview must not ask the server'); });
  vi.stubGlobal('fetch', serverAsked);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState({}, '', '/');
});

async function openArea(area) {
  await act(async () => { fireEvent.click(screen.getByTestId(`guild-nav-${area}`)); });
}

async function openPreview() {
  render(<I18nProvider><GuildDashboard /></I18nProvider>);
  await screen.findByTestId('guild-demo-banner');
  // The overview of the Ultimate example server, with what plays where.
  await screen.findByTestId('stream-controls-worker-1');
}

describe('the dashboard preview', () => {
  it('shows every area of the Ultimate example server and asks the server nothing', async () => {
    const stored = JSON.stringify({ ...window.localStorage });
    await openPreview();
    expect(screen.getByTestId('guild-active-tier').textContent).toContain('Ultimate');
    const overview = screen.getByTestId('guild-dashboard').textContent;
    for (const station of ['LoFi Beats', 'Groove Salad', 'Melodic Techno']) expect(overview).toContain(station);
    await screen.findByTestId('guild-live-view');

    await openArea('stations');
    expect(screen.getByText('Café Beats')).toBeTruthy();
    expect(screen.getByTestId('guild-preset-stations').textContent).toContain('Groove Salad');

    await openArea('events');
    expect(await screen.findByText('Lofi Night')).toBeTruthy();
    // The station by its name, not its key.
    expect(screen.getByTestId('event-station-demo-lofi-night').textContent).toBe('LoFi Beats');

    await openArea('roles');
    expect(screen.getByTestId('guild-perms-matrix').textContent).toContain('DJ');

    await openArea('stats');
    expect(screen.getByText('Peak Hörer')).toBeTruthy();

    await openArea('subscription');
    expect(screen.getByTestId('guild-license-details').textContent).toContain('1/2');

    await openArea('settings');
    await screen.findByTestId('settings-panel-designer');

    expect(serverAsked).not.toHaveBeenCalled();
    expect(JSON.stringify({ ...window.localStorage })).toBe(stored);
    expect(consoleErrors.filter((line) => /error occurred in|Uncaught|is not defined|Cannot read/i.test(line))).toEqual([]);
  });

  it('keeps nothing: saving says that the preview saves nothing', async () => {
    await openPreview();
    await openArea('roles');
    await act(async () => { fireEvent.click(screen.getByText('Speichern')); });
    expect((await screen.findByTestId('guild-message')).textContent).toContain('In der Vorschau wird nichts gespeichert');
    expect(serverAsked).not.toHaveBeenCalled();
  });

  it('shows each plan with what it has: Free locks the statistics, Pro your own stations', async () => {
    await openPreview();
    await act(async () => { fireEvent.change(screen.getByTestId('guild-switcher'), { target: { value: '900000000000000103' } }); });
    await waitFor(() => expect(screen.getByTestId('guild-active-tier').textContent).toContain('Free'));
    await openArea('stats');
    expect(screen.getByTestId('guild-stats-locked')).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByTestId('guild-switcher'), { target: { value: '900000000000000102' } }); });
    await waitFor(() => expect(screen.getByTestId('guild-active-tier').textContent).toContain('Pro'));
    await openArea('stations');
    expect(screen.getByTestId('guild-custom-locked')).toBeTruthy();
    expect(serverAsked).not.toHaveBeenCalled();
  });

  it('leads to the real dashboard and back to the website', async () => {
    await openPreview();
    expect(screen.getByTestId('guild-demo-login').getAttribute('href')).toContain('/api/auth/discord/login');
    expect(screen.getByTestId('guild-demo-website').getAttribute('href')).toBe('/?lang=de');
  });

  it('in the start page tour: the same preview, without buttons', async () => {
    window.history.replaceState({}, '', '/dashboard?demo=tour&lang=de');
    await openPreview();
    expect(screen.queryByTestId('guild-demo-login')).toBeNull();
  });
});
