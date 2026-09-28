import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import Premium from './Premium.js';

// The plan cards (#413): the lines come from the bot's plan file; an own list
// from the owner console still wins.

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

function answer(body) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => body })));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('plan cards', () => {
  it('shows what each plan brings, Pro and Ultimate only what they add', async () => {
    answer(PRICING);
    render(<I18nProvider><Premium bots={[]} planContext={{ freeStations: 20, allStations: 120 }} /></I18nProvider>);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    const free = screen.getByTestId('premium-features-free').textContent;
    const pro = screen.getByTestId('premium-features-pro').textContent;
    const ultimate = screen.getByTestId('premium-features-ultimate').textContent;
    expect(free).toMatch(/20 (Sender aus dem Katalog|stations from the catalogue)/);
    expect(free).toMatch(/1 (geplantes Radio-Event|scheduled radio event)/);
    expect(pro).toMatch(/Alles aus Free, dazu:|Everything in Free, plus:/);
    expect(pro).toMatch(/Alle 120 Sender|All 120 catalogue stations/);
    expect(pro).toMatch(/Ausfall-Meldungen|Outage alerts/);
    expect(pro).not.toMatch(/Voice Guard/);
    expect(ultimate).toMatch(/Alles aus Pro, dazu:|Everything in Pro, plus:/);
    expect(ultimate).toMatch(/50 (eigene Sender|stations of your own)/);
    expect(`${free}${pro}${ultimate}`).not.toMatch(/Ultimate-Sender|Ultimate stations/);
  });

  it('keeps the owner console list and then shows no generated intro', async () => {
    answer({ ...PRICING, tiers: { ...PRICING.tiers, pro: { ...PRICING.tiers.pro, features: ['Eigene Zeile vom Owner'] } } });
    render(<I18nProvider><Premium bots={[]} /></I18nProvider>);
    await waitFor(() => expect(screen.getByTestId('premium-features-pro').textContent).toContain('Eigene Zeile vom Owner'));
    expect(screen.getByTestId('premium-features-pro').textContent).not.toMatch(/Alles aus Free|Everything in Free/);
    expect(screen.getByTestId('premium-features-free').textContent).toMatch(/Katalog|catalogue/);
  });
});
