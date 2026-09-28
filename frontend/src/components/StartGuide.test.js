import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import { PlayerProvider } from '../lib/player.js';
import CommunitySection from './CommunitySection.js';
import DashboardPreview from './DashboardPreview.js';
import FaqSection from './FaqSection.js';
import Hero from './Hero.js';
import HowToDiscord from './HowToDiscord.js';
import Navbar from './Navbar.js';
import NowPlayingBar from './NowPlayingBar.js';
import Premium from './Premium.js';
import StartGuide from './StartGuide.js';
import StationBrowser from './StationBrowser.js';
import WhyOmniFM from './WhyOmniFM.js';

// The page "Erste Schritte" (#434) and the links that lead to it.

const BOTS = [{ role: 'commander', inviteUrl: 'https://discord.com/oauth2/authorize?client_id=42' }];

beforeEach(() => {
  // The demos stay quiet frames: this test is about the page around them.
  vi.stubGlobal('IntersectionObserver', class {
    observe() {}
    disconnect() {}
  });
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => ({ stations: [] }) })));
  vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['de-DE']);
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  window.history.replaceState(null, '', '/');
});

async function guide() {
  const view = render(<I18nProvider><StartGuide bots={BOTS} /></I18nProvider>);
  await screen.findByTestId('start-guide');
  return view;
}

describe('the page "Erste Schritte"', () => {
  it('walks from the invitation to the dashboard, each Discord step with its demo', async () => {
    await guide();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('OmniFM in fünf Minuten einrichten');
    const steps = ['commander', 'worker', 'play', 'panel', 'dashboard'];
    for (const step of steps) expect(screen.getByTestId(`start-step-${step}`)).toBeTruthy();
    for (const scene of ['commander', 'worker', 'play', 'panel']) {
      expect(screen.getByTestId(`start-step-${scene}`).querySelector(`[data-testid="live-demo-${scene}"]`)).not.toBeNull();
    }
    expect(screen.getByTestId('start-step-dashboard').querySelector('[data-testid^="live-demo"]')).toBeNull();
    expect(screen.getByTestId('start-invite').getAttribute('href')).toBe(BOTS[0].inviteUrl);
    expect(screen.getByTestId('start-dashboard').getAttribute('href')).toBe('/dashboard?lang=de');
    expect(screen.getByTestId('start-community').getAttribute('href')).toBe('https://discord.gg/UeRkfGS43R');
  });

  it('answers the stumbling blocks one at a time, the first one open', async () => {
    await guide();
    const join = screen.getByTestId('start-help-join');
    const silent = screen.getByTestId('start-help-silent');
    expect(join.textContent).toContain('„Verbinden“ und „Sprechen“');
    expect(silent.querySelector('p')).toBeNull();
    fireEvent.click(silent.querySelector('button'));
    expect(silent.querySelector('p').textContent).toContain('durchgestrichenem Mikrofon');
    expect(join.querySelector('p')).toBeNull();
    expect(silent.querySelector('button').getAttribute('aria-expanded')).toBe('true');
  });

  it('has a table of contents whose every entry lands on the page', async () => {
    const { container } = await guide();
    const targets = [...container.querySelectorAll('nav a')].map((link) => link.getAttribute('href'));
    expect(targets).toEqual(['#commander', '#worker', '#play', '#panel', '#dashboard', '#help']);
    for (const target of targets) expect(container.querySelector(target)).not.toBeNull();
  });

  it('scrolls to the help when the bot links to /start#help', async () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    window.history.replaceState(null, '', '/start?lang=de#help');
    await guide();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.instances[0].id).toBe('help');
  });
});

describe('the texts of the guide', () => {
  const texts = import.meta.glob('../i18n/guide/*.js', { eager: true, import: 'default' });
  const shape = (value) => (Array.isArray(value)
    ? value.map((entry) => shape(entry))
    : value && typeof value === 'object'
      ? Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, key === 'id' || key === 'key' ? entry : shape(entry)]))
      : typeof value);

  it('exist in all nine languages with the same steps, tips and answers as English', () => {
    const codes = Object.keys(texts).map((file) => file.match(/guide\/(\w+)\.js$/)[1]).sort();
    expect(codes).toEqual(['de', 'en', 'es', 'fr', 'it', 'nl', 'pl', 'pt', 'tr']);
    const english = shape(texts['../i18n/guide/en.js']);
    for (const [file, guide] of Object.entries(texts)) {
      expect(shape(guide), file).toEqual(english);
      const strings = JSON.stringify(guide).match(/"(?:[^"\\]|\\.)*"/g);
      expect(strings.every((entry) => entry.length > 2), file).toBe(true);
    }
  });

  it('load in the language of the page', async () => {
    vi.spyOn(window.navigator, 'languages', 'get').mockReturnValue(['fr-FR']);
    render(<I18nProvider><StartGuide bots={BOTS} /></I18nProvider>);
    expect((await screen.findByRole('heading', { level: 1 })).textContent).toBe('Installer OmniFM en cinq minutes');
  });
});

describe('the ways to the guide', () => {
  it('the menu, the how-to and the FAQ link to /start', () => {
    render(
      <I18nProvider>
        <Navbar page="home" />
        <HowToDiscord bots={BOTS} />
        <FaqSection />
      </I18nProvider>
    );
    const menu = screen.getByTestId('nav-link-start');
    expect(menu.textContent).toBe('Anleitung');
    expect(menu.getAttribute('href')).toBe('/start?lang=de');
    expect(menu.getAttribute('aria-current')).toBeNull();
    expect(screen.getByTestId('howto-guide-link').getAttribute('href')).toBe('/start?lang=de');
    expect(screen.getByTestId('faq-link-start').getAttribute('href')).toBe('/start?lang=de');
  });

  it('on the guide, the menu marks "Anleitung" as the page you are on', () => {
    render(<I18nProvider><Navbar page="start" /></I18nProvider>);
    expect(screen.getByTestId('nav-link-start').getAttribute('aria-current')).toBe('page');
    expect(screen.getByTestId('nav-link-faq').getAttribute('aria-current')).toBeNull();
  });

  it('without the bot list yet, every invite button leads to the guide\'s first step, not into nothing', () => {
    const { container } = render(
      <I18nProvider>
        <PlayerProvider>
          <Hero stats={{}} bots={[]} />
          <HowToDiscord bots={[]} />
          <Premium bots={[]} planContext={{}} />
          <NowPlayingBar bots={[]} />
        </PlayerProvider>
      </I18nProvider>
    );
    expect(container.querySelector('a[href="#bots"]')).toBeNull();
    const toGuide = [...container.querySelectorAll('a')].filter((link) => link.getAttribute('href') === '/start?lang=de#commander');
    // The hero, the how-to, the Free plan card and the player bar.
    expect(toGuide.length).toBe(4);
    expect(toGuide.every((link) => link.getAttribute('target') === null)).toBe(true);
  });

  it('no link on the start page jumps to a section that is not there ("Wie es funktioniert" went nowhere)', () => {
    const { container } = render(
      <I18nProvider>
        <PlayerProvider>
          <Navbar page="home" />
          <Hero stats={{}} bots={BOTS} />
          <HowToDiscord bots={BOTS} />
          <StationBrowser stations={[]} loading={false} />
          <WhyOmniFM />
          <DashboardPreview />
          <Premium bots={BOTS} planContext={{}} />
          <CommunitySection />
          <FaqSection />
        </PlayerProvider>
      </I18nProvider>
    );
    const anchors = [...new Set([...container.querySelectorAll('a[href^="#"]')].map((link) => link.getAttribute('href')))];
    expect(anchors).toContain('#how-to');
    for (const anchor of anchors) expect(container.querySelector(anchor), anchor).not.toBeNull();
  });
});
