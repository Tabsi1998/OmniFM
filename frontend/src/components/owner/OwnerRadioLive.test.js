import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import OwnerRadioLive from './OwnerRadioLive.js';
import { radioShowDuration, radioDetectionText } from '../../lib/ownerRadio.js';

// OmniFM Radio in the cockpit (#592): is DJ Tabsi live, the last shows, and a
// test show that runs start and end without sending anything.

let consoleErrors = [];

beforeEach(() => {
  consoleErrors = [];
  vi.spyOn(console, 'error').mockImplementation((...args) => { consoleErrors.push(args.map(String).join(' ')); });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const OFFLINE = {
  enabled: true,
  station: 'omnifm_radio',
  webhook: true,
  canTest: true,
  pollMs: 30000,
  graceMs: 60000,
  current: { isLive: false, streamerName: 'DJ Tabsi', title: 'Abendshow', startedAt: '2026-11-25T19:00:00.000Z', endedAt: '2026-11-25T20:12:00.000Z', source: 'webhook', offlineSince: null },
  shows: [{ streamerName: 'DJ Tabsi', title: 'Abendshow', startedAt: '2026-11-25T19:00:00.000Z', endedAt: '2026-11-25T20:12:00.000Z', durationMs: 72 * 60000, source: 'webhook' }],
  observedAt: '2026-11-25T20:30:00.000Z',
  observedBy: 'poll',
};
const TEST_LIVE = { ...OFFLINE, current: { isLive: true, streamerName: 'Test-DJ', title: 'Test-Sendung', startedAt: '2026-11-25T20:31:00.000Z', endedAt: null, source: 'test', offlineSince: null } };

function setup(data, next = data) {
  const apiGet = vi.fn(async () => data);
  const apiSend = vi.fn(async () => next);
  render(<OwnerRadioLive apiGet={apiGet} apiSend={apiSend} />);
  return { apiGet, apiSend };
}

describe('OmniFM Radio in the owner cockpit', () => {
  it('shows the state, how it is detected and the last shows', async () => {
    const { apiGet } = setup(OFFLINE);
    expect(await screen.findByTestId('radio-live')).toBeTruthy();
    expect(apiGet).toHaveBeenCalledWith('/api/owner/radio');
    expect(screen.getByTestId('radio-live-state').textContent).toContain('Nicht live');
    expect(screen.getByTestId('radio-live-detection').textContent).toContain('Webhook an');
    expect(screen.getByTestId('radio-live-shows').textContent).toContain('DJ Tabsi – Abendshow');
    expect(screen.getByTestId('radio-live-shows').textContent).toContain('1 h 12 min');
  });

  it('starts a test show and offers to end it', async () => {
    const { apiSend } = setup(OFFLINE, TEST_LIVE);
    await screen.findByTestId('radio-live');
    await act(async () => { fireEvent.click(screen.getByTestId('radio-live-test')); });
    expect(apiSend).toHaveBeenCalledWith('/api/owner/radio/test-show', 'POST', { action: 'start' });
    expect(screen.getByTestId('radio-live-state').textContent).toContain('Test-DJ');
    expect(screen.getByTestId('radio-live-test').textContent).toContain('beenden');
    await act(async () => { fireEvent.click(screen.getByTestId('radio-live-test')); });
    expect(apiSend).toHaveBeenLastCalledWith('/api/owner/radio/test-show', 'POST', { action: 'end' });
  });

  it('a real show cannot be ended or overrun by the test button', async () => {
    setup({ ...OFFLINE, current: { ...TEST_LIVE.current, source: 'webhook', streamerName: 'DJ Tabsi' } });
    await screen.findByTestId('radio-live');
    expect(screen.getByTestId('radio-live-state').textContent).toContain('Live: DJ Tabsi');
    expect(screen.getByTestId('radio-live-test').disabled).toBe(true);
  });

  it('shows the test button only to the owner role', async () => {
    setup({ ...OFFLINE, canTest: false });
    await screen.findByTestId('radio-live');
    expect(screen.queryByTestId('radio-live-test')).toBeNull();
  });

  it('says why the webhook is off when the secret is too short', async () => {
    setup({ ...OFFLINE, webhook: false, webhookSecretTooShort: true });
    expect((await screen.findByTestId('radio-live-detection')).textContent).toContain('Geheimnis zu kurz (mind. 16 Zeichen)');
  });

  it('announces errors and keeps two shows with the same start apart', async () => {
    const twin = OFFLINE.shows[0];
    const apiGet = vi.fn(async () => ({ ...OFFLINE, shows: [twin, { ...twin }] }));
    const apiSend = vi.fn(async () => { throw new Error('Gerade läuft eine echte Sendung.'); });
    render(<OwnerRadioLive apiGet={apiGet} apiSend={apiSend} />);
    await screen.findByTestId('radio-live');
    await act(async () => { fireEvent.click(screen.getByTestId('radio-live-test')); });
    expect(screen.getByRole('alert').textContent).toContain('echte Sendung');
    expect(consoleErrors.some((line) => line.includes('same key'))).toBe(false);
  });

  it('says when the stored state cannot be read', async () => {
    setup({ ...OFFLINE, readable: false });
    expect((await screen.findByTestId('radio-live-state')).textContent).toContain('Zustand nicht lesbar (Datenbank)');
  });

  it('says so when the live detection does not run', async () => {
    setup({});
    expect((await screen.findByTestId('radio-live-state')).textContent).toContain('läuft nicht');
    expect(screen.queryByTestId('radio-live-test')).toBeNull();
  });

  it('reads durations and the detection in words', () => {
    expect(radioShowDuration(72 * 60000)).toBe('1 h 12 min');
    expect(radioShowDuration(20000)).toBe('unter 1 min');
    expect(radioDetectionText({ webhook: false, pollMs: 30000, graceMs: 60000 })).toBe('Webhook aus: nur die Abfrage alle 30 s · kurze Aussetzer bis 60 s zählen nicht');
  });
});
