import { useCallback, useEffect, useRef, useState } from 'react';
import { AudioLines } from 'lucide-react';
import { buildApiUrl } from '../lib/api.js';

// The server's jingle (#309, Ultimate): upload, listen in, play it in the
// voice channel, the two switches. The server brings every file to one
// loudness and refuses anything over 10 seconds.
const MAX_FILE_BYTES = 6 * 1024 * 1024;
const ACCEPT = 'audio/*,.mp3,.wav,.ogg,.oga,.opus,.flac,.m4a,.webm';
const labelStyle = { display: 'block', fontSize: 11, color: '#8e8e97', margin: '12px 0 4px', textTransform: 'uppercase', letterSpacing: '0.08em' };

function buttonStyle(primary, enabled) {
  return {
    height: 36,
    padding: '0 14px',
    border: primary ? 'none' : '1px solid #1A1A2E',
    background: primary ? (enabled ? '#10B981' : '#1A1A2E') : 'transparent',
    color: primary ? (enabled ? '#042f2e' : '#8e8e97') : '#A1A1AA',
    fontWeight: primary ? 700 : 400,
    cursor: enabled ? 'pointer' : 'not-allowed',
  };
}

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('read'));
    reader.readAsDataURL(file);
  });
}

function Switch({ checked, disabled, label, onChange, testId }) {
  return (
    <label style={{ display: 'flex', alignItems: 'center', gap: 10, color: disabled ? '#8e8e97' : '#D4D4D8', fontSize: 13, marginTop: 8, cursor: disabled ? 'not-allowed' : 'pointer' }}>
      <input type="checkbox" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} data-testid={testId} />
      {label}
    </label>
  );
}

export default function DashboardJingle({ apiRequest, selectedGuildId, t }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  const [note, setNote] = useState('');
  const [file, setFile] = useState(null);
  const inputRef = useRef(null);
  const serverId = encodeURIComponent(selectedGuildId || '');

  const load = useCallback(async () => {
    if (!selectedGuildId) return;
    try {
      setData(await apiRequest(`/api/dashboard/jingle?serverId=${encodeURIComponent(selectedGuildId)}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [apiRequest, selectedGuildId]);

  useEffect(() => {
    setFile(null);
    setNote('');
    load();
  }, [load]);

  const run = async (kind, action, done) => {
    setBusy(kind);
    setNote('');
    try {
      const result = await action();
      if (result && typeof result === 'object' && 'available' in result) setData(result);
      setNote(done);
    } catch (err) {
      setNote(err.message);
    } finally {
      setBusy('');
    }
  };

  const upload = () => run('upload', async () => {
    if (file.size > MAX_FILE_BYTES) throw new Error(t('Die Datei ist zu groß (höchstens 6 MB).', 'The file is too large (6 MB at most).'));
    const result = await apiRequest(`/api/dashboard/jingle?serverId=${serverId}`, {
      method: 'PUT',
      body: JSON.stringify({ name: file.name, data: await readAsDataUrl(file) }),
    });
    setFile(null);
    if (inputRef.current) inputRef.current.value = '';
    return result;
  }, t('Jingle gespeichert.', 'Jingle saved.'));

  const remove = () => run('delete', () => apiRequest(`/api/dashboard/jingle?serverId=${serverId}`, { method: 'DELETE' }), t('Jingle gelöscht.', 'Jingle deleted.'));

  const playNow = () => run('play', () => apiRequest(`/api/dashboard/jingle/play?serverId=${serverId}`, { method: 'POST', body: '{}' }), t('Der Jingle läuft jetzt.', 'The jingle is playing now.'));

  const saveSwitch = (key) => (checked) => run('settings', () => apiRequest(`/api/dashboard/jingle/settings?serverId=${serverId}`, {
    method: 'PUT',
    body: JSON.stringify({ [key]: checked }),
  }), t('Übernommen.', 'Applied.'));

  if (!data) return error ? <div style={{ color: '#FCA5A5', fontSize: 13 }}>{error}</div> : null;
  const available = data.available === true;
  const jingle = data.jingle || null;
  const settings = data.settings || { onSwitch: true, onHour: false };
  const working = Boolean(busy);

  return (
    <div data-testid="settings-jingle" style={{ background: '#0A0A0A', border: '1px solid #1A1A2E', padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <AudioLines size={18} color="#F59E0B" />
        <h3 style={{ fontFamily: "'Outfit', sans-serif", fontSize: 20 }}>{t('Jingle', 'Jingle')}</h3>
        {!available && <span style={{ fontSize: 11, color: '#8B5CF6', border: '1px solid rgba(139,92,246,0.3)', padding: '2px 8px' }}>ULTIMATE</span>}
      </div>
      <p style={{ color: '#8e8e97', fontSize: 13, marginBottom: 10, lineHeight: 1.6 }}>
        {t(
          'Ein kurzer Jingle über der Musik, wie im Radio: wenn jemand den Sender startet oder wechselt, und auf Wunsch zur vollen Stunde. Die Musik wird dabei leiser und kommt danach zurück. Höchstens 10 Sekunden; die Lautstärke gleichen wir an.',
          'A short jingle over the music, like on the radio: when someone starts or switches the station and, if you like, on the hour. The music goes down meanwhile and comes back after. 10 seconds at most; we even out the loudness.'
        )}
      </p>
      <p style={{ color: '#8e8e97', fontSize: 12, marginBottom: 12, lineHeight: 1.6 }}>
        {t('Lade nur Jingles hoch, die du selbst gemacht hast oder für die du die Rechte hast.', 'Only upload jingles you made yourself or hold the rights to.')}
      </p>
      {!available && (
        <p style={{ color: '#A1A1AA', fontSize: 13, marginBottom: 12 }}>
          {t('Das gibt es mit Ultimate. Ein gespeicherter Jingle bleibt, spielt aber erst wieder mit Ultimate.', 'This comes with Ultimate. A stored jingle stays but only plays again with Ultimate.')}
        </p>
      )}

      {jingle ? (
        <div data-testid="jingle-current" style={{ border: '1px solid #1A1A2E', background: '#050505', padding: 12 }}>
          <div style={{ color: '#fff', fontWeight: 700, overflowWrap: 'anywhere' }}>{jingle.name}</div>
          <div style={{ color: '#8e8e97', fontSize: 12, marginTop: 2 }}>
            {t('{seconds} s, hochgeladen am {date}', '{seconds} s, uploaded on {date}', {
              seconds: (Number(jingle.durationMs || 0) / 1000).toLocaleString(undefined, { maximumFractionDigits: 1 }),
              date: new Date(Number(jingle.updatedAt || 0)).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }),
            })}
          </div>
          <audio
            controls
            preload="none"
            aria-label={t('Jingle anhören', 'Listen to the jingle')}
            src={buildApiUrl(`/api/dashboard/jingle/audio?serverId=${serverId}&v=${Number(jingle.updatedAt || 0)}`)}
            style={{ width: '100%', marginTop: 10 }}
          />
          <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
            {available && (
              <button type="button" disabled={working} onClick={playNow} style={buttonStyle(false, !working)} data-testid="jingle-play">
                {t('Im Sprachkanal abspielen', 'Play in the voice channel')}
              </button>
            )}
            <button type="button" disabled={working} onClick={remove} style={buttonStyle(false, !working)} data-testid="jingle-delete">
              {t('Löschen', 'Delete')}
            </button>
          </div>
        </div>
      ) : (
        <p style={{ color: '#A1A1AA', fontSize: 13 }}>{t('Noch kein Jingle hochgeladen.', 'No jingle uploaded yet.')}</p>
      )}

      {available && (
        <>
          <label style={labelStyle}>{t('Datei (MP3, WAV, OGG, FLAC, M4A, WebM; bis 6 MB)', 'File (MP3, WAV, OGG, FLAC, M4A, WebM; up to 6 MB)')}</label>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              ref={inputRef}
              type="file"
              accept={ACCEPT}
              onChange={(event) => setFile(event.target.files?.[0] || null)}
              style={{ flex: '1 1 220px', minWidth: 0, padding: '8px 10px', border: '1px solid #1A1A2E', background: '#050505', color: '#fff', fontSize: 13 }}
              data-testid="jingle-file"
              aria-label={t('Datei (MP3, WAV, OGG, FLAC, M4A, WebM; bis 6 MB)', 'File (MP3, WAV, OGG, FLAC, M4A, WebM; up to 6 MB)')}
            />
            <button type="button" disabled={working || !file} onClick={upload} style={buttonStyle(true, !working && Boolean(file))} data-testid="jingle-upload">
              {busy === 'upload' ? t('Lade hoch...', 'Uploading...') : t('Hochladen', 'Upload')}
            </button>
          </div>
          <label style={labelStyle}>{t('Wann er läuft', 'When it plays')}</label>
          <Switch
            checked={settings.onSwitch === true}
            disabled={working}
            label={t('Beim Starten oder Wechseln des Senders', 'When the station is started or switched')}
            onChange={saveSwitch('onSwitch')}
            testId="jingle-on-switch"
          />
          <Switch
            checked={settings.onHour === true}
            disabled={working}
            label={t('Zur vollen Stunde (Zeitzone des Servers)', 'On the hour (the server’s time zone)')}
            onChange={saveSwitch('onHour')}
            testId="jingle-on-hour"
          />
        </>
      )}
      {note && <div style={{ marginTop: 10, fontSize: 12, color: '#A1A1AA' }} data-testid="jingle-note">{note}</div>}
    </div>
  );
}
