import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import { WEBSITE_LANGUAGES, copyFor, loadLanguage } from '../i18n/languages.js';
import ImpressumSection from './ImpressumSection.js';
import PrivacySection from './PrivacySection.js';
import TermsSection from './TermsSection.js';

// The imprint, the privacy policy and the terms (#422, #423): only filled
// facts, nothing meant for the operator, the transfers to the USA.

// Half filled, like the live data on 2026-09-28: no phone, no register, no media owner.
const LEGAL = {
  legal: {
    providerName: 'Fabian Tabelander',
    streetAddress: 'Musterstraße 1',
    postalCode: '4020',
    city: 'Linz',
    country: '',
    email: 'hallo@omnifm.xyz',
    website: 'https://omnifm.xyz',
    phone: '',
    legalForm: '',
    mediaOwner: '',
  },
  missingCoreFields: [],
};

const PRIVACY = {
  controller: { name: 'Fabian Tabelander', streetAddress: 'Musterstraße 1', postalCode: '4020', city: 'Linz' },
  contact: { email: 'datenschutz@omnifm.xyz' },
  dpo: {},
  hosting: { provider: '', location: 'Österreich | EU' },
  authority: {},
  features: { smtpEnabled: false, localeStorageKey: 'omnifm.web.locale' },
  retention: { logDays: 14, songHistoryEnabled: true, songHistoryMaxPerGuild: 100 },
  missingCoreFields: ['contactPhone'],
};

const TERMS = {
  operator: { providerName: 'Fabian Tabelander', website: 'https://omnifm.xyz' },
  contact: { email: 'hallo@omnifm.xyz', website: 'https://omnifm.xyz', effectiveDate: '', governingLaw: '' },
  service: { discordBot: true, dashboard: true },
  billing: { premiumCheckout: false, emailDelivery: false, trialMonth: true },
  missingCoreFields: ['effectiveDate'],
};

// What only the operator should read, as the pages said it until #422.
const OPERATOR_ONLY = [
  'Nicht angegeben',
  'Pflichtangaben fehlen',
  'Server-Konfiguration',
  'Setup-Menü',
  'Rechtlicher Hinweis',
  'Wichtiger Hinweis',
  'Basisangaben ergänzen',
  'Premium-Checkout',
  'Nicht aktiv',
];

function inLanguage(code) {
  window.history.replaceState({}, '', `/?lang=${code}`);
}

function pageText(testId) {
  return screen.getByTestId(testId).textContent;
}

beforeAll(() => Promise.all(WEBSITE_LANGUAGES.map(({ code }) => loadLanguage(code))));

afterEach(() => {
  cleanup();
  window.history.replaceState({}, '', '/');
});

describe('legal pages', () => {
  it('the imprint lists only what is filled in and no note for the operator', () => {
    inLanguage('de');
    render(<I18nProvider><ImpressumSection legal={LEGAL} /></I18nProvider>);
    const text = pageText('impressum-section');

    expect(text).toContain('Fabian Tabelander');
    expect(text).toContain('Musterstraße 1');
    expect(text).toContain('4020 Linz');
    expect(text).toContain('Österreich');
    expect(text).not.toContain('Telefon');
    expect(text).not.toContain('Medienrechtliche Angaben');
    expect(text).not.toContain('Unternehmensdaten');
    for (const phrase of OPERATOR_ONLY) expect(text).not.toContain(phrase);
    expect(screen.getByRole('link', { name: 'hallo@omnifm.xyz' }).getAttribute('href')).toBe('mailto:hallo@omnifm.xyz');
  });

  it('the privacy policy has the date, a table of contents and the transfers to the USA', () => {
    inLanguage('de');
    render(<I18nProvider><PrivacySection legal={LEGAL} privacy={PRIVACY} /></I18nProvider>);
    const text = pageText('privacy-section');

    expect(screen.getByTestId('legal-updated').textContent).toBe('Stand: 29. September 2026');
    const toc = screen.getByTestId('legal-toc');
    expect(toc.querySelector('a[href="#privacy-transfers"]').textContent).toBe('Übermittlung in Länder außerhalb der EU');
    expect(document.getElementById('privacy-transfers').textContent).toContain('Data Privacy Framework');
    // Art. 13 (1)(c) and (2)(e)/(f): consent as a legal basis, voluntary data, no automated decisions.
    expect(document.getElementById('privacy-basis').textContent).toContain('Art. 6 Abs. 1 lit. a DSGVO');
    expect(document.getElementById('privacy-voluntary').textContent).toContain('Art. 22 DSGVO');
    expect(text).toContain('Österreich | EU');
    expect(screen.getByTestId('legal-facts').textContent).not.toContain('Hosting-Anbieter');
    for (const phrase of OPERATOR_ONLY) expect(text).not.toContain(phrase);
    for (const jargon of ['CORS', 'Rate-Limit', 'analytics_storage', 'Consent Mode']) expect(text).not.toContain(jargon);
  });

  it('the privacy policy names the hosting provider once it is entered', () => {
    inLanguage('de');
    const privacy = { ...PRIVACY, hosting: { provider: 'Hetzner Online GmbH', location: 'Deutschland' } };
    render(<I18nProvider><PrivacySection legal={LEGAL} privacy={privacy} /></I18nProvider>);
    expect(pageText('privacy-section')).toContain('Hosting-AnbieterHetzner Online GmbH');
  });

  it('the terms have no list of switches and show "valid from" once it is set', () => {
    inLanguage('de');
    const { unmount } = render(<I18nProvider><TermsSection legal={LEGAL} terms={TERMS} /></I18nProvider>);
    let text = pageText('terms-section');
    expect(text).not.toContain('Dienstumfang');
    expect(text).not.toContain('Testmonat Aktiv');
    expect(text).not.toContain('Gültig ab');
    for (const phrase of OPERATOR_ONLY) expect(text).not.toContain(phrase);
    expect(screen.getByTestId('legal-updated').textContent).toBe('Stand: 29. September 2026');
    expect(screen.getByTestId('legal-toc')).toBeTruthy();
    unmount();

    const terms = { ...TERMS, contact: { ...TERMS.contact, effectiveDate: '01.10.2026' } };
    render(<I18nProvider><TermsSection legal={LEGAL} terms={terms} /></I18nProvider>);
    text = pageText('terms-section');
    expect(text).toContain('Gültig ab01.10.2026');
  });

  it.each(WEBSITE_LANGUAGES.map(({ code }) => code))('all three pages read completely in %s', (code) => {
    inLanguage(code);
    const copy = copyFor(code);
    render(
      <I18nProvider>
        <ImpressumSection legal={LEGAL} />
        <PrivacySection legal={LEGAL} privacy={PRIVACY} />
        <TermsSection legal={LEGAL} terms={TERMS} />
      </I18nProvider>,
    );

    const text = ['impressum-section', 'privacy-section', 'terms-section'].map(pageText).join(' ');
    expect(text).not.toMatch(/undefined|\[object|function \(|=>/);
    expect(document.querySelector('#privacy-transfers h2').textContent).toBe(copy.privacy.sections.transfersTitle);
    expect(screen.getAllByTestId('legal-updated')).toHaveLength(2);
    expect(screen.getAllByTestId('legal-toc')).toHaveLength(2);
  });
});
