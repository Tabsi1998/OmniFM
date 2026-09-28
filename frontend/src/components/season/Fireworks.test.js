import { describe, expect, it } from 'vitest';
import { KINDS, PALETTES, burstSparks, planShow } from './Fireworks.js';
import { lightString } from './FairyLights.js';
import { seeded } from './pageSpots.js';

// New Year's fireworks and the fairy lights (#448): real shells, a show
// that builds up to its finale, and a string of lights as wide as the screen.

describe('fireworks', () => {
  it('a show: rockets over the whole width, bursting in the upper half, denser towards the finale, never the same twice', () => {
    const shows = [1, 2, 3].map((seed) => planShow(seeded(seed)));
    for (const show of shows) {
      expect(show.length).toBeGreaterThan(20);
      for (const launch of show) {
        expect(launch.at).toBeGreaterThan(0);
        expect(launch.at).toBeLessThan(16.6);
        expect(launch.x).toBeGreaterThanOrEqual(0.1);
        expect(launch.x).toBeLessThanOrEqual(0.9);
        expect(launch.height).toBeGreaterThanOrEqual(0.52);
        expect(launch.height).toBeLessThanOrEqual(0.82);
        expect(KINDS).toContain(launch.kind);
        expect(launch.palette).toBeLessThan(PALETTES.length);
      }
      const opening = show.filter((launch) => launch.at < 4).length;
      const finale = show.filter((launch) => launch.at >= 12).length;
      expect(finale).toBeGreaterThan(opening);
      expect(new Set(show.map((launch) => launch.kind)).size).toBeGreaterThanOrEqual(4);
    }
    expect(JSON.stringify(shows[0])).not.toBe(JSON.stringify(shows[1]));
  });

  it('shells: a sphere is densest in the middle, a ring is a tilted circle, a palm a few heavy comets', () => {
    const random = seeded(11);
    const sphere = burstSparks('peony', random, { speed: 5, count: 160 });
    const speeds = sphere.map((spark) => Math.hypot(spark.vx, spark.vy));
    expect(sphere).toHaveLength(160);
    expect(Math.max(...speeds)).toBeLessThanOrEqual(5.0001);
    // Seen from the front, a sphere's sparks are not all on its rim.
    expect(speeds.filter((speed) => speed < 3.5).length).toBeGreaterThan(30);

    const ring = burstSparks('ring', random, { speed: 5, count: 160 });
    expect(ring.length).toBe(88);
    const ringSpeeds = ring.map((spark) => Math.hypot(spark.vx, spark.vy));
    expect(Math.max(...ringSpeeds)).toBeLessThanOrEqual(5.0001);
    expect(Math.max(...ringSpeeds) - Math.min(...ringSpeeds)).toBeGreaterThan(0.5);

    const palm = burstSparks('palm', random, { speed: 5, count: 160 });
    expect(palm).toHaveLength(9);
    expect(palm.filter((spark) => spark.vy < 0).length).toBeGreaterThanOrEqual(5);
  });
});

describe('fairy lights', () => {
  it('a wire from hook to hook with bulbs along it, as many as the screen is wide', () => {
    const phone = lightString(390, seeded(1));
    const wide = lightString(2560, seeded(1));
    expect(wide.bulbs.length).toBeGreaterThan(phone.bulbs.length * 4);
    for (const { bulbs } of [phone, wide]) {
      expect(bulbs.every((bulb) => bulb.y >= 2 && bulb.y <= 22)).toBe(true);
    }
    expect(Math.min(...wide.bulbs.map((bulb) => bulb.x))).toBeLessThan(60);
    expect(Math.max(...wide.bulbs.map((bulb) => bulb.x))).toBeGreaterThan(2500);
    expect(wide.wire.startsWith('M0 2 Q')).toBe(true);
    expect(new Set(wide.bulbs.map((bulb) => bulb.color)).size).toBeGreaterThanOrEqual(4);
  });
});
