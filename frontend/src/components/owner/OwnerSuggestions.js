// OmniFM: owner console: station suggestions from the community (#303).
// Pending ones with their stream checks over 24 hours; accept takes one into
// the catalogue (key, plan, genre, colour and logo can be set on the way),
// reject turns it down with a reason. The person who sent it hears about it
// by direct message from the bot.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, Check, CheckCircle2, ExternalLink, X as CloseIcon } from 'lucide-react';

/** A short key from a name, like the station forms make it. */
export function suggestionKey(name) {
  return String(name || '').toLowerCase().normalize('NFKD')
    .replace(/\p{M}+/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);
}

function fmtDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function healthLine(item) {
  const { checks, ok, share } = item.health || {};
  if (!checks) return 'noch keine Prüfung in den letzten 24 h';
  return `24 h: ${ok}/${checks} erreichbar (${share} %)`;
}

export default function OwnerSuggestions({ apiGet, apiSend }) {
  const [rows, setRows] = useState(null);
  const [open, setOpen] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet('/api/admin/station-suggestions');
      setRows(Array.isArray(data?.suggestions) ? data.suggestions : []);
    } catch (err) {
      setRows([]);
      setMsg({ ok: false, text: err.message });
    }
  }, [apiGet]);

  useEffect(() => { load(); }, [load]);

  const startAccept = (item) => {
    setOpen({ id: item.id, action: 'accept' });
    setForm({ key: suggestionKey(item.name), name: item.name, tier: 'free', genre: item.genre || '', color: '', logo: '', homepage: item.homepage || '' });
  };
  const startReject = (item) => {
    setOpen({ id: item.id, action: 'reject' });
    setForm({ note: '' });
  };

  const decide = async (item) => {
    setBusy(true);
    setMsg(null);
    try {
      await apiSend(`/api/admin/station-suggestions/${item.id}/${open.action}`, 'POST', form);
      setMsg({ ok: true, text: open.action === 'accept' ? `„${form.name}“ ist jetzt im Katalog; der Einsender bekommt Bescheid.` : `„${item.name}“ abgelehnt; der Einsender bekommt Bescheid.` });
      setOpen(null);
      await load();
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setBusy(false);
    }
  };

  const pending = (rows || []).filter((item) => item.status === 'pending');
  const decided = (rows || []).filter((item) => item.status !== 'pending');
  const field = (key, label, props = {}) => (
    <div>
      <label className="oa-stat-label" htmlFor={`suggest-${key}`}>{label}</label>
      <input id={`suggest-${key}`} className="oa-input" style={{ marginTop: 6 }} value={form?.[key] || ''} onChange={(e) => setForm({ ...form, [key]: e.target.value })} data-testid={`suggest-input-${key}`} {...props} />
    </div>
  );

  return (
    <div className="oa-fade" data-testid="owner-suggestions">
      <div style={{ color: '#94a3b8', fontSize: 13, lineHeight: 1.6, marginBottom: 14, maxWidth: 720 }}>
        Mit <span className="oa-mono">/sender-vorschlagen</span> schlagen Leute Sender für den Katalog vor. Der Stream wurde beim Einreichen getestet und wird jede Stunde neu geprüft.
        Doppelte (gleiche Stream-Adresse wie im Katalog oder in einem offenen Vorschlag) kommen gar nicht erst an.
      </div>
      {msg && (
        <div className={`oa-pill ${msg.ok ? 'green' : 'red'}`} style={{ marginBottom: 14 }} data-testid="suggest-message">
          {msg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {msg.text}
        </div>
      )}

      <div className="oa-stat-label" style={{ marginBottom: 10 }}>Offen ({pending.length})</div>
      {rows === null ? null : !pending.length ? (
        <div className="oa-card" style={{ color: '#94a3b8', fontSize: 13 }}>Kein offener Vorschlag.</div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {pending.map((item) => (
            <div key={item.id} className="oa-card" data-testid={`suggestion-${item.id}`}>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontWeight: 700, fontSize: 16 }}>{item.name}{item.genre ? <span style={{ color: '#94a3b8', fontWeight: 400 }}> · {item.genre}</span> : null}</div>
                  <div className="oa-mono" style={{ fontSize: 12, color: '#7ff0ff', overflowWrap: 'anywhere' }}>{item.url}</div>
                  <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                    {item.from ? `von ${item.from} · ` : ''}{fmtDate(item.createdAt)} · <span style={{ color: item.health?.share >= 90 ? '#4ade80' : '#fbbf24' }}>{healthLine(item)}</span>
                    {item.lastCheck?.bitrate ? ` · ${item.lastCheck.bitrate} kbit/s` : ''}
                    {item.lastCheck && !item.lastCheck.ok && item.lastCheck.error ? ` · zuletzt: ${item.lastCheck.error}` : ''}
                  </div>
                  {item.note ? <div style={{ fontSize: 13, color: '#cbd5e1', marginTop: 6 }}>„{item.note}“</div> : null}
                  {item.homepage ? <a href={item.homepage} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12, color: '#00e5ff' }}><ExternalLink size={11} /> Webseite</a> : null}
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
                  <button className="oa-btn primary" style={{ height: 34, padding: '0 12px', fontSize: 12 }} disabled={busy} onClick={() => startAccept(item)} data-testid={`suggest-accept-${item.id}`}><Check size={13} /> Annehmen</button>
                  <button className="oa-btn ghost" style={{ height: 34, padding: '0 12px', fontSize: 12 }} disabled={busy} onClick={() => startReject(item)} data-testid={`suggest-reject-${item.id}`}><CloseIcon size={13} /> Ablehnen</button>
                </div>
              </div>
              {open?.id === item.id && open.action === 'accept' && form ? (
                <div style={{ marginTop: 14, borderTop: '1px solid #20283b', paddingTop: 14 }} data-testid="suggest-accept-form">
                  <div className="oa-grid cols-2" style={{ gap: 12 }}>
                    {field('key', 'Key im Katalog', { placeholder: 'radio-paradise' })}
                    {field('name', 'Name')}
                    <div>
                      <label className="oa-stat-label" htmlFor="suggest-tier">Plan</label>
                      <select id="suggest-tier" className="oa-input" style={{ marginTop: 6 }} value={form.tier} onChange={(e) => setForm({ ...form, tier: e.target.value })} data-testid="suggest-input-tier">
                        <option value="free">Free</option>
                        <option value="pro">Pro</option>
                      </select>
                    </div>
                    {field('genre', 'Genre')}
                    {field('color', 'Farbe (#RRGGBB, optional)', { placeholder: '#14B8A6' })}
                    {field('logo', 'Logo-URL (https, optional)', { placeholder: 'https://…/logo.png' })}
                  </div>
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                    <button className="oa-btn ghost" style={{ height: 36 }} onClick={() => setOpen(null)}>Abbrechen</button>
                    <button className="oa-btn primary" style={{ height: 36 }} disabled={busy || !form.key || !form.name} onClick={() => decide(item)} data-testid="suggest-accept-save">In den Katalog</button>
                  </div>
                </div>
              ) : null}
              {open?.id === item.id && open.action === 'reject' && form ? (
                <div style={{ marginTop: 14, borderTop: '1px solid #20283b', paddingTop: 14 }} data-testid="suggest-reject-form">
                  {field('note', 'Grund (optional, der Einsender liest ihn)', { maxLength: 300, placeholder: 'z. B. Der Stream bricht oft ab.' })}
                  <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                    <button className="oa-btn ghost" style={{ height: 36 }} onClick={() => setOpen(null)}>Abbrechen</button>
                    <button className="oa-btn primary" style={{ height: 36 }} disabled={busy} onClick={() => decide(item)} data-testid="suggest-reject-save">Ablehnen</button>
                  </div>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {decided.length ? (
        <details style={{ marginTop: 18 }}>
          <summary className="oa-stat-label" style={{ cursor: 'pointer' }}>Entschieden ({decided.length})</summary>
          <div className="oa-table-wrap" style={{ marginTop: 10 }}>
            <table className="oa-table">
              <thead><tr><th>Sender</th><th>Stand</th><th>Wann</th><th>Einsender informiert</th></tr></thead>
              <tbody>
                {decided.map((item) => (
                  <tr key={item.id}>
                    <td>{item.name}{item.stationKey ? <span className="oa-mono" style={{ color: '#64748b' }}> · {item.stationKey}</span> : null}</td>
                    <td><span className={`oa-pill ${item.status === 'accepted' ? 'green' : 'slate'}`}>{item.status === 'accepted' ? 'angenommen' : 'abgelehnt'}</span></td>
                    <td>{fmtDate(item.decidedAt)}</td>
                    <td>{!item.answered ? '—' : item.answered.pending ? 'kommt gleich' : item.answered.delivered ? 'per DM' : 'DM nicht möglich'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      ) : null}
    </div>
  );
}
