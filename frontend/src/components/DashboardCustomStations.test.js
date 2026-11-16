import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import DashboardCustomStations from './DashboardCustomStations.js';

// The server's own stations in the dashboard (#541): a broken stream URL is
// fixed in place, the key (and with it logo, folder, tags and events) stays.

const GUILD = '123456789012345678';
const t = (german, _english, params = {}) => german.replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? ''));
const NIGHTWAVE = { key: 'nightwave-abc', name: 'Nightwave FM', url: 'https://old.example/live', genre: 'Synthwave', folder: 'Night', tags: ['night'], logoUrl: 'https://omnifm.test/api/station-logos/1/nightwave-abc.png?v=5', custom: true };

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(apiRequest, stations = [NIGHTWAVE]) {
  const messages = [];
  let current = stations;
  function Host() {
    const [list, setList] = useState(stations);
    current = list;
    return <DashboardCustomStations t={t} guildId={GUILD} stations={list} apiRequest={apiRequest} onStationsChange={(change) => setList((value) => change(value))} setMsg={(msg) => messages.push(msg)} />;
  }
  render(<Host />);
  return { messages, list: () => current };
}

const nameInput = () => screen.getByLabelText('Name');
const urlInput = () => screen.getByLabelText('Stream-URL');

describe('own stations', () => {
  it('edits a station in place: same key, new URL, the logo and the rest kept', async () => {
    const apiRequest = vi.fn(async (_path, options) => ({ success: true, station: { ...NIGHTWAVE, ...JSON.parse(options.body) } }));
    const view = show(apiRequest);
    fireEvent.click(screen.getByTestId('guild-custom-edit-nightwave-abc'));
    expect(screen.getByTestId('guild-custom-editing').textContent).toContain('Sender bearbeiten');
    expect(nameInput().value).toBe('Nightwave FM');
    expect(urlInput().value).toBe('https://old.example/live');
    expect(screen.getByTestId('guild-custom-save').disabled).toBe(true);

    fireEvent.change(urlInput(), { target: { value: '  https://new.example/stream.mp3 ' } });
    await act(async () => { fireEvent.click(screen.getByTestId('guild-custom-save')); });

    expect(apiRequest).toHaveBeenCalledTimes(1);
    const [path, options] = apiRequest.mock.calls[0];
    expect(path).toBe(`/api/dashboard/custom-stations?serverId=${GUILD}`);
    expect(options.method).toBe('PUT');
    expect(JSON.parse(options.body)).toEqual({ key: 'nightwave-abc', name: 'Nightwave FM', url: 'https://new.example/stream.mp3' });
    expect(view.list()).toHaveLength(1);
    expect(view.list()[0]).toMatchObject({ key: 'nightwave-abc', url: 'https://new.example/stream.mp3', logoUrl: NIGHTWAVE.logoUrl, folder: 'Night' });
    expect(view.messages.at(-1)).toEqual({ ok: true, text: 'Sender wurde aktualisiert.' });
    // Back to adding a new one.
    expect(screen.queryByTestId('guild-custom-editing')).toBeNull();
    expect(nameInput().value).toBe('');
  });

  it('keeps what was typed when the server refuses, so it can be fixed', async () => {
    const apiRequest = vi.fn(async () => { throw Object.assign(new Error('Lokale/private Hosts sind nicht erlaubt.'), { status: 400 }); });
    const view = show(apiRequest);
    fireEvent.click(screen.getByTestId('guild-custom-edit-nightwave-abc'));
    fireEvent.change(urlInput(), { target: { value: 'http://127.0.0.1/stream' } });
    await act(async () => { fireEvent.click(screen.getByTestId('guild-custom-save')); });

    expect(view.messages.at(-1)).toEqual({ ok: false, text: 'Lokale/private Hosts sind nicht erlaubt.' });
    expect(urlInput().value).toBe('http://127.0.0.1/stream');
    expect(screen.getByTestId('guild-custom-editing')).toBeTruthy();
    expect(view.list()[0].url).toBe('https://old.example/live');
  });

  it('cancels without asking the server and checks the fields first', async () => {
    const apiRequest = vi.fn();
    const view = show(apiRequest);
    fireEvent.click(screen.getByTestId('guild-custom-edit-nightwave-abc'));
    fireEvent.change(nameInput(), { target: { value: '   ' } });
    await act(async () => { fireEvent.click(screen.getByTestId('guild-custom-save')); });
    expect(view.messages.at(-1)).toEqual({ ok: false, text: 'Name und URL sind erforderlich.' });

    fireEvent.click(screen.getByTestId('guild-custom-cancel'));
    expect(screen.queryByTestId('guild-custom-editing')).toBeNull();
    expect(nameInput().value).toBe('');
    expect(urlInput().value).toBe('');
    expect(apiRequest).not.toHaveBeenCalled();
  });

  it('adds a new station with POST and leaves edit mode when the edited one is removed', async () => {
    const apiRequest = vi.fn(async (_path, options) => (options.method === 'POST'
      ? { success: true, station: { ...JSON.parse(options.body), custom: true } }
      : { success: true }));
    const view = show(apiRequest);
    fireEvent.change(nameInput(), { target: { value: 'Ärger Radio' } });
    fireEvent.change(urlInput(), { target: { value: 'https://radio.example/live' } });
    await act(async () => { fireEvent.click(screen.getByTestId('guild-custom-save')); });
    expect(apiRequest.mock.calls[0][1].method).toBe('POST');
    expect(JSON.parse(apiRequest.mock.calls[0][1].body).key).toMatch(/^arger-radio-[a-z0-9]+$/);
    expect(view.list()).toHaveLength(2);

    fireEvent.click(screen.getByTestId('guild-custom-edit-nightwave-abc'));
    await act(async () => { fireEvent.click(screen.getByTestId('guild-custom-remove-nightwave-abc')); });
    expect(apiRequest.mock.calls.at(-1)[0]).toBe(`/api/dashboard/custom-stations?serverId=${GUILD}&key=nightwave-abc`);
    expect(screen.queryByTestId('guild-custom-editing')).toBeNull();
    expect(view.list().map((station) => station.key)).not.toContain('nightwave-abc');
  });
});
