import { describe, expect, it } from 'vitest';

import { ownerPageFromSearch } from './ownerNavigation.js';

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
