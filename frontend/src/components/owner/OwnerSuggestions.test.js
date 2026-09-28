import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import OwnerSuggestions, { suggestionKey } from './OwnerSuggestions.js';

// The owner console's queue of station suggestions (#303).

const PENDING = {
  id: 'a1b2c3d4e5f60718',
  name: 'Radio Café Zürich',
  url: 'https://stream.example.com/cafe.mp3',
  genre: 'Jazz',
  homepage: 'https://cafe.example.com',
  note: 'Läuft bei uns jeden Abend',
  status: 'pending',
  createdAt: '2026-09-28T08:00:00.000Z',
  from: 'Hörerin',
  health: { checks: 4, ok: 3, share: 75 },
  lastCheck: { ok: false, bitrate: null, error: 'HTTP 503' },
};
const DECIDED = { id: 'b1b2c3d4e5f60718', name: 'Talk FM', status: 'rejected', decidedAt: '2026-09-27T08:00:00.000Z', answered: { pending: false, delivered: false } };

afterEach(cleanup);

function setup() {
  let rows = [PENDING, DECIDED];
  const apiGet = vi.fn(async () => ({ suggestions: rows, pending: rows.filter((row) => row.status === 'pending').length }));
  const apiSend = vi.fn(async () => {
    rows = [DECIDED];
    return { ok: true };
  });
  render(<OwnerSuggestions apiGet={apiGet} apiSend={apiSend} />);
  return { apiGet, apiSend };
}

describe('owner suggestions', () => {
  it('builds a catalogue key from the name', () => {
    expect(suggestionKey('Radio Café Zürich')).toBe('radio-cafe-zurich');
    expect(suggestionKey('  !! 1LIVE !! ')).toBe('1live');
    expect(suggestionKey('')).toBe('');
  });

  it('shows the pending one with its checks, and accepting sends the prepared station', async () => {
    const { apiGet, apiSend } = setup();
    const card = await screen.findByTestId(`suggestion-${PENDING.id}`);
    expect(card.textContent).toContain('von Hörerin');
    expect(card.textContent).toContain('24 h: 3/4 erreichbar (75 %)');
    expect(card.textContent).toContain('zuletzt: HTTP 503');
    expect(card.textContent).toContain('Läuft bei uns jeden Abend');
    expect(screen.getByText('Entschieden (1)')).toBeTruthy();

    fireEvent.click(screen.getByTestId(`suggest-accept-${PENDING.id}`));
    expect(screen.getByTestId('suggest-input-key').value).toBe('radio-cafe-zurich');
    expect(screen.getByTestId('suggest-input-genre').value).toBe('Jazz');
    fireEvent.change(screen.getByTestId('suggest-input-tier'), { target: { value: 'pro' } });
    const save = screen.getByTestId('suggest-accept-save');
    await act(async () => { fireEvent.click(save); });

    expect(apiSend).toHaveBeenCalledWith(`/api/admin/station-suggestions/${PENDING.id}/accept`, 'POST', expect.objectContaining({
      key: 'radio-cafe-zurich', name: 'Radio Café Zürich', tier: 'pro', genre: 'Jazz', homepage: 'https://cafe.example.com',
    }));
    expect((await screen.findByTestId('suggest-message')).textContent).toContain('ist jetzt im Katalog');
    expect(apiGet).toHaveBeenCalledTimes(2);
    expect(screen.getByText('Kein offener Vorschlag.')).toBeTruthy();
  });

  it('rejecting sends the reason, and an empty key cannot be saved', async () => {
    const { apiSend } = setup();
    await screen.findByTestId(`suggestion-${PENDING.id}`);

    fireEvent.click(screen.getByTestId(`suggest-accept-${PENDING.id}`));
    fireEvent.change(screen.getByTestId('suggest-input-key'), { target: { value: '' } });
    expect(screen.getByTestId('suggest-accept-save').disabled).toBe(true);

    fireEvent.click(screen.getByTestId(`suggest-reject-${PENDING.id}`));
    fireEvent.change(screen.getByTestId('suggest-input-note'), { target: { value: 'Nur Werbung.' } });
    const save = screen.getByTestId('suggest-reject-save');
    await act(async () => { fireEvent.click(save); });
    expect(apiSend).toHaveBeenCalledWith(`/api/admin/station-suggestions/${PENDING.id}/reject`, 'POST', { note: 'Nur Werbung.' });
    expect((await screen.findByTestId('suggest-message')).textContent).toContain('abgelehnt');
  });

  it('shows the error the API answers', async () => {
    const apiGet = vi.fn(async () => ({ suggestions: [PENDING], pending: 1 }));
    const apiSend = vi.fn(async () => { throw new Error('Den Key „radio-cafe-zurich“ gibt es im Katalog schon. Nimm einen anderen.'); });
    render(<OwnerSuggestions apiGet={apiGet} apiSend={apiSend} />);
    fireEvent.click(await screen.findByTestId(`suggest-accept-${PENDING.id}`));
    const save = screen.getByTestId('suggest-accept-save');
    await act(async () => { fireEvent.click(save); });
    expect((await screen.findByTestId('suggest-message')).textContent).toContain('gibt es im Katalog schon');
    expect(screen.getByTestId('suggest-accept-form')).toBeTruthy();
  });
});
