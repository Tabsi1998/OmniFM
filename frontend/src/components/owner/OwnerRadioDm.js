// OmniFM: owner cockpit: the DMs to server owners when OmniFM Radio goes
// live (#594). The mode with the kill switch, where the mode comes from and
// how the last distribution went. Only the owner role can switch.
import { useCallback, useEffect, useState } from 'react';
import { Send } from 'lucide-react';
import { RADIO_DM_MODES, radioDmModeLabel, radioDmRunText, radioDmSourceLabel } from '../../lib/ownerRadioDm.js';

const NOTE = { color: '#8190a8', fontSize: 12, lineHeight: 1.6 };

export default function OwnerRadioDm({ apiGet, apiSend }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiGet('/api/owner/radio/dm'));
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

  const switchMode = async (mode) => {
    setBusy(true);
    try {
      setData(await apiSend('/api/owner/radio/dm', 'POST', { mode }));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="oa-card" style={{ marginTop: 18 }} data-testid="radio-dm">
      <div className="oa-section-title" style={{ marginTop: 0 }}><Send size={15} /> OmniFM Radio · DMs an Server-Besitzer</div>
      {!data?.enabled ? (
        <div style={NOTE}>Die DMs laufen nicht: OmniFM Radio ist aus, oder der Bot startet gerade.</div>
      ) : (
        <>
          <div style={NOTE}>
            Beim Live-Start bekommt der Besitzer jedes Servers, der OmniFM Radio sieht, eine DM mit „Jetzt hören“ und „Abbestellen“:
            höchstens eine in 12 Stunden, eine alle 5 Sekunden. Ungefragte Massen-DMs kann Discord als Spam werten und den ganzen Bot einschränken.
            „Aus“ stoppt auch eine laufende Verteilung sofort. Eine Test-Sendung schreibt nur den Besitzern der Test-Server, höchstens einmal in 10 Minuten.
          </div>
          {data.canChange ? (
            <div role="group" aria-label="Modus der DMs" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
              {RADIO_DM_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`oa-btn ${data.mode === mode ? 'primary' : 'ghost'}`}
                  aria-pressed={data.mode === mode}
                  disabled={busy}
                  onClick={() => switchMode(mode)}
                  data-testid={`radio-dm-mode-${mode}`}
                  style={{ height: 30, padding: '0 12px', fontSize: 12 }}
                >
                  {radioDmModeLabel(mode)}
                </button>
              ))}
            </div>
          ) : (
            <div data-testid="radio-dm-mode" style={{ color: '#f8fafc', fontSize: 14, fontWeight: 700, marginTop: 12 }}>{radioDmModeLabel(data.mode)}</div>
          )}
          {data.modeError ? (
            <div data-testid="radio-dm-mode-error" style={{ color: '#fca5a5', fontSize: 12, marginTop: 8 }}>
              Modus nicht lesbar (Datenbank): Bis MongoDB antwortet, gehen keine DMs raus.
            </div>
          ) : (
            <div data-testid="radio-dm-source" style={{ ...NOTE, marginTop: 8 }}>
              Modus {radioDmSourceLabel(data.modeSource)}{data.running ? ' · verteilt gerade' : ''}
            </div>
          )}
          <div data-testid="radio-dm-last-run" style={{ color: '#cbd5e1', fontSize: 12, marginTop: 10, overflowWrap: 'anywhere' }}>
            <span style={{ fontWeight: 700 }}>Letzte Verteilung: </span>{radioDmRunText(data.lastRun)}
          </div>
        </>
      )}
      {error && <div role="alert" style={{ color: '#fca5a5', fontSize: 13, marginTop: 10 }}>{error}</div>}
    </div>
  );
}
