import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import OwnerAdmin from './OwnerAdmin.js';

// The owner console's sign-in page (#283, #294): the Discord button only where
// the server offers the Discord sign-in; the token login always.

function mockSession(status, body) {
  vi.stubGlobal('fetch', vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  })));
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('owner console sign-in', () => {
  it('offers Discord when the server has the Discord sign-in', async () => {
    mockSession(200, { authenticated: false, discordLogin: true });
    render(<OwnerAdmin />);
    expect(await screen.findByTestId('admin-discord-login-button')).toBeTruthy();
    expect(screen.getByTestId('admin-token-input')).toBeTruthy();
  });

  it('keeps only the token where the server has no Discord sign-in', async () => {
    mockSession(404, { detail: 'Not Found' });
    render(<OwnerAdmin />);
    expect(await screen.findByTestId('admin-token-input')).toBeTruthy();
    expect(screen.queryByTestId('admin-discord-login-button')).toBeNull();
  });
});
