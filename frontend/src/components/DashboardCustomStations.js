import { useRef, useState } from 'react';
import { AudioLines, Pencil, Plus, Save, Trash2, X } from 'lucide-react';
import CustomStreamTestResult from './CustomStreamTestResult.js';

// A server's own stations (Ultimate): add, edit and remove. Editing keeps the
// key (#541), so the logo, folder, tags and the events that play the station
// stay with it; only name and stream URL change. "Stream testen" (#537)
// checks the URL in the form before it is saved, when adding and editing.
const EMPTY_FORM = { name: '', url: '' };

function stationKeyFor(name) {
  const slug = name.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 55) || 'station';
  return `${slug}-${Date.now().toString(36)}`;
}

export default function DashboardCustomStations({ t, guildId, stations, apiRequest, onStationsChange, setMsg }) {
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingKey, setEditingKey] = useState('');
  const [busy, setBusy] = useState(false);
  // The last stream test: { url, running } or { url, answer } or { url, error }.
  const [test, setTest] = useState(null);
  const nameInput = useRef(null);
  const endpoint = `/api/dashboard/custom-stations?serverId=${encodeURIComponent(guildId)}`;
  const editing = editingKey ? stations.find((station) => station.key === editingKey) || null : null;
  const unchanged = Boolean(editing) && form.name.trim() === (editing.name || '') && form.url.trim() === (editing.url || '');

  const resetForm = () => { setEditingKey(''); setForm(EMPTY_FORM); setTest(null); };

  const startEdit = (station) => {
    setEditingKey(station.key);
    setForm({ name: station.name || '', url: station.url || '' });
    setTest(null);
    nameInput.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    nameInput.current?.focus({ preventScroll: true });
  };

  const save = async (event) => {
    event.preventDefault();
    const name = form.name.trim();
    const url = form.url.trim();
    if (!name || !url) { setMsg({ ok: false, text: t('Name und URL sind erforderlich.', 'Name and URL are required.') }); return; }
    setBusy(true);
    try {
      if (editingKey) {
        const payload = await apiRequest(endpoint, { method: 'PUT', body: JSON.stringify({ key: editingKey, name, url }) });
        onStationsChange((list) => list.map((item) => (item.key === editingKey ? payload.station : item)));
        setMsg({ ok: true, text: t('Sender wurde aktualisiert.', 'Station updated.') });
      } else {
        const payload = await apiRequest(endpoint, { method: 'POST', body: JSON.stringify({ key: stationKeyFor(name), name, url }) });
        onStationsChange((list) => [...list, payload.station]);
        setMsg({ ok: true, text: t('Sender wurde gespeichert.', 'Station saved.') });
      }
      resetForm();
    } catch (error) {
      // The form keeps what was typed, so the mistake can be fixed right there.
      setMsg({ ok: false, text: error.message });
    } finally {
      setBusy(false);
    }
  };

  const testStream = async () => {
    const url = form.url.trim();
    if (!url) return;
    setTest({ url, running: true });
    // A result only counts for the URL it was made for: typing on drops it.
    const settle = (next) => setTest((current) => (current?.url === url ? next : current));
    try {
      const answer = await apiRequest(`/api/dashboard/custom-stations/test?serverId=${encodeURIComponent(guildId)}`, { method: 'POST', body: JSON.stringify({ url }) });
      settle({ url, answer });
    } catch (error) {
      settle({ url, error: error.status === 429 ? 'rate' : error.message });
    }
  };

  const remove = async (key) => {
    try {
      await apiRequest(`${endpoint}&key=${encodeURIComponent(key)}`, { method: 'DELETE' });
      onStationsChange((list) => list.filter((item) => item.key !== key));
      if (key === editingKey) resetForm();
      setMsg({ ok: true, text: t('Sender wurde entfernt.', 'Station removed.') });
    } catch (error) { setMsg({ ok: false, text: error.message }); }
  };

  return <>
    <form className="oa-card" style={{ marginBottom: 16, borderColor: editingKey ? 'rgba(255,107,0,0.45)' : undefined }} data-testid="guild-custom-form" onSubmit={save}>
      {editingKey && <div style={{ display: 'flex', alignItems: 'baseline', gap: '4px 12px', flexWrap: 'wrap', marginBottom: 12 }} data-testid="guild-custom-editing">
        <span style={{ fontWeight: 700 }}>{t('Sender bearbeiten', 'Edit station')}</span>
        <span style={{ color: '#8190a8', fontSize: 12.5 }}>{t('Logo, Ordner, Tags und Events bleiben erhalten.', 'Logo, folder, tags and events stay as they are.')}</span>
      </div>}
      <div className="oa-grid cols-2" style={{ gap: 12 }}>
        <div><label className="oa-stat-label" htmlFor="guild-custom-name">Name</label><input id="guild-custom-name" ref={nameInput} className="oa-input" aria-label="Name" style={{ marginTop: 6 }} maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></div>
        <div><label className="oa-stat-label" htmlFor="guild-custom-url">Stream-URL</label><input id="guild-custom-url" className="oa-input" aria-label="Stream-URL" style={{ marginTop: 6 }} inputMode="url" autoComplete="off" spellCheck={false} maxLength={500} value={form.url} placeholder="https://…/stream.mp3" onChange={(event) => { setForm({ ...form, url: event.target.value }); if (test && event.target.value.trim() !== test.url) setTest(null); }} /></div>
      </div>
      <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', marginTop: 14 }}>
        <button type="submit" className="oa-btn primary" disabled={busy || unchanged} data-testid="guild-custom-save">
          {editingKey ? <><Save size={16} /> {t('Änderungen speichern', 'Save changes')}</> : <><Plus size={16} /> {t('Hinzufügen', 'Add')}</>}
        </button>
        <button type="button" className="oa-btn ghost" onClick={testStream} disabled={!form.url.trim() || Boolean(test?.running)} data-testid="guild-custom-test"><AudioLines size={16} /> {t('Stream testen', 'Test stream')}</button>
        {editingKey && <button type="button" className="oa-btn ghost" onClick={resetForm} disabled={busy} data-testid="guild-custom-cancel"><X size={16} /> {t('Abbrechen', 'Cancel')}</button>}
      </div>
      <CustomStreamTestResult test={test} t={t} />
    </form>
    <div className="oa-table-wrap"><table className="oa-table"><thead><tr><th>Name</th><th>Stream-URL</th><th /></tr></thead><tbody>
      {!stations.length && <tr><td colSpan={3} style={{ textAlign: 'center', color: '#8190a8', padding: 22 }}>{t('Noch keine eigenen Sender', 'No custom stations yet')}</td></tr>}
      {stations.map((station) => {
        const active = station.key === editingKey;
        const cell = active ? { background: 'rgba(255,107,0,0.08)' } : undefined;
        // Two buttons per row: a bit smaller, so name and URL keep room on a phone.
        const rowButton = { height: 40, padding: '0 12px' };
        return <tr key={station.key} data-testid={`guild-custom-row-${station.key}`}>
          <td style={{ ...cell, minWidth: 96, fontWeight: 600, overflowWrap: 'anywhere' }}>{station.name}</td>
          <td className="oa-mono" style={{ ...cell, fontSize: 12, color: '#94a3b8', wordBreak: 'break-all' }}>{station.url}</td>
          <td style={{ ...cell, textAlign: 'right', whiteSpace: 'nowrap' }}>
            <button type="button" className="oa-btn ghost" style={{ ...rowButton, marginRight: 6 }} onClick={() => startEdit(station)} aria-pressed={active} aria-label={t('Sender bearbeiten', 'Edit station')} title={t('Sender bearbeiten', 'Edit station')} data-testid={`guild-custom-edit-${station.key}`}><Pencil size={14} /></button>
            <button type="button" className="oa-btn ghost" style={{ ...rowButton, color: '#ff8fab' }} onClick={() => remove(station.key)} aria-label={t('Sender entfernen', 'Remove station')} title={t('Sender entfernen', 'Remove station')} data-testid={`guild-custom-remove-${station.key}`}><Trash2 size={14} /></button>
          </td>
        </tr>;
      })}
    </tbody></table></div>
  </>;
}
