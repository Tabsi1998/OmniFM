// OmniFM: the covers of the start page's showcase, asked once per visit (#485).
// The player at the top and the bar at the bottom turn to the next of eight
// stations every few seconds; each turn asked /api/cover again, about 27
// requests a minute for nothing new, against a limit of 60. Now each name is
// asked once and both share the answer. A failed answer (a 429, say) is
// forgotten after a minute, so the cover can still come later.
import { buildApiUrl } from './api.js';

const FORGET_FAILED_MS = 60_000;
const covers = new Map();

/** The artwork address for a station or song name, or null. */
export function coverFor(term, { fetchImpl = (...args) => fetch(...args), timers = globalThis } = {}) {
  const key = String(term || '').trim();
  if (!key) return Promise.resolve(null);
  if (!covers.has(key)) {
    const forgetLater = () => timers.setTimeout(() => covers.delete(key), FORGET_FAILED_MS);
    covers.set(key, Promise.resolve()
      .then(() => fetchImpl(buildApiUrl(`/api/cover?term=${encodeURIComponent(key)}`)))
      .then((response) => (response.ok ? response.json() : Promise.reject(new Error(`HTTP ${response.status}`))))
      .then((data) => (data && data.ok && data.artwork ? data.artwork : null))
      .catch(() => {
        forgetLater();
        return null;
      }));
  }
  return covers.get(key);
}

/** For the tests: forget every cover. */
export function forgetCovers() {
  covers.clear();
}
