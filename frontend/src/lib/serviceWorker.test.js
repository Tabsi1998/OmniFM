import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

// The service worker (#305) keeps only the site's own static files: the
// build files and pages. An API answer, a stream or another site is never
// taken from it.
function loadRouteFor() {
  // Vitest runs in frontend/; under jsdom import.meta.url is no file path.
  const source = fs.readFileSync(path.resolve(process.cwd(), 'public/sw.js'), 'utf8');
  const module = { exports: {} };
  // `self` stays undefined here, so the worker registers no listeners.
  new Function('module', 'self', source)(module, undefined);
  return module.exports.routeFor;
}

const ORIGIN = 'https://omnifm.xyz';
const routeFor = loadRouteFor();
const route = (href, { method = 'GET', mode = 'cors' } = {}) => routeFor(new URL(href, ORIGIN), { method, mode }, ORIGIN);

describe('service worker', () => {
  it('keeps build files and handles pages', () => {
    expect(route('/assets/index-Ab12Cd.js')).toBe('assets');
    expect(route('/dashboard', { mode: 'navigate' })).toBe('page');
  });

  it('never touches the API, other methods, other sites or other files', () => {
    expect(route('/api/stats')).toBe('network');
    expect(route('/api/stations', { mode: 'navigate' })).toBe('network');
    expect(route('/assets/index-Ab12Cd.js', { method: 'POST' })).toBe('network');
    expect(route('https://ice.somafm.com/groovesalad-128-mp3')).toBe('network');
    expect(route('/brand/omnifm-icon-192.png')).toBe('network');
  });
});
