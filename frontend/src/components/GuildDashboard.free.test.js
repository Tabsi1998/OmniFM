import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import GuildDashboard from './GuildDashboard.js';
import { PLAN_CAPABILITIES, PLAN_ORDER } from '../../../src/config/plan-features.js';

// The dashboard of a Free server (#413 part 3): what plays where with switch
// and stop, one event, language, voice guard and favourites; the rest shows
// what Pro brings.

const SERVER = '123456789012345678';
const FREE_CAPABILITIES = Object.fromEntries(Object.values(PLAN_CAPABILITIES)
  .map((entry) => [entry.apiKey, PLAN_ORDER.indexOf(entry.minPlan) === 0]));
const STREAM = { botId: 'w1', botName: 'OmniFM 1', stationKey: 'groovesalad', stationName: 'Groove Salad', channelId: 'c1', channelName: 'Radio', listeners: 3 };

let requests;

function answerFor(url, options = {}) {
  const route = String(url).replace(/^https?:\/\/[^/]+/, '').split('?')[0];
  requests.push({ route, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
  if (route === '/api/auth/session') {
    return {
      authenticated: true,
      user: { id: '1', username: 'admin' },
      guilds: [{ id: SERVER, name: 'Radio Club', tier: 'free', dashboardEnabled: false, capabilities: FREE_CAPABILITIES, limits: {}, upgradeHints: {} }],
    };
  }
  if (route === '/api/dashboard/license') return { tier: 'free', dashboardEnabled: false, ultimateEnabled: false, license: null };
  if (route === '/api/dashboard/playback/now') return { streams: [STREAM] };
  if (route === '/api/dashboard/playback/switch') return { ok: true, action: 'switch', stationKey: 'dronezone', stationName: 'Drone Zone' };
  if (route === '/api/dashboard/playback/stop') return { ok: true, action: 'stop' };
  if (route === '/api/dashboard/events') return { events: [] };
  if (route === '/api/dashboard/channels') return { voiceChannels: [], textChannels: [], channels: [] };
  if (route === '/api/dashboard/stations') {
    return { free: [{ key: 'groovesalad', name: 'Groove Salad' }, { key: 'dronezone', name: 'Drone Zone' }], pro: [], ultimate: [], custom: [] };
  }
  if (route === '/api/dashboard/emojis') return { emojis: [] };
  if (route === '/api/dashboard/settings') {
    return {
      capabilities: FREE_CAPABILITIES,
      serverLanguage: { current: 'auto', options: ['auto', 'de', 'en'] },
      favorites: { stations: [], limit: 3, max: 10 },
      voiceStatus: { template: '', defaultTemplate: '{station}', placeholders: ['station'], maxLength: 120 },
      voiceGuard: { policy: 'return' },
    };
  }
  return {};
}

beforeEach(() => {
  requests = [];
  window.localStorage.clear();
  window.history.replaceState({}, '', '/dashboard?lang=de');
  vi.stubGlobal('fetch', vi.fn(async (url, options) => ({ ok: true, status: 200, json: async () => answerFor(url, options) })));
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const open = async (area) => {
  const button = screen.getByTestId(`guild-nav-${area}`);
  await act(async () => { fireEvent.click(button); });
};

describe('the dashboard of a Free server', () => {
  it('lists what plays where and switches or stops it', async () => {
    render(<I18nProvider><GuildDashboard /></I18nProvider>);
    const select = await screen.findByTestId('stream-station-w1');
    expect(screen.getAllByText('Groove Salad').length).toBeGreaterThan(0);
    expect(requests.some((request) => request.route === '/api/dashboard/stats')).toBe(false);

    fireEvent.change(select, { target: { value: 'dronezone' } });
    const switchButton = screen.getByTestId('stream-switch-w1');
    await act(async () => { fireEvent.click(switchButton); });
    const switchRequest = requests.find((request) => request.route === '/api/dashboard/playback/switch');
    expect(switchRequest.method).toBe('POST');
    expect(switchRequest.body).toEqual({ serverId: SERVER, botId: 'w1', stationKey: 'dronezone' });
    expect((await screen.findByTestId('stream-message-w1')).textContent).toContain('Drone Zone');

    const stop = await screen.findByTestId('stream-stop-w1');
    await act(async () => { fireEvent.click(stop); });
    expect(requests.some((request) => request.route === '/api/dashboard/playback/stop')).toBe(false);
    expect(screen.getByTestId('stream-stop-w1').textContent).toMatch(/Wirklich stoppen\?|Really stop\?/);
    await act(async () => { fireEvent.click(screen.getByTestId('stream-stop-w1')); });
    await waitFor(() => expect(requests.some((request) => request.route === '/api/dashboard/playback/stop')).toBe(true));

    // The listener trend is Pro, and it says what Pro brings.
    expect(screen.getByTestId('guild-trend-locked').textContent).toMatch(/(ab Pro|comes with Pro)[\s\S]*(Rollenrechte|Role permissions)/);
  });

  it('opens events with a note, locks roles and statistics, and has language, voice guard and favourites', async () => {
    render(<I18nProvider><GuildDashboard /></I18nProvider>);
    await screen.findByTestId('guild-nav-events');
    await open('events');
    expect(screen.getByTestId('guild-events-free-note').textContent).toMatch(/1 geplantes Event|1 scheduled event/);
    await open('roles');
    expect(screen.getByTestId('guild-roles-locked')).toBeTruthy();
    await open('stats');
    expect(screen.getByTestId('guild-stats-locked')).toBeTruthy();
    await open('settings');
    const language = await screen.findByTestId('settings-language-select');
    expect(language.value).toBe('auto');
    expect(screen.getByTestId('settings-voice-status').textContent).toContain('PRO');
    expect(screen.getByTestId('voice-status-template-input').disabled).toBe(true);

    fireEvent.change(language, { target: { value: 'de' } });
    const save = screen.getByTestId('settings-save-btn');
    await act(async () => { fireEvent.click(save); });
    const put = requests.find((request) => request.route === '/api/dashboard/settings' && request.method === 'PUT');
    expect(put.body.serverLanguage).toBe('de');
    expect(put.body.voiceStatus).toBeUndefined();
  });
});
