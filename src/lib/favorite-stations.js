// ============================================================
// OmniFM: favourite stations of a server (#276)
// ============================================================
// Up to five stations as quick buttons in the now-playing panel. Free shows
// three, Pro and Ultimate five. After a downgrade the extra ones are hidden,
// never deleted: they come back with the plan.

export const FAVORITES_MAX = 5;

/** How many favourites a plan shows. */
export function favoriteLimitForTier(tier) {
  const plan = String(tier || "free").toLowerCase();
  return plan === "pro" || plan === "ultimate" ? FAVORITES_MAX : 3;
}

/** The stored list: station keys, each once, at most five. */
export function normalizeFavoriteStations(value) {
  const list = [];
  for (const raw of Array.isArray(value) ? value : []) {
    const key = String(raw ?? "").trim().slice(0, 120);
    if (key && !list.includes(key)) list.push(key);
    if (list.length >= FAVORITES_MAX) break;
  }
  return list;
}

/**
 * The favourites the panel shows: available on the plan, in the stored
 * order, as many as the plan allows.
 * @param {unknown} list
 * @param {string} tier
 * @param {(key: string) => boolean} [isAvailable]
 */
export function visibleFavoriteKeys(list, tier, isAvailable = () => true) {
  return normalizeFavoriteStations(list).filter((key) => isAvailable(key)).slice(0, favoriteLimitForTier(tier));
}

/**
 * The new list after an edit. New stations may only be added while the list
 * is below the plan's limit; stations that are already stored stay, even
 * above it (a downgrade hides them, it does not delete them).
 * @returns {{ ok: boolean, list: string[], refused: string[] }}
 */
export function applyFavoriteChange(currentList, nextList, tier) {
  const current = normalizeFavoriteStations(currentList);
  const wanted = [];
  for (const raw of Array.isArray(nextList) ? nextList : []) {
    const key = String(raw ?? "").trim().slice(0, 120);
    if (key && !wanted.includes(key)) wanted.push(key);
  }
  const knownCount = Math.min(FAVORITES_MAX, wanted.filter((key) => current.includes(key)).length);
  const newAllowed = Math.max(0, favoriteLimitForTier(tier) - knownCount);
  const list = [];
  const refused = [];
  let added = 0;
  for (const key of wanted) {
    const known = current.includes(key);
    if (list.length >= FAVORITES_MAX || (!known && added >= newAllowed)) {
      refused.push(key);
      continue;
    }
    if (!known) added += 1;
    list.push(key);
  }
  return { ok: refused.length === 0, list, refused };
}

/**
 * The station browser's star menu: the stations of one page, of which the
 * selected ones are favourites. Others keep their place.
 */
export function applyFavoritePageSelection(currentList, { pageKeys = [], selectedKeys = [] } = {}, tier) {
  const current = normalizeFavoriteStations(currentList);
  const onPage = new Set(pageKeys.map(String));
  const selected = new Set(selectedKeys.map(String));
  const kept = current.filter((key) => !onPage.has(key) || selected.has(key));
  const added = [...selected].filter((key) => onPage.has(key) && !current.includes(key));
  return applyFavoriteChange(current, [...kept, ...added], tier);
}
