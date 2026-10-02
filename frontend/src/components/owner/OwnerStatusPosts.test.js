import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import OwnerStatusPosts from './OwnerStatusPosts.js';

// The status page in Discord (#478): the switch works only with a channel ID,
// saving sends the section "statusPosts" with the channel and the language.

afterEach(() => cleanup());

function setup(stored = undefined) {
  const apiGet = vi.fn(async () => ({ statusPosts: stored }));
  const apiSend = vi.fn(async (_path, _method, body) => ({ ok: true, section: 'statusPosts', data: body.data }));
  render(<OwnerStatusPosts apiGet={apiGet} apiSend={apiSend} />);
  return { apiGet, apiSend };
}

describe('status posts in the owner console', () => {
  it('switches on only with a channel ID and saves channel, switch and language', async () => {
    const { apiSend } = setup();
    expect(await screen.findByTestId('status-posts')).toBeTruthy();
    expect(screen.getByTestId('status-posts-save').disabled).toBe(true);

    await act(async () => { fireEvent.click(screen.getByTestId('status-posts-enabled')); });
    expect(screen.getByTestId('status-posts-save').disabled).toBe(true);

    await act(async () => { fireEvent.change(screen.getByTestId('status-posts-channel'), { target: { value: ' 123456789012345678 ' } }); });
    await act(async () => { fireEvent.click(screen.getByTestId('status-posts-enabled')); });
    await act(async () => { fireEvent.change(screen.getByTestId('status-posts-language'), { target: { value: 'fr' } }); });
    expect(screen.getAllByRole('option').map((option) => option.value)).toEqual(['de', 'en', 'fr', 'es', 'it', 'pl', 'tr', 'pt', 'nl']);

    await act(async () => { fireEvent.click(screen.getByTestId('status-posts-save')); });
    expect(apiSend).toHaveBeenCalledWith('/api/admin/config', 'PUT', {
      section: 'statusPosts',
      data: { postEnabled: true, channelId: '123456789012345678', language: 'fr' },
    });
    expect(screen.getByTestId('status-posts-save').disabled).toBe(true);
  });

  it('a removed channel ID switches the posts off', async () => {
    setup({ postEnabled: true, channelId: '123456789012345678', language: 'de' });
    expect(await screen.findByTestId('status-posts')).toBeTruthy();
    await act(async () => { fireEvent.change(screen.getByTestId('status-posts-channel'), { target: { value: '' } }); });
    expect(screen.getByText('Erst die Kanal-ID eintragen, dann lassen sich die Posts einschalten.')).toBeTruthy();
  });
});
