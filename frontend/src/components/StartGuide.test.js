import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import { PlayerProvider } from '../lib/player.js';
import CommunitySection from './CommunitySection.js';
import FaqSection from './FaqSection.js';
import Hero from './Hero.js';
import HowToDiscord from './HowToDiscord.js';
import Navbar from './Navbar.js';
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

function guide() {
  return render(<I18nProvider><StartGuide bots={BOTS} /></I18nProvider>);
}

describe('the page "Erste Schritte"', () => {
  it('walks from the invitation to the dashboard, each Discord step with its demo', () => {
    guide();
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

  it('answers the stumbling blocks one at a time, the first one open', () => {
    guide();
    const join = screen.getByTestId('start-help-join');
    const silent = screen.getByTestId('start-help-silent');
    expect(join.textContent).toContain('„Verbinden“ und „Sprechen“');
    expect(silent.querySelector('p')).toBeNull();
    fireEvent.click(silent.querySelector('button'));
    expect(silent.querySelector('p').textContent).toContain('durchgestrichenem Mikrofon');
    expect(join.querySelector('p')).toBeNull();
    expect(silent.querySelector('button').getAttribute('aria-expanded')).toBe('true');
  });

  it('has a table of contents whose every entry lands on the page', () => {
    const { container } = guide();
    const targets = [...container.querySelectorAll('nav a')].map((link) => link.getAttribute('href'));
    expect(targets).toEqual(['#commander', '#worker', '#play', '#panel', '#dashboard', '#help']);
    for (const target of targets) expect(container.querySelector(target)).not.toBeNull();
  });

  it('scrolls to the help when the bot links to /start#help', () => {
    const scroll = vi.spyOn(HTMLElement.prototype, 'scrollIntoView');
    window.history.replaceState(null, '', '/start?lang=de#help');
    guide();
    expect(scroll).toHaveBeenCalledTimes(1);
    expect(scroll.mock.instances[0].id).toBe('help');
  });
});

describe('the ways to the guide', () => {
  it('the menu, the how-to and the FAQ link to /start', () => {
    const { container } = render(
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

  it('no link on the start page jumps to a section that is not there ("Wie es funktioniert" went nowhere)', () => {
    const { container } = render(
      <I18nProvider>
        <PlayerProvider>
          <Navbar page="home" />
          <Hero stats={{}} bots={BOTS} />
          <HowToDiscord bots={BOTS} />
          <StationBrowser stations={[]} loading={false} />
          <WhyOmniFM />
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
