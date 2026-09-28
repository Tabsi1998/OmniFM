import { describe, expect, it } from 'vitest';
import { castRay, findPeeks, findShelves, findTextEnds, findWebSpots, isFree, overlaps, seeded } from './pageSpots.js';

// Where the seasonal decoration may sit (#448), on a start page drawn as
// rectangles: a hero text, a card with a cover and a name, a section title
// and three cards with text, all on a page-wide background panel.
export function samplePage() {
  const obstacles = [
    { id: 0, kind: 'text', x: 100, y: 120, w: 500, h: 180 },
    { id: 1, kind: 'box', framed: true, x: 800, y: 140, w: 360, h: 220 },
    { id: 2, kind: 'media', x: 820, y: 160, w: 90, h: 90 },
    { id: 3, kind: 'text', x: 930, y: 170, w: 200, h: 40 },
    { id: 4, kind: 'text', x: 100, y: 700, w: 700, h: 60 },
    { id: 5, kind: 'box', framed: true, x: 100, y: 820, w: 320, h: 300 },
    { id: 6, kind: 'box', framed: true, x: 440, y: 820, w: 320, h: 300 },
    { id: 7, kind: 'box', framed: true, x: 780, y: 820, w: 320, h: 300 },
    { id: 8, kind: 'text', x: 120, y: 850, w: 280, h: 200 },
    { id: 9, kind: 'text', x: 460, y: 850, w: 280, h: 200 },
    { id: 10, kind: 'text', x: 800, y: 850, w: 280, h: 200 },
    { id: 11, kind: 'box', framed: false, x: 0, y: 0, w: 1400, h: 1600 },
  ];
  const lines = [{ x: 100, y: 730, w: 380, h: 30, owner: 4 }, { x: 120, y: 1020, w: 150, h: 24, owner: 8 }];
  return { width: 1400, height: 1600, top: 84, bottom: 96, obstacles, lines };
}

const text = (page) => page.obstacles.filter((obstacle) => obstacle.kind !== 'box');

describe('page spots', () => {
  it('a place is free only away from text and pictures and without crossing a card’s edge', () => {
    const page = samplePage();
    expect(isFree({ x: 640, y: 420, w: 120, h: 120 }, page)).toBe(true);
    expect(isFree({ x: 150, y: 150, w: 40, h: 40 }, page)).toBe(false);
    expect(isFree({ x: 760, y: 300, w: 80, h: 80 }, page)).toBe(false);
    expect(isFree({ x: 1250, y: 1500, w: 40, h: 40 }, page)).toBe(false);
    expect(isFree({ x: 1360, y: 400, w: 60, h: 60 }, page)).toBe(false);
    // Wholly inside the page-wide panel is fine.
    expect(isFree({ x: 1200, y: 600, w: 100, h: 100 }, page)).toBe(true);
  });

  it('a thread ends where it meets a card, a picture, a text or the side of the page', () => {
    const page = samplePage();
    expect(castRay(page, 700, 250, 1, 0, 300)).toMatchObject({ target: 'box', length: 100 });
    expect(castRay(page, 50, 500, -1, 0, 300)).toMatchObject({ target: 'wall', length: 50 });
    expect(castRay(page, 300, 500, 0, -1, 400)).toMatchObject({ target: 'text', length: 200 });
    expect(castRay(page, 700, 500, 1, 0, 50)).toBeNull();
    // From inside the page-wide panel a thread ends at its inner wall.
    expect(castRay(page, 1300, 1500, 0, 1, 300)).toMatchObject({ target: 'box', length: 100 });
  });

  it('round webs lie wholly in open space, hang from above and are tied to the page itself', () => {
    const page = samplePage();
    const layouts = new Set();
    for (let seed = 1; seed <= 25; seed += 1) {
      const webs = findWebSpots(page, seeded(seed), { count: 3, minRadius: 30, maxRadius: 60, maxAnchor: 240, spacing: 300 });
      layouts.add(JSON.stringify(webs.map((web) => [Math.round(web.cx), Math.round(web.cy)])));
      for (const web of webs) {
        const circle = { x: web.cx - web.r, y: web.cy - web.r, w: 2 * web.r, h: 2 * web.r };
        expect(isFree(circle, page, { pad: 14 })).toBe(true);
        expect(web.anchors.length).toBeGreaterThanOrEqual(2);
        expect(web.anchors.some((anchor) => Math.sin(anchor.angle) < -0.3)).toBe(true);
        expect(web.anchors.some((anchor) => anchor.target !== 'wall')).toBe(true);
        expect(web.anchors.every((anchor) => anchor.target !== 'text')).toBe(true);
        expect(web.limit).toBe(page.width);
        for (const other of webs) if (other !== web) expect(Math.hypot(other.cx - web.cx, other.cy - web.cy)).toBeGreaterThanOrEqual(300);
      }
    }
    // Chance: the visits look different.
    expect(layouts.size).toBeGreaterThan(15);
  });

  it('pumpkins sit on the top edge of a card, with room above them', () => {
    const page = samplePage();
    for (let seed = 1; seed <= 20; seed += 1) {
      for (const spot of findShelves(page, seeded(seed), { count: 3, size: 40, spacing: 200 })) {
        const card = page.obstacles.find((obstacle) => obstacle.id === spot.box);
        expect(card.framed).toBe(true);
        expect(spot.y).toBe(card.y);
        expect(spot.x).toBeGreaterThanOrEqual(card.x);
        expect(spot.x + spot.size).toBeLessThanOrEqual(card.x + card.w);
        expect(text(page).some((obstacle) => overlaps({ x: spot.x, y: spot.y - spot.size, w: spot.size, h: spot.size - 2 }, obstacle))).toBe(false);
      }
    }
  });

  it('eggs peek out from behind a card or sit at the end of a line, never over text', () => {
    const page = samplePage();
    const sides = new Set();
    for (let seed = 1; seed <= 30; seed += 1) {
      for (const spot of findPeeks(page, seeded(seed), { count: 3, size: 28, spacing: 150 })) {
        sides.add(spot.side);
        const card = page.obstacles.find((obstacle) => obstacle.id === spot.box);
        const touches = { top: spot.visible.y + spot.visible.h === card.y, bottom: spot.visible.y === card.y + card.h, left: spot.visible.x + spot.visible.w === card.x, right: spot.visible.x === card.x + card.w }[spot.side];
        expect(touches).toBe(true);
        expect(text(page).some((obstacle) => overlaps(spot.visible, obstacle))).toBe(false);
      }
      for (const spot of findTextEnds(page, seeded(seed), { count: 2, size: 18, spacing: 100 })) {
        const line = page.lines.find((entry) => Math.abs(entry.x + entry.w + 6 - spot.x) < 0.01);
        expect(line).toBeTruthy();
        expect(spot.y + spot.h).toBeCloseTo(line.y + line.h);
      }
    }
    expect(sides.size).toBeGreaterThanOrEqual(3);
  });

  it('a seed gives the same layout again, another seed another one', () => {
    const one = seeded(7);
    const again = seeded(7);
    const other = seeded(8);
    const a = [one(), one(), one()];
    expect([again(), again(), again()]).toEqual(a);
    expect([other(), other(), other()]).not.toEqual(a);
    expect(a.every((value) => value >= 0 && value < 1)).toBe(true);
  });
});
