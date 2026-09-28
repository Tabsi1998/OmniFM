import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import { PlayerProvider } from '../lib/player.js';
import deSite from '../i18n/de-site.js';
import dePages from '../i18n/de-pages.js';
import enSite from '../i18n/en-site.js';
import enPages from '../i18n/en-pages.js';
import CommunitySection from './CommunitySection.js';
import FaqSection from './FaqSection.js';
import Hero from './Hero.js';
import Navbar from './Navbar.js';
import NowPlayingBar from './NowPlayingBar.js';
import Premium from './Premium.js';
import { EGG_FALLBACK_SECTIONS } from './season/EasterEggs.js';
import SiteFooter from './SiteFooter.js';
import StationBrowser from './StationBrowser.js';
import TrustBar from './TrustBar.js';
import WhyOmniFM from './WhyOmniFM.js';

// Visible errors of the start page, found on the live site (#421), and the
// tighter start page (#435).

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.sessionStorage.clear();
});

function quietApi() {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ stations: [] }) })));
}

const inGerman = () => vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-DE']);

describe('the start page', () => {
  it('draws the active "All" filter in colours the browser understands', () => {
    render(
      <I18nProvider>
        <PlayerProvider>
          <StationBrowser stations={[{ key: 'lofi', name: 'Lofi', tier: 'free' }]} loading={false} />
        </PlayerProvider>
      </I18nProvider>
    );
    const all = screen.getByTestId('tier-filter-all');
    // "#fff12" was dropped as no colour, and the browser drew a grey button under white text.
    expect(all.style.color).toBe('rgb(255, 255, 255)');
    expect(all.style.background).not.toBe('');
    expect(all.style.border).not.toBe('');
  });

  it('names the "Why OmniFM" cards in the page language, not by their internal key', () => {
    inGerman();
    render(<I18nProvider><WhyOmniFM /></I18nProvider>);
    expect(screen.getByText('Steuerung')).toBeTruthy();
    expect(screen.getByText('Wachstum')).toBeTruthy();
    expect(screen.queryByText('control')).toBeNull();
    expect(screen.queryByText('growth')).toBeNull();
  });

  it('has no menu entry that jumps to the removed dashboard block', () => {
    const { container } = render(<I18nProvider><Navbar page="home" /></I18nProvider>);
    expect(container.querySelector('a[href*="dashboard-showcase"]')).toBeNull();
  });
});

describe('the tighter start page (#435)', () => {
  const STATS = { servers: 4321, stations: 987, freeStations: 20, proStations: 80, bots: 777, listeners: 2468, connections: 1357, live: true };

  it('shows each number of the network once, clearly named, and no "Free+"', () => {
    quietApi();
    inGerman();
    const { container } = render(
      <I18nProvider>
        <PlayerProvider>
          <Hero stats={STATS} bots={[]} />
          <TrustBar stats={STATS} />
          <SiteFooter legal={null} />
          <NowPlayingBar bots={[]} />
        </PlayerProvider>
      </I18nProvider>
    );
    const text = container.textContent;
    const times = (needle) => text.split(needle).length - 1;
    for (const number of ['4.321', '987', '777', '2.468']) expect(times(number), number).toBe(1);
    expect(text).not.toContain('1.357');
    expect(text).not.toContain('Free+');
    expect(screen.getByTestId('trust-bar-value-listeners').textContent).toBe('2.468');
    expect(screen.getByTestId('trust-bar-listeners').textContent).toContain('Hören gerade zu');
    expect(screen.getByTestId('trust-bar-stations').textContent).toContain('Sender');
    expect(screen.queryByTestId('hero-quick-stats')).toBeNull();
  });

  it('shows a dash until the numbers arrive, not a misleading 0', () => {
    render(<I18nProvider><TrustBar stats={{}} /></I18nProvider>);
    expect(screen.getByTestId('trust-bar-value-servers').textContent).toBe('–');
  });

  it('speaks plainly: none of the insider words the review found', () => {
    const texts = (site, pages) => JSON.stringify([site.hero, site.trustBar, site.whyOmniFM, site.faq, pages.premium, pages.footer]);
    expect(texts(deSite, dePages)).not.toMatch(/Worker-Architektur|Operator|Health|Analytics|Upgrade-Pfad|Produktkern|Free\+/);
    expect(texts(enSite, enPages)).not.toMatch(/worker architecture|worker-based|operator|health|analytics|upgrade path|product core|Free\+/i);
    expect(deSite.useCases).toBeUndefined();
  });

  it('answers where to see the plan, with a link to the dashboard (the server-ID check is gone)', () => {
    inGerman();
    render(<I18nProvider><FaqSection /></I18nProvider>);
    fireEvent.click(screen.getByText('Wie sehe ich, welchen Plan mein Server hat?'));
    const link = screen.getByTestId('faq-link-planStatus');
    expect(link.getAttribute('href')).toMatch(/^\/dashboard\b/);
    expect(link.textContent).toBe('Zum Dashboard');
  });

  it('keeps the hero for the season badge and the sections the Easter eggs fall back to', async () => {
    // The community section shows only with a sponsor or a bot listing.
    const marketing = { sponsors: [{ name: 'Sponsor', url: 'https://example.org' }], botListings: [] };
    vi.stubGlobal('fetch', vi.fn(async (url) => ({
      ok: true,
      status: 200,
      json: async () => (String(url).includes('/api/marketing') ? marketing : { stations: [] }),
    })));
    render(
      <I18nProvider>
        <PlayerProvider>
          <Hero stats={STATS} bots={[]} />
          <StationBrowser stations={[]} loading={false} />
          <WhyOmniFM />
          <Premium bots={[]} />
          <CommunitySection />
          <FaqSection />
        </PlayerProvider>
      </I18nProvider>
    );
    await screen.findByTestId('community-section');
    for (const id of new Set(['hero-section', ...EGG_FALLBACK_SECTIONS])) {
      expect(document.querySelector(`[data-testid="${id}"]`), id).not.toBeNull();
    }
  });

  it('the player bar: the station name gets two lines on a phone, the corner buttons learn its height', () => {
    quietApi();
    const { container } = render(<I18nProvider><PlayerProvider><NowPlayingBar bots={[]} /></PlayerProvider></I18nProvider>);
    expect(screen.getByTestId('now-playing-bar-name').className).toBe('npbar-name');
    expect(container.querySelector('style').textContent).toMatch(/max-width: 720px\)\{[^]*\.npbar-name\{[^}]*-webkit-line-clamp: 2/);
    expect(document.documentElement.style.getPropertyValue('--omnifm-bottom-bar')).toBe('74px');
    fireEvent.click(screen.getByTestId('now-playing-bar-close'));
    expect(screen.queryByTestId('now-playing-bar')).toBeNull();
    expect(document.documentElement.style.getPropertyValue('--omnifm-bottom-bar')).toBe('');
  });
});
