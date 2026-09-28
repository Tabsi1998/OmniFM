import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import { CONSENT_STORAGE_KEY, GA_MEASUREMENT_ID } from '../lib/analyticsConsent.js';
import CookieConsent from './CookieConsent.js';

// The cookie notice as a slim bar (#435): the same choices as before, the
// details only on request, the cookie button above the player bar.

const stored = () => JSON.parse(window.localStorage.getItem(CONSENT_STORAGE_KEY) || 'null');
const lastConsent = () => [...(window.dataLayer || [])].reverse().find((entry) => entry[0] === 'consent')?.[2];
const analyticsOff = () => window[`ga-disable-${GA_MEASUREMENT_ID}`] === true;

function show() {
  render(<I18nProvider><CookieConsent /></I18nProvider>);
}

beforeEach(() => {
  window.localStorage.clear();
  window.dataLayer = [];
});

afterEach(() => {
  cleanup();
  document.getElementById('omnifm-google-tag')?.remove();
});

describe('the cookie bar', () => {
  it('first visit: one short line with the privacy link and three choices; analytics stays off meanwhile', () => {
    show();
    const text = screen.getByTestId('cookie-consent-text');
    expect(text.textContent).toMatch(/Google Analytics/);
    expect(text.querySelector('a').getAttribute('href')).toMatch(/privacy|datenschutz/);
    expect(screen.getByTestId('cookie-consent-reject')).toBeTruthy();
    expect(screen.getByTestId('cookie-consent-settings').getAttribute('aria-expanded')).toBe('false');
    expect(screen.getByTestId('cookie-consent-accept')).toBeTruthy();
    expect(screen.queryByTestId('cookie-consent-analytics')).toBeNull();
    expect(lastConsent()).toMatchObject({ analytics_storage: 'denied' });
    expect(analyticsOff()).toBe(true);
    expect(stored()).toBeNull();
  });

  it('"Accept all" allows analytics and remembers it', () => {
    show();
    fireEvent.click(screen.getByTestId('cookie-consent-accept'));
    expect(stored()).toMatchObject({ necessary: true, analytics: true });
    expect(lastConsent()).toMatchObject({ analytics_storage: 'granted', ad_storage: 'denied' });
    expect(analyticsOff()).toBe(false);
    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull();
    expect(screen.getByTestId('cookie-consent-manage')).toBeTruthy();
  });

  it('"Reject" keeps analytics off and remembers that too', () => {
    show();
    fireEvent.click(screen.getByTestId('cookie-consent-reject'));
    expect(stored()).toMatchObject({ analytics: false });
    expect(lastConsent()).toMatchObject({ analytics_storage: 'denied' });
    expect(analyticsOff()).toBe(true);
    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull();
  });

  it('the settings: necessary always on, analytics by choice, then save', () => {
    show();
    fireEvent.click(screen.getByTestId('cookie-consent-settings'));
    expect(screen.getByTestId('cookie-consent-settings').getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('cookie-consent-necessary').disabled).toBe(true);
    const analytics = screen.getByTestId('cookie-consent-analytics');
    expect(analytics.checked).toBe(false);
    fireEvent.click(analytics);
    fireEvent.click(screen.getByTestId('cookie-consent-save'));
    expect(stored()).toMatchObject({ analytics: true });
    expect(lastConsent()).toMatchObject({ analytics_storage: 'granted' });
  });

  it('a stored choice counts on the next visit; the cookie button sits above the player bar and opens the settings', () => {
    window.localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify({ analytics: true, updatedAt: '2026-09-28T10:00:00Z' }));
    show();
    expect(screen.queryByTestId('cookie-consent-banner')).toBeNull();
    expect(lastConsent()).toMatchObject({ analytics_storage: 'granted' });
    const manage = screen.getByTestId('cookie-consent-manage');
    expect(manage.getAttribute('aria-label')).toBeTruthy();
    expect(manage.style.bottom).toBe('calc(var(--omnifm-bottom-bar, 0px) + 16px)');
    fireEvent.click(manage);
    expect(screen.getByTestId('cookie-consent-settings-panel')).toBeTruthy();
    expect(screen.getByTestId('cookie-consent-analytics').checked).toBe(true);
    fireEvent.click(screen.getByTestId('cookie-consent-analytics'));
    fireEvent.click(screen.getByTestId('cookie-consent-save'));
    expect(stored()).toMatchObject({ analytics: false });
    expect(analyticsOff()).toBe(true);
  });
});
