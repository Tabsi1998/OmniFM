import { useCallback, useEffect, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { cockpitHeadline, historyCells, sortCockpitChecks, stateMeta } from '../lib/ownerCockpit.js';

// The owner cockpit (#355): does everything work? OmniFM checks every
// 5 minutes on its own; this page shows the result, red first.

function StateBadge({ state }) {
  const meta = stateMeta(state);
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 700, color: '#e2e8f0', whiteSpace: 'nowrap' }}>
      <span aria-hidden="true" style={{ width: 18, height: 18, borderRadius: 9, background: meta.color, color: '#0b1120', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 11 }}>{meta.icon}</span>
      {meta.label}
    </span>
  );
}

function HistoryStrip({ history }) {
  const cells = historyCells(history);
  if (!cells.length) return null;
  return (
    <div aria-label="Verlauf der letzten Stunden" style={{ display: 'flex', gap: 2, marginTop: 10 }}>
      {cells.map((cell, index) => (
        <span key={`${cell.at}-${index}`} title={cell.title} style={{ flex: 1, height: 10, minWidth: 3, borderRadius: 2, background: stateMeta(cell.state).color, opacity: cell.state === 'ok' ? 0.55 : 1 }} />
      ))}
    </div>
  );
}

function CheckTile({ check, busy, onCheck, onOpen }) {
  const [open, setOpen] = useState(false);
  const meta = stateMeta(check.state);
  return (
    <div data-testid={`cockpit-${check.key}`} style={{ background: '#0f172a', border: '1px solid #1e293b', borderLeft: `4px solid ${meta.color}`, borderRadius: 8, padding: '12px 14px', display: 'flex', flexDirection: 'column' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 4 }}>
        <div style={{ color: '#f8fafc', fontWeight: 700, fontSize: 14 }}>{check.label}</div>
        <StateBadge state={check.state} />
      </div>
      <div style={{ color: '#cbd5e1', fontSize: 13, lineHeight: 1.45, marginTop: 6, flex: 1 }}>{check.summary}</div>
      {check.detail && (
        <button type="button" onClick={() => setOpen(!open)} style={{ alignSelf: 'flex-start', background: 'none', border: 'none', color: '#94a3b8', fontSize: 12, padding: 0, marginTop: 6, cursor: 'pointer' }}>
          {open ? 'Details ausblenden' : 'Details'}
        </button>
      )}
      {open && check.detail && <pre style={{ whiteSpace: 'pre-wrap', color: '#94a3b8', fontSize: 11, margin: '6px 0 0', fontFamily: "'JetBrains Mono', monospace" }}>{check.detail}</pre>}
      <HistoryStrip history={check.history} />
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        <button type="button" className="oa-btn ghost" disabled={busy} onClick={() => onCheck(check.key)} data-testid={`cockpit-check-${check.key}`} style={{ height: 28, padding: '0 10px', fontSize: 12 }}>
          Prüfen
        </button>
        {check.area && (
          <button type="button" className="oa-btn ghost" onClick={() => onOpen(check.area)} style={{ height: 28, padding: '0 10px', fontSize: 12 }}>
            Einstellen
          </button>
        )}
        <span style={{ marginLeft: 'auto', color: '#64748b', fontSize: 11 }}>
          {check.checkedAt ? new Date(check.checkedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }) : ''}
        </span>
      </div>
    </div>
  );
}

export default function OwnerCockpit({ apiGet, apiSend, onOpen }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await apiGet('/api/owner/status'));
      setError('');
    } catch (err) {
      setError(err.message === 'unauthorized' ? 'Bitte neu anmelden.' : err.message);
    }
  }, [apiGet]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const check = async (key = null) => {
    setBusy(true);
    try {
      setData(await apiSend('/api/owner/status/check', 'POST', key ? { key } : {}));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const checks = sortCockpitChecks(data?.checks);
  const headline = cockpitHeadline(data?.checks);

  return (
    <div data-testid="owner-cockpit">
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <StateBadge state={headline.state} />
        <div style={{ color: '#f8fafc', fontSize: 16, fontWeight: 700 }} data-testid="cockpit-headline">{headline.text}</div>
        <span style={{ color: '#64748b', fontSize: 12 }}>
          {data?.checkedAt ? `Zuletzt geprüft ${new Date(data.checkedAt).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} · automatisch alle 5 Minuten` : ''}
        </span>
        <button type="button" className="oa-btn ghost" disabled={busy} onClick={() => check()} data-testid="cockpit-check-all" style={{ marginLeft: 'auto' }}>
          <RefreshCw size={14} style={{ animation: busy ? 'spin 1s linear infinite' : 'none' }} /> {busy ? 'Prüft …' : 'Alles prüfen'}
        </button>
      </div>
      {error && <div style={{ color: '#fca5a5', fontSize: 13, marginBottom: 12 }}>{error}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
        {checks.map((entry) => <CheckTile key={entry.key} check={entry} busy={busy} onCheck={check} onOpen={onOpen} />)}
      </div>
    </div>
  );
}
