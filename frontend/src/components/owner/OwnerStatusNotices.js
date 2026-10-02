// OmniFM: owner console: the notices of the public status page (#299).
// Outages of the bots the page finds itself (measured every minute); here the
// owner writes what the measuring cannot know: a problem with an explanation,
// and planned maintenance.
import { useCallback, useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, ExternalLink, Pencil, Plus, RotateCcw, Save, Trash2, Wrench, X as CloseIcon } from 'lucide-react';
import OwnerStatusPosts from './OwnerStatusPosts.js';

function fmtDateTime(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

const EMPTY_FORM = { kind: 'incident', title: '', message: '', impact: 'minor', startsAt: '', endsAt: '' };

/** "2026-09-27T14:05" in the browser's time, what a datetime-local field shows. */
function toLocalInput(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';
  const pad = (value) => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function fromLocalInput(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function noticeState(notice, now = Date.now()) {
  if (notice.kind === 'incident') return notice.resolvedAt ? { label: 'behoben', tone: 'slate' } : { label: 'offen', tone: 'red' };
  const over = Date.parse(notice.resolvedAt || notice.endsAt);
  if (over <= now) return { label: 'vorbei', tone: 'slate' };
  return Date.parse(notice.startsAt) <= now ? { label: 'läuft', tone: 'cyan' } : { label: 'geplant', tone: 'amber' };
}

export default function OwnerStatusNotices({ apiGet, apiSend }) {
  const [notices, setNotices] = useState(null);
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  const load = useCallback(async () => {
    try {
      const data = await apiGet('/api/admin/status-notices');
      setNotices(Array.isArray(data?.notices) ? data.notices : []);
    } catch (err) {
      setNotices([]);
      setMsg({ ok: false, text: err.message });
    }
  }, [apiGet]);

  useEffect(() => { load(); }, [load]);

  const send = async (path, method, body, done) => {
    setBusy(true);
    setMsg(null);
    try {
      await apiSend(path, method, body);
      setMsg({ ok: true, text: done });
      await load();
      return true;
    } catch (err) {
      setMsg({ ok: false, text: err.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    const body = {
      kind: form.kind,
      title: form.title,
      message: form.message,
      impact: form.impact,
      startsAt: fromLocalInput(form.startsAt),
      endsAt: form.kind === 'maintenance' ? fromLocalInput(form.endsAt) : null,
    };
    const ok = form.id
      ? await send(`/api/admin/status-notices/${form.id}`, 'PATCH', body, 'Meldung gespeichert.')
      : await send('/api/admin/status-notices', 'POST', body, 'Meldung steht auf der Statusseite.');
    if (ok) setForm(null);
  };

  const edit = (notice) => setForm({
    id: notice.id,
    kind: notice.kind,
    title: notice.title,
    message: notice.message || '',
    impact: notice.impact === 'major' ? 'major' : 'minor',
    startsAt: toLocalInput(notice.startsAt),
    endsAt: toLocalInput(notice.endsAt),
  });

  const remove = (notice) => {
    if (!window.confirm(`„${notice.title}“ endgültig löschen? Sie verschwindet auch aus dem Verlauf der Statusseite.`)) return;
    send(`/api/admin/status-notices/${notice.id}`, 'DELETE', null, 'Meldung gelöscht.');
  };

  return (
    <div className="oa-fade" data-testid="owner-status-notices">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
        <div style={{ color: '#94a3b8', fontSize: 13, maxWidth: 620, lineHeight: 1.6 }}>
          Ausfälle der Bots trägt die Statusseite selbst ein, sie misst jede Minute. Hier schreibst du, was die Messung nicht weiß:
          eine Störung mit Erklärung oder eine geplante Wartung.
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <a className="oa-btn ghost" style={{ height: 42, textDecoration: 'none' }} href="/status" target="_blank" rel="noopener noreferrer" data-testid="status-open-public">
            <ExternalLink size={15} /> Statusseite
          </a>
          <button className="oa-btn primary" style={{ height: 42 }} onClick={() => setForm({ ...EMPTY_FORM })} disabled={busy} data-testid="status-notice-new">
            <Plus size={16} /> Meldung schreiben
          </button>
        </div>
      </div>

      {msg && (
        <div className={`oa-pill ${msg.ok ? 'green' : 'red'}`} style={{ marginBottom: 14 }} data-testid="status-notice-message">
          {msg.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />} {msg.text}
        </div>
      )}

      {form && (
        <div className="oa-card oa-fade" style={{ marginBottom: 18, borderColor: 'rgba(0,229,255,0.35)' }} data-testid="status-notice-form">
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
            <div style={{ fontWeight: 700, fontFamily: "'Syne','Outfit',sans-serif", fontSize: 17 }}>{form.id ? 'Meldung bearbeiten' : 'Neue Meldung'}</div>
            <button className="oa-btn ghost" style={{ height: 34, padding: '0 12px' }} onClick={() => setForm(null)} aria-label="Schließen"><CloseIcon size={15} /></button>
          </div>
          <div className="oa-grid cols-2" style={{ gap: 14 }}>
            <div>
              <label className="oa-stat-label" htmlFor="status-notice-kind">Art</label>
              <select id="status-notice-kind" className="oa-input" style={{ marginTop: 6 }} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })} data-testid="status-notice-kind">
                <option value="incident">Störung</option>
                <option value="maintenance">Wartung</option>
              </select>
            </div>
            {form.kind === 'incident' ? (
              <div>
                <label className="oa-stat-label" htmlFor="status-notice-impact">Ausmaß</label>
                <select id="status-notice-impact" className="oa-input" style={{ marginTop: 6 }} value={form.impact} onChange={(e) => setForm({ ...form, impact: e.target.value })} data-testid="status-notice-impact">
                  <option value="minor">Teilweise: einzelne Bots oder Funktionen</option>
                  <option value="major">Größer: OmniFM kaum nutzbar</option>
                </select>
              </div>
            ) : <div />}
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="oa-stat-label" htmlFor="status-notice-title">Titel (öffentlich)</label>
              <input id="status-notice-title" className="oa-input" style={{ marginTop: 6 }} maxLength={120} value={form.title} placeholder={form.kind === 'incident' ? 'z. B. Sender starten verzögert' : 'z. B. Server-Update'} onChange={(e) => setForm({ ...form, title: e.target.value })} data-testid="status-notice-title" />
            </div>
            <div style={{ gridColumn: '1 / -1' }}>
              <label className="oa-stat-label" htmlFor="status-notice-text">Text (öffentlich, optional)</label>
              <textarea id="status-notice-text" className="oa-input" style={{ marginTop: 6, height: 96, padding: '10px 14px', resize: 'vertical' }} maxLength={2000} value={form.message} onChange={(e) => setForm({ ...form, message: e.target.value })} data-testid="status-notice-text" />
            </div>
            <div>
              <label className="oa-stat-label" htmlFor="status-notice-start">{form.kind === 'incident' ? 'Seit (leer: jetzt)' : 'Beginn'}</label>
              <input id="status-notice-start" className="oa-input" type="datetime-local" style={{ marginTop: 6 }} value={form.startsAt} onChange={(e) => setForm({ ...form, startsAt: e.target.value })} data-testid="status-notice-start" />
            </div>
            {form.kind === 'maintenance' ? (
              <div>
                <label className="oa-stat-label" htmlFor="status-notice-end">Ende</label>
                <input id="status-notice-end" className="oa-input" type="datetime-local" style={{ marginTop: 6 }} value={form.endsAt} onChange={(e) => setForm({ ...form, endsAt: e.target.value })} data-testid="status-notice-end" />
              </div>
            ) : null}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 16 }}>
            <button className="oa-btn primary" onClick={save} disabled={busy || !form.title.trim()} data-testid="status-notice-save"><Save size={15} /> Speichern</button>
          </div>
        </div>
      )}

      <div className="oa-card">
        <div className="oa-stat-label" style={{ marginBottom: 10 }}>Meldungen</div>
        {notices === null ? null : notices.length ? (
          <div className="oa-table-wrap">
            <table className="oa-table">
              <thead>
                <tr><th>Art</th><th>Titel</th><th>Zeit</th><th>Stand</th><th /></tr>
              </thead>
              <tbody>
                {notices.map((notice) => {
                  const state = noticeState(notice);
                  const open = state.label === 'offen' || state.label === 'läuft' || state.label === 'geplant';
                  return (
                    <tr key={notice.id} data-testid={`status-notice-${notice.id}`}>
                      <td>{notice.kind === 'maintenance' ? <><Wrench size={13} /> Wartung</> : <><AlertTriangle size={13} /> Störung{notice.impact === 'major' ? ' (größer)' : ''}</>}</td>
                      <td>{notice.title}</td>
                      <td>{notice.kind === 'maintenance' ? `${fmtDateTime(notice.startsAt)} – ${fmtDateTime(notice.endsAt)}` : `seit ${fmtDateTime(notice.startsAt)}`}</td>
                      <td><span className={`oa-pill ${state.tone}`}>{state.label}</span></td>
                      <td style={{ whiteSpace: 'nowrap', textAlign: 'right' }}>
                        {open ? (
                          <button className="oa-btn ghost" style={{ height: 32, padding: '0 10px', fontSize: 12 }} disabled={busy}
                            onClick={() => send(`/api/admin/status-notices/${notice.id}`, 'PATCH', { resolved: true }, notice.kind === 'incident' ? 'Als behoben markiert.' : 'Wartung beendet.')}
                            data-testid={`status-notice-resolve-${notice.id}`}
                          >
                            <CheckCircle2 size={13} /> {notice.kind === 'incident' ? 'Behoben' : (state.label === 'geplant' ? 'Absagen' : 'Beenden')}
                          </button>
                        ) : notice.kind === 'incident' ? (
                          <button className="oa-btn ghost" style={{ height: 32, padding: '0 10px', fontSize: 12 }} disabled={busy}
                            onClick={() => send(`/api/admin/status-notices/${notice.id}`, 'PATCH', { resolved: false }, 'Wieder offen.')}
                          >
                            <RotateCcw size={13} /> Wieder öffnen
                          </button>
                        ) : null}
                        {' '}
                        <button className="oa-btn ghost" style={{ height: 32, padding: '0 10px' }} disabled={busy} onClick={() => edit(notice)} aria-label="Bearbeiten"><Pencil size={13} /></button>
                        {' '}
                        <button className="oa-btn ghost" style={{ height: 32, padding: '0 10px' }} disabled={busy} onClick={() => remove(notice)} aria-label="Löschen"><Trash2 size={13} /></button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div style={{ color: '#94a3b8', fontSize: 13 }}>Keine Meldung. Die Statusseite zeigt nur die gemessene Verfügbarkeit der Bots.</div>
        )}
      </div>

      <OwnerStatusPosts apiGet={apiGet} apiSend={apiSend} />
    </div>
  );
}
