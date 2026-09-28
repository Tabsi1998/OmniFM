import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import GuildDashboard from './GuildDashboard.js';
import { PLAN_CAPABILITIES } from '../../../src/config/plan-features.js';

// The server dashboard people use at /dashboard (#294, #375): a signed-in
// Ultimate server, the API mocked with small but valid answers. Every area is
// opened; an area that throws, or makes React report an error, fails the test.

const SERVER = '123456789012345678';
// Every capability of the plan file (#413), all switched on.
const ALL_CAPABILITIES = Object.fromEntries(Object.values(PLAN_CAPABILITIES).map((entry) => [entry.apiKey, true]));

function answerFor(url) {
  const route = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  if (route === '/api/auth/session') {
    return {
      authenticated: true,
      user: { id: '1', username: 'admin' },
      guilds: [{ id: SERVER, name: 'Radio Club', tier: 'ultimate', dashboardEnabled: true, capabilities: ALL_CAPABILITIES, limits: {}, upgradeHints: {} }],
    };
  }
  if (route === '/api/dashboard/license') return { tier: 'ultimate', dashboardEnabled: true, ultimateEnabled: true, license: null };
  if (route === '/api/dashboard/stats') return { tier: 'ultimate', basic: null, advanced: null };
  if (route === '/api/dashboard/events') return { events: [] };
  if (route === '/api/dashboard/perms') return { rules: [], commandRoleMap: {} };
  if (route === '/api/dashboard/roles') return { roles: [] };
  if (route === '/api/dashboard/channels') return { voiceChannels: [], textChannels: [], channels: [] };
  if (route === '/api/dashboard/stations') return { stations: [], free: [], pro: [], ultimate: [], custom: [] };
  if (route === '/api/dashboard/emojis') return { emojis: [] };
  if (route === '/api/dashboard/custom-stations') return { stations: [], limit: 50 };
  if (route === '/api/dashboard/settings') return { settings: {} };
  return {};
}

let consoleErrors;

beforeEach(() => {
  window.localStorage.clear();
  window.history.replaceState({}, '', '/dashboard?lang=de');
  consoleErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => { consoleErrors.push(args.map(String).join(' ')); });
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: true,
    status: 200,
    json: async () => answerFor(url),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('server dashboard', () => {
  it('opens every area, the settings included, without a broken building block', async () => {
    render(<I18nProvider><GuildDashboard /></I18nProvider>);
    await screen.findByTestId('guild-nav-overview');
    for (const area of ['overview', 'stations', 'events', 'roles', 'stats', 'subscription', 'settings']) {
      const button = screen.getByTestId(`guild-nav-${area}`);
      // eslint-disable-next-line no-await-in-loop -- one area after the other, like a person clicks
      await act(async () => { fireEvent.click(button); });
      // eslint-disable-next-line no-await-in-loop
      await waitFor(() => expect(screen.getByTestId('guild-dashboard')).toBeTruthy());
    }
    const reactErrors = consoleErrors.filter((line) => /error occurred in|Uncaught|is not defined|Cannot read/i.test(line));
    expect(reactErrors).toEqual([]);
  });
});
