import { describe, expect, it } from 'vitest';

import { initialOwnerPage, ownerPageFromSearch } from './ownerNavigation.js';

describe('ownerPageFromSearch', () => {
  it('opens the page a link names, e.g. the station alert (#550)', () => {
    expect(ownerPageFromSearch('?section=stations')).toBe('stations');
    expect(ownerPageFromSearch('?lang=de&section=cfg-alerts')).toBe('cfg-alerts');
  });

  it('falls back to the cockpit for anything it does not know', () => {
    expect(ownerPageFromSearch('')).toBe('cockpit');
    expect(ownerPageFromSearch('?section=nope')).toBe('cockpit');
    expect(ownerPageFromSearch(undefined)).toBe('cockpit');
  });
});

describe('initialOwnerPage', () => {
  it('keeps the linked page across the Discord login, which comes back without it', () => {
    expect(initialOwnerPage('?page=admin&lang=de', 'stations')).toBe('stations');
    expect(initialOwnerPage('?section=cfg-alerts', 'stations')).toBe('cfg-alerts');
  });

  it('ignores a stored value that is no page', () => {
    expect(initialOwnerPage('', 'javascript:alert(1)')).toBe('cockpit');
    expect(initialOwnerPage('', null)).toBe('cockpit');
  });
});
