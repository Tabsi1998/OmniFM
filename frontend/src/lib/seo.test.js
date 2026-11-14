import { describe, expect, it } from 'vitest';
import { applySeoMetadata, getLanguageAlternates } from './seo.js';

const canonical = () => document.head.querySelector('link[rel="canonical"]').getAttribute('href');
const ogUrl = () => document.head.querySelector('meta[property="og:url"]').getAttribute('content');
const xDefault = (page) => getLanguageAlternates(page).find((entry) => entry.hreflang === 'x-default').href;

// #529: the bare address shows the browser's language, so it is the x-default
// and its own canonical; an address with ?lang= is that language's.
describe('canonical address', () => {
  it('is the x-default on an address without ?lang=', () => {
    applySeoMetadata({ locale: 'en', url: 'https://omnifm.xyz/premium' });
    expect(canonical()).toBe(xDefault('premium'));
    expect(canonical()).toBe('https://omnifm.xyz/premium');
    expect(ogUrl()).toBe('https://omnifm.xyz/premium');
  });

  it('is the x-default of the page for a German bare path too, whatever the browser language', () => {
    applySeoMetadata({ locale: 'de', url: 'https://omnifm.xyz/impressum' });
    expect(canonical()).toBe(xDefault('imprint'));
  });

  it('is the language address on an address with ?lang=', () => {
    applySeoMetadata({ locale: 'en', url: 'https://omnifm.xyz/imprint?lang=en' });
    expect(canonical()).toBe('https://omnifm.xyz/imprint?lang=en');
  });

  it('ignores a ?lang= the site does not have', () => {
    applySeoMetadata({ locale: 'en', url: 'https://omnifm.xyz/faq?lang=xx' });
    expect(canonical()).toBe(xDefault('faq'));
  });
});
