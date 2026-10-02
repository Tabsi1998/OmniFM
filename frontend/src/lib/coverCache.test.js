import { afterEach, describe, expect, it, vi } from 'vitest';
import { coverFor, forgetCovers } from './coverCache.js';

// The start page's covers (#485): asked once per name per visit, shared by
// the player and the bar; a failed answer is asked again after a minute.

afterEach(() => {
  forgetCovers();
  vi.useRealTimers();
});

const answer = (status, body) => ({ ok: status < 400, status, json: async () => body });

describe('covers', () => {
  it('asks once per name, however often the showcase turns', async () => {
    const fetchImpl = vi.fn(async () => answer(200, { ok: true, artwork: '/api/image/cover?term=Groove%20Salad&size=600' }));
    const results = await Promise.all([1, 2, 3].map(() => coverFor('Groove Salad', { fetchImpl })));
    expect(results).toEqual(Array(3).fill('/api/image/cover?term=Groove%20Salad&size=600'));
    await coverFor('Groove Salad', { fetchImpl });
    await coverFor('Drone Zone', { fetchImpl });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(await coverFor('  ', { fetchImpl })).toBeNull();
  });

  it('a refused answer gives no cover now and is asked again a minute later', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => answer(429, { error: 'Too many requests.' }));
    expect(await coverFor('Lush', { fetchImpl })).toBeNull();
    expect(await coverFor('Lush', { fetchImpl })).toBeNull();
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    fetchImpl.mockImplementation(async () => answer(200, { ok: true, artwork: '/a.jpg' }));
    expect(await coverFor('Lush', { fetchImpl })).toBe('/a.jpg');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
