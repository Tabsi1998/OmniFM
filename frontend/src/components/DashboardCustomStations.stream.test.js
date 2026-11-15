import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import DashboardCustomStations from './DashboardCustomStations.js';
import { describeStreamTest } from './CustomStreamTestResult.js';

// "Stream testen" for a server's own station (#537): the URL in the form is
// tested before it is saved, when adding and when editing, and the answer
// says in words what is wrong and what to do.

const GUILD = '123456789012345678';
const t = (german, _english, params = {}) => german.replace(/\{(\w+)\}/g, (_match, key) => String(params[key] ?? ''));
const NIGHTWAVE = { key: 'nightwave-abc', name: 'Nightwave FM', url: 'https://old.example/live', custom: true };
const TEST_PATH = `/api/dashboard/custom-stations/test?serverId=${GUILD}`;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function show(apiRequest) {
  render(<DashboardCustomStations t={t} guildId={GUILD} stations={[NIGHTWAVE]} apiRequest={apiRequest} onStationsChange={() => {}} setMsg={() => {}} />);
}

const urlInput = () => screen.getByLabelText('Stream-URL');
const testButton = () => screen.getByTestId('guild-custom-test');
const resultText = () => screen.getByTestId('guild-custom-test-result').textContent;

describe('stream test', () => {
  it('tests the typed URL before saving and shows format and bitrate', async () => {
    let finish;
    const apiRequest = vi.fn(() => new Promise((resolve) => { finish = resolve; }));
    show(apiRequest);
    expect(testButton().disabled).toBe(true);
    fireEvent.change(urlInput(), { target: { value: ' https://radio.example/live.mp3 ' } });
    await act(async () => { fireEvent.click(testButton()); });

    expect(apiRequest).toHaveBeenCalledWith(TEST_PATH, { method: 'POST', body: JSON.stringify({ url: 'https://radio.example/live.mp3' }) });
    expect(resultText()).toContain('Stream wird getestet');
    expect(testButton().disabled).toBe(true);
    await act(async () => { finish({ ok: true, result: 'playable', httpStatus: 200, format: 'mp3', bitrateKbps: 128 }); });

    expect(screen.getByTestId('guild-custom-test-playable')).toBeTruthy();
    expect(resultText()).toContain('Der Stream läuft');
    expect(resultText()).toContain('Format MP3, 128 kbit/s.');
    expect(screen.getByTestId('guild-custom-test-result').getAttribute('role')).toBe('status');
  });

  it('tests the edited URL and drops the answer as soon as the URL changes', async () => {
    const apiRequest = vi.fn(async () => ({ ok: false, result: 'not_audio', httpStatus: 200, format: 'html' }));
    show(apiRequest);
    fireEvent.click(screen.getByTestId('guild-custom-edit-nightwave-abc'));
    await act(async () => { fireEvent.click(testButton()); });
    expect(JSON.parse(apiRequest.mock.calls[0][1].body)).toEqual({ url: 'https://old.example/live' });
    expect(resultText()).toContain('Unter der Adresse kommt eine Webseite, kein Audio.');

    fireEvent.change(urlInput(), { target: { value: 'https://old.example/live.mp3' } });
    expect(resultText()).toBe('');
  });

  it('ignores an answer that arrives after the URL was changed', async () => {
    let finish;
    show(vi.fn(() => new Promise((resolve) => { finish = resolve; })));
    fireEvent.change(urlInput(), { target: { value: 'https://one.example/live' } });
    await act(async () => { fireEvent.click(testButton()); });
    fireEvent.change(urlInput(), { target: { value: 'https://two.example/live' } });
    await act(async () => { finish({ ok: true, result: 'playable', format: 'mp3' }); });
    expect(resultText()).toBe('');
  });

  it('says when there were too many tests, and when the test could not run', async () => {
    const apiRequest = vi.fn()
      .mockRejectedValueOnce(Object.assign(new Error('Too many requests. Please try again later.'), { status: 429 }))
      .mockRejectedValueOnce(Object.assign(new Error('Kein Zugriff.'), { status: 403 }));
    show(apiRequest);
    fireEvent.change(urlInput(), { target: { value: 'https://radio.example/live' } });
    await act(async () => { fireEvent.click(testButton()); });
    expect(resultText()).toContain('Zu viele Tests in kurzer Zeit.');
    expect(resultText()).not.toContain('Too many requests');
    await act(async () => { fireEvent.click(testButton()); });
    expect(resultText()).toContain('Der Test konnte nicht laufen.');
    expect(resultText()).toContain('Kein Zugriff.');
  });

  it('has a title and a next step for every result the server sends', () => {
    const results = ['playable', 'invalid_url', 'private_target', 'dns_failed', 'too_many_redirects', 'bad_redirect', 'unauthorized', 'forbidden', 'rate_limited', 'http_error', 'not_audio', 'playlist', 'timeout', 'unreachable'];
    const titles = new Set();
    for (const result of results) {
      const text = describeStreamTest({ answer: { result, httpStatus: result === 'http_error' ? 404 : null, format: null } }, t);
      expect(text.title, result).toBeTruthy();
      if (result !== 'playable') expect(text.hint, result).toBeTruthy();
      titles.add(text.title);
    }
    expect(titles.size).toBe(results.length);
    expect(describeStreamTest({ answer: { result: 'http_error', httpStatus: 503 } }, t)).toMatchObject({ tone: 'wait', title: 'Der Server antwortet mit HTTP 503.' });
    expect(describeStreamTest({ answer: { result: 'playlist', format: 'hls' } }, t).hint).toContain('HLS');
    expect(describeStreamTest({ answer: { result: 'something_new' } }, t).title).toBe('Der Server ist nicht erreichbar.');
  });
});
