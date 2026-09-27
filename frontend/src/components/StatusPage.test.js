import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { I18nProvider } from '../i18n.js';
import StatusPage, { dayTone } from './StatusPage.js';

// The public status page (#299) from what GET /api/status answers.

function dayKeys(count) {
  const first = Date.UTC(2026, 5, 30);
  return Array.from({ length: count }, (_, index) => new Date(first + index * 86_400_000).toISOString().slice(0, 10));
}

function bot(key, name, online, lastDay) {
  const days = dayKeys(90).map((day) => ({ day, uptime: 100, measured: 1440, down: 0 }));
  days[0] = { day: days[0].day, uptime: null, measured: 0, down: 0 };
  days[89] = { ...days[89], ...lastDay };
  return { key, name, role: key === 'bot-1' ? 'commander' : 'worker', tier: key === 'bot-1' ? 'free' : 'pro', online, offlineSince: online ? null : '2026-09-27T11:40:00.000Z', uptime: 99.98, days };
}

const STATUS = {
  generatedAt: '2026-09-27T12:00:00.000Z',
  timeZone: 'Europe/Berlin',
  measuring: true,
  overall: 'minor',
  bots: [
    bot('bot-1', 'OmniFM DJ', true, {}),
    bot('bot-2', 'OmniFM 2', false, { uptime: 98.61, measured: 720, down: 10 }),
  ],
  current: [
    { type: 'outage', bot: 'OmniFM 2', since: '2026-09-27T11:40:00.000Z' },
    { type: 'incident', id: 'i1', title: 'Sender starten verzögert', message: 'Wir sind dran.', impact: 'minor', since: '2026-09-27T11:00:00.000Z' },
  ],
  maintenance: [{ id: 'm1', title: 'Server-Update', message: '', startsAt: '2026-09-28T08:00:00.000Z', endsAt: '2026-09-28T09:00:00.000Z', active: false }],
  history: [{ type: 'outage', bot: 'OmniFM 2', startedAt: '2026-09-26T10:00:00.000Z', endedAt: '2026-09-26T10:25:00.000Z' }],
};

function answer(body, ok = true) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok, status: ok ? 200 : 503, json: async () => body })));
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('status page', () => {
  it('shows the overall state, the problems, the maintenance, every bot with 90 days and the history', async () => {
    answer(STATUS);
    render(<I18nProvider><StatusPage /></I18nProvider>);
    await screen.findByTestId('status-bot-bot-2');

    expect(screen.getByTestId('status-content').getAttribute('aria-busy')).toBe('false');
    expect(screen.getByTestId('status-overall').dataset.overall).toBe('minor');
    expect(screen.getByTestId('status-current-outage').textContent).toContain('OmniFM 2');
    expect(screen.getByTestId('status-current-incident').textContent).toContain('Wir sind dran.');
    expect(screen.getByTestId('status-maintenance').textContent).toContain('Server-Update');
    expect(screen.getByTestId('status-history').textContent).toContain('OmniFM 2');

    const bars = screen.getByTestId('status-bars-bot-2');
    expect(bars.children).toHaveLength(90);
    expect(bars.children[0].dataset.tone).toBe('none');
    expect(bars.children[89].dataset.tone).toBe('serious');
    // The summary names the day with downtime for a screen reader.
    expect(bars.getAttribute('aria-label')).toContain('98');

    act(() => { fireEvent.mouseEnter(bars.children[89]); });
    expect(screen.getByTestId('status-day-bot-2').textContent).toMatch(/98[.,]61/);
  });

  it('says so when the status data cannot be loaded', async () => {
    answer({}, false);
    render(<I18nProvider><StatusPage /></I18nProvider>);
    const note = await screen.findByTestId('status-unreachable');
    expect(note.querySelector('a').getAttribute('href')).toContain('discord.gg');
  });

  it('colours a day by its availability', () => {
    expect([null, 100, 99.9, 99.5, 97, 50].map(dayTone)).toEqual(['none', 'good', 'good', 'warning', 'serious', 'critical']);
  });
});
