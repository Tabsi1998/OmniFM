// OmniFM: which season the website and the dashboard show (#427). The
// visitor's own clock decides, with the bot's calendar (src/lib/seasons.js);
// the owner's main switches come from /api/season, and ?season=advent-2
// shows a look out of season (the owner console links it). Outside a season
// nothing of the decoration is loaded and /api/season is never asked.
import { useEffect, useState } from 'react';
import { seasonAt, seasonPreview } from '../../../src/lib/seasons.js';
import { buildApiUrl } from './api.js';
import { fetchAfterFirstPaint } from './firstPaint.js';

export const DECOR_HIDDEN_KEY = 'omnifm.seasonDecor.hidden';

function visitorTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Vienna';
  } catch {
    return 'Europe/Vienna';
  }
}

/** The season for this visitor now, or null; a valid ?season= look wins (marked preview). */
export function visitorSeason({ now = new Date(), search = '', timeZone = visitorTimeZone() } = {}) {
  const requested = new URLSearchParams(search || '').get('season') || '';
  const preview = requested ? seasonPreview(requested, now, timeZone) : null;
  if (preview) return { ...preview, preview: true, timeZone };
  const current = seasonAt(now, timeZone);
  return current ? { ...current, preview: false, timeZone } : null;
}

export function isDecorationHidden() {
  try {
    return window.localStorage.getItem(DECOR_HIDDEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function setDecorationHidden(hidden) {
  try {
    if (hidden) window.localStorage.setItem(DECOR_HIDDEN_KEY, '1');
    else window.localStorage.removeItem(DECOR_HIDDEN_KEY);
  } catch {
    // Without storage the choice lasts until the page is left.
  }
}

export function prefersReducedMotion() {
  try {
    return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches === true;
  } catch {
    return false;
  }
}

const currentSearch = () => (typeof window === 'undefined' ? '' : window.location.search);

let switchesRequest = null;

/** The owner's main switches, asked once per page; {} when the server does not answer. */
export function loadOwnerSeasonSwitches() {
  if (!switchesRequest) {
    switchesRequest = fetchAfterFirstPaint(buildApiUrl('/api/season'), { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => body?.enabled || {})
      .catch(() => ({}));
  }
  return switchesRequest;
}

/** For tests: forget the answer. */
export function resetOwnerSeasonSwitches() {
  switchesRequest = null;
}

/**
 * { season, hidden, setHidden, reducedMotion } for a page with decoration.
 * season is null outside a season, when the owner switched it off, or when
 * the page has none (enabled = false). Checked again every minute, so
 * midnight on New Year's Eve turns the countdown into the greeting.
 */
export function useWebsiteSeason(enabled = true) {
  const [current, setCurrent] = useState(() => (enabled ? visitorSeason({ search: currentSearch() }) : null));
  const [ownerSwitches, setOwnerSwitches] = useState(null);
  const [hidden, setHiddenState] = useState(() => isDecorationHidden());
  const [reducedMotion] = useState(() => prefersReducedMotion());

  useEffect(() => {
    if (!enabled) {
      setCurrent(null);
      return undefined;
    }
    setCurrent(visitorSeason({ search: currentSearch() }));
    const timer = window.setInterval(() => setCurrent(visitorSeason({ search: currentSearch() })), 60_000);
    return () => window.clearInterval(timer);
  }, [enabled]);

  const seasonName = current && !current.preview ? current.season : '';
  useEffect(() => {
    if (!seasonName) return undefined;
    let alive = true;
    loadOwnerSeasonSwitches().then((enabled) => { if (alive) setOwnerSwitches(enabled); });
    return () => { alive = false; };
  }, [seasonName]);

  // Until the owner's switches are known, a real season waits; a ?season= look shows at once.
  const allowed = current && (current.preview || (ownerSwitches !== null && ownerSwitches[current.season] !== false));
  const setHidden = (value) => {
    setDecorationHidden(value);
    setHiddenState(value);
  };
  return { season: allowed ? current : null, hidden, setHidden, reducedMotion };
}
