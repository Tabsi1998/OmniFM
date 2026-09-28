import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import OwnerAdmin from './OwnerAdmin.js';
import { OWNER_PAGES } from '../lib/ownerNavigation.js';

// The owner console behind the sign-in (#296): signed in with the token, the
// API answering with small but valid data, every page is opened. A page that
// throws, or makes React report an error, fails the test - the net for
// splitting the console into parts.

const LICENSE = {
  licenseKey: 'OMNI-TEST-1', plan: 'pro', tier: 'pro', planName: 'Pro', seats: 2, seatsUsed: 1, active: true,
  expired: false, createdAt: '2026-09-01T00:00:00.000Z', expiresAt: '2026-12-01T00:00:00.000Z', contactEmail: 'k***@example.com',
  linkedServers: [{ id: '123456789012345678', name: 'Radio Club', licenseResolved: true, effectivePlan: 'pro' }],
};
const STATION = { key: 'groovesalad', name: 'Groove Salad', url: 'https://ice.somafm.com/groovesalad-128-mp3', tier: 'free', genre: 'Ambient', is_default: true };

function answerFor(url) {
  const route = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  if (route === '/api/admin/session') return { authenticated: false, discordLogin: false };
  if (route === '/api/admin/overview') {
    return {
      licenses: { total: 1, active: 1, expired: 0, byPlan: { pro: 1 }, seatsSold: 2 },
      revenue: { mrr: 2.99, arr: 35.88, currency: 'EUR' },
      stations: { free: 1, pro: 0, total: 1 },
      bots: { configured: 2, online: 2, commander: 'OmniFM DJ' },
      guilds: { managed: 3, live: true },
      integrations: { mongo: true, discordOAuth: true, smtp: false },
    };
  }
  if (route === '/api/admin/licenses') return { licenses: [LICENSE], count: 1 };
  if (route === '/api/admin/guilds') return { guilds: [{ id: '123456789012345678', name: 'Radio Club' }], count: 1, live: true };
  if (route === '/api/admin/stations') return { total: 1, free: 1, pro: 0, ultimate: 0, stations: [STATION] };
  if (route === '/api/admin/stations/list') return { stations: [STATION] };
  if (route === '/api/admin/activity') return { activity: [{ type: 'license', at: '2026-09-01T00:00:00.000Z', label: 'Pro Lizenz ausgestellt', detail: 'k***@example.com' }] };
  if (route === '/api/admin/monitoring') {
    // What monitoringResponse() answers while the bot reports nothing yet.
    return {
      generatedAt: '2026-09-27T20:10:24.347Z', simulated: false, live: false, waiting: true, process: null,
      health: { healthyNodes: 0, totalNodes: 0, uptimeSec: 0, apiLatencyMs: null, mongo: false, openIncidents: 0 },
      nodes: [], affectedServers: [], incidents: [], logs: [],
      message: 'Warte auf Live-Daten vom OmniFM-Bot.',
    };
  }
  if (route === '/api/admin/failover-history') return { history: [], count: 0 };
  if (route === '/api/admin/audit') return { audit: [], entries: [] };
  if (route === '/api/admin/archive') return { archive: [], count: 0 };
  if (route === '/api/admin/server-retention') return { retentionDays: 30, pending: [], count: 0 };
  if (route === '/api/admin/status-notices') {
    return { notices: [{ id: 'a1b2c3d4e5f60718', kind: 'maintenance', title: 'Server-Update', message: '', impact: 'maintenance', startsAt: '2026-09-28T08:00:00.000Z', endsAt: '2026-09-28T09:00:00.000Z', resolvedAt: null }] };
  }
  if (route === '/api/owner/status') return { checks: [], checkedAt: null };
  if (route === '/api/admin/config') return { charts: { postEnabled: false, channelId: '', language: 'de' } };
  return {};
}

let consoleErrors;

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  window.localStorage.setItem('omnifm_admin_token', 'test-token');
  consoleErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => { consoleErrors.push(args.map(String).join(' ')); });
  vi.stubGlobal('fetch', vi.fn(async (url) => ({
    ok: !String(url).includes('/api/admin/session'),
    status: String(url).includes('/api/admin/session') ? 404 : 200,
    json: async () => answerFor(url),
  })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('owner console pages', () => {
  it('opens every page after the sign-in without a broken part', async () => {
    render(<I18nProvider><OwnerAdmin /></I18nProvider>);
    expect(await screen.findByTestId('admin-section-title')).toBeTruthy();
    for (const page of OWNER_PAGES) {
      // eslint-disable-next-line no-await-in-loop -- one page after the other, like a person clicks
      await act(async () => { fireEvent.click(screen.getByTestId(`admin-nav-${page.area}`)); });
      const tab = screen.queryByTestId(`admin-page-${page.id}`);
      if (tab) {
        // eslint-disable-next-line no-await-in-loop
        await act(async () => { fireEvent.click(tab); });
      }
    }
    const reactErrors = consoleErrors.filter((line) => /error occurred in|Uncaught|is not defined|Cannot read/i.test(line));
    expect(reactErrors).toEqual([]);
  });
});
