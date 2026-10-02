import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import OwnerLinkedRoles from './OwnerLinkedRoles.js';

// Owner page "Verknüpfte Rollen" (#302): what is set up, the two addresses
// for Discord's portal, the counts, and the support server's premium role.

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const STATUS = {
  ready: false,
  checks: { oauthApp: true, tokenKey: false, commanderApp: true },
  clientId: '100000000000000001',
  commanderId: '100000000000000001',
  verificationUrl: 'https://omnifm.xyz/api/auth/linked-roles',
  redirectUri: 'https://omnifm.xyz/api/auth/linked-roles/callback',
  linked: 4,
  counting: 2,
  supportRole: { configured: false, supportGuildId: '', premiumRoleId: '' },
};

function Page({ apiGet, onSave }) {
  const [linkedRoles, setLinkedRoles] = useState({ supportGuildId: '', premiumRoleId: '' });
  return <OwnerLinkedRoles apiGet={apiGet} linkedRoles={linkedRoles} setLinkedRoles={setLinkedRoles} onSave={onSave} saving={false} msg="" dirty />;
}

describe('the linked roles page', () => {
  it('shows what is missing, the two addresses and the counts', async () => {
    const apiGet = vi.fn(async () => STATUS);
    await act(async () => { render(<Page apiGet={apiGet} onSave={vi.fn()} />); });
    expect(apiGet).toHaveBeenCalledWith('/api/admin/linked-roles');
    expect(screen.getByTestId('linked-roles-check-key').textContent).toContain('OMNIFM_TOKEN_KEY fehlt');
    expect(screen.getByTestId('linked-roles-check-app').textContent).toContain('ist die App des Commanders');
    expect(screen.getByTestId('linked-roles-verification-url').textContent).toBe(STATUS.verificationUrl);
    expect(screen.getByTestId('linked-roles-redirect').textContent).toBe(STATUS.redirectUri);
    expect(screen.getByTestId('linked-roles-linked').textContent).toBe('4');
    expect(screen.getByTestId('linked-roles-counting').textContent).toBe('2');
  });

  it('saves only IDs for the support server and its role', async () => {
    const onSave = vi.fn();
    await act(async () => { render(<Page apiGet={vi.fn(async () => STATUS)} onSave={onSave} />); });
    fireEvent.change(screen.getByTestId('cfg-linked-roles-guild'), { target: { value: ' 123456789012345678 ' } });
    fireEvent.change(screen.getByTestId('cfg-linked-roles-role'), { target: { value: 'kein-id' } });
    expect(screen.getByTestId('owner-linked-roles').textContent).toContain('Eine ID sieht nicht richtig aus');
    fireEvent.click(screen.getByTestId('cfg-linked-roles-save'));
    expect(onSave).toHaveBeenCalledWith({ supportGuildId: '123456789012345678', premiumRoleId: '' });
  });
});
