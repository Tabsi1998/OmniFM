import { describe, expect, it } from 'vitest';
import { buildPageHref, resolvePageFromUrl } from './pageRouting.js';

describe('page routing', () => {
  it('finds the page from the path or ?page=', () => {
    expect(resolvePageFromUrl('https://omnifm.xyz/impressum')).toBe('imprint');
    expect(resolvePageFromUrl('https://omnifm.xyz/preise')).toBe('premium');
    // The Discord sign-in of the owner console comes back with ?page=admin (#283).
    expect(resolvePageFromUrl('https://omnifm.xyz/?page=admin&lang=de')).toBe('admin');
    expect(resolvePageFromUrl('https://omnifm.xyz/owner')).toBe('admin');
    expect(resolvePageFromUrl('https://omnifm.xyz/status')).toBe('status');
    expect(resolvePageFromUrl('https://omnifm.xyz/charts')).toBe('charts');
    // #487: an address the site does not have is no copy of the start page.
    expect(resolvePageFromUrl('https://omnifm.xyz/gibt-es-nicht')).toBe('not-found');
    expect(resolvePageFromUrl('https://omnifm.xyz/Sender/')).toBe('stations');
    expect(resolvePageFromUrl('https://omnifm.xyz/')).toBe('home');
  });

  it('builds links with the language', () => {
    expect(buildPageHref('en', 'privacy')).toBe('/privacy?lang=en');
    expect(buildPageHref('de', 'status')).toBe('/status?lang=de');
  });
});
