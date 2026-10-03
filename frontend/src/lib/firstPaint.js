// OmniFM: the first picture before the data (#501). The first screen draws
// without waiting for any answer, so the start page's requests wait until the
// browser reports the first content on the screen; every request after that
// goes at once. Before, the answers came in while the first picture was still
// being drawn, and each one changed the page before anything was shown.
let firstPaint = null;

// A tab in the background paints nothing: then the data comes after a moment anyway.
const FALLBACK_MS = 2000;

function contentShown() {
  return performance.getEntriesByType('paint').some((entry) => entry.name === 'first-contentful-paint');
}

/** Resolves once the page has shown its first content (at once where a browser cannot tell). */
export function afterFirstPaint() {
  if (firstPaint) return firstPaint;
  const canTell = typeof window !== 'undefined'
    && typeof PerformanceObserver === 'function'
    && (PerformanceObserver.supportedEntryTypes || []).includes('paint');
  if (!canTell || contentShown()) {
    firstPaint = Promise.resolve();
    return firstPaint;
  }
  firstPaint = new Promise((resolve) => {
    let observer = null;
    const done = () => {
      clearTimeout(fallback);
      observer?.disconnect();
      resolve();
    };
    const fallback = setTimeout(done, FALLBACK_MS);
    observer = new PerformanceObserver((list) => {
      if (list.getEntries().some((entry) => entry.name === 'first-contentful-paint')) done();
    });
    observer.observe({ type: 'paint', buffered: true });
  });
  return firstPaint;
}

/** fetch() that waits for the first picture. */
export function fetchAfterFirstPaint(url, options) {
  return afterFirstPaint().then(() => fetch(url, options));
}
