// OmniFM: where the seasonal decoration may sit on the start page (#448).
// Fixed spots (a share of a section's width) put cobwebs and eggs far out at
// the edge of a wide screen, and pumpkins floated in the air. Now the page is
// measured: its real boxes (cards with a border or a background), texts and
// pictures. Round cobwebs go into open space and are tied to the nearest
// boxes, pumpkins sit on the top edge of a card, eggs peek out from behind
// cards or sit at the end of a line of text. Everything below measurePage
// works on plain rectangles, so it is tested without a browser.

/** @typedef {{ x: number, y: number, w: number, h: number }} Rect */
/** @typedef {Rect & { id: number, kind: 'box' | 'text' | 'media', framed?: boolean }} Obstacle */
/** @typedef {Rect & { owner: number }} TextLine */
/** @typedef {{ width: number, height: number, top: number, bottom: number, obstacles: Obstacle[], lines: TextLine[] }} Page */

/** A small, seedable random number generator (mulberry32), so a visit keeps its layout when the page is measured again. */
export function seeded(seed) {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

export function overlaps(a, b, pad = 0) {
  return a.x - pad < b.x + b.w && a.x + a.w + pad > b.x && a.y - pad < b.y + b.h && a.y + a.h + pad > b.y;
}

export function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.w <= outer.x + outer.w && inner.y + inner.h <= outer.y + outer.h;
}

const grow = (rect, pad) => ({ x: rect.x - pad, y: rect.y - pad, w: rect.w + 2 * pad, h: rect.h + 2 * pad });

/**
 * Whether a rectangle is free: inside the page, touching no text or picture,
 * and not crossing the edge of a box. Lying wholly inside a big box (a panel
 * with room in it) is fine.
 */
export function isFree(rect, page, { pad = 0, ignore = [] } = {}) {
  if (rect.x < 0 || rect.x + rect.w > page.width || rect.y < page.top || rect.y + rect.h > page.height - page.bottom) return false;
  const padded = grow(rect, pad);
  for (const obstacle of page.obstacles) {
    if (ignore.includes(obstacle.id) || !overlaps(rect, obstacle, pad)) continue;
    if (obstacle.kind === 'box' && contains(obstacle, padded)) continue;
    return false;
  }
  return true;
}

// Where a ray from (x, y) meets a rectangle: where it enters, or where it
// leaves when it starts inside (a thread from inside a panel ends at its wall).
function rayRect(x, y, dx, dy, rect) {
  let near = -Infinity;
  let far = Infinity;
  for (const [origin, direction, low, high] of [[x, dx, rect.x, rect.x + rect.w], [y, dy, rect.y, rect.y + rect.h]]) {
    if (Math.abs(direction) < 1e-9) {
      if (origin < low || origin > high) return null;
      continue;
    }
    let first = (low - origin) / direction;
    let second = (high - origin) / direction;
    if (first > second) [first, second] = [second, first];
    near = Math.max(near, first);
    far = Math.min(far, second);
    if (near > far) return null;
  }
  if (far < 0) return null;
  return near >= 0 ? near : far;
}

/**
 * The first thing a ray meets within maxLength: a box, a picture, a text or
 * the side of the page. A cobweb may be tied to boxes, pictures and the side
 * of the page, never to text.
 */
export function castRay(page, x, y, dx, dy, maxLength) {
  let best = maxLength;
  let target = null;
  if (dx < -1e-9 && (0 - x) / dx < best) {
    best = (0 - x) / dx;
    target = 'wall';
  }
  if (dx > 1e-9 && (page.width - x) / dx < best) {
    best = (page.width - x) / dx;
    target = 'wall';
  }
  for (const obstacle of page.obstacles) {
    const distance = rayRect(x, y, dx, dy, obstacle);
    if (distance !== null && distance < best) {
      best = distance;
      target = obstacle.kind;
    }
  }
  return target ? { x: x + dx * best, y: y + dy * best, length: best, target } : null;
}

// Threads up, to the sides and down, a little crooked like real ones.
const ANCHOR_DIRECTIONS = [-90, -135, -45, 180, 0, 90];

function anchorsFor(page, cx, cy, radius, random, maxAnchor) {
  const anchors = [];
  for (const base of ANCHOR_DIRECTIONS) {
    const degrees = base + (random() - 0.5) * 24;
    const angle = (degrees * Math.PI) / 180;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    const hit = castRay(page, cx + dx * radius, cy + dy * radius, dx, dy, maxAnchor);
    if (hit && hit.target !== 'text' && hit.length >= 4) anchors.push({ angle, x: hit.x, y: hit.y, length: hit.length, target: hit.target });
  }
  return anchors.sort((a, b) => a.length - b.length).slice(0, 4);
}

/**
 * Round cobwebs in open space, each tied to at least two things, at least
 * once upwards (so it hangs) and at least once to the page itself, a card or
 * a picture: the edge of the screen alone does not hold a web. They keep
 * their distance from each other.
 */
export function findWebSpots(page, random, { count = 3, minRadius = 36, maxRadius = 64, maxAnchor = 220, spacing = 420, tries = 900 } = {}) {
  const usableHeight = page.height - page.top - page.bottom;
  if (page.width < 2 * minRadius + 40 || usableHeight < 2 * minRadius + 40) return [];
  const candidates = [];
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const radius = Math.min(maxRadius, minRadius + random() * (maxRadius - minRadius));
    const cx = radius + 12 + random() * Math.max(0, page.width - 2 * radius - 24);
    const cy = page.top + radius + 12 + random() * Math.max(0, usableHeight - 2 * radius - 24);
    if (!isFree({ x: cx - radius, y: cy - radius, w: 2 * radius, h: 2 * radius }, page, { pad: 14 })) continue;
    const anchors = anchorsFor(page, cx, cy, radius, random, maxAnchor);
    if (anchors.length < 2 || !anchors.some((anchor) => Math.sin(anchor.angle) < -0.3)) continue;
    if (!anchors.some((anchor) => anchor.target !== 'wall')) continue;
    const reach = anchors.reduce((sum, anchor) => sum + anchor.length, 0) / anchors.length;
    // Mostly chance: a web close to the page's boxes is only a little more likely.
    candidates.push({ cx, cy, r: radius, anchors, score: random() * (0.6 + reach / maxAnchor) });
  }
  candidates.sort((a, b) => a.score - b.score);
  const chosen = [];
  for (const candidate of candidates) {
    if (chosen.length >= count) break;
    if (chosen.every((web) => Math.hypot(web.cx - candidate.cx, web.cy - candidate.cy) >= spacing)) chosen.push(candidate);
  }
  return chosen.map(({ score, ...web }) => ({ ...web, limit: page.width }));
}

function shuffled(list, random) {
  const copy = [...list];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const other = Math.floor(random() * (index + 1));
    [copy[index], copy[other]] = [copy[other], copy[index]];
  }
  return copy;
}

// Cards and panels one can see, not the bands across the whole page.
const cards = (page, minWidth, minHeight = 0) => page.obstacles.filter((obstacle) => obstacle.kind === 'box' && obstacle.framed
  && obstacle.w >= minWidth && obstacle.h >= minHeight && obstacle.w <= page.width * 0.9 && obstacle.y >= page.top);

const farFrom = (spots, x, y, spacing) => spots.every((spot) => Math.hypot(spot.x - x, spot.y - y) >= spacing);

/** Places on the top edge of a card with room above: a pumpkin sits there. `y` is the edge. */
export function findShelves(page, random, { count = 3, size = 40, spacing = 320, avoid = [] } = {}) {
  const spots = [];
  for (const box of shuffled(cards(page, size * 3), random)) {
    if (spots.length >= count) break;
    // Anywhere along the edge; a few tries, as a spot may have a heading above it.
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const x = box.x + 12 + random() * Math.max(0, box.w - size - 24);
      const seat = { x, y: box.y - size, w: size, h: size - 2 };
      if (!isFree(seat, page, { pad: 4, ignore: [box.id] })) continue;
      if (!farFrom([...spots, ...avoid], x, box.y, spacing)) continue;
      spots.push({ x, y: box.y, box: box.id, size, tilt: (random() - 0.5) * 16 });
      break;
    }
  }
  return spots;
}

/**
 * Places where something peeks out from behind a card: `visible` is the part
 * outside the card; the rest is hidden behind it.
 */
export function findPeeks(page, random, { count = 3, size = 30, spacing = 280, avoid = [] } = {}) {
  const spots = [];
  for (const box of shuffled(cards(page, size * 2, size * 1.2), random)) {
    if (spots.length >= count) break;
    for (const side of shuffled(['top', 'left', 'right', 'bottom'], random)) {
      const along = 0.12 + random() * 0.76;
      const tall = size * 1.25;
      let visible;
      if (side === 'top') visible = { x: box.x + (box.w - size) * along, y: box.y - tall * 0.55, w: size, h: tall * 0.55 };
      else if (side === 'bottom') visible = { x: box.x + (box.w - size) * along, y: box.y + box.h, w: size, h: tall * 0.45 };
      else if (side === 'left') visible = { x: box.x - size * 0.45, y: box.y + (box.h - tall) * along, w: size * 0.45, h: tall };
      else visible = { x: box.x + box.w, y: box.y + (box.h - tall) * along, w: size * 0.45, h: tall };
      if (!isFree(visible, page, { pad: 2, ignore: [box.id] })) continue;
      if (!farFrom([...spots, ...avoid], visible.x, visible.y, spacing)) continue;
      spots.push({ side, x: visible.x, y: visible.y, visible, box: box.id, size });
      break;
    }
  }
  return spots;
}

/** Places right after the last word of a text, on its line: a small egg sits there. */
export function findTextEnds(page, random, { count = 2, size = 20, spacing = 320, avoid = [] } = {}) {
  const spots = [];
  for (const line of shuffled(page.lines, random)) {
    if (spots.length >= count) break;
    const seat = { x: line.x + line.w + 6, y: line.y + line.h - size, w: size * 0.8, h: size };
    if (!isFree(seat, page, { pad: 3, ignore: [line.owner] })) continue;
    if (!farFrom([...spots, ...avoid], seat.x, seat.y, spacing)) continue;
    spots.push({ x: seat.x, y: seat.y, w: seat.w, h: seat.h, size });
  }
  return spots;
}

// ---------------------------------------------------------------- the DOM

const MEDIA = new Set(['img', 'svg', 'canvas', 'video', 'iframe', 'input', 'textarea', 'select', 'button']);

function alphaOf(color) {
  const match = /rgba?\(([^)]+)\)/.exec(String(color || ''));
  if (!match) return 0;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean);
  return parts.length >= 4 ? Number(parts[3]) : 1;
}

function hasBorder(style) {
  return ['Top', 'Right', 'Bottom', 'Left'].some((side) => parseFloat(style[`border${side}Width`]) > 0.5
    && style[`border${side}Style`] !== 'none' && alphaOf(style[`border${side}Color`]) >= 0.05);
}

function hasOwnText(element) {
  for (const node of element.childNodes) {
    if (node.nodeType === 3 && node.textContent.trim()) return true;
  }
  return false;
}

function lastTextNode(element) {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  let last = null;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    if (node.textContent.trim()) last = node;
  }
  return last;
}

function lastLine(element) {
  const node = lastTextNode(element);
  if (!node) return null;
  const text = node.textContent.replace(/\s+$/, '');
  if (!text) return null;
  const range = document.createRange();
  range.setStart(node, text.length - 1);
  range.setEnd(node, text.length);
  const rects = range.getClientRects();
  return rects.length ? rects[rects.length - 1] : null;
}

/**
 * The page as rectangles, in page coordinates: boxes (a border or a
 * background), texts and pictures. Fixed things (menu, player bar, cookie
 * bar), our own decoration and decoration without text that lets clicks
 * through (glows) do not count.
 * @returns {Page}
 */
export function measurePage(root = document.body, { skip = '[data-season-skip]' } = {}) {
  const obstacles = [];
  const lines = [];
  const scrollX = window.scrollX || 0;
  const scrollY = window.scrollY || 0;
  const visit = (element) => {
    for (const child of element.children) {
      if (child.matches(skip)) continue;
      const style = window.getComputedStyle(child);
      if (style.display === 'none' || style.visibility === 'hidden' || style.position === 'fixed' || style.position === 'sticky') continue;
      if (style.pointerEvents === 'none' && !child.textContent.trim()) continue;
      const box = child.getBoundingClientRect();
      if (box.width < 1 || box.height < 1) {
        visit(child);
        continue;
      }
      const rect = { x: box.left + scrollX, y: box.top + scrollY, w: box.width, h: box.height };
      if (MEDIA.has(child.localName)) {
        obstacles.push({ ...rect, id: obstacles.length, kind: 'media' });
        continue;
      }
      const border = hasBorder(style);
      const background = alphaOf(style.backgroundColor);
      if (border || background >= 0.03 || (style.backgroundImage && style.backgroundImage !== 'none')) {
        obstacles.push({ ...rect, id: obstacles.length, kind: 'box', framed: border || background >= 0.05 });
      }
      if (hasOwnText(child)) {
        const id = obstacles.length;
        obstacles.push({ ...rect, id, kind: 'text' });
        const line = lastLine(child);
        if (line && line.width > 0) lines.push({ x: line.left + scrollX, y: line.top + scrollY, w: line.width, h: line.height, owner: id });
      }
      visit(child);
    }
  };
  visit(root);
  const width = document.documentElement.clientWidth || window.innerWidth || 0;
  const height = Math.max(document.documentElement.scrollHeight || 0, document.body?.scrollHeight || 0);
  // Under the menu at the top and behind the player bar at the bottom nothing shows well.
  return { width, height, top: 84, bottom: 96, obstacles, lines };
}

/**
 * Calls onChange(page) once the page has settled and again whenever it
 * changes size (data arriving, a FAQ answer opening, a new window width).
 * Returns the function that stops watching.
 */
export function watchPage(onChange, { root = null, delays = [700, 2200, 6000] } = {}) {
  let timer = 0;
  let last = null;
  const target = () => root || document.querySelector('[data-testid="app-root"]') || document.body;
  // Much the same page keeps its decoration where it is: a card that grows by
  // a line must not send the webs and eggs somewhere else.
  const run = () => {
    const page = measurePage(target());
    if (last && Math.abs(page.width - last.width) < 1 && Math.abs(page.height - last.height) < 32 && Math.abs(page.obstacles.length - last.count) < 6) return;
    last = { width: page.width, height: page.height, count: page.obstacles.length };
    onChange(page);
  };
  const soon = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(run, 250);
  };
  const timers = delays.map((ms) => window.setTimeout(run, ms));
  window.addEventListener('resize', soon);
  let observer = null;
  if (typeof ResizeObserver === 'function') {
    // Only real changes (data arriving, a FAQ answer opening), not a few pixels here and there.
    let last = null;
    observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (last && Math.abs(width - last.width) < 1 && Math.abs(height - last.height) < 6) return;
      last = { width, height };
      soon();
    });
    observer.observe(target());
  }
  document.fonts?.ready?.then(soon).catch(() => {});
  return () => {
    window.clearTimeout(timer);
    timers.forEach((id) => window.clearTimeout(id));
    window.removeEventListener('resize', soon);
    observer?.disconnect();
  };
}
