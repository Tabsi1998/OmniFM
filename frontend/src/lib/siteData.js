// OmniFM: what the website loads, page by page (#485).
// Before, every page asked for the bots, the stations, the stats and the
// three legal texts every 15 seconds: 24 requests a minute for each open tab,
// against a limit of 60 per address. Now a page loads what it shows, once;
// only the live numbers come again, every minute and only while the tab is
// shown. A refused request (429) keeps what is on the page and is asked
// again as soon as the server allows (Retry-After).

export const SITE_DATA_PATHS = Object.freeze({
  bots: '/api/bots',
  stations: '/api/stations',
  stats: '/api/stats',
  legal: '/api/legal',
  privacy: '/api/privacy',
  terms: '/api/terms',
});
export const LIVE_REFRESH_MS = 60_000;
export const RETRY_MIN_MS = 5_000;

// The pages that are the start page with its sections.
const HOME_LAYOUT = new Set(['home', 'stations', 'premium', 'faq']);
// Pages that load their own data, or none.
const NO_DATA = new Set(['dashboard', 'dashboard-classic', 'dashboard-studio', 'admin', 'brand']);

/** Loaded once, and kept fresh every minute. */
export function dataForPage(page) {
  if (NO_DATA.has(page)) return { once: [], live: [] };
  // The footer names the operator, from the legal notice.
  const once = ['legal'];
  if (page === 'privacy') once.push('privacy');
  if (page === 'terms') once.push('terms');
  if (HOME_LAYOUT.has(page)) once.push('stations');
  const live = HOME_LAYOUT.has(page) ? ['bots', 'stats'] : page === 'start' ? ['bots'] : [];
  return { once, live };
}

/**
 * Loads a page's data. fetchJson(path, signal) answers the JSON or throws,
 * with retryAfterMs on a 429; apply(name, data) shows an answer; done() runs
 * once the first answers are in. Returns stop().
 */
export function startSiteData(page, { fetchJson, apply, done = () => {}, isVisible = () => true, timers = globalThis }) {
  const { once, live } = dataForPage(page);
  const controller = new AbortController();
  let stopped = false;
  let liveTimer = null;
  let retryTimer = null;

  const load = async (names) => {
    const results = await Promise.allSettled(names.map((name) => fetchJson(SITE_DATA_PATHS[name], controller.signal)));
    const failed = [];
    let retryMs = RETRY_MIN_MS;
    if (stopped) return { failed, retryMs };
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        apply(names[index], result.value);
      } else if (result.reason?.name !== 'AbortError') {
        failed.push(names[index]);
        retryMs = Math.max(retryMs, Number(result.reason?.retryAfterMs) || 0);
      }
    });
    return { failed, retryMs };
  };
  const retry = async (names) => {
    const { failed, retryMs } = await load(names);
    if (!stopped && failed.length) retryTimer = timers.setTimeout(() => retry(failed), retryMs);
  };
  const refresh = async () => {
    if (isVisible()) await load(live);
    if (!stopped) liveTimer = timers.setTimeout(refresh, LIVE_REFRESH_MS);
  };

  void (async () => {
    const names = [...once, ...live];
    if (!names.length) {
      done();
      return;
    }
    const { failed, retryMs } = await load(names);
    if (stopped) return;
    done();
    if (failed.length) retryTimer = timers.setTimeout(() => retry(failed), retryMs);
    if (live.length) liveTimer = timers.setTimeout(refresh, LIVE_REFRESH_MS);
  })();

  return () => {
    stopped = true;
    controller.abort();
    timers.clearTimeout(liveTimer);
    timers.clearTimeout(retryTimer);
  };
}
