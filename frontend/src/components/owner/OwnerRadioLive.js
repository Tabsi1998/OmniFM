// OmniFM: owner cockpit: is OmniFM Radio live (#592)? The state the webhook
// and the poll keep, the last shows, and a test show that runs start and end
// (with the operator message) without sending anything.
import { useCallback, useEffect, useState } from 'react';
import { Radio } from 'lucide-react';
import { radioDetectionText, radioPollProblemText, radioShowDuration, radioShowLabel, radioSourceLabel, radioStateText, radioTime } from '../../lib/ownerRadio.js';

const SHOWN_SHOWS = 10;

export default function OwnerRadioLive({ apiGet, apiSend }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiGet('/api/owner/radio'));
      setError('');
    } catch (err) {
      setError(err.message === 'unauthorized' ? 'Bitte neu anmelden.' : err.message);
    }
  }, [apiGet]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 30_000);
    return () => clearInterval(timer);
  }, [load]);

  if (!data && !error) return null;
  const current = data?.current || {};
  const testRunning = current.isLive && current.source === 'test';
  const realLive = current.isLive && current.source !== 'test';
  const shows = Array.isArray(data?.shows) ? data.shows.slice(0, SHOWN_SHOWS) : [];

  const testShow = async () => {
    setBusy(true);
    try {
      setData(await apiSend('/api/owner/radio/test-show', 'POST', { action: testRunning ? 'end' : 'start' }));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="oa-card" style={{ marginTop: 18 }} data-testid="radio-live">
      <div className="oa-section-title" style={{ marginTop: 0 }}><Radio size={15} /> OmniFM Radio · Live-Erkennung</div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
        <span aria-hidden="true" style={{ width: 10, height: 10, borderRadius: 5, background: current.isLive ? '#ef4444' : '#64748b', flex: '0 0 auto' }} />
        <span data-testid="radio-live-state" style={{ color: '#f8fafc', fontSize: 14, fontWeight: 700, minWidth: 0, overflowWrap: 'anywhere' }}>{radioStateText(data)}</span>
      </div>
      {data?.enabled && (
        <>
          <div data-testid="radio-live-detection" style={{ color: '#8190a8', fontSize: 12, marginTop: 6 }}>
            {radioDetectionText(data)}
            {data.observedAt ? ` · zuletzt gemeldet ${radioTime(data.observedAt)} (${radioSourceLabel(data.observedBy)})` : ''}
          </div>
          {radioPollProblemText(data) && (
            <div role="alert" data-testid="radio-live-poll-problem" style={{ color: '#fbbf24', fontSize: 12, marginTop: 6, overflowWrap: 'anywhere' }}>
              {radioPollProblemText(data)}
            </div>
          )}
          {data.canTest && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginTop: 12 }}>
              <button type="button" className="oa-btn ghost" disabled={busy || realLive} onClick={testShow} data-testid="radio-live-test" style={{ height: 30, padding: '0 12px', fontSize: 12 }}>
                {testRunning ? 'Test-Sendung beenden' : 'Test-Sendung starten'}
              </button>
              <span style={{ color: '#8190a8', fontSize: 12 }}>
                {realLive ? 'Während einer echten Sendung geht kein Test.' : 'Spielt Beginn und Ende einer Sendung durch, mit Betreiber-Meldung, ohne zu senden. Endet nach 10 Minuten von selbst.'}
              </span>
            </div>
          )}
          <div data-testid="radio-live-shows" style={{ marginTop: 14 }}>
            <div style={{ color: '#cbd5e1', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>Letzte Sendungen</div>
            {shows.length === 0 && <div style={{ color: '#8190a8', fontSize: 12 }}>Noch keine Sendung.</div>}
            {shows.map((show, index) => (
              <div key={`${index}-${show.startedAt}`} style={{ display: 'flex', gap: 10, fontSize: 12, color: '#cbd5e1', padding: '4px 0', borderTop: '1px solid #1e293b', flexWrap: 'wrap' }}>
                <span style={{ color: '#8190a8', minWidth: 92 }}>{radioTime(show.startedAt)}</span>
                <span style={{ flex: '1 1 160px', minWidth: 0, overflowWrap: 'anywhere' }}>{radioShowLabel(show)}</span>
                <span>{radioShowDuration(show.durationMs)}</span>
                <span style={{ color: '#8190a8' }}>{radioSourceLabel(show.source)}</span>
              </div>
            ))}
          </div>
        </>
      )}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 10 }}>{error}</div>}
    </div>
  );
}
