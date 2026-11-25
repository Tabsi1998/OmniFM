import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import OwnerRadioDm from './OwnerRadioDm.js';
import { radioDmRunText, radioDmSourceLabel } from '../../lib/ownerRadioDm.js';

// OmniFM Radio DMs to server owners (#594) in the cockpit: the mode with
// the kill switch, where the mode comes from and how the last run went.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const LAST_RUN = {
  show: { streamerName: 'DJ Tabsi', title: 'Abendshow', startedAt: '2026-11-25T20:00:00.000Z', source: 'webhook' },
  test: false,
  mode: 'owners',
  startedAt: '2026-11-25T20:00:05.000Z',
  finishedAt: '2026-11-25T20:01:00.000Z',
  total: 6,
  sent: 3,
  skipped: 1,
  failed: 0,
  remaining: 2,
  stoppedBy: 'end',
};
const STATUS = { enabled: true, canChange: true, mode: 'owners', modeSource: 'default', modeError: null, running: false, lastRun: LAST_RUN };

function setup(data = STATUS, next = data) {
  const apiGet = vi.fn(async () => data);
  const apiSend = vi.fn(async () => next);
  render(<OwnerRadioDm apiGet={apiGet} apiSend={apiSend} />);
  return { apiGet, apiSend };
}

describe('OmniFM Radio DMs in the owner cockpit', () => {
  it('shows the mode, where it comes from and the last run', async () => {
    const { apiGet } = setup();
    expect(await screen.findByTestId('radio-dm')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/owner/radio/dm');
    expect(screen.getByTestId('radio-dm-mode-owners').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('radio-dm-mode-off').getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByTestId('radio-dm-source').textContent).toContain('Standard');
    const run = screen.getByTestId('radio-dm-last-run').textContent;
    expect(run).toContain('3 gesendet');
    expect(run).toContain('1 übersprungen');
    expect(run).toContain('2 offen');
    expect(run).toContain('Sendung zu Ende');
  });

  it('the kill switch stops the DMs with one click', async () => {
    const { apiSend } = setup(STATUS, { ...STATUS, mode: 'off', modeSource: 'console' });
    await screen.findByTestId('radio-dm');
    await act(async () => { fireEvent.click(screen.getByTestId('radio-dm-mode-off')); });
    expect(apiSend).toHaveBeenCalledWith('/api/owner/radio/dm', 'POST', { mode: 'off' });
    expect(screen.getByTestId('radio-dm-mode-off').getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByTestId('radio-dm-source').textContent).toContain('Owner-Konsole');
  });

  it('other roles see the mode but cannot switch it', async () => {
    setup({ ...STATUS, canChange: false });
    await screen.findByTestId('radio-dm');
    expect(screen.queryByTestId('radio-dm-mode-off')).toBeNull();
    expect(screen.getByTestId('radio-dm-mode').textContent).toContain('An alle Server-Besitzer');
  });

  it('says when the mode cannot be read, and when the DMs do not run', async () => {
    setup({ ...STATUS, mode: null, modeSource: null, modeError: 'MongoDB ist nicht verbunden.' });
    expect((await screen.findByTestId('radio-dm-mode-error')).textContent).toContain('keine DMs');
    cleanup();
    setup({ enabled: false, canChange: true, mode: null, lastRun: null });
    expect((await screen.findByTestId('radio-dm')).textContent).toContain('laufen nicht');
    expect(screen.queryByTestId('radio-dm-mode-off')).toBeNull();
  });

  it('announces a failed switch', async () => {
    const apiGet = vi.fn(async () => STATUS);
    const apiSend = vi.fn(async () => { throw new Error('Nicht gespeichert, die Datenbank antwortet nicht.'); });
    render(<OwnerRadioDm apiGet={apiGet} apiSend={apiSend} />);
    await screen.findByTestId('radio-dm');
    await act(async () => { fireEvent.click(screen.getByTestId('radio-dm-mode-off')); });
    expect(screen.getByRole('alert').textContent).toContain('Nicht gespeichert');
  });

  it('reads a run in words', () => {
    expect(radioDmRunText(null)).toBe('Noch keine Verteilung.');
    expect(radioDmRunText({ ...LAST_RUN, test: true, stoppedBy: null, remaining: 0 })).toMatch(/^Test · .*3 gesendet · 1 übersprungen · 0 fehlgeschlagen$/);
    expect(radioDmRunText({ ...LAST_RUN, stoppedBy: 'off' })).toContain('Not-Aus');
    const failed = radioDmRunText({ ...LAST_RUN, stoppedBy: 'error', error: 'Unknown claim error' });
    expect(failed).toContain('gestoppt: Fehler (Unknown claim error)');
    expect(failed).not.toContain('Datenbank');
    expect(radioDmRunText({ ...LAST_RUN, stoppedBy: 'discord' })).toContain('Discord bremst, DMs ausgeschaltet');
    expect(radioDmRunText({ ...LAST_RUN, stoppedBy: 'failures' })).toContain('5 Fehler in Folge, DMs ausgeschaltet');
    expect(radioDmRunText({ ...LAST_RUN, stoppedBy: 'config', error: 'Invalid URL' })).toContain('Einstellung fehlerhaft (Invalid URL)');
    expect(radioDmSourceLabel('memory')).toContain('nur im Speicher');
  });
});
