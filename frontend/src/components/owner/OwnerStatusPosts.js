// OmniFM: owner console: the status page in Discord (#478).
// The incidents and maintenance windows written here and the outages the
// status page measures become one post each in a channel of the support
// server; changes edit that post, the end gets a short reply.
import { useCallback, useEffect, useState } from 'react';
import { Field, SaveBar, Toggle } from './configFields.js';

const LANGUAGES = [
  ['de', 'Deutsch'], ['en', 'English'], ['fr', 'Français'], ['es', 'Español'], ['it', 'Italiano'],
  ['pl', 'Polski'], ['tr', 'Türkçe'], ['pt', 'Português'], ['nl', 'Nederlands'],
];
const EMPTY = { postEnabled: false, channelId: '', language: 'de' };
const CHANNEL_ID = /^\d{17,22}$/;

export default function OwnerStatusPosts({ apiGet, apiSend }) {
  const [settings, setSettings] = useState(null);
  const [loaded, setLoaded] = useState('');
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState(null);

  const take = (value) => {
    const next = { ...EMPTY, ...(value || {}) };
    setSettings(next);
    setLoaded(JSON.stringify(next));
  };

  const load = useCallback(async () => {
    try {
      const data = await apiGet('/api/admin/config');
      take(data?.statusPosts);
    } catch (err) {
      take(null);
      setMsg({ ok: false, text: err.message });
    }
  }, [apiGet]);

  useEffect(() => { load(); }, [load]);

  if (!settings) return null;
  const channelOk = CHANNEL_ID.test(String(settings.channelId || ''));

  const save = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const result = await apiSend('/api/admin/config', 'PUT', { section: 'statusPosts', data: settings });
      take(result?.data || settings);
      setMsg({ ok: true, text: 'Gespeichert.' });
    } catch (err) {
      setMsg({ ok: false, text: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="oa-card" style={{ marginTop: 18 }} data-testid="status-posts">
      <div className="oa-section-title">Status-Posts in Discord</div>
      <div style={{ fontSize: 12, color: '#64748b', marginBottom: 14, lineHeight: 1.6 }}>
        Jede Störung und Wartung von hier und jeder gemessene Ausfall eines Bots (ab 2 Minuten, wie auf der Statusseite) wird ein Beitrag im Kanal unten.
        Änderungen bearbeiten denselben Beitrag; ist es vorbei, steht das im Beitrag und eine kurze Antwort kommt darunter.
        Im Beitrag steht nur, was die Statusseite auch zeigt. In einem Ankündigungskanal veröffentlicht der Commander den Beitrag, damit ihn auch Server sehen, die dem Kanal folgen.
      </div>
      <Toggle label="Status in Discord posten" checked={!!settings.postEnabled} onChange={(v) => setSettings((p) => ({ ...p, postEnabled: v && channelOk }))} testid="status-posts-enabled" />
      {!channelOk && <div className="oa-sub" style={{ marginTop: 8 }}>Erst die Kanal-ID eintragen, dann lassen sich die Posts einschalten.</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '0 18px', marginTop: 14 }}>
        <Field
          label="Kanal-ID"
          value={settings.channelId || ''}
          onChange={(v) => setSettings((p) => ({ ...p, channelId: v.trim(), postEnabled: p.postEnabled && CHANNEL_ID.test(v.trim()) }))}
          placeholder="123456789012345678"
          testid="status-posts-channel"
        />
        <label style={{ display: 'block' }}>
          <span className="oa-stat-label">Sprache der Posts</span>
          <select className="oa-input" style={{ marginTop: 6 }} value={settings.language || 'de'} onChange={(e) => setSettings((p) => ({ ...p, language: e.target.value }))} data-testid="status-posts-language">
            {LANGUAGES.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
          </select>
        </label>
      </div>
      <div style={{ fontSize: 12, color: '#64748b', lineHeight: 1.6, marginTop: 10 }}>
        Die Kanal-ID findest du in Discord mit eingeschaltetem Entwicklermodus: Rechtsklick auf den Kanal → „Kanal-ID kopieren“. Der Commander muss auf dem Server sein und in den Kanal schreiben dürfen.
        Titel und Text deiner Meldungen kommen so in den Beitrag, wie du sie schreibst; die Sprache gilt für den Rest (Art, Zeiten, Hinweise).
      </div>
      <SaveBar onSave={save} saving={saving} msg={msg} testid="status-posts-save" dirty={JSON.stringify(settings) !== loaded} />
    </div>
  );
}
