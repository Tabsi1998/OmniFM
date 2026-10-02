import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import DashboardJingle from './DashboardJingle.js';

// The server's jingle in the dashboard (#309, Ultimate): upload, listen in,
// play it in the voice channel, the two switches; smaller plans see the lock.

const GUILD = '123456789012345678';
const t = (german, _english, params = {}) => german.replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? ''));
const JINGLE = { name: 'Station ID.mp3', durationMs: 2500, bytes: 480000, updatedAt: Date.parse('2026-10-02T10:00:00Z') };
const answer = (extra = {}) => ({
  serverId: GUILD,
  available: true,
  limits: { maxMs: 10000, fileBytes: 6 * 1024 * 1024 },
  jingle: null,
  settings: { onSwitch: true, onHour: false },
  ...extra,
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

async function show(apiRequest) {
  await act(async () => {
    render(<DashboardJingle apiRequest={apiRequest} selectedGuildId={GUILD} t={t} />);
  });
}

describe('the jingle card', () => {
  it('shows the lock on a smaller plan, without upload or switches', async () => {
    await show(vi.fn(async () => answer({ available: false })));
    const card = screen.getByTestId('settings-jingle');
    expect(card.textContent).toContain('ULTIMATE');
    expect(card.textContent).toContain('Das gibt es mit Ultimate');
    expect(screen.queryByTestId('jingle-file')).toBeNull();
    expect(screen.queryByTestId('jingle-on-hour')).toBeNull();
  });

  it('sends the chosen file as a data URL and shows what is stored, to listen in', async () => {
    const apiRequest = vi.fn()
      .mockResolvedValueOnce(answer())
      .mockResolvedValueOnce(answer({ jingle: JINGLE }));
    await show(apiRequest);
    expect(screen.getByTestId('jingle-upload').disabled).toBe(true);
    const file = new File([new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3])], 'Station ID.mp3', { type: 'audio/mpeg' });
    fireEvent.change(screen.getByTestId('jingle-file'), { target: { files: [file] } });
    fireEvent.click(screen.getByTestId('jingle-upload'));
    await waitFor(() => expect(screen.getByTestId('jingle-note').textContent).toBe('Jingle gespeichert.'));

    const [path, options] = apiRequest.mock.calls[1];
    expect(path).toBe(`/api/dashboard/jingle?serverId=${GUILD}`);
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ name: 'Station ID.mp3', data: 'data:audio/mpeg;base64,SUQzAQID' });
    expect(screen.getByTestId('jingle-current').textContent).toContain('Station ID.mp3');
    const audio = screen.getByTestId('settings-jingle').querySelector('audio');
    expect(audio.getAttribute('src')).toContain(`/api/dashboard/jingle/audio?serverId=${GUILD}&v=${JINGLE.updatedAt}`);
    expect(audio.getAttribute('preload')).toBe('none');
  });

  it('refuses a file over 6 MB before sending anything', async () => {
    const apiRequest = vi.fn(async () => answer());
    await show(apiRequest);
    const file = new File([new Uint8Array(4)], 'long.wav', { type: 'audio/wav' });
    Object.defineProperty(file, 'size', { value: 7 * 1024 * 1024 });
    fireEvent.change(screen.getByTestId('jingle-file'), { target: { files: [file] } });
    await act(async () => { fireEvent.click(screen.getByTestId('jingle-upload')); });
    expect(screen.getByTestId('jingle-note').textContent).toBe('Die Datei ist zu groß (höchstens 6 MB).');
    expect(apiRequest).toHaveBeenCalledTimes(1);
  });

  it('saves each switch on its own, plays the jingle in Discord and deletes it', async () => {
    const apiRequest = vi.fn(async (path, options = {}) => {
      if (path.startsWith('/api/dashboard/jingle/settings')) return answer({ jingle: JINGLE, settings: { onSwitch: true, onHour: true } });
      if (path.startsWith('/api/dashboard/jingle/play')) return { ok: true, played: 1 };
      if (options.method === 'DELETE') return answer();
      return answer({ jingle: JINGLE });
    });
    await show(apiRequest);
    expect(screen.getByTestId('jingle-on-switch').checked).toBe(true);
    expect(screen.getByTestId('jingle-on-hour').checked).toBe(false);

    await act(async () => { fireEvent.click(screen.getByTestId('jingle-on-hour')); });
    expect(apiRequest).toHaveBeenCalledWith(`/api/dashboard/jingle/settings?serverId=${GUILD}`, { method: 'PUT', body: JSON.stringify({ onHour: true }) });
    expect(screen.getByTestId('jingle-on-hour').checked).toBe(true);

    await act(async () => { fireEvent.click(screen.getByTestId('jingle-play')); });
    expect(apiRequest).toHaveBeenCalledWith(`/api/dashboard/jingle/play?serverId=${GUILD}`, { method: 'POST', body: '{}' });
    expect(screen.getByTestId('jingle-note').textContent).toBe('Der Jingle läuft jetzt.');

    await act(async () => { fireEvent.click(screen.getByTestId('jingle-delete')); });
    expect(screen.queryByTestId('jingle-current')).toBeNull();
    expect(screen.getByTestId('jingle-note').textContent).toBe('Jingle gelöscht.');
  });

  it('shows what the server or the preview answers', async () => {
    const apiRequest = vi.fn()
      .mockResolvedValueOnce(answer({ jingle: JINGLE }))
      .mockRejectedValueOnce(new Error('In der Vorschau wird nichts gespeichert.'));
    await show(apiRequest);
    await act(async () => { fireEvent.click(screen.getByTestId('jingle-play')); });
    expect(screen.getByTestId('jingle-note').textContent).toBe('In der Vorschau wird nichts gespeichert.');
  });
});
