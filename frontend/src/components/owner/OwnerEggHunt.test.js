import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import OwnerEggHunt from './OwnerEggHunt.js';

// The Easter egg hunt in the owner console (#429): per server the top three
// of the year, prepared for a reward later.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the egg hunt in the owner console', () => {
  it('shows per server the top three, with shared places', async () => {
    const apiGet = vi.fn(async () => ({
      year: 2027,
      servers: [{
        guildId: '123456789012345678',
        name: 'Eierclub',
        finders: 4,
        eggs: 10,
        top: [
          { userId: '333333333333333333', count: 5, rank: 1 },
          { userId: '111111111111111111', count: 2, rank: 2 },
          { userId: '444444444444444444', count: 1, rank: 3 },
        ],
      }],
    }));
    render(<OwnerEggHunt apiGet={apiGet} />);
    expect(apiGet).toHaveBeenCalledWith('/api/admin/egg-hunt');
    const server = await screen.findByTestId('owner-egg-server-123456789012345678');
    expect(server.textContent).toContain('Eierclub');
    expect(server.textContent).toContain('10 Eier · 4 Finder');
    const places = [...server.querySelectorAll('li')].map((item) => [item.value, item.textContent]);
    expect(places).toEqual([
      [1, '333333333333333333 · 5 Eier'],
      [2, '111111111111111111 · 2 Eier'],
      [3, '444444444444444444 · 1 Ei'],
    ]);
    expect(screen.getByTestId('owner-egg-hunt').textContent).toContain('Top 3 je Server (2027)');
  });

  it('says so when nobody found an egg yet, and shows an error', async () => {
    render(<OwnerEggHunt apiGet={vi.fn(async () => ({ year: null, servers: [] }))} />);
    expect(await screen.findByText('Noch keine Eier gefunden.')).toBeTruthy();
    cleanup();
    render(<OwnerEggHunt apiGet={vi.fn(async () => { throw new Error('unauthorized'); })} />);
    expect(await screen.findByText('unauthorized')).toBeTruthy();
  });
});
