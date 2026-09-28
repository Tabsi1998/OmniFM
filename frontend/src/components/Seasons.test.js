import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { loadLanguage, translatorFor } from '../i18n/languages.js';
import SettingsSeasons from './settings/SettingsSeasons.js';
import SettingsTimeZone from './settings/SettingsTimeZone.js';
import OwnerConfig from './OwnerConfig.js';

// The seasonal decoration (#425): the dashboard card of every plan and the
// owner's main switches and test mode.

const ALL_ON = {
  seasons: { easter: true, advent: true, christmas: true, newyear: true },
  parts: { panel: true, voiceStatus: true, adventCalendar: true, eggHunt: true, countdown: true, newYearGreeting: true, seasonStations: true },
  ownerEnabled: { easter: true, advent: true, christmas: true, newyear: true },
  current: null,
};

beforeAll(() => loadLanguage('fr'));

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('dashboard: seasonal decoration', () => {
  it('says what shows now, greys out what the operator switched off and switches a part', () => {
    const setSeasonDecor = vi.fn();
    const seasonDecor = { ...ALL_ON, ownerEnabled: { ...ALL_ON.ownerEnabled, easter: false }, current: { season: 'advent', phase: 'candles', candles: 2 } };
    render(<SettingsSeasons seasonDecor={seasonDecor} setSeasonDecor={setSeasonDecor} t={translatorFor('de')} timeZone="Europe/Vienna" />);

    expect(screen.getByTestId('settings-seasons-now').textContent).toBe('Gerade: Advent, 2. Kerze');
    const easter = screen.getByTestId('settings-season-easter');
    expect(easter.querySelector('input').disabled).toBe(true);
    expect(easter.textContent).toContain('Vom Betreiber gerade für alle Server abgeschaltet.');

    fireEvent.click(screen.getByTestId('settings-season-part-eggHunt').querySelector('input'));
    expect(setSeasonDecor).toHaveBeenCalledWith({ seasons: ALL_ON.seasons, parts: { ...ALL_ON.parts, eggHunt: false } });
  });

  it('out of season it names the next one, in the page language', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2026-09-28T12:00:00Z'));
    const formatDate = (value, options) => new Intl.DateTimeFormat('fr-FR', options).format(new Date(value));
    render(<SettingsSeasons seasonDecor={ALL_ON} setSeasonDecor={() => {}} t={translatorFor('fr')} timeZone="Europe/Vienna" formatDate={formatDate} />);
    expect(screen.getByTestId('settings-seasons-now').textContent).toBe('Pas de saison en ce moment. Prochaine : Avent à partir du 29 novembre 2026.');
  });

  it('the time zone offers the events’ zones and keeps an unusual one', () => {
    const setServerTimeZone = vi.fn();
    render(<SettingsTimeZone serverTimeZone={{ current: 'Pacific/Auckland', default: 'Europe/Vienna' }} setServerTimeZone={setServerTimeZone} t={translatorFor('de')} />);
    const select = screen.getByTestId('settings-time-zone-select');
    expect(select.value).toBe('Pacific/Auckland');
    expect([...select.options].map((option) => option.value)).toContain('Europe/Vienna');
    fireEvent.change(select, { target: { value: 'Europe/Berlin' } });
    expect(setServerTimeZone).toHaveBeenCalledWith('Europe/Berlin');
  });
});

describe('owner console: seasonal decoration', () => {
  it('saves the main switches and only valid test servers', async () => {
    const apiGet = vi.fn(async () => ({ company: {}, plans: {}, discord: {}, marketing: {}, system: {}, access: { accounts: [], tokenEnabled: true } }));
    const apiSend = vi.fn(async () => ({ ok: true }));
    render(<OwnerConfig section="seasons" apiGet={apiGet} apiSend={apiSend} token="t" />);
    await screen.findByTestId('config-seasons');

    // FastAPI sends no seasons section yet: everything on, no test.
    expect(screen.getByTestId('cfg-season-preview').value).toBe('');
    fireEvent.click(screen.getByTestId('cfg-season-advent'));
    fireEvent.change(screen.getByTestId('cfg-season-preview'), { target: { value: 'advent-2' } });
    fireEvent.change(screen.getByTestId('cfg-season-guilds'), { target: { value: '123456789012345678\nnope\n\n123456789012345678' } });
    expect(screen.getByTestId('cfg-seasons-save-dirty')).toBeTruthy();
    await act(async () => { fireEvent.click(screen.getByTestId('cfg-seasons-save')); });

    expect(apiSend).toHaveBeenCalledWith('/api/admin/config', 'PUT', {
      section: 'seasons',
      data: {
        enabled: { easter: true, advent: false, christmas: true, newyear: true },
        test: { preview: 'advent-2', guildIds: ['123456789012345678'] },
      },
    });
  });
});
