// OmniFM: switch or stop what a bot plays, right from the dashboard (#413).
// Every plan; the station list is the server's plan (and its own stations on
// Ultimate), the API checks the plan again like /play does.
import { useState } from 'react';
import { Square, Repeat } from 'lucide-react';

export default function GuildStreamControls({ stream, stationOptions = [], apiRequest, guildId, t, onChanged }) {
  const [stationKey, setStationKey] = useState(stream.stationKey || '');
  const [busy, setBusy] = useState('');
  const [confirmStop, setConfirmStop] = useState(false);
  const [message, setMessage] = useState(null);

  const send = async (action, extra = {}) => {
    setBusy(action);
    setMessage(null);
    try {
      const result = await apiRequest(`/api/dashboard/playback/${action}`, {
        method: 'POST',
        body: JSON.stringify({ serverId: guildId, botId: stream.botId, ...extra }),
      });
      setMessage({
        ok: true,
        text: action === 'stop'
          ? t('Gestoppt.', 'Stopped.')
          : t(`Läuft jetzt: ${result?.stationName || stationKey}`, `Now playing: ${result?.stationName || stationKey}`),
      });
      setConfirmStop(false);
      onChanged?.();
    } catch (err) {
      setMessage({ ok: false, text: err.message });
    } finally {
      setBusy('');
    }
  };

  return (
    <div data-testid={`stream-controls-${stream.botId}`} style={{ gridColumn: '1 / -1', display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginTop: 6 }}>
      <select
        className="oa-input"
        aria-label={t('Sender', 'Station')}
        data-testid={`stream-station-${stream.botId}`}
        value={stationKey}
        onChange={(e) => setStationKey(e.target.value)}
        style={{ flex: '1 1 160px', minWidth: 0, height: 32, fontSize: 12 }}
      >
        {!stationOptions.some((option) => option.key === stationKey) && stationKey ? <option value={stationKey}>{stream.stationName || stationKey}</option> : null}
        {stationOptions.map((option) => <option key={option.key} value={option.key}>{option.name}</option>)}
      </select>
      <button
        type="button"
        className="oa-btn ghost"
        style={{ height: 32, padding: '0 10px', fontSize: 12 }}
        disabled={Boolean(busy) || !stationKey || stationKey === stream.stationKey}
        onClick={() => send('switch', { stationKey })}
        data-testid={`stream-switch-${stream.botId}`}
      >
        <Repeat size={13} /> {t('Wechseln', 'Switch')}
      </button>
      <button
        type="button"
        className="oa-btn ghost"
        style={{ height: 32, padding: '0 10px', fontSize: 12, color: confirmStop ? '#fca5a5' : undefined }}
        disabled={Boolean(busy)}
        onClick={() => (confirmStop ? send('stop') : setConfirmStop(true))}
        data-testid={`stream-stop-${stream.botId}`}
      >
        <Square size={12} /> {confirmStop ? t('Wirklich stoppen?', 'Really stop?') : t('Stoppen', 'Stop')}
      </button>
      {message ? <span style={{ fontSize: 11.5, color: message.ok ? '#4ade80' : '#fca5a5' }} data-testid={`stream-message-${stream.botId}`}>{message.text}</span> : null}
    </div>
  );
}
