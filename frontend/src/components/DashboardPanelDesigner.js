import { useCallback, useEffect, useRef, useState } from 'react';
import { LayoutTemplate } from 'lucide-react';
import DiscordMessagePreview from './DiscordMessagePreview.js';
import { accentHex } from '../lib/discordPreview.js';

// The now-playing panel's look per server (#281): buttons, accent colour,
// "Earlier". The preview on the right is the bot's own panel with example
// data, fetched from the server on every change.

const labelStyle = { display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#D4D4D8', cursor: 'pointer' };

export default function DashboardPanelDesigner({ apiRequest, selectedGuildId, t }) {
  const [data, setData] = useState(null);
  const [design, setDesign] = useState(null);
  const [preview, setPreview] = useState(null);
  const [saved, setSaved] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const previewTimer = useRef(null);
  const base = `/api/dashboard/panel-design?serverId=${encodeURIComponent(selectedGuildId || '')}`;

  const load = useCallback(async () => {
    if (!selectedGuildId) return;
    try {
      const result = await apiRequest(base);
      setData(result);
      setDesign(result.design);
      setPreview(result.preview);
      setSaved(JSON.stringify(result.design));
      setNote('');
    } catch (err) {
      setNote(err.message);
    }
  }, [apiRequest, base, selectedGuildId]);

  useEffect(() => { load(); }, [load]);

  // Every change asks the server for the real panel, a moment after the last click.
  const change = (next) => {
    setDesign(next);
    clearTimeout(previewTimer.current);
    previewTimer.current = setTimeout(async () => {
      try {
        const result = await apiRequest(`/api/dashboard/panel-design/preview?serverId=${encodeURIComponent(selectedGuildId)}`, {
          method: 'POST',
          body: JSON.stringify({ design: next }),
        });
        setPreview(result.preview);
      } catch (err) {
        setNote(err.message);
      }
    }, 250);
  };

  useEffect(() => () => clearTimeout(previewTimer.current), []);

  const save = async (next = design) => {
    setBusy(true);
    setNote('');
    try {
      const result = await apiRequest(base, { method: 'PUT', body: JSON.stringify({ design: next }) });
      setDesign(result.design);
      setPreview(result.preview);
      setSaved(JSON.stringify(result.design));
      setNote(t('Gespeichert. Das Panel ändert sich beim nächsten Titel, spätestens in 30 Sekunden.', 'Saved. The panel changes with the next song, within 30 seconds at the latest.'));
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (!data || !design) return note ? <div style={{ color: '#FCA5A5', fontSize: 13 }}>{note}</div> : null;
  const canSave = data.canSave === true;
  const dirty = JSON.stringify(design) !== saved;
  const autoColor = design.accentColor === null;

  return (
    <div data-testid="settings-panel-designer" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <LayoutTemplate size={18} color="#10B981" />
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Panel-Design', 'Panel design')}</h3>
        {!canSave && <span style={{ fontSize: 11, color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', padding: '2px 8px' }}>PRO</span>}
      </div>
      <p style={{ color: '#52525B', fontSize: 13, marginBottom: 14, lineHeight: 1.6 }}>
        {t(
          'So sieht das „Läuft gerade“-Panel auf deinem Server aus. Pause und Stop bleiben immer, ebenso die Knöpfe bei einem Ersatzsender. Rechts siehst du das echte Panel mit Beispieldaten.',
          'This is how the "now playing" panel looks on your server. Pause and Stop always stay, and so do the buttons of a backup station. On the right is the real panel with example data.'
        )}
      </p>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 16, alignItems: 'start' }}>
        <div style={{ display: 'grid', gap: 10 }}>
          <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{t('Knöpfe', 'Buttons')}</div>
          {(data.buttons || []).map((entry) => (
            <label key={entry.key} style={labelStyle}>
              <input
                type="checkbox"
                data-testid={`panel-button-${entry.key}`}
                checked={design.buttons?.[entry.key] !== false}
                onChange={(event) => change({ ...design, buttons: { ...design.buttons, [entry.key]: event.target.checked } })}
              />
              {entry.label}
            </label>
          ))}
          <div style={{ fontSize: 11, color: '#71717A', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 6 }}>{t('Anzeige', 'Display')}</div>
          <label style={labelStyle}>
            <input type="checkbox" data-testid="panel-show-recent" checked={design.showRecent} onChange={(event) => change({ ...design, showRecent: event.target.checked })} />
            {t('„Zuletzt“ – die letzten Titel', '"Earlier" – the last songs')}
          </label>
          <label style={labelStyle}>
            <input type="checkbox" data-testid="panel-accent-auto" checked={autoColor} onChange={(event) => change({ ...design, accentColor: event.target.checked ? null : 0x10b981 })} />
            {t('Farbe automatisch (Farbe des Senders)', 'Automatic colour (the station\'s colour)')}
          </label>
          {!autoColor && (
            <label style={labelStyle}>
              <input
                type="color"
                data-testid="panel-accent-color"
                value={accentHex(design.accentColor) || '#10b981'}
                onChange={(event) => change({ ...design, accentColor: Number.parseInt(event.target.value.slice(1), 16) })}
                style={{ width: 44, height: 28, border: '1px solid #1A1A2E', background: 'transparent', padding: 0 }}
              />
              {t('Eigene Akzentfarbe', 'Own accent colour')}
            </label>
          )}
          <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
            <button
              type="button"
              data-testid="panel-design-save"
              disabled={!canSave || !dirty || busy}
              onClick={() => save()}
              style={{ height: 36, padding: '0 14px', border: 'none', background: canSave && dirty ? '#10B981' : '#1A1A2E', color: canSave && dirty ? '#042f2e' : '#52525B', fontWeight: 700, cursor: canSave && dirty && !busy ? 'pointer' : 'not-allowed' }}
            >
              {busy ? t('Speichert...', 'Saving...') : t('Speichern', 'Save')}
            </button>
            <button
              type="button"
              disabled={!canSave || busy}
              onClick={() => save({ accentColor: null, showRecent: true, buttons: {} })}
              style={{ height: 36, padding: '0 14px', border: '1px solid #1A1A2E', background: 'transparent', color: '#A1A1AA', cursor: canSave && !busy ? 'pointer' : 'not-allowed' }}
            >
              {t('Standard', 'Default')}
            </button>
          </div>
          {!canSave && (
            <div style={{ fontSize: 12, color: '#A1A1AA' }}>
              {t('Ausprobieren geht hier; speichern gibt es mit Pro und Ultimate.', 'You can try it here; saving comes with Pro and Ultimate.')}
            </div>
          )}
          {note && <div style={{ fontSize: 12, color: '#A1A1AA' }}>{note}</div>}
        </div>
        <DiscordMessagePreview payload={preview} />
      </div>
    </div>
  );
}
