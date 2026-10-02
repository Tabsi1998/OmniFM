import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import ActivityApp, { insideDiscord } from './ActivityApp.js';

// The OmniFM Activity (#308): outside Discord a hint; inside, the SDK signs
// in, the server exchanges the code, and the page shows what plays in the
// voice channel and who listens.

const GUILD = '300000000000000001';
const CHANNEL = '400000000000000001';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  window.history.replaceState({}, '', '/');
});

function fakeSdk(calls) {
  class DiscordSDK {
    constructor(clientId) {
      calls.push(['new', clientId]);
      this.guildId = GUILD;
      this.channelId = CHANNEL;
      this.commands = {
        authorize: async (options) => { calls.push(['authorize', options]); return { code: 'code-1' }; },
        authenticate: async (options) => { calls.push(['authenticate', options]); return { user: { id: 'u' } }; },
      };
    }

    async ready() {
      calls.push(['ready']);
    }
  }
  return async () => ({ DiscordSDK });
}

function answer(status, body) {
  return { ok: status < 400, status, json: async () => body };
}

describe('the Activity', () => {
  it('knows Discord by the parameters it starts an Activity with', () => {
    expect(insideDiscord('?frame_id=f&instance_id=i&platform=desktop')).toBe(true);
    expect(insideDiscord('?frame_id=f')).toBe(false);
    expect(insideDiscord('')).toBe(false);
  });

  it('outside Discord: says where it runs and loads nothing', async () => {
    const loadSdk = vi.fn();
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await act(async () => { render(<ActivityApp loadSdk={loadSdk} />); });
    expect(screen.getByTestId('activity-outside').textContent).toMatch(/Activity/);
    expect(loadSdk).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('inside Discord: signs in through the SDK and shows the station, the song and who listens', async () => {
    window.history.replaceState({}, '', `/activity/?frame_id=f&instance_id=i&guild_id=${GUILD}&channel_id=${CHANNEL}`);
    const calls = [];
    const requests = [];
    vi.stubGlobal('fetch', vi.fn(async (url, options = {}) => {
      requests.push([url, options]);
      if (url === '/api/activity/config') return answer(200, { clientId: '100000000000000001' });
      if (url === '/api/activity/token') return answer(200, { access_token: 'access-1', session: 'session-1', expiresIn: 3600 });
      if (url.startsWith('/api/activity/now')) {
        return answer(200, {
          guildName: 'Lofi Lounge',
          channelName: 'Radio',
          refreshMs: 60_000,
          streams: [{ botName: 'OmniFM 1', stationKey: 'groovesalad', stationName: 'Groove Salad', song: 'Air - La Femme d’Argent', logoUrl: '/station-logo.png', recovering: false }],
          listeners: [{ id: '1', name: 'Ada', avatarUrl: null }, { id: '2', name: 'Lin', avatarUrl: 'https://cdn.discordapp.com/a.png' }],
        });
      }
      return answer(404, {});
    }));
    await act(async () => { render(<ActivityApp loadSdk={fakeSdk(calls)} />); });
    await waitFor(() => expect(screen.getByTestId('activity-song').textContent).toBe('Air - La Femme d’Argent'));

    expect(calls[0]).toEqual(['new', '100000000000000001']);
    expect(calls.find((call) => call[0] === 'authorize')[1]).toEqual({ client_id: '100000000000000001', response_type: 'code', state: '', prompt: 'none', scope: ['identify'] });
    expect(calls.find((call) => call[0] === 'authenticate')[1]).toEqual({ access_token: 'access-1' });
    const token = requests.find(([url]) => url === '/api/activity/token');
    expect(JSON.parse(token[1].body)).toEqual({ code: 'code-1' });
    const now = requests.find(([url]) => url.startsWith('/api/activity/now'));
    expect(now[0]).toBe(`/api/activity/now?guildId=${GUILD}&channelId=${CHANNEL}`);
    expect(now[1].headers.Authorization).toBe('Bearer session-1');
    expect(screen.getByText('Groove Salad')).toBeTruthy();
    expect(screen.getAllByTestId('activity-listener')).toHaveLength(2);
    expect(screen.getByTestId('activity-page').textContent).toContain('Radio');
  });

  it('keeps asking every few seconds, and signs in again when the session ran out', async () => {
    window.history.replaceState({}, '', '/activity/?frame_id=f&instance_id=i');
    const calls = [];
    let asked = 0;
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/activity/config') return answer(200, { clientId: '100000000000000001' });
      if (url === '/api/activity/token') return answer(200, { access_token: 'a', session: 's' });
      asked += 1;
      if (asked === 3) return answer(401, { error: 'no_session' });
      return answer(200, { channelName: 'Radio', refreshMs: 20, streams: [], listeners: [] });
    }));
    await act(async () => { render(<ActivityApp loadSdk={fakeSdk(calls)} />); });
    await waitFor(() => expect(asked).toBeGreaterThanOrEqual(5), { timeout: 3000 });
    expect(calls.filter((call) => call[0] === 'authorize')).toHaveLength(2);
    expect(screen.getByTestId('activity-silent')).toBeTruthy();
  });

  it('says plainly when the person is not in the channel', async () => {
    window.history.replaceState({}, '', '/activity/?frame_id=f&instance_id=i');
    vi.stubGlobal('fetch', vi.fn(async (url) => {
      if (url === '/api/activity/config') return answer(200, { clientId: '100000000000000001' });
      if (url === '/api/activity/token') return answer(200, { access_token: 'a', session: 's' });
      return answer(403, { error: 'not_in_channel' });
    }));
    await act(async () => { render(<ActivityApp loadSdk={fakeSdk([])} />); });
    await waitFor(() => expect(screen.getByTestId('activity-problem').textContent).toMatch(/Sprachkanal|voice channel/));
  });

  it('when OmniFM is not set up for it, it says so instead of hanging', async () => {
    window.history.replaceState({}, '', '/activity/?frame_id=f&instance_id=i');
    vi.stubGlobal('fetch', vi.fn(async () => answer(503, { error: 'not_configured' })));
    const loadSdk = vi.fn();
    await act(async () => { render(<ActivityApp loadSdk={loadSdk} />); });
    await waitFor(() => expect(screen.getByTestId('activity-problem').textContent).toMatch(/eingerichtet|set up/));
    expect(loadSdk).not.toHaveBeenCalled();
  });
});
