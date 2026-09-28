import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import GuildLiveView from './GuildLiveView.js';

// The dashboard's live view (#304) from what GET /api/dashboard/playback answers.

const t = (de) => de;
const VIEW = {
  windowStart: '2026-09-27T12:00:00.000Z',
  windowEnd: '2026-09-28T12:00:00.000Z',
  hours: 24,
  bots: [{
    botId: 'bot-2',
    botName: 'OmniFM 2',
    current: { phase: 'playing', since: '2026-09-28T10:00:00.000Z', station: 'Groove Salad', failover: false },
    segments: [
      { phase: 'playing', from: '2026-09-27T12:00:00.000Z', to: '2026-09-28T02:00:00.000Z', station: 'Groove Salad', failover: false },
      { phase: 'recovering', from: '2026-09-28T02:00:00.000Z', to: '2026-09-28T02:30:00.000Z', station: 'Groove Salad', failover: false },
      { phase: 'playing', from: '2026-09-28T02:30:00.000Z', to: '2026-09-28T12:00:00.000Z', station: 'Deep Space One', failover: true },
    ],
    events: [{ at: '2026-09-28T02:30:00.000Z', phase: 'playing', from: 'recovering', reason: 'reconnect-done', station: 'Deep Space One', unexpected: false }],
  }],
};

afterEach(cleanup);

describe('live view', () => {
  it('shows each bot with its timeline, where it stands and the buttons', async () => {
    const apiRequest = vi.fn(async () => VIEW);
    render(<GuildLiveView apiRequest={apiRequest} guildId="123" t={t} />);
    const bot = await screen.findByTestId('live-bot-bot-2');
    expect(apiRequest).toHaveBeenCalledWith('/api/dashboard/playback?serverId=123');
    expect(bot.textContent).toContain('OmniFM 2');
    expect(bot.textContent).toContain('läuft · Groove Salad');
    const segments = screen.getByTestId('live-timeline-bot-2').querySelectorAll('[data-phase]');
    expect([...segments].map((segment) => segment.dataset.phase)).toEqual(['playing', 'recovering', 'playing']);
    expect(segments[2].getAttribute('title')).toContain('Ersatzsender');
  });

  it('sends a button to the bot and says what it does', async () => {
    const apiRequest = vi.fn(async (path) => (path.startsWith('/api/dashboard/playback?') ? VIEW : { ok: true }));
    render(<GuildLiveView apiRequest={apiRequest} guildId="123" t={t} />);
    const restart = await screen.findByTestId('live-restart-bot-2');
    await act(async () => { fireEvent.click(restart); });
    expect(apiRequest).toHaveBeenCalledWith('/api/dashboard/playback/restart', { method: 'POST', body: JSON.stringify({ serverId: '123', botId: 'bot-2' }) });
    expect(screen.getByTestId('live-view-notice').textContent).toContain('startet den Sender neu');
  });

  it('says so when nothing played', async () => {
    render(<GuildLiveView apiRequest={async () => ({ bots: [] })} guildId="123" t={t} />);
    expect(await screen.findByTestId('live-view-empty')).toBeTruthy();
  });
});
