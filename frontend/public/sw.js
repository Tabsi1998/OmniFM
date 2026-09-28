// OmniFM service worker (#305): only the site's own static files.
//
// - /assets/* (Vite names each build file by its content) come from the cache
//   once loaded: such a file never changes under its name.
// - Pages always come from the network; the start page is kept for when the
//   phone is offline, so the app still opens.
// - Nothing else is touched: no API answer, no stream, no other website.
//   They go to the network exactly as without a service worker.

const CACHE = 'omnifm-static-v1';
const SHELL = '/';
const MAX_ASSETS = 80;

// What happens with a request: "assets", "page" or "network" (not handled).
function routeFor(url, request, origin) {
  if (request.method !== 'GET') return 'network';
  if (url.origin !== origin) return 'network';
  if (url.pathname.startsWith('/api/')) return 'network';
  if (url.pathname.startsWith('/assets/')) return 'assets';
  if (request.mode === 'navigate') return 'page';
  return 'network';
}

// Keeps the newest build files; the cache lists them in the order they came.
async function trim(cache) {
  const keys = (await cache.keys()).filter((request) => new URL(request.url).pathname.startsWith('/assets/'));
  await Promise.all(keys.slice(0, Math.max(0, keys.length - MAX_ASSETS)).map((request) => cache.delete(request)));
}

async function fromCacheFirst(request) {
  const cache = await caches.open(CACHE);
  const hit = await cache.match(request);
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok) {
    await cache.put(request, response.clone());
    await trim(cache);
  }
  return response;
}

async function pageFromNetwork(request, url) {
  try {
    const response = await fetch(request);
    if (response.ok && url.pathname === SHELL) {
      const cache = await caches.open(CACHE);
      await cache.put(SHELL, response.clone());
    }
    return response;
  } catch (error) {
    const shell = await caches.match(SHELL);
    if (shell) return shell;
    throw error;
  }
}

if (typeof self !== 'undefined' && typeof self.addEventListener === 'function') {
  self.addEventListener('install', (event) => {
    event.waitUntil(caches.open(CACHE).then((cache) => cache.add(SHELL)).catch(() => undefined));
    self.skipWaiting();
  });

  self.addEventListener('activate', (event) => {
    event.waitUntil(
      caches.keys()
        .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
        .then(() => self.clients.claim()),
    );
  });

  self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);
    const route = routeFor(url, event.request, self.location.origin);
    if (route === 'assets') event.respondWith(fromCacheFirst(event.request));
    else if (route === 'page') event.respondWith(pageFromNetwork(event.request, url));
  });
}

// For the tests (frontend/src/lib/serviceWorker.test.js); a browser ignores it.
if (typeof module !== 'undefined') module.exports = { routeFor };
