import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import DashboardReportDialog from './DashboardReportDialog.js';

// "Problem melden" in the dashboard (#436): a problem, an idea or feedback,
// two voluntary ticks, and an answer the visitor understands.

const de = (german) => german;

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function open(apiRequest, onClose = vi.fn()) {
  render(<DashboardReportDialog apiRequest={apiRequest} guildId="123456789012345678" t={de} onClose={onClose} />);
  return onClose;
}

describe('the report dialog', () => {
  it('sends the kind, the text and the two ticks for the server', async () => {
    const apiRequest = vi.fn(async () => ({ ok: true, waiting: false }));
    open(apiRequest);
    expect(screen.getByTestId('report-send').disabled).toBe(true);
    fireEvent.click(screen.getByTestId('report-kind-idea'));
    fireEvent.change(screen.getByTestId('report-text'), { target: { value: 'Mehr Jazz bitte' } });
    fireEvent.click(screen.getByTestId('report-notify'));
    await act(async () => { fireEvent.click(screen.getByTestId('report-send')); });
    expect(apiRequest).toHaveBeenCalledWith('/api/dashboard/reports?serverId=123456789012345678', {
      method: 'POST',
      body: JSON.stringify({ kind: 'idea', text: 'Mehr Jazz bitte', consent: { public: false, notify: true } }),
    });
    expect(screen.getByTestId('report-result').textContent).toContain('beim OmniFM-Team angekommen');
    expect(screen.getByTestId('report-text').value).toBe('');
  });

  it('says it plainly when reporting through Discord does not work, and when it is too soon', async () => {
    const apiRequest = vi.fn()
      .mockResolvedValueOnce({ ok: false, reason: 'unavailable' })
      .mockResolvedValueOnce({ ok: false, reason: 'cooldown' });
    open(apiRequest);
    fireEvent.change(screen.getByTestId('report-text'), { target: { value: 'Kein Ton seit heute' } });
    await act(async () => { fireEvent.click(screen.getByTestId('report-send')); });
    expect(screen.getByTestId('report-result').textContent).toContain('Melden über Discord geht gerade nicht');
    await act(async () => { fireEvent.click(screen.getByTestId('report-send')); });
    expect(screen.getByTestId('report-result').textContent).toContain('Die nächste Meldung geht in ein paar Minuten');
  });

  it('shows what the preview answers, and closes with Escape', async () => {
    const apiRequest = vi.fn(async () => { throw new Error('In der Vorschau wird nichts gespeichert.'); });
    const onClose = open(apiRequest);
    fireEvent.change(screen.getByTestId('report-text'), { target: { value: 'Nur ein Test' } });
    await act(async () => { fireEvent.click(screen.getByTestId('report-send')); });
    expect(screen.getByTestId('report-result').textContent).toContain('In der Vorschau wird nichts gespeichert');
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
