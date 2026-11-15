import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import Premium from './Premium.js';

// The window for a code and the free month (#530): a named, modal dialog
// with labelled fields; the focus starts in it, stays in it and goes back to
// the button that opened it.

const PRICING = {
  tiers: {
    free: { name: 'Free', pricePerMonth: 0, features: [] },
    pro: { name: 'Pro', pricePerMonth: 299, startingAt: '2,99', features: [] },
    ultimate: { name: 'Ultimate', pricePerMonth: 499, startingAt: '4,99', features: [] },
  },
  durations: [1, 3, 6, 12],
  seatOptions: [1, 2, 3, 5],
  trial: { enabled: true, tier: 'pro', months: 1 },
  discordShop: { enabled: false },
};

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function openFrom(buttonId) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => PRICING })));
  render(<I18nProvider><Premium bots={[]} /></I18nProvider>);
  await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
  const opener = screen.getByTestId(buttonId);
  opener.focus();
  fireEvent.click(opener);
  return { opener, dialog: screen.getByRole('dialog') };
}

describe('the code and trial window', () => {
  it('is a modal dialog named by its title, with labelled fields', async () => {
    const { dialog } = await openFrom('buy-btn-pro');
    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(screen.getByRole('dialog', { name: /OmniFM Pro: (Code einlösen|redeem a code)/ })).toBe(dialog);
    const email = within(dialog).getByLabelText(/E-Mail Adresse|Email address/);
    expect(email).toBe(screen.getByTestId('checkout-email-input'));
    expect(within(dialog).getByLabelText(/Rabattcode|Discount code/)).toBe(screen.getByTestId('checkout-coupon-input'));
    expect(document.getElementById(email.getAttribute('aria-describedby'))?.textContent).toMatch(/Lizenz-Key|license key/);
  });

  it('starts in the e-mail field and keeps Tab inside the window', async () => {
    const { opener, dialog } = await openFrom('buy-btn-pro');
    const email = screen.getByTestId('checkout-email-input');
    const first = screen.getByTestId('checkout-modal-close');
    const last = screen.getByTestId('checkout-cancel-btn');
    expect(document.activeElement).toBe(email);

    // In between, the browser moves on by itself.
    expect(fireEvent.keyDown(email, { key: 'Tab' })).toBe(true);

    last.focus();
    expect(fireEvent.keyDown(last, { key: 'Tab' })).toBe(false);
    expect(document.activeElement).toBe(first);

    expect(fireEvent.keyDown(first, { key: 'Tab', shiftKey: true })).toBe(false);
    expect(document.activeElement).toBe(last);

    // Focus that got behind the window comes back into it.
    opener.focus();
    fireEvent.keyDown(opener, { key: 'Tab' });
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it.each(['buy-btn-pro', 'premium-pro-trial-open-btn'])('closes with Escape and gives the focus back to %s', async (buttonId) => {
    const { opener } = await openFrom(buttonId);
    expect(document.activeElement).not.toBe(opener);
    fireEvent.keyDown(document.activeElement, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('gives the focus back when closed with the cancel button too', async () => {
    const { opener } = await openFrom('buy-btn-pro');
    fireEvent.click(screen.getByTestId('checkout-cancel-btn'));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(document.activeElement).toBe(opener);
  });

  it('reads out what went wrong', async () => {
    const { dialog } = await openFrom('buy-btn-pro');
    fireEvent.click(screen.getByTestId('checkout-pay-btn-pro'));
    expect(within(within(dialog).getByRole('status')).getByTestId('checkout-error-msg').textContent.length).toBeGreaterThan(5);
  });
});
