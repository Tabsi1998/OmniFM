import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import DashboardSettings from '../DashboardSettings.js';
import { translatorFor } from '../../i18n/languages.js';

// OmniFM Radio (#593): where a server's live announcement goes, which role it
// mentions, or off. Shown only where the server sees OmniFM Radio.

const SERVER = '123456789012345678';
const SYSTEM = '223456789012345678';
const NEWS = '323456789012345678';
const ROLE = '423456789012345678';
const t = translatorFor('de');

function api({ radio }) {
  const requests = [];
  const apiRequest = async (url, options = {}) => {
    const route = String(url).split('?')[0];
    requests.push({ route, method: options.method || 'GET', body: options.body ? JSON.parse(options.body) : null });
    if (route === '/api/dashboard/settings') return { omnifmRadioAnnounce: radio };
    if (route === '/api/dashboard/channels') return { textChannels: [{ id: SYSTEM, name: 'allgemein' }, { id: NEWS, name: 'radio-news' }], voiceChannels: [] };
    if (route === '/api/dashboard/stations') return { free: [], pro: [], ultimate: [], custom: [] };
    return {};
  };
  return { apiRequest, requests };
}

const RADIO = {
  available: true,
  enabled: true,
  channelId: '',
  roleId: '',
  systemChannel: { id: SYSTEM, name: 'allgemein' },
  roles: [{ id: ROLE, name: 'Radio-Fans', color: '#ff2a5f', mentionable: false }],
};

async function renderSettings(radio) {
  const { apiRequest, requests } = api({ radio });
  await act(async () => {
    render(<DashboardSettings apiRequest={apiRequest} selectedGuildId={SERVER} t={t} />);
  });
  return requests;
}

afterEach(() => cleanup());

describe('the radio announcement card', () => {
  it('defaults to the system channel and saves channel, role and the switch', async () => {
    const requests = await renderSettings(RADIO);
    const channel = await screen.findByTestId('radio-announce-channel');
    expect(channel.value).toBe('');
    expect(channel.options[0].textContent).toBe('Systemkanal (#allgemein)');
    const role = screen.getByTestId('radio-announce-role');
    expect([...role.options].map((option) => option.textContent)).toEqual(['Keine Rolle', '@Radio-Fans']);

    fireEvent.change(channel, { target: { value: NEWS } });
    fireEvent.change(role, { target: { value: ROLE } });
    expect(screen.getByTestId('radio-announce-card').textContent).toMatch(/nicht erwähnbar/);
    await act(async () => { fireEvent.click(screen.getByTestId('settings-save-btn')); });
    let put = requests.findLast((request) => request.method === 'PUT');
    expect(put.body.omnifmRadioAnnounce).toEqual({ enabled: true, channelId: NEWS, roleId: ROLE });

    fireEvent.click(screen.getByTestId('radio-announce-enabled'));
    expect(screen.getByTestId('radio-announce-channel').disabled).toBe(true);
    await act(async () => { fireEvent.click(screen.getByTestId('settings-save-btn')); });
    put = requests.findLast((request) => request.method === 'PUT');
    expect(put.body.omnifmRadioAnnounce.enabled).toBe(false);
  });

  it('warns when the server has no system channel and none is chosen', async () => {
    await renderSettings({ ...RADIO, systemChannel: null });
    const channel = await screen.findByTestId('radio-announce-channel');
    expect(channel.options[0].textContent).toBe('Systemkanal (nicht gesetzt)');
    expect(screen.getByTestId('radio-announce-warning').textContent).toMatch(/keinen Systemkanal/);
  });

  it('shows a channel or role that was deleted in Discord instead of pretending the default', async () => {
    const requests = await renderSettings({ ...RADIO, channelId: '999999999999999999', roleId: '888888888888888888' });
    const channel = await screen.findByTestId('radio-announce-channel');
    expect(channel.value).toBe('999999999999999999');
    expect(channel.selectedOptions[0].textContent).toBe('Gewählter Kanal (nicht gefunden)');
    expect(screen.getByTestId('radio-announce-role').selectedOptions[0].textContent).toBe('Gewählte Rolle (nicht gefunden)');
    expect(screen.getByTestId('radio-announce-warning').textContent).toMatch(/gibt es nicht mehr/);
    await act(async () => { fireEvent.click(screen.getByTestId('settings-save-btn')); });
    expect(requests.findLast((request) => request.method === 'PUT').body.omnifmRadioAnnounce.channelId).toBe('999999999999999999');
  });

  it('stays away where the server does not see OmniFM Radio', async () => {
    const requests = await renderSettings({ available: false });
    await screen.findByTestId('settings-save-btn');
    expect(screen.queryByTestId('radio-announce-card')).toBeNull();
    await act(async () => { fireEvent.click(screen.getByTestId('settings-save-btn')); });
    expect(requests.findLast((request) => request.method === 'PUT').body.omnifmRadioAnnounce).toBeUndefined();
  });
});
