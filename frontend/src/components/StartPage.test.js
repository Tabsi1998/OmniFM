import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import { PlayerProvider } from '../lib/player.js';
import Navbar from './Navbar.js';
import StationBrowser from './StationBrowser.js';
import WhyOmniFM from './WhyOmniFM.js';

// Visible errors of the start page, found on the live site (#421).

afterEach(cleanup);

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
